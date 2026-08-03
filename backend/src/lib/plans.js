// backend/src/lib/plans.js
import { pool } from './db.js';

export const PLAN_TIERS = ['starter', 'pro', 'premium'];
export const PLAN_STATUS = ['trialing', 'active', 'pending_payment', 'pending_pix', 'past_due', 'unpaid', 'expired', 'canceled'];

const LIMIT_UNLIMITED = null;

export const MAX_TRIAL_DAYS = 7;
const PLAN_CONFIG = {
  starter: {
    code: 'starter',
    label: 'Starter',
    priceCents: 1490,
    annualPriceCents: 14900,
    maxMonthlyAppointments: LIMIT_UNLIMITED,
    maxServices: LIMIT_UNLIMITED,
    maxProfessionals: 2,
    maxGalleryImages: 5,
    allowWhatsApp: true,
    allowAdvancedReports: false,
    // O sinal via PIX vivia como `new Set(['pro','premium'])` copiado em QUATRO arquivos
    // (agendamentos, agendamentos_public, estabelecimento_settings, mercadopago) e não
    // existia aqui. Um plano novo seria esquecido em três deles — e a página de planos
    // prometeria um recurso que o backend nega.
    allowDeposit: false,
    allowLoyalty: false,
    allowTrial: true,
    whatsappIncludedMessages: 250,
    whatsappMaxMessagesPerAppointment: 5,
  },
  pro: {
    code: 'pro',
    label: 'Pro',
    priceCents: 2990,
    annualPriceCents: 29900,
    maxMonthlyAppointments: LIMIT_UNLIMITED,
    maxServices: LIMIT_UNLIMITED,
    maxProfessionals: 5,
    maxGalleryImages: 15,
    allowWhatsApp: true,
    allowAdvancedReports: true,
    allowDeposit: true,
    allowLoyalty: false,
    allowTrial: true,
    whatsappIncludedMessages: 500,
    whatsappMaxMessagesPerAppointment: 5,
  },
  premium: {
    code: 'premium',
    label: 'Premium',
    priceCents: 9990,
    annualPriceCents: 99900,
    maxMonthlyAppointments: LIMIT_UNLIMITED,
    maxServices: LIMIT_UNLIMITED,
    maxProfessionals: 10,
    maxGalleryImages: LIMIT_UNLIMITED,
    allowWhatsApp: true,
    allowAdvancedReports: true,
    allowDeposit: true,
    allowLoyalty: true,
    allowTrial: false,
    whatsappIncludedMessages: 1500,
    whatsappMaxMessagesPerAppointment: 5,
  },
};

// Uma pergunta, uma resposta. Substitui os quatro DEPOSIT_ALLOWED_PLANS espalhados.
export function planAllowsDeposit(plan) {
  return Boolean(resolvePlanConfig(plan).allowDeposit);
}

// Planos de fidelidade (o recorrente que o ESTABELECIMENTO vende ao cliente dele) são do
// Premium. Nasce como pergunta única, e não como Set espalhado pelas rotas — foi assim que o
// sinal virou quatro cópias que precisaram ser reunidas depois.
export function planAllowsLoyalty(plan) {
  return Boolean(resolvePlanConfig(plan).allowLoyalty);
}

/**
 * Quais planos podem ser testados de graça.
 *
 * O Premium fica de fora, e não por preço: a fidelidade (o recurso dele) faz o dono enfileirar
 * cobranças RECORRENTES no cartão de clientes reais. Nada no código cancela essas assinaturas
 * quando o plano cai, e elas vivem no Asaas com id próprio — no dia 8 o salão perderia a gestão
 * e o cliente continuaria pagando. Teste não pode deixar dívida com terceiro para trás.
 * O sinal não tem esse problema: é por agendamento, acabou o teste não nasce cobrança nova.
 *
 * Esta era a terceira cópia da mesma regra (auth.js tinha um Set, Cadastro.jsx um array e
 * Planos.jsx um `=== 'pro'` cravado). Agora sai do catálogo, como o resto.
 */
export function planAllowsTrial(plan) {
  return Boolean(resolvePlanConfig(plan).allowTrial);
}

/**
 * Este plano EXISTE no catálogo?
 *
 * Pergunta separada de "pode ser testado" de propósito. `planAllowsTrial` responde pelo
 * `resolvePlanConfig`, que cai no starter para chave desconhecida — então `planAllowsTrial('')` e
 * `planAllowsTrial('xyz')` respondem `true`, porque o starter permite teste. Ótimo para LER
 * capacidade de um plano já validado; péssimo como porteiro de entrada.
 *
 * Foi assim que o cadastro 191 quebrou em 02/08/2026: o `''` do corpo da requisição passou pelo
 * guard, chegou ao `UPDATE ... SET plan=''` e o ENUM da coluna recusou (1265, "Data truncated for
 * column 'plan'"). O UPDATE inteiro morreu junto e o estabelecimento ficou sem
 * `plan_trial_ends_at` — teste que nunca vence, aviso de fim que nunca dispara.
 *
 * Validação é pertinência, não capacidade. Quem valida entrada usa esta função ANTES da outra.
 */
export function isKnownPlan(plan) {
  return PLAN_TIERS.includes(String(plan ?? '').trim().toLowerCase());
}

/** Plano padrão do teste quando o pedido não veio ou não pode ser testado. */
export const DEFAULT_TRIAL_PLAN = 'starter';

// Catálogo para a página pública de planos. Sai daqui, e não de uma cópia hardcoded no
// frontend — preço e limite que divergem entre a vitrine e o backend viram promessa falsa.
export function getPublicPlanCatalog() {
  return {
    trial_days: MAX_TRIAL_DAYS,
    plans: PLAN_TIERS.map((tier) => {
      const config = PLAN_CONFIG[tier];
      return {
        code: config.code,
        label: config.label,
        price_cents: config.priceCents,
        annual_price_cents: config.annualPriceCents,
        // 12 meses pelo preço de N: o desconto anual dito como número, não como "equivalente".
        annual_months_equivalent: config.priceCents
          ? Math.round(config.annualPriceCents / config.priceCents)
          : null,
        max_professionals: config.maxProfessionals,
        max_gallery_images: config.maxGalleryImages,
        max_monthly_appointments: config.maxMonthlyAppointments,
        max_services: config.maxServices,
        whatsapp_included_messages: config.whatsappIncludedMessages,
        whatsapp_max_per_appointment: config.whatsappMaxMessagesPerAppointment,
        allow_whatsapp: config.allowWhatsApp,
        allow_advanced_reports: config.allowAdvancedReports,
        allow_deposit: config.allowDeposit,
        allow_loyalty: config.allowLoyalty,
        allow_trial: config.allowTrial,
      };
    }),
  };
}

export const BILLING_CYCLES = {
  mensal: {
    key: 'mensal',
    label: 'Mensal',
    frequency: 1,
    frequencyType: 'months',
  },
  anual: {
    key: 'anual',
    label: 'Anual',
    frequency: 1,
    frequencyType: 'years',
  },
};

export function normalizeBillingCycle(cycle) {
  const key = String(cycle || '').toLowerCase();
  return BILLING_CYCLES[key] ? key : 'mensal';
}

export function getBillingCycleConfig(cycle) {
  const key = normalizeBillingCycle(cycle);
  return BILLING_CYCLES[key];
}

export function resolvePlanConfig(plan) {
  const key = (plan || '').toLowerCase();
  return PLAN_CONFIG[key] || PLAN_CONFIG.starter;
}

export function planOrder(plan) {
  const idx = PLAN_TIERS.indexOf((plan || '').toLowerCase());
  return idx === -1 ? PLAN_TIERS.indexOf('starter') : idx;
}

export function isDowngrade(currentPlan, nextPlan) {
  return planOrder(nextPlan) < planOrder(currentPlan);
}

export function isUpgrade(currentPlan, nextPlan) {
  return planOrder(nextPlan) > planOrder(currentPlan);
}

export function isDelinquentStatus(status) {
  const normalized = String(status || '').toLowerCase().trim();
  if (!normalized) return false;
  if (['delinquent', 'blocked'].includes(normalized)) return true;
  return ['unpaid', 'expired', 'canceled', 'cancelled'].includes(normalized);
}

export function computeTrialInfo(trialEndsAt) {
  if (!trialEndsAt) return { daysLeft: null, isTrial: false, warn: false };
  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return { daysLeft: null, isTrial: false, warn: false };
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  const rawDaysLeft = Math.ceil(diffMs / 86400000);
  const daysLeft =
    rawDaysLeft != null && Number.isFinite(rawDaysLeft)
      ? Math.max(0, Math.min(rawDaysLeft, MAX_TRIAL_DAYS))
      : null;
  const isTrial = diffMs > 0;
  const warn = isTrial && typeof daysLeft === 'number' && daysLeft <= 3;
  return { daysLeft, isTrial, warn };
}

let hasProfessionalsTableCache = null;
async function ensureProfessionalsTableKnown() {
  if (hasProfessionalsTableCache !== null) return hasProfessionalsTableCache;
  const [rows] = await pool.query("SHOW TABLES LIKE 'profissionais'");
  hasProfessionalsTableCache = rows.length > 0;
  return hasProfessionalsTableCache;
}

export async function countProfessionals(estabelecimentoId) {
  if (!(await ensureProfessionalsTableKnown())) return 0;
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id=?',
    [estabelecimentoId]
  );
  return Number(row?.total || 0);
}

export async function getPlanContext(estabelecimentoId) {
  const [rows] = await pool.query(
    "SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id, plan_cycle FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
    [estabelecimentoId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const plan = row.plan || 'starter';
  const rawStatus = String(row.plan_status || 'trialing').toLowerCase().trim();
  const status =
    rawStatus === 'delinquent'
      ? 'unpaid'
      : rawStatus === 'pending'
        ? 'pending_pix'
        : rawStatus === 'authorized'
          ? 'active'
          : rawStatus === 'paused'
            ? 'past_due'
            : rawStatus || 'trialing';
  const cycle = normalizeBillingCycle(row.plan_cycle);
  const config = resolvePlanConfig(plan);
  const trialEndsAt = row.plan_trial_ends_at ? new Date(row.plan_trial_ends_at) : null;
  const activeUntil = row.plan_active_until ? new Date(row.plan_active_until) : null;
  const trial = computeTrialInfo(trialEndsAt);
  return {
    plan,
    status,
    cycle,
    config,
    trialEndsAt,
    activeUntil,
    trial,
    subscriptionId: row.plan_subscription_id || null,
  };
}

export function formatPlanLimitExceeded(planConfig, type) {
  if (type === 'appointments') {
    if (planConfig.maxMonthlyAppointments === null) return null;
    const nextPlan = planConfig.code === 'starter' ? 'Pro' : 'Premium';
    return `Limite do plano (${planConfig.label}) atingido: ${planConfig.maxMonthlyAppointments} agendamentos/mês. Atualize para ${nextPlan}.`;
  }
  if (type === 'services') {
    if (planConfig.maxServices === null) return null;
    const nextPlan = planConfig.code === 'starter' ? 'Pro' : 'Premium';
    return `Limite do plano (${planConfig.label}) atingido: ${planConfig.maxServices} serviços. Atualize para ${nextPlan}.`;
  }
  if (type === 'professionals') {
    if (planConfig.maxProfessionals === null) return null;
    const nextPlan = planConfig.code === 'starter' ? 'Pro' : 'Premium';
    return `Limite do plano (${planConfig.label}) atingido: ${planConfig.maxProfessionals} profissionais. Atualize para ${nextPlan}.`;
  }
  return null;
}

export function serializePlanContext(context) {
  if (!context) return null;
  const { plan, status, cycle, config, trialEndsAt, activeUntil, trial, subscriptionId } = context;
  return {
    plan,
    status,
    billing_cycle: cycle,
    limits: {
      maxMonthlyAppointments: config.maxMonthlyAppointments,
      maxServices: config.maxServices,
      maxProfessionals: config.maxProfessionals,
      maxGalleryImages: config.maxGalleryImages,
      allowWhatsApp: config.allowWhatsApp,
      allowAdvancedReports: config.allowAdvancedReports,
      allowLoyalty: config.allowLoyalty,
      whatsappIncludedMessages: config.whatsappIncludedMessages ?? null,
      whatsappMaxMessagesPerAppointment: config.whatsappMaxMessagesPerAppointment ?? 5,
    },
    features: {
      allow_whatsapp: config.allowWhatsApp,
      allow_advanced: config.allowAdvancedReports,
      allow_loyalty: config.allowLoyalty,
    },
    trial: {
      ends_at: trialEndsAt ? trialEndsAt.toISOString() : null,
      days_left: trial.daysLeft,
      warn: trial.warn,
      active: trial.isTrial,
    },
    active_until: activeUntil ? activeUntil.toISOString() : null,
    subscription_id: subscriptionId,
  };
}


export function getPlanPriceCents(plan, cycle = 'mensal') {
  const cfg = resolvePlanConfig(plan);
  const normalized = normalizeBillingCycle(cycle);
  if (normalized === 'anual' && typeof cfg.annualPriceCents === 'number') {
    return cfg.annualPriceCents;
  }
  return cfg.priceCents;
}

export function getPlanLabel(plan) {
  return resolvePlanConfig(plan).label;
}
