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
  getClientLoyaltySubscriptionByGatewayId,
  getClientLoyaltySubscriptionByGatewayPaymentId,
  getClientLoyaltySubscriptionById,
  getPreferredClientLoyaltySubscription,
  listClientLoyaltySubscriptionEvents,
  serializeClientLoyaltySubscription,
  updateClientLoyaltySubscription,
} from './client_loyalty_subscriptions.js'
import {
  ensureCreditsForCurrentCycle,
  formatCycleRef,
  listSubscriptionCredits,
} from './client_loyalty_credits.js'
import { getMpAccountByMpUserId, resolveMpAccessToken } from '../services/mpAccounts.js'

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
const DAY_MS = 86400000

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

function isApprovedGatewayPaymentStatus(status) {
  return status === 'approved' || status === 'paid'
}

function isFailedGatewayPaymentStatus(status) {
  return ['expired', 'canceled', 'cancelled', 'rejected', 'failed', 'refunded', 'charged_back'].includes(status)
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

function findLatestClientLoyaltyFailure(events = []) {
  const candidate = (Array.isArray(events) ? events : []).find((event) =>
    ['payment_failed', 'payment_expired'].includes(String(event?.tipo_evento || '').toLowerCase())
  )
  return candidate ? extractClientLoyaltyFailureFromEvent(candidate) : null
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
    `SELECT id, nome, email, telefone
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
      'Este estabelecimento ainda nao conectou uma conta Mercado Pago.',
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
    payload: rawPayload,
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
}, { db = pool } = {}) {
  await lockSubscriptionRow(subscriptionId, { db })
  const current = await getClientLoyaltySubscriptionById(subscriptionId, { db })
  if (!current) {
    throw createError('Assinatura de fidelidade não encontrada.', 404, 'client_loyalty_subscription_not_found')
  }

  const state = computeClientLoyaltySubscriptionState(current)
  const nextStatus = state.withinCurrentPeriod ? 'past_due' : 'expired'
  const graceUntil = nextStatus === 'past_due'
    ? new Date(Date.now() + CLIENT_LOYALTY_GRACE_DAYS * DAY_MS)
    : null

  const updated = await updateClientLoyaltySubscription(subscriptionId, {
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
      raw: rawPayload,
    },
  }, { db })

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
  db = pool,
  requestContext = {},
} = {}) {
  if (!cardToken) {
    throw createError('Token do cartão não informado.', 400, 'card_token_required')
  }

  const { plan, estabelecimento, cliente } = await resolveLoyaltyCheckoutContext(
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    { db }
  )
  const current = await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db })
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
          : 'Ja existe uma assinatura em andamento para este estabelecimento.',
        409,
        'client_loyalty_subscription_conflict'
      )
    }
    if (['pending_payment', 'past_due', 'unpaid', 'expired', 'canceled'].includes(state.resolvedStatus)) {
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
      payer: { email: payerEmail || cliente.email || null },
      reason: `${plan.nome} - ${estabelecimento.nome}`,
      backUrl: buildClientBackUrl(estabelecimentoId),
      externalReference,
      startDate: recurringStartDate,
      accessToken: mpAccess.accessToken,
      requestContext: {
        ...requestContext,
        operation: requestContext?.operation || 'client_loyalty_card_subscription_create',
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

  return { subscription, plan, estabelecimento, gatewayResult }
}

export async function createClientLoyaltyPixCheckout({
  clienteId,
  estabelecimentoId,
  loyaltyPlanId,
  db = pool,
} = {}) {
  const { plan, estabelecimento, cliente } = await resolveLoyaltyCheckoutContext(
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    { db }
  )
  const current = await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db })
  if (current) {
    const state = computeClientLoyaltySubscriptionState(current)
    if (state.benefitsActive) {
      throw createError(
        'Este plano ja esta ativo no ciclo atual.',
        409,
        'client_loyalty_subscription_active'
      )
    }
  }

  const subscription = await createClientLoyaltySubscription({
    clienteId,
    estabelecimentoId,
    loyaltyPlanId,
    ownerType: 'establishment',
    sellerMpAccountId: null,
    status: 'pending_pix',
    paymentMethod: 'pix',
    gateway: 'mercadopago',
    autoRenew: false,
  }, { db })

  const cycleRef = formatCycleRef(new Date())
  const externalReference = buildPixExternalReference({
    subscriptionId: subscription.id,
    estabelecimentoId,
    clienteId,
    loyaltyPlanId,
    cycleRef,
  })

  const mpAccess = await resolveActiveLoyaltyMpContext(estabelecimentoId)
  const sellerEventContext = buildSellerEventContext(mpAccess.account, estabelecimentoId)
  const paymentResult = await createMercadoPagoPixPayment({
    amountCents: Number(plan.preco_centavos || 0),
    description: `${plan.nome} - ${estabelecimento.nome}`,
    externalReference,
    metadata: {
      kind: 'loyalty_subscription_pix',
      loyalty_subscription_id: String(subscription.id),
      loyalty_plan_id: String(loyaltyPlanId),
      cliente_id: String(clienteId),
      estabelecimento_id: String(estabelecimentoId),
      cycle_ref: cycleRef,
    },
    notificationUrl: resolveSellerWebhookUrl(),
    payerEmail: cliente.email || null,
    accessToken: mpAccess.accessToken,
  })

  const updated = await updateClientLoyaltySubscription(subscription.id, {
    ownerType: 'establishment',
    sellerMpAccountId: mpAccess.account?.id || null,
    status: 'pending_pix',
    gatewayPaymentId: paymentResult?.payment?.id ? String(paymentResult.payment.id) : null,
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

  return {
    subscription: updated,
    plan,
    estabelecimento,
    pix: paymentResult.pix,
    payment: paymentResult.payment,
  }
}

async function resolveGatewayContextFromUserId(bodyUserId) {
  if (bodyUserId == null) return null
  const account = await getMpAccountByMpUserId(bodyUserId)
  if (!account?.estabelecimento_id) return null
  const mpAccess = await resolveMpAccessToken(account.estabelecimento_id, { allowFallback: false })
  if (!mpAccess?.accessToken) return null
  return {
    estabelecimentoId: Number(account.estabelecimento_id),
    accessToken: mpAccess.accessToken,
    account,
  }
}

export async function syncClientLoyaltyPixPaymentFromGateway(paymentId, {
  bodyUserId = null,
  gatewayEventId = null,
} = {}) {
  const existing = await getClientLoyaltySubscriptionByGatewayPaymentId(paymentId)
  let estabelecimentoId = existing?.estabelecimentoId || null
  let accessToken = null
  let sellerAccount = null

  if (estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
    accessToken = mpAccess?.accessToken || null
    sellerAccount = mpAccess?.account || sellerAccount
  }
  if (!accessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId)
    estabelecimentoId = gatewayContext?.estabelecimentoId || estabelecimentoId || null
    accessToken = gatewayContext?.accessToken || null
    sellerAccount = gatewayContext?.account || sellerAccount
  }
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const payment = await fetchMercadoPagoPayment(paymentId, { accessToken })
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
  const sellerEventContext = buildSellerEventContext(
    sellerAccount,
    localSubscription.estabelecimentoId || estabelecimentoId,
    {}
  )
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
      }, { db: conn })
      await conn.commit()
      return { ok: true, handled: true, status: updated.status, subscription: updated }
    }

    await updateClientLoyaltySubscription(localSubscription.id, {
      ownerType: 'establishment',
      sellerMpAccountId: sellerAccount?.id || localSubscription.sellerMpAccountId || null,
      status: 'pending_pix',
      gatewayPaymentId: payment?.id ? String(payment.id) : null,
      externalReference: payment?.external_reference || localSubscription.externalReference || null,
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

export async function syncClientLoyaltyCardSubscriptionFromGateway(gatewaySubscriptionId, {
  bodyUserId = null,
  gatewayEventId = null,
} = {}) {
  const localSubscription = await getClientLoyaltySubscriptionByGatewayId(gatewaySubscriptionId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  let accessToken = null
  let sellerAccount = null
  if (localSubscription.estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(localSubscription.estabelecimentoId, { allowFallback: false })
    accessToken = mpAccess?.accessToken || null
    sellerAccount = mpAccess?.account || sellerAccount
  }
  if (!accessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId)
    accessToken = gatewayContext?.accessToken || null
    sellerAccount = gatewayContext?.account || sellerAccount
  }
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackCycle: 'mensal',
    accessToken,
  })
  const gatewaySubscription = gatewayResult.subscription
  const sellerEventContext = buildSellerEventContext(sellerAccount, localSubscription.estabelecimentoId, {})
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
      sellerMpAccountId: sellerAccount?.id || localSubscription.sellerMpAccountId || null,
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
} = {}) {
  let accessToken = null
  let sellerAccount = null
  const existingByPayment = await getClientLoyaltySubscriptionByGatewayPaymentId(authorizedPaymentId)
  if (existingByPayment?.estabelecimentoId) {
    const mpAccess = await resolveMpAccessToken(existingByPayment.estabelecimentoId, { allowFallback: false })
    accessToken = mpAccess?.accessToken || null
    sellerAccount = mpAccess?.account || sellerAccount
  }
  if (!accessToken) {
    const gatewayContext = await resolveGatewayContextFromUserId(bodyUserId)
    accessToken = gatewayContext?.accessToken || null
    sellerAccount = gatewayContext?.account || sellerAccount
  }
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing' }
  }

  const paymentResult = await getMercadoPagoAuthorizedPayment(authorizedPaymentId, { accessToken })
  const authorizedPayment = paymentResult.authorizedPayment
  if (!authorizedPayment?.preapprovalId) {
    return { ok: false, reason: 'preapproval_not_found' }
  }

  const localSubscription = await getClientLoyaltySubscriptionByGatewayId(authorizedPayment.preapprovalId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(authorizedPayment.preapprovalId, {
    fallbackCycle: 'mensal',
    accessToken,
  })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const sellerEventContext = buildSellerEventContext(sellerAccount, localSubscription.estabelecimentoId, {})
    const amountCents = authorizedPayment.amountCents != null
      ? Number(authorizedPayment.amountCents || 0)
      : null
    if (authorizedPayment.status === 'active') {
      const activated = await activateSubscriptionCycleTx(localSubscription.id, {
        paymentDate: authorizedPayment.paidAt || new Date(),
        gatewayPaymentId: authorizedPayment.id || null,
        gatewaySubscriptionId: authorizedPayment.preapprovalId || null,
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

    const failureDetails = extractGatewayFailureDetails(
      { payment: paymentResult.raw, subscription: gatewayResult.raw },
      authorizedPayment.rawStatus || authorizedPayment.status || null
    )
    console.warn('[client-loyalty][authorized-payment] failed', {
      subscription_id: localSubscription.id,
      authorized_payment_id: authorizedPayment.id || authorizedPaymentId,
      gateway_subscription_id: authorizedPayment.preapprovalId || null,
      status: failureDetails?.status || authorizedPayment.rawStatus || authorizedPayment.status || null,
      status_detail: failureDetails?.status_detail || authorizedPayment.statusDetail || null,
      rejection_code: failureDetails?.code || null,
      rejection_description: failureDetails?.description || null,
      message: failureDetails?.message || null,
    })

    const updated = await markSubscriptionPastDueTx(localSubscription.id, {
      paymentStatus: authorizedPayment.status || null,
      gatewayPaymentId: authorizedPayment.id || null,
      gatewaySubscriptionId: authorizedPayment.preapprovalId || null,
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
    }, { db: conn })
    await conn.commit()
    return { ok: true, handled: true, status: updated.status, subscription: updated, failure: failureDetails }
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
  const latestFailure = findLatestClientLoyaltyFailure(events)

  return {
    subscription: serializeClientLoyaltySubscription(subscription),
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
    latest_failure: latestFailure,
  }
}
