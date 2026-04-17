// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import {
  createMercadoPagoPixCheckout,
  createMercadoPagoPixTopupCheckout,
  fetchMercadoPagoPayment,
  syncMercadoPagoPayment,
} from '../lib/billing.js'
import {
  cancelMercadoPagoCardSubscription,
  createMercadoPagoCardSubscription,
  createMercadoPagoCardRecoveryPayment,
  getMercadoPagoAuthorizedPayment,
  getMercadoPagoCardSubscription,
  getMercadoPagoPublicKey,
  updateMercadoPagoCardSubscription,
} from '../lib/mercadopago_subscriptions.js'
import { notifyEmail } from '../lib/notifications.js'
import { notifyAppointmentConfirmed } from '../lib/appointment_confirmation.js'
import {
  getWhatsAppWalletSnapshot,
  WHATSAPP_TOPUP_PACKAGES,
  listWhatsAppTopups,
} from '../lib/whatsapp_wallet.js'
import {
  getPlanContext,
  serializePlanContext,
  normalizeBillingCycle,
  PLAN_TIERS,
  isDowngrade,
  resolvePlanConfig,
  countProfessionals,
  formatPlanLimitExceeded,
  getPlanPriceCents,
} from '../lib/plans.js'
import { checkMonthlyAppointmentLimit } from '../lib/appointment_limits.js'
import {
  getSubscriptionById,
  getSubscriptionByGatewayId,
  getSubscriptionEventByGatewayEventId,
  listSubscriptionEventsBySubscriptionId,
  listSubscriptionsForEstabelecimento,
  listSubscriptionEventsForEstabelecimento,
  serializeSubscription,
  createSubscription,
  updateSubscription,
  appendSubscriptionEvent,
} from '../lib/subscriptions.js'
import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'
import { BillingService } from '../lib/billing_service.js'
import { listActiveWhatsAppPacks, findWhatsAppPack } from '../lib/addon_packs.js'
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js'
import { getMercadoPagoCredentialDiagnostics, toMercadoPagoCardFlowError } from '../lib/mercadopago_card_tokens.js'
import { resolveMpAccessToken } from '../services/mpAccounts.js'
import { logBlockedRouteAccess, resolveRouteTokenAccess } from '../lib/route_access.js'
import { loadEffectiveSubscriptionContext } from '../lib/subscription_state.js'
import { normalizeSubscriptionStatus } from '../lib/subscription_normalization.js'
import {
  enrichMercadoPagoSubscriptionEvent,
  findLatestMercadoPagoPaymentResult,
  summarizeMercadoPagoGatewayResult,
} from '../lib/mercadopago_payment_outcome.js'
import {
  buildRecoveryChargeFingerprint,
  canCreateSubscription,
  canRunRecoveryCharge,
} from '../lib/subscription_charge_policy.js'
import {
  syncClientLoyaltyAuthorizedPaymentFromGateway,
  syncClientLoyaltyCardSubscriptionFromGateway,
  syncClientLoyaltyPixPaymentFromGateway,
} from '../lib/client_loyalty_billing.js'
import { cancelPendingPaymentAppointmentTx } from '../lib/appointment_loyalty.js'

const router = Router()
const DAY_MS = 86400000
const MP_COLLECTOR_ID = Number(process.env.MERCADOPAGO_COLLECTOR_ID || 281768531)
const WEBHOOK_MISMATCH_WINDOW_MS = 60000
const webhookMismatchLogByIp = new Map()
const CARD_RECOVERY_STATUSES = new Set(['past_due', 'unpaid', 'expired'])

function requireBillingWebhookHealthAccess(req, res, next) {
  const access = resolveRouteTokenAccess(req, {
    envNames: ['BILLING_WEBHOOK_HEALTH_TOKEN', 'ADMIN_TOKEN'],
    headerNames: ['x-billing-health-token', 'x-admin-token'],
    allowAuthorizationBearer: false,
  })
  if (access.ok) return next()

  logBlockedRouteAccess('billing:webhook-health', req, {
    reason: access.reason || 'forbidden',
    token_configured: access.configured,
  })
  return res.status(404).json({ error: 'not_found' })
}

function normalizeWebhookHeaderValue(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function parseSignatureHeaderForLog(header) {
  const raw = normalizeWebhookHeaderValue(header)
  const trimmed = raw.trim()
  if (!trimmed) {
    return { signaturePrefix: null, ts: null, v1Prefix: null }
  }
  const signaturePrefix = trimmed.slice(0, 32)
  let ts = null
  let v1 = null
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex < 0) continue
    const key = part.slice(0, separatorIndex).trim().toLowerCase()
    const value = part.slice(separatorIndex + 1).trim()
    if (key === 'ts') ts = value
    if (key === 'v1') v1 = value
  }
  return { signaturePrefix, ts, v1Prefix: v1 ? v1.slice(0, 12) : null }
}

function getClientIpForLog(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim()
  if (forwarded) return forwarded
  return String(req.ip || '').trim()
}

function shouldLogMismatchForIp(ip) {
  const key = ip || 'unknown'
  const now = Date.now()
  const last = webhookMismatchLogByIp.get(key) || 0
  if (now - last < WEBHOOK_MISMATCH_WINDOW_MS) return false
  webhookMismatchLogByIp.set(key, now)
  if (webhookMismatchLogByIp.size > 500) {
    const cutoff = now - WEBHOOK_MISMATCH_WINDOW_MS * 5
    for (const [storedKey, timestamp] of webhookMismatchLogByIp.entries()) {
      if (timestamp < cutoff) webhookMismatchLogByIp.delete(storedKey)
    }
  }
  return true
}

async function summarizeReminders(estabelecimentoId) {
  const [rows] = await pool.query(
    `SELECT reminder_kind, channel, MAX(sent_at) AS sent_at
     FROM billing_payment_reminders
     WHERE estabelecimento_id=?
     GROUP BY reminder_kind, channel`,
    [estabelecimentoId]
  )
  const reminders = {}
  for (const row of rows) {
    const kind = row?.reminder_kind
    if (!kind) continue
    if (!reminders[kind]) reminders[kind] = {}
    reminders[kind][row.channel] = row.sent_at ? new Date(row.sent_at).toISOString() : null
  }
  return reminders
}

function normalizePlanKey(plan) {
  const p = String(plan || '').toLowerCase().trim()
  return PLAN_TIERS.includes(p) ? p : ''
}

function requiresCardRecovery(status) {
  return CARD_RECOVERY_STATUSES.has(normalizeSubscriptionStatus(status))
}

function buildCardRecoveryExternalReference(subscriptionId, idempotencyKey) {
  return [
    'subscription_recovery',
    'sub',
    String(subscriptionId || ''),
    'attempt',
    String(idempotencyKey || randomUUID()),
  ].join(':')
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

function inferIdentificationType(value) {
  const digits = digitsOnly(value)
  if (digits.length === 11) return 'CPF'
  if (digits.length === 14) return 'CNPJ'
  return null
}

function buildBillingPayerProfile(user = {}, payload = {}) {
  const identificationNumber =
    digitsOnly(
      payload?.identification_number ||
      payload?.identificationNumber ||
      user?.cpf_cnpj ||
      ''
    ) || null
  const identificationType =
    String(
      payload?.identification_type ||
      payload?.identificationType ||
      inferIdentificationType(identificationNumber) ||
      ''
    ).trim().toUpperCase() || null

  return {
    email: payload?.payer_email || payload?.payerEmail || user?.email || null,
    fullName: user?.nome || null,
    identificationType,
    identificationNumber,
    phone: user?.telefone || null,
    address: {
      zipCode: user?.cep || null,
      streetName: user?.endereco || null,
      streetNumber: user?.numero || null,
      neighborhood: user?.bairro || null,
      city: user?.cidade || null,
      federalUnit: user?.estado || null,
    },
  }
}

function buildMercadoPagoPaymentEventPayload({
  payment = null,
  paymentResult = null,
  gatewaySubscription = null,
  requestId = null,
  operation = null,
  source = null,
  recovery = false,
  previousStatus = null,
  nextStatus = null,
  externalReference = null,
  decision = null,
} = {}) {
  return {
    operation: operation || null,
    source: source || null,
    recovery: Boolean(recovery),
    previous_status: previousStatus || null,
    next_status: nextStatus || null,
    request_id: requestId || null,
    payment_id: payment?.id != null ? String(payment.id) : paymentResult?.payment_id || null,
    preapproval_id:
      payment?.preapproval_id ||
      payment?.subscription_id ||
      paymentResult?.preapproval_id ||
      gatewaySubscription?.id ||
      null,
    external_reference:
      payment?.external_reference ||
      paymentResult?.external_reference ||
      externalReference ||
      null,
    live_mode: payment?.live_mode ?? paymentResult?.live_mode ?? null,
    payment_method_id: payment?.payment_method_id || paymentResult?.payment_method_id || null,
    payment_type_id: payment?.payment_type_id || paymentResult?.payment_type_id || null,
    transaction_amount: payment?.transaction_amount ?? paymentResult?.transaction_amount ?? null,
    decision: decision || paymentResult?.decision || null,
    payment_result: paymentResult || null,
    raw: {
      payment: payment || null,
      subscription: gatewaySubscription || null,
    },
  }
}

function logMercadoPagoPaymentDecision(tag, {
  subscription = null,
  paymentResult = null,
  payment = null,
  requestId = null,
  source = null,
  activated = false,
} = {}) {
  const level = paymentResult?.status_group === 'rejected'
    ? 'warn'
    : paymentResult?.status_group === 'pending'
      ? 'info'
      : 'info'
  const logger = console[level] || console.info
  logger(`[billing][${tag}]`, {
    request_id: requestId || null,
    source: source || null,
    subscription_id: subscription?.id || null,
    estabelecimento_id: subscription?.estabelecimentoId || null,
    plan: subscription?.plan || null,
    payment_id: payment?.id != null ? String(payment.id) : paymentResult?.payment_id || null,
    preapproval_id:
      payment?.preapproval_id ||
      payment?.subscription_id ||
      paymentResult?.preapproval_id ||
      subscription?.gatewaySubscriptionId ||
      null,
    external_reference:
      payment?.external_reference ||
      paymentResult?.external_reference ||
      subscription?.externalReference ||
      null,
    live_mode: payment?.live_mode ?? paymentResult?.live_mode ?? null,
    payment_method_id: payment?.payment_method_id || paymentResult?.payment_method_id || null,
    payment_type_id: payment?.payment_type_id || paymentResult?.payment_type_id || null,
    transaction_amount: payment?.transaction_amount ?? paymentResult?.transaction_amount ?? null,
    status: paymentResult?.status || null,
    status_detail: paymentResult?.status_detail || null,
    normalized_reason: paymentResult?.normalized_reason || null,
    decision: paymentResult?.decision || null,
    action_recommendation: paymentResult?.action_recommendation || null,
    automatic_retry_allowed: paymentResult?.automatic_retry_allowed === true,
    manual_retry_allowed: paymentResult?.manual_retry_allowed === true,
    activated,
  })
}

function enrichSubscriptionEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((event) => enrichMercadoPagoSubscriptionEvent(event, { includePending: true }))
}

async function listRecentSubscriptionEvents(subscriptionId, { limit = 20 } = {}) {
  if (!subscriptionId) return []
  return enrichSubscriptionEvents(
    await listSubscriptionEventsBySubscriptionId(subscriptionId, { limit })
  )
}

function serializeRecoveryGuard(guard = null) {
  if (!guard || typeof guard !== 'object') return null
  return {
    can_run: guard.can_run === true,
    allowed: guard.allowed === true,
    should_defer: guard.should_defer === true,
    duplicate_risk: guard.duplicate_risk === true,
    recent_similar_attempt_found: guard.recent_similar_attempt_found === true,
    cooldown_active: guard.cooldown_active === true,
    decision: guard.decision || null,
    normalized_reason: guard.normalized_reason || null,
    status: guard.status || null,
    status_detail: guard.status_detail || null,
    action_recommendation: guard.action_recommendation || null,
    user_message: guard.user_message || null,
    support_message: guard.support_message || null,
    matched_event_type: guard.matched_event_type || null,
    matched_event_at: guard.matched_event_at || null,
    cooldown_remaining_ms:
      Number.isFinite(Number(guard.cooldown_remaining_ms)) && Number(guard.cooldown_remaining_ms) >= 0
        ? Number(guard.cooldown_remaining_ms)
        : null,
  }
}

function logRecoveryChargeGuard(tag, {
  guard = null,
  subscription = null,
  amountCents = null,
  externalReference = null,
  requestId = null,
  userId = null,
  paymentMethodId = null,
} = {}) {
  const logger = guard?.can_run ? console.info : (guard?.decision === 'defer' ? console.info : console.warn)
  logger(`[billing][${tag}]`, {
    operation: guard?.can_run ? 'run_recovery_charge' : 'block_recovery_charge',
    request_id: requestId || null,
    subscription_id: subscription?.id || null,
    preapproval_id: subscription?.gatewaySubscriptionId || null,
    external_reference: externalReference || null,
    amount: amountCents != null ? Number(amountCents) / 100 : null,
    user_id: userId || null,
    estabelecimento_id: subscription?.estabelecimentoId || userId || null,
    payment_method_id: paymentMethodId || null,
    status: guard?.status || null,
    status_detail: guard?.status_detail || null,
    normalized_reason: guard?.normalized_reason || null,
    duplicate_risk: guard?.duplicate_risk === true,
    recent_similar_attempt_found: guard?.recent_similar_attempt_found === true,
    cooldown_active: guard?.cooldown_active === true,
    decision: guard?.decision || null,
    matched_event_type: guard?.matched_event_type || null,
    matched_event_at: guard?.matched_event_at || null,
  })
}

async function getRecoveryChargeGuard({
  subscription = null,
  currentStatus = null,
  amountCents = null,
  payerEmail = null,
  paymentMethodId = null,
  plan = null,
  billingCycle = null,
} = {}) {
  if (!subscription?.id) return null
  const recentEvents = await listRecentSubscriptionEvents(subscription.id, { limit: 20 })
  return canRunRecoveryCharge({
    subscription,
    currentStatus,
    recentEvents,
    amountCents,
    payerEmail,
    paymentMethodId,
    plan,
    billingCycle,
  })
}

function createInternalRequestId(req) {
  return String(req.requestId || req.headers['x-request-id'] || '').trim() || randomUUID()
}

function getBillingMercadoPagoCredentialDiagnostics() {
  return getMercadoPagoCredentialDiagnostics({
    publicKey: getMercadoPagoPublicKey(),
    accessToken: config.billing?.mercadopago?.accessToken || null,
  })
}

function sendBillingCardError(res, routeLabel, error, fallbackCode, fallbackMessage, requestId) {
  const normalized = toMercadoPagoCardFlowError(error) || error
  const status = Number(normalized?.status || 400)
  const code = normalized?.code || fallbackCode
  const message = normalized?.message || fallbackMessage
  console.error(routeLabel, {
    request_id: requestId || null,
    error: code,
    message,
    details: normalized?.details || null,
  })
  return res.status(status).json({
    error: code,
    message,
    details: normalized?.details || null,
    request_id: requestId || null,
  })
}

function resolveCardPersistenceAfterSave({
  gatewaySubscription,
  previousContext,
} = {}) {
  const previousStatus = previousContext?.computedState?.resolvedStatus || previousContext?.subscription?.status || null
  const previousSubscription = previousContext?.subscription || null
  const recoveryRequired = requiresCardRecovery(previousStatus)

  if (recoveryRequired) {
    return {
      recoveryRequired: true,
      status: previousStatus,
      currentPeriodStart: previousSubscription?.currentPeriodStart || null,
      currentPeriodEnd: previousSubscription?.currentPeriodEnd || previousContext?.computedState?.currentPeriodEnd || null,
      nextBillingAt: gatewaySubscription?.nextBillingAt || previousSubscription?.nextBillingAt || null,
      graceUntil: previousSubscription?.graceUntil || previousContext?.computedState?.graceUntil || null,
      lastPaymentAt: previousSubscription?.lastPaymentAt || null,
    }
  }

  return {
    recoveryRequired: false,
    status: gatewaySubscription?.status || 'pending_payment',
    currentPeriodStart: gatewaySubscription?.status === 'active' ? gatewaySubscription?.currentPeriodStart || new Date() : null,
    currentPeriodEnd: gatewaySubscription?.status === 'active' ? gatewaySubscription?.currentPeriodEnd || null : null,
    nextBillingAt: gatewaySubscription?.nextBillingAt || null,
    graceUntil: null,
    lastPaymentAt: gatewaySubscription?.status === 'active' ? new Date() : null,
  }
}

async function findPendingPixSubscription(estabelecimentoId, { plan, billingCycle } = {}) {
  const targetPlan = normalizePlanKey(plan)
  const targetCycle = billingCycle ? normalizeBillingCycle(billingCycle) : null
  const subs = await listSubscriptionsForEstabelecimento(estabelecimentoId)
  for (const sub of subs) {
    const status = String(sub.status || '').toLowerCase()
    if (status !== 'pending_pix') continue
    if (!sub.gatewayPreferenceId) continue
    const ref = String(sub.externalReference || '')
    if (ref.startsWith('wallet:whatsapp_topup')) continue
    if (targetPlan && normalizePlanKey(sub.plan) !== targetPlan) continue
    if (targetCycle && normalizeBillingCycle(sub.billingCycle) !== targetCycle) continue
  return sub
}
return null
}

function toIsoDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function formatOpenPaymentPayload({
  paymentId,
  status,
  expiresAt,
  qrCode,
  qrCodeBase64,
  copiaECola,
  initPoint,
  ticketUrl,
  amountCents,
  plan,
  billingCycle,
}) {
  const expiresIso = toIsoDate(expiresAt)
  const copyValue = copiaECola || qrCode || null
  const amount = Number.isFinite(Number(amountCents)) ? Number(amountCents) : null
  const normalizedInitPoint = initPoint || ticketUrl || null
  return {
    payment_id: paymentId || null,
    id: paymentId || null,
    status: status || null,
    expiresAt: expiresIso,
    expires_at: expiresIso,
    qrCode: qrCode || null,
    qr_code: qrCode || null,
    qrCodeBase64: qrCodeBase64 || null,
    qr_code_base64: qrCodeBase64 || null,
    copiaECola: copyValue,
    copia_e_cola: copyValue,
    initPoint: normalizedInitPoint,
    init_point: normalizedInitPoint,
    ticketUrl: normalizedInitPoint,
    ticket_url: normalizedInitPoint,
    amountCents: amount,
    amount_cents: amount,
    plan: plan || null,
    billingCycle: billingCycle || null,
  }
}

async function loadOpenPaymentFromSubscription(subscription) {
  if (!subscription?.gatewayPreferenceId) return null
  let payment = null
  try {
    const sync = await syncMercadoPagoPayment(subscription.gatewayPreferenceId)
    payment = sync?.payment || null
  } catch (err) {
    console.warn('[billing/open-payment] sync failed', err?.message || err)
  }
  if (!payment) return null
  const txData = payment.point_of_interaction?.transaction_data || {}
  return formatOpenPaymentPayload({
    paymentId: subscription.gatewayPreferenceId,
    status: payment.status || subscription.status,
    expiresAt: txData.expires_at || payment.date_of_expiration || null,
    qrCode: txData.qr_code || null,
    qrCodeBase64: txData.qr_code_base64 || null,
    copiaECola: txData.copia_e_cola || txData.qr_code || null,
    initPoint: txData.ticket_url || txData.init_point || null,
    amountCents: subscription.amountCents,
    plan: subscription.plan,
    billingCycle: subscription.billingCycle,
  })
}

function isOpenPaymentExpired(payment) {
  if (!payment?.expiresAt) return false
  const expiresAt = new Date(payment.expiresAt)
  if (!Number.isFinite(expiresAt.getTime())) return false
  return expiresAt.getTime() <= Date.now()
}

async function cancelPreviousCardSubscriptions(estabelecimentoId, { keepSubscriptionId = null, keepGatewaySubscriptionId = null } = {}) {
  const subscriptions = await listSubscriptionsForEstabelecimento(estabelecimentoId)
  for (const subscription of subscriptions) {
    if (!subscription?.gatewaySubscriptionId) continue
    if (subscription.id === keepSubscriptionId) continue
    if (keepGatewaySubscriptionId && subscription.gatewaySubscriptionId === keepGatewaySubscriptionId) continue
    if (String(subscription.paymentMethod || '').toLowerCase() !== 'credit_card') continue
    const status = normalizeSubscriptionStatus(subscription.status, { paymentMethod: subscription.paymentMethod })
    if (['canceled', 'expired'].includes(status)) continue

    try {
      await cancelMercadoPagoCardSubscription(subscription.gatewaySubscriptionId)
    } catch (err) {
      console.warn('[billing/card][cancel_previous]', err?.message || err)
    }

    await updateSubscription(subscription.id, {
      status: 'canceled',
      canceledAt: new Date(),
    })
    await appendSubscriptionEvent(subscription.id, {
      eventType: 'subscription_canceled',
      gatewayEventId: `replacement:${keepSubscriptionId || keepGatewaySubscriptionId || 'new'}`,
      payload: {
        reason: 'payment_method_replaced',
      },
    })
  }
}

async function createOrReplaceCardSubscription({
  estabelecimentoId,
  email,
  plan,
  billingCycle,
  cardToken,
  payerEmail = null,
  requestContext = {},
} = {}) {
  const previousContext = await loadEffectiveSubscriptionContext(estabelecimentoId)
  const gatewayResult = await createMercadoPagoCardSubscription({
    estabelecimento: { id: estabelecimentoId, email },
    plan,
    billingCycle,
    cardToken,
    payer: { email: payerEmail || email },
    requestContext,
  })
  const gatewaySubscription = gatewayResult.subscription
  const amountCents = gatewaySubscription?.amountCents ?? getPlanPriceCents(plan, billingCycle)
  const persistenceState = resolveCardPersistenceAfterSave({
    gatewaySubscription,
    previousContext,
  })

  const subscription = await createSubscription({
    estabelecimentoId,
    plan,
    gateway: 'mercadopago',
    paymentMethod: 'credit_card',
    gatewayCustomerId: gatewaySubscription?.gatewayCustomerId || null,
    gatewaySubscriptionId: gatewaySubscription?.gatewaySubscriptionId || null,
    externalReference: gatewaySubscription?.externalReference || null,
    status: persistenceState.status,
    amountCents,
    currency: gatewaySubscription?.currency || (config.billing?.currency || 'BRL'),
    billingCycle,
    currentPeriodStart: persistenceState.currentPeriodStart,
    currentPeriodEnd: persistenceState.currentPeriodEnd,
    nextBillingAt: persistenceState.nextBillingAt,
    graceUntil: persistenceState.graceUntil,
    lastPaymentAt: persistenceState.lastPaymentAt,
  })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'subscription_created',
    gatewayEventId: gatewaySubscription?.gatewaySubscriptionId || null,
    payload: {
      plan,
      billing_cycle: billingCycle,
      amount_cents: amountCents,
      request: gatewayResult.request,
      response: gatewayResult.raw,
    },
  })

  await cancelPreviousCardSubscriptions(estabelecimentoId, {
    keepSubscriptionId: subscription.id,
    keepGatewaySubscriptionId: gatewaySubscription?.gatewaySubscriptionId || null,
  })

  if (
    previousContext?.subscription?.paymentMethod &&
    previousContext.subscription.paymentMethod !== 'credit_card'
  ) {
    await appendSubscriptionEvent(subscription.id, {
      eventType: 'payment_method_changed',
      gatewayEventId: `payment-method:${previousContext.subscription.id}:credit_card`,
      payload: {
        previous_payment_method: previousContext.subscription.paymentMethod,
        next_payment_method: 'credit_card',
        plan,
        billing_cycle: billingCycle,
        amount_cents: amountCents,
      },
    })
  }

  const effectiveContext = await loadEffectiveSubscriptionContext(estabelecimentoId)

  return {
    subscription,
    computedState: effectiveContext.computedState,
    effectiveSubscription: effectiveContext.subscription,
    gatewayResult,
    recoveryRequired: persistenceState.recoveryRequired,
  }
}

function addBillingCycleDate(date, cycle) {
  const current = new Date(date)
  if (!Number.isFinite(current.getTime())) return null
  if (normalizeBillingCycle(cycle) === 'anual') current.setFullYear(current.getFullYear() + 1)
  else current.setMonth(current.getMonth() + 1)
  return current
}

async function finalizeApprovedCardRecovery({
  targetSubscription,
  payment,
  paymentResult,
  currentStatus,
  billingCycle,
  amountCents,
  requestId = null,
  externalReference = null,
  source = 'api',
} = {}) {
  const paidAt = payment?.paidAt ? new Date(payment.paidAt) : new Date()
  const expectedPeriodEnd = addBillingCycleDate(paidAt, billingCycle)
  let alignedGatewaySubscription = null
  try {
    const aligned = await updateMercadoPagoCardSubscription(targetSubscription.gatewaySubscriptionId, {
      amountCents,
      billingCycle,
      status: 'authorized',
      startDate: expectedPeriodEnd,
      requestContext: {
        requestId,
        route: source === 'webhook' ? '/billing/webhook' : '/billing/card/recover',
        operation: 'card_subscription_align_after_recovery',
        subscriptionId: targetSubscription.id,
        externalReference,
      },
    })
    alignedGatewaySubscription = aligned?.subscription || null
  } catch (alignmentError) {
    console.warn('[billing/card/recover][align_subscription]', {
      subscription_id: targetSubscription.id,
      gateway_subscription_id: targetSubscription.gatewaySubscriptionId,
      message: alignmentError?.message || String(alignmentError),
    })
  }

  const updated = await updateSubscription(targetSubscription.id, {
    paymentMethod: 'credit_card',
    gatewayCustomerId: alignedGatewaySubscription?.gatewayCustomerId || targetSubscription.gatewayCustomerId || null,
    gatewayPaymentId: payment?.id || null,
    status: 'active',
    amountCents: payment?.amountCents || amountCents,
    currency: payment?.currency || targetSubscription.currency || (config.billing?.currency || 'BRL'),
    billingCycle,
    currentPeriodStart: paidAt,
    currentPeriodEnd: alignedGatewaySubscription?.currentPeriodEnd || expectedPeriodEnd || null,
    nextBillingAt: alignedGatewaySubscription?.nextBillingAt || expectedPeriodEnd || null,
    graceUntil: null,
    lastPaymentAt: paidAt,
  })

  const eventPayload = buildMercadoPagoPaymentEventPayload({
    payment: payment?.raw || null,
    paymentResult,
    gatewaySubscription: alignedGatewaySubscription?.raw || alignedGatewaySubscription || null,
    requestId,
    operation: 'card_recovery_payment',
    source,
    recovery: true,
    previousStatus: currentStatus,
    nextStatus: 'active',
    externalReference,
    decision: 'activate',
  })

  await appendSubscriptionEvent(updated.id, {
    eventType: 'payment_recovered',
    gatewayEventId: externalReference || payment?.id || null,
    payload: eventPayload,
  })
  await appendSubscriptionEvent(updated.id, {
    eventType: 'subscription_renewed',
    gatewayEventId: `recovery:${payment?.id || externalReference || updated.id}`,
    payload: eventPayload,
  })

  logMercadoPagoPaymentDecision('card_recovery_result', {
    subscription: updated,
    paymentResult,
    payment: payment?.raw || null,
    requestId,
    source,
    activated: true,
  })

  const effectiveContext = await loadEffectiveSubscriptionContext(updated.estabelecimentoId)

  return {
    updated,
    effectiveContext,
    paymentResult,
  }
}

async function finalizeNonApprovedCardRecovery({
  targetSubscription,
  payment,
  paymentResult,
  currentStatus,
  requestId = null,
  externalReference = null,
  source = 'api',
} = {}) {
  const eventType = paymentResult?.status_group === 'pending' ? 'payment_pending' : 'payment_failed'

  const updated = await updateSubscription(targetSubscription.id, {
    paymentMethod: 'credit_card',
    gatewayPaymentId: payment?.id || targetSubscription.gatewayPaymentId || null,
    status: currentStatus,
    graceUntil: targetSubscription.graceUntil || null,
    lastPaymentAt: targetSubscription.lastPaymentAt || null,
  })

  await appendSubscriptionEvent(updated.id, {
    eventType,
    gatewayEventId: externalReference || payment?.id || null,
    payload: buildMercadoPagoPaymentEventPayload({
      payment: payment?.raw || null,
      paymentResult,
      requestId,
      operation: 'card_recovery_payment',
      source,
      recovery: true,
      previousStatus: currentStatus,
      nextStatus: currentStatus,
      externalReference,
      decision: paymentResult?.decision || null,
    }),
  })

  logMercadoPagoPaymentDecision('card_recovery_result', {
    subscription: updated,
    paymentResult,
    payment: payment?.raw || null,
    requestId,
    source,
    activated: false,
  })

  const effectiveContext = await loadEffectiveSubscriptionContext(updated.estabelecimentoId)

  return {
    updated,
    effectiveContext,
    eventType,
    paymentResult,
  }
}

async function syncCardSubscriptionFromGateway(gatewaySubscriptionId, {
  gatewayEventId = null,
  eventType = null,
} = {}) {
  const localSubscription = await getSubscriptionByGatewayId(gatewaySubscriptionId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackPlan: localSubscription.plan,
    fallbackCycle: localSubscription.billingCycle,
  })
  const gatewaySubscription = gatewayResult.subscription
  const graceDays = Number(config.billing?.reminders?.graceDays ?? process.env.SUBSCRIPTION_GRACE_DAYS ?? 3) || 3
  const graceUntil = gatewaySubscription?.status === 'past_due'
    ? new Date(Date.now() + graceDays * DAY_MS)
    : null
  const preservedStatus =
    requiresCardRecovery(localSubscription.status) && gatewaySubscription?.status === 'pending_payment'
      ? normalizeSubscriptionStatus(localSubscription.status, { paymentMethod: localSubscription.paymentMethod })
      : gatewaySubscription?.status || localSubscription.status

  const updated = await updateSubscription(localSubscription.id, {
    paymentMethod: 'credit_card',
    gatewayCustomerId: gatewaySubscription?.gatewayCustomerId || localSubscription.gatewayCustomerId || null,
    status: preservedStatus,
    amountCents: gatewaySubscription?.amountCents || localSubscription.amountCents,
    currency: gatewaySubscription?.currency || localSubscription.currency,
    billingCycle: gatewaySubscription?.billingCycle || localSubscription.billingCycle,
    nextBillingAt: gatewaySubscription?.nextBillingAt || localSubscription.nextBillingAt || null,
    currentPeriodEnd:
      gatewaySubscription?.status === 'active'
        ? (gatewaySubscription?.nextBillingAt || localSubscription.currentPeriodEnd || null)
        : localSubscription.currentPeriodEnd || null,
    graceUntil: preservedStatus === gatewaySubscription?.status ? graceUntil : localSubscription.graceUntil || null,
  })
  const normalizedEventType =
    eventType ||
    (gatewaySubscription?.status === 'canceled'
      ? 'subscription_canceled'
      : gatewaySubscription?.status === 'past_due'
        ? 'payment_failed'
        : gatewaySubscription?.status === 'active'
          ? 'payment_approved'
          : gatewaySubscription?.status === 'pending_payment'
            ? 'payment_pending'
            : 'subscription_updated')
  await appendSubscriptionEvent(updated.id, {
    eventType: normalizedEventType,
    gatewayEventId: gatewayEventId || gatewaySubscriptionId,
    payload: gatewayResult.raw,
  })

  const effectiveContext = await loadEffectiveSubscriptionContext(localSubscription.estabelecimentoId)

  return {
    ok: true,
    subscription: updated,
    computedState: effectiveContext.computedState,
    effectiveSubscription: effectiveContext.subscription,
    gateway: gatewayResult.raw,
  }
}

async function syncAuthorizedPaymentFromGateway(authorizedPaymentId, {
  gatewayEventId = null,
} = {}) {
  const paymentResult = await getMercadoPagoAuthorizedPayment(authorizedPaymentId)
  const authorizedPayment = paymentResult.authorizedPayment
  const paymentOutcome = authorizedPayment?.paymentResult || summarizeMercadoPagoGatewayResult(paymentResult.raw)
  if (!authorizedPayment?.preapprovalId) {
    return { ok: false, reason: 'preapproval_not_found' }
  }

  const localSubscription = await getSubscriptionByGatewayId(authorizedPayment.preapprovalId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const preapprovalResult = await getMercadoPagoCardSubscription(authorizedPayment.preapprovalId, {
    fallbackPlan: localSubscription.plan,
    fallbackCycle: localSubscription.billingCycle,
  })
  const paymentDate = authorizedPayment.paidAt ? new Date(authorizedPayment.paidAt) : new Date()
  const fallbackCurrentPeriodEnd = addBillingCycleDate(paymentDate, localSubscription.billingCycle || preapprovalResult.subscription?.billingCycle || 'mensal')
  const graceDays = Number(config.billing?.reminders?.graceDays ?? process.env.SUBSCRIPTION_GRACE_DAYS ?? 3) || 3
  const graceUntil = authorizedPayment.status === 'past_due'
    ? new Date(Date.now() + graceDays * DAY_MS)
    : null

  const updated = await updateSubscription(localSubscription.id, {
    paymentMethod: 'credit_card',
    gatewayPaymentId: authorizedPayment.id || null,
    gatewayCustomerId: preapprovalResult?.subscription?.gatewayCustomerId || localSubscription.gatewayCustomerId || null,
    status: authorizedPayment.status || localSubscription.status,
    amountCents: authorizedPayment.amountCents || localSubscription.amountCents,
    currency: authorizedPayment.currency || localSubscription.currency,
    currentPeriodStart: authorizedPayment.status === 'active' ? paymentDate : localSubscription.currentPeriodStart || null,
    currentPeriodEnd: authorizedPayment.status === 'active'
      ? (preapprovalResult?.subscription?.nextBillingAt || fallbackCurrentPeriodEnd || null)
      : localSubscription.currentPeriodEnd || null,
    nextBillingAt: preapprovalResult?.subscription?.nextBillingAt || localSubscription.nextBillingAt || null,
    graceUntil,
    lastPaymentAt: authorizedPayment.status === 'active' ? paymentDate : localSubscription.lastPaymentAt || null,
  })

  const normalizedEventType = authorizedPayment.status === 'active'
    ? 'payment_approved'
    : authorizedPayment.status === 'past_due'
      ? 'payment_failed'
      : 'payment_pending'
  await appendSubscriptionEvent(updated.id, {
    eventType: normalizedEventType,
    gatewayEventId: gatewayEventId || authorizedPayment.id,
    payload: buildMercadoPagoPaymentEventPayload({
      payment: paymentResult.raw,
      paymentResult: paymentOutcome,
      gatewaySubscription: preapprovalResult.raw,
      operation: 'subscription_authorized_payment',
      source: 'webhook',
      previousStatus: localSubscription.status,
      nextStatus: updated.status,
      externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
      decision: paymentOutcome?.decision || null,
    }),
  })
  if (authorizedPayment.status === 'active') {
    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_renewed',
      gatewayEventId: `renewal:${authorizedPayment.id}`,
      payload: buildMercadoPagoPaymentEventPayload({
        payment: paymentResult.raw,
        paymentResult: paymentOutcome,
        gatewaySubscription: preapprovalResult.raw,
        operation: 'subscription_authorized_payment',
        source: 'webhook',
        previousStatus: localSubscription.status,
        nextStatus: updated.status,
        externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
        decision: paymentOutcome?.decision || null,
      }),
    })
  }

  logMercadoPagoPaymentDecision('authorized_payment_sync', {
    subscription: updated,
    paymentResult: paymentOutcome,
    payment: paymentResult.raw,
    source: 'webhook',
    activated: authorizedPayment.status === 'active',
  })

  const effectiveContext = await loadEffectiveSubscriptionContext(localSubscription.estabelecimentoId)

  return {
    ok: true,
    subscription: updated,
    computedState: effectiveContext.computedState,
    effectiveSubscription: effectiveContext.subscription,
    authorizedPayment: paymentResult.raw,
    gatewaySubscription: preapprovalResult.raw,
    paymentResult: paymentOutcome,
  }
}

async function syncCardRecoveryPaymentFromGateway(paymentId, {
  gatewayEventId = null,
} = {}) {
  const paymentRaw = await fetchMercadoPagoPayment(paymentId)
  const metadataKind = String(paymentRaw?.metadata?.kind || paymentRaw?.metadata?.type || '').toLowerCase()
  const externalReference = String(paymentRaw?.external_reference || '').trim()
  if (metadataKind !== 'subscription_recovery' && !externalReference.startsWith('subscription_recovery:')) {
    return { ok: false, reason: 'not_subscription_recovery' }
  }

  const payment = {
    id: paymentRaw?.id != null ? String(paymentRaw.id) : null,
    raw: paymentRaw,
    amountCents: paymentRaw?.transaction_amount != null
      ? Math.round(Number(paymentRaw.transaction_amount || 0) * 100)
      : null,
    currency: paymentRaw?.currency_id || (config.billing?.currency || 'BRL'),
    paidAt: paymentRaw?.date_approved || paymentRaw?.date_last_updated || paymentRaw?.last_modified || null,
  }
  const paymentResult = summarizeMercadoPagoGatewayResult(paymentRaw)
  if (!paymentResult) {
    return { ok: false, reason: 'payment_result_not_available' }
  }

  let targetSubscription = null
  const metadataSubscriptionId = Number(paymentRaw?.metadata?.subscription_id || 0) || null
  if (metadataSubscriptionId) {
    targetSubscription = await getSubscriptionById(metadataSubscriptionId)
  }
  if (!targetSubscription && paymentRaw?.metadata?.gateway_subscription_id) {
    targetSubscription = await getSubscriptionByGatewayId(String(paymentRaw.metadata.gateway_subscription_id))
  }
  if (!targetSubscription && /^subscription_recovery:sub:(\d+):/i.test(externalReference)) {
    const match = externalReference.match(/^subscription_recovery:sub:(\d+):/i)
    const subscriptionId = Number(match?.[1] || 0) || null
    if (subscriptionId) {
      targetSubscription = await getSubscriptionById(subscriptionId)
    }
  }
  if (!targetSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const currentStatus = normalizeSubscriptionStatus(targetSubscription.status, {
    paymentMethod: targetSubscription.paymentMethod,
  })
  const alreadySamePayment = String(targetSubscription.gatewayPaymentId || '') === String(payment.id || '')
  if (alreadySamePayment) {
    if (paymentResult.should_activate_subscription && currentStatus === 'active') {
      return { ok: true, handled: false, reason: 'already_processed', status: 'active', paymentResult }
    }
    if (!paymentResult.should_activate_subscription && currentStatus !== 'active') {
      return {
        ok: true,
        handled: false,
        reason: 'already_processed',
        status: paymentResult.status_group === 'pending' ? 'pending_payment' : currentStatus,
        paymentResult,
      }
    }
  }

  if (paymentResult.should_activate_subscription) {
    const billingCycle = normalizeBillingCycle(targetSubscription.billingCycle || 'mensal')
    const amountCents = Number(targetSubscription.amountCents || 0) || getPlanPriceCents(targetSubscription.plan, billingCycle)
    const finalized = await finalizeApprovedCardRecovery({
      targetSubscription,
      payment,
      paymentResult,
      currentStatus,
      billingCycle,
      amountCents,
      requestId: gatewayEventId || payment.id || null,
      externalReference,
      source: 'webhook',
    })
    return {
      ok: true,
      handled: true,
      status: 'active',
      subscription: finalized.updated,
      computedState: finalized.effectiveContext.computedState,
      paymentResult,
    }
  }

  if (['pending', 'rejected'].includes(paymentResult.status_group)) {
    const finalized = await finalizeNonApprovedCardRecovery({
      targetSubscription,
      payment,
      paymentResult,
      currentStatus,
      requestId: gatewayEventId || payment.id || null,
      externalReference,
      source: 'webhook',
    })
    return {
      ok: true,
      handled: true,
      status: paymentResult.status_group === 'pending' ? 'pending_payment' : currentStatus,
      subscription: finalized.updated,
      computedState: finalized.effectiveContext.computedState,
      paymentResult,
    }
  }

  return { ok: false, reason: 'unsupported_status', paymentResult }
}

function pickRecoverableCardSubscription(context) {
  if (!context) return null
  if (
    context.subscription?.gatewaySubscriptionId &&
    String(context.subscription.paymentMethod || '').toLowerCase() === 'credit_card' &&
    requiresCardRecovery(context.computedState?.resolvedStatus || context.subscription.status)
  ) {
    return context.subscription
  }

  return (context.subscriptions || []).find((item) =>
    item?.gatewaySubscriptionId &&
    String(item.paymentMethod || '').toLowerCase() === 'credit_card' &&
    requiresCardRecovery(item.status)
  ) || null
}

function parseMercadoPagoSignatureHeader(xSignature) {
  // Example header: "ts=1700000000, v1=abcdef..."
  if (!xSignature) return { ts: null, v1: null }
  const raw = Array.isArray(xSignature) ? xSignature.join(',') : String(xSignature)
  const trimmed = raw.trim()
  if (!trimmed) return { ts: null, v1: null }
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
  const headerData = {}
  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex < 0) continue
    const key = part.slice(0, separatorIndex).trim().toLowerCase()
    const value = part.slice(separatorIndex + 1).trim()
    if (!key) continue
    headerData[key] = value
  }
  return { ts: headerData.ts || null, v1: headerData.v1 || null }
}

function safeTimingCompareHex(expectedHex, receivedHex) {
  const expectedBuffer = Buffer.from(String(expectedHex || ''), 'hex')
  const receivedBuffer = Buffer.from(String(receivedHex || ''), 'hex')
  if (expectedBuffer.length !== receivedBuffer.length) {
    const maxLength = Math.max(expectedBuffer.length, receivedBuffer.length)
    const paddedExpected = Buffer.alloc(maxLength)
    const paddedReceived = Buffer.alloc(maxLength)
    expectedBuffer.copy(paddedExpected)
    receivedBuffer.copy(paddedReceived)
    timingSafeEqual(paddedExpected, paddedReceived)
    return false
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

// How to test (example headers):
// const headers = { 'x-signature': 'ts=1700000000, v1=abcdef1234', 'x-request-id': 'req-123' }
// validateMercadoPagoWebhook({ headers, query: { id: '999' }, body: {} })
function validateMercadoPagoWebhook(req) {
  const header =
    req.headers['x-signature'] ||
    req.headers['x_signature'] ||
    req.headers['x-mercadopago-signature'] ||
    req.headers['x_mercadopago_signature']
  const { ts, v1 } = parseMercadoPagoSignatureHeader(header)
  const tsCandidates = []
  const tsCandidateSet = new Set()
  const tsValue = String(ts || '').trim()
  const addTsCandidate = (value) => {
    if (!value) return
    if (tsCandidateSet.has(value)) return
    tsCandidateSet.add(value)
    tsCandidates.push(value)
  }
  addTsCandidate(tsValue)
  if (tsValue && /^\d+$/.test(tsValue)) {
    const tsNumber = Number(tsValue)
    if (Number.isFinite(tsNumber)) {
      if (tsValue.length === 10) {
        addTsCandidate(String(tsNumber * 1000))
      } else if (tsValue.length === 13) {
        addTsCandidate(String(Math.floor(tsNumber / 1000)))
      }
    }
  }
  if (!tsCandidates.length) {
    tsCandidates.push(tsValue || String(ts || '').trim())
  }
  const requestId = String(req.headers['x-request-id'] || req.headers['x_request_id'] || '').trim()
  const id = normalizeId(req.query?.id || req.query?.['data.id'] || req.body?.data?.id || req.body?.id || req.body?.resource)
  const topic = String(req.query?.topic || req.query?.type || '').trim()

  if (!id || !ts || !v1 || (!requestId && !topic)) {
    console.warn('[billing:webhook] missing_fields', {
      id: id || null,
      ts: ts || null,
      v1: v1 || null,
      request_id: requestId || null,
    })
    return { ok: false, reason: 'missing_fields', status: 401 }
  }

  if (config.billing?.mercadopago?.allowUnsigned) {
    return {
      ok: true,
      skipped: 'unsigned-allowed',
      id,
      request_id: requestId,
      ts,
      using_variant: null,
      using_secret_index: null,
    }
  }

  const secretA = (config.billing?.mercadopago?.webhookSecret || '').trim()
  const secretB = (config.billing?.mercadopago?.webhookSecret2 || '').trim()
  let secrets = [secretA, secretB].filter(Boolean)
  if (!secrets.length) {
    const envA = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim()
    const envB = String(process.env.MERCADOPAGO_WEBHOOK_SECRET_2 || '').trim()
    secrets = [envA, envB].filter(Boolean)
  }

  const buildManifestCandidates = (tsCandidate) => {
    const candidates = []
    if (requestId) {
      candidates.push({ variant: 'request-id', manifest: `id:${id};request-id:${requestId};ts:${tsCandidate};` })
      candidates.push({ variant: 'request_id', manifest: `id:${id};request_id:${requestId};ts:${tsCandidate};` })
    }
    if (topic) {
      candidates.push({ variant: 'topic', manifest: `id:${id};topic:${topic};ts:${tsCandidate};` })
    }
    return candidates
  }
  const previewTs = tsCandidates[0]
  const previewCandidates = buildManifestCandidates(previewTs)

  if (!secrets.length) {
    return { ok: true, skipped: 'missing_secret', id, request_id: requestId, ts, manifest: previewCandidates[0]?.manifest }
  }

  for (let index = 0; index < secrets.length; index++) {
    const secret = secrets[index]
    for (const tsCandidate of tsCandidates) {
      const manifestCandidates = buildManifestCandidates(tsCandidate)
      for (const candidate of manifestCandidates) {
        const expected = createHmac('sha256', secret).update(candidate.manifest).digest('hex')
        if (safeTimingCompareHex(expected, v1)) {
          if (String(process.env.DEBUG_WEBHOOKS || '0') === '1') {
            console.log('[billing:webhook] signature_match', {
              id,
              topic,
              using_secret_index: index,
              using_variant: candidate.variant,
              using_ts: tsCandidate,
            })
          }
          return {
            ok: true,
            id,
            request_id: requestId,
            ts,
            manifest: candidate.manifest,
            using_variant: candidate.variant,
            using_secret_index: index,
            using_ts: tsCandidate,
          }
        }
      }
    }
  }

  const requestIdManifest = previewCandidates.find((candidate) => candidate.variant === 'request-id')?.manifest || ''
  const topicManifest = previewCandidates.find((candidate) => candidate.variant === 'topic')?.manifest || ''
  const previewRequestId =
    requestIdManifest.length > 160 ? `${requestIdManifest.slice(0, 160)}...` : requestIdManifest
  const previewTopic = topicManifest.length > 160 ? `${topicManifest.slice(0, 160)}...` : topicManifest
  const v1Prefix = String(v1 || '').slice(0, 8)
  console.warn('[billing:webhook] signature_mismatch', {
    url: req.originalUrl,
    id,
    id_from_body: req.body?.data?.id ?? null,
    id_from_query_data: req.query?.['data.id'] ?? null,
    id_from_query_id: req.query?.id ?? null,
    topic,
    ts,
    ts_candidates: tsCandidates,
    request_id_present: Boolean(requestId),
    topic_present: Boolean(topic),
    v1_prefix: v1Prefix || null,
    manifest_preview_request_id: previewRequestId || null,
    manifest_preview_topic: previewTopic || null,
  })
  // Se Nginx/proxy sobrescrever X-Request-Id, a assinatura nunca vai bater. Nao setar proxy_set_header X-Request-Id ...
  const debugPayload = { request_id_received: requestId || null }
  const forwardedRequestId = req.headers['x-forwarded-request-id']
  const amznTraceId = req.headers['x-amzn-trace-id']
  if (forwardedRequestId) debugPayload.x_forwarded_request_id = forwardedRequestId
  if (amznTraceId) debugPayload.x_amzn_trace_id = amznTraceId
  console.warn('[billing:webhook] signature_mismatch_debug', debugPayload)
  return { ok: false, reason: 'signature_mismatch', status: 401, id, ts, manifest: requestIdManifest }
}

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeResourceCandidate(value) {
  const raw = normalizeId(value)
  if (!raw) return ''
  const withoutQuery = raw.split('?')[0].split('#')[0]
  const withoutHost = withoutQuery.replace(/^https?:\/\/[^/]+/i, '')
  const trimmed = withoutHost.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmed) return raw
  if (!trimmed.includes('/')) return trimmed
  const segments = trimmed.split('/').filter(Boolean)
  if (!segments.length) return trimmed
  return segments[segments.length - 1]
}

function safeJson(payload) {
  try {
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

function normalizePaymentStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function isApprovedStatus(status) {
  return status === 'approved' || status === 'paid'
}

function mapFailureStatus(status) {
  if (!status) return null
  if (status === 'expired') return 'expired'
  if (status === 'refunded') return 'refunded'
  if (status === 'cancelled' || status === 'canceled') return 'canceled'
  if (status === 'rejected' || status === 'failed' || status === 'charged_back') return 'failed'
  return null
}

function parseDepositExternalReference(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = raw.match(/dep:ag:(\d+):pay:(\d+):est:(\d+)/i)
  if (!match) return null
  return {
    agendamentoId: Number(match[1]),
    paymentId: Number(match[2]),
    estabelecimentoId: Number(match[3]),
  }
}

async function fetchAppointmentPaymentByProvider(providerPaymentId, { connection = null, forUpdate = false } = {}) {
  const db = connection || pool
  const lock = forUpdate ? ' FOR UPDATE' : ''
  const [rows] = await db.query(
    `SELECT * FROM appointment_payments WHERE provider_payment_id=? LIMIT 1${lock}`,
    [String(providerPaymentId)]
  )
  return rows?.[0] || null
}

async function fetchAppointmentPaymentById(id, { connection = null, forUpdate = false } = {}) {
  const db = connection || pool
  const lock = forUpdate ? ' FOR UPDATE' : ''
  const [rows] = await db.query(
    `SELECT * FROM appointment_payments WHERE id=? LIMIT 1${lock}`,
    [Number(id)]
  )
  return rows?.[0] || null
}

function serializeWhatsAppPack(pack) {
  if (!pack) return null
  const waMessages = Number(pack.waMessages ?? pack.wa_messages ?? pack.messages ?? 0) || 0
  const priceCents = Number(pack.price_cents ?? pack.priceCents ?? pack.price ?? 0) || 0
  return {
    id: pack.id ?? null,
    code: pack.code || null,
    name: pack.name || null,
    price_cents: priceCents,
    wa_messages: waMessages,
  }
}

function serializeTopupHistory(entry) {
  if (!entry) return null
  const meta = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
  const nestedPack = meta.pack && typeof meta.pack === 'object' ? meta.pack : {}
  return {
    id: entry.id ?? null,
    payment_id: entry.payment_id || null,
    messages: meta.messages ?? entry.delta ?? null,
    extra_delta: entry.extra_delta ?? null,
    pack_code: meta.pack_code || nestedPack.code || null,
    pack_id: meta.pack_id ?? nestedPack.id ?? null,
    price_cents: meta.price_cents ?? nestedPack.price_cents ?? null,
    created_at: entry.created_at || null,
  }
}

async function handleDepositPaymentWebhook({ resourceId, event, bodyUserId = null }) {
  const providerPaymentId = normalizeId(resourceId)
  if (!providerPaymentId) return { ok: false, reason: 'missing_resource_id' }

  let paymentRow = await fetchAppointmentPaymentByProvider(providerPaymentId)
  let estabelecimentoId = paymentRow?.estabelecimento_id ?? null

  if (!estabelecimentoId && bodyUserId != null) {
    const [rows] = await pool.query(
      'SELECT estabelecimento_id FROM mercadopago_accounts WHERE mp_user_id=? LIMIT 1',
      [Number(bodyUserId)]
    )
    if (rows?.[0]?.estabelecimento_id) {
      estabelecimentoId = Number(rows[0].estabelecimento_id)
    }
  }

  if (!estabelecimentoId) {
    return { ok: false, reason: 'estabelecimento_not_found' }
  }

  const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
  const accessToken = mpAccess.accessToken || null
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing', estabelecimentoId }
  }

  let payment = null
  try {
    payment = await fetchMercadoPagoPayment(providerPaymentId, { accessToken })
  } catch (err) {
    console.warn('[billing:webhook][deposit] fetch_payment_failed', err?.message || err)
    return { ok: false, reason: 'mp_fetch_failed' }
  }
  if (!payment?.id) return { ok: false, reason: 'payment_not_found' }

  const status = normalizePaymentStatus(payment.status)
  const metadataType = String(payment?.metadata?.type || payment?.metadata?.kind || '').toLowerCase()
  const externalReference = String(payment?.external_reference || '').trim()
  const isDeposit = metadataType === 'deposit' || /^dep:ag:\d+:pay:\d+:est:\d+/i.test(externalReference)
  if (!isDeposit) {
    return { ok: false, reason: 'not_deposit' }
  }

  const parsedRef = parseDepositExternalReference(externalReference)
  const metadataAgendamentoId = Number(payment?.metadata?.agendamento_id || 0) || null
  let appointmentPaymentId = paymentRow?.id ?? parsedRef?.paymentId ?? null

  if (!appointmentPaymentId && metadataAgendamentoId) {
    const [rows] = await pool.query(
      `SELECT id, estabelecimento_id
         FROM appointment_payments
        WHERE agendamento_id=?
        ORDER BY id DESC
        LIMIT 1`,
      [metadataAgendamentoId]
    )
    if (rows?.[0]?.id) {
      appointmentPaymentId = Number(rows[0].id)
      if (!estabelecimentoId && rows[0].estabelecimento_id) {
        estabelecimentoId = Number(rows[0].estabelecimento_id)
      }
    }
  }

  if (!appointmentPaymentId) {
    return { ok: false, reason: 'deposit_payment_not_found' }
  }

  const failureStatus = mapFailureStatus(status)
  const approved = isApprovedStatus(status)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    let locked = await fetchAppointmentPaymentById(appointmentPaymentId, { connection: conn, forUpdate: true })
    if (!locked && providerPaymentId) {
      locked = await fetchAppointmentPaymentByProvider(providerPaymentId, { connection: conn, forUpdate: true })
    }
    if (!locked) {
      await conn.rollback()
      return { ok: false, reason: 'deposit_payment_not_found' }
    }

    const rawPayload = safeJson({ event, payment })

    if (approved) {
      if (String(locked.status || '').toLowerCase() !== 'paid') {
        await conn.query(
          `UPDATE appointment_payments
              SET status=?,
                  paid_at=NOW(),
                  raw_payload=?,
                  provider_payment_id=COALESCE(provider_payment_id, ?),
                  provider_reference=COALESCE(provider_reference, ?)
            WHERE id=?`,
          ['paid', rawPayload, String(payment.id), externalReference || null, locked.id]
        )
      } else {
        await conn.query(
          `UPDATE appointment_payments
              SET raw_payload=?,
                  provider_reference=COALESCE(provider_reference, ?)
            WHERE id=?`,
          [rawPayload, externalReference || null, locked.id]
        )
      }
      const [result] = await conn.query(
        "UPDATE agendamentos SET status='confirmado', deposit_paid_at=NOW() WHERE id=? AND status='pendente_pagamento'",
        [locked.agendamento_id]
      )
      await conn.commit()
      if (result?.affectedRows) {
        notifyAppointmentConfirmed(locked.agendamento_id).catch((err) => {
          console.warn('[billing:webhook][deposit] notify_failed', err?.message || err)
        })
      }
      return { ok: true, handled: true, status: 'paid', appointmentId: locked.agendamento_id }
    }

    if (failureStatus) {
      await conn.query(
        `UPDATE appointment_payments
            SET status=?,
                raw_payload=?,
                provider_payment_id=COALESCE(provider_payment_id, ?),
                provider_reference=COALESCE(provider_reference, ?)
          WHERE id=?`,
        [failureStatus, rawPayload, String(payment.id), externalReference || null, locked.id]
      )
      await cancelPendingPaymentAppointmentTx(locked.agendamento_id, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: failureStatus, appointmentId: locked.agendamento_id }
    }

    await conn.query(
      `UPDATE appointment_payments
          SET raw_payload=?,
              provider_payment_id=COALESCE(provider_payment_id, ?),
              provider_reference=COALESCE(provider_reference, ?)
        WHERE id=?`,
      [rawPayload, String(payment.id), externalReference || null, locked.id]
    )
    await conn.commit()
    return { ok: true, handled: false, status: status || 'pending', appointmentId: locked.agendamento_id }
  } catch (err) {
    try {
      await conn.rollback()
    } catch {}
    throw err
  } finally {
    conn.release()
  }
}

router.get('/plans', auth, isEstabelecimento, async (_req, res) => {
  try {
    const plans = await BillingService.listPlans()
    return res.json({
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        price_cents: plan.priceCents,
        max_professionals: plan.maxProfessionals,
        included_wa_messages: plan.includedWaMessages,
      })),
    })
  } catch (err) {
    console.error('GET /billing/plans', err)
    return res.status(500).json({ error: 'plans_fetch_failed' })
  }
})

router.get('/config', auth, isEstabelecimento, async (_req, res) => {
  return res.json({
    ok: true,
    gateway: 'mercadopago',
    methods: {
      primary: 'credit_card',
      alternative: 'pix',
      recommended: 'credit_card',
    },
    mercadopago: {
      public_key: getMercadoPagoPublicKey(),
      credentials: getBillingMercadoPagoCredentialDiagnostics(),
    },
    grace_days: Number(config.billing?.reminders?.graceDays ?? process.env.SUBSCRIPTION_GRACE_DAYS ?? 3) || 3,
  })
})

router.get('/status', auth, isEstabelecimento, async (req, res) => {
  try {
    const { planContext, subscription, computedState } = await loadEffectiveSubscriptionContext(req.user.id)
    const ctx = planContext
    if (!ctx) return res.status(404).json({ error: 'plan_context_not_found' })

    const dueAtIso = computedState.dueAt ? computedState.dueAt.toISOString() : null
    const graceDeadlineIso = computedState.graceUntil ? computedState.graceUntil.toISOString() : null
    const reminders = await summarizeReminders(req.user.id)

    const trialEndsAt = ctx.trialEndsAt
    const trialEndsIso = trialEndsAt ? trialEndsAt.toISOString() : null
    const trialExpired = trialEndsAt ? trialEndsAt.getTime() <= Date.now() : false
    const pendingSubscription = await findPendingPixSubscription(req.user.id, {
      plan: subscription?.plan || ctx.plan,
      billingCycle: subscription?.billingCycle || ctx.cycle,
    })
    let openPayment = null
    if (pendingSubscription) {
      openPayment = await loadOpenPaymentFromSubscription(pendingSubscription)
      if (openPayment && isOpenPaymentExpired(openPayment)) {
        openPayment = null
      }
    }
    const hasOpenPayment = Boolean(openPayment)
    const normalizedStatus = normalizeSubscriptionStatus(computedState.resolvedStatus || ctx.status || 'trialing')
    const paymentMethod = computedState.paymentMethod || subscription?.paymentMethod || 'pix'
    const hasActiveSubscription = normalizedStatus === 'active'
    const renewalRequired = paymentMethod === 'pix'
      ? (
          (trialExpired && !hasActiveSubscription) ||
          ['due_soon', 'overdue', 'blocked', 'pending'].includes(computedState.state) ||
          normalizedStatus === 'pending_pix'
        )
      : ['pending_payment', 'past_due', 'unpaid', 'expired', 'canceled'].includes(normalizedStatus)

    return res.json({
      ok: true,
      plan: subscription?.plan || ctx.plan,
      plan_status: normalizedStatus,
      billing_cycle: subscription?.billingCycle || ctx.cycle,
      due_at: dueAtIso,
      state: computedState.state,
      warn_days: computedState.warnDays,
      grace_days: computedState.graceDays,
      grace_deadline: graceDeadlineIso,
      days_to_due: computedState.daysToDue,
      days_overdue: computedState.daysOverdue,
      grace_days_remaining: computedState.graceDaysRemaining,
      reminders,
      access: {
        mode: computedState.accessState,
        core_features_allowed: computedState.coreFeaturesAllowed,
        billing_access_allowed: true,
      },
      trial: {
        wasUsed: Boolean(trialEndsAt),
        isExpired: trialExpired,
        endsAt: trialEndsIso,
      },
      subscription: {
        plan: subscription?.plan || ctx.plan,
        status: normalizedStatus,
        billingCycle: subscription?.billingCycle || ctx.cycle,
        currentPeriodStart: subscription?.currentPeriodStart ? subscription.currentPeriodStart.toISOString() : null,
        currentPeriodEnd: computedState.currentPeriodEnd ? computedState.currentPeriodEnd.toISOString() : null,
        nextBillingAt: computedState.nextBillingAt ? computedState.nextBillingAt.toISOString() : null,
        graceUntil: computedState.graceUntil ? computedState.graceUntil.toISOString() : null,
        paymentMethod,
        gateway: subscription?.gateway || 'mercadopago',
        gateway_subscription_id: subscription?.gatewaySubscriptionId || null,
        gateway_customer_id: subscription?.gatewayCustomerId || null,
        gateway_payment_id: subscription?.gatewayPaymentId || null,
      },
      payment_methods: {
        primary: 'credit_card',
        alternative: 'pix',
        recommended: 'credit_card',
        gateway: 'mercadopago',
        public_key: getMercadoPagoPublicKey(),
        credentials: getBillingMercadoPagoCredentialDiagnostics(),
      },
      billing: {
        renewalRequired,
        hasOpenPayment,
        openPayment,
        preferredMethod: 'credit_card',
      },
    })
  } catch (err) {
    console.error('[billing/status]', err)
    return res.status(500).json({ error: 'server_error' })
  }
})

router.get('/subscription', auth, isEstabelecimento, async (req, res) => {
  try {
    const { planContext, subscriptions: fullHistory, subscription: effective, computedState } =
      await loadEffectiveSubscriptionContext(req.user.id)

    const isWhatsAppTopup = (sub) => {
      const ref = String(sub?.externalReference || '')
      return ref.startsWith('wallet:whatsapp_topup')
    }

    const topups = fullHistory.filter(isWhatsAppTopup)
    const history = fullHistory.filter((sub) => !isWhatsAppTopup(sub))

    const planLimit = planContext?.config?.maxMonthlyAppointments ?? null
    let usage = { total: 0, limit: planLimit, range: null }
    if (planContext) {
      try {
        const result = await checkMonthlyAppointmentLimit({
          estabelecimentoId: req.user.id,
          planConfig: planContext.config,
          appointmentDate: new Date(),
        })
        usage = {
          total: typeof result?.total === 'number' ? result.total : 0,
          limit: result?.limit ?? planLimit,
          range: result?.range || null,
        }
      } catch (err) {
        console.warn('[billing/subscription][usage]', err?.message || err)
      }
    }

    const serializedPlan = serializePlanContext(planContext)
    if (serializedPlan) {
      serializedPlan.usage = {
        appointments: {
          total: usage.total,
          limit: usage.limit,
          month: usage.range?.label || null,
          period_start: usage.range?.start ? usage.range.start.toISOString() : null,
          period_end: usage.range?.end ? usage.range.end.toISOString() : null,
        },
      }
    }

    let billingPlan = null
    let professionalsUsage = null
    try {
      billingPlan = await BillingService.getCurrentPlan(req.user.id)
      const totalActive = await BillingService.countActiveProfessionals(req.user.id)
      professionalsUsage = { total: totalActive, limit: billingPlan?.maxProfessionals ?? null }
    } catch (err) {
      console.warn('[billing/subscription][current plan]', err?.message || err)
    }

    if (serializedPlan) {
      serializedPlan.limits = serializedPlan.limits || {}
      serializedPlan.limits.maxProfessionals =
        billingPlan?.maxProfessionals ?? serializedPlan.limits.maxProfessionals ?? null
      serializedPlan.usage = serializedPlan.usage || {}
      if (professionalsUsage) {
        serializedPlan.usage.professionals = {
          total: professionalsUsage.total,
          limit: professionalsUsage.limit,
        }
      }
    }

    let whatsappWallet = null
    try {
      whatsappWallet = await getWhatsAppWalletSnapshot(req.user.id, { planContext })
      if (serializedPlan) {
        serializedPlan.usage = serializedPlan.usage || {}
        serializedPlan.usage.whatsapp = whatsappWallet
      }
    } catch (err) {
      console.warn('[billing/subscription][wallet]', err?.message || err)
    }

    let whatsappPacks = []
    try {
      whatsappPacks = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/subscription][packs]', err?.message || err)
    }

    const events = enrichSubscriptionEvents(
      await listSubscriptionEventsForEstabelecimento(req.user.id, { limit: 30 })
    )
    const latestPaymentResult = findLatestMercadoPagoPaymentResult(events, { includePending: true })
    const latestFailure = findLatestMercadoPagoPaymentResult(events, {
      includePending: false,
      onlyFailures: true,
    })
    const recoverySubscription = pickRecoverableCardSubscription({
      planContext,
      subscriptions: fullHistory,
      subscription: effective,
      computedState,
    })
    const recoveryGuard = recoverySubscription
      ? serializeRecoveryGuard(await getRecoveryChargeGuard({
          subscription: recoverySubscription,
          currentStatus:
            recoverySubscription.id === effective?.id
              ? computedState.resolvedStatus
              : recoverySubscription.status,
          amountCents:
            Number(recoverySubscription.amountCents || 0) ||
            getPlanPriceCents(recoverySubscription.plan, recoverySubscription.billingCycle),
          plan: recoverySubscription.plan,
          billingCycle: recoverySubscription.billingCycle,
        }))
      : null

    return res.json({
      plan: serializedPlan,
      whatsapp_packages: (whatsappPacks.length ? whatsappPacks : WHATSAPP_TOPUP_PACKAGES).map(serializeWhatsAppPack).filter(Boolean),
      subscription: effective
        ? {
            ...serializeSubscription(effective),
            status: computedState.resolvedStatus,
            access_state: computedState.accessState,
            core_features_allowed: computedState.coreFeaturesAllowed,
          }
        : null,
      history: history.map(serializeSubscription),
      topups: topups.map(serializeSubscription),
      events,
      latest_payment_result: latestPaymentResult,
      latest_failure: latestFailure,
      recovery_guard: recoveryGuard,
      current_plan: billingPlan
        ? {
            code: billingPlan.code,
            name: billingPlan.name,
            price_cents: billingPlan.priceCents,
            max_professionals: billingPlan.maxProfessionals,
            included_wa_messages: billingPlan.includedWaMessages,
          }
        : null,
      professional_limit: professionalsUsage,
    })
  } catch (error) {
    console.error('GET /billing/subscription', error)
    return res.status(500).json({ error: 'subscription_fetch_failed' })
  }
})

router.post('/card/subscribe', auth, isEstabelecimento, async (req, res) => {
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
  try {
    const { plan, billing_cycle: rawCycle, card_token, cardToken, payer_email, payerEmail } = req.body || {}
    const token = String(card_token || cardToken || '').trim()
    if (!token) {
      return res.status(400).json({
        error: 'card_token_required',
        message: 'Token do cartão não informado.',
        request_id: requestId,
      })
    }

    const currentContext = await loadEffectiveSubscriptionContext(req.user.id)
    const targetPlan = String(
      plan ||
      currentContext?.subscription?.plan ||
      currentContext?.planContext?.plan ||
      req.user.plan ||
      'starter'
    ).toLowerCase()
    if (!PLAN_TIERS.includes(targetPlan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plano inválido.' })
    }
    const billingCycle = normalizeBillingCycle(
      rawCycle ||
      currentContext?.subscription?.billingCycle ||
      currentContext?.planContext?.cycle ||
      req.user.plan_cycle ||
      'mensal'
    )
    const currentPlan = String(
      currentContext?.subscription?.plan ||
      currentContext?.planContext?.plan ||
      req.user.plan ||
      'starter'
    ).toLowerCase()

    if (isDowngrade(currentPlan, targetPlan)) {
      const limits = resolvePlanConfig(targetPlan)
      const totalProfessionals = await countProfessionals(req.user.id)
      if (typeof limits.maxProfessionals === 'number' && totalProfessionals > limits.maxProfessionals) {
        return res.status(409).json({
          error: 'plan_limit_professionals',
          message: formatPlanLimitExceeded(limits, 'professionals') || 'Reduza a equipe antes de fazer downgrade.',
        })
      }
    }

    const recentEvents = await listSubscriptionEventsForEstabelecimento(req.user.id, { limit: 20 })
    const createGuard = canCreateSubscription({
      currentSubscription: currentContext?.subscription || null,
      recentEvents,
      targetPlan,
      billingCycle,
    })
    if (!createGuard.allowed) {
      console.warn('[billing][create_subscription]', {
        operation: 'create_subscription',
        request_id: requestId,
        user_id: req.user.id,
        estabelecimento_id: req.user.id,
        plan: targetPlan,
        billing_cycle: billingCycle,
        normalized_reason: createGuard.normalized_reason || null,
        cooldown_active: createGuard.cooldown_active === true,
        decision: createGuard.decision || 'block',
        matched_event_type: createGuard.matched_event_type || null,
        matched_event_at: createGuard.matched_event_at || null,
      })
      return res.status(409).json({
        error: 'subscription_create_blocked',
        message: createGuard.user_message || 'Ja existe uma configuracao recente de assinatura no cartao. Aguarde antes de tentar novamente.',
        details: createGuard,
        request_id: requestId,
      })
    }

    const result = await createOrReplaceCardSubscription({
      estabelecimentoId: req.user.id,
      email: req.user.email,
      plan: targetPlan,
      billingCycle,
      cardToken: token,
      payerEmail: payer_email || payerEmail || req.user.email,
      requestContext: {
        requestId,
        route: '/billing/card/subscribe',
        operation: 'card_subscription_create',
      },
    })
    const recoveryGuard = result.recoveryRequired
      ? serializeRecoveryGuard(await getRecoveryChargeGuard({
          subscription: result.subscription,
          currentStatus: result.computedState.resolvedStatus,
          amountCents:
            Number(result.subscription?.amountCents || 0) ||
            getPlanPriceCents(targetPlan, billingCycle),
          payerEmail: payer_email || payerEmail || req.user.email,
          plan: targetPlan,
          billingCycle,
        }))
      : null
    console.info('[billing][create_subscription]', {
      operation: 'create_subscription',
      request_id: requestId,
      user_id: req.user.id,
      estabelecimento_id: req.user.id,
      subscription_id: result.subscription?.id || null,
      preapproval_id: result.gatewayResult?.subscription?.gatewaySubscriptionId || null,
      plan: targetPlan,
      billing_cycle: billingCycle,
      recovery_required: result.recoveryRequired === true,
      recovery_decision: recoveryGuard?.decision || null,
      decision: 'created',
    })

    return res.json({
      ok: true,
      automatic_renewal: true,
      recovery_required: !!result.recoveryRequired,
      recovery_guard: recoveryGuard,
      plan_status: result.computedState.resolvedStatus,
      access_state: result.computedState.accessState,
      subscription: serializeSubscription(result.subscription),
      gateway: {
        subscription_id: result.gatewayResult?.subscription?.gatewaySubscriptionId || null,
        customer_id: result.gatewayResult?.subscription?.gatewayCustomerId || null,
        next_billing_at: result.gatewayResult?.subscription?.nextBillingAt || null,
      },
      request_id: requestId,
    })
  } catch (error) {
    return sendBillingCardError(
      res,
      'POST /billing/card/subscribe',
      error,
      'card_subscription_failed',
      'Falha ao criar assinatura recorrente no cartão.',
      requestId
    )
  }
})

router.post('/card/update', auth, isEstabelecimento, async (req, res) => {
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
  try {
    const token = String(req.body?.card_token || req.body?.cardToken || '').trim()
    if (!token) {
      return res.status(400).json({
        error: 'card_token_required',
        message: 'Token do cartão não informado.',
        request_id: requestId,
      })
    }

    const previousContext = await loadEffectiveSubscriptionContext(req.user.id)
    const { planContext, subscriptions, subscription: effective, computedState } = previousContext
    const targetCardSubscription = (() => {
      const recoverable = pickRecoverableCardSubscription(previousContext)
      if (recoverable?.gatewaySubscriptionId) return recoverable
      if (effective?.gatewaySubscriptionId && String(effective.paymentMethod || '').toLowerCase() === 'credit_card') {
        return effective
      }
      return subscriptions.find((item) =>
        item?.gatewaySubscriptionId &&
        String(item.paymentMethod || '').toLowerCase() === 'credit_card' &&
        !['canceled'].includes(String(item.status || '').toLowerCase())
      ) || null
    })()

    const billingCycle = normalizeBillingCycle(
      targetCardSubscription?.billingCycle ||
      effective?.billingCycle ||
      req.body?.billing_cycle ||
      planContext?.cycle ||
      req.user.plan_cycle ||
      'mensal'
    )
    const targetPlan = String(
      targetCardSubscription?.plan ||
      effective?.plan ||
      req.body?.plan ||
      planContext?.plan ||
      req.user.plan ||
      'starter'
    ).toLowerCase()

    if (!targetCardSubscription?.gatewaySubscriptionId) {
      const recentEvents = await listSubscriptionEventsForEstabelecimento(req.user.id, { limit: 20 })
      const createGuard = canCreateSubscription({
        currentSubscription: effective || null,
        recentEvents,
        targetPlan,
        billingCycle,
      })
      if (!createGuard.allowed) {
        console.warn('[billing][update_subscription_card]', {
          operation: 'update_subscription_card',
          request_id: requestId,
          user_id: req.user.id,
          estabelecimento_id: req.user.id,
          plan: targetPlan,
          billing_cycle: billingCycle,
          normalized_reason: createGuard.normalized_reason || null,
          cooldown_active: createGuard.cooldown_active === true,
          decision: createGuard.decision || 'block',
          matched_event_type: createGuard.matched_event_type || null,
          matched_event_at: createGuard.matched_event_at || null,
        })
        return res.status(409).json({
          error: 'subscription_create_blocked',
          message: createGuard.user_message || 'Ja existe uma configuracao recente de assinatura no cartao. Aguarde antes de tentar novamente.',
          details: createGuard,
          request_id: requestId,
        })
      }
      const created = await createOrReplaceCardSubscription({
        estabelecimentoId: req.user.id,
        email: req.user.email,
        plan: targetPlan,
        billingCycle,
        cardToken: token,
        payerEmail: req.body?.payer_email || req.body?.payerEmail || req.user.email,
        requestContext: {
          requestId,
          route: '/billing/card/update',
          operation: 'card_subscription_create',
        },
      })
      const recoveryGuard = created.recoveryRequired
        ? serializeRecoveryGuard(await getRecoveryChargeGuard({
            subscription: created.subscription,
            currentStatus: created.computedState.resolvedStatus,
            amountCents:
              Number(created.subscription?.amountCents || 0) ||
              getPlanPriceCents(targetPlan, billingCycle),
            payerEmail: req.body?.payer_email || req.body?.payerEmail || req.user.email,
            plan: targetPlan,
            billingCycle,
          }))
        : null
      console.info('[billing][update_subscription_card]', {
        operation: 'update_subscription_card',
        request_id: requestId,
        user_id: req.user.id,
        estabelecimento_id: req.user.id,
        subscription_id: created.subscription?.id || null,
        preapproval_id: created.subscription?.gatewaySubscriptionId || null,
        plan: targetPlan,
        billing_cycle: billingCycle,
        created: true,
        recovery_required: created.recoveryRequired === true,
        recovery_decision: recoveryGuard?.decision || null,
        decision: 'created',
      })
      return res.json({
        ok: true,
        created: true,
        recovery_required: !!created.recoveryRequired,
        recovery_guard: recoveryGuard,
        plan_status: created.computedState.resolvedStatus,
        access_state: created.computedState.accessState,
        subscription: serializeSubscription(created.subscription),
        request_id: requestId,
      })
    }

    const amountCents = getPlanPriceCents(targetPlan, billingCycle)
    const gatewayResult = await updateMercadoPagoCardSubscription(targetCardSubscription.gatewaySubscriptionId, {
      cardToken: token,
      payerEmail: req.body?.payer_email || req.body?.payerEmail || req.user.email,
      amountCents,
      billingCycle,
      status: 'authorized',
      requestContext: {
        requestId,
        route: '/billing/card/update',
        operation: 'card_subscription_update',
        subscriptionId: targetCardSubscription.id,
        externalReference: targetCardSubscription.externalReference || null,
      },
    })
    const persistenceState = resolveCardPersistenceAfterSave({
      gatewaySubscription: gatewayResult?.subscription || null,
      previousContext: {
        planContext,
        subscription: targetCardSubscription,
        computedState,
      },
    })

    const updated = await updateSubscription(targetCardSubscription.id, {
      paymentMethod: 'credit_card',
      gatewayCustomerId: gatewayResult?.subscription?.gatewayCustomerId || targetCardSubscription.gatewayCustomerId || null,
      status: persistenceState.status,
      amountCents: gatewayResult?.subscription?.amountCents || amountCents,
      currency: gatewayResult?.subscription?.currency || targetCardSubscription.currency || (config.billing?.currency || 'BRL'),
      billingCycle,
      nextBillingAt: persistenceState.nextBillingAt || targetCardSubscription.nextBillingAt || null,
      currentPeriodStart: persistenceState.currentPeriodStart || targetCardSubscription.currentPeriodStart || null,
      currentPeriodEnd: persistenceState.currentPeriodEnd || targetCardSubscription.currentPeriodEnd || gatewayResult?.subscription?.currentPeriodEnd || null,
      graceUntil: persistenceState.graceUntil || targetCardSubscription.graceUntil || null,
      lastPaymentAt: persistenceState.lastPaymentAt || targetCardSubscription.lastPaymentAt || null,
    })
    await appendSubscriptionEvent(updated.id, {
      eventType: 'payment_method_changed',
      gatewayEventId: updated.gatewaySubscriptionId || null,
      payload: {
        plan: targetPlan,
        billing_cycle: billingCycle,
        amount_cents: gatewayResult?.subscription?.amountCents || amountCents,
        request: gatewayResult.request,
        response: gatewayResult.raw,
      },
    })

    const effectiveContext = await loadEffectiveSubscriptionContext(req.user.id)
    const recoveryGuard = persistenceState.recoveryRequired
      ? serializeRecoveryGuard(await getRecoveryChargeGuard({
          subscription: updated,
          currentStatus: effectiveContext.computedState.resolvedStatus,
          amountCents: gatewayResult?.subscription?.amountCents || amountCents,
          payerEmail: req.body?.payer_email || req.body?.payerEmail || req.user.email,
          plan: targetPlan,
          billingCycle,
        }))
      : null
    console.info('[billing][update_subscription_card]', {
      operation: 'update_subscription_card',
      request_id: requestId,
      user_id: req.user.id,
      estabelecimento_id: req.user.id,
      subscription_id: updated.id || null,
      preapproval_id: updated.gatewaySubscriptionId || null,
      plan: targetPlan,
      billing_cycle: billingCycle,
      created: false,
      recovery_required: persistenceState.recoveryRequired === true,
      recovery_decision: recoveryGuard?.decision || null,
      decision: 'updated',
    })

    return res.json({
      ok: true,
      created: false,
      recovery_required: !!persistenceState.recoveryRequired,
      recovery_guard: recoveryGuard,
      plan_status: effectiveContext.computedState.resolvedStatus,
      access_state: effectiveContext.computedState.accessState,
      subscription: serializeSubscription(updated),
      request_id: requestId,
    })
  } catch (error) {
    return sendBillingCardError(
      res,
      'POST /billing/card/update',
      error,
      'card_update_failed',
      'Falha ao atualizar o cartão.',
      requestId
    )
  }
})

router.post('/card/recover', auth, isEstabelecimento, async (req, res) => {
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
  try {
    const token = String(req.body?.card_token || req.body?.cardToken || '').trim()
    if (!token) {
      return res.status(400).json({
        error: 'card_token_required',
        message: 'Token do cartão não informado.',
        request_id: requestId,
      })
    }

    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || randomUUID()
    const context = await loadEffectiveSubscriptionContext(req.user.id)
    const targetSubscription = pickRecoverableCardSubscription(context)
    const currentStatus = context?.computedState?.resolvedStatus || targetSubscription?.status || 'unpaid'

    if (!targetSubscription?.gatewaySubscriptionId || !requiresCardRecovery(currentStatus)) {
      return res.status(409).json({
        error: 'card_recovery_not_required',
        message: 'Não existe uma pendência elegível para regularização imediata no cartão.',
        request_id: requestId,
      })
    }

    const plan = String(
      targetSubscription.plan ||
      context?.planContext?.plan ||
      req.user.plan ||
      'starter'
    ).toLowerCase()
    const billingCycle = normalizeBillingCycle(
      targetSubscription.billingCycle ||
      context?.planContext?.cycle ||
      req.user.plan_cycle ||
      'mensal'
    )
    const amountCents = Number(targetSubscription.amountCents || 0) || getPlanPriceCents(plan, billingCycle)
    const payerEmail = req.body?.payer_email || req.body?.payerEmail || req.user.email
    const paymentMethodId = req.body?.payment_method_id || req.body?.paymentMethodId || null
    const externalReference = buildCardRecoveryExternalReference(targetSubscription.id, idempotencyKey)
    const chargeFingerprint = buildRecoveryChargeFingerprint({
      subscriptionId: targetSubscription.id,
      plan,
      billingCycle,
      amountCents,
      payerEmail,
      paymentMethodId,
    })

    const previousOutcome = await getSubscriptionEventByGatewayEventId(targetSubscription.id, externalReference, {
      eventTypes: ['payment_recovered', 'payment_failed', 'payment_pending'],
    })
    if (previousOutcome) {
      const refreshedContext = await loadEffectiveSubscriptionContext(req.user.id)
      const refreshedSubscription =
        (refreshedContext.subscription?.id === targetSubscription.id && refreshedContext.subscription) ||
        await getSubscriptionById(targetSubscription.id)
      const paymentResult = previousOutcome.payload?.payment_result || null
      const paid = previousOutcome.event_type === 'payment_recovered'
      const pending = previousOutcome.event_type === 'payment_pending'
      return res.json({
        ok: true,
        paid,
        pending,
        idempotent: true,
        recovery_status: paid ? 'approved' : pending ? 'pending' : 'rejected',
        message: paid
          ? 'A cobrança pendente já foi quitada neste cartão.'
          : (paymentResult?.user_message || (
              pending
                ? 'Ja existe uma cobranca em analise. Aguarde a confirmacao antes de tentar novamente.'
                : 'A ultima tentativa no cartao nao foi aprovada. Voce pode tentar novamente ou gerar um PIX.'
            )),
        plan_status: refreshedContext.computedState.resolvedStatus,
        access_state: refreshedContext.computedState.accessState,
        subscription: serializeSubscription(refreshedSubscription),
        payment: previousOutcome.payload?.raw?.payment || null,
        payment_result: paymentResult,
        request_id: requestId,
      })
    }

    const recoveryGuard = await getRecoveryChargeGuard({
      subscription: targetSubscription,
      currentStatus,
      amountCents,
      payerEmail,
      paymentMethodId,
      plan,
      billingCycle,
    })
    if (!recoveryGuard?.can_run) {
      logRecoveryChargeGuard('recovery_policy', {
        guard: recoveryGuard,
        subscription: targetSubscription,
        amountCents,
        externalReference,
        requestId,
        userId: req.user.id,
        paymentMethodId,
      })
      return res.status(409).json({
        error: recoveryGuard?.decision === 'defer' ? 'recovery_charge_deferred' : 'recovery_charge_blocked',
        message: recoveryGuard?.user_message || 'Nao foi possivel iniciar a cobranca agora.',
        recovery_guard: serializeRecoveryGuard(recoveryGuard),
        request_id: requestId,
      })
    }
    logRecoveryChargeGuard('recovery_policy', {
      guard: recoveryGuard,
      subscription: targetSubscription,
      amountCents,
      externalReference,
      requestId,
      userId: req.user.id,
      paymentMethodId,
    })

    await appendSubscriptionEvent(targetSubscription.id, {
      eventType: 'payment_recovery_attempt',
      gatewayEventId: externalReference,
      payload: {
        amount_cents: amountCents,
        idempotency_key: idempotencyKey,
        external_reference: externalReference,
        previous_status: currentStatus,
        payment_method: 'credit_card',
        payment_method_id: paymentMethodId,
        payer_email: payerEmail,
        plan,
        billing_cycle: billingCycle,
        duplicate_fingerprint: chargeFingerprint,
      },
    })

    const paymentResult = await createMercadoPagoCardRecoveryPayment({
      subscription: targetSubscription,
      estabelecimento: { id: req.user.id, email: req.user.email },
      amountCents,
      description: `Regularizacao de assinatura Agendamentos Online - ${plan} (${billingCycle})`,
      cardToken: token,
      payerEmail,
      payerProfile: buildBillingPayerProfile(req.user, req.body),
      paymentMethodId,
      issuerId: req.body?.issuer_id || req.body?.issuerId || null,
      identificationType: req.body?.identification_type || req.body?.identificationType || null,
      identificationNumber: req.body?.identification_number || req.body?.identificationNumber || null,
      externalReference,
      idempotencyKey,
      requestContext: {
        requestId,
        route: '/billing/card/recover',
        operation: 'card_recovery_payment',
      },
    })
    const payment = paymentResult?.payment
    if (!payment) {
      throw new Error('card_recovery_payment_invalid')
    }
    const paymentOutcome = payment.paymentResult || summarizeMercadoPagoGatewayResult(paymentResult.raw)

    if (paymentOutcome?.should_activate_subscription) {
      const finalized = await finalizeApprovedCardRecovery({
        targetSubscription,
        payment,
        paymentResult: paymentOutcome,
        currentStatus,
        billingCycle,
        amountCents,
        requestId,
        externalReference,
        source: 'api',
      })
      return res.json({
        ok: true,
        paid: true,
        pending: false,
        recovery_status: 'approved',
        message: paymentOutcome.user_message || 'Pagamento aprovado.',
        plan_status: finalized.effectiveContext.computedState.resolvedStatus,
        access_state: finalized.effectiveContext.computedState.accessState,
        subscription: serializeSubscription(finalized.updated),
        payment: paymentResult.raw,
        payment_result: paymentOutcome,
        request_id: requestId,
      })
    }

    const finalized = await finalizeNonApprovedCardRecovery({
      targetSubscription,
      payment,
      paymentResult: paymentOutcome,
      currentStatus,
      requestId,
      externalReference,
      source: 'api',
    })

    const pending = paymentOutcome?.status_group === 'pending'
    return res.json({
      ok: true,
      paid: false,
      pending,
      recovery_status: pending ? 'pending' : payment.rawStatus || 'rejected',
      message: paymentOutcome?.user_message || (
        pending
          ? 'O pagamento esta em analise pelo Mercado Pago. Aguarde a confirmacao antes de tentar novamente.'
          : 'O cartao foi validado, mas a cobranca pendente nao foi aprovada. Tente novamente ou gere um PIX.'
      ),
      plan_status: finalized.effectiveContext.computedState.resolvedStatus,
      access_state: finalized.effectiveContext.computedState.accessState,
      subscription: serializeSubscription(finalized.updated),
      payment: paymentResult.raw,
      payment_result: paymentOutcome,
      request_id: requestId,
    })
  } catch (error) {
    return sendBillingCardError(
      res,
      'POST /billing/card/recover',
      error,
      'card_recovery_failed',
      'Falha ao cobrar a pendência no cartão.',
      requestId
    )
  }
})

router.get('/whatsapp/packs', auth, isEstabelecimento, async (_req, res) => {
  try {
    let packs = []
    try {
      packs = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/whatsapp/packs] fallback to static packages', err?.message || err)
    }
    const responsePacks = (packs.length ? packs : WHATSAPP_TOPUP_PACKAGES).map(serializeWhatsAppPack).filter(Boolean)
    return res.json({ ok: true, packs: responsePacks })
  } catch (err) {
    console.error('GET /billing/whatsapp/packs', err)
    return res.status(500).json({ error: 'packs_fetch_failed' })
  }
})

// Wallet WhatsApp (saldo de mensagens por estabelecimento)
router.get('/whatsapp/wallet', auth, isEstabelecimento, async (req, res) => {
  // Evita cache/304: sempre retorna dados atualizados (saldo muda após PIX/webhook)
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });

  try {
    const planContext = await getPlanContext(req.user.id);
    const wallet = await getWhatsAppWalletSnapshot(req.user.id, { planContext });

    let packs = [];
    try {
      packs = await listActiveWhatsAppPacks();
    } catch (err) {
      console.warn('[billing/whatsapp/wallet][packs]', err?.message || err);
    }

    const history = await listWhatsAppTopups(req.user.id, { limit: 5 }).catch(() => []);

    return res.json({
      ok: true,
      wallet,
      packages: (packs.length ? packs : WHATSAPP_TOPUP_PACKAGES)
        .map(serializeWhatsAppPack)
        .filter(Boolean),
      history: history.map(serializeTopupHistory).filter(Boolean),
    });
  } catch (err) {
    console.error('GET /billing/whatsapp/wallet', err);
    return res.status(500).json({ error: 'wallet_fetch_failed' });
  }
});

router.get('/whatsapp/pix/status', auth, isEstabelecimento, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const estabelecimentoId = req.user.id;
    const paymentId = String(req.query.payment_id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'missing_payment_id' });
    }

    const [rows] = await pool.query(
      `SELECT id, created_at
         FROM whatsapp_wallet_transactions
        WHERE estabelecimento_id = ?
          AND payment_id = ?
          AND kind = 'topup_credit'
        ORDER BY id DESC
        LIMIT 1`,
      [estabelecimentoId, paymentId]
    );

    const credited = Array.isArray(rows) && rows.length > 0;
    const creditedAt = credited && rows[0]?.created_at ? new Date(rows[0].created_at).toISOString() : null;
    return res.json({ ok: true, credited, credited_at: creditedAt });
  } catch (err) {
    console.error('GET /billing/whatsapp/pix/status', err);
    return res.status(500).json({ ok: false, error: 'status_failed' });
  }
});

// Checkout PIX para pacote extra de mensagens WhatsApp
router.post('/whatsapp/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const { messages, pack_code, pack_id, packCode, packId } = req.body || {}
    const packCodeInput = (pack_code || packCode || '').trim() || null
    const packIdInput = pack_id ?? packId ?? null

    if (!packCodeInput) {
      return res.status(400).json({ error: 'pack_required' })
    }

    let availablePacks = []
    try {
      availablePacks = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/whatsapp/pix][packs]', err?.message || err)
    }

    let selectedPack = null
    if (packIdInput != null || packCodeInput) {
      selectedPack = await findWhatsAppPack({ id: packIdInput, code: packCodeInput, activeOnly: true })
      if (!selectedPack) return res.status(404).json({ error: 'pack_not_found' })
    } else if (messages && availablePacks.length) {
      selectedPack = availablePacks.find((p) => Number(p.waMessages || 0) === Number(messages || 0)) || null
    }

    if (!selectedPack && !messages) {
      return res.status(400).json({ error: 'invalid_pack', message: 'Pacote n\u00e3o informado.' })
    }

    const result = await createMercadoPagoPixTopupCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      messages: selectedPack?.waMessages ?? messages,
      planHint: req.user.plan || 'starter',
      pack: selectedPack,
      availablePacks: availablePacks.length ? availablePacks : null,
    })

    const packResponse =
      serializeWhatsAppPack(selectedPack) ||
      (result.package
        ? {
            code: result.package.code || null,
            name: result.package.name || null,
            price_cents: result.package.priceCents,
            wa_messages: result.package.messages,
          }
        : null)

    console.info('[billing/whatsapp/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      pack_code: selectedPack?.code || packCodeInput || null,
      pack_id: selectedPack?.id ?? packIdInput ?? null,
      messages: result?.pix?.messages || messages || selectedPack?.waMessages,
      payment_id: result?.pix?.payment_id || result?.subscription?.gateway_preference_id || null,
    })

    return res.json({
      ok: true,
      init_point: result.initPoint,
      subscription: serializeSubscription(result.subscription),
      pix: result.pix,
      pack: packResponse,
      package: result.package ? { messages: result.package.messages, price_cents: result.package.priceCents } : null,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message || 'Falha ao criar cobrança PIX'
    console.error('POST /billing/whatsapp/pix', detail, cause || error)
    return res.status(400).json({ error: 'pix_failed', message: detail, cause })
  }
})

router.post('/webhook', async (req, res) => {
  const event = req.body || {}
  const topic = String(
    req.query?.type ||
    req.query?.topic ||
    event?.type ||
    event?.topic ||
    req.headers['x-topic'] ||
    ''
  ).toLowerCase()
  const bodyUserId = event?.user_id ?? event?.userId ?? null
  const liveMode = typeof event?.live_mode === 'boolean' ? event.live_mode : null
  const bodyType = event?.type ?? event?.topic ?? null
  const bodyAction = event?.action ?? null

  const verification = verifyMercadoPagoWebhookSignature(req)
  if (!verification.ok) {
    const reason = verification.reason || 'invalid_signature'

    // Se veio x-signature, loga detalhes (util p/ diagnosticar fonte/ambiente errado),
    // mas SEMPRE responde 200 para nao gerar retries.
    const xSignature = req.headers['x-signature']
    const signaturePresent = Boolean(String(normalizeWebhookHeaderValue(xSignature)).trim())
    const signatureDetails = parseSignatureHeaderForLog(xSignature)
    const requestId = String(req.headers['x-request-id'] || '').trim()
    const ip = getClientIpForLog(req)

    if (signaturePresent && shouldLogMismatchForIp(ip)) {
      console.warn('[billing:webhook] mismatch_source', {
        host: String(req.headers.host || '').trim() || null,
        url: req.originalUrl,
        ip: ip || null,
        user_agent: String(req.headers['user-agent'] || '').trim() || null,
        x_request_id: requestId || null,
        x_request_id_present: Boolean(requestId),
        x_signature_present: signaturePresent,
        x_signature_prefix: signatureDetails.signaturePrefix,
        ts: signatureDetails.ts || null,
        v1_prefix: signatureDetails.v1Prefix,
        resource_id: verification.id || null,
        topic: topic || null,
        body_user_id: bodyUserId,
        body_live_mode: liveMode,
        body_type: bodyType,
        body_action: bodyAction,
        reason,
      })
    } else {
      console.warn('[billing:webhook] invalid_webhook', {
        url: req.originalUrl,
        ip: ip || null,
        user_agent: String(req.headers['user-agent'] || '').trim() || null,
        topic: topic || null,
        resource_id: verification.id || null,
        body_user_id: bodyUserId,
        body_live_mode: liveMode,
        body_type: bodyType,
        body_action: bodyAction,
        reason,
        x_signature_present: signaturePresent,
      })
    }

    return res.status(200).json({ ok: true, ignored: true, reason })
  }

  const resourceId = verification.id

  try {
    if (topic === 'payment') {
      const normalizedUserId = bodyUserId != null ? Number(bodyUserId) : null
      const isPlatformUser = Number.isFinite(normalizedUserId) && normalizedUserId === MP_COLLECTOR_ID

      if (!isPlatformUser) {
        const depositResult = await handleDepositPaymentWebhook({
          resourceId,
          event,
          bodyUserId: normalizedUserId,
        })
        if (depositResult?.handled) {
          console.log('[billing:webhook][deposit] handled', resourceId, depositResult.status || 'ok')
          return res.status(200).json({ ok: true, processed: true, deposit: true, status: depositResult.status || null })
        }
        if (depositResult?.ok && depositResult?.status) {
          return res.status(200).json({ ok: true, processed: false, deposit: true, status: depositResult.status })
        }
        const loyaltyResult = await syncClientLoyaltyPixPaymentFromGateway(resourceId, {
          bodyUserId: normalizedUserId,
          gatewayEventId: resourceId,
        })
        if (loyaltyResult?.ok) {
          console.log('[billing:webhook][loyalty] payment', resourceId, loyaltyResult?.handled ? 'processed' : 'ignored', {
            ok: !!loyaltyResult?.ok,
            status: loyaltyResult?.status || null,
            reason: loyaltyResult?.reason || null,
          })
          return res.status(200).json({
            ok: true,
            processed: Boolean(loyaltyResult?.handled),
            loyalty: true,
            status: loyaltyResult?.status || null,
            reason: loyaltyResult?.reason || null,
          })
        }
        console.warn('[billing:webhook] ignored_foreign_user', {
          resource_id: verification.id || null,
          body_user_id: bodyUserId,
          expected_user_id: MP_COLLECTOR_ID,
          live_mode: liveMode,
          body_type: bodyType,
          body_action: bodyAction,
          reason: depositResult?.reason || 'foreign_user',
        })
        return res.status(200).json({ ok: true, ignored: true, reason: depositResult?.reason || 'foreign_user' })
      }

      const recoveryResult = await syncCardRecoveryPaymentFromGateway(resourceId, {
        gatewayEventId: resourceId,
      })
      if (recoveryResult?.ok) {
        console.log('[billing:webhook] subscription_recovery_payment', resourceId, recoveryResult?.handled ? 'processed' : 'ignored', {
          ok: !!recoveryResult?.ok,
          reason: recoveryResult?.reason || null,
          status: recoveryResult?.status || null,
          normalized_reason: recoveryResult?.paymentResult?.normalized_reason || null,
          status_detail: recoveryResult?.paymentResult?.status_detail || null,
        })
        return res.status(200).json({
          ok: true,
          processed: Boolean(recoveryResult?.handled),
          recovery: true,
          status: recoveryResult?.status || null,
          reason: recoveryResult?.reason || null,
        })
      }

      const r = await syncMercadoPagoPayment(resourceId, event)
      console.log('[billing:webhook] payment', resourceId, r?.ok ? 'approved' : 'ignored', { ok: !!r?.ok })
      return res.status(200).json({ ok: true, processed: !!r?.ok })
    }

    if (topic === 'subscription_authorized_payment') {
      const loyaltyResult = await syncClientLoyaltyAuthorizedPaymentFromGateway(resourceId, {
        bodyUserId,
        gatewayEventId: resourceId,
      })
      if (loyaltyResult?.ok) {
        console.log('[billing:webhook][loyalty] subscription_authorized_payment', resourceId, loyaltyResult?.handled ? 'processed' : 'ignored', {
          ok: !!loyaltyResult?.ok,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
          status_detail: loyaltyResult?.failure?.status_detail || null,
          rejection_code: loyaltyResult?.failure?.code || null,
          rejection_description: loyaltyResult?.failure?.description || null,
        })
        return res.status(200).json({
          ok: true,
          processed: Boolean(loyaltyResult?.handled),
          loyalty: true,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
        })
      }
      const result = await syncAuthorizedPaymentFromGateway(resourceId, { gatewayEventId: resourceId })
      console.log('[billing:webhook] subscription_authorized_payment', resourceId, result?.ok ? 'processed' : 'ignored', {
        ok: !!result?.ok,
        reason: result?.reason || null,
        status: result?.paymentResult?.status || null,
        status_detail: result?.paymentResult?.status_detail || null,
        normalized_reason: result?.paymentResult?.normalized_reason || null,
      })
      return res.status(200).json({ ok: true, processed: !!result?.ok, reason: result?.reason || null })
    }

    if (topic === 'subscription_preapproval') {
      const loyaltyResult = await syncClientLoyaltyCardSubscriptionFromGateway(resourceId, {
        bodyUserId,
        gatewayEventId: resourceId,
      })
      if (loyaltyResult?.ok) {
        console.log('[billing:webhook][loyalty] subscription_preapproval', resourceId, loyaltyResult?.handled ? 'processed' : 'ignored', {
          ok: !!loyaltyResult?.ok,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
        })
        return res.status(200).json({
          ok: true,
          processed: Boolean(loyaltyResult?.handled),
          loyalty: true,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
        })
      }
      const result = await syncCardSubscriptionFromGateway(resourceId, { gatewayEventId: resourceId })
      console.log('[billing:webhook] subscription_preapproval', resourceId, result?.ok ? 'processed' : 'ignored', {
        ok: !!result?.ok,
        reason: result?.reason || null,
      })
      return res.status(200).json({ ok: true, processed: !!result?.ok, reason: result?.reason || null })
    }

    console.log('[billing:webhook] ignoring topic', topic || 'unknown', 'for resource', resourceId);
    return res.status(200).json({ ok: true, ignored: 'unsupported_topic', topic: topic || 'unknown' });
  } catch (error) {
    console.error('[billing:webhook] falha ao sincronizar', resourceId, error);
    // 200 pra evitar retries; o log já registra o problema
    return res.status(200).json({ ok: true, ignored: 'internal_error' });
  }
});

// Auxilia validações do painel do Mercado Pago (algumas checagens usam GET/HEAD)
router.get('/webhook', (req, res) => {
  return res.status(200).json({ ok: true, message: 'billing webhook up; send POST with Mercado Pago event body' })
})
router.head('/webhook', (req, res) => res.sendStatus(200))

// Health/diagnóstico do webhook: sinaliza se segredo está configurado e permite calcular assinatura esperada
router.get('/webhook/health', requireBillingWebhookHealthAccess, (req, res) => {
  const secretA = (config.billing?.mercadopago?.webhookSecret || '').trim()
  const secretB = (config.billing?.mercadopago?.webhookSecret2 || '').trim()
  const secrets = [secretA, secretB].filter(Boolean)
  const hasSecret = secrets.length > 0

  const id = String(req.query.id || req.query['data.id'] || '').trim()
  const requestId = String(req.query['request-id'] || req.query.request_id || '').trim()
  const ts = String(req.query.ts || '').trim()
  const topic = String(req.query.type || req.query.topic || '').trim()

  const base = {
    ok: true,
    signature_required: hasSecret,
    algorithm: 'HMAC-SHA256',
    header_format: "x-signature: ts=<unix>, v1=<hex>",
    uses_request_id: true,
  }

  if (!hasSecret) return res.status(200).json(base)

  if (id && ts) {
    try {
      const tsCandidates = [ts]
      if (/^\d{13,}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) / 1000)))
      if (/^\d{10}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) * 1000)))

      const results = secrets.map((sec, idx) => {
        const primary = (() => {
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${ts};`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${ts};`
          const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
          return { request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } }
        })()

        const alternatives = []
        for (const alt of tsCandidates) {
          if (alt === ts) continue
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${alt};`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${alt};`
          const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
          alternatives.push({ ts: alt, request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } })
        }
        return { index: idx, ...primary, alt_ts: alternatives }
      })
      return res.status(200).json({ ...base, provided: { id, request_id: requestId, topic, ts }, secrets: results, ts_candidates: tsCandidates })
    } catch (e) {
      return res.status(200).json({ ...base, error: 'failed_to_compute_signature', detail: e?.message || String(e) })
    }
  }

  return res.status(200).json(base)
})

// Recupera a última preferência PIX pendente (mesmo plano/ciclo) se ainda válida
router.get('/pix/pending', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = normalizePlanKey(req.query.plan || req.user.plan || 'starter')
    const billingCycle = normalizeBillingCycle(req.query.billing_cycle || req.query.cycle || req.user.plan_cycle || 'mensal')

    const pending = await findPendingPixSubscription(req.user.id, { plan, billingCycle })
    if (!pending) return res.status(404).json({ error: 'pending_pix_not_found' })

    console.info('[billing/pix/pending]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan,
      billing_cycle: billingCycle,
      preference_id: pending.gatewayPreferenceId,
    })

    let payment = null
    try {
      const sync = await syncMercadoPagoPayment(pending.gatewayPreferenceId)
      payment = sync?.payment || null
    } catch (err) {
      console.error('[billing/pix/pending] sync failed', err?.message || err)
    }

    const txData = payment?.point_of_interaction?.transaction_data || {}
    const expiresRaw = txData.expires_at || payment?.date_of_expiration || null
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null
    if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      console.info('[billing/pix/pending] expired preference', {
        user_id: req.user?.id,
        plan,
        billing_cycle: billingCycle,
        preference_id: pending.gatewayPreferenceId,
        expires_at: expiresAt.toISOString(),
      })
      return res.status(404).json({ error: 'pending_pix_not_found' })
    }
    const pixPayload = {
      payment_id: pending.gatewayPreferenceId,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
      expires_at: expiresRaw || null,
      amount_cents: pending.amountCents,
      plan: pending.plan,
      billing_cycle: pending.billingCycle,
    }

    // Se não tem QR/ticket, provavelmente expirou
    if (!pixPayload.qr_code && !pixPayload.ticket_url) {
      return res.status(404).json({ error: 'pending_pix_not_found' })
    }

    return res.json({
      ok: true,
      pix: pixPayload,
      subscription: serializeSubscription(pending),
    })
  } catch (error) {
    console.error('GET /billing/pix/pending', error)
    return res.status(500).json({ error: 'pix_pending_failed' })
  }
})

// Checkout exclusivo via PIX (link dinâmico do Mercado Pago)
router.post('/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const { plan, billing_cycle: rawCycle } = req.body || {}
    const targetPlan = String(plan || req.user.plan || 'starter').toLowerCase()
    if (!PLAN_TIERS.includes(targetPlan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plano inválido.' })
    }
    const billingCycle = normalizeBillingCycle(rawCycle)
    const currentPlan = String(req.user.plan || 'starter').toLowerCase()

    if (isDowngrade(currentPlan, targetPlan)) {
      const limits = resolvePlanConfig(targetPlan)
      const totalProfessionals = await countProfessionals(req.user.id)
      if (typeof limits.maxProfessionals === 'number' && totalProfessionals > limits.maxProfessionals) {
        return res.status(409).json({
          error: 'plan_limit_professionals',
          message: formatPlanLimitExceeded(limits, 'professionals') || 'Reduza a equipe antes de fazer downgrade.',
        })
      }
    }

    const result = await createMercadoPagoPixCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: targetPlan,
      billingCycle,
    })
    console.info('[billing/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan: targetPlan,
      billing_cycle: billingCycle,
      preference_id: result?.pix?.payment_id || result?.subscription?.gatewayPreferenceId || null,
    })
    // Alerta opcional por email (admin)
    try {
      const adminEmail =
        process.env.BILLING_ALERT_EMAIL ||
        process.env.NEW_USER_ALERT_EMAIL ||
        'servicos.negocios.digital@gmail.com'
      if (adminEmail) {
        const amountCents = result?.pix?.amount_cents ?? result?.subscription?.amount_cents ?? null
        const amountLabel =
          typeof amountCents === 'number'
            ? (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : 'N/D'
        const html = `
          <p>PIX gerado para assinatura.</p>
          <ul>
            <li>Usuário: ${req.user?.id || '-'} / ${req.user?.email || '-'}</li>
            <li>Plano: ${targetPlan}</li>
            <li>Ciclo: ${billingCycle}</li>
            <li>Pagamento/Preference ID: ${result?.pix?.payment_id || result?.subscription?.gatewayPreferenceId || 'N/D'}</li>
            <li>Valor: ${amountLabel}</li>
            <li>Data/hora: ${new Date().toLocaleString('pt-BR')}</li>
          </ul>
        `
        notifyEmail(adminEmail, '[AO] Log: PIX gerado', html)
      }
    } catch (err) {
      console.warn('[billing/pix/create][email_log] falhou', err?.message || err)
    }
    return res.json({
      ok: true,
      init_point: result.initPoint,
      plan_status: result.planStatus,
      subscription: serializeSubscription(result.subscription),
      pix: result.pix,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message || 'Falha ao criar cobrança PIX'
    console.error('POST /billing/pix', detail, cause || error)
    return res.status(400).json({ error: 'pix_failed', message: detail, cause })
  }
})

router.post('/renew/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const planContext = await getPlanContext(req.user.id)
    if (!planContext) {
      return res.status(404).json({ error: 'plan_context_not_found' })
    }
    const targetPlan = normalizePlanKey(planContext.plan || req.user.plan || 'starter') || 'starter'
    const targetCycle = normalizeBillingCycle(planContext.cycle || req.user.plan_cycle || 'mensal')

    const pending = await findPendingPixSubscription(req.user.id, { plan: targetPlan, billingCycle: targetCycle })
    if (pending) {
      const openPayment = await loadOpenPaymentFromSubscription(pending)
      if (openPayment && !isOpenPaymentExpired(openPayment)) {
        console.info('[billing/renew/pix/existing]', {
          user_id: req.user?.id,
          user_email: req.user?.email,
          estab_id: req.user?.id,
          plan: targetPlan,
          billing_cycle: targetCycle,
          preference_id: pending.gatewayPreferenceId,
        })
        return res.json({
          ok: true,
          renewal: { hasOpenPayment: true, openPayment },
          subscription: serializeSubscription(pending),
        })
      }
    }

    const result = await createMercadoPagoPixCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: targetPlan,
      billingCycle: targetCycle,
    })
    const newOpenPayment = formatOpenPaymentPayload({
      paymentId: result.pix?.payment_id || result.subscription?.gatewayPreferenceId || null,
      status: result.payment?.status || result.subscription?.status || 'pending',
      expiresAt: result.pix?.expires_at || null,
      qrCode: result.pix?.qr_code || null,
      qrCodeBase64: result.pix?.qr_code_base64 || null,
      copiaECola: result.pix?.copia_e_cola || result.pix?.qr_code || null,
      initPoint: result.initPoint || result.pix?.ticket_url || null,
      amountCents: result.pix?.amount_cents ?? result.subscription?.amountCents ?? null,
      plan: targetPlan,
      billingCycle: targetCycle,
    })

    console.info('[billing/renew/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan: targetPlan,
      billing_cycle: targetCycle,
      preference_id: result.pix?.payment_id || result.subscription?.gatewayPreferenceId || null,
    })

    return res.json({
      ok: true,
      renewal: { hasOpenPayment: true, openPayment: newOpenPayment },
      subscription: serializeSubscription(result.subscription),
    })
  } catch (error) {
    console.error('POST /billing/renew/pix', error)
    return res.status(500).json({ error: 'renewal_pix_failed' })
  }
})

router.get('/renew/pix/status', auth, isEstabelecimento, async (req, res) => {
  try {
    const paymentId = String(req.query.payment_id || '').trim()
    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' })
    }

    const result = await syncMercadoPagoPayment(paymentId)
    const payment = result?.payment || null
    const openPayment = formatOpenPaymentPayload({
      paymentId: payment?.id || paymentId,
      status: payment?.status || null,
      expiresAt: payment?.point_of_interaction?.transaction_data?.expires_at || payment?.date_of_expiration || null,
      qrCode: payment?.point_of_interaction?.transaction_data?.qr_code || null,
      qrCodeBase64: payment?.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      copiaECola:
        payment?.point_of_interaction?.transaction_data?.copia_e_cola ||
        payment?.point_of_interaction?.transaction_data?.qr_code ||
        null,
      initPoint: payment?.point_of_interaction?.transaction_data?.ticket_url || null,
      amountCents: payment?.transaction_amount ? Math.round(Number(payment.transaction_amount || 0) * 100) : null,
      plan: result?.subscription?.plan || null,
      billingCycle: result?.subscription?.billingCycle || null,
    })
    const statusNormalized = String(payment?.status || '').toLowerCase()
    const paid =
      !!statusNormalized &&
      (statusNormalized.includes('approved') || statusNormalized.includes('paid'))

    return res.json({
      ok: true,
      paid,
      status: payment?.status || null,
      payment_id: payment?.id || paymentId,
      openPayment,
      subscription: result?.subscription ? serializeSubscription(result.subscription) : null,
    })
  } catch (err) {
    console.error('GET /billing/renew/pix/status', err)
    return res.status(500).json({ error: 'renewal_status_failed' })
  }
})

export default router

// Manual test snippet (keep commented):
// parseMercadoPagoSignatureHeader('ts=1700000000,v1=abc') // => { ts: '1700000000', v1: 'abc' }
// parseMercadoPagoSignatureHeader('ts=1700000000, v1=abc') // => { ts: '1700000000', v1: 'abc' }
// parseMercadoPagoSignatureHeader('v1=abc,ts=1700000000') // => { ts: '1700000000', v1: 'abc' }
// const verification = verifyMercadoPagoWebhookSignature({
//   headers: { 'x-signature': 'ts=1700000000,v1=abc', 'x-request-id': 'req-123' },
//   query: { id: '123', topic: 'payment' },
//   body: {},
//   originalUrl: '/api/billing/webhook',
// })
// Expect: verification.ok === false when v1 does not match any configured secret.
