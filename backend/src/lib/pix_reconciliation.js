const PLAN_KEYS = new Set(['starter', 'pro', 'premium'])
const BILLING_CYCLE_KEYS = new Set(['mensal', 'anual'])

function normalizePlanKey(value) {
  const key = String(value || '').trim().toLowerCase()
  return PLAN_KEYS.has(key) ? key : null
}

function normalizeBillingCycleKey(value) {
  const key = String(value || '').trim().toLowerCase()
  return BILLING_CYCLE_KEYS.has(key) ? key : 'mensal'
}

function normalizeStatusKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePaymentMethodKey(value) {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'card' || key === 'credit-card') return 'credit_card'
  return key || null
}

function toPositiveInteger(value) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0 ? Math.trunc(normalized) : null
}

export function parsePixExternalReferenceTokens(externalReference) {
  const raw = String(externalReference || '').trim()
  if (!raw) return {}
  const parts = raw.split(':')
  const tokens = {}
  for (let index = 0; index < parts.length - 1; index += 2) {
    const key = String(parts[index] || '').trim().toLowerCase()
    const value = String(parts[index + 1] || '').trim()
    if (!key || !value) continue
    tokens[key] = value
  }
  return tokens
}

export function buildPixPaymentContext(payment = {}) {
  const externalReference = String(payment?.external_reference || payment?.externalReference || '').trim() || null
  const metadata = payment?.metadata && typeof payment.metadata === 'object' ? payment.metadata : {}
  const tokens = parsePixExternalReferenceTokens(externalReference)
  const metadataKind = String(metadata.kind || metadata.type || '').trim().toLowerCase() || null
  const paymentId = payment?.id != null ? String(payment.id) : null
  const establishmentId =
    toPositiveInteger(metadata.estabelecimento_id) ||
    toPositiveInteger(tokens.est) ||
    null
  const subscriptionId =
    toPositiveInteger(metadata.subscription_id) ||
    toPositiveInteger(metadata.target_subscription_id) ||
    null
  const gatewaySubscriptionId =
    String(metadata.gateway_subscription_id || metadata.preapproval_id || '').trim() || null
  const chargeKind = String(metadata.charge_kind || metadata.kind || '').trim().toLowerCase() || null
  const plan =
    normalizePlanKey(metadata.plan) ||
    normalizePlanKey(tokens.plan) ||
    null
  const billingCycle = normalizeBillingCycleKey(metadata.cycle || metadata.billing_cycle || tokens.cycle)
  const transactionAmountCents = Number.isFinite(Number(payment?.transaction_amount))
    ? Math.round(Number(payment.transaction_amount || 0) * 100)
    : null
  const isTopup = metadataKind === 'whatsapp_topup' || String(tokens.wallet || '').trim().toLowerCase() === 'whatsapp_topup'

  return {
    payment_id: paymentId,
    status: normalizeStatusKey(payment?.status),
    status_detail: normalizeStatusKey(payment?.status_detail),
    payment_method_id: normalizePaymentMethodKey(payment?.payment_method_id),
    payment_type_id: normalizeStatusKey(payment?.payment_type_id),
    external_reference: externalReference,
    metadata,
    metadata_kind: metadataKind,
    establishment_id: establishmentId,
    subscription_id: subscriptionId,
    gateway_subscription_id: gatewaySubscriptionId,
    plan,
    billing_cycle: billingCycle,
    charge_kind: chargeKind,
    transaction_amount_cents: transactionAmountCents,
    is_topup: isTopup,
    tokens,
  }
}

export function buildPixLogicalContext(input = {}) {
  const externalReference = String(input?.externalReference || input?.external_reference || '').trim() || null
  const tokens = parsePixExternalReferenceTokens(externalReference)
  const plan =
    normalizePlanKey(input?.plan) ||
    normalizePlanKey(tokens.plan) ||
    null
  const billingCycle = normalizeBillingCycleKey(input?.billingCycle || input?.billing_cycle || tokens.cycle)
  const chargeKind = String(input?.chargeKind || input?.charge_kind || '').trim().toLowerCase() || null
  const establishmentId =
    toPositiveInteger(input?.estabelecimentoId) ||
    toPositiveInteger(input?.estabelecimento_id) ||
    toPositiveInteger(tokens.est) ||
    null
  const paymentMethod = normalizePaymentMethodKey(input?.paymentMethod || input?.payment_method)
  const status = normalizeStatusKey(input?.status)
  const isTopup = String(tokens.wallet || '').trim().toLowerCase() === 'whatsapp_topup'

  return {
    establishment_id: establishmentId,
    plan,
    billing_cycle: billingCycle,
    charge_kind: chargeKind,
    payment_method: paymentMethod,
    status,
    is_topup: isTopup,
  }
}

export function isSamePixLogicalContext(left, right) {
  const a = buildPixLogicalContext(left)
  const b = buildPixLogicalContext(right)
  if (!a.establishment_id || !b.establishment_id) return false
  if (a.is_topup || b.is_topup) return false
  if (a.establishment_id !== b.establishment_id) return false
  if (a.plan && b.plan && a.plan !== b.plan) return false
  if (a.billing_cycle && b.billing_cycle && a.billing_cycle !== b.billing_cycle) return false
  if (a.charge_kind && b.charge_kind && a.charge_kind !== b.charge_kind) return false
  return true
}

export function scorePixSubscriptionCandidate(subscription, paymentContext = {}) {
  if (!subscription || typeof subscription !== 'object') return { score: 0, reasons: ['invalid_candidate'] }

  const logicalContext = buildPixLogicalContext(subscription)
  if (logicalContext.is_topup !== Boolean(paymentContext.is_topup)) {
    return { score: 0, reasons: ['topup_mismatch'] }
  }

  const reasons = []
  let score = 0
  const subscriptionId = toPositiveInteger(subscription.id)
  const paymentId = String(paymentContext.payment_id || '').trim()
  const gatewayPaymentId = String(subscription.gatewayPaymentId || subscription.gateway_payment_id || '').trim()
  const gatewayPreferenceId = String(subscription.gatewayPreferenceId || subscription.gateway_preference_id || '').trim()
  const externalReference = String(subscription.externalReference || subscription.external_reference || '').trim()

  if (paymentId && gatewayPaymentId && gatewayPaymentId === paymentId) {
    score += 240
    reasons.push('gateway_payment_id')
  }
  if (paymentId && gatewayPreferenceId && gatewayPreferenceId === paymentId) {
    score += 220
    reasons.push('gateway_preference_id')
  }
  if (paymentContext.subscription_id && subscriptionId && subscriptionId === paymentContext.subscription_id) {
    score += 200
    reasons.push('metadata_subscription_id')
  }
  if (
    paymentContext.gateway_subscription_id &&
    String(subscription.gatewaySubscriptionId || subscription.gateway_subscription_id || '').trim() === paymentContext.gateway_subscription_id
  ) {
    score += 180
    reasons.push('gateway_subscription_id')
  }
  if (paymentContext.external_reference && externalReference && externalReference === paymentContext.external_reference) {
    score += 170
    reasons.push('external_reference')
  }
  if (paymentContext.establishment_id && logicalContext.establishment_id === paymentContext.establishment_id) {
    score += 80
    reasons.push('estabelecimento_id')
  }
  if (paymentContext.plan && logicalContext.plan === paymentContext.plan) {
    score += 55
    reasons.push('plan')
  }
  if (paymentContext.billing_cycle && logicalContext.billing_cycle === paymentContext.billing_cycle) {
    score += 45
    reasons.push('billing_cycle')
  }
  if (normalizePaymentMethodKey(logicalContext.payment_method) === 'pix') {
    score += 25
    reasons.push('pix_payment_method')
  }
  if (normalizeStatusKey(logicalContext.status) === 'pending_pix') {
    score += 30
    reasons.push('pending_pix_status')
  }
  if (paymentContext.charge_kind && logicalContext.charge_kind && logicalContext.charge_kind === paymentContext.charge_kind) {
    score += 40
    reasons.push('charge_kind')
  }

  if (
    paymentContext.transaction_amount_cents != null &&
    Number.isFinite(Number(subscription.amountCents || subscription.amount_cents))
  ) {
    const amountCents = Math.trunc(Number(subscription.amountCents || subscription.amount_cents) || 0)
    if (amountCents === paymentContext.transaction_amount_cents) {
      score += 20
      reasons.push('amount_cents')
    }
  }

  const createdAt = subscription.createdAt || subscription.created_at || null
  const createdAtMs = createdAt ? new Date(createdAt).getTime() : 0
  return {
    score,
    reasons,
    created_at_ms: Number.isFinite(createdAtMs) ? createdAtMs : 0,
  }
}

export function selectPixSubscriptionCandidate(subscriptions = [], paymentContext = {}, {
  minimumScore = 120,
} = {}) {
  const candidates = (Array.isArray(subscriptions) ? subscriptions : [])
    .map((subscription) => {
      const evaluation = scorePixSubscriptionCandidate(subscription, paymentContext)
      return {
        subscription,
        score: evaluation.score,
        reasons: evaluation.reasons,
        created_at_ms: evaluation.created_at_ms || 0,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.created_at_ms !== right.created_at_ms) return right.created_at_ms - left.created_at_ms
      return Number(right.subscription?.id || 0) - Number(left.subscription?.id || 0)
    })

  const best = candidates[0] || null
  return {
    candidate: best && best.score >= minimumScore ? best.subscription : null,
    score: best?.score || 0,
    reasons: best?.reasons || [],
    ranked: candidates,
  }
}

export function resolvePixPaymentDisposition({
  status,
  paymentId = null,
  subscriptionLastEventId = null,
  hasObsoleteMarker = false,
} = {}) {
  const normalizedStatus = normalizeStatusKey(status)
  const normalizedPaymentId = String(paymentId || '').trim()
  const normalizedLastEventId = String(subscriptionLastEventId || '').trim()

  if (
    normalizedStatus === 'approved' &&
    normalizedPaymentId &&
    normalizedLastEventId &&
    normalizedPaymentId === normalizedLastEventId
  ) {
    return 'already_processed'
  }

  if (hasObsoleteMarker) {
    return 'stale_superseded'
  }

  if (normalizedStatus === 'approved') {
    return 'apply'
  }

  if (['pending', 'in_process', 'authorized', 'processing', 'created'].includes(normalizedStatus)) {
    return 'pending'
  }

  return 'not_approved'
}
