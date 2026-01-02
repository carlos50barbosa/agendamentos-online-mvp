// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded } from '../lib/plans.js';
import bcrypt from 'bcryptjs';
import { notifyEmail } from '../lib/notifications.js';
import { sendAppointmentWhatsApp } from '../lib/whatsapp_outbox.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled, whatsappConfirmationDisabled } from '../lib/client_notifications.js';
import jwt from 'jsonwebtoken';
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';

const router = Router();
const TZ = 'America/Sao_Paulo';
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
const PUBLIC_CONFIRM_MINUTES = (() => {
  const raw = process.env.PUBLIC_BOOKING_CONFIRM_MINUTES;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 10;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
})();

function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  // Janela ampla (00:00-23:59) para não bloquear horários configurados pelo estabelecimento.
  const h = d.getHours(), m = d.getMinutes();
  const afterStart = h >= 0;
  const beforeEnd = h < 24 || (h === 23 && m <= 59);
  return afterStart && beforeEnd;
}

const DAY_SLUG_TO_INDEX = Object.freeze({
  sunday: 0,
  sundayfeira: 0,
  sun: 0,
  domingo: 0,
  domingofeira: 0,
  dom: 0,
  monday: 1,
  mondayfeira: 1,
  mon: 1,
  segunda: 1,
  segundafeira: 1,
  seg: 1,
  tuesday: 2,
  tuesdayfeira: 2,
  tue: 2,
  terca: 2,
  tercafeira: 2,
  ter: 2,
  wednesday: 3,
  wednesdayfeira: 3,
  wed: 3,
  quarta: 3,
  quartafeira: 3,
  qua: 3,
  thursday: 4,
  thursdayfeira: 4,
  thu: 4,
  quinta: 4,
  quintafeira: 4,
  qui: 4,
  friday: 5,
  fridayfeira: 5,
  fri: 5,
  sexta: 5,
  sextafeira: 5,
  sex: 5,
  saturday: 6,
  saturdayfeira: 6,
  sat: 6,
  sabado: 6,
  sabadofeira: 6,
  sab: 6,
});

const normalizeDayKey = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
};

const resolveDayIndex = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.day,
    item.key,
    item.weekday,
    item.week_day,
    item.dia,
    item.label,
  ];
  if (item.value) {
    candidates.push(item.value);
    const firstChunk = String(item.value).split(/[\s,;-]+/)[0];
    candidates.push(firstChunk);
  }

  for (const candidate of candidates) {
    const normalized = normalizeDayKey(candidate);
    if (!normalized) continue;
    if (Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, normalized)) {
      return DAY_SLUG_TO_INDEX[normalized];
    }
  }
  return null;
};

const ensureTimeValue = (value) => {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;
  const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 2) {
    const hours = Number(digits);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
    return `${String(hours).padStart(2, '0')}:00`;
  }
  const hoursDigits = digits.slice(0, -2);
  const minutesDigits = digits.slice(-2);
  const hoursNum = Number(hoursDigits);
  const minutesNum = Number(minutesDigits);
  if (
    !Number.isInteger(hoursNum) ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    !Number.isInteger(minutesNum) ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return null;
  }
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
};

const toMinutes = (time) => {
  if (!time) return null;
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
};

const buildWorkingRules = (horariosJson) => {
  if (!horariosJson) return null;
  let entries;
  try {
    entries = JSON.parse(horariosJson);
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || !entries.length) return null;
  const rules = Array.from({ length: 7 }, () => ({
    enabled: false,
    startMinutes: null,
    endMinutes: null,
    breaks: [],
  }));
  let recognized = false;

  entries.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const idx = resolveDayIndex(item);
    if (idx == null) return;
    if (rules[idx].processed) return;

    const valueText = String(item.value ?? '').toLowerCase();
    if (
      valueText.includes('fechado') ||
      valueText.includes('sem atendimento') ||
      valueText.includes('nao atende')
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? null);
    const end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? null);
    if (!start || !end) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);
    if (
      startMinutes == null ||
      endMinutes == null ||
      startMinutes >= endMinutes
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const rawBlocks = Array.isArray(item.blocks)
      ? item.blocks
      : Array.isArray(item.breaks)
      ? item.breaks
      : [];

    const breaks = [];
    rawBlocks.forEach((block) => {
      if (!block) return;
      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? null);
      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? null);
      const blockStartMinutes = toMinutes(blockStart);
      const blockEndMinutes = toMinutes(blockEnd);
      if (
        blockStartMinutes == null ||
        blockEndMinutes == null ||
        blockStartMinutes >= blockEndMinutes ||
        blockStartMinutes < startMinutes ||
        blockEndMinutes > endMinutes
      ) {
        return;
      }
      breaks.push([blockStartMinutes, blockEndMinutes]);
    });

    rules[idx] = {
      enabled: true,
      startMinutes,
      endMinutes,
      breaks,
      processed: true,
    };
    recognized = true;
  });

  if (!recognized) return null;
  return rules.map((rule) => {
    if (!rule.processed) {
      return { enabled: false, startMinutes: null, endMinutes: null, breaks: [] };
    }
    const { processed, ...rest } = rule;
    return rest;
  });
};

const isWithinWorkingHours = (startDate, endDate, workingRules) => {
  if (!workingRules) return true;
  const rule = workingRules[startDate.getDay()];
  if (!rule || !rule.enabled) return false;
  const sameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate();
  if (!sameDay) return false;
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
  if (startMinutes < rule.startMinutes) return false;
  if (endMinutes > rule.endMinutes) return false;
  if (Array.isArray(rule.breaks) && rule.breaks.some(([start, end]) => startMinutes >= start && startMinutes < end)) {
    return false;
  }
  return true;
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

const PUBLIC_CONFIRM_TTL_MS = PUBLIC_CONFIRM_MINUTES * 60_000;
const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');
const createConfirmToken = () => crypto.randomBytes(32).toString('hex');
const buildConfirmLink = (token) => `${API_BASE}/public/agendamentos/confirm?token=${token}`;
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

async function sendPublicConfirmEmail({ email, nome, servicoNome, inicioISO, profNome, confirmToken }) {
  if (!email || !confirmToken) return;
  const inicioBR = brDateTime(inicioISO);
  const profLabel = profNome ? ` com ${profNome}` : '';
  const confirmLink = buildConfirmLink(confirmToken);
  const html = `
    <p>Ola, <b>${firstName(nome) || 'cliente'}</b>!</p>
    <p>Confirme seu agendamento de <b>${servicoNome}</b>${profLabel} para <b>${inicioBR}</b>.</p>
    <p><a href="${confirmLink}">Confirmar agendamento</a></p>
    <p class="muted">Este link expira em ${PUBLIC_CONFIRM_MINUTES} minutos.</p>
  `;
  await notifyEmail(String(email).trim().toLowerCase(), 'Confirme seu agendamento', html);
}

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
    const [[svc]] = await pool.query('SELECT nome FROM servicos WHERE id=?', [ag.servico_id]);
    if (!svc) return;
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
          `<p>Ola, <b>{{cliente_nome}}</b>! Seu agendamento de <b>{{servico_nome}}</b>{{profissional_nome}} foi confirmado para <b>{{data_hora}}</b>.</p>`;
        const hasLinkPlaceholder = /{{\s*link_agendamento\s*}}/i.test(rawTemplate);
        let html = rawTemplate
          .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente')
          .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
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
          if (/^triple|3$/.test(paramMode)) {
          await sendAppointmentWhatsApp({
            estabelecimentoId: ag.estabelecimento_id,
            agendamentoId: ag.id,
            to: telCli,
            kind: 'confirm_cli',
            template: { name: tplName, lang: tplLang, bodyParams: [svc.nome, inicioBR, est?.nome || ''] },
          });
        } else {
          const waMsg = (tmpl.wa_template || `Novo agendamento registrado: {{servico_nome}} em {{data_hora}} - {{estabelecimento_nome}}.`)
            .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente')
            .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
            .replace(/{{\s*data_hora\s*}}/g, inicioBR)
            .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '')
            .replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com ${profNome}` : '');
          await sendAppointmentWhatsApp({
            estabelecimentoId: ag.estabelecimento_id,
            agendamentoId: ag.id,
            to: telCli,
            kind: 'confirm_cli',
            message: waMsg,
          });
        }
      }
    } catch {}

    try {
      if (!blockWhatsappImmediate && !blockWhatsappConfirmation && !blockEstabNotifications && canWhatsappEst && telEst && telEst !== telCli) {
        await sendAppointmentWhatsApp({
          estabelecimentoId: ag.estabelecimento_id,
          agendamentoId: ag.id,
          to: telEst,
          kind: 'confirm_est',
          message: `Novo agendamento: ${svc.nome}${profLabel} em ${inicioBR} - Cliente: ${String(ag.cliente_nome) || ''}`,
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
  try {
    const {
      estabelecimento_id,
      servico_id,
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

    if (!estabelecimento_id || !servico_id || !inicio || !nome || !email || !telefone) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Campos obrigatorios: estabelecimento_id, servico_id, inicio, nome, email, telefone.' });
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
    if (!inBusinessHours(inicioDate.toISOString())) return res.status(400).json({ error: 'outside_business_hours' });

    // valida servico/estab
    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) return res.status(400).json({ error: 'servico_invalido' });

    const [serviceProfessionals] = await pool.query(
      'SELECT profissional_id FROM servico_profissionais WHERE servico_id=?',
      [servico_id]
    );
    const linkedProfessionalIds = serviceProfessionals.map((row) => row.profissional_id);
    let profissionalRow = null;

    if (linkedProfessionalIds.length && profissional_id == null) {
      return res.status(400).json({ error: 'profissional_obrigatorio', message: 'Escolha um profissional para este servico.' });
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
      if (linkedProfessionalIds.length && !linkedProfessionalIds.includes(profissional_id)) {
        return res.status(400).json({ error: 'profissional_servico', message: 'Profissional nao esta associado a este servico.' });
      }
      profissionalRow = profRow;
    }

    const dur = Number(svc.duracao_min || 0);
    if (!Number.isFinite(dur) || dur <= 0) return res.status(400).json({ error: 'duracao_invalida' });
    const fimDate = new Date(inicioDate.getTime() + dur * 60_000);
    let workingRules = null;
    try {
      const [[profile]] = await pool.query(
        'SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1',
        [estabelecimento_id]
      );
      workingRules = buildWorkingRules(profile?.horarios_json || null);
    } catch {}
    if (!isWithinWorkingHours(inicioDate, fimDate, workingRules)) {
      return res.status(400).json({ error: 'outside_business_hours', message: 'Horário fora do expediente do estabelecimento.' });
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

    let conflictSql = `SELECT id FROM agendamentos
       WHERE estabelecimento_id=? AND status IN ('confirmado','pendente')
         AND (status <> 'pendente' OR public_confirm_expires_at IS NULL OR public_confirm_expires_at >= NOW())
         AND (inicio < ? AND fim > ?)`;
    const conflictParams = [estabelecimento_id, fimDate, inicioDate];
    if (profissional_id != null && linkedProfessionalIds.length) {
      conflictSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
      conflictParams.push(profissional_id);
    }
    conflictSql += ' FOR UPDATE';
    const [conf] = await conn.query(conflictSql, conflictParams);
    if (conf.length) { await conn.rollback(); conn.release(); return res.status(409).json({ error: 'slot_ocupado' }); }

    const confirmToken = createConfirmToken();
    const confirmTokenHash = hashToken(confirmToken);
    const confirmExpiresAt = new Date(Date.now() + PUBLIC_CONFIRM_TTL_MS);
    const [ins] = await conn.query(
      `INSERT INTO agendamentos
        (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, public_confirm_token_hash, public_confirm_expires_at)
       VALUES (?,?,?,?,?,?, 'pendente', ?, ?)`,
      [userId, estabelecimento_id, servico_id, profissional_id || null, inicioDate, fimDate, confirmTokenHash, confirmExpiresAt]
    );

    await conn.commit(); conn.release(); conn = null;

    // Email de confirmacao (best-effort)
    const inicioISO = new Date(inicioDate).toISOString();
    const profNome = profissionalRow?.nome || '';
    (async () => {
      try {
        await sendPublicConfirmEmail({
          email: emailNorm,
          nome,
          servicoNome: svc.nome,
          inicioISO,
          profNome,
          confirmToken,
        });
      } catch {}
    })();

    return res.status(201).json({
      id: ins.insertId,
      cliente_id: userId,
      estabelecimento_id,
      servico_id,
      profissional_id: profissional_id || null,
      inicio: inicioDate,
      fim: fimDate,
      status: 'pendente',
      confirm_expires_at: confirmExpiresAt,
    });
  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
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
