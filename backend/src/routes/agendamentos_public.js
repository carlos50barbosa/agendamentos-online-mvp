// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db.js';
import { assertDentroExpediente, formatExpedienteMessage, getExpediente, getLocalRangeMinutes } from '../lib/expediente.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded } from '../lib/plans.js';
import bcrypt from 'bcryptjs';
import { notifyEmail } from '../lib/notifications.js';
import { sendAppointmentWhatsApp } from '../lib/whatsapp_outbox.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from '../lib/whatsapp_templates.js';
import { createMercadoPagoPixPayment } from '../lib/billing.js';
import { resolveMpAccessToken } from '../services/mpAccounts.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled, whatsappConfirmationDisabled } from '../lib/client_notifications.js';
import jwt from 'jsonwebtoken';
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';

const router = Router();
const TZ = 'America/Sao_Paulo';
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const APPOINTMENT_BUFFER_MIN = (() => {
  const raw = process.env.AGENDAMENTO_BUFFER_MIN ?? process.env.APPOINTMENT_BUFFER_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;
const DEPOSIT_ALLOWED_PLANS = new Set(['pro', 'premium']);

const safeJson = (payload) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
};

function resolveApiBaseUrl() {
  const frontBase = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(frontBase);
  const defaultApi = isDevFront ? 'http://localhost:3002' : `${frontBase}/api`;
  return String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || defaultApi).replace(/\/$/, '');
}

function resolveBillingWebhookUrl(apiBase) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (base.endsWith('/api')) return `${base}/billing/webhook`;
  return `${base}/api/billing/webhook`;
}

async function resolveDepositConfig(estabelecimentoId, planContext) {
  const allowed = DEPOSIT_ALLOWED_PLANS.has(String(planContext?.plan || '').toLowerCase());
  if (!allowed) {
    return { allowed: false, enabled: false, percent: null, holdMinutes: DEFAULT_DEPOSIT_HOLD_MINUTES };
  }
  const [rows] = await pool.query(
    'SELECT deposit_enabled, deposit_percent, deposit_hold_minutes FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1',
    [estabelecimentoId]
  );
  const row = rows?.[0];
  const enabledFlag = row ? Number(row.deposit_enabled || 0) : 0;
  const percent = row?.deposit_percent != null ? Number(row.deposit_percent) : null;
  const holdMinutes = Number(row?.deposit_hold_minutes || DEFAULT_DEPOSIT_HOLD_MINUTES) || DEFAULT_DEPOSIT_HOLD_MINUTES;
  const enabled = Boolean(enabledFlag) && Number.isFinite(percent) && percent > 0;
  return { allowed: true, enabled, percent, holdMinutes };
}

const normalizeServiceIds = (value) => {
  const ids = [];
  const pushId = (entry) => {
    const num = Number(entry);
    if (Number.isFinite(num) && num > 0) ids.push(num);
  };
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'object') {
        pushId(entry.id ?? entry.servico_id ?? entry.service_id ?? entry.servicoId ?? entry.serviceId);
      } else {
        pushId(entry);
      }
    });
  } else if (value !== undefined && value !== null && String(value).trim() !== '') {
    String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(pushId);
  }
  const seen = new Set();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const extractServiceIds = (body) => {
  if (!body || typeof body !== 'object') return [];
  const rawList =
    body.servico_ids ??
    body.servicos ??
    body.service_ids ??
    body.services ??
    body.serviceIds ??
    body.servicoIds ??
    null;
  const parsed = normalizeServiceIds(rawList);
  if (parsed.length) return parsed;
  if (body.servico_id != null) {
    return normalizeServiceIds([body.servico_id]);
  }
  return [];
};

const summarizeServices = (items) => {
  const serviceNames = items.map((item) => item?.nome).filter(Boolean);
  const duracaoTotal = items.reduce((sum, item) => sum + Number(item?.duracao_min || 0), 0);
  const precoTotal = items.reduce(
    (sum, item) => sum + Number(item?.preco_centavos ?? item?.preco_snapshot ?? 0),
    0
  );
  return {
    serviceIds: items.map((item) => item.id),
    serviceNames,
    serviceLabel: serviceNames.join(' + '),
    duracaoTotal,
    precoTotal,
  };
};

const normalizeOrigem = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return raw.slice(0, 32);
};

const fetchServicesForAppointment = async (db, estabelecimentoId, serviceIds) => {
  if (!serviceIds.length) return { items: [], missing: serviceIds };
  const placeholders = serviceIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id, nome, duracao_min, preco_centavos
       FROM servicos
      WHERE id IN (${placeholders})
        AND estabelecimento_id=?
        AND ativo=1`,
    [...serviceIds, estabelecimentoId]
  );
  const map = new Map(rows.map((row) => [Number(row.id), row]));
  const missing = serviceIds.filter((id) => !map.has(Number(id)));
  if (missing.length) return { items: [], missing };
  const items = serviceIds.map((id) => {
    const svc = map.get(Number(id));
    return {
      id: Number(svc.id),
      nome: svc.nome,
      duracao_min: Number(svc.duracao_min || 0),
      preco_centavos: Number(svc.preco_centavos || 0),
    };
  });
  return { items, missing: [] };
};

const fetchServiceProfessionalMap = async (db, serviceIds) => {
  if (!serviceIds.length) return new Map();
  const placeholders = serviceIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT servico_id, profissional_id
       FROM servico_profissionais
      WHERE servico_id IN (${placeholders})`,
    serviceIds
  );
  const map = new Map();
  rows.forEach((row) => {
    const key = Number(row.servico_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(Number(row.profissional_id));
  });
  return map;
};

const fetchAppointmentItems = async (db, appointmentIds) => {
  if (!appointmentIds.length) return new Map();
  const placeholders = appointmentIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT ai.agendamento_id,
            ai.servico_id,
            ai.ordem,
            ai.duracao_min,
            ai.preco_snapshot,
            s.nome AS servico_nome
       FROM agendamento_itens ai
       JOIN servicos s ON s.id = ai.servico_id
      WHERE ai.agendamento_id IN (${placeholders})
      ORDER BY ai.agendamento_id, ai.ordem`,
    appointmentIds
  );
  const byAppointment = new Map();
  rows.forEach((row) => {
    const key = Number(row.agendamento_id);
    if (!byAppointment.has(key)) byAppointment.set(key, []);
    byAppointment.get(key).push({
      id: Number(row.servico_id),
      nome: row.servico_nome,
      ordem: Number(row.ordem) || 0,
      duracao_min: Number(row.duracao_min || 0),
      preco_snapshot: Number(row.preco_snapshot || 0),
    });
  });
  return byAppointment;
};

function brDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ,
  });
}

function toDigits(s){ return String(s || '').replace(/\D/g, ''); }

function normalizePhoneBR(value){
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

const normalizeBirthdate = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() + 1 !== month ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const boolPref = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === false) return Boolean(value);
  const num = Number(value);
  if (!Number.isNaN(num)) return num !== 0;
  const norm = String(value).trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'nao'].includes(norm)) return false;
  if (['1', 'true', 'on', 'yes', 'sim'].includes(norm)) return true;
  return fallback;
};

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');
const firstName = (full) => {
  const parts = String(full || '').trim().split(/\s+/);
  return parts[0] || '';
};

const renderConfirmPage = ({ title, message }) => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; color: #0f172a; }
      .card { max-width: 520px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; }
      .muted { color: #64748b; font-size: 14px; }
      a { color: #2563eb; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${title}</h2>
      <p>${message}</p>
      <p class="muted"><a href="${FRONTEND_BASE}">Ir para o site</a></p>
    </div>
  </body>
</html>`;

async function notifyPublicConfirmedAppointment(appointmentId) {
  try {
    const [[ag]] = await pool.query(
      `SELECT a.id, a.inicio, a.estabelecimento_id, a.servico_id, a.profissional_id,
              c.nome AS cliente_nome, c.email AS cliente_email, c.telefone AS cliente_telefone
         FROM agendamentos a
         JOIN usuarios c ON c.id=a.cliente_id
        WHERE a.id=? LIMIT 1`,
      [appointmentId]
    );
    if (!ag) return;

    const itemsByAppointment = await fetchAppointmentItems(pool, [Number(ag.id)]);
    let serviceItems = itemsByAppointment.get(Number(ag.id)) || [];
    if (!serviceItems.length && ag.servico_id) {
      const fallback = await fetchServicesForAppointment(pool, ag.estabelecimento_id, [ag.servico_id]);
      serviceItems = fallback.items || [];
    }
    const summary = summarizeServices(serviceItems);
    const serviceLabel = summary.serviceLabel || serviceItems[0]?.nome || 'servico';
    const [[est]] = await pool.query(
      'SELECT email, telefone, nome, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?',
      [ag.estabelecimento_id]
    );
    const [tmplRows] = await pool.query(
      'SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?',
      [ag.estabelecimento_id]
    );
    let profissionalRow = null;
    if (ag.profissional_id != null) {
      const [[profRow]] = await pool.query(
        'SELECT nome FROM profissionais WHERE id=? AND estabelecimento_id=?',
        [ag.profissional_id, ag.estabelecimento_id]
      );
      profissionalRow = profRow || null;
    }
    const tmpl = (tmplRows && tmplRows[0]) ? tmplRows[0] : {};
    const inicioISO = new Date(ag.inicio).toISOString();
    const inicioBR = brDateTime(inicioISO);
    const telCli = normalizePhoneBR(ag.cliente_telefone);
    const telEst = normalizePhoneBR(est?.telefone);
    const canWhatsappEst = boolPref(est?.notify_whatsapp_estab, true);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();
    const blockWhatsappImmediate = whatsappImmediateDisabled();
    const blockWhatsappConfirmation = whatsappConfirmationDisabled();
    const profNome = profissionalRow?.nome || '';
    const profLabel = profNome ? ` com ${profNome}` : '';
    const appointmentLink = `${FRONTEND_BASE}/cliente?agendamento=${ag.id}`;
    const appointmentLinkHtml = `<p><a href="${appointmentLink}">Ver agendamento</a></p>`;

    try {
      const emailNorm = ag.cliente_email ? String(ag.cliente_email).trim().toLowerCase() : '';
      if (emailNorm) {
        const subject = tmpl.email_subject || 'Agendamento confirmado';
        const rawTemplate =
          tmpl.email_html ||
          `<p>Olá, <b>{{cliente_nome}}</b>! Seu agendamento de <b>{{servico_nome}}</b>{{profissional_nome}} foi confirmado para <b>{{data_hora}}</b>.</p>`;
        const hasLinkPlaceholder = /{{\s*link_agendamento\s*}}/i.test(rawTemplate);
        let html = rawTemplate
          .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente')
          .replace(/{{\s*servico_nome\s*}}/g, serviceLabel)
          .replace(/{{\s*data_hora\s*}}/g, inicioBR)
          .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '')
          .replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com <b>${profNome}</b>` : '')
          .replace(/{{\s*link_agendamento\s*}}/gi, appointmentLinkHtml);
        if (!hasLinkPlaceholder) {
          html += appointmentLinkHtml;
        }
        await notifyEmail(emailNorm, subject, html);
      }
    } catch {}

    try {
        if (!blockWhatsappImmediate && !blockWhatsappConfirmation && !blockClientWhatsapp && telCli) {
          const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
          const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento_v2';
          const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
          const estNomeLabel = est?.nome || '';
          const isConfirmV2 = isConfirmacaoAgendamentoV2(tplName);
          const tplParams = isConfirmV2
            ? buildConfirmacaoAgendamentoV2Components({
                serviceLabel,
                dataHoraLabel: inicioBR,
                estabelecimentoNome: estNomeLabel,
              })
            : [serviceLabel, inicioBR, estNomeLabel];
          const waMsg = (tmpl.wa_template || `Novo agendamento registrado: {{servico_nome}} em {{data_hora}} - {{estabelecimento_nome}}.`)
            .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente')
            .replace(/{{\s*servico_nome\s*}}/g, serviceLabel)
            .replace(/{{\s*data_hora\s*}}/g, inicioBR)
            .replace(/{{\s*estabelecimento_nome\s*}}/g, estNomeLabel)
            .replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com ${profNome}` : '');
          const fallbackBodyParams = isConfirmV2 ? tplParams : [waMsg];
          if (/^triple|3$/.test(paramMode)) {
            await sendAppointmentWhatsApp({
              estabelecimentoId: ag.estabelecimento_id,
              agendamentoId: ag.id,
              to: telCli,
              kind: 'confirm_cli',
              template: { name: tplName, lang: tplLang, bodyParams: tplParams },
            });
          } else {
            await sendAppointmentWhatsApp({
              estabelecimentoId: ag.estabelecimento_id,
              agendamentoId: ag.id,
              to: telCli,
              kind: 'confirm_cli',
              message: waMsg,
              template: { name: tplName, lang: tplLang, bodyParams: fallbackBodyParams },
            });
          }
        }
    } catch {}

    try {
      if (!blockWhatsappImmediate && !blockWhatsappConfirmation && !blockEstabNotifications && canWhatsappEst && telEst && telEst !== telCli) {
        const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento_v2';
        const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
        const estNomeLabel = est?.nome || '';
        const isConfirmV2 = isConfirmacaoAgendamentoV2(tplName);
        const tplParams = isConfirmV2
          ? buildConfirmacaoAgendamentoV2Components({
              serviceLabel,
              dataHoraLabel: inicioBR,
              estabelecimentoNome: estNomeLabel,
            })
          : [serviceLabel, inicioBR, estNomeLabel];
        const waMsgEst = `Novo agendamento: ${serviceLabel}${profLabel} em ${inicioBR} - Cliente: ${String(ag.cliente_nome) || ''}`;
        const fallbackBodyParams = isConfirmV2 ? tplParams : [waMsgEst];
        await sendAppointmentWhatsApp({
          estabelecimentoId: ag.estabelecimento_id,
          agendamentoId: ag.id,
          to: telEst,
          kind: 'confirm_est',
          message: waMsgEst,
          template: { name: tplName, lang: tplLang, bodyParams: fallbackBodyParams },
        });
      }
    } catch {}
  } catch (e) {
    console.warn('[public/confirm][notify]', e?.message || e);
  }
}

// POST /public/agendamentos — cria agendamento sem login (guest)
router.post('/', async (req, res) => {
  let conn;
  let txStarted = false;
  try {
    const {
      estabelecimento_id,
      inicio,
      nome,
      email,
      telefone,
      otp_token,
      profissional_id: profissionalIdRaw,
      profissionalId,
      cep,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      data_nascimento,
      dataNascimento,
    } = req.body || {};

    const professionalCandidate = profissionalIdRaw != null ? profissionalIdRaw : profissionalId;
    const profissional_id = professionalCandidate == null ? null : Number(professionalCandidate);
    if (profissional_id !== null && !Number.isFinite(profissional_id)) {
      return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional invalido.' });
    }

    const serviceIds = extractServiceIds(req.body || {});
    if (!estabelecimento_id || !serviceIds.length || !inicio || !nome || !email || !telefone) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Campos obrigatorios: estabelecimento_id, servico_ids, inicio, nome, email, telefone.'
      });
    }

    const cepDigits = (cep ? String(cep) : '').replace(/[^0-9]/g, '').slice(0, 8);
    const enderecoTrim = endereco ? String(endereco).trim() : '';
    const numeroTrim = numero ? String(numero).trim() : '';
    const complementoTrim = complemento ? String(complemento).trim() : '';
    const bairroTrim = bairro ? String(bairro).trim() : '';
    const cidadeTrim = cidade ? String(cidade).trim() : '';
    const estadoTrim = estado ? String(estado).trim().toUpperCase() : '';
    const dataNascimentoRaw = data_nascimento ?? dataNascimento;
    const dataNascimentoValue = normalizeBirthdate(dataNascimentoRaw);
    if (dataNascimentoRaw && String(dataNascimentoRaw).trim() && !dataNascimentoValue) {
      return res.status(400).json({ error: 'data_nascimento_invalida', message: 'Informe uma data de nascimento valida.' });
    }
    if (cepDigits && cepDigits.length !== 8) {
      return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP valido com 8 digitos.' });
    }
    if (estadoTrim && !/^[A-Z]{2}$/.test(estadoTrim)) {
      return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
    }

    const planContext = await getPlanContext(estabelecimento_id);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    if (isDelinquentStatus(planContext.status)) {
      return res.status(403).json({ error: 'plan_delinquent', message: 'Este estabelecimento esta com o plano em atraso. Agendamentos temporariamente suspensos.' });
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) return res.status(400).json({ error: 'invalid_date' });
    if (inicioDate.getTime() <= Date.now()) return res.status(400).json({ error: 'past_datetime' });

    const { items: serviceItems, missing } = await fetchServicesForAppointment(pool, estabelecimento_id, serviceIds);
    if (missing.length) {
      return res.status(400).json({ error: 'servico_invalido', message: 'Servico invalido ou inativo para este estabelecimento.' });
    }
    if (serviceItems.some((item) => !Number.isFinite(item.duracao_min) || item.duracao_min <= 0)) {
      return res.status(400).json({ error: 'duracao_invalida' });
    }
    const summary = summarizeServices(serviceItems);
    const primaryServiceId = summary.serviceIds[0] || serviceIds[0];
    const serviceLabel = summary.serviceLabel || serviceItems[0]?.nome || 'servico';
    const totalCentavos = serviceItems.reduce(
      (sum, item) => sum + Math.max(0, Math.round(Number(item?.preco_centavos || 0))),
      0
    );

    const professionalMap = await fetchServiceProfessionalMap(pool, summary.serviceIds);
    const servicesRequiringProfessional = summary.serviceIds.filter((id) => (professionalMap.get(id)?.size || 0) > 0);
    const requiresProfessional = servicesRequiringProfessional.length > 0;

    if (requiresProfessional && profissional_id == null) {
      return res.status(400).json({ error: 'profissional_obrigatorio', message: 'Escolha um profissional para estes servicos.' });
    }

    if (profissional_id != null) {
      const [[profRow]] = await pool.query(
        'SELECT id, nome, avatar_url, ativo FROM profissionais WHERE id=? AND estabelecimento_id=?',
        [profissional_id, estabelecimento_id]
      );
      if (!profRow) {
        return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional nao encontrado para este estabelecimento.' });
      }
      if (!profRow.ativo) {
        return res.status(400).json({ error: 'profissional_inativo', message: 'Profissional inativo.' });
      }
      if (requiresProfessional) {
        const valid = servicesRequiringProfessional.every((id) => professionalMap.get(id)?.has(profissional_id));
        if (!valid) {
          return res.status(400).json({ error: 'profissional_servico', message: 'Profissional nao esta associado a todos os servicos selecionados.' });
        }
      }
    }

    const duracaoTotal = summary.duracaoTotal + APPOINTMENT_BUFFER_MIN;
    if (!Number.isFinite(duracaoTotal) || duracaoTotal <= 0) return res.status(400).json({ error: 'duracao_invalida' });
    const fimDate = new Date(inicioDate.getTime() + duracaoTotal * 60_000);
    const expediente = await getExpediente({
      db: pool,
      estabelecimentoId: estabelecimento_id,
      dateUtc: inicioDate,
    });
    const { startMin, endMin, spansDays } = getLocalRangeMinutes(inicioDate, fimDate);
    if (!assertDentroExpediente({
      startMin,
      endMin,
      abre: expediente.abre,
      fecha: expediente.fecha,
      spansDays,
      breaks: expediente.breaks,
    })) {
      return res.status(400).json({ error: 'outside_business_hours', message: formatExpedienteMessage(expediente) });
    }
    const planConfig = planContext?.config;
    const limitCheck = await checkMonthlyAppointmentLimit({
      estabelecimentoId: estabelecimento_id,
      planConfig,
      appointmentDate: inicioDate,
    });
    if (!limitCheck.ok) {
      (async () => {
        try {
          await notifyAppointmentLimitReached({
            estabelecimentoId: estabelecimento_id,
            limit: limitCheck.limit,
            total: limitCheck.total,
            range: limitCheck.range,
            planConfig,
          });
        } catch (e) {
          console.warn('[agendamentos_public][limit_notify]', e?.message || e);
        }
      })();
      return res.status(403).json({
        error: 'plan_limit_agendamentos',
        message: formatPlanLimitExceeded(planConfig, 'appointments') || 'Limite de agendamentos atingido para este mes.',
        details: { limit: limitCheck.limit, total: limitCheck.total, month: limitCheck.range?.label || null },
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const telDigits = toDigits(telefone);
    const telNorm = normalizePhoneBR(telefone);

    // OTP opcional (exigido via flag)
    const requireOtp = /^(1|true)$/i.test(String(process.env.PUBLIC_BOOKING_REQUIRE_OTP || ''));
    if (requireOtp) {
      const token = String(req.headers['x-otp-token'] || otp_token || '');
      const secret = process.env.JWT_SECRET;
      if (!token || !secret) return res.status(400).json({ error: 'otp_required' });
      try {
        const payload = jwt.verify(token, secret);
        if (payload?.scope !== 'otp') throw new Error('bad_scope');
        const ok = (payload.ch === 'email' && String(payload.v || '').toLowerCase() === emailNorm) ||
                  (payload.ch === 'phone' && String(payload.v || '') === telDigits);
        if (!ok) return res.status(400).json({ error: 'otp_mismatch' });
      } catch (e) {
        return res.status(400).json({ error: 'otp_invalid' });
      }
    }

    const depositConfig = await resolveDepositConfig(estabelecimento_id, planContext);
    const depositEnabled = depositConfig.allowed && depositConfig.enabled;
    const depositPercent = depositEnabled ? Number(depositConfig.percent || 0) : null;
    let depositCentavos = null;
    let depositHoldMinutes = DEFAULT_DEPOSIT_HOLD_MINUTES;
    let depositExpiresAt = null;
    let mpAccessToken = null;
    if (depositEnabled) {
      if (!Number.isFinite(totalCentavos) || totalCentavos <= 0) {
        console.warn('[deposit] invalid_total', {
          estabelecimento_id,
          total_centavos: totalCentavos,
          percent: depositPercent,
        });
        return res.status(400).json({ error: 'invalid_total', message: 'Serviço sem preço configurado' });
      }
      depositCentavos = Math.ceil(totalCentavos * (depositPercent || 0) / 100);
      if (!Number.isFinite(depositCentavos) || depositCentavos <= 0) {
        console.warn('[deposit] invalid_deposit_value', {
          estabelecimento_id,
          total_centavos: totalCentavos,
          percent: depositPercent,
          deposit_centavos: depositCentavos,
        });
        return res.status(400).json({ error: 'invalid_total', message: 'Serviço sem preço configurado' });
      }
      depositHoldMinutes = Number(depositConfig.holdMinutes || DEFAULT_DEPOSIT_HOLD_MINUTES) || DEFAULT_DEPOSIT_HOLD_MINUTES;
      depositExpiresAt = new Date(Date.now() + depositHoldMinutes * 60_000);
      const mpAccess = await resolveMpAccessToken(estabelecimento_id, { allowFallback: false });
      const mpStatus = mpAccess.account?.status || null;
      if (mpStatus !== 'connected' || !mpAccess.accessToken) {
        console.warn('[deposit] mp_not_connected', {
          estabelecimento_id,
          status: mpStatus,
          reason: mpAccess.reason || 'missing_token',
        });
        return res.status(409).json({
          error: 'mp_not_connected_for_deposit',
          message: 'Conecte seu Mercado Pago para receber o sinal.',
        });
      }
      mpAccessToken = mpAccess.accessToken;
    }
    const depositRequired = Boolean(depositEnabled && Number.isFinite(depositCentavos) && depositCentavos > 0);
    if (!depositRequired) {
      depositCentavos = null;
      depositExpiresAt = null;
    }
    console.info('[deposit]', {
      estabelecimento_id,
      enabled: depositEnabled,
      percent: depositPercent,
      total_centavos: totalCentavos,
      deposit_centavos: depositCentavos,
      hold_minutes: depositHoldMinutes,
    });

    // resolve/ cria cliente guest via email (preferencia) ou telefone

    let userId = null;
    let userByEmail = null;
    let userByPhone = null;
    {
      const [urows] = await pool.query(
        'SELECT id, nome, email, telefone FROM usuarios WHERE LOWER(email)=? LIMIT 1',
        [emailNorm]
      );
      if (urows.length) userByEmail = urows[0];
    }
    if (telNorm || telDigits) {
      const candidates = [];
      if (telNorm) candidates.push(telNorm);
      if (telDigits && telDigits !== telNorm) candidates.push(telDigits);
      for (const candidate of candidates) {
        const [urows] = await pool.query(
          'SELECT id, nome, email, telefone FROM usuarios WHERE telefone=? LIMIT 1',
          [candidate]
        );
        if (urows.length) {
          userByPhone = urows[0];
          break;
        }
      }
    }
    if (userByEmail && userByPhone && userByEmail.id !== userByPhone.id) {
      return res.status(409).json({
        error: 'cliente_conflito',
        message: 'Já existe cliente com este email ou telefone. Revise os dados antes de continuar.',
      });
    }
    const existingUser = userByEmail || userByPhone;
    if (existingUser) {
      const existingEmail = existingUser.email ? String(existingUser.email).trim().toLowerCase() : '';
      const existingPhone = existingUser.telefone ? normalizePhoneBR(existingUser.telefone) : '';
      const emailMismatch = existingEmail && emailNorm && existingEmail !== emailNorm;
      const phoneMismatch = existingPhone && telNorm && existingPhone !== telNorm;
      if (emailMismatch || phoneMismatch) {
        return res.status(409).json({
          error: 'cliente_conflito',
          message: 'Já existe cliente com este email ou telefone. Revise os dados antes de continuar.',
        });
      }
      userId = existingUser.id;
    }
    if (!userId) {
      const hash = await bcrypt.hash(Math.random().toString(36), 10);
      const [r] = await pool.query(
        "INSERT INTO usuarios (nome, email, telefone, data_nascimento, cep, endereco, numero, complemento, bairro, cidade, estado, senha_hash, tipo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'cliente')",
        [
          String(nome).slice(0,120),
          emailNorm,
          telNorm || null,
          dataNascimentoValue,
          cepDigits || null,
          enderecoTrim || null,
          numeroTrim || null,
          complementoTrim || null,
          bairroTrim || null,
          cidadeTrim || null,
          estadoTrim || null,
          hash,
        ]
      );
      userId = r.insertId;
    } else {
      try {
        const updates = ['nome=COALESCE(nome,?)'];
        const params = [String(nome).slice(0,120)];
        if (telNorm) {
          updates.push('telefone=?');
          params.push(telNorm);
        }
        if (dataNascimentoValue) {
          updates.push('data_nascimento=COALESCE(data_nascimento,?)');
          params.push(dataNascimentoValue);
        }
        if (cepDigits) {
          updates.push('cep=COALESCE(cep,?)');
          params.push(cepDigits);
        }
        if (enderecoTrim) {
          updates.push('endereco=COALESCE(endereco,?)');
          params.push(enderecoTrim);
        }
        if (numeroTrim) {
          updates.push('numero=COALESCE(numero,?)');
          params.push(numeroTrim);
        }
        if (complementoTrim) {
          updates.push('complemento=COALESCE(complemento,?)');
          params.push(complementoTrim);
        }
        if (bairroTrim) {
          updates.push('bairro=COALESCE(bairro,?)');
          params.push(bairroTrim);
        }
        if (cidadeTrim) {
          updates.push('cidade=COALESCE(cidade,?)');
          params.push(cidadeTrim);
        }
        if (estadoTrim) {
          updates.push('estado=COALESCE(estado,?)');
          params.push(estadoTrim);
        }
        if (updates.length) {
          await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id=?`, [...params, userId]);
        }
      } catch {}
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    let conflictSql = `SELECT id FROM agendamentos
       WHERE estabelecimento_id=? AND status IN ('confirmado','pendente','pendente_pagamento')
         AND (
           status = 'confirmado'
           OR (status = 'pendente' AND (public_confirm_expires_at IS NULL OR public_confirm_expires_at >= NOW()))
           OR (status = 'pendente_pagamento' AND (deposit_expires_at IS NULL OR deposit_expires_at >= NOW()))
         )
         AND (inicio < ? AND fim > ?)`;
    const conflictParams = [estabelecimento_id, fimDate, inicioDate];
    if (profissional_id != null && requiresProfessional) {
      conflictSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
      conflictParams.push(profissional_id);
    }
    conflictSql += ' FOR UPDATE';
    const [conf] = await conn.query(conflictSql, conflictParams);
    if (conf.length) {
      if (txStarted && conn) {
        await conn.rollback();
      }
      conn.release();
      return res.status(409).json({ error: 'slot_ocupado' });
    }

    const origem =
      normalizeOrigem(
        req.body?.origem ??
        req.body?.canal ??
        req.body?.channel ??
        req.body?.utm_source ??
        req.body?.utmSource ??
        req.body?.source ??
        req.query?.origem ??
        req.query?.canal ??
        req.query?.utm_source ??
        req.query?.utmSource ??
        req.query?.source
      ) || 'site';

    let appointmentId = null;
    let depositPaymentId = null;
    if (depositRequired) {
      const [ins] = await conn.query(
        `INSERT INTO agendamentos
          (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, origem, total_centavos,
           deposit_required, deposit_percent, deposit_centavos, deposit_expires_at)
         VALUES (?,?,?,?,?,?, 'pendente_pagamento', ?, ?, 1, ?, ?, ?)`,
        [
          userId,
          estabelecimento_id,
          primaryServiceId,
          profissional_id || null,
          inicioDate,
          fimDate,
          origem,
          totalCentavos,
          depositPercent,
          depositCentavos,
          depositExpiresAt,
        ]
      );
      appointmentId = ins.insertId;
      const [payIns] = await conn.query(
        `INSERT INTO appointment_payments
          (agendamento_id, estabelecimento_id, type, status, amount_centavos, percent, expires_at)
         VALUES (?,?,?,?,?,?,?)`,
        [
          appointmentId,
          estabelecimento_id,
          'deposit',
          'pending',
          depositCentavos,
          depositPercent,
          depositExpiresAt,
        ]
      );
      depositPaymentId = payIns.insertId;
    } else {
      const [ins] = await conn.query(
        `INSERT INTO agendamentos
          (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, origem, public_confirm_token_hash,
           public_confirm_expires_at, public_confirmed_at, total_centavos)
         VALUES (?,?,?,?,?,?, 'confirmado', ?, NULL, NULL, NOW(), ?)`,
        [userId, estabelecimento_id, primaryServiceId, profissional_id || null, inicioDate, fimDate, origem, totalCentavos]
      );
      appointmentId = ins.insertId;
    }
    const itemValues = serviceItems.map((item, idx) => {
      const precoSnapshot = Math.max(0, Math.round(item.preco_centavos || 0));
      if (precoSnapshot <= 0) {
        console.warn('[agendamentos_public][preco_snapshot_zero]', {
          estabelecimento_id,
          servico_id: item.id,
          preco_centavos: item.preco_centavos,
        });
      }
      return [
        appointmentId,
        item.id,
        idx + 1,
        Math.max(0, Math.round(item.duracao_min || 0)),
        precoSnapshot,
      ];
    });
    if (itemValues.length) {
      const placeholders = itemValues.map(() => '(?,?,?,?,?)').join(',');
      await conn.query(
        `INSERT INTO agendamento_itens (agendamento_id, servico_id, ordem, duracao_min, preco_snapshot) VALUES ${placeholders}`,
        itemValues.flat()
      );
    }

    const totalCentavosFinal = itemValues.reduce((sum, item) => sum + Number(item[4] || 0), 0);
    if (!Number.isFinite(totalCentavosFinal) || totalCentavosFinal <= 0) {
      if (txStarted && conn) {
        await conn.rollback();
      }
      txStarted = false;
      if (conn) conn.release();
      return res.status(400).json({
        error: 'invalid_total',
        message: 'Serviço sem preço configurado',
      });
    }

    let depositCentavosFinal = depositCentavos;
    if (depositRequired) {
      depositCentavosFinal = Math.ceil(totalCentavosFinal * (depositPercent || 0) / 100);
      if (!Number.isFinite(depositCentavosFinal) || depositCentavosFinal <= 0) {
        if (txStarted && conn) {
          await conn.rollback();
        }
        txStarted = false;
        if (conn) conn.release();
        return res.status(400).json({
          error: 'invalid_total',
          message: 'Serviço sem preço configurado',
        });
      }
    }

    if (depositRequired) {
      await conn.query(
        `UPDATE agendamentos
            SET total_centavos=?,
                deposit_centavos=?
          WHERE id=?`,
        [totalCentavosFinal, depositCentavosFinal, appointmentId]
      );
      await conn.query(
        `UPDATE appointment_payments
            SET amount_centavos=?,
                percent=?
          WHERE id=?`,
        [depositCentavosFinal, depositPercent, depositPaymentId]
      );
    } else {
      await conn.query(
        'UPDATE agendamentos SET total_centavos=? WHERE id=?',
        [totalCentavosFinal, appointmentId]
      );
    }

    await conn.commit();
    txStarted = false;
    conn.release(); conn = null;

    if (depositRequired) {
      const expiresIso = depositExpiresAt ? depositExpiresAt.toISOString() : null;
      const apiBase = resolveApiBaseUrl();
      const webhookUrl = resolveBillingWebhookUrl(apiBase);
      const externalReference = `dep:ag:${appointmentId}:pay:${depositPaymentId}:est:${estabelecimento_id}`;
      const metadata = {
        agendamento_id: String(appointmentId),
        estabelecimento_id: String(estabelecimento_id),
        type: 'deposit',
      };
      try {
        const { payment, pix } = await createMercadoPagoPixPayment({
          amountCents: depositCentavosFinal,
          description: `Sinal - ${serviceLabel}`,
          externalReference,
          metadata,
          notificationUrl: webhookUrl,
          payerEmail: emailNorm || null,
          expiresAt: depositExpiresAt,
          accessToken: mpAccessToken,
        });
        await pool.query(
          'UPDATE appointment_payments SET provider_payment_id=?, provider_reference=?, raw_payload=? WHERE id=?',
          [String(payment.id), externalReference, safeJson(payment), depositPaymentId]
        );
        return res.status(201).json({
          id: appointmentId,
          agendamentoId: appointmentId,
          status: 'pendente_pagamento',
          total_centavos: totalCentavosFinal,
          deposit_required: 1,
          deposit_percent: depositPercent,
          deposit_centavos: depositCentavosFinal,
          deposit_expires_at: expiresIso,
          paymentId: depositPaymentId,
          expiresAt: expiresIso,
          pix_qr: pix?.qr_code_base64 || null,
          pix_qr_raw: pix?.qr_code || null,
          pix_copia_cola: pix?.copia_e_cola || pix?.qr_code || null,
          pix_ticket_url: pix?.ticket_url || null,
          amount_centavos: depositCentavosFinal,
          pix,
        });
      } catch (err) {
        console.error('[public/agendamentos][deposit] erro ao criar PIX:', err?.message || err);
        const payload = safeJson({ error: err?.message || String(err) });
        await pool.query(
          'UPDATE appointment_payments SET status=?, raw_payload=? WHERE id=?',
          ['failed', payload, depositPaymentId]
        );
        await pool.query(
          "UPDATE agendamentos SET status='cancelado', deposit_expires_at=NOW() WHERE id=? AND status='pendente_pagamento'",
          [appointmentId]
        );
        return res.status(502).json({
          error: 'payment_create_failed',
          message: 'Nao foi possivel gerar o PIX do sinal. Tente novamente.',
        });
      }
    }

    // Notificacoes de confirmacao (best-effort)
    (async () => {
      try {
        await notifyPublicConfirmedAppointment(appointmentId);
      } catch {}
    })();

    return res.status(201).json({
      id: appointmentId,
      cliente_id: userId,
      estabelecimento_id,
      servico_id: primaryServiceId,
      servico_ids: summary.serviceIds,
      servico_nome: summary.serviceLabel || serviceLabel,
      servicos: serviceItems,
      duracao_total: summary.duracaoTotal,
      preco_total: summary.precoTotal,
      total_centavos: totalCentavosFinal,
      profissional_id: profissional_id || null,
      inicio: inicioDate,
      fim: fimDate,
      status: 'confirmado',
      confirm_expires_at: null,
    });
  } catch (e) {
    try { if (txStarted && conn) await conn.rollback(); } catch {}
    try { if (conn) conn.release(); } catch {}
    console.error('[public/agendamentos][POST]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET /public/agendamentos/confirm?token=...
router.get('/confirm', async (req, res) => {
  try {
    const token = String(req.query?.token || '').trim();
    if (!token) {
      return res.status(400).send(renderConfirmPage({
        title: 'Token invalido',
        message: 'Link de confirmacao invalido ou ausente.',
      }));
    }
    const tokenHash = hashToken(token);
    const [[ag]] = await pool.query(
      'SELECT id, status, public_confirm_expires_at FROM agendamentos WHERE public_confirm_token_hash=? LIMIT 1',
      [tokenHash]
    );
    if (!ag) {
      return res.status(404).send(renderConfirmPage({
        title: 'Agendamento nao encontrado',
        message: 'Este link nao e valido ou ja expirou.',
      }));
    }
    if (ag.status === 'confirmado') {
      return res.status(200).send(renderConfirmPage({
        title: 'Agendamento confirmado',
        message: 'Seu agendamento ja estava confirmado.',
      }));
    }
    if (ag.status === 'cancelado') {
      return res.status(410).send(renderConfirmPage({
        title: 'Confirmacao expirada',
        message: 'Este agendamento foi cancelado por falta de confirmacao.',
      }));
    }
    if (ag.public_confirm_expires_at && new Date(ag.public_confirm_expires_at).getTime() < Date.now()) {
      await pool.query(
        "UPDATE agendamentos SET status='cancelado' WHERE id=? AND status='pendente'",
        [ag.id]
      );
      return res.status(410).send(renderConfirmPage({
        title: 'Confirmacao expirada',
        message: 'Este agendamento foi cancelado por falta de confirmacao.',
      }));
    }

    const [r] = await pool.query(
      "UPDATE agendamentos SET status='confirmado', public_confirmed_at=NOW(), public_confirm_expires_at=NULL WHERE id=? AND status='pendente'",
      [ag.id]
    );
    if (r?.affectedRows) {
      notifyPublicConfirmedAppointment(ag.id);
    }
    return res.status(200).send(renderConfirmPage({
      title: 'Agendamento confirmado',
      message: 'Confirmacao registrada com sucesso.',
    }));
  } catch (e) {
    console.error('[public/agendamentos][confirm]', e?.message || e);
    return res.status(500).send(renderConfirmPage({
      title: 'Erro na confirmacao',
      message: 'Nao foi possivel confirmar agora. Tente novamente.',
    }));
  }
});

export default router;

