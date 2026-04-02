import fetch from 'node-fetch'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { getBillingCycleConfig, getPlanLabel, getPlanPriceCents, normalizeBillingCycle, PLAN_TIERS } from './plans.js'
import { normalizePaymentMethod, normalizeSubscriptionStatus } from './subscription_normalization.js'

const API_BASE = 'https://api.mercadopago.com'
const BILLING_CURRENCY = (config.billing?.currency || 'BRL').toUpperCase()
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const MOCK_MP = (() => {
  try {
    const raw = String(process.env.MERCADOPAGO_MOCK || process.env.BILLING_MOCK_MERCADOPAGO || '').toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  } catch {
    return false
  }
})()

const mockPreapprovals = new Map()
const mockAuthorizedPayments = new Map()
const SUBSCRIPTION_START_DATE_OFFSET_MS = 10 * 60 * 1000
const SUBSCRIPTION_START_DATE_MIN_LEAD_MS = 60 * 1000

function ensureAccessToken() {
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken && !MOCK_MP) {
    throw new Error('mercadopago_access_token_missing')
  }
  return accessToken
}

function amountToGatewayValue(amountCents) {
  return Number((Number(amountCents || 0) / 100).toFixed(2))
}

function buildBackUrl() {
  return `${FRONTEND_BASE}/assinatura`
}

function buildExternalReference(estabelecimentoId, plan, cycle) {
  return [
    'subscription',
    'card',
    'plan',
    String(plan || 'starter').toLowerCase(),
    'cycle',
    normalizeBillingCycle(cycle),
    'est',
    String(estabelecimentoId || ''),
    'uuid',
    randomUUID(),
  ].join(':')
}

function buildFutureSubscriptionStartDate(nowMs = Date.now()) {
  const startDate = new Date(nowMs + SUBSCRIPTION_START_DATE_OFFSET_MS).toISOString()
  validateFutureSubscriptionStartDate(startDate, { nowMs })
  return startDate
}

function validateFutureSubscriptionStartDate(startDate, { nowMs = Date.now() } = {}) {
  const parsedMs = Date.parse(startDate)
  if (!Number.isFinite(parsedMs)) {
    throw new Error('mercadopago_subscription_start_date_invalid')
  }
  if ((parsedMs - nowMs) < SUBSCRIPTION_START_DATE_MIN_LEAD_MS) {
    throw new Error('mercadopago_subscription_start_date_too_close')
  }
  return startDate
}

function normalizeGatewayIsoDate(value) {
  if (!value) return null
  const parsedMs = Date.parse(value)
  if (!Number.isFinite(parsedMs)) return null
  return new Date(parsedMs).toISOString()
}

function mapPreapprovalResponse(data, { fallbackPlan = 'starter', fallbackCycle = 'mensal', fallbackStartDate = null } = {}) {
  if (!data) return null
  const autoRecurring = data.auto_recurring || {}
  const paymentMethod = normalizePaymentMethod(data.payment_method_id || 'credit_card') || 'credit_card'
  const frequencyType = String(autoRecurring.frequency_type || '').toLowerCase()
  const mappedCycle = frequencyType === 'years' || frequencyType === 'year'
    ? 'anual'
    : fallbackCycle
  const rawStatus = String(data.status || '').toLowerCase()
  const normalizedStartDate = normalizeGatewayIsoDate(autoRecurring.start_date) || normalizeGatewayIsoDate(fallbackStartDate)
  const normalizedNextBillingAt =
    normalizeGatewayIsoDate(data.next_payment_date) ||
    normalizedStartDate
  return {
    gatewaySubscriptionId: data.id || null,
    gatewayCustomerId: data.payer_id || data.payer?.id || null,
    status: rawStatus === 'authorized'
      ? 'pending_payment'
      : normalizeSubscriptionStatus(data.status, { paymentMethod }),
    paymentMethod,
    reason: data.reason || null,
    externalReference: data.external_reference || null,
    initPoint: data.init_point || null,
    backUrl: data.back_url || null,
    payerEmail: data.payer_email || null,
    cardId: data.card_id || null,
    nextBillingAt: normalizedNextBillingAt,
    currentPeriodStart: normalizedStartDate,
    currentPeriodEnd: normalizedNextBillingAt,
    amountCents: autoRecurring.transaction_amount != null
      ? Math.round(Number(autoRecurring.transaction_amount || 0) * 100)
      : null,
    currency: autoRecurring.currency_id || BILLING_CURRENCY,
    billingCycle: normalizeBillingCycle(mappedCycle),
    plan: fallbackPlan,
    raw: data,
  }
}

function mapAuthorizedPaymentResponse(data) {
  if (!data) return null
  const statusRaw = String(data.status || '').toLowerCase()
  let status = 'pending_payment'
  if (statusRaw === 'approved') status = 'active'
  else if (['pending', 'in_process', 'authorized'].includes(statusRaw)) status = 'pending_payment'
  else if (['rejected', 'cancelled', 'canceled', 'failed', 'refunded', 'charged_back'].includes(statusRaw)) status = 'past_due'

  return {
    id: data.id || null,
    preapprovalId: data.preapproval_id || data.subscription_id || null,
    status,
    rawStatus: data.status || null,
    paymentMethod: normalizePaymentMethod(data.payment_method_id || 'credit_card') || 'credit_card',
    amountCents: data.transaction_amount != null
      ? Math.round(Number(data.transaction_amount || 0) * 100)
      : null,
    currency: data.currency_id || BILLING_CURRENCY,
    paidAt: data.date_approved || data.last_modified || null,
    raw: data,
  }
}

function mapCardChargeResponse(data) {
  if (!data) return null
  const statusRaw = String(data.status || '').toLowerCase()
  let status = 'pending_payment'
  if (statusRaw === 'approved') status = 'active'
  else if (['pending', 'in_process', 'authorized'].includes(statusRaw)) status = 'pending_payment'
  else if (['rejected', 'cancelled', 'canceled', 'failed', 'refunded', 'charged_back'].includes(statusRaw)) status = 'past_due'

  return {
    id: data.id || null,
    status,
    rawStatus: data.status || null,
    paymentMethod: normalizePaymentMethod(data.payment_method_id || 'credit_card') || 'credit_card',
    amountCents: data.transaction_amount != null
      ? Math.round(Number(data.transaction_amount || 0) * 100)
      : null,
    currency: data.currency_id || BILLING_CURRENCY,
    paidAt: data.date_approved || data.last_modified || null,
    externalReference: data.external_reference || null,
    raw: data,
  }
}

async function mercadoPagoRequest(path, { method = 'GET', body, headers = {} } = {}) {
  if (MOCK_MP) {
    const normalizedPath = String(path || '')
    if (method === 'POST' && normalizedPath === '/preapproval') {
      const id = `mock-preapproval-${mockPreapprovals.size + 1}`
      const nextPaymentDate = body?.auto_recurring?.start_date || new Date(Date.now() + 3600000).toISOString()
      const record = {
        id,
        payer_id: `mock-customer-${mockPreapprovals.size + 1}`,
        status: body?.status || 'authorized',
        reason: body?.reason || null,
        external_reference: body?.external_reference || null,
        payer_email: body?.payer_email || null,
        card_id: `mock-card-${mockPreapprovals.size + 1}`,
        next_payment_date: nextPaymentDate,
        back_url: body?.back_url || null,
        auto_recurring: body?.auto_recurring || null,
        payment_method_id: 'credit_card',
      }
      mockPreapprovals.set(id, record)
      return record
    }

    const preapprovalMatch = normalizedPath.match(/^\/preapproval\/(.+)$/)
    if (preapprovalMatch && method === 'GET') {
      return mockPreapprovals.get(preapprovalMatch[1]) || null
    }
    if (preapprovalMatch && method === 'PUT') {
      const current = mockPreapprovals.get(preapprovalMatch[1]) || { id: preapprovalMatch[1] }
      const updated = {
        ...current,
        ...body,
        auto_recurring: body?.auto_recurring ? { ...(current.auto_recurring || {}), ...body.auto_recurring } : current.auto_recurring,
      }
      mockPreapprovals.set(preapprovalMatch[1], updated)
      return updated
    }

    const authorizedMatch = normalizedPath.match(/^\/authorized_payments\/(.+)$/)
    if (authorizedMatch && method === 'GET') {
      return mockAuthorizedPayments.get(authorizedMatch[1]) || null
    }

    if (method === 'POST' && normalizedPath === '/v1/payments') {
      return {
        id: `mock-card-payment-${mockAuthorizedPayments.size + 1}`,
        status: String(body?.token || '').toLowerCase().includes('fail') ? 'rejected' : 'approved',
        transaction_amount: body?.transaction_amount || null,
        currency_id: BILLING_CURRENCY,
        payment_method_id: body?.payment_method_id || 'visa',
        external_reference: body?.external_reference || null,
        date_approved: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      }
    }
  }

  const accessToken = ensureAccessToken()
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null)

  if (!response.ok) {
    const detail = data && typeof data === 'object'
      ? JSON.stringify(data)
      : String(data || response.statusText || `HTTP ${response.status}`)
    const error = new Error(`mercadopago_subscription_error:${method}:${path}:${detail}`)
    error.status = response.status
    error.responseData = data
    error.method = method
    error.path = path
    throw error
  }

  return data
}

export function getMercadoPagoPublicKey() {
  return config.billing?.mercadopago?.publicKey || null
}

export async function createMercadoPagoCardSubscription({
  estabelecimento,
  plan,
  billingCycle,
  cardToken,
  payer = {},
  reason = null,
  backUrl = null,
} = {}) {
  if (!estabelecimento?.id) throw new Error('estabelecimento_invalido')
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) throw new Error('plano_invalido')
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  if (!cardToken) throw new Error('card_token_required')

  const cycleConfig = getBillingCycleConfig(normalizedCycle)
  const amountCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  const startDate = buildFutureSubscriptionStartDate(Date.now())
  const payload = {
    reason: reason || `Assinatura Agendamentos Online - ${getPlanLabel(normalizedPlan)} (${cycleConfig.label})`,
    payer_email: payer.email || estabelecimento.email,
    card_token_id: cardToken,
    back_url: backUrl || buildBackUrl(),
    external_reference: buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle),
    status: 'authorized',
    auto_recurring: {
      frequency: Number(cycleConfig.frequency || 1),
      frequency_type: cycleConfig.frequencyType || 'months',
      transaction_amount: amountToGatewayValue(amountCents),
      currency_id: BILLING_CURRENCY,
      start_date: startDate,
    },
  }

  validateFutureSubscriptionStartDate(payload.auto_recurring.start_date, { nowMs: Date.now() })
  console.info('[mercadopago/subscriptions][preapproval] sending', {
    estabelecimento_id: estabelecimento.id,
    plan: normalizedPlan,
    billing_cycle: normalizedCycle,
    start_date: payload.auto_recurring.start_date,
  })

  try {
    const response = await mercadoPagoRequest('/preapproval', { method: 'POST', body: payload })
    return {
      request: payload,
      subscription: mapPreapprovalResponse(response, {
        fallbackPlan: normalizedPlan,
        fallbackCycle: normalizedCycle,
        fallbackStartDate: startDate,
      }),
      raw: response,
    }
  } catch (error) {
    console.error('[mercadopago/subscriptions][preapproval] failed', {
      estabelecimento_id: estabelecimento.id,
      plan: normalizedPlan,
      billing_cycle: normalizedCycle,
      start_date: startDate,
      status: error?.status || null,
      response: error?.responseData || null,
      message: error?.message || String(error),
    })
    throw error
  }
}

export async function getMercadoPagoCardSubscription(gatewaySubscriptionId, { fallbackPlan = 'starter', fallbackCycle = 'mensal' } = {}) {
  if (!gatewaySubscriptionId) throw new Error('gateway_subscription_id_required')
  const response = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(String(gatewaySubscriptionId))}`)
  return {
    subscription: mapPreapprovalResponse(response, { fallbackPlan, fallbackCycle }),
    raw: response,
  }
}

export async function updateMercadoPagoCardSubscription(gatewaySubscriptionId, {
  cardToken = null,
  payerEmail = null,
  amountCents = null,
  billingCycle = null,
  status = null,
  startDate = null,
} = {}) {
  if (!gatewaySubscriptionId) throw new Error('gateway_subscription_id_required')
  const payload = {}
  if (cardToken) payload.card_token_id = cardToken
  if (payerEmail) payload.payer_email = payerEmail
  if (status) payload.status = status
  if (amountCents != null || billingCycle || startDate) {
    const normalizedCycle = normalizeBillingCycle(billingCycle || 'mensal')
    const cycleConfig = getBillingCycleConfig(normalizedCycle)
    payload.auto_recurring = {
      frequency: Number(cycleConfig.frequency || 1),
      frequency_type: cycleConfig.frequencyType || 'months',
    }
    if (amountCents != null) {
      payload.auto_recurring.transaction_amount = amountToGatewayValue(amountCents)
      payload.auto_recurring.currency_id = BILLING_CURRENCY
    }
    if (startDate) {
      const normalizedStartDate = normalizeGatewayIsoDate(startDate) || new Date(startDate).toISOString()
      validateFutureSubscriptionStartDate(normalizedStartDate, { nowMs: Date.now() })
      payload.auto_recurring.start_date = normalizedStartDate
    }
  }

  const response = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(String(gatewaySubscriptionId))}`, {
    method: 'PUT',
    body: payload,
  })
  return {
    request: payload,
    subscription: mapPreapprovalResponse(response),
    raw: response,
  }
}

export async function cancelMercadoPagoCardSubscription(gatewaySubscriptionId) {
  return updateMercadoPagoCardSubscription(gatewaySubscriptionId, { status: 'cancelled' })
}

export async function createMercadoPagoCardRecoveryPayment({
  subscription,
  estabelecimento,
  amountCents,
  description,
  cardToken,
  payerEmail,
  paymentMethodId = null,
  issuerId = null,
  identificationType = null,
  identificationNumber = null,
  externalReference,
  idempotencyKey,
} = {}) {
  if (!subscription?.gatewaySubscriptionId) throw new Error('gateway_subscription_id_required')
  if (!cardToken) throw new Error('card_token_required')

  const body = {
    transaction_amount: amountToGatewayValue(amountCents),
    token: cardToken,
    description: description || 'Regularizacao de assinatura Agendamentos Online',
    installments: 1,
    capture: true,
    binary_mode: true,
    external_reference: externalReference || null,
    metadata: {
      kind: 'subscription_recovery',
      subscription_id: String(subscription.id || ''),
      gateway_subscription_id: String(subscription.gatewaySubscriptionId || ''),
      estabelecimento_id: String(estabelecimento?.id || subscription.estabelecimentoId || ''),
    },
    payer: {
      email: payerEmail || estabelecimento?.email || null,
      type: subscription.gatewayCustomerId ? 'customer' : undefined,
      id: subscription.gatewayCustomerId || undefined,
      identification:
        identificationType && identificationNumber
          ? { type: identificationType, number: identificationNumber }
          : undefined,
    },
  }
  if (paymentMethodId) body.payment_method_id = paymentMethodId
  if (issuerId) body.issuer_id = issuerId

  console.info('[mercadopago/subscriptions][recovery-payment] sending', {
    subscription_id: subscription.id || null,
    gateway_subscription_id: subscription.gatewaySubscriptionId || null,
    amount_cents: amountCents,
    external_reference: externalReference || null,
    idempotency_key: idempotencyKey || null,
  })

  try {
    const response = await mercadoPagoRequest('/v1/payments', {
      method: 'POST',
      body,
      headers: idempotencyKey ? { 'X-Idempotency-Key': String(idempotencyKey) } : {},
    })
    return {
      request: body,
      payment: mapCardChargeResponse(response),
      raw: response,
    }
  } catch (error) {
    console.error('[mercadopago/subscriptions][recovery-payment] failed', {
      subscription_id: subscription.id || null,
      gateway_subscription_id: subscription.gatewaySubscriptionId || null,
      amount_cents: amountCents,
      external_reference: externalReference || null,
      idempotency_key: idempotencyKey || null,
      status: error?.status || null,
      response: error?.responseData || null,
      message: error?.message || String(error),
    })
    throw error
  }
}

export async function getMercadoPagoAuthorizedPayment(authorizedPaymentId) {
  if (!authorizedPaymentId) throw new Error('authorized_payment_id_required')
  const response = await mercadoPagoRequest(`/authorized_payments/${encodeURIComponent(String(authorizedPaymentId))}`)
  return {
    authorizedPayment: mapAuthorizedPaymentResponse(response),
    raw: response,
  }
}
