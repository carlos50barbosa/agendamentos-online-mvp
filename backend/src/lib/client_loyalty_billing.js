import { randomUUID } from 'node:crypto'
import { pool } from './db.js'
import { createMercadoPagoPixPayment, fetchMercadoPagoPayment } from './billing.js'
import {
  cancelMercadoPagoCardSubscription,
  createMercadoPagoCardPreapproval,
  getMercadoPagoAuthorizedPayment,
  getMercadoPagoCardSubscription,
} from './mercadopago_subscriptions.js'
import { getLoyaltyPlanById } from './loyalty_plans.js'
import {
  appendClientLoyaltySubscriptionEvent,
  computeClientLoyaltySubscriptionState,
  createClientLoyaltySubscription,
  getClientLoyaltySubscriptionByExternalReference,
  getClientLoyaltySubscriptionByEventResourceId,
  getClientLoyaltySubscriptionByGatewayId,
  getClientLoyaltySubscriptionByGatewayPaymentId,
  getClientLoyaltySubscriptionById,
  getPreferredClientLoyaltySubscription,
  getClientLoyaltySubscriptionByWebhookResourceId,
  listClientLoyaltySubscriptionEvents,
  normalizeClientLoyaltyGatewayEventId,
  serializeClientLoyaltySubscription,
  updateClientLoyaltySubscription,
} from './client_loyalty_subscriptions.js'
import {
  ensureCreditsForCurrentCycle,
  formatCycleRef,
  listSubscriptionCredits,
} from './client_loyalty_credits.js'
import { getMpAccountBySellerIdentifier, resolveMpAccessToken } from '../services/mpAccounts.js'

const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const CLIENT_LOYALTY_GRACE_DAYS = Number(process.env.CLIENT_LOYALTY_GRACE_DAYS || 3) || 3
const CLIENT_LOYALTY_CARD_START_DELAY_MS = Math.max(
  Number(process.env.CLIENT_LOYALTY_CARD_START_DELAY_MS || 120000) || 120000,
  65000
)
const CLIENT_LOYALTY_CARD_PENDING_WINDOW_MS = Math.max(
  Number(process.env.CLIENT_LOYALTY_CARD_PENDING_WINDOW_MS || 2 * 60 * 60 * 1000) || (2 * 60 * 60 * 1000),
  60000
)
const CLIENT_LOYALTY_HIGH_RISK_COOLDOWN_MS = Math.max(
  Number(process.env.CLIENT_LOYALTY_HIGH_RISK_COOLDOWN_MS || 24 * 60 * 60 * 1000) || (24 * 60 * 60 * 1000),
  60000
)
const CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_WINDOW_MS = Math.max(
  Number(process.env.CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_WINDOW_MS || 15 * 60 * 1000) || (15 * 60 * 1000),
  60000
)
const CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_THRESHOLD = Math.max(
  Number(process.env.CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_THRESHOLD || 2) || 2,
  2
)
const DAY_MS = 86400000
const CLIENT_LOYALTY_HIGH_RISK_CODE = 'cc_rejected_high_risk'
const CLIENT_LOYALTY_HIGH_RISK_STRONG_WARNING_THRESHOLD = 2
const CLIENT_LOYALTY_HIGH_RISK_ACTION_REQUIRED_THRESHOLD = 3

function createError(message, status = 400, code = 'bad_request', details = null) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (details) error.details = details
  return error
}

function toDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function safeJsonParse(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeSpaces(value) {
  return normalizeText(value).replace(/\s+/g, ' ')
}

function splitClientName(value) {
  const normalized = normalizeSpaces(value)
  if (!normalized) return { firstName: null, lastName: null }
  const parts = normalized.split(' ').filter(Boolean)
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

function buildClientPixPayer(cliente = {}) {
  const payer = {}
  const email = normalizeText(cliente?.email).toLowerCase()
  const document = digitsOnly(cliente?.cpf_cnpj || cliente?.cpfCnpj)
  const nameParts = splitClientName(cliente?.nome)
  if (email) payer.email = email
  if (nameParts.firstName) payer.first_name = nameParts.firstName
  if (nameParts.lastName) payer.last_name = nameParts.lastName
  if (document.length === 11 && isValidCpf(document)) {
    payer.identification = { type: 'CPF', number: document }
  } else if (document.length === 14 && isValidCnpj(document)) {
    payer.identification = { type: 'CNPJ', number: document }
  }
  return Object.keys(payer).length ? payer : null
}

export const CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD = 'cardholder_name'
export const CLIENT_LOYALTY_CARDHOLDER_NAME_FIELDS = [
  CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD,
  'cardholderName',
  'payer_name',
  'payerName',
  'holder_name',
  'holderName',
  'name',
]

function digitsOnly(value) {
  return normalizeText(value).replace(/\D/g, '')
}

function isValidEmail(value) {
  const email = normalizeText(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

function isValidCpf(value) {
  const cpf = digitsOnly(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i)
  let digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i)
  digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  return digit === Number(cpf[10])
}

function isValidCnpj(value) {
  const cnpj = digitsOnly(value)
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false

  const calcDigit = (length) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }

  return calcDigit(12) === Number(cnpj[12]) && calcDigit(13) === Number(cnpj[13])
}

export function normalizeClientLoyaltyCardholderName(value) {
  return normalizeSpaces(value)
    .normalize('NFC')
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
}

function getNameParts(value) {
  return normalizeClientLoyaltyCardholderName(value).split(' ').filter(Boolean)
}

function isNameLikePart(part) {
  return /^\p{L}(?:[\p{L}\p{M}'-]*\p{L})?$/u.test(String(part || ''))
}

function isValidNameWord(part) {
  return isNameLikePart(part) && String(part || '').replace(/[-']/g, '').length >= 2
}

export function analyzeClientLoyaltyCardholderName(value) {
  const normalized = normalizeClientLoyaltyCardholderName(value)
  const parts = getNameParts(normalized)
  const validWordCount = parts.filter(isValidNameWord).length
  const invalidPartCount = parts.filter((part) => !isNameLikePart(part)).length
  return {
    normalized,
    length: normalized.length,
    partCount: parts.length,
    wordCount: validWordCount,
    invalidPartCount,
    valid: normalized.length >= 5 && parts.length >= 2 && validWordCount >= 2 && invalidPartCount === 0,
  }
}

function hasMeaningfulFullName(value) {
  return analyzeClientLoyaltyCardholderName(value).valid
}

export function resolveClientLoyaltyCardholderNameInput(input = {}, fields = CLIENT_LOYALTY_CARDHOLDER_NAME_FIELDS) {
  const sourceField = fields.find((field) => normalizeClientLoyaltyCardholderName(input?.[field])) ||
    fields.find((field) => Object.prototype.hasOwnProperty.call(input || {}, field)) ||
    CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD
  const analysis = analyzeClientLoyaltyCardholderName(input?.[sourceField])
  return {
    value: input?.[sourceField] || '',
    normalized: analysis.normalized,
    sourceField,
    fieldPresent: Boolean(analysis.normalized),
    analysis,
  }
}

function getClientLoyaltyCardholderNameDebugInfo(input = {}) {
  const resolved = input?.analysis ? input : resolveClientLoyaltyCardholderNameInput(input)
  return {
    field_present: Boolean(resolved.normalized),
    length: resolved.analysis?.length || 0,
    word_count: resolved.analysis?.wordCount || 0,
    source_field: resolved.sourceField || CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD,
  }
}

function normalizeBrazilPhone(value) {
  const digits = digitsOnly(value)
  if (!digits) return null
  const normalized = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  return normalized.length >= 10 && normalized.length <= 11 ? normalized : null
}

export function validateClientLoyaltyCardPayerData(input = {}) {
  const {
    payerEmail = null,
    identificationType = null,
    identificationNumber = null,
    payerPhone = null,
  } = input || {}
  const cardholderNameInput = resolveClientLoyaltyCardholderNameInput(input)
  const normalized = {
    payerEmail: normalizeText(payerEmail).toLowerCase(),
    cardholderName: cardholderNameInput.normalized,
    identificationType: normalizeText(identificationType).toUpperCase(),
    identificationNumber: digitsOnly(identificationNumber),
    payerPhone: normalizeBrazilPhone(payerPhone),
  }
  const errors = {}
  const warnings = {}

  if (!isValidEmail(normalized.payerEmail)) {
    errors.payer_email = 'Informe um e-mail válido para a cobrança.'
  }
  if (!hasMeaningfulFullName(normalized.cardholderName)) {
    errors.cardholder_name = 'Informe o nome completo do titular do cartão.'
  }
  if (!normalized.identificationType) {
    errors.identification_type = 'Informe o tipo do documento do titular.'
  }
  if (!normalized.identificationNumber) {
    errors.identification_number = 'Informe o CPF do titular.'
  } else if (normalized.identificationType === 'CPF' && !isValidCpf(normalized.identificationNumber)) {
    errors.identification_number = 'Informe um CPF válido para o titular.'
  } else if (normalized.identificationType !== 'CPF' && normalized.identificationNumber.length < 5) {
    errors.identification_number = 'Informe um documento válido para o titular.'
  }
  if (!normalized.payerPhone) {
    warnings.payer_phone = 'Telefone ausente no contexto do pagador.'
  }

  return {
    valid: !Object.keys(errors).length,
    errors,
    warnings,
    normalized,
    sourceFields: {
      cardholderName: cardholderNameInput.sourceField,
    },
    debug: {
      cardholderName: getClientLoyaltyCardholderNameDebugInfo(cardholderNameInput),
    },
  }
}

function assertClientLoyaltyCardPayerData(input = {}) {
  const validation = validateClientLoyaltyCardPayerData(input)
  console.info('[loyalty][card-validation] cardholder_name_check', {
    ...validation.debug.cardholderName,
    validation_field: validation.sourceFields.cardholderName,
    stage: 'backend_validation',
  })
  if (!validation.valid) {
    throw createError(
      'Confira os dados do titular do cartão antes de continuar.',
      400,
      'client_loyalty_card_payer_data_invalid',
      {
        fields: validation.errors,
        warnings: validation.warnings,
      }
    )
  }
  return validation
}

function addMonths(dateValue, months = 1) {
  const date = toDate(dateValue)
  if (!date) return null
  const result = new Date(date)
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

function resolveApiBaseUrl() {
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONTEND_BASE)
  const defaultApi = isDevFront ? 'http://localhost:3002' : `${FRONTEND_BASE}/api`
  return String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || defaultApi).replace(/\/$/, '')
}

function resolveBillingWebhookUrl(apiBase = resolveApiBaseUrl()) {
  const base = String(apiBase || '').replace(/\/$/, '')
  return base.endsWith('/api') ? `${base}/billing/webhook` : `${base}/api/billing/webhook`
}

function resolveSellerWebhookUrl(apiBase = resolveApiBaseUrl()) {
  const base = String(apiBase || '').replace(/\/$/, '')
  return base.endsWith('/api')
    ? `${base}/webhooks/mercadopago/sellers`
    : `${base}/api/webhooks/mercadopago/sellers`
}

function buildClientBackUrl(estabelecimentoId) {
  return `${FRONTEND_BASE}/cliente/fidelidade?estabelecimento=${encodeURIComponent(String(estabelecimentoId || ''))}`
}

function buildLoyaltyExternalReference({ subscriptionId, estabelecimentoId, clienteId, loyaltyPlanId, cycleRef = null }) {
  return [
    'loyalty',
    'sub',
    String(subscriptionId || ''),
    'est',
    String(estabelecimentoId || ''),
    'cli',
    String(clienteId || ''),
    'plan',
    String(loyaltyPlanId || ''),
    ...(cycleRef ? ['cycle', String(cycleRef || '')] : []),
    'uuid',
    randomUUID(),
  ].join(':')
}

function buildCardExternalReference({ subscriptionId, estabelecimentoId, clienteId, loyaltyPlanId }) {
  return buildLoyaltyExternalReference({
    subscriptionId,
    estabelecimentoId,
    clienteId,
    loyaltyPlanId,
  })
}

function buildPixExternalReference({ subscriptionId, estabelecimentoId, clienteId, loyaltyPlanId, cycleRef }) {
  return buildLoyaltyExternalReference({
    subscriptionId,
    estabelecimentoId,
    clienteId,
    loyaltyPlanId,
    cycleRef,
  })
}

function buildClientLoyaltyPixFallbackMetadata(fallbackContext = null) {
  if (!fallbackContext?.reason) return {}
  return {
    fallback_reason: fallbackContext.reason,
    fallback_source: 'pix',
    ...(fallbackContext?.source ? { fallback_origin: fallbackContext.source } : {}),
    ...(fallbackContext?.previousFailureCode ? { previous_failure_code: fallbackContext.previousFailureCode } : {}),
    ...(fallbackContext?.previousSubscriptionId ? { previous_subscription_id: String(fallbackContext.previousSubscriptionId) } : {}),
  }
}

export function buildClientLoyaltyActivationEventPayload(rawPayload = null, {
  paymentMethod = null,
} = {}) {
  const method = String(paymentMethod || '').trim().toLowerCase()
  if (method !== 'pix') return rawPayload

  const metadata = rawPayload?.metadata || rawPayload?.payment?.metadata || null
  const previousFailureCode = String(metadata?.previous_failure_code || metadata?.previousFailureCode || '').trim() || null
  const fallbackReason = String(metadata?.fallback_reason || metadata?.fallbackReason || '').trim() || null
  if (!previousFailureCode && !fallbackReason) return rawPayload

  const fallbackAudit = {
    fallback_source: 'pix',
    fallback_reason: fallbackReason,
    fallback_origin: metadata?.fallback_origin || metadata?.fallbackOrigin || null,
    previous_failure_code: previousFailureCode,
  }

  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    return {
      ...rawPayload,
      ...fallbackAudit,
    }
  }

  return {
    value: rawPayload ?? null,
    ...fallbackAudit,
  }
}

function buildSellerEventContext(account, estabelecimentoId, extra = {}) {
  return {
    ownerType: 'establishment',
    ownerId: Number(estabelecimentoId || account?.estabelecimento_id || account?.estabelecimentoId || 0) || null,
    estabelecimentoId: Number(estabelecimentoId || account?.estabelecimento_id || account?.estabelecimentoId || 0) || null,
    mpUserId: account?.mp_user_id || account?.mpUserId || null,
    mpCollectorId: account?.mp_collector_id || account?.mpCollectorId || account?.mp_user_id || account?.mpUserId || null,
    ...extra,
  }
}

function normalizeGatewayPaymentStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeGatewayPaymentStatusKey(value) {
  return normalizeGatewayPaymentStatus(value).replace(/-/g, '_')
}

function normalizeClientLoyaltyFailureCode(value) {
  return normalizeGatewayPaymentStatusKey(value)
}

function isClientLoyaltyHighRiskFailureCode(value) {
  return normalizeClientLoyaltyFailureCode(value) === CLIENT_LOYALTY_HIGH_RISK_CODE
}

function isApprovedGatewayPaymentStatus(status) {
  const key = normalizeGatewayPaymentStatusKey(status)
  return key === 'approved' || key === 'paid'
}

function isFailedGatewayPaymentStatus(status) {
  return ['expired', 'canceled', 'cancelled', 'rejected', 'failed', 'refunded', 'charged_back']
    .includes(normalizeGatewayPaymentStatusKey(status))
}

function isFinalRealGatewayPaymentStatus(status) {
  const key = normalizeGatewayPaymentStatusKey(status)
  return isApprovedGatewayPaymentStatus(key) || isFailedGatewayPaymentStatus(key)
}

function resolveFinalRealPaymentSubscriptionStatus(status) {
  const key = normalizeGatewayPaymentStatusKey(status)
  if (isApprovedGatewayPaymentStatus(key)) return 'active'
  if (['expired', 'canceled', 'cancelled'].includes(key)) return 'expired'
  if (isFailedGatewayPaymentStatus(key)) return 'past_due'
  return null
}

const AUTHORIZED_PAYMENT_PENDING_STATUS_KEYS = new Set([
  'scheduled',
  'pending',
  'pending_payment',
  'in_process',
  'processing',
  'authorized',
  'created',
])

const AUTHORIZED_PAYMENT_FAILED_STATUS_KEYS = new Set([
  'rejected',
  'failed',
  'refunded',
  'charged_back',
])

const AUTHORIZED_PAYMENT_PENDING_DETAIL_KEYS = new Set([
  'pending_review_manual',
  'pending_contingency',
  'offline_process',
  'deferred_retry',
  'pending_capture',
])

function getAuthorizedPaymentRawRecord(rawPayment = null) {
  return rawPayment?.payment || rawPayment?.authorized_payment || rawPayment || null
}

function resolveAuthorizedPaymentPendingRule(statusKey, statusDetailKey) {
  if (statusDetailKey === 'pending_review_manual') return 'authorized_payment_pending_review'
  if (statusKey === 'scheduled') return 'authorized_payment_scheduled_pending'
  if (statusKey === 'in_process') return 'authorized_payment_in_process_pending'
  return 'authorized_payment_pending'
}

function resolveAuthorizedPaymentPendingOutcome(statusKey, statusDetailKey) {
  if (statusDetailKey === 'pending_review_manual' || statusKey === 'in_process') return 'pending_review'
  return 'pending'
}

function resolveAuthorizedPaymentPendingEventName(statusKey, statusDetailKey) {
  if (statusDetailKey === 'pending_review_manual' || statusKey === 'in_process') return 'authorized_payment_in_process'
  return 'authorized_payment_pending'
}

function resolveAuthorizedPaymentAttemptedNextStatus(interpretation = null) {
  if (!interpretation) return null
  if (interpretation.interpretedOutcome === 'approved') return 'active'
  if (interpretation.nextSubscriptionStatus) return interpretation.nextSubscriptionStatus
  if (interpretation.isFailure) return 'past_due'
  if (interpretation.isPending) return 'pending_payment'
  return null
}

function resolveAuthorizedPaymentPendingSubscriptionStatus(currentSubscription = null) {
  const currentStatus = normalizeGatewayPaymentStatus(currentSubscription?.status)
  if (!currentStatus) return 'pending_payment'

  const currentState = computeClientLoyaltySubscriptionState(currentSubscription)
  if (
    currentState.benefitsActive &&
    ['active', 'past_due', 'unpaid', 'canceled'].includes(currentStatus)
  ) {
    return currentStatus
  }

  return 'pending_payment'
}

export function interpretClientLoyaltyAuthorizedPaymentStatus(authorizedPayment = null, {
  rawPayment = null,
  currentSubscription = null,
} = {}) {
  const record = getAuthorizedPaymentRawRecord(rawPayment)
  const rawStatus =
    authorizedPayment?.rawStatus ||
    record?.status ||
    authorizedPayment?.paymentResult?.status ||
    null
  const rawStatusKey = normalizeGatewayPaymentStatusKey(rawStatus)
  const mappedStatus = authorizedPayment?.status || null
  const mappedStatusKey = normalizeGatewayPaymentStatusKey(mappedStatus)
  const statusKey = rawStatusKey || mappedStatusKey
  const statusDetail =
    authorizedPayment?.statusDetail ||
    record?.status_detail ||
    record?.statusDetail ||
    authorizedPayment?.paymentResult?.status_detail ||
    null
  const statusDetailKey = normalizeGatewayPaymentStatusKey(statusDetail)
  const paymentResult = authorizedPayment?.paymentResult || null
  const statusForLog = rawStatus || mappedStatus || null

  if (
    mappedStatusKey === 'active' ||
    paymentResult?.should_activate_subscription === true ||
    ['approved', 'paid'].includes(statusKey)
  ) {
    return {
      interpretedOutcome: 'approved',
      nextSubscriptionStatus: 'active',
      transitionRule: 'authorized_payment_approved',
      eventName: 'authorized_payment_approved',
      status: statusForLog,
      statusDetail,
      isFailure: false,
      isPending: false,
      isFinal: false,
    }
  }

  if (statusKey === 'expired') {
    return {
      interpretedOutcome: 'expired',
      nextSubscriptionStatus: 'expired',
      transitionRule: 'authorized_payment_expired',
      eventName: 'authorized_payment_expired',
      status: statusForLog,
      statusDetail,
      isFailure: false,
      isPending: false,
      isFinal: true,
    }
  }

  if (statusKey === 'canceled' || statusKey === 'cancelled') {
    return {
      interpretedOutcome: 'canceled',
      nextSubscriptionStatus: 'canceled',
      transitionRule: 'authorized_payment_canceled',
      eventName: 'authorized_payment_canceled',
      status: statusForLog,
      statusDetail,
      isFailure: false,
      isPending: false,
      isFinal: true,
    }
  }

  if (
    AUTHORIZED_PAYMENT_FAILED_STATUS_KEYS.has(statusKey) ||
    paymentResult?.status_group === 'rejected' ||
    (!rawStatusKey && mappedStatusKey === 'past_due')
  ) {
    return {
      interpretedOutcome: 'failed',
      nextSubscriptionStatus: 'past_due',
      transitionRule: statusKey === 'rejected'
        ? 'authorized_payment_rejected_past_due'
        : 'authorized_payment_failed_past_due',
      eventName: 'authorized_payment_failed',
      status: statusForLog,
      statusDetail,
      isFailure: true,
      isPending: false,
      isFinal: false,
    }
  }

  if (
    AUTHORIZED_PAYMENT_PENDING_STATUS_KEYS.has(statusKey) ||
    AUTHORIZED_PAYMENT_PENDING_DETAIL_KEYS.has(statusDetailKey) ||
    paymentResult?.status_group === 'pending'
  ) {
    return {
      interpretedOutcome: resolveAuthorizedPaymentPendingOutcome(statusKey, statusDetailKey),
      nextSubscriptionStatus: resolveAuthorizedPaymentPendingSubscriptionStatus(currentSubscription),
      transitionRule: resolveAuthorizedPaymentPendingRule(statusKey, statusDetailKey),
      eventName: resolveAuthorizedPaymentPendingEventName(statusKey, statusDetailKey),
      status: statusForLog,
      statusDetail,
      isFailure: false,
      isPending: true,
      isFinal: false,
    }
  }

  return {
    interpretedOutcome: 'pending',
    nextSubscriptionStatus: resolveAuthorizedPaymentPendingSubscriptionStatus(currentSubscription),
    transitionRule: 'authorized_payment_observed',
    eventName: 'authorized_payment_pending',
    status: statusForLog,
    statusDetail,
    isFailure: false,
    isPending: true,
    isFinal: false,
  }
}

function resolveCycleStart(subscription, paymentDate) {
  const paidAt = toDate(paymentDate) || new Date()
  const currentEnd = toDate(subscription?.currentPeriodEnd)
  if (!currentEnd) return paidAt
  if (currentEnd.getTime() <= paidAt.getTime()) return paidAt
  if ((currentEnd.getTime() - paidAt.getTime()) <= 7 * DAY_MS) {
    return currentEnd
  }
  return paidAt
}

function buildInitialCardChargeStartDate() {
  return new Date(Date.now() + CLIENT_LOYALTY_CARD_START_DELAY_MS)
}

function isPendingCardCheckoutStillInFlight(subscription, referenceDate = new Date()) {
  if (!subscription) return false
  if (String(subscription.paymentMethod || '').toLowerCase() !== 'credit_card') return false
  if (String(subscription.status || '').toLowerCase() !== 'pending_payment') return false

  const reference = toDate(referenceDate) || new Date()
  const createdAt = toDate(subscription.createdAt)
  const nextBillingAt = toDate(subscription.nextBillingAt)

  if (createdAt && nextBillingAt) {
    const scheduledSoon = Math.abs(nextBillingAt.getTime() - createdAt.getTime()) <= CLIENT_LOYALTY_CARD_PENDING_WINDOW_MS
    const stillWithinChargeWindow = reference.getTime() <= nextBillingAt.getTime() + CLIENT_LOYALTY_CARD_PENDING_WINDOW_MS
    return scheduledSoon && stillWithinChargeWindow
  }

  if (createdAt) {
    return (reference.getTime() - createdAt.getTime()) <= CLIENT_LOYALTY_CARD_PENDING_WINDOW_MS
  }

  return false
}

function getFirstGatewayCause(value) {
  if (Array.isArray(value)) return value.find(Boolean) || null
  if (Array.isArray(value?.cause)) return value.cause.find(Boolean) || null
  return null
}

function extractGatewayFailureDetails(payload = null, fallbackStatus = null) {
  const raw = payload?.raw || payload || null
  const payment = raw?.payment || raw?.authorized_payment || raw || null
  const gatewayCause =
    getFirstGatewayCause(payment) ||
    getFirstGatewayCause(raw) ||
    getFirstGatewayCause(raw?.subscription) ||
    null

  const details = {
    status: payment?.status || raw?.status || fallbackStatus || null,
    status_detail: payment?.status_detail || payment?.statusDetail || raw?.status_detail || raw?.statusDetail || null,
    code: gatewayCause?.code != null ? String(gatewayCause.code) : null,
    description:
      gatewayCause?.description ||
      payment?.detail ||
      payment?.status_reason ||
      raw?.detail ||
      raw?.error_description ||
      null,
    message:
      payment?.message ||
      payment?.status_message ||
      raw?.message ||
      raw?.status_message ||
      null,
  }

  return Object.values(details).some(Boolean) ? details : null
}

function extractClientLoyaltyFailureFromEvent(event) {
  if (!event) return null
  const payload = event.payload_json || null
  const normalized = {
    status: payload?.payment_status || null,
    status_detail: payload?.payment_status_detail || null,
    code: payload?.payment_rejection_code != null ? String(payload.payment_rejection_code) : null,
    description: payload?.payment_rejection_description || null,
    message: payload?.payment_status_message || null,
    event_type: event.tipo_evento || null,
    gateway_event_id: event.gateway_event_id || null,
    created_at: event.created_at || null,
  }
  if (Object.values(normalized).some(Boolean)) return normalized

  const fallback = extractGatewayFailureDetails(payload?.raw || payload, payload?.payment_status || null)
  if (!fallback) return null
  return {
    ...fallback,
    event_type: event.tipo_evento || null,
    gateway_event_id: event.gateway_event_id || null,
    created_at: event.created_at || null,
  }
}

function mapClientLoyaltyFailureFriendlyMessage(code) {
  const normalized = String(code || '').trim().toLowerCase()
  if (normalized === CLIENT_LOYALTY_HIGH_RISK_CODE) {
    return 'Não foi possível aprovar este cartão no momento. Você pode tentar outro cartão ou pagar por PIX.'
  }
  const messages = {
    cc_rejected_high_risk: 'A última tentativa de cobrança foi recusada por análise de risco do cartão.',
    cc_rejected_insufficient_amount: 'A última tentativa de cobrança foi recusada por saldo ou limite insuficiente.',
    cc_rejected_bad_filled_security_code: 'A última tentativa de cobrança foi recusada por dados do cartão inválidos.',
  }
  return messages[normalized] || null
}

function normalizeClientLoyaltySnapshotDate(value) {
  const parsed = toDate(value)
  if (parsed) return parsed.toISOString()
  const text = String(value || '').trim()
  return text || null
}

function resolveClientLoyaltyFailureSource(event) {
  const paymentType = String(event?.payment_type || '').trim().toLowerCase()
  const mpTopic = String(event?.mp_topic || '').trim().toLowerCase()
  if (paymentType === 'subscription_authorized_payment' || mpTopic === 'automatic-payments') {
    return 'authorized_payment'
  }
  return 'payment'
}

const CLIENT_LOYALTY_NON_FAILURE_STATUS_DETAIL_KEYS = new Set([
  'pending_review_manual',
  'pending_contingency',
  'offline_process',
  'deferred_retry',
  'pending_capture',
])

function isClientLoyaltyExplicitFailureCandidate(extracted = null) {
  const statusKey = normalizeGatewayPaymentStatusKey(extracted?.status)
  const detailKey = normalizeGatewayPaymentStatusKey(extracted?.status_detail || extracted?.code)

  if (CLIENT_LOYALTY_NON_FAILURE_STATUS_DETAIL_KEYS.has(detailKey)) return false
  if (detailKey.startsWith('cc_rejected') || detailKey.startsWith('rejected_')) return true
  if (AUTHORIZED_PAYMENT_FAILED_STATUS_KEYS.has(statusKey)) return true
  if (AUTHORIZED_PAYMENT_PENDING_STATUS_KEYS.has(statusKey)) return false
  return false
}

function extractClientLoyaltyFailureGatewayRecord(event) {
  const payload = event?.payload_json || null
  const raw = payload?.raw || payload || null
  const record = raw?.payment || raw?.authorized_payment || raw || null
  return record && typeof record === 'object' ? record : null
}

function buildClientLoyaltyFailureCandidate(event) {
  const extracted = extractClientLoyaltyFailureFromEvent(event)
  if (!extracted) return null
  if (!isClientLoyaltyExplicitFailureCandidate(extracted)) return null
  const gatewayRecord = extractClientLoyaltyFailureGatewayRecord(event)
  const technicalCode = String(extracted.status_detail || '').trim() || null
  return {
    ...extracted,
    code: technicalCode,
    source: resolveClientLoyaltyFailureSource(event),
    payment_method_id:
      gatewayRecord?.payment_method_id ||
      gatewayRecord?.payment_method ||
      null,
    payment_type_id: gatewayRecord?.payment_type_id || null,
    date_created:
      gatewayRecord?.date_created ||
      gatewayRecord?.date_last_updated ||
      gatewayRecord?.last_modified ||
      extracted.created_at ||
      null,
  }
}

function getClientLoyaltyEventSortTime(event = null) {
  const parsed = toDate(event?.created_at || event?.createdAt || event?.payload_json?.date_created || null)
  return parsed ? parsed.getTime() : 0
}

function sortClientLoyaltyEventsNewestFirst(events = []) {
  return [...(Array.isArray(events) ? events : [])].sort((left, right) => {
    const timeDiff = getClientLoyaltyEventSortTime(right) - getClientLoyaltyEventSortTime(left)
    if (timeDiff) return timeDiff
    return Number(right?.id || 0) - Number(left?.id || 0)
  })
}

function isClientLoyaltyPaymentSuccessEvent(event = null) {
  const eventType = String(event?.tipo_evento || '').trim().toLowerCase()
  if (['payment_approved', 'subscription_renewed'].includes(eventType)) return true
  const status = normalizeGatewayPaymentStatusKey(event?.payment_status || event?.payload_json?.payment_status || '')
  return isApprovedGatewayPaymentStatus(status)
}

function resolveClientLoyaltyFailureAttemptKey(event = null, candidate = null) {
  const payload = event?.payload_json || null
  const snapshot = payload?.snapshot || payload?.payment_snapshot || null
  const raw = payload?.raw || payload || null
  const payment = raw?.payment || raw?.authorized_payment || raw || null
  return String(
    event?.mp_payment_id ||
      snapshot?.payment_id ||
      payment?.id ||
      candidate?.gateway_event_id ||
      event?.gateway_event_id ||
      event?.id ||
      ''
  ).trim() || null
}

export function resolveClientLoyaltyHighRiskFailureSequence(events = []) {
  const failures = []
  const seenAttempts = new Set()

  for (const event of sortClientLoyaltyEventsNewestFirst(events)) {
    if (isClientLoyaltyPaymentSuccessEvent(event)) break

    const eventType = String(event?.tipo_evento || '').trim().toLowerCase()
    if (!['payment_failed', 'payment_expired'].includes(eventType)) continue

    const candidate = buildClientLoyaltyFailureCandidate(event)
    if (!candidate) continue

    const attemptKey = resolveClientLoyaltyFailureAttemptKey(event, candidate) || `event:${event?.id || failures.length}`
    if (seenAttempts.has(attemptKey)) continue
    seenAttempts.add(attemptKey)

    const failureCode = candidate.code || candidate.status_detail || null
    if (!isClientLoyaltyHighRiskFailureCode(failureCode)) break

    failures.push({
      attempt_key: attemptKey,
      payment_id: event?.mp_payment_id || null,
      gateway_event_id: candidate.gateway_event_id || event?.gateway_event_id || null,
      status: candidate.status || null,
      status_detail: candidate.status_detail || failureCode,
      code: CLIENT_LOYALTY_HIGH_RISK_CODE,
      source: candidate.source || null,
      created_at: candidate.date_created || candidate.created_at || event?.created_at || null,
    })
  }

  const latest = failures[0] || null
  const count = failures.length
  return {
    high_risk_consecutive_count: count,
    count,
    latest_at: latest?.created_at || null,
    latest_payment_id: latest?.payment_id || null,
    latest_gateway_event_id: latest?.gateway_event_id || null,
    same_day_auto_retry_blocked: count >= CLIENT_LOYALTY_HIGH_RISK_STRONG_WARNING_THRESHOLD,
    action_required: count >= CLIENT_LOYALTY_HIGH_RISK_ACTION_REQUIRED_THRESHOLD,
    severity: count >= CLIENT_LOYALTY_HIGH_RISK_ACTION_REQUIRED_THRESHOLD
      ? 'action_required'
      : count >= CLIENT_LOYALTY_HIGH_RISK_STRONG_WARNING_THRESHOLD
        ? 'strong_warning'
        : count > 0
          ? 'warning'
          : null,
    failures,
  }
}

export function resolveLatestClientLoyaltyFailureSummary(events = [], {
  subscriptionStatus = null,
} = {}) {
  const normalizedStatus = String(subscriptionStatus || '').trim().toLowerCase()
  if (normalizedStatus && !['past_due', 'unpaid', 'expired'].includes(normalizedStatus)) return null

  const candidates = (Array.isArray(events) ? events : [])
    .filter((event) => ['payment_failed', 'payment_expired'].includes(String(event?.tipo_evento || '').toLowerCase()))
    .map(buildClientLoyaltyFailureCandidate)
    .filter(Boolean)

  const selected =
    candidates.find((candidate) => candidate.source === 'payment' && candidate.code) ||
    candidates.find((candidate) => candidate.source === 'authorized_payment' && candidate.code) ||
    null

  if (!selected) return null
  const highRiskSequence = isClientLoyaltyHighRiskFailureCode(selected.code)
    ? resolveClientLoyaltyHighRiskFailureSequence(events)
    : null

  return {
    status: selected.status || null,
    status_detail: selected.status_detail || null,
    code: selected.code || null,
    description: selected.description || null,
    message: selected.message || null,
    friendly_message:
      mapClientLoyaltyFailureFriendlyMessage(selected.code) ||
      'A última tentativa de cobrança não foi aprovada. Revise os dados do cartão ou tente outro meio de pagamento.',
    source: selected.source || null,
    created_at: selected.date_created || selected.created_at || null,
    gateway_event_id: selected.gateway_event_id || null,
    payment_method_id: selected.payment_method_id || null,
    payment_type_id: selected.payment_type_id || null,
    high_risk_consecutive_count: highRiskSequence?.high_risk_consecutive_count || 0,
    high_risk_action_required: highRiskSequence?.action_required === true,
    high_risk_same_day_auto_retry_blocked: highRiskSequence?.same_day_auto_retry_blocked === true,
    high_risk_severity: highRiskSequence?.severity || null,
    high_risk_sequence: highRiskSequence,
  }
}

export function buildClientLoyaltyPaymentSnapshot(record = null, {
  paymentId = null,
  paymentTarget = 'payment',
} = {}) {
  const raw = record?.payment || record?.authorized_payment || record || null
  if (!raw || typeof raw !== 'object') return null

  const transactionAmount = raw?.transaction_amount != null
    ? Number(raw.transaction_amount)
    : raw?.amountCents != null
      ? Number(raw.amountCents || 0) / 100
      : null

  const snapshot = {
    payment_target: String(paymentTarget || 'payment').trim().toLowerCase() || 'payment',
    payment_id: raw?.id != null ? String(raw.id) : (paymentId != null ? String(paymentId) : null),
    status: raw?.status || raw?.rawStatus || null,
    status_detail: raw?.status_detail || raw?.statusDetail || null,
    payment_type_id: raw?.payment_type_id || raw?.paymentTypeId || null,
    payment_method_id: raw?.payment_method_id || raw?.paymentMethod || null,
    transaction_amount: Number.isFinite(transactionAmount) ? Number(transactionAmount.toFixed(2)) : null,
    external_reference: raw?.external_reference || raw?.externalReference || null,
    date_created: normalizeClientLoyaltySnapshotDate(raw?.date_created || raw?.dateCreated || null),
    date_approved: normalizeClientLoyaltySnapshotDate(
      raw?.date_approved ||
      raw?.paidAt ||
      raw?.last_modified ||
      raw?.date_last_updated ||
      null
    ),
  }

  return (
    snapshot.payment_id ||
    snapshot.status ||
    snapshot.status_detail ||
    snapshot.external_reference
  ) ? snapshot : null
}

function hasClientLoyaltyPaymentSnapshot(snapshot) {
  return Boolean(
    snapshot &&
    (
      snapshot.payment_id ||
      snapshot.status ||
      snapshot.status_detail ||
      snapshot.external_reference
    )
  )
}

function buildClientLoyaltyPaymentAuditEventId(prefix, snapshot = null, extra = []) {
  const parts = [
    prefix,
    snapshot?.payment_target || 'payment',
    snapshot?.payment_id || 'unknown',
    snapshot?.status || 'unknown',
    snapshot?.status_detail || 'none',
    ...extra.map((value) => String(value || '').trim()).filter(Boolean),
  ]
  const originalId = parts.join(':')
  const resolution = normalizeClientLoyaltyGatewayEventId(originalId, {
    eventType: prefix,
    mpTopic: snapshot?.payment_target === 'authorized_payment' ? 'automatic-payments' : snapshot?.payment_target || null,
    mpPaymentId: snapshot?.payment_id || null,
    paymentType: snapshot?.payment_type_id || snapshot?.payment_target || null,
    payload: {
      previous_subscription_status: extra[0] || null,
      next_subscription_status: extra[1] || null,
      transition_rule: extra[2] || null,
      snapshot,
    },
  })
  if (resolution.changed) {
    console.info('[client-loyalty] event_id_normalized', {
      event_type: prefix,
      mp_topic: snapshot?.payment_target === 'authorized_payment' ? 'automatic-payments' : snapshot?.payment_target || null,
      payment_type: snapshot?.payment_type_id || snapshot?.payment_target || null,
      original_length: resolution.originalLength || 0,
      original_id: resolution.originalId && resolution.originalId.length <= 220
        ? resolution.originalId
        : `${String(resolution.originalId || '').slice(0, 200)}...`,
      normalized_id: resolution.normalizedId || null,
      strategy: resolution.strategy || null,
      fallback_hash: Boolean(resolution.hashFallback),
    })
  }
  return resolution.normalizedId
}

async function recordClientLoyaltyPaymentSnapshotTx(subscriptionId, {
  snapshot = null,
  mpTopic = null,
  eventContext = null,
  paymentType = null,
  rawPayload = null,
}, { db = pool } = {}) {
  if (!subscriptionId || !hasClientLoyaltyPaymentSnapshot(snapshot)) return null

  console.info('[client-loyalty] payment_snapshot', {
    subscription_id: subscriptionId,
    mp_topic: mpTopic || null,
    ...snapshot,
  })

  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: 'payment_snapshot',
    gatewayEventId: buildClientLoyaltyPaymentAuditEventId('payment_snapshot', snapshot),
    mpTopic,
    ...(eventContext || {}),
    mpPaymentId: snapshot.payment_id || null,
    paymentStatus: snapshot.status || null,
    paymentMethod: snapshot.payment_method_id || null,
    paymentType: paymentType || snapshot.payment_type_id || snapshot.payment_target || null,
    amountCents: Number.isFinite(Number(snapshot.transaction_amount))
      ? Math.round(Number(snapshot.transaction_amount) * 100)
      : null,
    actionTaken: 'snapshot_recorded',
    payload: {
      snapshot,
      raw: rawPayload,
    },
  }, { db })

  return snapshot
}

function logClientLoyaltyAuthorizedPaymentInterpretation({
  subscriptionId = null,
  authorizedPaymentId = null,
  gatewaySubscriptionId = null,
  interpretation = null,
  nextSubscriptionStatus = null,
  failureDetails = null,
} = {}) {
  const logger = interpretation?.isFailure ? console.warn : console.info
  const payload = {
    subscription_id: subscriptionId,
    authorized_payment_id: authorizedPaymentId,
    gateway_subscription_id: gatewaySubscriptionId,
    event_name: interpretation?.eventName || null,
    status: interpretation?.status || failureDetails?.status || null,
    status_detail: interpretation?.statusDetail || failureDetails?.status_detail || null,
    interpreted_outcome: interpretation?.interpretedOutcome || null,
    next_subscription_status: nextSubscriptionStatus || interpretation?.nextSubscriptionStatus || null,
    transition_rule: interpretation?.transitionRule || null,
    failure_code: failureDetails?.code || null,
    failure_message: failureDetails?.message || failureDetails?.description || null,
  }
  logger('[client-loyalty][authorized-payment] interpreted', payload)
  if (interpretation?.eventName) {
    logger(`[client-loyalty][${interpretation.eventName}]`, payload)
  }
}

function logClientLoyaltySubscriptionStatusTransition(subscriptionId, {
  snapshot = null,
  previousSubscriptionStatus = null,
  nextSubscriptionStatus = null,
  transitionRule = null,
  mpTopic = null,
} = {}) {
  console.info('[client-loyalty] subscription_status_transition', {
    subscription_id: subscriptionId,
    mp_topic: mpTopic || null,
    payment_target: snapshot?.payment_target || null,
    payment_id: snapshot?.payment_id || null,
    status: snapshot?.status || null,
    status_detail: snapshot?.status_detail || null,
    previous_subscription_status: previousSubscriptionStatus || null,
    next_subscription_status: nextSubscriptionStatus || null,
    transition_rule: transitionRule || null,
  })
}

function logClientLoyaltyDominantPaymentSelected({
  subscriptionId = null,
  gatewaySubscriptionId = null,
  authorizedPaymentId = null,
  dominantPayment = null,
  currentSubscriptionStatus = null,
  attemptedNextStatus = null,
  priorityRule = 'real_payment_final_status_wins',
} = {}) {
  if (!dominantPayment) return
  console.info('[client-loyalty] dominant_payment_selected', {
    subscription_id: subscriptionId,
    gateway_subscription_id: gatewaySubscriptionId || null,
    authorized_payment_id: authorizedPaymentId || null,
    current_subscription_status: currentSubscriptionStatus || null,
    attempted_next_status: attemptedNextStatus || null,
    dominant_source: 'payment',
    dominant_payment_id: dominantPayment.payment_id || null,
    dominant_status: dominantPayment.status || null,
    dominant_status_detail: dominantPayment.status_detail || null,
    priority_rule: priorityRule,
  })
}

function logClientLoyaltyAuthorizedPaymentTransitionSuppressed({
  subscriptionId = null,
  gatewaySubscriptionId = null,
  authorizedPaymentId = null,
  interpretation = null,
  priority = null,
} = {}) {
  const dominantPayment = priority?.dominantPayment || null
  console.info('[client-loyalty] authorized_payment_transition_suppressed', {
    subscription_id: subscriptionId,
    gateway_subscription_id: gatewaySubscriptionId || null,
    authorized_payment_id: authorizedPaymentId || null,
    authorized_payment_status: interpretation?.status || null,
    authorized_payment_status_detail: interpretation?.statusDetail || null,
    attempted_next_status: priority?.attemptedNextStatus || null,
    preserved_subscription_status: priority?.preservedSubscriptionStatus || null,
    dominant_source: 'payment',
    dominant_payment_id: dominantPayment?.payment_id || null,
    dominant_payment_status: dominantPayment?.status || null,
    dominant_payment_status_detail: dominantPayment?.status_detail || null,
    priority_rule: priority?.priorityRule || 'real_payment_final_status_wins',
  })
}

function logClientLoyaltyConflictingPaymentSources({
  subscriptionId = null,
  gatewaySubscriptionId = null,
  authorizedPaymentId = null,
  interpretation = null,
  priority = null,
} = {}) {
  if (!priority?.conflict) return
  const dominantPayment = priority?.dominantPayment || null
  console.warn('[client-loyalty] conflicting_payment_sources', {
    subscription_id: subscriptionId,
    gateway_subscription_id: gatewaySubscriptionId || null,
    authorized_payment_id: authorizedPaymentId || null,
    authorized_payment_status: interpretation?.status || null,
    authorized_payment_status_detail: interpretation?.statusDetail || null,
    attempted_next_status: priority?.attemptedNextStatus || null,
    dominant_source: 'payment',
    dominant_payment_id: dominantPayment?.payment_id || null,
    dominant_status: dominantPayment?.status || null,
    dominant_status_detail: dominantPayment?.status_detail || null,
    dominant_subscription_status: dominantPayment?.subscription_status || null,
    priority_rule: priority?.priorityRule || 'real_payment_final_status_wins',
  })
}

async function recordClientLoyaltyAuthorizedPaymentAuxiliaryTx(subscriptionId, {
  authorizedPayment = null,
  authorizedPaymentId = null,
  gatewayEventId = null,
  gatewaySubscriptionId = null,
  interpretation = null,
  priority = null,
  sellerEventContext = null,
  amountCents = null,
  paymentResult = null,
  gatewayResult = null,
  db = pool,
} = {}) {
  const dominantPayment = priority?.dominantPayment || null
  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: 'authorized_payment_auxiliary',
    gatewayEventId: gatewayEventId || authorizedPayment?.id || authorizedPaymentId || null,
    mpTopic: 'automatic-payments',
    ...(sellerEventContext || {}),
    mpPaymentId: authorizedPayment?.id || authorizedPaymentId || null,
    paymentStatus: interpretation?.status || authorizedPayment?.rawStatus || authorizedPayment?.status || null,
    paymentMethod: 'credit_card',
    paymentType: 'subscription_authorized_payment',
    amountCents,
    actionTaken: 'recorded_as_auxiliary',
    ignoredReason: priority?.priorityRule || 'real_payment_final_status_wins',
    payload: {
      interpreted_outcome: interpretation?.interpretedOutcome || null,
      transition_rule: interpretation?.transitionRule || null,
      attempted_next_status: priority?.attemptedNextStatus || null,
      preserved_subscription_status: priority?.preservedSubscriptionStatus || null,
      priority_rule: priority?.priorityRule || 'real_payment_final_status_wins',
      dominant_source: 'payment',
      dominant_payment_id: dominantPayment?.payment_id || null,
      dominant_payment_status: dominantPayment?.status || null,
      dominant_payment_status_detail: dominantPayment?.status_detail || null,
      payment_status: interpretation?.status || null,
      payment_status_detail: interpretation?.statusDetail || null,
      payment: paymentResult?.raw || null,
      subscription: gatewayResult?.raw || null,
    },
  }, { db })

  console.info('[client-loyalty] authorized_payment_recorded_as_auxiliary', {
    subscription_id: subscriptionId,
    gateway_subscription_id: gatewaySubscriptionId || null,
    authorized_payment_id: authorizedPayment?.id || authorizedPaymentId || null,
    current_subscription_status: priority?.preservedSubscriptionStatus || null,
    attempted_next_status: priority?.attemptedNextStatus || null,
    dominant_source: 'payment',
    dominant_payment_id: dominantPayment?.payment_id || null,
    dominant_status: dominantPayment?.status || null,
    dominant_status_detail: dominantPayment?.status_detail || null,
    priority_rule: priority?.priorityRule || 'real_payment_final_status_wins',
  })
}

async function recordClientLoyaltyPaymentStatusTransitionTx(subscriptionId, {
  snapshot = null,
  previousSubscriptionStatus = null,
  nextSubscriptionStatus = null,
  transitionRule = null,
  mpTopic = null,
  eventContext = null,
  paymentType = null,
  rawPayload = null,
}, { db = pool } = {}) {
  if (!subscriptionId || !nextSubscriptionStatus || !hasClientLoyaltyPaymentSnapshot(snapshot)) return null

  console.info('[client-loyalty] payment_status_transition', {
    subscription_id: subscriptionId,
    mp_topic: mpTopic || null,
    previous_subscription_status: previousSubscriptionStatus || null,
    next_subscription_status: nextSubscriptionStatus || null,
    transition_rule: transitionRule || null,
    ...snapshot,
  })
  logClientLoyaltySubscriptionStatusTransition(subscriptionId, {
    snapshot,
    previousSubscriptionStatus,
    nextSubscriptionStatus,
    transitionRule,
    mpTopic,
  })

  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: 'payment_status_transition',
    gatewayEventId: buildClientLoyaltyPaymentAuditEventId('payment_status_transition', snapshot, [
      previousSubscriptionStatus,
      nextSubscriptionStatus,
      transitionRule,
    ]),
    mpTopic,
    ...(eventContext || {}),
    mpPaymentId: snapshot.payment_id || null,
    paymentStatus: snapshot.status || null,
    paymentMethod: snapshot.payment_method_id || null,
    paymentType: paymentType || snapshot.payment_type_id || snapshot.payment_target || null,
    amountCents: Number.isFinite(Number(snapshot.transaction_amount))
      ? Math.round(Number(snapshot.transaction_amount) * 100)
      : null,
    actionTaken: 'subscription_status_updated',
    payload: {
      previous_subscription_status: previousSubscriptionStatus || null,
      next_subscription_status: nextSubscriptionStatus || null,
      transition_rule: transitionRule || null,
      snapshot,
      raw: rawPayload,
    },
  }, { db })

  return snapshot
}

function extractClientLoyaltyPaymentSnapshotFromEvent(event) {
  if (!event) return null
  const payload = event?.payload_json || null
  const explicitSnapshot = payload?.snapshot || payload?.payment_snapshot || null
  if (explicitSnapshot) {
    return buildClientLoyaltyPaymentSnapshot(explicitSnapshot, {
      paymentId: explicitSnapshot?.payment_id || null,
      paymentTarget: explicitSnapshot?.payment_target || resolveClientLoyaltyFailureSource(event),
    })
  }

  const raw = payload?.raw || payload || null
  return buildClientLoyaltyPaymentSnapshot(raw, {
    paymentTarget: resolveClientLoyaltyFailureSource(event),
  })
}

function isRealPaymentEvent(event = null, snapshot = null) {
  const target = String(snapshot?.payment_target || '').trim().toLowerCase()
  const topic = String(event?.mp_topic || '').trim().toLowerCase()
  const type = String(event?.payment_type || '').trim().toLowerCase()
  if (target && target !== 'payment') return false
  if (topic === 'automatic-payments') return false
  if (type === 'subscription_authorized_payment') return false
  return true
}

function buildClientLoyaltyRealPaymentCandidate(event = null) {
  const snapshot = extractClientLoyaltyPaymentSnapshotFromEvent(event)
  if (!hasClientLoyaltyPaymentSnapshot(snapshot)) return null
  if (!isRealPaymentEvent(event, snapshot)) return null
  if (!isFinalRealGatewayPaymentStatus(snapshot.status || event?.payment_status)) return null

  const paymentId = String(
    event?.mp_payment_id ||
      snapshot.payment_id ||
      event?.gateway_event_id ||
      ''
  ).trim() || null
  if (!paymentId) return null

  return {
    source: 'payment',
    payment_id: paymentId,
    status: snapshot.status || event?.payment_status || null,
    status_detail: snapshot.status_detail || null,
    subscription_status: resolveFinalRealPaymentSubscriptionStatus(snapshot.status || event?.payment_status),
    payment_method_id: snapshot.payment_method_id || event?.payment_method || null,
    payment_type_id: snapshot.payment_type_id || event?.payment_type || null,
    transaction_amount: snapshot.transaction_amount ?? null,
    external_reference: snapshot.external_reference || null,
    gateway_event_id: event?.gateway_event_id || null,
    event_type: event?.tipo_evento || null,
    created_at: event?.created_at || null,
    snapshot,
  }
}

export function resolveDominantClientLoyaltyFinalRealPayment(events = [], {
  gatewayPaymentId = null,
} = {}) {
  const expectedPaymentId = String(gatewayPaymentId || '').trim()
  if (!expectedPaymentId) return null

  return (Array.isArray(events) ? events : [])
    .map(buildClientLoyaltyRealPaymentCandidate)
    .filter(Boolean)
    .find((candidate) => String(candidate.payment_id || '') === expectedPaymentId) || null
}

export function resolveLatestClientLoyaltyPaymentSnapshot(events = []) {
  const normalizedEvents = Array.isArray(events) ? events : []
  const snapshots = normalizedEvents
    .map((event) => ({
      event,
      snapshot: extractClientLoyaltyPaymentSnapshotFromEvent(event),
    }))
    .filter((entry) => hasClientLoyaltyPaymentSnapshot(entry.snapshot))
  const dominantRealPayment = snapshots.find((entry) => (
    isRealPaymentEvent(entry.event, entry.snapshot) &&
    isFinalRealGatewayPaymentStatus(entry.snapshot.status)
  ))
  return dominantRealPayment?.snapshot || snapshots[0]?.snapshot || null
}

function getClientLoyaltyRiskEventCreatedAt(event = null) {
  return toDate(event?.created_at || event?.createdAt || event?.payload_json?.date_created || null)
}

function resolveClientLoyaltyRiskEventPaymentId(event = null) {
  const payload = event?.payload_json || null
  const snapshot = payload?.snapshot || payload?.payment_snapshot || null
  const raw = payload?.raw || payload || null
  const payment = raw?.payment || raw?.authorized_payment || raw || null
  return String(
    event?.mp_payment_id ||
    snapshot?.payment_id ||
    payment?.id ||
    event?.gateway_event_id ||
    event?.id ||
    ''
  ).trim() || null
}

function isClientLoyaltyCardAttemptEvent(event = null) {
  const eventType = String(event?.tipo_evento || '').trim().toLowerCase()
  if (![
    'payment_failed',
    'payment_pending',
    'payment_snapshot',
    'payment_status_transition',
    'card_subscription_created',
    'card_subscription_create_failed',
  ].includes(eventType)) {
    return false
  }

  const method = String(event?.payment_method || '').trim().toLowerCase()
  const type = String(event?.payment_type || '').trim().toLowerCase()
  const topic = String(event?.mp_topic || '').trim().toLowerCase()
  if (method === 'pix' || type === 'pix') return false
  return (
    method === 'credit_card' ||
    type === 'credit_card' ||
    type === 'subscription_authorized_payment' ||
    type === 'subscription_payment' ||
    topic === 'automatic-payments' ||
    eventType.startsWith('card_subscription')
  )
}

export function resolveClientLoyaltyRecentCardAttemptSummary(events = [], {
  amountCents = null,
  referenceDate = new Date(),
  windowMs = CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_WINDOW_MS,
  duplicateThreshold = CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_THRESHOLD,
} = {}) {
  const reference = toDate(referenceDate) || new Date()
  const safeWindowMs = Math.max(Number(windowMs || 0) || CLIENT_LOYALTY_CARD_DUPLICATE_RETRY_WINDOW_MS, 60000)
  const minCreatedAt = reference.getTime() - safeWindowMs
  const expectedAmount = amountCents == null ? null : Number(amountCents)
  const attemptKeys = new Set()
  let latestAttemptAt = null

  for (const event of Array.isArray(events) ? events : []) {
    if (!isClientLoyaltyCardAttemptEvent(event)) continue
    const createdAt = getClientLoyaltyRiskEventCreatedAt(event)
    if (!createdAt || createdAt.getTime() < minCreatedAt || createdAt.getTime() > reference.getTime()) continue
    if (
      expectedAmount != null &&
      event?.amount_cents != null &&
      Number(event.amount_cents) !== expectedAmount
    ) {
      continue
    }

    const key = resolveClientLoyaltyRiskEventPaymentId(event)
    if (key) attemptKeys.add(key)
    if (!latestAttemptAt || createdAt.getTime() > latestAttemptAt.getTime()) {
      latestAttemptAt = createdAt
    }
  }

  const retryCountRecent = attemptKeys.size
  const latestAgeMs = latestAttemptAt
    ? Math.max(reference.getTime() - latestAttemptAt.getTime(), 0)
    : null
  const cooldownRemainingMs =
    retryCountRecent >= duplicateThreshold && latestAgeMs != null
      ? Math.max(safeWindowMs - latestAgeMs, 0)
      : 0

  return {
    retry_count_recent: retryCountRecent,
    same_buyer_recent_attempts: retryCountRecent,
    same_card_recent_attempts: null,
    same_card_recent_attempts_available: false,
    duplicate_threshold: duplicateThreshold,
    window_ms: safeWindowMs,
    latest_attempt_at: latestAttemptAt ? latestAttemptAt.toISOString() : null,
    cooldown_active: cooldownRemainingMs > 0,
    cooldown_remaining_ms: cooldownRemainingMs,
    cooldown_reason: cooldownRemainingMs > 0 ? 'recent_similar_attempts' : null,
  }
}

async function listRecentClientLoyaltyCardRiskEvents({
  clienteId = null,
  estabelecimentoId = null,
  loyaltyPlanId = null,
  db = pool,
  limit = 80,
} = {}) {
  if (!clienteId || !estabelecimentoId || !loyaltyPlanId) return []
  const safeLimit = Math.max(1, Math.min(Number(limit || 80) || 80, 200))
  const [rows] = await db.query(
    `SELECT ev.id,
            ev.client_loyalty_subscription_id,
            ev.tipo_evento,
            ev.gateway_event_id,
            ev.mp_topic,
            ev.owner_type,
            ev.owner_id,
            ev.estabelecimento_id,
            ev.mp_user_id,
            ev.mp_collector_id,
            ev.mp_payment_id,
            ev.payment_status,
            ev.payment_method,
            ev.payment_type,
            ev.amount_cents,
            ev.action_taken,
            ev.ignored_reason,
            ev.payload_json,
            ev.created_at
       FROM client_loyalty_subscription_events ev
       JOIN client_loyalty_subscriptions cls
         ON cls.id = ev.client_loyalty_subscription_id
      WHERE cls.cliente_id=?
        AND cls.estabelecimento_id=?
        AND cls.loyalty_plan_id=?
        AND cls.payment_method='credit_card'
      ORDER BY ev.created_at DESC, ev.id DESC
      LIMIT ${safeLimit}`,
    [clienteId, estabelecimentoId, loyaltyPlanId]
  )
  return rows.map((row) => ({
    id: Number(row.id),
    client_loyalty_subscription_id: Number(row.client_loyalty_subscription_id),
    tipo_evento: row.tipo_evento || '',
    gateway_event_id: row.gateway_event_id || null,
    mp_topic: row.mp_topic || null,
    owner_type: row.owner_type || null,
    owner_id: row.owner_id == null ? null : Number(row.owner_id),
    estabelecimento_id: row.estabelecimento_id == null ? null : Number(row.estabelecimento_id),
    mp_user_id: row.mp_user_id || null,
    mp_collector_id: row.mp_collector_id || null,
    mp_payment_id: row.mp_payment_id || null,
    payment_status: row.payment_status || null,
    payment_method: row.payment_method || null,
    payment_type: row.payment_type || null,
    amount_cents: row.amount_cents == null ? null : Number(row.amount_cents),
    action_taken: row.action_taken || null,
    ignored_reason: row.ignored_reason || null,
    payload_json: safeJsonParse(row.payload_json),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }))
}

async function findDominantClientLoyaltyFinalRealPaymentTx(subscriptionId, {
  gatewayPaymentId = null,
  db = pool,
  limit = 80,
} = {}) {
  if (!subscriptionId || !gatewayPaymentId) return null
  const events = await listClientLoyaltySubscriptionEvents(subscriptionId, { db, limit })
  return resolveDominantClientLoyaltyFinalRealPayment(events, { gatewayPaymentId })
}

export function resolveClientLoyaltyAuthorizedPaymentPriority({
  interpretation = null,
  dominantPayment = null,
  currentSubscriptionStatus = null,
} = {}) {
  if (!dominantPayment) {
    return {
      dominantSource: 'authorized_payment',
      suppressTransition: false,
      conflict: false,
      attemptedNextStatus: resolveAuthorizedPaymentAttemptedNextStatus(interpretation),
      preservedSubscriptionStatus: currentSubscriptionStatus || null,
      priorityRule: 'authorized_payment_used_when_no_final_real_payment',
      dominantPayment: null,
    }
  }

  const attemptedNextStatus = resolveAuthorizedPaymentAttemptedNextStatus(interpretation)
  const dominantSubscriptionStatus =
    dominantPayment.subscription_status ||
    resolveFinalRealPaymentSubscriptionStatus(dominantPayment.status)
  const preservedSubscriptionStatus = currentSubscriptionStatus || dominantSubscriptionStatus || null

  return {
    dominantSource: 'payment',
    suppressTransition: true,
    conflict: Boolean(
      attemptedNextStatus &&
      dominantSubscriptionStatus &&
      attemptedNextStatus !== dominantSubscriptionStatus
    ),
    attemptedNextStatus,
    preservedSubscriptionStatus,
    priorityRule: 'real_payment_final_status_wins',
    dominantPayment,
  }
}

export function resolveClientLoyaltyRetryOptions({
  subscriptionStatus = null,
  latestFailure = null,
  referenceDate = new Date(),
  recentAttemptSummary = null,
} = {}) {
  const normalizedStatus = String(subscriptionStatus || '').trim().toLowerCase()
  const failureCode = normalizeClientLoyaltyFailureCode(latestFailure?.code || latestFailure?.status_detail || '') || null
  const failureAt = toDate(latestFailure?.created_at || latestFailure?.date_created || null)
  const reference = toDate(referenceDate) || new Date()
  const failureAgeMs = failureAt ? Math.max(reference.getTime() - failureAt.getTime(), 0) : null
  const highRisk = isClientLoyaltyHighRiskFailureCode(failureCode)
  const highRiskCount = Math.max(Number(latestFailure?.high_risk_consecutive_count || 0) || 0, highRisk ? 1 : 0)
  const highRiskCooldownActive =
    highRisk &&
    failureAgeMs != null &&
    failureAgeMs < CLIENT_LOYALTY_HIGH_RISK_COOLDOWN_MS
  const highRiskCooldownRemainingMs = highRiskCooldownActive
    ? Math.max(CLIENT_LOYALTY_HIGH_RISK_COOLDOWN_MS - failureAgeMs, 0)
    : 0
  const recentCooldownActive = recentAttemptSummary?.cooldown_active === true
  const attemptCooldownRemainingMs = Math.max(Number(recentAttemptSummary?.cooldown_remaining_ms || 0), 0)
  const cardAttemptCooldownReason = recentCooldownActive
    ? recentAttemptSummary?.cooldown_reason || 'recent_similar_attempts'
    : null
  const sameDayAutoRetryBlocked = highRiskCount >= CLIENT_LOYALTY_HIGH_RISK_STRONG_WARNING_THRESHOLD
  const actionRequired = highRiskCount >= CLIENT_LOYALTY_HIGH_RISK_ACTION_REQUIRED_THRESHOLD
  const recoverySuggested = ['pending_payment', 'past_due', 'unpaid', 'expired'].includes(normalizedStatus)
  const manualNewCardAllowed = recoverySuggested && !recentCooldownActive
  const cardMessage = recentCooldownActive
    ? 'Muitas tentativas com cartões em poucos minutos. Use PIX agora ou aguarde antes de tentar outro cartão.'
    : highRisk
      ? (
        actionRequired
          ? 'Por segurança, novas tentativas com este cartão foram pausadas. Atualize o cartão ou pague por PIX para manter sua assinatura ativa.'
          : highRiskCount >= CLIENT_LOYALTY_HIGH_RISK_STRONG_WARNING_THRESHOLD
            ? 'Este cartão continua sendo recusado por análise de segurança. Recomendamos pagar por PIX ou usar outro cartão.'
            : 'Não foi possível aprovar este cartão no momento. Você pode tentar outro cartão ou pagar por PIX.'
      )
      : recoverySuggested
        ? 'Você pode tentar outro cartão para reativar a assinatura.'
        : null

  return {
    suggested: recoverySuggested,
    recommended_method: highRisk || recentCooldownActive ? 'pix' : 'credit_card',
    retry_count_recent: recentAttemptSummary?.retry_count_recent ?? null,
    same_buyer_recent_attempts: recentAttemptSummary?.same_buyer_recent_attempts ?? null,
    same_card_recent_attempts: recentAttemptSummary?.same_card_recent_attempts ?? null,
    cooldown_reason: cardAttemptCooldownReason || (highRiskCooldownActive ? CLIENT_LOYALTY_HIGH_RISK_CODE : null),
    high_risk_consecutive_count: highRiskCount,
    high_risk_action_required: actionRequired,
    high_risk_same_day_auto_retry_blocked: sameDayAutoRetryBlocked,
    same_card_cooldown_active: highRiskCooldownActive,
    same_card_cooldown_remaining_ms: highRiskCooldownRemainingMs,
    automatic_retry_allowed: !sameDayAutoRetryBlocked,
    card: {
      available: recoverySuggested,
      enabled: manualNewCardAllowed,
      action: highRisk ? 'update_card' : 'try_other_card',
      cooldown_active: recentCooldownActive,
      cooldown_remaining_ms: attemptCooldownRemainingMs,
      cooldown_reason: cardAttemptCooldownReason,
      same_card_blocked: highRiskCooldownActive,
      same_card_cooldown_active: highRiskCooldownActive,
      same_card_cooldown_remaining_ms: highRiskCooldownRemainingMs,
      same_card_cooldown_reason: highRiskCooldownActive ? CLIENT_LOYALTY_HIGH_RISK_CODE : null,
      manual_new_card_allowed: manualNewCardAllowed,
      automatic_retry_allowed: !sameDayAutoRetryBlocked,
      same_day_auto_retry_blocked: sameDayAutoRetryBlocked,
      action_required: actionRequired,
      high_risk_consecutive_count: highRiskCount,
      message: cardMessage || (recentCooldownActive
        ? 'Por segurança, novas tentativas com cartão ficam indisponíveis por alguns minutos. Se preferir, pague por PIX agora.'
        : recoverySuggested
          ? 'Você pode tentar outro cartão para reativar a assinatura.'
          : null),
    },
    pix: {
      available: true,
      enabled: true,
      action: 'pay_with_pix',
      priority: highRisk || recentCooldownActive,
      message: 'Você pode pagar por PIX para liberar o ciclo atual.',
    },
  }
}

async function assertClientLoyaltyCardRetryAllowed(subscription, {
  db = pool,
  referenceDate = new Date(),
  amountCents = null,
} = {}) {
  if (!subscription?.id) return { latestFailure: null, retryOptions: resolveClientLoyaltyRetryOptions() }

  const events = await listRecentClientLoyaltyCardRiskEvents({
    clienteId: subscription.clienteId,
    estabelecimentoId: subscription.estabelecimentoId,
    loyaltyPlanId: subscription.loyaltyPlanId,
    db,
    limit: 80,
  })
  const latestFailure = resolveLatestClientLoyaltyFailureSummary(events, {
    subscriptionStatus: subscription.status || null,
  })
  const recentAttemptSummary = resolveClientLoyaltyRecentCardAttemptSummary(events, {
    amountCents,
    referenceDate,
  })
  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: subscription.status || null,
    latestFailure,
    referenceDate,
    recentAttemptSummary,
  })

  if (retryOptions?.card?.cooldown_active) {
    const cooldownRemainingMs = Math.max(Number(retryOptions.card.cooldown_remaining_ms || 0), 0)
    const cooldownReason = retryOptions.card.cooldown_reason || retryOptions.cooldown_reason || 'card_retry_cooldown'
    const auditPayload = {
      subscription_id: subscription.id || null,
      cliente_id: subscription.clienteId || null,
      estabelecimento_id: subscription.estabelecimentoId || null,
      loyalty_plan_id: subscription.loyaltyPlanId || null,
      status: latestFailure?.status || null,
      status_detail: latestFailure?.code || latestFailure?.status_detail || null,
      retry_count_recent: retryOptions.retry_count_recent,
      same_buyer_recent_attempts: retryOptions.same_buyer_recent_attempts,
      same_card_recent_attempts: retryOptions.same_card_recent_attempts,
      cooldown_applied: true,
      cooldown_reason: cooldownReason,
      cooldown_remaining_ms: cooldownRemainingMs,
      suggested_fallback: 'pix',
    }
    console.warn('[client-loyalty][risk] card_retry_blocked', auditPayload)
    await appendClientLoyaltySubscriptionEvent(subscription.id, {
      eventType: 'card_retry_blocked',
      mpTopic: 'client-loyalty',
      ownerType: subscription.ownerType || 'establishment',
      ownerId: subscription.estabelecimentoId || null,
      estabelecimentoId: subscription.estabelecimentoId || null,
      paymentMethod: 'credit_card',
      paymentType: 'credit_card',
      amountCents,
      actionTaken: 'blocked',
      ignoredReason: cooldownReason,
      payload: auditPayload,
    }, { db })
    throw createError(
      cooldownReason === 'recent_similar_attempts'
        ? 'Muitas tentativas parecidas em poucos minutos. Use PIX agora ou aguarde antes de tentar cartão novamente.'
        : 'Não foi possível aprovar este cartão no momento. Tente PIX ou aguarde um pouco antes de tentar outro cartão.',
      409,
      'client_loyalty_card_retry_cooldown',
      {
        cooldown_active: true,
        cooldown_reason: cooldownReason,
        cooldown_remaining_ms: cooldownRemainingMs,
        retry_after_sec: Math.max(1, Math.ceil(cooldownRemainingMs / 1000)),
        action_recommendation: 'use_pix_or_wait_before_retry',
        status_detail: latestFailure?.code || latestFailure?.status_detail || null,
        last_failure_code: latestFailure?.code || null,
        last_failure_source: latestFailure?.source || null,
        suggested_payment_method: 'pix',
        alternative_payment_method: 'credit_card',
        retry_count_recent: retryOptions.retry_count_recent,
        same_buyer_recent_attempts: retryOptions.same_buyer_recent_attempts,
        same_card_recent_attempts: retryOptions.same_card_recent_attempts,
      }
    )
  }

  if (latestFailure?.code === CLIENT_LOYALTY_HIGH_RISK_CODE && retryOptions?.card?.manual_new_card_allowed) {
    await appendClientLoyaltySubscriptionEvent(subscription.id, {
      eventType: 'card_retry_allowed',
      mpTopic: 'client-loyalty',
      ownerType: subscription.ownerType || 'establishment',
      ownerId: subscription.estabelecimentoId || null,
      estabelecimentoId: subscription.estabelecimentoId || null,
      paymentMethod: 'credit_card',
      paymentType: 'credit_card',
      amountCents,
      actionTaken: 'new_card_allowed',
      ignoredReason: CLIENT_LOYALTY_HIGH_RISK_CODE,
      payload: {
        subscription_id: subscription.id || null,
        cliente_id: subscription.clienteId || null,
        estabelecimento_id: subscription.estabelecimentoId || null,
        loyalty_plan_id: subscription.loyaltyPlanId || null,
        previous_failure_code: latestFailure.code || null,
        high_risk_consecutive_count: retryOptions.high_risk_consecutive_count || 0,
        same_card_cooldown_active: retryOptions.card.same_card_cooldown_active === true,
        same_card_cooldown_remaining_ms: retryOptions.card.same_card_cooldown_remaining_ms || 0,
        manual_new_card_allowed: true,
        suggested_fallback: 'pix',
      },
    }, { db })
  }

  return { latestFailure, retryOptions }
}

async function fetchEstablishmentSummary(estabelecimentoId, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT id, nome, email, slug, avatar_url
       FROM usuarios
      WHERE id=?
        AND tipo='estabelecimento'
      LIMIT 1`,
    [estabelecimentoId]
  )
  return rows?.[0] || null
}

async function fetchClientSummary(clienteId, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT id, nome, email, telefone, cpf_cnpj
       FROM usuarios
      WHERE id=?
      LIMIT 1`,
    [clienteId]
  )
  return rows?.[0] || null
}

async function countPlanSubscribers(loyaltyPlanId, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
       FROM client_loyalty_subscriptions
      WHERE loyalty_plan_id=?
        AND status IN ('active','pending_payment','pending_pix','past_due','unpaid')`,
    [loyaltyPlanId]
  )
  return Number(rows?.[0]?.total || 0)
}

async function assertPlanReadyForSubscription(plan, { db = pool } = {}) {
  if (!plan) {
    throw createError('Plano de fidelidade não encontrado.', 404, 'loyalty_plan_not_found')
  }
  if (String(plan.status || '').toLowerCase() !== 'active') {
    throw createError('Este plano não está disponível para novas assinaturas.', 409, 'loyalty_plan_unavailable')
  }
  if (plan.max_assinantes != null) {
    const activeSubscribers = await countPlanSubscribers(plan.id, { db })
    if (activeSubscribers >= Number(plan.max_assinantes || 0)) {
      throw createError('Este plano atingiu o limite de assinantes.', 409, 'loyalty_plan_full')
    }
  }
}

async function resolveLoyaltyCheckoutContext(clienteId, estabelecimentoId, loyaltyPlanId, { db = pool } = {}) {
  const plan = await getLoyaltyPlanById(loyaltyPlanId, { db })
  if (!plan || Number(plan.estabelecimento_id) !== Number(estabelecimentoId)) {
    throw createError('Plano de fidelidade não encontrado para este estabelecimento.', 404, 'loyalty_plan_not_found')
  }
  await assertPlanReadyForSubscription(plan, { db })

  const [estabelecimento, cliente] = await Promise.all([
    fetchEstablishmentSummary(estabelecimentoId, { db }),
    fetchClientSummary(clienteId, { db }),
  ])
  if (!estabelecimento) {
    throw createError('Estabelecimento não encontrado.', 404, 'estabelecimento_not_found')
  }
  if (!cliente) {
    throw createError('Cliente não encontrado.', 404, 'cliente_not_found')
  }
  return { plan, estabelecimento, cliente }
}

async function resolveLoyaltyMpContext(estabelecimentoId) {
  const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
  if (!mpAccess?.accessToken) {
    throw createError(
      'O estabelecimento ainda não conectou o Mercado Pago para vender este plano.',
      409,
      'mp_not_connected'
    )
  }
  return mpAccess
}

async function resolveActiveLoyaltyMpContext(estabelecimentoId) {
  const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
  if (!mpAccess?.accessToken) {
    const reason = String(mpAccess?.reason || '').trim().toLowerCase()
    if (['expired', 'refresh_failed', 'refresh_token_missing', 'refresh_token_decrypt_failed', 'decrypt_failed', 'oauth_client_missing'].includes(reason)) {
      throw createError(
        'Conta Mercado Pago desconectada ou sem permissao valida.',
        409,
        'mp_account_invalid',
        { reason }
      )
    }
    throw createError(
      'Este estabelecimento ainda não conectou uma conta Mercado Pago.',
      409,
      'mp_not_connected',
      { reason: reason || 'not_connected' }
    )
  }
  return mpAccess
}

async function lockSubscriptionRow(subscriptionId, { db = pool } = {}) {
  const [rows] = await db.query(
    'SELECT id, status, payment_method, gateway_payment_id, gateway_subscription_id, current_period_start, current_period_end FROM client_loyalty_subscriptions WHERE id=? LIMIT 1 FOR UPDATE',
    [subscriptionId]
  )
  return rows?.[0] || null
}

async function retireReplaceableClientLoyaltySubscription(subscription, {
  reason = 'replaced_by_new_checkout',
  db = pool,
} = {}) {
  if (!subscription?.id) return null

  let gatewayCanceled = false
  if (subscription.paymentMethod === 'credit_card' && subscription.gatewaySubscriptionId) {
    try {
      const mpAccess = await resolveActiveLoyaltyMpContext(subscription.estabelecimentoId)
      await cancelMercadoPagoCardSubscription(subscription.gatewaySubscriptionId, {
        accessToken: mpAccess.accessToken,
      })
      gatewayCanceled = true
    } catch (error) {
      console.warn('[client-loyalty][replace] gateway_cancel_failed', error?.message || error)
    }
  }

  const canceledAt = new Date()
  const updated = await updateClientLoyaltySubscription(subscription.id, {
    status: gatewayCanceled ? 'canceled' : 'expired',
    autoRenew: false,
    canceledAt,
    cancelAt: canceledAt,
    nextBillingAt: null,
    graceUntil: null,
  }, { db })

  await appendClientLoyaltySubscriptionEvent(subscription.id, {
    eventType: 'subscription_replaced',
    gatewayEventId: `replace:${subscription.id}:${canceledAt.toISOString()}`,
    payload: {
      reason,
      previous_status: subscription.status || null,
      payment_method: subscription.paymentMethod || null,
      gateway_subscription_id: subscription.gatewaySubscriptionId || null,
      gateway_canceled: gatewayCanceled,
    },
  }, { db })

  return updated
}

async function activateSubscriptionCycleTx(subscriptionId, {
  paymentDate = new Date(),
  gatewayPaymentId = null,
  gatewaySubscriptionId = null,
  gatewayCustomerId = null,
  externalReference = null,
  paymentMethod = null,
  rawPayload = null,
  gatewayEventId = null,
  mpTopic = null,
  eventContext = null,
  paymentType = null,
  amountCents = null,
}, { db = pool } = {}) {
  await lockSubscriptionRow(subscriptionId, { db })
  const current = await getClientLoyaltySubscriptionById(subscriptionId, { db })
  if (!current) {
    throw createError('Assinatura de fidelidade não encontrada.', 404, 'client_loyalty_subscription_not_found')
  }

  const cycleStart = resolveCycleStart(current, paymentDate)
  const cycleEnd = addMonths(cycleStart, 1)
  const nextBillingAt = cycleEnd
  const updated = await updateClientLoyaltySubscription(subscriptionId, {
    ownerType: current.ownerType || 'establishment',
    sellerMpAccountId: current.sellerMpAccountId || null,
    status: 'active',
    paymentMethod: paymentMethod || current.paymentMethod,
    gatewayPaymentId: gatewayPaymentId || current.gatewayPaymentId || null,
    gatewaySubscriptionId: gatewaySubscriptionId || current.gatewaySubscriptionId || null,
    mpPreapprovalId: gatewaySubscriptionId || current.mpPreapprovalId || current.gatewaySubscriptionId || null,
    gatewayCustomerId: gatewayCustomerId || current.gatewayCustomerId || null,
    mpPayerId: gatewayCustomerId || current.mpPayerId || current.gatewayCustomerId || null,
    externalReference: externalReference || current.externalReference || null,
    startedAt: current.startedAt || cycleStart,
    currentPeriodStart: cycleStart,
    currentPeriodEnd: cycleEnd,
    nextBillingAt,
    lastPaymentAt: paymentDate,
    graceUntil: null,
  }, { db })

  const credits = await ensureCreditsForCurrentCycle(updated, { db })
  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: 'payment_approved',
    gatewayEventId: gatewayEventId || gatewayPaymentId || gatewaySubscriptionId || null,
    mpTopic,
    ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
    mpPaymentId: gatewayPaymentId || null,
    paymentStatus: 'approved',
    paymentMethod: paymentMethod || current.paymentMethod || null,
    paymentType,
    amountCents,
    actionTaken: 'activated',
    payload: buildClientLoyaltyActivationEventPayload(rawPayload, { paymentMethod: paymentMethod || current.paymentMethod }),
  }, { db })
  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: 'cycle_credits_generated',
    gatewayEventId: `credits:${formatCycleRef(cycleStart) || randomUUID()}`,
    mpTopic,
    ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
    actionTaken: 'credits_generated',
    payload: {
      cycle_start: cycleStart ? cycleStart.toISOString() : null,
      cycle_end: cycleEnd ? cycleEnd.toISOString() : null,
      credits,
    },
  }, { db })

  return updated
}

async function markSubscriptionPastDueTx(subscriptionId, {
  paymentStatus,
  gatewayPaymentId = null,
  gatewaySubscriptionId = null,
  gatewayCustomerId = null,
  externalReference = null,
  rawPayload = null,
  gatewayEventId = null,
  mpTopic = null,
  eventContext = null,
  paymentType = null,
  amountCents = null,
  transitionRule = null,
}, { db = pool } = {}) {
  await lockSubscriptionRow(subscriptionId, { db })
  const current = await getClientLoyaltySubscriptionById(subscriptionId, { db })
  if (!current) {
    throw createError('Assinatura de fidelidade não encontrada.', 404, 'client_loyalty_subscription_not_found')
  }

  const paymentStatusKey = normalizeGatewayPaymentStatusKey(paymentStatus)
  const expirationConfirmed = ['expired', 'canceled', 'cancelled'].includes(paymentStatusKey)
  const nextStatus = expirationConfirmed ? 'expired' : 'past_due'
  const graceUntil = nextStatus === 'past_due'
    ? new Date(Date.now() + CLIENT_LOYALTY_GRACE_DAYS * DAY_MS)
    : null

  let updated = await updateClientLoyaltySubscription(subscriptionId, {
    ownerType: current.ownerType || 'establishment',
    sellerMpAccountId: current.sellerMpAccountId || null,
    status: nextStatus,
    gatewayPaymentId: gatewayPaymentId || current.gatewayPaymentId || null,
    gatewaySubscriptionId: gatewaySubscriptionId || current.gatewaySubscriptionId || null,
    mpPreapprovalId: gatewaySubscriptionId || current.mpPreapprovalId || current.gatewaySubscriptionId || null,
    gatewayCustomerId: gatewayCustomerId || current.gatewayCustomerId || null,
    mpPayerId: gatewayCustomerId || current.mpPayerId || current.gatewayCustomerId || null,
    externalReference: externalReference || current.externalReference || null,
    graceUntil,
  }, { db })

  const failureDetails = extractGatewayFailureDetails(rawPayload, paymentStatus || null)

  await appendClientLoyaltySubscriptionEvent(subscriptionId, {
    eventType: nextStatus === 'past_due' ? 'payment_failed' : 'payment_expired',
    gatewayEventId: gatewayEventId || gatewayPaymentId || gatewaySubscriptionId || null,
    mpTopic,
    ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
    mpPaymentId: gatewayPaymentId || null,
    paymentStatus: paymentStatus || null,
    paymentMethod: current.paymentMethod || null,
    paymentType,
    amountCents,
    actionTaken: nextStatus === 'past_due' ? 'past_due' : 'expired',
    payload: {
      payment_status: paymentStatus || null,
      payment_status_detail: failureDetails?.status_detail || null,
      payment_status_message: failureDetails?.message || null,
      payment_rejection_code: failureDetails?.code || null,
      payment_rejection_description: failureDetails?.description || null,
      transition_rule: transitionRule || null,
      raw: rawPayload,
    },
  }, { db })

  if (current.paymentMethod === 'credit_card' || String(paymentType || '').includes('subscription')) {
    const snapshot = buildClientLoyaltyPaymentSnapshot(rawPayload, {
      paymentId: gatewayPaymentId || null,
      paymentTarget: String(paymentType || '').includes('authorized') ? 'authorized_payment' : 'payment',
    })
    const recentEvents = await listRecentClientLoyaltyCardRiskEvents({
      clienteId: current.clienteId,
      estabelecimentoId: current.estabelecimentoId,
      loyaltyPlanId: current.loyaltyPlanId,
      db,
      limit: 80,
    })
    const recentAttemptSummary = resolveClientLoyaltyRecentCardAttemptSummary(recentEvents, {
      amountCents,
    })
    const failureCode = normalizeClientLoyaltyFailureCode(failureDetails?.status_detail || failureDetails?.code || null)
    const highRisk = isClientLoyaltyHighRiskFailureCode(failureCode)
    const highRiskSequence = highRisk
      ? resolveClientLoyaltyHighRiskFailureSequence(recentEvents)
      : null
    const highRiskCount = highRiskSequence?.high_risk_consecutive_count || 0
    const sameDayAutoRetryBlocked = highRiskSequence?.same_day_auto_retry_blocked === true
    const actionRequired = highRiskSequence?.action_required === true
    if (sameDayAutoRetryBlocked && updated.autoRenew !== false) {
      updated = await updateClientLoyaltySubscription(subscriptionId, {
        autoRenew: false,
      }, { db })
    }
    const riskAudit = {
      subscription_id: subscriptionId,
      cliente_id: current.clienteId || null,
      estabelecimento_id: current.estabelecimentoId || null,
      payment_id: gatewayPaymentId || snapshot?.payment_id || null,
      status: failureDetails?.status || paymentStatus || null,
      status_detail: failureDetails?.status_detail || null,
      payment_method_id: snapshot?.payment_method_id || null,
      payment_type_id: snapshot?.payment_type_id || paymentType || null,
      transaction_amount: snapshot?.transaction_amount || null,
      external_reference: externalReference || snapshot?.external_reference || current.externalReference || null,
      retry_count_recent: recentAttemptSummary.retry_count_recent,
      same_card_recent_attempts: recentAttemptSummary.same_card_recent_attempts,
      same_buyer_recent_attempts: recentAttemptSummary.same_buyer_recent_attempts,
      cooldown_applied: highRisk,
      cooldown_reason: highRisk ? CLIENT_LOYALTY_HIGH_RISK_CODE : null,
      cooldown_ms: highRisk ? CLIENT_LOYALTY_HIGH_RISK_COOLDOWN_MS : 0,
      suggested_fallback: highRisk ? 'pix' : 'try_other_card_or_pix',
      high_risk_consecutive_count: highRiskCount,
      same_day_auto_retry_blocked: sameDayAutoRetryBlocked,
      action_required: actionRequired,
      transition_rule: transitionRule || null,
    }
    console.info('[client-loyalty][risk] payment_failure_audit', riskAudit)
    const riskGatewayEventId = gatewayEventId || gatewayPaymentId || null
    await appendClientLoyaltySubscriptionEvent(subscriptionId, {
      eventType: 'risk_audit',
      gatewayEventId: riskGatewayEventId
        ? `risk:${riskGatewayEventId}:${failureCode || 'failure'}`
        : null,
      mpTopic,
      ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
      mpPaymentId: gatewayPaymentId || null,
      paymentStatus: paymentStatus || null,
      paymentMethod: current.paymentMethod || null,
      paymentType,
      amountCents,
      actionTaken: 'payment_failure_audit',
      ignoredReason: highRisk ? CLIENT_LOYALTY_HIGH_RISK_CODE : null,
      payload: riskAudit,
    }, { db })

    if (sameDayAutoRetryBlocked) {
      await appendClientLoyaltySubscriptionEvent(subscriptionId, {
        eventType: 'card_automatic_retry_blocked',
        gatewayEventId: riskGatewayEventId
          ? `auto-retry-blocked:${riskGatewayEventId}:${highRiskCount}`
          : null,
        mpTopic: 'client-loyalty',
        ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
        mpPaymentId: gatewayPaymentId || null,
        paymentStatus: paymentStatus || null,
        paymentMethod: current.paymentMethod || null,
        paymentType,
        amountCents,
        actionTaken: 'same_day_auto_retry_blocked',
        ignoredReason: CLIENT_LOYALTY_HIGH_RISK_CODE,
        payload: {
          ...riskAudit,
          automatic_retry_allowed: false,
          action_recommendation: 'use_pix_or_update_card',
        },
      }, { db })
    }

    if (actionRequired) {
      await appendClientLoyaltySubscriptionEvent(subscriptionId, {
        eventType: 'subscription_payment_method_action_required',
        gatewayEventId: riskGatewayEventId
          ? `action-required:${riskGatewayEventId}:${highRiskCount}`
          : null,
        mpTopic: 'client-loyalty',
        ...(eventContext || buildSellerEventContext(null, current.estabelecimentoId, {})),
        mpPaymentId: gatewayPaymentId || null,
        paymentStatus: paymentStatus || null,
        paymentMethod: current.paymentMethod || null,
        paymentType,
        amountCents,
        actionTaken: 'customer_action_required',
        ignoredReason: CLIENT_LOYALTY_HIGH_RISK_CODE,
        payload: {
          ...riskAudit,
          required_actions: ['update_card', 'pay_with_pix'],
          blocked_status: 'past_due',
        },
      }, { db })
    }
  }

  return updated
}

export async function startClientLoyaltyCardSubscription({
  clienteId,
  estabelecimentoId,
  loyaltyPlanId,
  cardToken,
  payerEmail = null,
  paymentMethodId = null,
  issuerId = null,
  identificationType = null,
  identificationNumber = null,
  cardholderName = null,
  cardholder_name = null,
  payerName = null,
  payer_name = null,
  holderName = null,
  holder_name = null,
  name = null,
  payerPhone = null,
  db = pool,
  requestContext = {},
} = {}) {
  if (!cardToken) {
    throw createError(
      'Informe novamente o c\u00f3digo de seguran\u00e7a do cart\u00e3o.',
      400,
      'card_token_required',
      { retry_with_new_token: true }
    )
  }

  const { plan, estabelecimento, cliente } = await resolveLoyaltyCheckoutContext(
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    { db }
  )
  const payerValidation = assertClientLoyaltyCardPayerData({
    payerEmail: payerEmail || cliente.email || null,
    cardholderName,
    cardholder_name,
    payerName,
    payer_name,
    holderName,
    holder_name,
    name,
    identificationType,
    identificationNumber,
    payerPhone: payerPhone || cliente.telefone || null,
  })
  const normalizedPayer = payerValidation.normalized
  const current = await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db })
  let cardReplacementContext = null
  if (current) {
    const state = computeClientLoyaltySubscriptionState(current)
    const pendingCardCheckout = isPendingCardCheckoutStillInFlight(current)
    if (
      state.benefitsActive ||
      state.resolvedStatus === 'pending_pix' ||
      pendingCardCheckout
    ) {
      throw createError(
        pendingCardCheckout
          ? 'Já existe uma assinatura aguardando a primeira cobrança do cartão para este estabelecimento. O Mercado Pago pode levar até cerca de 1 hora para confirmar.'
          : 'Já existe uma assinatura em andamento para este estabelecimento.',
        409,
        'client_loyalty_subscription_conflict'
      )
    }
    if (['pending_payment', 'past_due', 'unpaid', 'expired', 'canceled'].includes(state.resolvedStatus)) {
      if (
        current.paymentMethod === 'credit_card' &&
        ['past_due', 'unpaid', 'expired', 'canceled'].includes(state.resolvedStatus)
      ) {
        const retryDecision = await assertClientLoyaltyCardRetryAllowed(current, {
          db,
          amountCents: Number(plan.preco_centavos || 0),
        })
        cardReplacementContext = {
          previous_subscription_id: current.id || null,
          previous_status: current.status || null,
          previous_failure_code: retryDecision.latestFailure?.code || null,
          high_risk_consecutive_count: retryDecision.retryOptions?.high_risk_consecutive_count || 0,
          retry_reason: retryDecision.latestFailure?.code === CLIENT_LOYALTY_HIGH_RISK_CODE
            ? 'new_card_after_high_risk'
            : 'new_card_after_failed_payment',
        }
      }
      await retireReplaceableClientLoyaltySubscription(current, {
        reason: 'replaced_by_new_card_checkout',
        db,
      })
    }
  }

  const mpAccess = await resolveActiveLoyaltyMpContext(estabelecimentoId)
  const recurringStartDate = buildInitialCardChargeStartDate()
  const provisionalSubscription = await createClientLoyaltySubscription({
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    ownerType: 'establishment',
    sellerMpAccountId: mpAccess.account?.id || null,
    status: 'pending_payment',
    paymentMethod: 'credit_card',
    gateway: 'mercadopago',
    nextBillingAt: recurringStartDate,
    autoRenew: true,
  }, { db })
  const externalReference = buildCardExternalReference({
    subscriptionId: provisionalSubscription.id,
    estabelecimentoId,
    clienteId,
    loyaltyPlanId,
  })

  let gatewayResult = null
  try {
    gatewayResult = await createMercadoPagoCardPreapproval({
      amountCents: Number(plan.preco_centavos || 0),
      billingCycle: 'mensal',
      cardToken,
      payer: {
        email: normalizedPayer.payerEmail || cliente.email || null,
        cardholderName: normalizedPayer.cardholderName || null,
        identification: {
          type: normalizedPayer.identificationType || null,
          number: normalizedPayer.identificationNumber || null,
        },
        phone: normalizedPayer.payerPhone || null,
      },
      reason: `${plan.nome} - ${estabelecimento.nome}`,
      backUrl: buildClientBackUrl(estabelecimentoId),
      externalReference,
      startDate: recurringStartDate,
      accessToken: mpAccess.accessToken,
      requestContext: {
        ...requestContext,
        operation: requestContext?.operation || 'client_loyalty_card_subscription_create',
        payer_validation_warnings: payerValidation.warnings,
      },
    })
  } catch (error) {
    await updateClientLoyaltySubscription(provisionalSubscription.id, {
      status: 'expired',
      externalReference,
      autoRenew: false,
      nextBillingAt: null,
    }, { db })
    await appendClientLoyaltySubscriptionEvent(provisionalSubscription.id, {
      eventType: 'card_subscription_create_failed',
      gatewayEventId: externalReference,
      mpTopic: 'subscription',
      ...buildSellerEventContext(mpAccess.account, estabelecimentoId, {
        actionTaken: 'create_failed',
        ignoredReason: error?.code || error?.message || 'gateway_error',
      }),
      payload: {
        message: error?.message || String(error),
        code: error?.code || null,
        retry_with_new_token: error?.details?.retry_with_new_token === true,
        gateway_error: error?.details || null,
      },
    }, { db })
    throw error
  }

  const subscription = await updateClientLoyaltySubscription(provisionalSubscription.id, {
    ownerType: 'establishment',
    sellerMpAccountId: mpAccess.account?.id || null,
    status: gatewayResult?.subscription?.status || 'pending_payment',
    paymentMethod: 'credit_card',
    gateway: 'mercadopago',
    gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || null,
    mpPayerId: gatewayResult?.subscription?.gatewayCustomerId || null,
    gatewaySubscriptionId: gatewayResult?.subscription?.gatewaySubscriptionId || null,
    mpPreapprovalId: gatewayResult?.subscription?.gatewaySubscriptionId || null,
    gatewayPaymentId: null,
    externalReference: gatewayResult?.subscription?.externalReference || gatewayResult?.request?.external_reference || externalReference,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextBillingAt: gatewayResult?.subscription?.nextBillingAt || recurringStartDate || null,
    autoRenew: true,
  }, { db })

  await appendClientLoyaltySubscriptionEvent(subscription.id, {
    eventType: 'card_subscription_created',
    gatewayEventId: gatewayResult?.subscription?.gatewaySubscriptionId || null,
    mpTopic: 'subscription',
    ...buildSellerEventContext(mpAccess.account, estabelecimentoId, {
      mpPaymentId: null,
      paymentStatus: gatewayResult?.subscription?.status || 'pending_payment',
      paymentMethod: 'credit_card',
      actionTaken: 'created',
    }),
    payload: gatewayResult.raw,
  }, { db })

  if (cardReplacementContext?.previous_subscription_id) {
    await appendClientLoyaltySubscriptionEvent(subscription.id, {
      eventType: 'card_payment_method_updated',
      gatewayEventId: `card-update:${subscription.id}:${cardReplacementContext.previous_subscription_id}`,
      mpTopic: 'client-loyalty',
      ...buildSellerEventContext(mpAccess.account, estabelecimentoId, {
        paymentMethod: 'credit_card',
        paymentType: 'credit_card',
        actionTaken: 'new_card_flow_created',
        ignoredReason: cardReplacementContext.previous_failure_code || null,
      }),
      payload: {
        ...cardReplacementContext,
        new_subscription_id: subscription.id || null,
        new_gateway_subscription_id: subscription.gatewaySubscriptionId || null,
        cooldown_scope: 'new_card_new_subscription',
        history_preserved: true,
      },
    }, { db })
  }

  return { subscription, plan, estabelecimento, gatewayResult }
}

export async function createClientLoyaltyPixCheckout({
  clienteId,
  estabelecimentoId,
  loyaltyPlanId,
  subscriptionId = null,
  db = pool,
  fallbackContext = null,
} = {}) {
  const { plan, estabelecimento, cliente } = await resolveLoyaltyCheckoutContext(
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    { db }
  )
  const requestedSubscriptionId = Number(subscriptionId || 0) || null
  let subscription = null
  if (requestedSubscriptionId) {
    subscription = await getClientLoyaltySubscriptionById(requestedSubscriptionId, { db })
    if (
      !subscription ||
      Number(subscription.clienteId) !== Number(clienteId) ||
      Number(subscription.estabelecimentoId) !== Number(estabelecimentoId)
    ) {
      throw createError(
        'Assinatura de fidelidade nao encontrada para este cliente.',
        404,
        'client_loyalty_subscription_not_found'
      )
    }
    if (Number(subscription.loyaltyPlanId) !== Number(loyaltyPlanId)) {
      throw createError(
        'A assinatura informada nao pertence ao plano selecionado.',
        409,
        'client_loyalty_subscription_plan_mismatch'
      )
    }
    const requestedState = computeClientLoyaltySubscriptionState(subscription)
    if (requestedState.benefitsActive && String(subscription.status || '').trim().toLowerCase() === 'active') {
      throw createError(
        'Este plano ja esta ativo no ciclo atual.',
        409,
        'client_loyalty_subscription_active'
      )
    }
  }

  const current = await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db })
  if (current) {
    const state = computeClientLoyaltySubscriptionState(current)
    const currentStatus = String(current.status || '').trim().toLowerCase()
    if (state.benefitsActive && currentStatus === 'active') {
      throw createError(
        'Este plano já está ativo no ciclo atual.',
        409,
        'client_loyalty_subscription_active'
      )
    }
    if (
      !subscription &&
      Number(current.loyaltyPlanId) === Number(loyaltyPlanId) &&
      ['pending_pix', 'past_due', 'unpaid', 'expired', 'canceled'].includes(state.resolvedStatus)
    ) {
      subscription = current
    }
  }

  const mpAccess = await resolveActiveLoyaltyMpContext(estabelecimentoId)
  if (!subscription) {
    subscription = await createClientLoyaltySubscription({
      clienteId,
      estabelecimentoId,
      loyaltyPlanId,
      ownerType: 'establishment',
      sellerMpAccountId: mpAccess.account?.id || null,
      status: 'pending_pix',
      paymentMethod: 'pix',
      gateway: 'mercadopago',
      autoRenew: false,
    }, { db })
  } else if (subscription.paymentMethod === 'credit_card' && subscription.gatewaySubscriptionId) {
    try {
      await cancelMercadoPagoCardSubscription(subscription.gatewaySubscriptionId, {
        accessToken: mpAccess.accessToken,
      })
    } catch (error) {
      console.warn('[client-loyalty][pix] gateway_cancel_failed', error?.message || error)
    }
  }

  const cycleRef = formatCycleRef(new Date())
  const externalReference = buildPixExternalReference({
    subscriptionId: subscription.id,
    estabelecimentoId,
    clienteId,
    loyaltyPlanId,
    cycleRef,
  })

  const sellerEventContext = buildSellerEventContext(mpAccess.account, estabelecimentoId)
  const paymentResult = await createMercadoPagoPixPayment({
    amountCents: Number(plan.preco_centavos || 0),
    description: `Fidelidade - ${plan.nome} - ${estabelecimento.nome}`,
    externalReference,
    metadata: {
      kind: 'loyalty_subscription_pix',
      tipo: 'fidelidade',
      assinatura_id: String(subscription.id),
      subscription_id: String(subscription.id),
      loyalty_subscription_id: String(subscription.id),
      loyalty_plan_id: String(loyaltyPlanId),
      cliente_id: String(clienteId),
      estabelecimento_id: String(estabelecimentoId),
      cycle_ref: cycleRef,
      ...buildClientLoyaltyPixFallbackMetadata(fallbackContext),
    },
    notificationUrl: resolveSellerWebhookUrl(),
    payerEmail: cliente.email || null,
    payer: buildClientPixPayer(cliente),
    accessToken: mpAccess.accessToken,
  })

  const updated = await updateClientLoyaltySubscription(subscription.id, {
    ownerType: 'establishment',
    sellerMpAccountId: mpAccess.account?.id || null,
    status: 'pending_pix',
    gatewayPaymentId: paymentResult?.payment?.id ? String(paymentResult.payment.id) : null,
    gatewaySubscriptionId: null,
    mpPreapprovalId: null,
    externalReference,
    paymentMethod: 'pix',
    autoRenew: false,
  }, { db })

  await appendClientLoyaltySubscriptionEvent(updated.id, {
    eventType: 'pix_generated',
    gatewayEventId: paymentResult?.payment?.id ? String(paymentResult.payment.id) : null,
    mpTopic: 'payment',
    ...sellerEventContext,
    mpPaymentId: paymentResult?.payment?.id ? String(paymentResult.payment.id) : null,
    paymentStatus: paymentResult?.payment?.status || null,
    paymentMethod: 'pix',
    paymentType: paymentResult?.payment?.payment_type_id || paymentResult?.payment?.payment_method_id || 'pix',
    amountCents: plan.preco_centavos || 0,
    actionTaken: 'generated',
    payload: paymentResult.payment,
  }, { db })

  if (fallbackContext?.reason) {
    await appendClientLoyaltySubscriptionEvent(updated.id, {
      eventType: 'payment_fallback_selected',
      gatewayEventId: paymentResult?.payment?.id ? `fallback:${paymentResult.payment.id}` : null,
      mpTopic: 'client-loyalty',
      ...sellerEventContext,
      mpPaymentId: paymentResult?.payment?.id ? String(paymentResult.payment.id) : null,
      paymentStatus: paymentResult?.payment?.status || null,
      paymentMethod: 'pix',
      paymentType: 'pix',
      amountCents: plan.preco_centavos || 0,
      actionTaken: 'pix_selected',
      ignoredReason: fallbackContext.reason,
      payload: {
        chosen_payment_method: 'pix',
        fallback_reason: fallbackContext.reason,
        fallback_source: 'pix',
        fallback_origin: fallbackContext.source || null,
        previous_failure_code: fallbackContext.previousFailureCode || null,
        previous_subscription_id: fallbackContext.previousSubscriptionId || null,
      },
    }, { db })
    console.info('[client-loyalty][risk] fallback_selected', {
      subscription_id: updated.id,
      cliente_id: clienteId,
      estabelecimento_id: estabelecimentoId,
      chosen_payment_method: 'pix',
      fallback_reason: fallbackContext.reason,
      fallback_source: 'pix',
      fallback_origin: fallbackContext.source || null,
      previous_failure_code: fallbackContext.previousFailureCode || null,
    })
  }

  return {
    subscription: updated,
    plan,
    estabelecimento,
    pix: paymentResult.pix,
    payment: paymentResult.payment,
  }
}

async function resolveGatewayContextFromUserId(bodyUserId, sellerAccount = null) {
  const account = (sellerAccount?.estabelecimento_id || sellerAccount?.estabelecimentoId)
    ? sellerAccount
    : (bodyUserId == null ? null : await getMpAccountBySellerIdentifier(bodyUserId))
  const estabelecimentoId = Number(account?.estabelecimento_id || account?.estabelecimentoId || 0) || null
  if (!estabelecimentoId) return null
  const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
  if (!mpAccess?.accessToken) return null
  return {
    estabelecimentoId,
    accessToken: mpAccess.accessToken,
    account,
  }
}

function resolvePaymentPreapprovalId(payment = {}) {
  return String(
    payment?.preapproval_id ||
      payment?.preapprovalId ||
      payment?.metadata?.preapproval_id ||
      payment?.metadata?.preapprovalId ||
      payment?.metadata?.gateway_subscription_id ||
      payment?.metadata?.gatewaySubscriptionId ||
      payment?.point_of_interaction?.transaction_data?.subscription_id ||
      payment?.point_of_interaction?.transaction_data?.subscriptionId ||
      payment?.subscription_id ||
      payment?.subscriptionId ||
      ''
  ).trim() || null
}

function resolvePaymentExternalReference(payment = {}) {
  return String(payment?.external_reference || '').trim() || null
}

function resolvePaymentPoiType(payment = {}) {
  return String(payment?.point_of_interaction?.type || '').trim().toUpperCase() || null
}

function resolvePaymentOperationType(payment = {}) {
  return String(payment?.operation_type || payment?.operationType || '').trim().toLowerCase() || null
}

function isLoyaltyExternalReference(externalReference) {
  return /^loyalty:/i.test(String(externalReference || '').trim())
}

function isPendingGatewayPaymentStatus(status) {
  return ['pending', 'in_process', 'in_mediation', 'authorized', 'scheduled']
    .includes(normalizeGatewayPaymentStatusKey(status))
}

async function resolveLocalLoyaltySubscriptionLinkFromPayment(payment, existing = null, {
  gatewayEventId = null,
  getSubscriptionById = getClientLoyaltySubscriptionById,
  getSubscriptionByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getSubscriptionByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getSubscriptionByGatewayPaymentId = getClientLoyaltySubscriptionByGatewayPaymentId,
  getSubscriptionByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getSubscriptionByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
} = {}) {
  const metadataSubscriptionId = Number(payment?.metadata?.loyalty_subscription_id || 0) || null
  const gatewayPaymentId = payment?.id != null ? String(payment.id) : null
  const preapprovalId = resolvePaymentPreapprovalId(payment)
  const externalReference = resolvePaymentExternalReference(payment)

  if (metadataSubscriptionId) {
    const subscription = await getSubscriptionById(metadataSubscriptionId)
    if (subscription?.id) {
      return { subscription, lookupBy: 'metadata_loyalty_subscription_id' }
    }
  }

  if (existing?.id) {
    return { subscription: existing, lookupBy: 'existing_subscription' }
  }

  if (preapprovalId) {
    const subscription = await getSubscriptionByGatewayId(preapprovalId)
    if (subscription?.id) {
      return { subscription, lookupBy: 'mp_preapproval_id' }
    }
  }

  if (externalReference) {
    const subscription = await getSubscriptionByExternalReference(externalReference)
    if (subscription?.id) {
      return { subscription, lookupBy: 'external_reference' }
    }
  }

  if (gatewayPaymentId) {
    const subscription = await getSubscriptionByGatewayPaymentId(gatewayPaymentId)
    if (subscription?.id) {
      return { subscription, lookupBy: 'gateway_payment_id' }
    }
  }

  if (gatewayEventId) {
    const eventLink = await getSubscriptionByEventResourceId(gatewayEventId, { mpTopic: 'payment' })
    if (eventLink?.id) {
      return { subscription: eventLink, lookupBy: 'event_linkage' }
    }
    const webhookLink = await getSubscriptionByWebhookResourceId(gatewayEventId, { topic: 'payment' })
    if (webhookLink?.id) {
      return { subscription: webhookLink, lookupBy: 'webhook_linkage' }
    }
  }

  return { subscription: null, lookupBy: null }
}

async function resolveLocalLoyaltySubscriptionFromPayment(payment, existing = null, options = {}) {
  const result = await resolveLocalLoyaltySubscriptionLinkFromPayment(payment, existing, options)
  return result.subscription || null
}

export async function resolveClientLoyaltyPaymentMatch(payment, {
  existingSubscription = null,
  gatewayEventId = null,
  getSubscriptionById = getClientLoyaltySubscriptionById,
  getSubscriptionByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getSubscriptionByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getSubscriptionByGatewayPaymentId = getClientLoyaltySubscriptionByGatewayPaymentId,
  getSubscriptionByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getSubscriptionByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
} = {}) {
  const metadataType = String(payment?.metadata?.kind || payment?.metadata?.type || '').toLowerCase()
  const paymentStatus = normalizeGatewayPaymentStatus(payment?.status)
  const operationType = resolvePaymentOperationType(payment)
  const preapprovalId = resolvePaymentPreapprovalId(payment)
  const externalReference = resolvePaymentExternalReference(payment)
  const poiType = resolvePaymentPoiType(payment)
  const subscriptionId = String(
    payment?.point_of_interaction?.transaction_data?.subscription_id ||
      payment?.point_of_interaction?.transaction_data?.subscriptionId ||
      payment?.subscription_id ||
      payment?.subscriptionId ||
      ''
  ).trim() || null
  const gatewayPaymentId = payment?.id != null ? String(payment.id) : null
  const localLink = await resolveLocalLoyaltySubscriptionLinkFromPayment(payment, existingSubscription, {
    gatewayEventId,
    getSubscriptionById,
    getSubscriptionByGatewayId,
    getSubscriptionByExternalReference,
    getSubscriptionByGatewayPaymentId,
    getSubscriptionByEventResourceId,
    getSubscriptionByWebhookResourceId,
  })
  const localSubscription = localLink.subscription || null
  const hasMetadataSubscriptionId = Number(payment?.metadata?.loyalty_subscription_id || 0) > 0
  const hasLoyaltyReference = isLoyaltyExternalReference(externalReference)
  const hasSubscriptionSignal = Boolean(preapprovalId || subscriptionId)
  const recurringPayment = operationType === 'recurring_payment'
  const subscriptionsPoi = poiType === 'SUBSCRIPTIONS'
  const failureCodes = []

  let matched = false
  let matchRule = null

  if (metadataType === 'loyalty_subscription_pix') {
    matched = true
    matchRule = 'pix_metadata_kind'
  } else if (localSubscription?.id && hasSubscriptionSignal) {
    matched = true
    matchRule = 'recurring_payment_subscription_linkage'
  } else if (localSubscription?.id && hasLoyaltyReference) {
    matched = true
    matchRule = 'external_reference_linkage'
  } else if (localSubscription?.id && (recurringPayment || subscriptionsPoi || hasMetadataSubscriptionId)) {
    matched = true
    matchRule = 'loyalty_subscription_linkage'
  } else if (hasLoyaltyReference && (hasSubscriptionSignal || (recurringPayment && subscriptionsPoi) || recurringPayment || subscriptionsPoi)) {
    matched = true
    matchRule = 'recurring_payment_subscription_linkage'
  }

  if (!matched && !externalReference) {
    failureCodes.push('missing_external_reference')
  }
  if (!matched && !hasSubscriptionSignal && !localSubscription?.id) {
    failureCodes.push('missing_preapproval_linkage')
  }

  return {
    matched,
    reason: matched ? null : 'not_loyalty_payment',
    matchRule,
    paymentStatus,
    operationType,
    externalReference,
    preapprovalId,
    poiType,
    subscriptionId,
    gatewayPaymentId,
    localSubscription,
    lookupBy: localLink.lookupBy || null,
    metadataType: metadataType || null,
    failureCodes,
    signals: {
      recurringPayment,
      subscriptionsPoi,
      hasLoyaltyReference,
      hasSubscriptionSignal,
      hasMetadataSubscriptionId,
      localSubscriptionLinked: Boolean(localSubscription?.id),
    },
  }
}

export async function syncClientLoyaltyPixPaymentFromGateway(paymentId, {
  bodyUserId = null,
  gatewayEventId = null,
  sellerAccount = null,
  prefetchedPayment = null,
} = {}) {
  const existing = await getClientLoyaltySubscriptionByGatewayPaymentId(paymentId)
  let estabelecimentoId = existing?.estabelecimentoId || null
  let accessToken = null
  let resolvedSellerAccount = sellerAccount || null

  if (estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
    accessToken = mpAccess?.accessToken || null
    resolvedSellerAccount = mpAccess?.account || resolvedSellerAccount
  }
  if (!accessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId, resolvedSellerAccount)
    estabelecimentoId = gatewayContext?.estabelecimentoId || estabelecimentoId || null
    accessToken = gatewayContext?.accessToken || null
    resolvedSellerAccount = gatewayContext?.account || resolvedSellerAccount
  }
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const payment = prefetchedPayment || await fetchMercadoPagoPayment(paymentId, { accessToken })
  const paymentStatus = normalizeGatewayPaymentStatus(payment?.status)
  const metadataType = String(payment?.metadata?.kind || payment?.metadata?.type || '').toLowerCase()
  if (metadataType !== 'loyalty_subscription_pix') {
    return { ok: false, reason: 'not_loyalty_payment' }
  }

  const subscriptionId = Number(payment?.metadata?.loyalty_subscription_id || 0) || null
  const localSubscription =
    (subscriptionId ? await getClientLoyaltySubscriptionById(subscriptionId) : null) ||
    existing ||
    await getClientLoyaltySubscriptionByExternalReference(payment?.external_reference || '')
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }
  if (
    (resolvedSellerAccount?.estabelecimento_id || resolvedSellerAccount?.estabelecimentoId) &&
    Number(localSubscription.estabelecimentoId || 0) !== Number(
      resolvedSellerAccount?.estabelecimento_id || resolvedSellerAccount?.estabelecimentoId || 0
    )
  ) {
    return { ok: false, reason: 'establishment_mismatch' }
  }
  const sellerEventContext = buildSellerEventContext(
    resolvedSellerAccount,
    localSubscription.estabelecimentoId || estabelecimentoId,
    {}
  )
  const paymentSnapshot = buildClientLoyaltyPaymentSnapshot(payment, {
    paymentId,
    paymentTarget: 'payment',
  })
  const amountCents = Number.isFinite(Number(payment?.transaction_amount))
    ? Math.round(Number(payment.transaction_amount) * 100)
    : null
  const paymentType = payment?.payment_type_id || payment?.payment_method_id || 'pix'

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const locked = await lockSubscriptionRow(localSubscription.id, { db: conn })
    if (!locked) {
      await conn.rollback()
      return { ok: false, reason: 'subscription_not_found' }
    }
    await recordClientLoyaltyPaymentSnapshotTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      mpTopic: 'payment',
      eventContext: sellerEventContext,
      paymentType,
      rawPayload: payment,
    }, { db: conn })

    if (isApprovedGatewayPaymentStatus(paymentStatus)) {
      if (String(locked.gateway_payment_id || '') === String(payment?.id || '')) {
        const current = await getClientLoyaltySubscriptionById(localSubscription.id, { db: conn })
        if (String(current?.status || '').toLowerCase() === 'active') {
          await conn.commit()
          return { ok: true, handled: true, already_processed: true, subscription: current }
        }
      }
      const activated = await activateSubscriptionCycleTx(localSubscription.id, {
        paymentDate: payment?.date_approved || payment?.date_last_updated || new Date(),
        gatewayPaymentId: payment?.id ? String(payment.id) : null,
        externalReference: payment?.external_reference || localSubscription.externalReference || null,
        paymentMethod: 'pix',
        rawPayload: payment,
        gatewayEventId: gatewayEventId || payment?.id || null,
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        amountCents,
      }, { db: conn })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: 'active',
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        rawPayload: payment,
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: 'active', subscription: activated }
    }

    if (isFailedGatewayPaymentStatus(paymentStatus)) {
      const updated = await markSubscriptionPastDueTx(localSubscription.id, {
        paymentStatus,
        gatewayPaymentId: payment?.id ? String(payment.id) : null,
        externalReference: payment?.external_reference || localSubscription.externalReference || null,
        rawPayload: payment,
        gatewayEventId: gatewayEventId || payment?.id || null,
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        amountCents,
        transitionRule: 'payment_rejected_past_due',
      }, { db: conn })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: updated.status || null,
        transitionRule: 'payment_rejected_past_due',
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        rawPayload: payment,
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: updated.status, subscription: updated }
    }

    await updateClientLoyaltySubscription(localSubscription.id, {
      ownerType: 'establishment',
      sellerMpAccountId: resolvedSellerAccount?.id || localSubscription.sellerMpAccountId || null,
      status: 'pending_pix',
      gatewayPaymentId: payment?.id ? String(payment.id) : null,
      externalReference: payment?.external_reference || localSubscription.externalReference || null,
    }, { db: conn })
    await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      previousSubscriptionStatus: locked.status || null,
      nextSubscriptionStatus: 'pending_pix',
      mpTopic: 'payment',
      eventContext: sellerEventContext,
      paymentType,
      rawPayload: payment,
    }, { db: conn })
    await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
      eventType: 'pix_pending',
      gatewayEventId: gatewayEventId || payment?.id || null,
      mpTopic: 'payment',
      ...sellerEventContext,
      mpPaymentId: payment?.id ? String(payment.id) : null,
      paymentStatus: paymentStatus || null,
      paymentMethod: 'pix',
      paymentType,
      amountCents,
      actionTaken: 'pending',
      payload: payment,
    }, { db: conn })
    await conn.commit()
    return { ok: true, handled: false, status: 'pending_pix' }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

async function syncClientLoyaltyCardPaymentFromGateway(paymentId, {
  bodyUserId = null,
  gatewayEventId = null,
  sellerAccount = null,
  prefetchedPayment = null,
  paymentMatch = null,
} = {}) {
  const existing = await getClientLoyaltySubscriptionByGatewayPaymentId(paymentId)
  let estabelecimentoId = existing?.estabelecimentoId || null
  let accessToken = null
  let resolvedSellerAccount = sellerAccount || null

  if (estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
    accessToken = mpAccess?.accessToken || null
    resolvedSellerAccount = mpAccess?.account || resolvedSellerAccount
  }
  if (!accessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId, resolvedSellerAccount)
    estabelecimentoId = gatewayContext?.estabelecimentoId || estabelecimentoId || null
    accessToken = gatewayContext?.accessToken || null
    resolvedSellerAccount = gatewayContext?.account || resolvedSellerAccount
  }
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const payment = prefetchedPayment || await fetchMercadoPagoPayment(paymentId, { accessToken })
  const preapprovalId = paymentMatch?.preapprovalId || resolvePaymentPreapprovalId(payment)
  if (!preapprovalId) {
    return { ok: false, reason: 'preapproval_not_found', matchDetails: paymentMatch || null }
  }

  const localSubscription =
    paymentMatch?.localSubscription ||
    await resolveLocalLoyaltySubscriptionFromPayment(payment, existing, {
      gatewayEventId: gatewayEventId || paymentId,
    })
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found', matchDetails: paymentMatch || null }
  }
  if (
    resolvedSellerAccount?.estabelecimento_id &&
    Number(localSubscription.estabelecimentoId || 0) !== Number(resolvedSellerAccount.estabelecimento_id || 0)
  ) {
    return { ok: false, reason: 'establishment_mismatch', matchDetails: paymentMatch || null }
  }

  const paymentStatus = normalizeGatewayPaymentStatus(payment?.status)
  const amountCents = Number.isFinite(Number(payment?.transaction_amount))
    ? Math.round(Number(payment.transaction_amount) * 100)
    : null
  const paymentType = payment?.payment_type_id || payment?.payment_method_id || 'subscription_payment'
  const sellerEventContext = buildSellerEventContext(
    resolvedSellerAccount,
    localSubscription.estabelecimentoId || estabelecimentoId,
    {}
  )
  const paymentSnapshot = buildClientLoyaltyPaymentSnapshot(payment, {
    paymentId,
    paymentTarget: 'payment',
  })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const locked = await lockSubscriptionRow(localSubscription.id, { db: conn })
    if (!locked) {
      await conn.rollback()
      return { ok: false, reason: 'subscription_not_found' }
    }
    await recordClientLoyaltyPaymentSnapshotTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      mpTopic: 'payment',
      eventContext: sellerEventContext,
      paymentType,
      rawPayload: payment,
    }, { db: conn })

    if (isApprovedGatewayPaymentStatus(paymentStatus)) {
      const activated = await activateSubscriptionCycleTx(localSubscription.id, {
        paymentDate: payment?.date_approved || payment?.date_last_updated || new Date(),
        gatewayPaymentId: payment?.id ? String(payment.id) : null,
        gatewaySubscriptionId: preapprovalId,
        gatewayCustomerId: payment?.payer?.id != null ? String(payment.payer.id) : null,
        externalReference: payment?.external_reference || localSubscription.externalReference || null,
        paymentMethod: 'credit_card',
        rawPayload: payment,
        gatewayEventId: gatewayEventId || payment?.id || paymentId,
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        amountCents,
      }, { db: conn })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: 'active',
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        rawPayload: payment,
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: 'active', subscription: activated }
    }

    if (isFailedGatewayPaymentStatus(paymentStatus)) {
      const updated = await markSubscriptionPastDueTx(localSubscription.id, {
        paymentStatus,
        gatewayPaymentId: payment?.id ? String(payment.id) : null,
        gatewaySubscriptionId: preapprovalId,
        gatewayCustomerId: payment?.payer?.id != null ? String(payment.payer.id) : null,
        externalReference: payment?.external_reference || localSubscription.externalReference || null,
        rawPayload: payment,
        gatewayEventId: gatewayEventId || payment?.id || paymentId,
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        amountCents,
        transitionRule: 'payment_rejected_past_due',
      }, { db: conn })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: updated.status || null,
        transitionRule: 'payment_rejected_past_due',
        mpTopic: 'payment',
        eventContext: sellerEventContext,
        paymentType,
        rawPayload: payment,
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: updated.status, subscription: updated }
    }

    await updateClientLoyaltySubscription(localSubscription.id, {
      ownerType: 'establishment',
      sellerMpAccountId: resolvedSellerAccount?.id || localSubscription.sellerMpAccountId || null,
      status: 'pending_payment',
      paymentMethod: 'credit_card',
      gatewayPaymentId: payment?.id ? String(payment.id) : null,
      gatewaySubscriptionId: preapprovalId,
      mpPreapprovalId: preapprovalId,
      externalReference: payment?.external_reference || localSubscription.externalReference || null,
      gatewayCustomerId: payment?.payer?.id != null ? String(payment.payer.id) : null,
      mpPayerId: payment?.payer?.id != null ? String(payment.payer.id) : null,
    }, { db: conn })
    await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      previousSubscriptionStatus: locked.status || null,
      nextSubscriptionStatus: 'pending_payment',
      mpTopic: 'payment',
      eventContext: sellerEventContext,
      paymentType,
      rawPayload: payment,
    }, { db: conn })
    await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
      eventType: 'payment_pending',
      gatewayEventId: gatewayEventId || payment?.id || paymentId,
      mpTopic: 'payment',
      ...sellerEventContext,
      mpPaymentId: payment?.id ? String(payment.id) : null,
      paymentStatus: paymentStatus || null,
      paymentMethod: 'credit_card',
      paymentType,
      amountCents,
      actionTaken: isPendingGatewayPaymentStatus(paymentStatus) ? 'pending' : 'observed',
      payload: payment,
    }, { db: conn })
    await conn.commit()
    return { ok: true, handled: false, status: 'pending_payment' }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function syncClientLoyaltyPaymentFromGateway(paymentId, {
  bodyUserId = null,
  gatewayEventId = null,
  sellerAccount = null,
  accessToken = null,
  prefetchedPayment = null,
  paymentMatch = null,
  paymentMatcher = resolveClientLoyaltyPaymentMatch,
} = {}) {
  const gatewayContext = accessToken
    ? {
      account: sellerAccount || null,
      accessToken,
    }
    : await resolveGatewayContextFromUserId(bodyUserId, sellerAccount)
  const resolvedSellerAccount = gatewayContext?.account || sellerAccount || null
  const resolvedAccessToken = accessToken || gatewayContext?.accessToken || null

  if (!resolvedAccessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const payment = prefetchedPayment || await fetchMercadoPagoPayment(paymentId, { accessToken: resolvedAccessToken })
  const metadataType = String(payment?.metadata?.kind || payment?.metadata?.type || '').toLowerCase()
  if (metadataType === 'loyalty_subscription_pix') {
    return syncClientLoyaltyPixPaymentFromGateway(paymentId, {
      bodyUserId,
      gatewayEventId,
      sellerAccount: resolvedSellerAccount,
      prefetchedPayment: payment,
    })
  }

  const resolvedPaymentMatch = paymentMatch || await paymentMatcher(payment, {
    gatewayEventId: gatewayEventId || paymentId,
  })
  if (!resolvedPaymentMatch?.matched) {
    return { ok: false, reason: 'not_loyalty_payment', matchDetails: resolvedPaymentMatch || null }
  }

  return syncClientLoyaltyCardPaymentFromGateway(paymentId, {
    bodyUserId,
    gatewayEventId,
    sellerAccount: resolvedSellerAccount,
    prefetchedPayment: payment,
    paymentMatch: resolvedPaymentMatch,
  })
}

export async function syncClientLoyaltyCardSubscriptionFromGateway(gatewaySubscriptionId, {
  bodyUserId = null,
  gatewayEventId = null,
  sellerAccount = null,
  accessToken = null,
} = {}) {
  const localSubscription = await getClientLoyaltySubscriptionByGatewayId(gatewaySubscriptionId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  let resolvedAccessToken = accessToken || null
  let resolvedSellerAccount = sellerAccount || null
  if (localSubscription.estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(localSubscription.estabelecimentoId, { allowFallback: false })
    resolvedAccessToken = resolvedAccessToken || mpAccess?.accessToken || null
    resolvedSellerAccount = resolvedSellerAccount || mpAccess?.account || null
  }
  if (!resolvedAccessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId, resolvedSellerAccount)
    resolvedAccessToken = gatewayContext?.accessToken || null
    resolvedSellerAccount = gatewayContext?.account || resolvedSellerAccount
  }
  if (!resolvedAccessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackCycle: 'mensal',
    accessToken: resolvedAccessToken,
  })
  const gatewaySubscription = gatewayResult.subscription
  if (
    resolvedSellerAccount?.estabelecimento_id &&
    Number(localSubscription.estabelecimentoId || 0) !== Number(resolvedSellerAccount.estabelecimento_id || 0)
  ) {
    return { ok: false, reason: 'establishment_mismatch' }
  }
  const sellerEventContext = buildSellerEventContext(resolvedSellerAccount, localSubscription.estabelecimentoId, {})
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const current = await getClientLoyaltySubscriptionById(localSubscription.id, { db: conn })
    const currentState = computeClientLoyaltySubscriptionState(current)
    const preserveCurrentCycle =
      Boolean(currentState.benefitsActive) &&
      String(gatewaySubscription?.status || '').toLowerCase() === 'pending_payment'
    const nextStatus = preserveCurrentCycle
      ? current?.status || localSubscription.status
      : gatewaySubscription?.status || localSubscription.status
    const updated = await updateClientLoyaltySubscription(localSubscription.id, {
      ownerType: 'establishment',
      sellerMpAccountId: resolvedSellerAccount?.id || localSubscription.sellerMpAccountId || null,
      paymentMethod: 'credit_card',
      gatewayCustomerId: gatewaySubscription?.gatewayCustomerId || localSubscription.gatewayCustomerId || null,
      mpPayerId: gatewaySubscription?.gatewayCustomerId || localSubscription.mpPayerId || localSubscription.gatewayCustomerId || null,
      gatewaySubscriptionId: gatewaySubscription?.gatewaySubscriptionId || localSubscription.gatewaySubscriptionId || null,
      mpPreapprovalId: gatewaySubscription?.gatewaySubscriptionId || localSubscription.mpPreapprovalId || localSubscription.gatewaySubscriptionId || null,
      externalReference: gatewaySubscription?.externalReference || localSubscription.externalReference || null,
      nextBillingAt: gatewaySubscription?.nextBillingAt || localSubscription.nextBillingAt || null,
      status: nextStatus,
    }, { db: conn })

    await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
      eventType: preserveCurrentCycle
        ? 'subscription_updated'
        : gatewaySubscription?.status === 'canceled'
          ? 'subscription_canceled'
          : gatewaySubscription?.status === 'past_due'
            ? 'payment_failed'
            : gatewaySubscription?.status === 'active'
              ? 'subscription_updated'
              : 'subscription_pending',
      gatewayEventId: gatewayEventId || gatewaySubscriptionId,
      mpTopic: 'subscription',
      ...sellerEventContext,
      paymentStatus: gatewaySubscription?.status || null,
      paymentMethod: 'credit_card',
      actionTaken: preserveCurrentCycle ? 'updated_without_cycle_change' : 'synced',
      payload: gatewayResult.raw,
    }, { db: conn })

    if (gatewaySubscription?.status === 'active' && !updated.currentPeriodStart && gatewaySubscription?.currentPeriodStart) {
      await activateSubscriptionCycleTx(localSubscription.id, {
        paymentDate: gatewaySubscription.currentPeriodStart,
        gatewaySubscriptionId: gatewaySubscription.gatewaySubscriptionId || gatewaySubscriptionId,
        gatewayCustomerId: gatewaySubscription.gatewayCustomerId || null,
        externalReference: gatewaySubscription.externalReference || localSubscription.externalReference || null,
        paymentMethod: 'credit_card',
        rawPayload: gatewayResult.raw,
        gatewayEventId: gatewayEventId || gatewaySubscriptionId,
        mpTopic: 'subscription',
        eventContext: sellerEventContext,
        paymentType: 'subscription',
      }, { db: conn })
    }

    await conn.commit()
    return { ok: true, handled: true, subscription: updated }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function syncClientLoyaltyAuthorizedPaymentFromGateway(authorizedPaymentId, {
  bodyUserId = null,
  gatewayEventId = null,
  sellerAccount = null,
  accessToken = null,
} = {}) {
  let resolvedAccessToken = accessToken || null
  let resolvedSellerAccount = sellerAccount || null
  const existingByPayment = await getClientLoyaltySubscriptionByGatewayPaymentId(authorizedPaymentId)
  if (!resolvedAccessToken && existingByPayment?.estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(existingByPayment.estabelecimentoId, { allowFallback: false })
    resolvedAccessToken = mpAccess?.accessToken || null
    resolvedSellerAccount = mpAccess?.account || resolvedSellerAccount
  }
  if (!resolvedAccessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId, resolvedSellerAccount)
    resolvedAccessToken = gatewayContext?.accessToken || null
    resolvedSellerAccount = gatewayContext?.account || resolvedSellerAccount
  }
  if (!resolvedAccessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const paymentResult = await getMercadoPagoAuthorizedPayment(authorizedPaymentId, { accessToken: resolvedAccessToken })
  const authorizedPayment = paymentResult.authorizedPayment
  const localSubscription =
    existingByPayment ||
    (authorizedPayment?.preapprovalId
      ? await getClientLoyaltySubscriptionByGatewayId(authorizedPayment.preapprovalId)
      : null) ||
    await getClientLoyaltySubscriptionByExternalReference(authorizedPayment?.externalReference || '')
  if (!authorizedPayment?.preapprovalId && !localSubscription) {
    return { ok: false, reason: 'preapproval_not_found' }
  }
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }
  if (
    resolvedSellerAccount?.estabelecimento_id &&
    Number(localSubscription.estabelecimentoId || 0) !== Number(resolvedSellerAccount.estabelecimento_id || 0)
  ) {
    return { ok: false, reason: 'establishment_mismatch' }
  }

  const gatewaySubscriptionId =
    authorizedPayment?.preapprovalId ||
    localSubscription.mpPreapprovalId ||
    localSubscription.gatewaySubscriptionId ||
    null
  if (!gatewaySubscriptionId) {
    return { ok: false, reason: 'preapproval_not_found' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackCycle: 'mensal',
    accessToken: resolvedAccessToken,
  })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const sellerEventContext = buildSellerEventContext(resolvedSellerAccount, localSubscription.estabelecimentoId, {})
    const paymentSnapshot = buildClientLoyaltyPaymentSnapshot(paymentResult.raw, {
      paymentId: authorizedPayment.id || authorizedPaymentId,
      paymentTarget: 'authorized_payment',
    })
    const amountCents = authorizedPayment.amountCents != null
      ? Number(authorizedPayment.amountCents || 0)
      : null
    const locked = await lockSubscriptionRow(localSubscription.id, { db: conn })
    if (!locked) {
      await conn.rollback()
      return { ok: false, reason: 'subscription_not_found' }
    }
    await recordClientLoyaltyPaymentSnapshotTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      mpTopic: 'automatic-payments',
      eventContext: sellerEventContext,
      paymentType: 'subscription_authorized_payment',
      rawPayload: {
        payment: paymentResult.raw,
        subscription: gatewayResult.raw,
      },
    }, { db: conn })

    const lockedSubscription = {
      ...localSubscription,
      status: locked.status || localSubscription.status,
      paymentMethod: locked.payment_method || localSubscription.paymentMethod,
      gatewayPaymentId: locked.gateway_payment_id || localSubscription.gatewayPaymentId,
      gatewaySubscriptionId: locked.gateway_subscription_id || localSubscription.gatewaySubscriptionId,
      currentPeriodStart: toDate(locked.current_period_start) || localSubscription.currentPeriodStart || null,
      currentPeriodEnd: toDate(locked.current_period_end) || localSubscription.currentPeriodEnd || null,
    }
    const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus(authorizedPayment, {
      rawPayment: paymentResult.raw,
      currentSubscription: lockedSubscription,
    })
    const dominantFinalRealPayment = await findDominantClientLoyaltyFinalRealPaymentTx(localSubscription.id, {
      gatewayPaymentId: locked.gateway_payment_id || localSubscription.gatewayPaymentId || null,
      db: conn,
    })
    const authorizedPaymentPriority = resolveClientLoyaltyAuthorizedPaymentPriority({
      interpretation,
      dominantPayment: dominantFinalRealPayment,
      currentSubscriptionStatus: locked.status || localSubscription.status || null,
    })
    logClientLoyaltyDominantPaymentSelected({
      subscriptionId: localSubscription.id,
      gatewaySubscriptionId,
      authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
      dominantPayment: dominantFinalRealPayment,
      currentSubscriptionStatus: locked.status || localSubscription.status || null,
      attemptedNextStatus: authorizedPaymentPriority.attemptedNextStatus,
      priorityRule: authorizedPaymentPriority.priorityRule,
    })
    logClientLoyaltyConflictingPaymentSources({
      subscriptionId: localSubscription.id,
      gatewaySubscriptionId,
      authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
      interpretation,
      priority: authorizedPaymentPriority,
    })
    if (authorizedPaymentPriority.suppressTransition) {
      logClientLoyaltyAuthorizedPaymentInterpretation({
        subscriptionId: localSubscription.id,
        authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
        gatewaySubscriptionId,
        interpretation,
        nextSubscriptionStatus: authorizedPaymentPriority.preservedSubscriptionStatus || locked.status || null,
      })
      logClientLoyaltyAuthorizedPaymentTransitionSuppressed({
        subscriptionId: localSubscription.id,
        gatewaySubscriptionId,
        authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
        interpretation,
        priority: authorizedPaymentPriority,
      })
      await recordClientLoyaltyAuthorizedPaymentAuxiliaryTx(localSubscription.id, {
        authorizedPayment,
        authorizedPaymentId,
        gatewayEventId,
        gatewaySubscriptionId,
        interpretation,
        priority: authorizedPaymentPriority,
        sellerEventContext,
        amountCents,
        paymentResult,
        gatewayResult,
        db: conn,
      })
      const preserved = await getClientLoyaltySubscriptionById(localSubscription.id, { db: conn })
      await conn.commit()
      return {
        ok: true,
        handled: true,
        status: preserved?.status || authorizedPaymentPriority.preservedSubscriptionStatus || locked.status || null,
        subscription: preserved,
        payment_interpretation: interpretation,
        dominant_payment: dominantFinalRealPayment,
        priority_rule: authorizedPaymentPriority.priorityRule,
        transition_suppressed: true,
      }
    }

    if (interpretation.interpretedOutcome === 'approved') {
      const activated = await activateSubscriptionCycleTx(localSubscription.id, {
        paymentDate: authorizedPayment.paidAt || new Date(),
        gatewayPaymentId: authorizedPayment.id || null,
        gatewaySubscriptionId,
        gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || null,
        externalReference: gatewayResult?.subscription?.externalReference || localSubscription.externalReference || null,
        paymentMethod: 'credit_card',
        rawPayload: {
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
        },
        gatewayEventId: gatewayEventId || authorizedPayment.id || authorizedPaymentId,
        mpTopic: 'automatic-payments',
        eventContext: sellerEventContext,
        paymentType: 'subscription_authorized_payment',
        amountCents,
      }, { db: conn })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: 'active',
        transitionRule: interpretation.transitionRule,
        mpTopic: 'automatic-payments',
        eventContext: sellerEventContext,
        paymentType: 'subscription_authorized_payment',
        rawPayload: {
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
        },
      }, { db: conn })
      logClientLoyaltyAuthorizedPaymentInterpretation({
        subscriptionId: localSubscription.id,
        authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
        gatewaySubscriptionId,
        interpretation,
        nextSubscriptionStatus: 'active',
      })
      await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
        eventType: 'subscription_renewed',
        gatewayEventId: `renewal:${authorizedPayment.id || authorizedPaymentId}`,
        mpTopic: 'automatic-payments',
        ...sellerEventContext,
        mpPaymentId: authorizedPayment.id || null,
        paymentStatus: authorizedPayment.status || null,
        paymentMethod: 'credit_card',
        paymentType: 'subscription_authorized_payment',
        amountCents,
        actionTaken: 'renewed',
        payload: {
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
        },
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: 'active', subscription: activated }
    }

    if (interpretation.isPending) {
      const nextPendingStatus = interpretation.nextSubscriptionStatus || 'pending_payment'
      const updated = await updateClientLoyaltySubscription(localSubscription.id, {
        ownerType: 'establishment',
        sellerMpAccountId: resolvedSellerAccount?.id || localSubscription.sellerMpAccountId || null,
        status: nextPendingStatus,
        paymentMethod: 'credit_card',
        gatewayPaymentId: authorizedPayment.id || localSubscription.gatewayPaymentId || null,
        gatewaySubscriptionId,
        mpPreapprovalId: gatewaySubscriptionId,
        gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || localSubscription.gatewayCustomerId || null,
        mpPayerId: gatewayResult?.subscription?.gatewayCustomerId || localSubscription.mpPayerId || localSubscription.gatewayCustomerId || null,
        externalReference: gatewayResult?.subscription?.externalReference || localSubscription.externalReference || null,
        nextBillingAt: gatewayResult?.subscription?.nextBillingAt || localSubscription.nextBillingAt || null,
      }, { db: conn })
      logClientLoyaltyAuthorizedPaymentInterpretation({
        subscriptionId: localSubscription.id,
        authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
        gatewaySubscriptionId,
        interpretation,
        nextSubscriptionStatus: updated.status || nextPendingStatus,
      })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: updated.status || nextPendingStatus,
        transitionRule: interpretation.transitionRule,
        mpTopic: 'automatic-payments',
        eventContext: sellerEventContext,
        paymentType: 'subscription_authorized_payment',
        rawPayload: {
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
          interpreted_outcome: interpretation.interpretedOutcome,
          transition_rule: interpretation.transitionRule,
        },
      }, { db: conn })
      await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
        eventType: 'payment_pending',
        gatewayEventId: gatewayEventId || authorizedPayment.id || authorizedPaymentId,
        mpTopic: 'automatic-payments',
        ...sellerEventContext,
        mpPaymentId: authorizedPayment.id || null,
        paymentStatus: interpretation.status || authorizedPayment.rawStatus || authorizedPayment.status || null,
        paymentMethod: 'credit_card',
        paymentType: 'subscription_authorized_payment',
        amountCents,
        actionTaken: interpretation.transitionRule,
        payload: {
          interpreted_outcome: interpretation.interpretedOutcome,
          transition_rule: interpretation.transitionRule,
          payment_status: interpretation.status || null,
          payment_status_detail: interpretation.statusDetail || null,
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
        },
      }, { db: conn })
      await conn.commit()
      return {
        ok: true,
        handled: true,
        status: updated.status || nextPendingStatus,
        subscription: updated,
        payment_interpretation: interpretation,
      }
    }

    if (interpretation.isFinal) {
      const updated = await updateClientLoyaltySubscription(localSubscription.id, {
        ownerType: 'establishment',
        sellerMpAccountId: resolvedSellerAccount?.id || localSubscription.sellerMpAccountId || null,
        status: interpretation.nextSubscriptionStatus,
        paymentMethod: 'credit_card',
        gatewayPaymentId: authorizedPayment.id || localSubscription.gatewayPaymentId || null,
        gatewaySubscriptionId,
        mpPreapprovalId: gatewaySubscriptionId,
        gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || localSubscription.gatewayCustomerId || null,
        mpPayerId: gatewayResult?.subscription?.gatewayCustomerId || localSubscription.mpPayerId || localSubscription.gatewayCustomerId || null,
        externalReference: gatewayResult?.subscription?.externalReference || localSubscription.externalReference || null,
        nextBillingAt: gatewayResult?.subscription?.nextBillingAt || localSubscription.nextBillingAt || null,
      }, { db: conn })
      logClientLoyaltyAuthorizedPaymentInterpretation({
        subscriptionId: localSubscription.id,
        authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
        gatewaySubscriptionId,
        interpretation,
        nextSubscriptionStatus: updated.status || interpretation.nextSubscriptionStatus,
      })
      await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
        snapshot: paymentSnapshot,
        previousSubscriptionStatus: locked.status || null,
        nextSubscriptionStatus: updated.status || interpretation.nextSubscriptionStatus,
        transitionRule: interpretation.transitionRule,
        mpTopic: 'automatic-payments',
        eventContext: sellerEventContext,
        paymentType: 'subscription_authorized_payment',
        rawPayload: {
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
          interpreted_outcome: interpretation.interpretedOutcome,
          transition_rule: interpretation.transitionRule,
        },
      }, { db: conn })
      await appendClientLoyaltySubscriptionEvent(localSubscription.id, {
        eventType: interpretation.nextSubscriptionStatus === 'canceled' ? 'subscription_canceled' : 'payment_expired',
        gatewayEventId: gatewayEventId || authorizedPayment.id || authorizedPaymentId,
        mpTopic: 'automatic-payments',
        ...sellerEventContext,
        mpPaymentId: authorizedPayment.id || null,
        paymentStatus: interpretation.status || authorizedPayment.rawStatus || authorizedPayment.status || null,
        paymentMethod: 'credit_card',
        paymentType: 'subscription_authorized_payment',
        amountCents,
        actionTaken: interpretation.nextSubscriptionStatus,
        payload: {
          interpreted_outcome: interpretation.interpretedOutcome,
          transition_rule: interpretation.transitionRule,
          payment_status: interpretation.status || null,
          payment_status_detail: interpretation.statusDetail || null,
          payment: paymentResult.raw,
          subscription: gatewayResult.raw,
        },
      }, { db: conn })
      await conn.commit()
      return {
        ok: true,
        handled: true,
        status: updated.status || interpretation.nextSubscriptionStatus,
        subscription: updated,
        payment_interpretation: interpretation,
      }
    }

    const failureDetails = extractGatewayFailureDetails(
      { payment: paymentResult.raw, subscription: gatewayResult.raw },
      authorizedPayment.rawStatus || authorizedPayment.status || null
    )
    const updated = await markSubscriptionPastDueTx(localSubscription.id, {
      paymentStatus: interpretation.status || authorizedPayment.rawStatus || authorizedPayment.status || null,
      gatewayPaymentId: authorizedPayment.id || null,
      gatewaySubscriptionId,
      gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || null,
      externalReference: gatewayResult?.subscription?.externalReference || localSubscription.externalReference || null,
      rawPayload: {
        payment: paymentResult.raw,
        subscription: gatewayResult.raw,
      },
      gatewayEventId: gatewayEventId || authorizedPayment.id || authorizedPaymentId,
      mpTopic: 'automatic-payments',
      eventContext: sellerEventContext,
      paymentType: 'subscription_authorized_payment',
      amountCents,
      transitionRule: interpretation.transitionRule,
    }, { db: conn })
    await recordClientLoyaltyPaymentStatusTransitionTx(localSubscription.id, {
      snapshot: paymentSnapshot,
      previousSubscriptionStatus: locked.status || null,
      nextSubscriptionStatus: updated.status || null,
      transitionRule: interpretation.transitionRule,
      mpTopic: 'automatic-payments',
      eventContext: sellerEventContext,
      paymentType: 'subscription_authorized_payment',
      rawPayload: {
        payment: paymentResult.raw,
        subscription: gatewayResult.raw,
      },
    }, { db: conn })
    logClientLoyaltyAuthorizedPaymentInterpretation({
      subscriptionId: localSubscription.id,
      authorizedPaymentId: authorizedPayment.id || authorizedPaymentId,
      gatewaySubscriptionId,
      interpretation,
      nextSubscriptionStatus: updated.status || null,
      failureDetails,
    })
    await conn.commit()
    return {
      ok: true,
      handled: true,
      status: updated.status,
      subscription: updated,
      failure: failureDetails,
      payment_interpretation: interpretation,
    }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function cancelClientLoyaltySubscriptionForClient({
  clienteId,
  subscriptionId = null,
  estabelecimentoId = null,
  db = pool,
} = {}) {
  const subscription = subscriptionId
    ? await getClientLoyaltySubscriptionById(subscriptionId, { db })
    : await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db })
  if (!subscription || Number(subscription.clienteId) !== Number(clienteId)) {
    throw createError('Assinatura de fidelidade não encontrada.', 404, 'client_loyalty_subscription_not_found')
  }

  const state = computeClientLoyaltySubscriptionState(subscription)
  if (!subscription.canceledAt && subscription.paymentMethod === 'credit_card' && subscription.gatewaySubscriptionId) {
    try {
      const mpAccess = await resolveActiveLoyaltyMpContext(subscription.estabelecimentoId)
      await cancelMercadoPagoCardSubscription(subscription.gatewaySubscriptionId, {
        accessToken: mpAccess.accessToken,
      })
    } catch (error) {
      console.warn('[client-loyalty][cancel] gateway_cancel_failed', error?.message || error)
    }
  }

  const canceledAt = new Date()
  const nextStatus = state.withinCurrentPeriod ? 'canceled' : 'expired'
  const updated = await updateClientLoyaltySubscription(subscription.id, {
    status: nextStatus,
    autoRenew: false,
    canceledAt,
    cancelAt: subscription.currentPeriodEnd || canceledAt,
    nextBillingAt: null,
  }, { db })

  await appendClientLoyaltySubscriptionEvent(subscription.id, {
    eventType: 'subscription_canceled',
    gatewayEventId: `cancel:${subscription.id}:${canceledAt.toISOString()}`,
    payload: {
      canceled_at: canceledAt.toISOString(),
      keep_until: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    },
  }, { db })

  return updated
}

export async function loadClientLoyaltySubscriptionDetails(subscriptionInput, {
  db = pool,
  includeEvents = true,
  eventLimit = 30,
} = {}) {
  const subscription = typeof subscriptionInput === 'number'
    ? await getClientLoyaltySubscriptionById(subscriptionInput, { db })
    : subscriptionInput
  if (!subscription) return null

  const [plan, estabelecimento] = await Promise.all([
    getLoyaltyPlanById(subscription.loyaltyPlanId, { db }),
    fetchEstablishmentSummary(subscription.estabelecimentoId, { db }),
  ])
  const credits = subscription.currentPeriodStart
    ? await listSubscriptionCredits(subscription.id, {
        db,
        cycleRef: formatCycleRef(subscription.currentPeriodStart),
      })
    : []
  const events = includeEvents
    ? await listClientLoyaltySubscriptionEvents(subscription.id, { db, limit: eventLimit })
    : []
  const serializedSubscription = serializeClientLoyaltySubscription(subscription)
  const latestFailure = resolveLatestClientLoyaltyFailureSummary(events, {
    subscriptionStatus: serializedSubscription?.status || null,
  })
  const latestPaymentSnapshot = resolveLatestClientLoyaltyPaymentSnapshot(events)
  const recentRiskEvents = serializedSubscription?.payment_method === 'credit_card'
    ? await listRecentClientLoyaltyCardRiskEvents({
        clienteId: subscription.clienteId,
        estabelecimentoId: subscription.estabelecimentoId,
        loyaltyPlanId: subscription.loyaltyPlanId,
        db,
        limit: 80,
      })
    : []
  const recentAttemptSummary = resolveClientLoyaltyRecentCardAttemptSummary(recentRiskEvents, {
    amountCents: plan?.preco_centavos ?? null,
  })
  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: serializedSubscription?.status || null,
    latestFailure,
    recentAttemptSummary,
  })

  return {
    subscription: {
      ...serializedSubscription,
      last_failure_code: latestFailure?.code || null,
      last_failure_status: latestFailure?.status || null,
      last_failure_status_detail: latestFailure?.status_detail || null,
      last_failure_message: latestFailure?.friendly_message || null,
      last_failure_gateway_message: latestFailure?.message || latestFailure?.description || null,
      last_failure_at: latestFailure?.created_at || null,
      last_failure_source: latestFailure?.source || null,
      last_failure_payment_method_id: latestFailure?.payment_method_id || null,
      last_failure_payment_type_id: latestFailure?.payment_type_id || null,
      high_risk_consecutive_failures: latestFailure?.high_risk_consecutive_count || 0,
      payment_method_action_required: latestFailure?.high_risk_action_required === true,
      latest_payment_snapshot: latestPaymentSnapshot,
      retry_options: retryOptions,
    },
    subscription_status: serializedSubscription?.status || null,
    plan,
    estabelecimento: estabelecimento
      ? {
          id: Number(estabelecimento.id),
          nome: estabelecimento.nome || '',
          slug: estabelecimento.slug || '',
          avatar_url: estabelecimento.avatar_url || null,
        }
      : null,
    credits,
    events,
    latest_payment_snapshot: latestPaymentSnapshot,
    latest_failure: latestFailure,
    last_failure_code: latestFailure?.code || null,
    last_failure_status: latestFailure?.status || null,
    last_failure_status_detail: latestFailure?.status_detail || null,
    last_failure_message: latestFailure?.friendly_message || null,
    last_failure_gateway_message: latestFailure?.message || latestFailure?.description || null,
    last_failure_at: latestFailure?.created_at || null,
    last_failure_source: latestFailure?.source || null,
    high_risk_consecutive_failures: latestFailure?.high_risk_consecutive_count || 0,
    payment_method_action_required: latestFailure?.high_risk_action_required === true,
    retry_options: retryOptions,
  }
}
