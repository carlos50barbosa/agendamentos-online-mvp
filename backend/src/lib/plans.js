// backend/src/lib/plans.js
import { pool } from './db.js';

export const PLAN_TIERS = ['starter', 'pro', 'premium'];
export const PLAN_STATUS = ['trialing', 'active', 'delinquent', 'pending', 'canceled', 'expired'];

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
    whatsappIncludedMessages: 1500,
    whatsappMaxMessagesPerAppointment: 5,
  },
};

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
  return (status || '').toLowerCase() === 'delinquent';
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
  const status = row.plan_status || 'trialing';
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
      whatsappIncludedMessages: config.whatsappIncludedMessages ?? null,
      whatsappMaxMessagesPerAppointment: config.whatsappMaxMessagesPerAppointment ?? 5,
    },
    features: {
      allow_whatsapp: config.allowWhatsApp,
      allow_advanced: config.allowAdvancedReports,
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
