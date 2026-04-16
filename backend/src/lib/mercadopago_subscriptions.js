import fetch from 'node-fetch'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import {
  claimMercadoPagoDisposableCardToken,
  extractMercadoPagoErrorSnapshot,
  getMercadoPagoCredentialDiagnostics,
  markMercadoPagoDisposableCardTokenOutcome,
  sanitizeMercadoPagoSensitivePayload,
  toMercadoPagoCardFlowError,
} from './mercadopago_card_tokens.js'
import { getBillingCycleConfig, getPlanLabel, getPlanPriceCents, normalizeBillingCycle, PLAN_TIERS } from './plans.js'
import { summarizeMercadoPagoGatewayResult } from './mercadopago_payment_outcome.js'
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

function ensureAccessToken(accessTokenOverride = null) {
  const accessToken = accessTokenOverride || config.billing?.mercadopago?.accessToken
  if (!accessToken && !MOCK_MP) {
    throw new Error('mercadopago_access_token_missing')
  }
  return accessToken
}

function resolveCredentialDiagnostics(accessTokenOverride = null) {
  return getMercadoPagoCredentialDiagnostics({
    publicKey: config.billing?.mercadopago?.publicKey || null,
    accessToken: accessTokenOverride || config.billing?.mercadopago?.accessToken || null,
  })
}

function resolveMercadoPagoEnvironmentLabel(diagnostics = null) {
  if (!diagnostics) return 'unknown'
  if (diagnostics.access_token_environment && diagnostics.access_token_environment !== 'missing') {
    return diagnostics.access_token_environment
  }
  if (diagnostics.public_key_environment && diagnostics.public_key_environment !== 'missing') {
    return diagnostics.public_key_environment
  }
  return 'unknown'
}

function logMercadoPagoCredentialMismatch(scope, diagnostics, extra = {}) {
  if (!diagnostics || diagnostics.consistent_environment !== false) return
  console.warn(`[mercadopago/${scope}] credential_environment_mismatch`, {
    ...extra,
    public_key_environment: diagnostics.public_key_environment,
    access_token_environment: diagnostics.access_token_environment,
  })
}

function logMercadoPagoCardOperation(level, tag, payload) {
  const logger = console[level] || console.info
  logger(`[mercadopago/card-token] ${tag}`, sanitizeMercadoPagoSensitivePayload(payload))
}

function amountToGatewayValue(amountCents) {
  return Number((Number(amountCents || 0) / 100).toFixed(2))
}

function buildBackUrl() {
  return `${FRONTEND_BASE}/assinatura`
}

function buildBillingWebhookUrl() {
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONTEND_BASE)
  const defaultApi = isDevFront ? 'http://localhost:3002' : `${FRONTEND_BASE}/api`
  const apiBase = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || defaultApi).replace(/\/$/, '')
  return apiBase.endsWith('/api') ? `${apiBase}/billing/webhook` : `${apiBase}/api/billing/webhook`
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

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

function splitFullName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: null, lastName: null }
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function inferIdentificationType(value) {
  const digits = digitsOnly(value)
  if (digits.length === 11) return 'CPF'
  if (digits.length === 14) return 'CNPJ'
  return null
}

function normalizeIdentification({ type = null, number = null } = {}) {
  const normalizedNumber = digitsOnly(number)
  if (!normalizedNumber) return null
  const normalizedType = String(type || '').trim().toUpperCase() || inferIdentificationType(normalizedNumber)
  if (!normalizedType) return null
  return {
    type: normalizedType,
    number: normalizedNumber,
  }
}

function normalizeBrazilPhone(value) {
  const digits = digitsOnly(value)
  if (!digits) return null
  let normalized = digits
  if (normalized.startsWith('55') && normalized.length >= 12) {
    normalized = normalized.slice(2)
  }
  if (normalized.length < 10 || normalized.length > 11) return null
  return {
    area_code: normalized.slice(0, 2),
    number: normalized.slice(2),
  }
}

function normalizeAddress(address = {}) {
  if (!address || typeof address !== 'object') return null
  const zipCode = digitsOnly(address.zipCode || address.zip_code || address.cep)
  const streetName = String(address.streetName || address.street_name || address.endereco || '').trim()
  const streetNumberRaw = String(address.streetNumber || address.street_number || address.numero || '').trim()
  const neighborhood = String(address.neighborhood || address.bairro || '').trim()
  const city = String(address.city || address.cidade || '').trim()
  const federalUnit = String(address.federalUnit || address.federal_unit || address.estado || '').trim().toUpperCase()
  const normalized = {}
  if (zipCode) normalized.zip_code = zipCode
  if (streetName) normalized.street_name = streetName
  if (/^\d+$/.test(streetNumberRaw)) normalized.street_number = Number(streetNumberRaw)
  else if (streetNumberRaw) normalized.street_number = streetNumberRaw
  if (neighborhood) normalized.neighborhood = neighborhood
  if (city) normalized.city = city
  if (federalUnit) normalized.federal_unit = federalUnit
  return Object.keys(normalized).length ? normalized : null
}

function buildMercadoPagoPaymentPayer(payerProfile = {}, { fallbackEmail = null } = {}) {
  const email = String(payerProfile?.email || fallbackEmail || '').trim() || null
  const nameParts = splitFullName(payerProfile?.fullName || payerProfile?.name || payerProfile?.cardholderName)
  const identification = normalizeIdentification({
    type: payerProfile?.identification?.type || payerProfile?.identificationType || null,
    number: payerProfile?.identification?.number || payerProfile?.identificationNumber || null,
  })
  const phone = normalizeBrazilPhone(payerProfile?.phone || payerProfile?.telefone)
  const address = normalizeAddress(payerProfile?.address || {})

  const payer = {}
  if (email) payer.email = email
  if (nameParts.firstName) payer.first_name = nameParts.firstName
  if (nameParts.lastName) payer.last_name = nameParts.lastName
  if (identification) payer.identification = identification
  if (phone) payer.phone = phone
  if (address) payer.address = address
  return Object.keys(payer).length ? payer : null
}

function buildMercadoPagoAdditionalInfo({
  payerProfile = {},
  description = null,
  amountCents = null,
  subscription = null,
} = {}) {
  const nameParts = splitFullName(payerProfile?.fullName || payerProfile?.name || payerProfile?.cardholderName)
  const phone = normalizeBrazilPhone(payerProfile?.phone || payerProfile?.telefone)
  const address = normalizeAddress(payerProfile?.address || {})
  const payer = {}
  if (nameParts.firstName) payer.first_name = nameParts.firstName
  if (nameParts.lastName) payer.last_name = nameParts.lastName
  if (phone) payer.phone = phone
  if (address) payer.address = address

  const items = []
  if (amountCents != null) {
    items.push({
      id: subscription?.id != null ? `subscription:${subscription.id}` : 'subscription_recovery',
      title: description || 'Regularizacao de assinatura',
      description: description || 'Regularizacao de assinatura',
      quantity: 1,
      unit_price: amountToGatewayValue(amountCents),
      category_id: 'services',
      type: 'service',
    })
  }

  const additionalInfo = {}
  if (Object.keys(payer).length) additionalInfo.payer = payer
  if (items.length) additionalInfo.items = items
  return Object.keys(additionalInfo).length ? additionalInfo : undefined
}

function maskDocumentForLog(value) {
  const digits = digitsOnly(value)
  if (!digits) return null
  if (digits.length <= 4) return `***${digits.slice(-1)}`
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`
}

function summarizePayerForLog(payer = null) {
  if (!payer || typeof payer !== 'object') return null
  return {
    email_present: Boolean(payer.email),
    first_name_present: Boolean(payer.first_name),
    last_name_present: Boolean(payer.last_name),
    identification_type: payer.identification?.type || null,
    identification_masked: maskDocumentForLog(payer.identification?.number || null),
    phone_present: Boolean(payer.phone?.number),
    zip_code_present: Boolean(payer.address?.zip_code),
    city_present: Boolean(payer.address?.city),
    federal_unit_present: Boolean(payer.address?.federal_unit),
  }
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
  const paymentResult = summarizeMercadoPagoGatewayResult(data)

  return {
    id: data.id || null,
    preapprovalId: data.preapproval_id || data.subscription_id || null,
    status: paymentResult?.should_activate_subscription
      ? 'active'
      : paymentResult?.status_group === 'pending'
        ? 'pending_payment'
        : 'past_due',
    rawStatus: data.status || null,
    statusDetail: data.status_detail || null,
    paymentMethod: normalizePaymentMethod(data.payment_method_id || 'credit_card') || 'credit_card',
    paymentTypeId: data.payment_type_id || null,
    amountCents: data.transaction_amount != null
      ? Math.round(Number(data.transaction_amount || 0) * 100)
      : null,
    currency: data.currency_id || BILLING_CURRENCY,
    paidAt: data.date_approved || data.last_modified || null,
    liveMode: data.live_mode ?? null,
    paymentResult,
    raw: data,
  }
}

function mapCardChargeResponse(data) {
  if (!data) return null
  const paymentResult = summarizeMercadoPagoGatewayResult(data)

  return {
    id: data.id || null,
    status: paymentResult?.should_activate_subscription
      ? 'active'
      : paymentResult?.status_group === 'pending'
        ? 'pending_payment'
        : 'past_due',
    rawStatus: data.status || null,
    statusDetail: data.status_detail || null,
    paymentMethod: normalizePaymentMethod(data.payment_method_id || 'credit_card') || 'credit_card',
    paymentTypeId: data.payment_type_id || null,
    amountCents: data.transaction_amount != null
      ? Math.round(Number(data.transaction_amount || 0) * 100)
      : null,
    currency: data.currency_id || BILLING_CURRENCY,
    paidAt: data.date_approved || data.last_modified || null,
    externalReference: data.external_reference || null,
    liveMode: data.live_mode ?? null,
    paymentResult,
    raw: data,
  }
}

async function mercadoPagoRequest(path, { method = 'GET', body, headers = {}, accessToken = null } = {}) {
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

  const resolvedAccessToken = ensureAccessToken(accessToken)
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${resolvedAccessToken}`,
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

export async function createMercadoPagoCardPreapproval({
  amountCents,
  billingCycle,
  cardToken,
  payer = {},
  reason = null,
  backUrl = null,
  externalReference = null,
  startDate = null,
  accessToken = null,
  requestContext = {},
} = {}) {
  const normalizedCycle = normalizeBillingCycle(billingCycle || 'mensal')
  if (!cardToken) throw new Error('card_token_required')
  if (!Number.isFinite(Number(amountCents)) || Number(amountCents) <= 0) {
    throw new Error('amount_cents_required')
  }

  const cycleConfig = getBillingCycleConfig(normalizedCycle)
  const resolvedStartDate = startDate || buildFutureSubscriptionStartDate(Date.now())
  const payload = {
    reason: reason || `Assinatura recorrente (${cycleConfig.label})`,
    payer_email: payer.email || null,
    card_token_id: cardToken,
    back_url: backUrl || buildBackUrl(),
    external_reference: externalReference || randomUUID(),
    status: 'authorized',
    auto_recurring: {
      frequency: Number(cycleConfig.frequency || 1),
      frequency_type: cycleConfig.frequencyType || 'months',
      transaction_amount: amountToGatewayValue(amountCents),
      currency_id: BILLING_CURRENCY,
      start_date: resolvedStartDate,
    },
  }

  const credentialDiagnostics = resolveCredentialDiagnostics(accessToken)
  logMercadoPagoCredentialMismatch('preapproval', credentialDiagnostics, {
    operation: requestContext?.operation || 'card_subscription_create',
    request_id: requestContext?.requestId || null,
  })
  const tokenClaim = claimMercadoPagoDisposableCardToken({
    token: cardToken,
    operation: requestContext?.operation || 'card_subscription_create',
    endpoint: '/preapproval',
    environment: resolveMercadoPagoEnvironmentLabel(credentialDiagnostics),
    externalReference: payload.external_reference || null,
    requestId: requestContext?.requestId || null,
  })
  logMercadoPagoCardOperation('info', 'consume', {
    ...tokenClaim.logMeta,
    credential_diagnostics: credentialDiagnostics,
  })

  validateFutureSubscriptionStartDate(payload.auto_recurring.start_date, { nowMs: Date.now() })
  try {
    const response = await mercadoPagoRequest('/preapproval', {
      method: 'POST',
      body: payload,
      accessToken,
    })
    markMercadoPagoDisposableCardTokenOutcome(cardToken, 'success', {
      gateway_status: response?.status || null,
      gateway_reference: response?.id || null,
    })
    return {
      request: sanitizeMercadoPagoSensitivePayload(payload),
      subscription: mapPreapprovalResponse(response, {
        fallbackPlan: 'custom',
        fallbackCycle: normalizedCycle,
        fallbackStartDate: resolvedStartDate,
      }),
      raw: response,
    }
  } catch (error) {
    const snapshot = extractMercadoPagoErrorSnapshot(error)
    markMercadoPagoDisposableCardTokenOutcome(cardToken, 'error', {
      gateway_status: snapshot.status,
      gateway_error: snapshot.gateway_error,
      gateway_cause_code: snapshot.gateway_cause_code,
    })
    logMercadoPagoCardOperation('error', 'gateway_failure', {
      ...tokenClaim.logMeta,
      credential_diagnostics: credentialDiagnostics,
      gateway_error: snapshot,
    })
    throw toMercadoPagoCardFlowError(error) || error
  }
}

export async function createMercadoPagoCardSubscription({
  estabelecimento,
  plan,
  billingCycle,
  cardToken,
  payer = {},
  reason = null,
  backUrl = null,
  requestContext = {},
} = {}) {
  if (!estabelecimento?.id) throw new Error('estabelecimento_invalido')
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) throw new Error('plano_invalido')
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const amountCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  const startDate = buildFutureSubscriptionStartDate(Date.now())
  console.info('[mercadopago/subscriptions][preapproval] sending', {
    estabelecimento_id: estabelecimento.id,
    plan: normalizedPlan,
    billing_cycle: normalizedCycle,
    start_date: startDate,
  })

  try {
    return await createMercadoPagoCardPreapproval({
      amountCents,
      billingCycle: normalizedCycle,
      cardToken,
      payer: { ...payer, email: payer.email || estabelecimento.email },
      reason: reason || `Assinatura Agendamentos Online - ${getPlanLabel(normalizedPlan)} (${getBillingCycleConfig(normalizedCycle).label})`,
      backUrl,
      externalReference: buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle),
      startDate,
      requestContext: {
        ...requestContext,
        operation: requestContext?.operation || 'card_subscription_create',
      },
    })
  } catch (error) {
    console.error('[mercadopago/subscriptions][preapproval] failed', {
      estabelecimento_id: estabelecimento.id,
      plan: normalizedPlan,
      billing_cycle: normalizedCycle,
      start_date: startDate,
      status: error?.status || null,
      response: sanitizeMercadoPagoSensitivePayload(error?.responseData || null),
      message: error?.message || String(error),
      request_id: requestContext?.requestId || null,
      details: error?.details || null,
    })
    throw error
  }
}

export async function getMercadoPagoCardSubscription(gatewaySubscriptionId, { fallbackPlan = 'starter', fallbackCycle = 'mensal', accessToken = null } = {}) {
  if (!gatewaySubscriptionId) throw new Error('gateway_subscription_id_required')
  const response = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(String(gatewaySubscriptionId))}`, { accessToken })
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
  accessToken = null,
  requestContext = {},
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

  const credentialDiagnostics = resolveCredentialDiagnostics(accessToken)
  logMercadoPagoCredentialMismatch('preapproval_update', credentialDiagnostics, {
    operation: requestContext?.operation || 'card_subscription_update',
    request_id: requestContext?.requestId || null,
    preapproval_id: gatewaySubscriptionId,
  })
  let tokenClaim = null
  if (cardToken) {
    tokenClaim = claimMercadoPagoDisposableCardToken({
      token: cardToken,
      operation: requestContext?.operation || 'card_subscription_update',
      endpoint: `/preapproval/${encodeURIComponent(String(gatewaySubscriptionId))}`,
      environment: resolveMercadoPagoEnvironmentLabel(credentialDiagnostics),
      preapprovalId: gatewaySubscriptionId,
      requestId: requestContext?.requestId || null,
      externalReference: requestContext?.externalReference || null,
      subscriptionId: requestContext?.subscriptionId || null,
    })
    logMercadoPagoCardOperation('info', 'consume', {
      ...tokenClaim.logMeta,
      credential_diagnostics: credentialDiagnostics,
    })
  }

  try {
    const response = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(String(gatewaySubscriptionId))}`, {
      method: 'PUT',
      body: payload,
      accessToken,
    })
    if (cardToken) {
      markMercadoPagoDisposableCardTokenOutcome(cardToken, 'success', {
        gateway_status: response?.status || null,
        gateway_reference: response?.id || gatewaySubscriptionId || null,
      })
    }
    return {
      request: sanitizeMercadoPagoSensitivePayload(payload),
      subscription: mapPreapprovalResponse(response),
      raw: response,
    }
  } catch (error) {
    const snapshot = extractMercadoPagoErrorSnapshot(error)
    if (cardToken) {
      markMercadoPagoDisposableCardTokenOutcome(cardToken, 'error', {
        gateway_status: snapshot.status,
        gateway_error: snapshot.gateway_error,
        gateway_cause_code: snapshot.gateway_cause_code,
      })
      logMercadoPagoCardOperation('error', 'gateway_failure', {
        ...(tokenClaim?.logMeta || {}),
        credential_diagnostics: credentialDiagnostics,
        gateway_error: snapshot,
      })
    }
    throw toMercadoPagoCardFlowError(error) || error
  }
}

export async function cancelMercadoPagoCardSubscription(gatewaySubscriptionId, { accessToken = null } = {}) {
  return updateMercadoPagoCardSubscription(gatewaySubscriptionId, { status: 'cancelled', accessToken })
}

export async function createMercadoPagoCardRecoveryPayment({
  subscription,
  estabelecimento,
  amountCents,
  description,
  cardToken,
  payerEmail,
  payerProfile = null,
  paymentMethodId = null,
  issuerId = null,
  identificationType = null,
  identificationNumber = null,
  externalReference,
  idempotencyKey,
  accessToken = null,
  requestContext = {},
} = {}) {
  if (!subscription?.gatewaySubscriptionId) throw new Error('gateway_subscription_id_required')
  if (!cardToken) throw new Error('card_token_required')

  const payer = buildMercadoPagoPaymentPayer({
    ...(payerProfile || {}),
    email: payerEmail || payerProfile?.email || estabelecimento?.email || null,
    identificationType: identificationType || payerProfile?.identificationType || null,
    identificationNumber: identificationNumber || payerProfile?.identificationNumber || null,
    identification: payerProfile?.identification || null,
  }, { fallbackEmail: estabelecimento?.email || null })
  const additionalInfo = buildMercadoPagoAdditionalInfo({
    payerProfile,
    description,
    amountCents,
    subscription,
  })

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
      plan: String(subscription.plan || ''),
      billing_cycle: String(subscription.billingCycle || ''),
    },
    notification_url: buildBillingWebhookUrl(),
    payer: payer || undefined,
    additional_info: additionalInfo,
  }
  if (paymentMethodId) body.payment_method_id = paymentMethodId
  if (issuerId) body.issuer_id = issuerId

  console.info('[mercadopago/subscriptions][recovery-payment] sending', {
    subscription_id: subscription.id || null,
    gateway_subscription_id: subscription.gatewaySubscriptionId || null,
    ignored_gateway_customer_id: subscription.gatewayCustomerId || null,
    amount_cents: amountCents,
    external_reference: externalReference || null,
    idempotency_key: idempotencyKey || null,
    request_id: requestContext?.requestId || null,
    payer: summarizePayerForLog(payer),
  })

  const credentialDiagnostics = resolveCredentialDiagnostics(accessToken)
  logMercadoPagoCredentialMismatch('recovery_payment', credentialDiagnostics, {
    operation: requestContext?.operation || 'card_recovery_payment',
    request_id: requestContext?.requestId || null,
    preapproval_id: subscription.gatewaySubscriptionId || null,
    subscription_id: subscription.id || null,
  })
  const tokenClaim = claimMercadoPagoDisposableCardToken({
    token: cardToken,
    operation: requestContext?.operation || 'card_recovery_payment',
    endpoint: '/v1/payments',
    environment: resolveMercadoPagoEnvironmentLabel(credentialDiagnostics),
    externalReference: externalReference || null,
    subscriptionId: subscription.id || null,
    preapprovalId: subscription.gatewaySubscriptionId || null,
    requestId: requestContext?.requestId || null,
  })
  logMercadoPagoCardOperation('info', 'consume', {
    ...tokenClaim.logMeta,
    credential_diagnostics: credentialDiagnostics,
    idempotency_key_present: Boolean(idempotencyKey),
  })

  try {
    const response = await mercadoPagoRequest('/v1/payments', {
      method: 'POST',
      body,
      headers: idempotencyKey ? { 'X-Idempotency-Key': String(idempotencyKey) } : {},
      accessToken,
    })
    markMercadoPagoDisposableCardTokenOutcome(cardToken, 'success', {
      gateway_status: response?.status || null,
      gateway_reference: response?.id || null,
    })
    return {
      request: sanitizeMercadoPagoSensitivePayload(body),
      payment: mapCardChargeResponse(response),
      raw: response,
    }
  } catch (error) {
    const snapshot = extractMercadoPagoErrorSnapshot(error)
    markMercadoPagoDisposableCardTokenOutcome(cardToken, 'error', {
      gateway_status: snapshot.status,
      gateway_error: snapshot.gateway_error,
      gateway_cause_code: snapshot.gateway_cause_code,
    })
    console.error('[mercadopago/subscriptions][recovery-payment] failed', {
      subscription_id: subscription.id || null,
      gateway_subscription_id: subscription.gatewaySubscriptionId || null,
      amount_cents: amountCents,
      external_reference: externalReference || null,
      idempotency_key: idempotencyKey || null,
      request_id: requestContext?.requestId || null,
      status: snapshot.status,
      response: sanitizeMercadoPagoSensitivePayload(error?.responseData || null),
      message: error?.message || String(error),
      details: error?.details || null,
    })
    logMercadoPagoCardOperation('error', 'gateway_failure', {
      ...tokenClaim.logMeta,
      credential_diagnostics: credentialDiagnostics,
      gateway_error: snapshot,
      idempotency_key_present: Boolean(idempotencyKey),
    })
    throw toMercadoPagoCardFlowError(error) || error
  }
}

export async function getMercadoPagoAuthorizedPayment(authorizedPaymentId, { accessToken = null } = {}) {
  if (!authorizedPaymentId) throw new Error('authorized_payment_id_required')
  const response = await mercadoPagoRequest(`/authorized_payments/${encodeURIComponent(String(authorizedPaymentId))}`, { accessToken })
  return {
    authorizedPayment: mapAuthorizedPaymentResponse(response),
    raw: response,
  }
}
