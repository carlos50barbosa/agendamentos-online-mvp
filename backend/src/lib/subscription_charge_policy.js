import { normalizeSubscriptionStatus } from './subscription_normalization.js'

const MINUTE_MS = 60000

export const SUBSCRIPTION_CREATE_DEDUP_WINDOW_MS = 2 * MINUTE_MS
export const RECOVERY_SUBSCRIPTION_SETTLE_WINDOW_MS = 5 * MINUTE_MS
export const RECOVERY_DUPLICATE_WINDOW_MS = 10 * MINUTE_MS
export const RECOVERY_PENDING_WINDOW_MS = 30 * MINUTE_MS
export const RECOVERY_HIGH_RISK_COOLDOWN_MS = 60 * MINUTE_MS

const RECOVERY_ELIGIBLE_STATUSES = new Set(['past_due', 'unpaid', 'expired'])
const RECOVERY_ATTEMPT_EVENT_TYPES = new Set([
  'payment_recovery_attempt',
  'payment_recovered',
  'payment_failed',
  'payment_pending',
])
const RECOVERY_SETUP_EVENT_TYPES = new Set([
  'subscription_created',
  'payment_method_changed',
])

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeEmail(value) {
  return normalizeText(value)
}

function normalizeAmountCents(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  return Math.round(amount)
}

function toTimeMs(value) {
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

function getEventAgeMs(event, nowMs) {
  const time = toTimeMs(event?.created_at)
  if (time == null) return null
  return Math.max(0, nowMs - time)
}

function getEventPaymentResult(event) {
  return event?.payment_result || event?.payload?.payment_result || null
}

function getEventAmountCents(event) {
  const payload = event?.payload || {}
  const direct = normalizeAmountCents(payload.amount_cents)
  if (direct != null) return direct

  const transactionAmount =
    payload?.transaction_amount ??
    payload?.payment_result?.transaction_amount ??
    payload?.raw?.payment?.transaction_amount ??
    null
  if (transactionAmount == null) return null
  return Math.round(Number(transactionAmount || 0) * 100)
}

function getEventPlan(event) {
  return normalizeText(
    event?.payload?.plan ||
    event?.payload?.metadata?.plan ||
    event?.plan ||
    null
  )
}

function getEventBillingCycle(event) {
  return normalizeText(
    event?.payload?.billing_cycle ||
    event?.payload?.metadata?.billing_cycle ||
    event?.billing_cycle ||
    null
  )
}

function getEventPayerEmail(event) {
  return normalizeEmail(
    event?.payload?.payer_email ||
    event?.payload?.payer?.email ||
    event?.payload?.raw?.payment?.payer?.email ||
    null
  )
}

function getEventPaymentMethodId(event) {
  return normalizeText(
    event?.payload?.payment_method_id ||
    event?.payload?.payment?.payment_method_id ||
    event?.payload?.raw?.payment?.payment_method_id ||
    event?.payload?.payment_result?.payment_method_id ||
    null
  )
}

function getEventSubscriptionId(event) {
  const subscriptionId =
    event?.subscription_id ??
    event?.payload?.subscription_id ??
    event?.payload?.metadata?.subscription_id ??
    null
  return subscriptionId != null ? String(subscriptionId) : null
}

function isEventWithinWindow(event, windowMs, nowMs) {
  const ageMs = getEventAgeMs(event, nowMs)
  return ageMs != null && ageMs <= windowMs
}

export function buildRecoveryChargeFingerprint({
  subscriptionId = null,
  plan = null,
  billingCycle = null,
  amountCents = null,
  payerEmail = null,
  paymentMethodId = null,
} = {}) {
  return [
    subscriptionId != null ? String(subscriptionId) : '',
    normalizeText(plan),
    normalizeText(billingCycle),
    normalizeAmountCents(amountCents) != null ? String(normalizeAmountCents(amountCents)) : '',
    normalizeEmail(payerEmail),
    normalizeText(paymentMethodId),
  ].join('|')
}

function matchesRecoveryChargeContext(event, context = {}) {
  const payload = event?.payload || {}
  const fingerprint =
    payload.duplicate_fingerprint ||
    payload.charge_fingerprint ||
    payload.recovery_fingerprint ||
    null
  if (fingerprint && context.fingerprint) {
    return String(fingerprint) === String(context.fingerprint)
  }

  const subscriptionId = context.subscriptionId != null ? String(context.subscriptionId) : null
  if (subscriptionId && getEventSubscriptionId(event) && getEventSubscriptionId(event) !== subscriptionId) {
    return false
  }

  const plan = normalizeText(context.plan)
  const eventPlan = getEventPlan(event)
  if (plan && eventPlan && eventPlan !== plan) return false

  const billingCycle = normalizeText(context.billingCycle)
  const eventBillingCycle = getEventBillingCycle(event)
  if (billingCycle && eventBillingCycle && eventBillingCycle !== billingCycle) return false

  const amountCents = normalizeAmountCents(context.amountCents)
  const eventAmountCents = getEventAmountCents(event)
  if (amountCents != null && eventAmountCents != null && eventAmountCents !== amountCents) return false

  const payerEmail = normalizeEmail(context.payerEmail)
  const eventPayerEmail = getEventPayerEmail(event)
  if (payerEmail && eventPayerEmail && eventPayerEmail !== payerEmail) return false

  const paymentMethodId = normalizeText(context.paymentMethodId)
  const eventPaymentMethodId = getEventPaymentMethodId(event)
  if (paymentMethodId && eventPaymentMethodId && eventPaymentMethodId !== paymentMethodId) return false

  return true
}

function findRecentRecoverySetupEvent(events = [], context = {}, nowMs = Date.now()) {
  return (Array.isArray(events) ? events : []).find((event) =>
    RECOVERY_SETUP_EVENT_TYPES.has(String(event?.event_type || '').trim()) &&
    matchesRecoveryChargeContext(event, context) &&
    isEventWithinWindow(event, RECOVERY_SUBSCRIPTION_SETTLE_WINDOW_MS, nowMs)
  ) || null
}

function findRecentPendingRecoveryEvent(events = [], context = {}, nowMs = Date.now()) {
  return (Array.isArray(events) ? events : []).find((event) => {
    if (!matchesRecoveryChargeContext(event, context)) return false
    if (!isEventWithinWindow(event, RECOVERY_PENDING_WINDOW_MS, nowMs)) return false
    const paymentResult = getEventPaymentResult(event)
    return (
      String(event?.event_type || '').trim() === 'payment_pending' ||
      paymentResult?.status_group === 'pending'
    )
  }) || null
}

function findRecentHighRiskEvent(events = [], context = {}, nowMs = Date.now()) {
  return (Array.isArray(events) ? events : []).find((event) => {
    if (!matchesRecoveryChargeContext(event, context)) return false
    if (!isEventWithinWindow(event, RECOVERY_HIGH_RISK_COOLDOWN_MS, nowMs)) return false
    const paymentResult = getEventPaymentResult(event)
    return (
      paymentResult?.normalized_reason === 'risk_declined' ||
      paymentResult?.status_detail === 'cc_rejected_high_risk'
    )
  }) || null
}

export function isLikelyDuplicateChargeAttempt({
  recentEvents = [],
  fingerprint = null,
  subscriptionId = null,
  plan = null,
  billingCycle = null,
  amountCents = null,
  payerEmail = null,
  paymentMethodId = null,
  nowMs = Date.now(),
} = {}) {
  const context = {
    fingerprint,
    subscriptionId,
    plan,
    billingCycle,
    amountCents,
    payerEmail,
    paymentMethodId,
  }

  const recentEvent = (Array.isArray(recentEvents) ? recentEvents : []).find((event) =>
    RECOVERY_ATTEMPT_EVENT_TYPES.has(String(event?.event_type || '').trim()) &&
    matchesRecoveryChargeContext(event, context) &&
    isEventWithinWindow(event, RECOVERY_DUPLICATE_WINDOW_MS, nowMs)
  ) || null

  return {
    duplicate_risk: Boolean(recentEvent),
    recent_similar_attempt_found: Boolean(recentEvent),
    matched_event: recentEvent,
    matched_event_type: recentEvent?.event_type || null,
    age_ms: recentEvent ? getEventAgeMs(recentEvent, nowMs) : null,
  }
}

function buildDecision(overrides = {}) {
  return {
    can_run: false,
    allowed: false,
    should_defer: false,
    duplicate_risk: false,
    recent_similar_attempt_found: false,
    cooldown_active: false,
    decision: 'block',
    normalized_reason: 'recovery_blocked',
    status: null,
    status_detail: null,
    user_message: 'Não foi possível iniciar a cobrança agora.',
    support_message: 'Cobrança de recovery bloqueada pela politica interna.',
    action_recommendation: 'manual_review',
    fingerprint: null,
    matched_event_type: null,
    matched_event_at: null,
    cooldown_remaining_ms: null,
    ...overrides,
  }
}

export function shouldDeferRecoveryCharge(input = {}) {
  return evaluateRecoveryChargeDecision(input)
}

export function canRunRecoveryCharge(input = {}) {
  return evaluateRecoveryChargeDecision(input)
}

export function evaluateRecoveryChargeDecision({
  subscription = null,
  currentStatus = null,
  recentEvents = [],
  amountCents = null,
  payerEmail = null,
  paymentMethodId = null,
  plan = null,
  billingCycle = null,
  nowMs = Date.now(),
} = {}) {
  const normalizedStatus = normalizeSubscriptionStatus(currentStatus || subscription?.status || null)
  const fingerprint = buildRecoveryChargeFingerprint({
    subscriptionId: subscription?.id || null,
    plan: plan || subscription?.plan || null,
    billingCycle: billingCycle || subscription?.billingCycle || null,
    amountCents: amountCents ?? subscription?.amountCents ?? null,
    payerEmail,
    paymentMethodId,
  })
  const context = {
    fingerprint,
    subscriptionId: subscription?.id || null,
    plan: plan || subscription?.plan || null,
    billingCycle: billingCycle || subscription?.billingCycle || null,
    amountCents: amountCents ?? subscription?.amountCents ?? null,
    payerEmail,
    paymentMethodId,
  }

  if (!subscription?.id) {
    return buildDecision({
      normalized_reason: 'subscription_missing',
      user_message: 'Não existe uma assinatura elegível para regularização no cartão.',
      support_message: 'Recovery bloqueado sem assinatura local.',
      action_recommendation: 'refresh_context',
      fingerprint,
    })
  }

  if (!subscription?.gatewaySubscriptionId) {
    return buildDecision({
      normalized_reason: 'preapproval_missing',
      user_message: 'Não existe uma assinatura recorrente válida para regularizar no cartão.',
      support_message: 'Recovery bloqueado sem preapproval_id/gateway_subscription_id.',
      action_recommendation: 'create_or_update_subscription',
      fingerprint,
    })
  }

  if (!RECOVERY_ELIGIBLE_STATUSES.has(normalizedStatus)) {
    return buildDecision({
      normalized_reason: 'recovery_not_required',
      user_message: 'Não existe uma pendência elegível para regularização imediata no cartão.',
      support_message: 'Recovery bloqueado porque o status atual não é inadimplente.',
      action_recommendation: 'ignore',
      fingerprint,
    })
  }

  const recentHighRisk = findRecentHighRiskEvent(recentEvents, context, nowMs)
  if (recentHighRisk) {
    const paymentResult = getEventPaymentResult(recentHighRisk)
    const remainingMs = RECOVERY_HIGH_RISK_COOLDOWN_MS - (getEventAgeMs(recentHighRisk, nowMs) || 0)
    return buildDecision({
      normalized_reason: 'high_risk_cooldown',
      status: paymentResult?.status || null,
      status_detail: paymentResult?.status_detail || null,
      user_message: 'Por segurança, não vamos repetir automaticamente esta cobrança. Tente outro cartão ou aguarde antes de tentar novamente.',
      support_message: 'Recovery bloqueado por cooldown de high_risk recente.',
      action_recommendation: 'use_other_card_or_wait',
      cooldown_active: true,
      decision: 'block',
      duplicate_risk: true,
      recent_similar_attempt_found: true,
      matched_event_type: recentHighRisk?.event_type || null,
      matched_event_at: recentHighRisk?.created_at || null,
      cooldown_remaining_ms: remainingMs > 0 ? remainingMs : 0,
      fingerprint,
    })
  }

  const recentPending = findRecentPendingRecoveryEvent(recentEvents, context, nowMs)
  if (recentPending) {
    const paymentResult = getEventPaymentResult(recentPending)
    const remainingMs = RECOVERY_PENDING_WINDOW_MS - (getEventAgeMs(recentPending, nowMs) || 0)
    return buildDecision({
      normalized_reason: 'pending_recovery_recent',
      status: paymentResult?.status || null,
      status_detail: paymentResult?.status_detail || null,
      user_message: 'Já existe uma tentativa recente de cobrança em processamento ou recusada. Aguarde alguns minutos antes de tentar novamente.',
      support_message: 'Recovery adiado porque existe tentativa recente pendente/em análise.',
      action_recommendation: 'wait_processing',
      cooldown_active: true,
      should_defer: true,
      decision: 'defer',
      matched_event_type: recentPending?.event_type || null,
      matched_event_at: recentPending?.created_at || null,
      cooldown_remaining_ms: remainingMs > 0 ? remainingMs : 0,
      fingerprint,
    })
  }

  const recentSetup = findRecentRecoverySetupEvent(recentEvents, context, nowMs)
  if (recentSetup) {
    const remainingMs = RECOVERY_SUBSCRIPTION_SETTLE_WINDOW_MS - (getEventAgeMs(recentSetup, nowMs) || 0)
    return buildDecision({
      normalized_reason: 'recent_subscription_setup',
      user_message: 'Já existe uma configuração recente da assinatura no cartão. Aguarde alguns minutos antes de tentar a cobrança avulsa ou gere um PIX.',
      support_message: 'Recovery adiado logo após criação/atualização de preapproval.',
      action_recommendation: 'wait_before_recovery_or_use_pix',
      cooldown_active: true,
      should_defer: true,
      decision: 'defer',
      duplicate_risk: true,
      matched_event_type: recentSetup?.event_type || null,
      matched_event_at: recentSetup?.created_at || null,
      cooldown_remaining_ms: remainingMs > 0 ? remainingMs : 0,
      fingerprint,
    })
  }

  const duplicateAttempt = isLikelyDuplicateChargeAttempt({
    recentEvents,
    fingerprint,
    subscriptionId: subscription?.id || null,
    plan: plan || subscription?.plan || null,
    billingCycle: billingCycle || subscription?.billingCycle || null,
    amountCents: amountCents ?? subscription?.amountCents ?? null,
    payerEmail,
    paymentMethodId,
    nowMs,
  })
  if (duplicateAttempt.duplicate_risk) {
    const paymentResult = getEventPaymentResult(duplicateAttempt.matched_event)
    const remainingMs = RECOVERY_DUPLICATE_WINDOW_MS - (duplicateAttempt.age_ms || 0)
    return buildDecision({
      normalized_reason: 'duplicate_recovery_attempt',
      status: paymentResult?.status || null,
      status_detail: paymentResult?.status_detail || null,
      user_message: 'Já existe uma tentativa recente de cobrança em processamento ou recusada. Aguarde alguns minutos antes de tentar novamente.',
      support_message: 'Recovery bloqueado por tentativa recente com contexto muito semelhante.',
      action_recommendation: 'wait_before_retry',
      cooldown_active: true,
      should_defer: true,
      decision: 'defer',
      duplicate_risk: true,
      recent_similar_attempt_found: true,
      matched_event_type: duplicateAttempt.matched_event_type || null,
      matched_event_at: duplicateAttempt.matched_event?.created_at || null,
      cooldown_remaining_ms: remainingMs > 0 ? remainingMs : 0,
      fingerprint,
    })
  }

  return buildDecision({
    can_run: true,
    allowed: true,
    should_defer: false,
    cooldown_active: false,
    decision: 'allow',
    normalized_reason: 'recovery_allowed',
    user_message: 'A cobrança avulsa pode ser iniciada.',
    support_message: 'Recovery permitido pela politica interna.',
    action_recommendation: 'run_recovery_charge',
    fingerprint,
  })
}

export function canCreateSubscription({
  currentSubscription = null,
  recentEvents = [],
  targetPlan = null,
  billingCycle = null,
  nowMs = Date.now(),
} = {}) {
  const normalizedPlan = normalizeText(targetPlan)
  const normalizedCycle = normalizeText(billingCycle)
  const paymentMethod = normalizeText(currentSubscription?.paymentMethod)
  const latestRecentMutation = (Array.isArray(recentEvents) ? recentEvents : []).find((event) => {
    if (!RECOVERY_SETUP_EVENT_TYPES.has(String(event?.event_type || '').trim())) return false
    if (!isEventWithinWindow(event, SUBSCRIPTION_CREATE_DEDUP_WINDOW_MS, nowMs)) return false
    const eventPlan = getEventPlan(event)
    const eventCycle = getEventBillingCycle(event)
    if (normalizedPlan && eventPlan && eventPlan !== normalizedPlan) return false
    if (normalizedCycle && eventCycle && eventCycle !== normalizedCycle) return false
    return true
  }) || null

  if (
    currentSubscription?.gatewaySubscriptionId &&
    paymentMethod === 'credit_card' &&
    normalizeText(currentSubscription.plan) === normalizedPlan &&
    normalizeText(currentSubscription.billingCycle) === normalizedCycle &&
    latestRecentMutation
  ) {
    return {
      allowed: false,
      decision: 'block',
      normalized_reason: 'recent_subscription_setup',
      user_message: 'Já existe uma configuração recente de assinatura no cartão para este plano. Aguarde alguns instantes antes de tentar novamente.',
      support_message: 'Criação/atualização de assinatura bloqueada por deduplicação de onboarding.',
      cooldown_active: true,
      matched_event_type: latestRecentMutation.event_type || null,
      matched_event_at: latestRecentMutation.created_at || null,
    }
  }

  return {
    allowed: true,
    decision: 'allow',
    normalized_reason: 'subscription_create_allowed',
    user_message: 'A configuração da assinatura pode ser criada.',
    support_message: 'Criação/atualização de assinatura permitida.',
    cooldown_active: false,
    matched_event_type: null,
    matched_event_at: null,
  }
}
