// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db.js';
import { assertDentroExpediente, formatExpedienteMessage, getExpediente, getLocalRangeMinutes } from '../lib/expediente.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded, planAllowsDeposit } from '../lib/plans.js';
import bcrypt from 'bcryptjs';
import { notifyEmail } from '../lib/notifications.js';
import { sendAppointmentWhatsApp, WA_AUDIENCE_ESTABLISHMENT } from '../lib/whatsapp_outbox.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from '../lib/whatsapp_templates.js';
import { createMercadoPagoPixPayment } from '../lib/billing.js';
import { resolveMpAccessToken } from '../services/mpAccounts.js';
import { resolveDepositProvider, createAsaasDepositPixPayment } from '../lib/deposit_provider.js';
import { config } from '../lib/config.js';
import { computeSignalTotalCents, computeSplitCents, SignalTooLowError } from '../lib/signal_calculator.js';
import { ensureSubscriptionOperationalAccess } from '../middleware/billing.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled, whatsappConfirmationDisabled } from '../lib/client_notifications.js';
// Nota: esta rota NÃO importa mais grantWhatsAppConsent. Consentimento de cliente não nasce de um
// clique numa rota pública sem login — só do "AUTORIZO" enviado do próprio número. Ver o bloco
// "NÃO gravamos consentimento" abaixo.
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';
import {
  extractPixPayloadFromRaw,
  fetchPendingDepositPayment,
  isExpiredAt,
  markDepositPaymentExpired,
} from '../lib/deposit_payments.js';
import { buildPublicDepositToken, verifyPublicDepositToken } from '../lib/public_deposit_token.js';
import { applyClientLoyaltyBenefitsTx, previewClientLoyaltyBenefits } from '../lib/client_loyalty_credits.js'
import { cancelPendingPaymentAppointmentTx, cancelPublicPendingAppointmentTx } from '../lib/appointment_loyalty.js'
import { checkAppointmentSlotCapacityTx, normalizeServiceSlotCapacity } from '../lib/service_capacity.js';
import { normalizePhoneBR, toDigits, isValidMobileBR } from '../lib/phone_br.js';

const router = Router();
const TZ = 'America/Sao_Paulo';
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const APPOINTMENT_BUFFER_MIN = (() => {
  const raw = process.env.AGENDAMENTO_BUFFER_MIN ?? process.env.APPOINTMENT_BUFFER_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
// Antecedência mínima (min) para agendar — consistente com a grade de slots.
// Default 0 = rejeita apenas horário já passado (comportamento atual inalterado).
const MIN_LEAD_MIN = (() => {
  const raw = process.env.AGENDAMENTO_MIN_LEAD_MIN ?? process.env.SLOT_MIN_LEAD_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;

// E-mail é opcional no agendamento público: nome + telefone bastam. Como usuarios.email é
// NOT NULL UNIQUE, o cadastro sem e-mail recebe um placeholder determinístico pelo telefone —
// preserva a unicidade sem inventar um endereço que possa colidir com o de outra pessoa. Nunca é
// um e-mail real: as rotinas de envio o reconhecem pelo domínio e caem para o outro canal (nada
// de bounce nem de cobrança por template enviado a lugar nenhum).
const GUEST_PLACEHOLDER_EMAIL_DOMAIN = 'sem-email.agendou.local';
const isPlaceholderGuestEmail = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${GUEST_PLACEHOLDER_EMAIL_DOMAIN}`);
const buildPlaceholderGuestEmail = (phoneKey) =>
  `guest-${phoneKey}@${GUEST_PLACEHOLDER_EMAIL_DOMAIN}`;
const isValidEmailFormat = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const safeJson = (payload) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
};

const safeJsonParse = (payload) => {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

function buildDepositPixPayload(paymentRow) {
  if (!paymentRow) return null;
  const pix = extractPixPayloadFromRaw(paymentRow.raw_payload, paymentRow.amount_centavos);
  if (!pix) return null;
  const expiresIso = paymentRow.expires_at ? new Date(paymentRow.expires_at).toISOString() : null;
  return {
    paymentId: paymentRow.id,
    expiresAt: expiresIso,
    amountCents: paymentRow.amount_centavos,
    pix,
  };
}

function attachDepositPixToResponse(target, paymentRow, payload) {
  if (!target || !paymentRow || !payload) return;
  const expiresIso = payload.expiresAt || (paymentRow.expires_at ? new Date(paymentRow.expires_at).toISOString() : null);
  target.paymentId = paymentRow.id;
  target.expiresAt = expiresIso;
  target.deposit_expires_at = expiresIso;
  target.amount_centavos = paymentRow.amount_centavos;
  target.pix = payload.pix;
  target.deposit = {
    payment_id: paymentRow.id,
    amount_centavos: paymentRow.amount_centavos,
    expires_at: expiresIso,
    pix: payload.pix,
  };
}

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
  const allowed = planAllowsDeposit(planContext?.plan);
  if (!allowed) {
    return { allowed: false, enabled: false, percent: null, holdMinutes: DEFAULT_DEPOSIT_HOLD_MINUTES, signalConfig: null, walletId: null };
  }
  const [rows] = await pool.query(
    `SELECT deposit_enabled, deposit_percent, deposit_hold_minutes,
            deposit_type, deposit_fixed_centavos, deposit_min_centavos, deposit_max_centavos,
            asaas_wallet_id
       FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1`,
    [estabelecimentoId]
  );
  const row = rows?.[0];
  const enabledFlag = row ? Number(row.deposit_enabled || 0) : 0;
  const percent = row?.deposit_percent != null ? Number(row.deposit_percent) : null;
  const type = String(row?.deposit_type || 'PERCENT').toUpperCase();
  const fixedCents = row?.deposit_fixed_centavos != null ? Number(row.deposit_fixed_centavos) : null;
  const minCents = row?.deposit_min_centavos != null ? Number(row.deposit_min_centavos) : null;
  const maxCents = row?.deposit_max_centavos != null ? Number(row.deposit_max_centavos) : null;
  const holdMinutes = Number(row?.deposit_hold_minutes || DEFAULT_DEPOSIT_HOLD_MINUTES) || DEFAULT_DEPOSIT_HOLD_MINUTES;
  const signalConfig = { type, percent, fixedCents, minCents, maxCents };
  const hasValue = type === 'FIXED' ? (Number.isFinite(fixedCents) && fixedCents > 0) : (Number.isFinite(percent) && percent > 0);
  const enabled = Boolean(enabledFlag) && hasValue;
  const walletId = row?.asaas_wallet_id ? String(row.asaas_wallet_id) : null;
  return { allowed: true, enabled, percent, holdMinutes, signalConfig, walletId };
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

const buildLoyaltyPricingMap = (loyaltyApplication) => {
  const map = new Map();
  const items = Array.isArray(loyaltyApplication?.items) ? loyaltyApplication.items : [];
  items.forEach((item) => {
    const serviceId = Number(item?.servico_id || 0);
    if (!serviceId) return;
    map.set(serviceId, item);
  });
  return map;
};

const serializeAppointmentServiceItems = (items, loyaltyApplication = null) => {
  const pricing = buildLoyaltyPricingMap(loyaltyApplication);
  return (Array.isArray(items) ? items : []).map((item, idx) => {
    const benefit = pricing.get(Number(item.id));
    const precoSnapshot = Math.max(
      0,
      Math.round(Number(benefit?.cobrado_centavos ?? item.preco_centavos ?? item.preco_snapshot ?? 0) || 0)
    );
    return {
      id: item.id,
      nome: item.nome,
      duracao_min: item.duracao_min,
      preco_centavos_snapshot: precoSnapshot,
      preco_snapshot: precoSnapshot,
      ordem: idx + 1,
      loyalty_benefit_type: benefit?.benefit_type || 'full',
      loyalty_discount_percent: benefit?.discount_percent ?? null,
    };
  });
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
    `SELECT id, nome, duracao_min, preco_centavos, capacidade_por_horario
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
      capacidade_por_horario: normalizeServiceSlotCapacity(svc.capacidade_por_horario),
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
    const serviceLabel = summary.serviceLabel || serviceItems[0]?.nome || 'serviço';
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
      // Placeholder de guest sem e-mail não é endereço real — pular o envio (a confirmação vai por
      // WhatsApp quando houve opt-in). Ver buildPlaceholderGuestEmail.
      if (emailNorm && !isPlaceholderGuestEmail(emailNorm)) {
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
          audience: WA_AUDIENCE_ESTABLISHMENT,
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
router.post('/', ensureSubscriptionOperationalAccess({
  getEstabelecimentoId: (req) => req.body?.estabelecimento_id || req.body?.establishment_id || null,
  message: 'Este estabelecimento está com a assinatura indisponível para novos agendamentos no momento.',
}), async (req, res) => {
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
      cpf,
      cpf_cnpj,
      whatsapp_optin,
      whatsappOptin,
    } = req.body || {};

    // Só `true` (ou o "true"/"1" que um form manda) autoriza. Qualquer outra coisa — ausente,
    // null, string vazia — é "não autorizou". Consentimento não se infere.
    const optInRaw = whatsapp_optin ?? whatsappOptin;
    const whatsappOptIn = optInRaw === true || optInRaw === 'true' || optInRaw === 1 || optInRaw === '1';

    const professionalCandidate = profissionalIdRaw != null ? profissionalIdRaw : profissionalId;
    const profissional_id = professionalCandidate == null ? null : Number(professionalCandidate);
    if (profissional_id !== null && !Number.isFinite(profissional_id)) {
      return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional inválido.' });
    }

    const serviceIds = extractServiceIds(req.body || {});
    // E-mail saiu da lista de obrigatórios: nome + telefone bastam. Quando informado, ele ainda é
    // validado e usado; quando não, o cliente ganha um e-mail placeholder (ver abaixo).
    if (!estabelecimento_id || !serviceIds.length || !inicio || !nome || !telefone) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Campos obrigatórios: estabelecimento_id, servico_ids, inicio, nome, telefone.'
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
    const cpfDigits = String(cpf ?? cpf_cnpj ?? '').replace(/\D/g, '');
    if (dataNascimentoRaw && String(dataNascimentoRaw).trim() && !dataNascimentoValue) {
      return res.status(400).json({ error: 'data_nascimento_invalida', message: 'Informe uma data de nascimento válida.' });
    }
    if (cepDigits && cepDigits.length !== 8) {
      return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP válido com 8 dígitos.' });
    }
    if (estadoTrim && !/^[A-Z]{2}$/.test(estadoTrim)) {
      return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
    }

    const planContext = await getPlanContext(estabelecimento_id);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) return res.status(400).json({ error: 'invalid_date' });
    if (inicioDate.getTime() <= Date.now() + MIN_LEAD_MIN * 60_000) {
      return res.status(400).json({ error: 'past_datetime', message: 'Escolha um horário futuro.' });
    }

    const { items: serviceItems, missing } = await fetchServicesForAppointment(pool, estabelecimento_id, serviceIds);
    if (missing.length) {
      return res.status(400).json({ error: 'servico_invalido', message: 'Serviço inválido ou inativo para este estabelecimento.' });
    }
    if (serviceItems.some((item) => !Number.isFinite(item.duracao_min) || item.duracao_min <= 0)) {
      return res.status(400).json({ error: 'duracao_invalida' });
    }
    const summary = summarizeServices(serviceItems);
    const primaryServiceId = summary.serviceIds[0] || serviceIds[0];
    const serviceLabel = summary.serviceLabel || serviceItems[0]?.nome || 'serviço';
    const totalCentavos = serviceItems.reduce(
      (sum, item) => sum + Math.max(0, Math.round(Number(item?.preco_centavos || 0))),
      0
    );

    const professionalMap = await fetchServiceProfessionalMap(pool, summary.serviceIds);
    const servicesRequiringProfessional = summary.serviceIds.filter((id) => (professionalMap.get(id)?.size || 0) > 0);
    const requiresProfessional = servicesRequiringProfessional.length > 0;

    if (requiresProfessional && profissional_id == null) {
      return res.status(400).json({ error: 'profissional_obrigatorio', message: 'Escolha um profissional para estes serviços.' });
    }

    if (profissional_id != null) {
      const [[profRow]] = await pool.query(
        'SELECT id, nome, avatar_url, ativo FROM profissionais WHERE id=? AND estabelecimento_id=?',
        [profissional_id, estabelecimento_id]
      );
      if (!profRow) {
        return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional não encontrado para este estabelecimento.' });
      }
      if (!profRow.ativo) {
        return res.status(400).json({ error: 'profissional_inativo', message: 'Profissional inativo.' });
      }
      if (requiresProfessional) {
        const valid = servicesRequiringProfessional.every((id) => professionalMap.get(id)?.has(profissional_id));
        if (!valid) {
          return res.status(400).json({ error: 'profissional_servico', message: 'Profissional não está associado a todos os serviços selecionados.' });
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
        message: formatPlanLimitExceeded(planConfig, 'appointments') || 'Limite de agendamentos atingido para este mês.',
        details: { limit: limitCheck.limit, total: limitCheck.total, month: limitCheck.range?.label || null },
      });
    }

    const emailInput = String(email ?? '').trim().toLowerCase();
    if (emailInput && !isValidEmailFormat(emailInput)) {
      return res.status(400).json({ error: 'email_invalido', message: 'Informe um e-mail válido ou deixe o campo em branco.' });
    }
    const emailProvided = emailInput.length > 0;
    // emailNorm = e-mail real e contactável, ou null quando o cliente não informou. O downstream
    // (Asaas/MP/confirmação por e-mail) já trata null como "sem e-mail" e cai para o WhatsApp.
    const emailNorm = emailProvided ? emailInput : null;
    const telDigits = toDigits(telefone);
    const telNorm = normalizePhoneBR(telefone);
    // Com o e-mail opcional, o telefone vira a âncora de identidade, a chave do e-mail placeholder E
    // — na prática — o único canal de contato de quem não deu e-mail. Por isso exigimos CELULAR
    // (isValidMobileBR), não só um telefone normalizável: um fixo não recebe WhatsApp e, sem e-mail,
    // deixaria o cliente inalcançável. isValidMobileBR já rejeita o não-normalizável, então telNorm
    // é truthy quando ele passa. O front espelha; aqui também pega o acesso direto à API.
    if (!isValidMobileBR(telefone)) {
      return res.status(400).json({ error: 'telefone_invalido', message: 'Informe um número de celular válido com DDD.' });
    }

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
    const depositProvider = resolveDepositProvider();
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
      depositCentavos = computeSignalTotalCents({
        servicePriceCents: totalCentavos,
        config: depositConfig.signalConfig,
        systemMinCents: depositProvider === 'asaas' ? config.signal.minCents : 0,
      });
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
      if (depositProvider === 'asaas') {
        // O Asaas exige CPF/CNPJ do pagador para gerar o PIX (guest não tem no perfil).
        if (!(cpfDigits.length === 11 || cpfDigits.length === 14)) {
          return res.status(400).json({
            error: 'cpf_required_for_deposit',
            message: 'Informe seu CPF para pagar o sinal via PIX.',
          });
        }
        // Com split exige walletId; no fallback de conta única (splitDisabled) nada disso se aplica.
        if (!config.signal.splitDisabled) {
          if (!depositConfig.walletId) {
            return res.status(409).json({
              error: 'asaas_not_connected_for_deposit',
              message: 'Cadastre seu Wallet ID do Asaas para receber o sinal.',
            });
          }
          try {
            computeSplitCents({
              totalCents: depositCentavos,
              platformFeeCents: config.signal.platformFeeCents,
              asaasFeeEstimateCents: config.signal.asaasPixFeeCents,
            });
          } catch (err) {
            if (err instanceof SignalTooLowError) {
              return res.status(400).json({
                error: 'signal_too_low',
                message: 'O valor do sinal é muito baixo para cobrir a taxa do PIX.',
              });
            }
            throw err;
          }
        }
      } else {
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
    }
    let depositRequired = Boolean(depositEnabled && Number.isFinite(depositCentavos) && depositCentavos > 0);
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
    if (emailProvided) {
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
        message: 'Já existe cliente com este e-mail ou telefone. Revise os dados antes de continuar.',
      });
    }
    // Reaproveita o cadastro encontrado por e-mail OU telefone (um único match).
    // O campo divergente (telefone) é atualizado no bloco de UPDATE abaixo. Só há
    // bloqueio quando e-mail e telefone apontam para dois cadastros DIFERENTES
    // (ambíguo) — tratado logo acima. Assim um cliente que trocou de número não é
    // barrado no agendamento público.
    const existingUser = userByEmail || userByPhone;
    if (existingUser) {
      userId = existingUser.id;
    }
    if (!userId) {
      const hash = await bcrypt.hash(Math.random().toString(36), 10);
      // Sem e-mail informado, grava um placeholder único por telefone (email é NOT NULL UNIQUE).
      const emailForRecord = emailNorm || buildPlaceholderGuestEmail(telNorm);
      const [r] = await pool.query(
        "INSERT INTO usuarios (nome, email, telefone, cpf_cnpj, data_nascimento, cep, endereco, numero, complemento, bairro, cidade, estado, senha_hash, tipo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'cliente')",
        [
          String(nome).slice(0,120),
          emailForRecord,
          telNorm || null,
          cpfDigits || null,
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
        // Cliente que existia só com telefone (e-mail placeholder) e agora informou um e-mail real:
        // captura o e-mail. O lookup por e-mail acima retornou vazio (!userByEmail), então ele não
        // pertence a outra pessoa — sem risco de colidir na UNIQUE(email).
        if (emailProvided && !userByEmail && isPlaceholderGuestEmail(existingUser.email)) {
          updates.push('email=?');
          params.push(emailNorm);
        }
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

    // NÃO gravamos consentimento de WhatsApp aqui — e isto é a correção de um buraco que custou a
    // conta DUAS vezes.
    //
    // Esta rota é PÚBLICA e SEM LOGIN: qualquer pessoa na internet pode digitar o telefone de um
    // estranho e marcar a caixa. Gravar o aceite a partir disso é gravar um consentimento forjado —
    // e o pior tipo, porque a vítima recebe um template de confirmação NA HORA. Foi exatamente esse
    // o padrão do abuso (cadastro falso com número alheio → denúncia → banimento).
    //
    // O consentimento do cliente só nasce de um lugar: a mensagem "AUTORIZO" enviada DO PRÓPRIO
    // número (whatsapp/inbound/optInConfirm.js). Ninguém envia do WhatsApp de um estranho. A caixa
    // aqui é só INTENÇÃO: a confirmação deste agendamento vai por e-mail, e a tela de sucesso
    // oferece o link do AUTORIZO para quem quiser ligar o WhatsApp.
    //
    // `whatsappOptIn` segue sendo lido do corpo só para não quebrar clientes antigos da API; não
    // tem mais efeito de gravar aceite.
    void whatsappOptIn;

    const loyaltyPreview = await previewClientLoyaltyBenefits({
      clienteId: userId,
      estabelecimentoId: estabelecimento_id,
      serviceItems,
      appointmentAt: inicioDate,
    });
    const totalCentavosPreview = Math.max(
      0,
      Math.round(Number(loyaltyPreview?.total_cobrado_centavos ?? totalCentavos ?? 0) || 0)
    );
    if (depositEnabled) {
      depositCentavos = Math.ceil(totalCentavosPreview * (depositPercent || 0) / 100);
    }
    depositRequired = Boolean(
      depositEnabled &&
      Number.isFinite(totalCentavosPreview) &&
      totalCentavosPreview > 0 &&
      Number.isFinite(depositCentavos) &&
      depositCentavos > 0
    );
    if (!depositRequired) {
      depositCentavos = null;
      depositExpiresAt = null;
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const capacityCheck = await checkAppointmentSlotCapacityTx({
      db: conn,
      estabelecimentoId: estabelecimento_id,
      serviceItems,
      profissionalId: profissional_id,
      requiresProfessional,
      inicioDate,
      fimDate,
    });
    if (!capacityCheck.ok) {
      if (txStarted && conn) {
        await conn.rollback();
      }
      conn.release();
      return res.status(409).json({
        error: capacityCheck.error,
        message: capacityCheck.message,
      });
    }

    const origem = 'public';
    const loyaltyApplication = await applyClientLoyaltyBenefitsTx({
      db: conn,
      clienteId: userId,
      estabelecimentoId: estabelecimento_id,
      serviceItems,
      appointmentAt: inicioDate,
    });
    const loyaltySnapshotJson = loyaltyApplication?.snapshot ? safeJson(loyaltyApplication.snapshot) : null;

    let appointmentId = null;
    let depositPaymentId = null;
    if (depositRequired) {
      const [ins] = await conn.query(
        `INSERT INTO agendamentos
          (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, origem, total_centavos,
           deposit_required, deposit_percent, deposit_centavos, deposit_expires_at,
           loyalty_subscription_id, loyalty_credit_applied, loyalty_discount_percent, loyalty_benefit_snapshot_json)
         VALUES (?,?,?,?,?,?, 'pendente_pagamento', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          estabelecimento_id,
          primaryServiceId,
          profissional_id || null,
          inicioDate,
          fimDate,
          origem,
          totalCentavosPreview,
          depositPercent,
          depositCentavos,
          depositExpiresAt,
          loyaltyApplication?.subscription?.id || null,
          loyaltyApplication?.loyalty_credit_applied ? 1 : 0,
          loyaltyApplication?.loyalty_discount_percent ?? null,
          loyaltySnapshotJson,
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
           public_confirm_expires_at, public_confirmed_at, total_centavos,
           loyalty_subscription_id, loyalty_credit_applied, loyalty_discount_percent, loyalty_benefit_snapshot_json)
         VALUES (?,?,?,?,?,?, 'confirmado', ?, NULL, NULL, NOW(), ?, ?, ?, ?, ?)`,
        [
          userId,
          estabelecimento_id,
          primaryServiceId,
          profissional_id || null,
          inicioDate,
          fimDate,
          origem,
          totalCentavosPreview,
          loyaltyApplication?.subscription?.id || null,
          loyaltyApplication?.loyalty_credit_applied ? 1 : 0,
          loyaltyApplication?.loyalty_discount_percent ?? null,
          loyaltySnapshotJson,
        ]
      );
      appointmentId = ins.insertId;
    }
    const loyaltyPricing = buildLoyaltyPricingMap(loyaltyApplication);
    const itemValues = serviceItems.map((item, idx) => {
      const benefit = loyaltyPricing.get(Number(item.id));
      const precoSnapshot = Math.max(0, Math.round((benefit?.cobrado_centavos ?? item.preco_centavos ?? 0)));
      if (precoSnapshot <= 0) {
        console.warn('[agendamentos_public][preco_snapshot_zero]', {
          estabelecimento_id,
          servico_id: item.id,
          preco_centavos: item.preco_centavos,
          loyalty_benefit_type: benefit?.benefit_type || null,
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

    const [[totalRow]] = await conn.query(
      'SELECT COALESCE(SUM(preco_snapshot), 0) AS total_centavos FROM agendamento_itens WHERE agendamento_id=?',
      [appointmentId]
    );
    const totalCentavosFinal = Number(totalRow?.total_centavos || 0);
    console.info('[public/agendamento][total]', { appointmentId, totalCentavosFinal });
    if (
      !Number.isFinite(totalCentavosFinal) ||
      totalCentavosFinal < 0 ||
      (
        totalCentavosFinal === 0 &&
        !loyaltyApplication?.loyalty_credit_applied &&
        loyaltyApplication?.loyalty_discount_percent == null
      )
    ) {
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
      depositCentavosFinal = computeSignalTotalCents({
        servicePriceCents: totalCentavosFinal,
        config: depositConfig.signalConfig,
        systemMinCents: depositProvider === 'asaas' ? config.signal.minCents : 0,
      });
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

      // Sinal via Asaas (flag DEPOSIT_PROVIDER=asaas) — mesmo desenho da rota autenticada.
      if (depositProvider === 'asaas') {
        const externalReference = `deposit:${depositPaymentId}`;
        const splitDisabled = config.signal.splitDisabled;
        const platformFeeCents = config.signal.platformFeeCents;
        const asaasFeeEstimateCents = config.signal.asaasPixFeeCents;
        let splitCents = null;
        if (!splitDisabled) {
          try {
            splitCents = computeSplitCents({ totalCents: depositCentavosFinal, platformFeeCents, asaasFeeEstimateCents });
          } catch (err) {
            if (err instanceof SignalTooLowError) {
              await pool.query("UPDATE appointment_payments SET status='failed' WHERE id=?", [depositPaymentId]);
              await cancelPendingPaymentAppointmentTx(appointmentId, { db: pool });
              return res.status(400).json({
                error: 'signal_too_low',
                message: 'O valor do sinal é muito baixo para cobrir a taxa do PIX.',
              });
            }
            throw err;
          }
        }
        try {
          const { payment, pix, providerPaymentId } = await createAsaasDepositPixPayment({
            amountCents: depositCentavosFinal,
            description: `Sinal - ${serviceLabel}`,
            externalReference,
            payer: { name: nome || null, email: emailNorm || null, cpfCnpj: cpfDigits || null, phone: telNorm || null },
            userId,
            expiresAt: depositExpiresAt,
            walletId: splitDisabled ? null : depositConfig.walletId,
            splitCents: splitDisabled ? 0 : splitCents,
          });
          await pool.query(
            'UPDATE appointment_payments SET provider=?, provider_payment_id=?, provider_reference=?, split_centavos=?, platform_fee_centavos=?, raw_payload=? WHERE id=?',
            ['asaas', providerPaymentId, externalReference, splitCents, splitDisabled ? null : platformFeeCents, safeJson(payment), depositPaymentId]
          );
          const depositToken = buildPublicDepositToken({
            agendamentoId: appointmentId,
            clienteId: userId,
            estabelecimentoId: estabelecimento_id,
            paymentId: depositPaymentId,
          });
          return res.status(201).json({
            id: appointmentId,
            agendamentoId: appointmentId,
            status: 'pendente_pagamento',
            total_centavos: totalCentavosFinal,
            deposit_required: 1,
            deposit_percent: depositPercent,
            deposit_centavos: depositCentavosFinal,
            deposit_expires_at: expiresIso,
            deposit_token: depositToken,
            paymentId: depositPaymentId,
            expiresAt: expiresIso,
            pix_qr: pix?.qr_code_base64 || null,
            pix_qr_raw: pix?.qr_code || null,
            pix_copia_cola: pix?.copia_e_cola || pix?.qr_code || null,
            pix_ticket_url: pix?.ticket_url || null,
            amount_centavos: depositCentavosFinal,
            pix,
            loyalty_subscription_id: loyaltyApplication?.subscription?.id || null,
            loyalty_credit_applied: Boolean(loyaltyApplication?.loyalty_credit_applied),
            loyalty_discount_percent: loyaltyApplication?.loyalty_discount_percent ?? null,
            loyalty_benefit_snapshot: loyaltyApplication?.snapshot || null,
          });
        } catch (err) {
          console.error('[public/agendamentos][deposit][asaas] erro ao criar PIX:', err?.message || err);
          const payload = safeJson({ error: err?.message || String(err) });
          await pool.query(
            'UPDATE appointment_payments SET status=?, raw_payload=? WHERE id=?',
            ['failed', payload, depositPaymentId]
          );
          await cancelPendingPaymentAppointmentTx(appointmentId, { db: pool });
          return res.status(502).json({
            error: 'payment_create_failed',
            message: 'Não foi possível gerar o PIX do sinal. Tente novamente.',
          });
        }
      }

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
        const depositToken = buildPublicDepositToken({
          agendamentoId: appointmentId,
          clienteId: userId,
          estabelecimentoId: estabelecimento_id,
          paymentId: depositPaymentId,
        });
        return res.status(201).json({
          id: appointmentId,
          agendamentoId: appointmentId,
          status: 'pendente_pagamento',
          total_centavos: totalCentavosFinal,
          deposit_required: 1,
          deposit_percent: depositPercent,
          deposit_centavos: depositCentavosFinal,
          deposit_expires_at: expiresIso,
          deposit_token: depositToken,
          paymentId: depositPaymentId,
          expiresAt: expiresIso,
          pix_qr: pix?.qr_code_base64 || null,
          pix_qr_raw: pix?.qr_code || null,
          pix_copia_cola: pix?.copia_e_cola || pix?.qr_code || null,
          pix_ticket_url: pix?.ticket_url || null,
          amount_centavos: depositCentavosFinal,
          pix,
          loyalty_subscription_id: loyaltyApplication?.subscription?.id || null,
          loyalty_credit_applied: Boolean(loyaltyApplication?.loyalty_credit_applied),
          loyalty_discount_percent: loyaltyApplication?.loyalty_discount_percent ?? null,
          loyalty_benefit_snapshot: loyaltyApplication?.snapshot || null,
        });
      } catch (err) {
        console.error('[public/agendamentos][deposit] erro ao criar PIX:', err?.message || err);
        const payload = safeJson({ error: err?.message || String(err) });
        await pool.query(
          'UPDATE appointment_payments SET status=?, raw_payload=? WHERE id=?',
          ['failed', payload, depositPaymentId]
        );
        await cancelPendingPaymentAppointmentTx(appointmentId, { db: pool });
        return res.status(502).json({
          error: 'payment_create_failed',
          message: 'Não foi possível gerar o PIX do sinal. Tente novamente.',
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
      servicos: serializeAppointmentServiceItems(serviceItems, loyaltyApplication),
      duracao_total: summary.duracaoTotal,
      preco_total: totalCentavosFinal,
      total_centavos: totalCentavosFinal,
      profissional_id: profissional_id || null,
      inicio: inicioDate,
      fim: fimDate,
      status: 'confirmado',
      confirm_expires_at: null,
      loyalty_subscription_id: loyaltyApplication?.subscription?.id || null,
      loyalty_credit_applied: Boolean(loyaltyApplication?.loyalty_credit_applied),
      loyalty_discount_percent: loyaltyApplication?.loyalty_discount_percent ?? null,
      loyalty_benefit_snapshot: loyaltyApplication?.snapshot || null,
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
        title: 'Token inválido',
        message: 'Link de confirmação inválido ou ausente.',
      }));
    }
    const tokenHash = hashToken(token);
    const [[ag]] = await pool.query(
      'SELECT id, status, public_confirm_expires_at FROM agendamentos WHERE public_confirm_token_hash=? LIMIT 1',
      [tokenHash]
    );
    if (!ag) {
      return res.status(404).send(renderConfirmPage({
        title: 'Agendamento não encontrado',
        message: 'Este link não é válido ou já expirou.',
      }));
    }
    if (ag.status === 'confirmado') {
      return res.status(200).send(renderConfirmPage({
        title: 'Agendamento confirmado',
        message: 'Seu agendamento já estava confirmado.',
      }));
    }
    if (ag.status === 'cancelado') {
      return res.status(410).send(renderConfirmPage({
        title: 'Confirmação expirada',
        message: 'Este agendamento foi cancelado por falta de confirmação.',
      }));
    }
    if (ag.public_confirm_expires_at && new Date(ag.public_confirm_expires_at).getTime() < Date.now()) {
      await cancelPublicPendingAppointmentTx(ag.id, { db: pool });
      return res.status(410).send(renderConfirmPage({
        title: 'Confirmação expirada',
        message: 'Este agendamento foi cancelado por falta de confirmação.',
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
      message: 'Confirmação registrada com sucesso.',
    }));
  } catch (e) {
    console.error('[public/agendamentos][confirm]', e?.message || e);
    return res.status(500).send(renderConfirmPage({
      title: 'Erro na confirmação',
      message: 'Não foi possível confirmar agora. Tente novamente.',
    }));
  }
});

// GET /public/agendamentos/:id?token=... (detalhe com PIX reaproveitado)
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    const token = req.query?.token || req.headers['x-deposit-token'];
    const verification = verifyPublicDepositToken(token);
    if (!verification.ok) {
      console.warn('[public/agendamentos][deposit] invalid_token', verification.reason);
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (Number(verification.payload?.agendamento_id || 0) !== id) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [rows] = await pool.query(
      `SELECT a.*,
              u.nome AS estabelecimento_nome,
              p.nome AS profissional_nome,
              p.avatar_url AS profissional_avatar_url
         FROM agendamentos a
         JOIN usuarios u ON u.id=a.estabelecimento_id
         LEFT JOIN profissionais p ON p.id = a.profissional_id
        WHERE a.id=?
        LIMIT 1`,
      [id]
    );
    if (!rows?.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const item = rows[0];
    await hydrateAppointmentsWithItems(pool, [item]);

    const statusNorm = String(item.status || '').toLowerCase();
    if (statusNorm === 'pendente_pagamento') {
      const paymentRow = await fetchPendingDepositPayment(pool, item.id);
      if (paymentRow) {
        if (isExpiredAt(paymentRow.expires_at)) {
          await markDepositPaymentExpired(pool, paymentRow);
          item.status = 'cancelado';
          item.deposit_expires_at = new Date().toISOString();
        } else {
          const payload = buildDepositPixPayload(paymentRow);
          attachDepositPixToResponse(item, paymentRow, payload);
        }
      }
    }

    item.deposit_token = String(token || '') || null;
    return res.json(item);
  } catch (err) {
    console.error('[public/agendamentos][GET]', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /public/agendamentos/:id/deposit/pix (regenera PIX)
router.post('/:id/deposit/pix', async (req, res) => {
  let conn;
  let txStarted = false;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    const token = req.body?.token || req.query?.token || req.headers['x-deposit-token'];
    const verification = verifyPublicDepositToken(token);
    if (!verification.ok) {
      console.warn('[public/agendamentos][deposit] invalid_token', verification.reason);
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (Number(verification.payload?.agendamento_id || 0) !== id) {
      return res.status(403).json({ error: 'forbidden' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [[ag]] = await conn.query('SELECT * FROM agendamentos WHERE id=? FOR UPDATE', [id]);
    if (!ag) {
      await conn.rollback();
      return res.status(404).json({ error: 'not_found' });
    }
    if (Number(ag.deposit_required || 0) !== 1 || Number(ag.deposit_percent || 0) <= 0) {
      await conn.rollback();
      txStarted = false;
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'deposit_not_required' });
    }
    if (ag.deposit_paid_at) {
      await conn.rollback();
      txStarted = false;
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'deposit_already_paid' });
    }
    const statusNorm = String(ag.status || '').toLowerCase();
    if (statusNorm === 'cancelado') {
      console.info('[public/agendamentos][deposit][refresh] canceled_requires_new', { agendamento_id: id });
      await conn.rollback();
      txStarted = false;
      conn.release();
      conn = null;
      return res.status(409).json({
        error: 'deposit_canceled_requires_new_booking',
        message: 'Agendamento cancelado por falta de pagamento. Faça um novo agendamento.',
      });
    }
    if (statusNorm !== 'pendente_pagamento') {
      await conn.rollback();
      txStarted = false;
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'deposit_not_pending' });
    }

    const expiredByAgendamento =
      ag.deposit_expires_at && new Date(ag.deposit_expires_at).getTime() <= Date.now();
    if (expiredByAgendamento) {
      await cancelPendingPaymentAppointmentTx(id, { db: conn });
      await conn.query(
        "UPDATE appointment_payments SET status='expired' WHERE agendamento_id=? AND status='pending'",
        [id]
      );
      await conn.commit();
      txStarted = false;
      conn.release();
      conn = null;
      console.info('[public/agendamentos][deposit][refresh] expired_requires_new', { agendamento_id: id });
      return res.status(409).json({
        error: 'deposit_canceled_requires_new_booking',
        message: 'Agendamento cancelado por falta de pagamento. Faça um novo agendamento.',
      });
    }

    const pending = await fetchPendingDepositPayment(conn, id, { forUpdate: true });
    if (pending) {
      if (isExpiredAt(pending.expires_at)) {
        await markDepositPaymentExpired(conn, pending);
        await conn.commit();
        txStarted = false;
        conn.release();
        conn = null;
        console.info('[public/agendamentos][deposit][refresh] expired_payment_requires_new', { agendamento_id: id });
        return res.status(409).json({
          error: 'deposit_canceled_requires_new_booking',
          message: 'Agendamento cancelado por falta de pagamento. Faça um novo agendamento.',
        });
      }
      await conn.commit();
      txStarted = false;
      conn.release();
      conn = null;
      const payload = buildDepositPixPayload(pending);
      if (!payload) {
        console.warn('[public/agendamentos][deposit][refresh] pix_unavailable', { agendamento_id: id });
        return res.status(409).json({
          error: 'deposit_canceled_requires_new_booking',
          message: 'Agendamento cancelado por falta de pagamento. Faça um novo agendamento.',
        });
      }
      return res.status(200).json({
        id,
        agendamentoId: id,
        status: 'pendente_pagamento',
        deposit_required: 1,
        deposit_percent: Number(ag.deposit_percent || 0),
        deposit_centavos: pending.amount_centavos,
        deposit_expires_at: payload.expiresAt,
        deposit_token: String(token || '') || null,
        paymentId: pending.id,
        expiresAt: payload.expiresAt,
        amount_centavos: pending.amount_centavos,
        pix: payload.pix,
        pix_qr: payload.pix?.qr_code_base64 || null,
        pix_qr_raw: payload.pix?.qr_code || null,
        pix_copia_cola: payload.pix?.copia_e_cola || payload.pix?.qr_code || null,
        pix_ticket_url: payload.pix?.ticket_url || null,
      });
    }
    await cancelPendingPaymentAppointmentTx(id, { db: conn });
    await conn.query(
      "UPDATE appointment_payments SET status='expired' WHERE agendamento_id=? AND status='pending'",
      [id]
    );
    await conn.commit();
    txStarted = false;
    conn.release();
    conn = null;
    console.warn('[public/agendamentos][deposit][refresh] no_pending_payment', { agendamento_id: id });
    return res.status(409).json({
      error: 'deposit_canceled_requires_new_booking',
      message: 'Agendamento cancelado por falta de pagamento. Faça um novo agendamento.',
    });
  } catch (err) {
    try {
      if (txStarted && conn) await conn.rollback();
    } catch {}
    try {
      if (conn) conn.release();
    } catch {}
    console.error('[public/agendamentos][deposit][refresh]', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;

