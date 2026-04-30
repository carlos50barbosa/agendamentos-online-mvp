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
  getSubscriptionByGatewayPaymentId,
  getSubscriptionByExternalReference,
  getSubscriptionEventByGatewayEventId,
  listSubscriptionEventsBySubscriptionId,
  listSubscriptionsForEstabelecimento,
  listSubscriptionEventsForEstabelecimento,
  serializeSubscription,
  createSubscription,
  updateSubscription,
  appendSubscriptionEvent,
} from '../lib/subscriptions.js'
import {
  listClientLoyaltyAuthorizedPaymentProbeCandidates,
  getClientLoyaltySubscriptionByExternalReference,
  getClientLoyaltySubscriptionByEventResourceId,
  getClientLoyaltySubscriptionByGatewayId,
  getClientLoyaltySubscriptionByGatewayPaymentId,
  getClientLoyaltySubscriptionByWebhookResourceId,
} from '../lib/client_loyalty_subscriptions.js'
import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'
import { getClientIp } from '../lib/client_ip.js'
import { BillingService } from '../lib/billing_service.js'
import { listActiveWhatsAppPacks, findWhatsAppPack } from '../lib/addon_packs.js'
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js'
import { getMercadoPagoCredentialDiagnostics, toMercadoPagoCardFlowError } from '../lib/mercadopago_card_tokens.js'
import {
  getMpAccountByEstabelecimentoId,
  getMpAccountBySellerIdentifier,
  resolveMpAccessToken,
} from '../services/mpAccounts.js'
import { logBlockedRouteAccess, resolveRouteTokenAccess } from '../lib/route_access.js'
import { loadEffectiveSubscriptionContext } from '../lib/subscription_state.js'
import { normalizeSubscriptionStatus } from '../lib/subscription_normalization.js'
import {
  appendUpgradeCreditEventsTx,
  applyReservedSubscriptionCreditApplicationsTx,
  applyScheduledDiscountForSubscriptionPaymentTx,
  createUpgradeProrationCreditTx,
  findUpgradeSourceSubscription,
  getAvailableSubscriptionCreditTotals,
  getSubscriptionCreditOverview,
  releaseReservedSubscriptionCreditApplicationsTx,
  releaseScheduledSubscriptionCreditApplicationsTx,
  reserveSubscriptionCreditApplicationsTx,
  scheduleSubscriptionCreditsForCardTx,
} from '../lib/subscription_credits.js'
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
  resolveClientLoyaltyPaymentMatch,
  syncClientLoyaltyPaymentFromGateway,
  syncClientLoyaltyAuthorizedPaymentFromGateway,
  syncClientLoyaltyCardSubscriptionFromGateway,
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

function normalizeWebhookNumericUserId(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveBillingWebhookBodyUserId(req, event = {}) {
  return normalizeWebhookNumericUserId(
    req?.query?.user_id ??
    event?.user_id ??
    event?.userId ??
    event?.data?.user_id ??
    null
  )
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
  return getClientIp(req)
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

function normalizeBillingWebhookTopic(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'payment') return 'payment'
  if (['subscription_preapproval', 'subscription', 'preapproval'].includes(normalized)) {
    return 'subscription_preapproval'
  }
  if (['subscription_authorized_payment', 'automatic-payments', 'automatic_payment'].includes(normalized)) {
    return 'subscription_authorized_payment'
  }
  return normalized
}

function isSubscriptionWebhookTopic(topic) {
  return topic === 'subscription_preapproval' || topic === 'subscription_authorized_payment'
}

function topicToSyncTarget(topic) {
  if (topic === 'payment') return 'payment'
  if (topic === 'subscription_authorized_payment') return 'authorized_payment'
  if (topic === 'subscription_preapproval') return 'subscription'
  return null
}

function resolveWebhookExternalReference(event = {}) {
  return String(
    event?.external_reference ||
    event?.externalReference ||
    event?.metadata?.external_reference ||
    event?.metadata?.externalReference ||
    ''
  ).trim() || null
}

function resolveWebhookMetadataPreapprovalId(event = {}) {
  return String(
    event?.metadata?.preapproval_id ||
    event?.metadata?.preapprovalId ||
    event?.metadata?.subscription_id ||
    event?.metadata?.subscriptionId ||
    event?.preapproval_id ||
    event?.preapprovalId ||
    event?.data?.preapproval_id ||
    event?.data?.preapprovalId ||
    ''
  ).trim() || null
}

function inferWebhookMatchedFlow({
  event = {},
  normalizedUserId = null,
  topic = null,
} = {}) {
  const normalizedTopic = normalizeBillingWebhookTopic(topic || event?.type || event?.topic || '')
  const metadataType = String(event?.metadata?.type || event?.metadata?.kind || '').trim().toLowerCase()
  const externalReference = resolveWebhookExternalReference(event)
  if (metadataType === 'deposit' || /^dep:ag:\d+:pay:\d+:est:\d+/i.test(String(externalReference || ''))) {
    return 'deposit'
  }
  if (Number.isFinite(normalizedUserId) && normalizedUserId !== MP_COLLECTOR_ID) return 'loyalty'
  if (isSubscriptionWebhookTopic(normalizedTopic) && !Number.isFinite(normalizedUserId)) return null
  return 'platform_saas'
}

function resolveBillingWebhookSyncDecision({
  req,
  event = {},
  bodyUserId = null,
  bodyType = null,
  bodyAction = null,
} = {}) {
  const queryTopic = normalizeBillingWebhookTopic(req?.query?.type || req?.query?.topic || '')
  const bodyTopic = normalizeBillingWebhookTopic(bodyType || event?.type || event?.topic || '')
  const headerTopic = normalizeBillingWebhookTopic(req?.headers?.['x-topic'] || '')
  const normalizedAction = String(bodyAction || event?.action || '').trim().toLowerCase()
  const normalizedUserId = normalizeWebhookNumericUserId(bodyUserId)
  const inferredTopic = bodyTopic || queryTopic || headerTopic || ''
  const ownerType = Number.isFinite(normalizedUserId)
    ? (normalizedUserId !== MP_COLLECTOR_ID ? 'establishment' : 'platform')
    : (isSubscriptionWebhookTopic(inferredTopic) ? null : 'platform')
  const matchedFlow = inferWebhookMatchedFlow({ event, normalizedUserId, topic: inferredTopic })

  const bodySyncTarget = topicToSyncTarget(bodyTopic)
  const querySyncTarget = topicToSyncTarget(queryTopic)
  const headerSyncTarget = topicToSyncTarget(headerTopic)
  const topicsConflict = Boolean(bodyTopic && queryTopic && bodyTopic !== queryTopic)

  let topic = bodyTopic || queryTopic || headerTopic || ''
  let chosenSyncTarget = null
  let chosenByRule = 'unsupported_topic'

  if (bodySyncTarget) {
    topic = bodyTopic
    chosenSyncTarget = bodySyncTarget
    chosenByRule = topicsConflict
      ? `body_topic_overrides_query_topic:${bodyTopic}<-${queryTopic}`
      : 'body_topic'
  } else if (querySyncTarget) {
    topic = queryTopic
    chosenSyncTarget = querySyncTarget
    chosenByRule = 'query_topic_fallback'
  } else if (headerSyncTarget) {
    topic = headerTopic
    chosenSyncTarget = headerSyncTarget
    chosenByRule = 'header_topic_fallback'
  } else if (normalizedAction.startsWith('payment.')) {
    topic = 'payment'
    chosenSyncTarget = 'payment'
    chosenByRule = 'body_action_payment_fallback'
  }

  const chosenEndpoint =
    chosenSyncTarget === 'payment'
      ? '/v1/payments/{id}'
      : chosenSyncTarget === 'authorized_payment'
        ? '/authorized_payments/{id}'
        : chosenSyncTarget === 'subscription'
          ? '/preapproval/{id}'
          : null

  return {
    topic: topic || null,
    queryTopic: queryTopic || null,
    bodyTopic: bodyTopic || null,
    headerTopic: headerTopic || null,
    bodyAction: normalizedAction || null,
    bodyUserId,
    normalizedUserId: Number.isFinite(normalizedUserId) ? normalizedUserId : null,
    ownerType,
    matchedFlow,
    chosenSyncTarget,
    chosenByRule,
    chosenEndpoint,
    topicsConflict,
  }
}

function logBillingWebhookSyncDecision({
  requestId = null,
  resourceId = null,
  decision,
  bodyType = null,
  bodyAction = null,
  event = {},
  ownerResolution = null,
} = {}) {
  const payload = {
    request_id: requestId || null,
    topic: decision?.topic || null,
    query_topic: decision?.queryTopic || null,
    body_topic: decision?.bodyTopic || null,
    body_type: bodyType || null,
    body_action: bodyAction || null,
    resource_id: resourceId || null,
    external_reference: resolveWebhookExternalReference(event),
    metadata_preapproval_id: resolveWebhookMetadataPreapprovalId(event),
    owner_type: ownerResolution?.ownerType || decision?.ownerType || null,
    matched_flow: ownerResolution?.matchedFlow || decision?.matchedFlow || null,
    chosen_sync_target: decision?.chosenSyncTarget || null,
    chosen_by_rule: decision?.chosenByRule || null,
    chosen_endpoint: decision?.chosenEndpoint || null,
  }
  console.info('[billing:webhook] sync_target_selected', payload)

  if (decision?.topicsConflict || (decision?.topic === 'payment' && decision?.chosenSyncTarget === 'authorized_payment')) {
    console.warn('[billing:webhook] sync_target_mismatch', {
      ...payload,
      mismatch_reason: decision?.topicsConflict
        ? 'body_query_topic_conflict'
        : 'payment_topic_routed_to_authorized_payment',
    })
  }
}

function buildBillingWebhookSellerLogPayload({
  requestId = null,
  resourceId = null,
  syncDecision,
  bodyType = null,
  bodyAction = null,
  bodyUserId = null,
  connectedAccount = null,
  matchedFlow = null,
  actionTaken = null,
  reason = null,
  depositReason = null,
  loyaltyReason = null,
} = {}) {
  const estabelecimentoId = connectedAccount?.estabelecimento_id || connectedAccount?.estabelecimentoId || null
  return {
    request_id: requestId || null,
    resource_id: resourceId || null,
    topic: syncDecision?.topic || null,
    body_type: bodyType || null,
    body_action: bodyAction || null,
    body_user_id: bodyUserId ?? null,
    platform_user_id: MP_COLLECTOR_ID,
    connected_account_found: Boolean(estabelecimentoId),
    connected_estabelecimento_id: estabelecimentoId,
    estabelecimento_id: estabelecimentoId,
    owner_type: estabelecimentoId ? 'establishment' : null,
    matched_flow: matchedFlow || null,
    chosen_sync_target: syncDecision?.chosenSyncTarget || null,
    chosen_by_rule: syncDecision?.chosenByRule || null,
    action_taken: actionTaken || null,
    reason: reason || null,
    deposit_reason: depositReason || null,
    loyalty_reason: loyaltyReason || null,
  }
}

function buildBillingWebhookSellerFlowMatchPayload({
  requestId = null,
  resourceId = null,
  syncDecision,
  bodyType = null,
  bodyAction = null,
  bodyUserId = null,
  connectedAccount = null,
  matchedFlow = null,
  flowMatch = null,
} = {}) {
  const estabelecimentoId = connectedAccount?.estabelecimento_id || connectedAccount?.estabelecimentoId || null
  return {
    request_id: requestId || null,
    resource_id: resourceId || null,
    topic: syncDecision?.topic || null,
    body_type: bodyType || null,
    body_action: bodyAction || null,
    body_user_id: bodyUserId ?? null,
    estabelecimento_id: estabelecimentoId,
    owner_type: estabelecimentoId ? 'establishment' : null,
    payment_status: flowMatch?.paymentStatus || null,
    operation_type: flowMatch?.operationType || null,
    external_reference: flowMatch?.externalReference || null,
    metadata_preapproval_id: flowMatch?.metadataPreapprovalId || null,
    poi_type: flowMatch?.poiType || null,
    subscription_id: flowMatch?.subscriptionId || null,
    deposit_match: flowMatch?.depositMatch === true,
    loyalty_match: flowMatch?.loyaltyMatch === true,
    matched_flow: matchedFlow || flowMatch?.matchedFlow || null,
    match_rule: flowMatch?.matchRule || null,
    deposit_reason: flowMatch?.depositReason || null,
    loyalty_reason: flowMatch?.loyaltyReason || null,
  }
}

function normalizeSellerPaymentMatchFailureCodes(failureCodes = []) {
  const normalized = []
  const seen = new Set()
  for (const item of Array.isArray(failureCodes) ? failureCodes : []) {
    const value = String(item || '').trim().toLowerCase()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }
  return normalized
}

function logSellerPaymentMatchFailures(payload = {}, flowMatch = null) {
  for (const code of normalizeSellerPaymentMatchFailureCodes(flowMatch?.loyaltyMatchContext?.failureCodes || [])) {
    console.warn(`[billing:webhook] loyalty_payment_match_failed_${code}`, payload)
  }
}

function normalizeMercadoPagoPaymentString(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function normalizeMercadoPagoPaymentAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function resolveMercadoPagoPaymentMetadataPreapprovalId(payment = {}) {
  const metadata = payment?.metadata || {}
  return normalizeMercadoPagoPaymentString(
    metadata.preapproval_id ||
    metadata.preapprovalId ||
    metadata.mp_preapproval_id ||
    metadata.mpPreapprovalId ||
    metadata.subscription_id ||
    metadata.subscriptionId ||
    payment?.preapproval_id ||
    payment?.preapprovalId
  )
}

function resolveMercadoPagoPaymentSubscriptionId(payment = {}) {
  const transactionData = payment?.point_of_interaction?.transaction_data || {}
  return normalizeMercadoPagoPaymentString(
    payment?.subscription_id ||
    payment?.subscriptionId ||
    transactionData.subscription_id ||
    transactionData.subscriptionId
  )
}

function resolveMercadoPagoCardValidationMatch({
  paymentStatus = null,
  operationType = null,
  transactionAmount = null,
  externalReference = null,
  metadataPreapprovalId = null,
  subscriptionId = null,
} = {}) {
  if (operationType === 'card_validation') {
    return {
      matched: true,
      matchRule: 'operation_type_card_validation',
    }
  }

  if (
    paymentStatus === 'approved' &&
    transactionAmount === 0 &&
    !externalReference &&
    !metadataPreapprovalId &&
    !subscriptionId
  ) {
    return {
      matched: true,
      matchRule: 'approved_zero_amount_without_business_linkage',
    }
  }

  return {
    matched: false,
    matchRule: null,
  }
}

function buildBillingWebhookOwnerResolutionPayload({
  requestId = null,
  resourceId = null,
  syncDecision = null,
  bodyType = null,
  bodyAction = null,
  bodyUserId = null,
  event = {},
  ownerResolution = null,
} = {}) {
  return {
    request_id: requestId || null,
    topic: syncDecision?.topic || null,
    body_type: bodyType || null,
    body_action: bodyAction || null,
    resource_id: resourceId || null,
    body_user_id: bodyUserId ?? null,
    body_user_estabelecimento_id:
      ownerResolution?.sellerAccount?.estabelecimento_id ||
      ownerResolution?.sellerAccount?.estabelecimentoId ||
      null,
    platform_user_id: MP_COLLECTOR_ID,
    metadata_preapproval_id: ownerResolution?.metadataPreapprovalId || resolveWebhookMetadataPreapprovalId(event),
    external_reference: ownerResolution?.externalReference || resolveWebhookExternalReference(event),
    resolved_owner_type: ownerResolution?.ownerType || null,
    resolved_estabelecimento_id: ownerResolution?.estabelecimentoId || null,
    resolved_mp_user_id: ownerResolution?.mpUserId || null,
    resolved_collector_id: ownerResolution?.mpCollectorId || null,
    matched_flow: ownerResolution?.matchedFlow || null,
    chosen_sync_target: syncDecision?.chosenSyncTarget || null,
    chosen_endpoint: syncDecision?.chosenEndpoint || null,
    token_source: ownerResolution?.tokenSource || null,
    lookup_by: ownerResolution?.lookupBy || null,
    resolution_rule: ownerResolution?.resolutionRule || null,
    resolution_reason: ownerResolution?.reason || null,
    failed_lookups: normalizeOwnerResolutionFailedLookups(ownerResolution?.failedLookups),
    conflict: ownerResolution?.conflict || null,
  }
}

function normalizeOwnerResolutionFailedLookups(failedLookups = []) {
  const list = Array.isArray(failedLookups) ? failedLookups : []
  const normalized = []
  const seen = new Set()
  for (const item of list) {
    const lookupBy = String(item?.lookupBy || '').trim().toLowerCase()
    if (!lookupBy) continue
    const reason = String(item?.reason || '').trim().toLowerCase() || null
    const key = `${lookupBy}:${reason || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ lookupBy, reason })
  }
  return normalized
}

function decorateWebhookOwnerResolution(resolution, {
  metadataPreapprovalId = null,
  externalReference = null,
  failedLookups = [],
} = {}) {
  if (!resolution) return null
  return {
    ...resolution,
    metadataPreapprovalId: resolution.metadataPreapprovalId || metadataPreapprovalId || null,
    externalReference: resolution.externalReference || externalReference || null,
    failedLookups: normalizeOwnerResolutionFailedLookups([
      ...(Array.isArray(resolution.failedLookups) ? resolution.failedLookups : []),
      ...failedLookups,
    ]),
  }
}

function logAuthorizedPaymentLookupFailures(payload = {}, ownerResolution = null) {
  const failedLookups = normalizeOwnerResolutionFailedLookups(ownerResolution?.failedLookups)
  for (const failure of failedLookups) {
    const lookupBy = String(failure.lookupBy || '').trim().toLowerCase()
    if (!lookupBy) continue
    console.warn(`[billing:webhook] authorized_payment_lookup_failed_by_${lookupBy}`, {
      ...payload,
      lookup_by: lookupBy,
      failed_lookup_reason: failure.reason || null,
    })
  }
}

function buildUnresolvedWebhookOwnerResolution({
  normalizedUserId = null,
  lookupBy = null,
  resolutionRule = 'no_confident_owner',
  reason,
  fallbackBlocked = true,
} = {}) {
  return {
    ok: false,
    ownerType: null,
    matchedFlow: null,
    tokenSource: null,
    lookupBy,
    resolutionRule,
    reason,
    fallbackBlocked,
    bodyUserId: normalizedUserId,
    estabelecimentoId: null,
    mpUserId: null,
    mpCollectorId: null,
    sellerAccount: null,
    accessToken: null,
  }
}

function buildPlatformWebhookOwnerResolution({
  normalizedUserId = null,
  lookupBy = null,
  resolutionRule = null,
  platformAccessToken = config.billing?.mercadopago?.accessToken || null,
  unresolvedReason = 'unresolved_owner_for_authorized_payment',
} = {}) {
  return {
    ok: Boolean(platformAccessToken),
    ownerType: 'platform',
    matchedFlow: 'platform_saas',
    tokenSource: 'platform',
    lookupBy,
    resolutionRule,
    reason: platformAccessToken ? null : unresolvedReason,
    fallbackBlocked: !platformAccessToken,
    bodyUserId: normalizedUserId,
    estabelecimentoId: null,
    mpUserId: String(MP_COLLECTOR_ID),
    mpCollectorId: String(MP_COLLECTOR_ID),
    sellerAccount: null,
    accessToken: platformAccessToken || null,
  }
}

function buildConflictingWebhookOwnerResolution({
  normalizedUserId = null,
  lookupBy = 'event_linkage',
  conflict = null,
} = {}) {
  return {
    ...buildUnresolvedWebhookOwnerResolution({
      normalizedUserId,
      lookupBy,
      resolutionRule: 'conflicting_owner_resolution',
      reason: 'conflicting_owner_resolution',
      fallbackBlocked: true,
    }),
    conflict,
  }
}

async function finalizeSellerWebhookOwnerResolution({
  sellerAccount = null,
  normalizedUserId = null,
  matchedFlow = 'loyalty',
  lookupBy = null,
  resolutionRule = null,
  unresolvedReason = 'unresolved_owner_for_authorized_payment',
  resolveEstablishmentAccessToken = resolveMpAccessToken,
} = {}) {
  const estabelecimentoId = Number(
    sellerAccount?.estabelecimento_id ||
    sellerAccount?.estabelecimentoId ||
    0
  ) || null

  if (!estabelecimentoId) {
    return buildUnresolvedWebhookOwnerResolution({
      normalizedUserId,
      lookupBy,
      resolutionRule,
      reason: unresolvedReason,
    })
  }

  const mpAccess = await resolveEstablishmentAccessToken(estabelecimentoId, { allowFallback: false })
  if (!mpAccess?.accessToken) {
    return {
      ok: false,
      ownerType: 'establishment',
      matchedFlow,
      tokenSource: 'establishment',
      lookupBy,
      resolutionRule,
      reason: 'seller_account_found_but_no_valid_token',
      fallbackBlocked: true,
      bodyUserId: normalizedUserId,
      estabelecimentoId,
      mpUserId: sellerAccount?.mp_user_id || sellerAccount?.mpUserId || null,
      mpCollectorId:
        sellerAccount?.mp_collector_id ||
        sellerAccount?.mpCollectorId ||
        sellerAccount?.mp_user_id ||
        sellerAccount?.mpUserId ||
        null,
      sellerAccount,
      accessToken: null,
    }
  }

  const resolvedAccount = mpAccess?.account || sellerAccount
  return {
    ok: true,
    ownerType: 'establishment',
    matchedFlow,
    tokenSource: 'establishment',
    lookupBy,
    resolutionRule,
    reason: null,
    fallbackBlocked: false,
    bodyUserId: normalizedUserId,
    estabelecimentoId,
    mpUserId: resolvedAccount?.mp_user_id || resolvedAccount?.mpUserId || null,
    mpCollectorId:
      resolvedAccount?.mp_collector_id ||
      resolvedAccount?.mpCollectorId ||
      resolvedAccount?.mp_user_id ||
      resolvedAccount?.mpUserId ||
      null,
    sellerAccount: resolvedAccount,
    accessToken: mpAccess.accessToken,
  }
}

async function findSubscriptionLoyaltyLink({
  resourceId = null,
  preapprovalId = null,
  externalReference = null,
  getByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
} = {}) {
  const preapprovalCandidates = [...new Set(
    [preapprovalId, resourceId]
      .filter(Boolean)
      .map((value) => String(value))
  )]

  for (const candidate of preapprovalCandidates) {
    const subscription = await getByGatewayId(candidate)
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'mp_preapproval_id',
        resolutionRule: 'loyalty_preapproval_linkage',
      }
    }
  }

  if (externalReference) {
    const subscription = await getByExternalReference(String(externalReference))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'external_reference',
        resolutionRule: 'loyalty_preapproval_linkage',
      }
    }
  }

  if (resourceId) {
    const subscription = await getByEventResourceId(String(resourceId), { mpTopic: 'subscription' })
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'event_linkage',
        resolutionRule: 'loyalty_preapproval_linkage',
      }
    }
  }

  if (resourceId) {
    const subscription = await getByWebhookResourceId(String(resourceId), { topic: 'subscription' })
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'event_linkage',
        resolutionRule: 'loyalty_preapproval_linkage',
      }
    }
  }

  return null
}

async function findSubscriptionPlatformLink({
  resourceId = null,
  preapprovalId = null,
  externalReference = null,
  getByGatewayId = getSubscriptionByGatewayId,
  getByExternalReference = getSubscriptionByExternalReference,
} = {}) {
  const preapprovalCandidates = [...new Set(
    [preapprovalId, resourceId]
      .filter(Boolean)
      .map((value) => String(value))
  )]

  for (const candidate of preapprovalCandidates) {
    const subscription = await getByGatewayId(candidate)
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'mp_preapproval_id',
        resolutionRule: 'platform_subscription_linkage',
      }
    }
  }

  if (externalReference) {
    const subscription = await getByExternalReference(String(externalReference))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'external_reference',
        resolutionRule: 'platform_subscription_linkage',
      }
    }
  }

  return null
}

async function findAuthorizedPaymentLoyaltyLink({
  resourceId = null,
  preapprovalId = null,
  externalReference = null,
  preapprovalLookupBy = 'metadata_preapproval_id',
  getByGatewayPaymentId = getClientLoyaltySubscriptionByGatewayPaymentId,
  getByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
} = {}) {
  const failedLookups = []

  if (resourceId) {
    const subscription = await getByGatewayPaymentId(String(resourceId))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'authorized_payment_id',
        resolutionRule: 'loyalty_authorized_payment_linkage',
        failedLookups,
      }
    }
    failedLookups.push({ lookupBy: 'authorized_payment_id', reason: 'subscription_not_found' })
  }

  if (preapprovalId) {
    const subscription = await getByGatewayId(String(preapprovalId))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: preapprovalLookupBy,
        resolutionRule: 'loyalty_authorized_payment_linkage',
        failedLookups,
      }
    }
    failedLookups.push({ lookupBy: preapprovalLookupBy, reason: 'subscription_not_found' })
  }

  if (externalReference) {
    const subscription = await getByExternalReference(String(externalReference))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'external_reference',
        resolutionRule: 'loyalty_authorized_payment_linkage',
        failedLookups,
      }
    }
    failedLookups.push({ lookupBy: 'external_reference', reason: 'subscription_not_found' })
  }

  if (resourceId) {
    const subscription = await getByEventResourceId(String(resourceId), {
      mpTopic: 'automatic-payments',
      paymentType: 'subscription_authorized_payment',
    })
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'event_linkage',
        resolutionRule: 'loyalty_authorized_payment_linkage',
        failedLookups,
      }
    }
    failedLookups.push({ lookupBy: 'event_linkage', reason: 'subscription_not_found' })
  }

  if (resourceId) {
    const subscription = await getByWebhookResourceId(String(resourceId), { topic: 'automatic-payments' })
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'event_linkage',
        resolutionRule: 'loyalty_authorized_payment_linkage',
        failedLookups,
      }
    }
    failedLookups.push({ lookupBy: 'webhook_linkage', reason: 'subscription_not_found' })
  }

  return { subscription: null, failedLookups }
}

async function findAuthorizedPaymentPlatformLink({
  resourceId = null,
  preapprovalId = null,
  externalReference = null,
  preapprovalLookupBy = 'metadata_preapproval_id',
  getByGatewayPaymentId = getSubscriptionByGatewayPaymentId,
  getByGatewayId = getSubscriptionByGatewayId,
  getByExternalReference = getSubscriptionByExternalReference,
} = {}) {
  if (resourceId) {
    const subscription = await getByGatewayPaymentId(String(resourceId))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'authorized_payment_id',
        resolutionRule: 'platform_authorized_payment_linkage',
      }
    }
  }

  if (preapprovalId) {
    const subscription = await getByGatewayId(String(preapprovalId))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: preapprovalLookupBy,
        resolutionRule: 'platform_authorized_payment_linkage',
      }
    }
  }

  if (externalReference) {
    const subscription = await getByExternalReference(String(externalReference))
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'external_reference',
        resolutionRule: 'platform_authorized_payment_linkage',
      }
    }
  }

  return null
}

async function probeAuthorizedPaymentLoyaltyLink({
  resourceId = null,
  getAuthorizedPayment = getMercadoPagoAuthorizedPayment,
  listProbeCandidates = listClientLoyaltyAuthorizedPaymentProbeCandidates,
  resolveEstablishmentAccessToken = resolveMpAccessToken,
  getByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getByExternalReference = getClientLoyaltySubscriptionByExternalReference,
} = {}) {
  const failedLookups = []
  if (!resourceId) {
    return { subscription: null, failedLookups }
  }

  const candidates = await listProbeCandidates({ limit: 50 })
  if (!Array.isArray(candidates) || !candidates.length) {
    failedLookups.push({ lookupBy: 'loyalty_subscription_linkage', reason: 'no_probe_candidates' })
    return { subscription: null, failedLookups }
  }

  const matches = []
  for (const candidate of candidates) {
    const estabelecimentoId = Number(candidate?.estabelecimentoId || 0) || null
    if (!estabelecimentoId) continue

    const mpAccess = await resolveEstablishmentAccessToken(estabelecimentoId, { allowFallback: false })
    if (!mpAccess?.accessToken) continue

    let paymentResult = null
    try {
      paymentResult = await getAuthorizedPayment(String(resourceId), { accessToken: mpAccess.accessToken })
    } catch {
      continue
    }

    const authorizedPayment = paymentResult?.authorizedPayment || null
    const metadataPreapprovalId = String(authorizedPayment?.preapprovalId || '').trim() || null
    const gatewayExternalReference = String(authorizedPayment?.externalReference || '').trim() || null
    let subscription = null
    let matchedBy = null

    if (metadataPreapprovalId) {
      subscription = await getByGatewayId(metadataPreapprovalId)
      if (subscription?.id) matchedBy = 'metadata_preapproval_id'
      else failedLookups.push({ lookupBy: 'metadata_preapproval_id', reason: 'subscription_not_found' })
    }

    if (!subscription && gatewayExternalReference) {
      subscription = await getByExternalReference(gatewayExternalReference)
      if (subscription?.id) matchedBy = 'external_reference'
      else failedLookups.push({ lookupBy: 'external_reference', reason: 'subscription_not_found' })
    }

    if (!subscription) {
      failedLookups.push({
        lookupBy: 'loyalty_subscription_linkage',
        reason: metadataPreapprovalId || gatewayExternalReference
          ? 'probe_linkage_not_found'
          : 'probe_payload_missing_linkage',
      })
      continue
    }

    matches.push({
      subscription,
      sellerAccount: mpAccess.account || null,
      accessToken: mpAccess.accessToken,
      metadataPreapprovalId,
      externalReference: gatewayExternalReference,
      matchedBy,
    })
  }

  if (!matches.length) {
    failedLookups.push({ lookupBy: 'loyalty_subscription_linkage', reason: 'authorized_payment_not_accessible_with_known_seller_tokens' })
    return { subscription: null, failedLookups }
  }

  const uniqueMatches = matches.filter((match, index, list) => (
    list.findIndex((item) => (
      Number(item.subscription?.estabelecimentoId || 0) === Number(match.subscription?.estabelecimentoId || 0) &&
      Number(item.subscription?.id || 0) === Number(match.subscription?.id || 0)
    )) === index
  ))

  if (uniqueMatches.length > 1) {
    return {
      conflict: {
        loyalty_subscription_ids: uniqueMatches.map((match) => Number(match.subscription?.id || 0)).filter(Boolean),
        loyalty_estabelecimento_ids: uniqueMatches.map((match) => Number(match.subscription?.estabelecimentoId || 0)).filter(Boolean),
      },
      failedLookups,
    }
  }

  return {
    ...uniqueMatches[0],
    lookupBy: 'loyalty_subscription_linkage',
    resolutionRule: 'loyalty_authorized_payment_linkage',
    failedLookups,
  }
}

async function probeAuthorizedPaymentPlatformLink({
  resourceId = null,
  platformAccessToken = config.billing?.mercadopago?.accessToken || null,
  getAuthorizedPayment = getMercadoPagoAuthorizedPayment,
  getByGatewayId = getSubscriptionByGatewayId,
  getByExternalReference = getSubscriptionByExternalReference,
} = {}) {
  if (!resourceId || !platformAccessToken) return null

  let paymentResult = null
  try {
    paymentResult = await getAuthorizedPayment(String(resourceId), { accessToken: platformAccessToken })
  } catch {
    return null
  }

  const authorizedPayment = paymentResult?.authorizedPayment || null
  const metadataPreapprovalId = String(authorizedPayment?.preapprovalId || '').trim() || null
  const gatewayExternalReference = String(authorizedPayment?.externalReference || '').trim() || null

  if (metadataPreapprovalId) {
    const subscription = await getByGatewayId(metadataPreapprovalId)
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'metadata_preapproval_id',
        resolutionRule: 'platform_authorized_payment_linkage',
        metadataPreapprovalId,
        externalReference: gatewayExternalReference,
      }
    }
  }

  if (gatewayExternalReference) {
    const subscription = await getByExternalReference(gatewayExternalReference)
    if (subscription?.id) {
      return {
        subscription,
        lookupBy: 'external_reference',
        resolutionRule: 'platform_authorized_payment_linkage',
        metadataPreapprovalId,
        externalReference: gatewayExternalReference,
      }
    }
  }

  return null
}

async function resolveSubscriptionWebhookOwnerContext({
  resourceId,
  event = {},
  bodyUserId = null,
  getConnectedAccountBySellerIdentifier = getMpAccountBySellerIdentifier,
  getConnectedAccountByEstabelecimentoId = getMpAccountByEstabelecimentoId,
  resolveEstablishmentAccessToken = resolveMpAccessToken,
  getLoyaltySubscriptionByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getLoyaltySubscriptionByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getLoyaltySubscriptionByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getLoyaltySubscriptionByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
  getPlatformSubscriptionByGatewayId = getSubscriptionByGatewayId,
  getPlatformSubscriptionByExternalReference = getSubscriptionByExternalReference,
  platformAccessToken = config.billing?.mercadopago?.accessToken || null,
} = {}) {
  const normalizedUserId = normalizeWebhookNumericUserId(bodyUserId)
  const preapprovalId = resolveWebhookMetadataPreapprovalId(event) || (resourceId ? String(resourceId) : null)
  const externalReference = resolveWebhookExternalReference(event)
  const bodySellerAccount =
    normalizedUserId && normalizedUserId !== MP_COLLECTOR_ID
      ? await getConnectedAccountBySellerIdentifier(normalizedUserId)
      : null

  const loyaltyLink = await findSubscriptionLoyaltyLink({
    resourceId,
    preapprovalId,
    externalReference,
    getByGatewayId: getLoyaltySubscriptionByGatewayId,
    getByExternalReference: getLoyaltySubscriptionByExternalReference,
    getByEventResourceId: getLoyaltySubscriptionByEventResourceId,
    getByWebhookResourceId: getLoyaltySubscriptionByWebhookResourceId,
  })
  const platformLink = await findSubscriptionPlatformLink({
    resourceId,
    preapprovalId,
    externalReference,
    getByGatewayId: getPlatformSubscriptionByGatewayId,
    getByExternalReference: getPlatformSubscriptionByExternalReference,
  })

  if (loyaltyLink?.subscription?.id && platformLink?.subscription?.id) {
    return buildConflictingWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: loyaltyLink.lookupBy || platformLink.lookupBy || 'event_linkage',
      conflict: {
        loyalty_subscription_id: loyaltyLink.subscription.id,
        platform_subscription_id: platformLink.subscription.id,
      },
    })
  }

  if (loyaltyLink?.subscription?.estabelecimentoId) {
    const linkedEstabelecimentoId = Number(loyaltyLink.subscription.estabelecimentoId || 0) || null
    if (
      bodySellerAccount?.estabelecimento_id &&
      linkedEstabelecimentoId &&
      Number(bodySellerAccount.estabelecimento_id || 0) !== linkedEstabelecimentoId
    ) {
      return buildConflictingWebhookOwnerResolution({
        normalizedUserId,
        lookupBy: loyaltyLink.lookupBy,
        conflict: {
          loyalty_estabelecimento_id: linkedEstabelecimentoId,
          body_user_estabelecimento_id: Number(bodySellerAccount.estabelecimento_id || 0) || null,
        },
      })
    }

    const sellerAccount =
      bodySellerAccount && Number(bodySellerAccount.estabelecimento_id || 0) === linkedEstabelecimentoId
        ? bodySellerAccount
        : await getConnectedAccountByEstabelecimentoId(linkedEstabelecimentoId)

    return finalizeSellerWebhookOwnerResolution({
      sellerAccount: sellerAccount || { estabelecimento_id: linkedEstabelecimentoId },
      normalizedUserId,
      matchedFlow: 'loyalty',
      lookupBy: loyaltyLink.lookupBy,
      resolutionRule: loyaltyLink.resolutionRule,
      unresolvedReason: 'unresolved_owner_for_preapproval',
      resolveEstablishmentAccessToken,
    })
  }

  if (platformLink?.subscription?.id) {
    return buildPlatformWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: platformLink.lookupBy,
      resolutionRule: platformLink.resolutionRule,
      platformAccessToken,
      unresolvedReason: 'unresolved_owner_for_preapproval',
    })
  }

  if (normalizedUserId === MP_COLLECTOR_ID) {
    return buildPlatformWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: 'body_user_id',
      resolutionRule: 'platform_user_id',
      platformAccessToken,
      unresolvedReason: 'unresolved_owner_for_preapproval',
    })
  }

  return buildUnresolvedWebhookOwnerResolution({
    normalizedUserId,
    lookupBy: bodySellerAccount ? 'body_user_id' : null,
    resolutionRule: bodySellerAccount ? 'connected_seller_user' : 'no_confident_owner',
    reason: 'unresolved_owner_for_preapproval',
  })
}

async function resolveAuthorizedPaymentWebhookOwnerContext({
  resourceId,
  event = {},
  bodyUserId = null,
  getConnectedAccountBySellerIdentifier = getMpAccountBySellerIdentifier,
  getConnectedAccountByEstabelecimentoId = getMpAccountByEstabelecimentoId,
  resolveEstablishmentAccessToken = resolveMpAccessToken,
  getAuthorizedPayment = getMercadoPagoAuthorizedPayment,
  getLoyaltySubscriptionByGatewayPaymentId = getClientLoyaltySubscriptionByGatewayPaymentId,
  getLoyaltySubscriptionByGatewayId = getClientLoyaltySubscriptionByGatewayId,
  getLoyaltySubscriptionByExternalReference = getClientLoyaltySubscriptionByExternalReference,
  getLoyaltySubscriptionByEventResourceId = getClientLoyaltySubscriptionByEventResourceId,
  getLoyaltySubscriptionByWebhookResourceId = getClientLoyaltySubscriptionByWebhookResourceId,
  listLoyaltyAuthorizedPaymentProbeCandidates = listClientLoyaltyAuthorizedPaymentProbeCandidates,
  getPlatformSubscriptionByGatewayPaymentId = getSubscriptionByGatewayPaymentId,
  getPlatformSubscriptionByGatewayId = getSubscriptionByGatewayId,
  getPlatformSubscriptionByExternalReference = getSubscriptionByExternalReference,
  platformAccessToken = config.billing?.mercadopago?.accessToken || null,
} = {}) {
  const normalizedUserId = normalizeWebhookNumericUserId(bodyUserId)
  const metadataPreapprovalId = resolveWebhookMetadataPreapprovalId(event)
  const externalReference = resolveWebhookExternalReference(event)
  const bodySellerAccount =
    normalizedUserId && normalizedUserId !== MP_COLLECTOR_ID
      ? await getConnectedAccountBySellerIdentifier(normalizedUserId)
      : null

  const loyaltyLink = await findAuthorizedPaymentLoyaltyLink({
    resourceId,
    preapprovalId: metadataPreapprovalId,
    externalReference,
    preapprovalLookupBy: 'metadata_preapproval_id',
    getByGatewayPaymentId: getLoyaltySubscriptionByGatewayPaymentId,
    getByGatewayId: getLoyaltySubscriptionByGatewayId,
    getByExternalReference: getLoyaltySubscriptionByExternalReference,
    getByEventResourceId: getLoyaltySubscriptionByEventResourceId,
    getByWebhookResourceId: getLoyaltySubscriptionByWebhookResourceId,
  })
  const platformLink = await findAuthorizedPaymentPlatformLink({
    resourceId,
    preapprovalId: metadataPreapprovalId,
    externalReference,
    preapprovalLookupBy: 'metadata_preapproval_id',
    getByGatewayPaymentId: getPlatformSubscriptionByGatewayPaymentId,
    getByGatewayId: getPlatformSubscriptionByGatewayId,
    getByExternalReference: getPlatformSubscriptionByExternalReference,
  })
  const loyaltyProbe = !loyaltyLink?.subscription?.id
    ? await probeAuthorizedPaymentLoyaltyLink({
      resourceId,
      getAuthorizedPayment,
      listProbeCandidates: listLoyaltyAuthorizedPaymentProbeCandidates,
      resolveEstablishmentAccessToken,
      getByGatewayId: getLoyaltySubscriptionByGatewayId,
      getByExternalReference: getLoyaltySubscriptionByExternalReference,
    })
    : null
  const combinedFailedLookups = normalizeOwnerResolutionFailedLookups([
    ...(Array.isArray(loyaltyLink?.failedLookups) ? loyaltyLink.failedLookups : []),
    ...(Array.isArray(loyaltyProbe?.failedLookups) ? loyaltyProbe.failedLookups : []),
  ])

  if (loyaltyLink?.subscription?.id && platformLink?.subscription?.id) {
    return decorateWebhookOwnerResolution(buildConflictingWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: loyaltyLink.lookupBy || platformLink.lookupBy || 'event_linkage',
      conflict: {
        loyalty_subscription_id: loyaltyLink.subscription.id,
        platform_subscription_id: platformLink.subscription.id,
      },
    }), {
      metadataPreapprovalId,
      externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (loyaltyProbe?.subscription?.id && platformLink?.subscription?.id) {
    return decorateWebhookOwnerResolution(buildConflictingWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: loyaltyProbe.lookupBy || platformLink.lookupBy || 'event_linkage',
      conflict: {
        loyalty_subscription_id: loyaltyProbe.subscription.id,
        platform_subscription_id: platformLink.subscription.id,
      },
    }), {
      metadataPreapprovalId: loyaltyProbe.metadataPreapprovalId || metadataPreapprovalId,
      externalReference: loyaltyProbe.externalReference || externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (loyaltyLink?.subscription?.estabelecimentoId) {
    const linkedEstabelecimentoId = Number(loyaltyLink.subscription.estabelecimentoId || 0) || null
    if (
      bodySellerAccount?.estabelecimento_id &&
      linkedEstabelecimentoId &&
      Number(bodySellerAccount.estabelecimento_id || 0) !== linkedEstabelecimentoId
    ) {
      return decorateWebhookOwnerResolution(buildConflictingWebhookOwnerResolution({
        normalizedUserId,
        lookupBy: loyaltyLink.lookupBy || 'body_user_id',
        conflict: {
          loyalty_estabelecimento_id: linkedEstabelecimentoId,
          body_user_estabelecimento_id: Number(bodySellerAccount.estabelecimento_id || 0) || null,
        },
      }), {
        metadataPreapprovalId,
        externalReference,
        failedLookups: combinedFailedLookups,
      })
    }
    const sellerAccount = await getConnectedAccountByEstabelecimentoId(linkedEstabelecimentoId)
    return decorateWebhookOwnerResolution(await finalizeSellerWebhookOwnerResolution({
      sellerAccount: sellerAccount || { estabelecimento_id: linkedEstabelecimentoId },
      normalizedUserId,
      matchedFlow: 'loyalty',
      lookupBy: loyaltyLink.lookupBy,
      resolutionRule: loyaltyLink.resolutionRule,
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
      resolveEstablishmentAccessToken,
    }), {
      metadataPreapprovalId,
      externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (loyaltyProbe?.conflict) {
    return decorateWebhookOwnerResolution(buildConflictingWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: 'loyalty_subscription_linkage',
      conflict: loyaltyProbe.conflict,
    }), {
      metadataPreapprovalId: loyaltyProbe.metadataPreapprovalId || metadataPreapprovalId,
      externalReference: loyaltyProbe.externalReference || externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (loyaltyProbe?.subscription?.estabelecimentoId) {
    const linkedEstabelecimentoId = Number(loyaltyProbe.subscription.estabelecimentoId || 0) || null
    if (
      bodySellerAccount?.estabelecimento_id &&
      linkedEstabelecimentoId &&
      Number(bodySellerAccount.estabelecimento_id || 0) !== linkedEstabelecimentoId
    ) {
      return decorateWebhookOwnerResolution(buildConflictingWebhookOwnerResolution({
        normalizedUserId,
        lookupBy: loyaltyProbe.lookupBy || 'body_user_id',
        conflict: {
          loyalty_estabelecimento_id: linkedEstabelecimentoId,
          body_user_estabelecimento_id: Number(bodySellerAccount.estabelecimento_id || 0) || null,
        },
      }), {
        metadataPreapprovalId: loyaltyProbe.metadataPreapprovalId || metadataPreapprovalId,
        externalReference: loyaltyProbe.externalReference || externalReference,
        failedLookups: combinedFailedLookups,
      })
    }
    const sellerAccount =
      loyaltyProbe.sellerAccount ||
      await getConnectedAccountByEstabelecimentoId(linkedEstabelecimentoId)
    return decorateWebhookOwnerResolution(await finalizeSellerWebhookOwnerResolution({
      sellerAccount: sellerAccount || { estabelecimento_id: linkedEstabelecimentoId },
      normalizedUserId,
      matchedFlow: 'loyalty',
      lookupBy: loyaltyProbe.lookupBy,
      resolutionRule: loyaltyProbe.resolutionRule,
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
      resolveEstablishmentAccessToken,
    }), {
      metadataPreapprovalId: loyaltyProbe.metadataPreapprovalId || metadataPreapprovalId,
      externalReference: loyaltyProbe.externalReference || externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (bodySellerAccount?.estabelecimento_id || bodySellerAccount?.estabelecimentoId) {
    return decorateWebhookOwnerResolution(await finalizeSellerWebhookOwnerResolution({
      sellerAccount: bodySellerAccount,
      normalizedUserId,
      matchedFlow: 'loyalty',
      lookupBy: 'body_user_id',
      resolutionRule: 'connected_seller_user',
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
      resolveEstablishmentAccessToken,
    }), {
      metadataPreapprovalId: loyaltyProbe?.metadataPreapprovalId || metadataPreapprovalId,
      externalReference: loyaltyProbe?.externalReference || externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (normalizedUserId === MP_COLLECTOR_ID) {
    return decorateWebhookOwnerResolution(buildPlatformWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: 'body_user_id',
      resolutionRule: 'platform_user_id',
      platformAccessToken,
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
    }), {
      metadataPreapprovalId,
      externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  if (platformLink?.subscription?.id) {
    return decorateWebhookOwnerResolution(buildPlatformWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: platformLink.lookupBy,
      resolutionRule: platformLink.resolutionRule,
      platformAccessToken,
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
    }), {
      metadataPreapprovalId,
      externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  const platformProbe = await probeAuthorizedPaymentPlatformLink({
    resourceId,
    platformAccessToken,
    getAuthorizedPayment,
    getByGatewayId: getPlatformSubscriptionByGatewayId,
    getByExternalReference: getPlatformSubscriptionByExternalReference,
  })
  if (platformProbe?.subscription?.id) {
    return decorateWebhookOwnerResolution(buildPlatformWebhookOwnerResolution({
      normalizedUserId,
      lookupBy: platformProbe.lookupBy,
      resolutionRule: platformProbe.resolutionRule,
      platformAccessToken,
      unresolvedReason: 'unresolved_owner_for_authorized_payment',
    }), {
      metadataPreapprovalId: platformProbe.metadataPreapprovalId || metadataPreapprovalId,
      externalReference: platformProbe.externalReference || externalReference,
      failedLookups: combinedFailedLookups,
    })
  }

  return decorateWebhookOwnerResolution(buildUnresolvedWebhookOwnerResolution({
    normalizedUserId,
    lookupBy: normalizedUserId && normalizedUserId !== MP_COLLECTOR_ID ? 'body_user_id' : null,
    resolutionRule: normalizedUserId && normalizedUserId !== MP_COLLECTOR_ID
      ? 'connected_seller_user'
      : 'no_confident_owner',
    reason: 'unresolved_owner_for_authorized_payment',
  }), {
    metadataPreapprovalId: loyaltyProbe?.metadataPreapprovalId || metadataPreapprovalId,
    externalReference: loyaltyProbe?.externalReference || externalReference,
    failedLookups: combinedFailedLookups,
  })
}

async function resolveBillingAuthorizedPaymentWebhookAction({
  resourceId,
  syncEvent = {},
  syncDecision = {},
  bodyUserId = null,
  ownerResolution = null,
  ownerResolver = resolveAuthorizedPaymentWebhookOwnerContext,
  loyaltyAuthorizedPaymentHandler = syncClientLoyaltyAuthorizedPaymentFromGateway,
  platformAuthorizedPaymentHandler = syncAuthorizedPaymentFromGateway,
} = {}) {
  const resolvedOwner = ownerResolution || await ownerResolver({
    resourceId,
    event: syncEvent,
    bodyUserId,
    syncDecision,
  })

  if (!resolvedOwner?.ok) {
    return {
      kind: 'ignored_unresolved_authorized_payment_owner',
      ownerResolution: resolvedOwner,
      responseBody: {
        ok: true,
        ignored: true,
        reason: 'unresolved_authorized_payment_owner',
      },
    }
  }

  if (resolvedOwner.ownerType === 'establishment') {
    const loyaltyResult = await loyaltyAuthorizedPaymentHandler(resourceId, {
      bodyUserId: resolvedOwner.bodyUserId ?? bodyUserId,
      gatewayEventId: resourceId,
      sellerAccount: resolvedOwner.sellerAccount || null,
      accessToken: resolvedOwner.accessToken || null,
    })
    return {
      kind: 'seller_authorized_payment',
      ownerResolution: resolvedOwner,
      loyaltyResult,
      responseBody: {
        ok: true,
        processed: Boolean(loyaltyResult?.handled),
        loyalty: true,
        reason: loyaltyResult?.reason || null,
        status: loyaltyResult?.status || null,
      },
    }
  }

  const platformResult = await platformAuthorizedPaymentHandler(resourceId, {
    gatewayEventId: resourceId,
    accessToken: resolvedOwner.accessToken || null,
  })
  return {
    kind: 'platform_authorized_payment',
    ownerResolution: resolvedOwner,
    platformResult,
    responseBody: {
      ok: true,
      processed: !!platformResult?.ok,
      reason: platformResult?.reason || null,
    },
  }
}

async function resolveBillingSubscriptionWebhookAction({
  resourceId,
  syncEvent = {},
  syncDecision = {},
  bodyUserId = null,
  ownerResolution = null,
  ownerResolver = resolveSubscriptionWebhookOwnerContext,
  loyaltySubscriptionHandler = syncClientLoyaltyCardSubscriptionFromGateway,
  platformSubscriptionHandler = syncCardSubscriptionFromGateway,
} = {}) {
  const resolvedOwner = ownerResolution || await ownerResolver({
    resourceId,
    event: syncEvent,
    bodyUserId,
    syncDecision,
  })

  if (!resolvedOwner?.ok) {
    return {
      kind: 'ignored_unresolved_subscription_owner',
      ownerResolution: resolvedOwner,
      responseBody: {
        ok: true,
        ignored: true,
        reason: 'unresolved_subscription_owner',
      },
    }
  }

  if (resolvedOwner.ownerType === 'establishment') {
    const loyaltyResult = await loyaltySubscriptionHandler(resourceId, {
      bodyUserId: resolvedOwner.bodyUserId ?? bodyUserId,
      gatewayEventId: resourceId,
      sellerAccount: resolvedOwner.sellerAccount || null,
      accessToken: resolvedOwner.accessToken || null,
    })
    return {
      kind: 'seller_subscription',
      ownerResolution: resolvedOwner,
      loyaltyResult,
      responseBody: {
        ok: true,
        processed: Boolean(loyaltyResult?.handled),
        loyalty: true,
        reason: loyaltyResult?.reason || null,
        status: loyaltyResult?.status || null,
      },
    }
  }

  const platformResult = await platformSubscriptionHandler(resourceId, {
    gatewayEventId: resourceId,
    accessToken: resolvedOwner.accessToken || null,
  })
  return {
    kind: 'platform_subscription',
    ownerResolution: resolvedOwner,
    platformResult,
    responseBody: {
      ok: true,
      processed: !!platformResult?.ok,
      reason: platformResult?.reason || null,
    },
  }
}

async function resolveConnectedSellerPaymentFlowMatch({
  resourceId,
  connectedAccount = null,
  bodyUserId = null,
  fetchPayment = fetchMercadoPagoPayment,
  resolveEstablishmentAccessToken = resolveMpAccessToken,
  loyaltyPaymentMatcher = resolveClientLoyaltyPaymentMatch,
} = {}) {
  const estabelecimentoId = Number(
    connectedAccount?.estabelecimento_id || connectedAccount?.estabelecimentoId || 0
  ) || null
  if (!estabelecimentoId) {
    return {
      paymentFetched: false,
      depositMatch: false,
      depositReason: 'estabelecimento_not_found',
      loyaltyMatch: false,
      loyaltyReason: 'estabelecimento_not_found',
      matchedFlow: null,
      matchRule: null,
    }
  }

  const mpAccess = await resolveEstablishmentAccessToken(estabelecimentoId, { allowFallback: false })
  const accessToken = mpAccess?.accessToken || null
  const sellerAccount = mpAccess?.account || connectedAccount
  if (!accessToken) {
    return {
      paymentFetched: false,
      accessToken: null,
      sellerAccount,
      depositMatch: false,
      depositReason: 'mp_token_missing',
      loyaltyMatch: false,
      loyaltyReason: 'mp_token_missing',
      matchedFlow: null,
      matchRule: null,
    }
  }

  let payment = null
  try {
    payment = await fetchPayment(resourceId, { accessToken })
  } catch (error) {
    return {
      paymentFetched: false,
      accessToken,
      sellerAccount,
      fetchError: error?.message || 'mp_fetch_failed',
      depositMatch: false,
      depositReason: 'mp_fetch_failed',
      loyaltyMatch: false,
      loyaltyReason: 'mp_fetch_failed',
      matchedFlow: null,
      matchRule: null,
    }
  }

  const paymentStatus = String(payment?.status || '').trim().toLowerCase() || null
  const operationType = String(payment?.operation_type || payment?.operationType || '').trim().toLowerCase() || null
  const transactionAmount = normalizeMercadoPagoPaymentAmount(payment?.transaction_amount)
  const externalReference = String(payment?.external_reference || '').trim() || null
  const metadataPreapprovalId = resolveMercadoPagoPaymentMetadataPreapprovalId(payment)
  const poiType = String(payment?.point_of_interaction?.type || '').trim().toUpperCase() || null
  const subscriptionId = resolveMercadoPagoPaymentSubscriptionId(payment)
  const cardValidationMatch = resolveMercadoPagoCardValidationMatch({
    paymentStatus,
    operationType,
    transactionAmount,
    externalReference,
    metadataPreapprovalId,
    subscriptionId,
  })

  if (cardValidationMatch.matched) {
    return {
      paymentFetched: true,
      accessToken,
      sellerAccount,
      payment,
      paymentStatus,
      operationType,
      transactionAmount,
      externalReference,
      metadataPreapprovalId,
      poiType,
      subscriptionId,
      cardValidationMatch: true,
      depositMatch: false,
      depositReason: 'card_validation_payment',
      loyaltyMatch: false,
      loyaltyReason: 'card_validation_payment',
      matchedFlow: 'card_validation',
      matchRule: cardValidationMatch.matchRule,
      conflict: false,
      loyaltyMatchContext: null,
      estabelecimentoId,
      bodyUserId,
    }
  }

  const metadataType = String(payment?.metadata?.type || payment?.metadata?.kind || '').toLowerCase()
  const depositMatch = metadataType === 'deposit' || /^dep:ag:\d+:pay:\d+:est:\d+/i.test(externalReference || '')
  const depositReason = depositMatch
    ? (metadataType === 'deposit' ? 'metadata_type_deposit' : 'external_reference_deposit')
    : 'not_deposit'
  const loyaltyMatchContext = await loyaltyPaymentMatcher(payment, {
    gatewayEventId: resourceId,
  })
  const loyaltyMatch = Boolean(loyaltyMatchContext?.matched)
  const conflict = depositMatch && loyaltyMatch
  const matchedFlow = conflict ? null : (depositMatch ? 'deposit' : (loyaltyMatch ? 'loyalty' : null))
  const matchRule = conflict
    ? 'conflicting_connected_seller_flow'
    : (depositMatch ? depositReason : (loyaltyMatchContext?.matchRule || null))

  return {
    paymentFetched: true,
    accessToken,
    sellerAccount,
    payment,
    paymentStatus,
    operationType,
    transactionAmount,
    externalReference,
    metadataPreapprovalId: loyaltyMatchContext?.preapprovalId || metadataPreapprovalId,
    poiType,
    subscriptionId: loyaltyMatchContext?.subscriptionId || subscriptionId,
    depositMatch,
    depositReason,
    loyaltyMatch,
    loyaltyReason: loyaltyMatchContext?.reason || (loyaltyMatch ? null : 'not_loyalty_payment'),
    matchedFlow,
    matchRule,
    conflict,
    loyaltyMatchContext,
    estabelecimentoId,
    bodyUserId,
  }
}

async function resolveBillingPaymentWebhookAction({
  resourceId,
  syncEvent = {},
  syncDecision = {},
  bodyUserId = null,
  resolveConnectedAccount = getMpAccountBySellerIdentifier,
  depositHandler = handleDepositPaymentWebhook,
  loyaltyPaymentHandler = syncClientLoyaltyPaymentFromGateway,
  sellerPaymentFlowMatcher = resolveConnectedSellerPaymentFlowMatch,
  recoveryHandler = syncCardRecoveryPaymentFromGateway,
  platformPaymentHandler = syncMercadoPagoPayment,
} = {}) {
  const normalizedUserId = bodyUserId != null ? Number(bodyUserId) : null
  const effectiveBodyUserId = Number.isFinite(normalizedUserId) ? normalizedUserId : null
  const hasExplicitForeignUser = effectiveBodyUserId != null && effectiveBodyUserId !== MP_COLLECTOR_ID

  if (hasExplicitForeignUser) {
    const connectedAccount = await resolveConnectedAccount(effectiveBodyUserId)
    if (!connectedAccount?.estabelecimento_id && !connectedAccount?.estabelecimentoId) {
      return {
        kind: 'ignored_foreign_user_unknown_account',
        ownerType: null,
        matchedFlow: null,
        connectedAccount: null,
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'foreign_user_unknown_account',
        },
      }
    }

    const flowMatch = await sellerPaymentFlowMatcher({
      resourceId,
      connectedAccount,
      bodyUserId: effectiveBodyUserId,
    })

    if (flowMatch?.conflict) {
      return {
        kind: 'conflicting_connected_seller_flow',
        ownerType: 'establishment',
        matchedFlow: null,
        connectedAccount,
        flowMatch,
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'conflicting_connected_seller_flow',
        },
      }
    }

    if (flowMatch?.paymentFetched && flowMatch?.matchedFlow === 'card_validation') {
      return {
        kind: 'seller_card_validation_ignored',
        ownerType: 'establishment',
        matchedFlow: 'card_validation',
        connectedAccount,
        flowMatch,
        depositResult: null,
        loyaltyResult: null,
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'card_validation_payment',
          matched_flow: 'card_validation',
          action_taken: 'ignored_card_validation',
          ignored_reason: 'card_validation_payment',
        },
      }
    }

    if (flowMatch?.paymentFetched && flowMatch?.matchedFlow === 'deposit') {
      const depositResult = await depositHandler({
        resourceId,
        event: syncEvent,
        bodyUserId: effectiveBodyUserId,
        ownerAccount: flowMatch?.sellerAccount || connectedAccount,
        prefetchedPayment: flowMatch.payment,
        accessToken: flowMatch.accessToken,
      })
      if (depositResult?.handled) {
        return {
          kind: 'seller_deposit',
          ownerType: 'establishment',
          matchedFlow: 'deposit',
          connectedAccount,
          flowMatch,
          depositResult,
          responseBody: {
            ok: true,
            processed: true,
            deposit: true,
            status: depositResult.status || null,
          },
        }
      }
      if (depositResult?.ok && depositResult?.status) {
        return {
          kind: 'seller_deposit',
          ownerType: 'establishment',
          matchedFlow: 'deposit',
          connectedAccount,
          flowMatch,
          depositResult,
          responseBody: {
            ok: true,
            processed: false,
            deposit: true,
            status: depositResult.status,
          },
        }
      }
      return {
        kind: 'ignored_foreign_user_unmatched_flow',
        ownerType: 'establishment',
        matchedFlow: null,
        connectedAccount,
        flowMatch,
        depositResult,
        loyaltyResult: null,
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'unmatched_connected_seller_flow',
        },
      }
    }

    if (flowMatch?.paymentFetched && flowMatch?.matchedFlow === 'loyalty') {
      const loyaltyResult = await loyaltyPaymentHandler(resourceId, {
        bodyUserId: effectiveBodyUserId,
        gatewayEventId: resourceId,
        sellerAccount: flowMatch?.sellerAccount || connectedAccount,
        accessToken: flowMatch.accessToken,
        prefetchedPayment: flowMatch.payment,
        paymentMatch: flowMatch.loyaltyMatchContext,
      })
      if (loyaltyResult?.ok) {
        return {
          kind: 'seller_loyalty',
          ownerType: 'establishment',
          matchedFlow: 'loyalty',
          connectedAccount,
          flowMatch,
          loyaltyResult,
          responseBody: {
            ok: true,
            processed: Boolean(loyaltyResult?.handled),
            loyalty: true,
            status: loyaltyResult?.status || null,
            reason: loyaltyResult?.reason || null,
          },
        }
      }
      return {
        kind: 'ignored_foreign_user_unmatched_flow',
        ownerType: 'establishment',
        matchedFlow: null,
        connectedAccount,
        flowMatch,
        depositResult: null,
        loyaltyResult,
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'unmatched_connected_seller_flow',
        },
      }
    }

    if (flowMatch?.paymentFetched) {
      return {
        kind: 'ignored_foreign_user_unmatched_flow',
        ownerType: 'establishment',
        matchedFlow: null,
        connectedAccount,
        flowMatch,
        depositResult: { ok: false, reason: flowMatch?.depositReason || 'not_deposit' },
        loyaltyResult: {
          ok: false,
          reason: flowMatch?.loyaltyReason || 'not_loyalty_payment',
          matchDetails: flowMatch?.loyaltyMatchContext || null,
        },
        responseBody: {
          ok: true,
          ignored: true,
          reason: 'unmatched_connected_seller_flow',
        },
      }
    }

    const depositResult = await depositHandler({
      resourceId,
      event: syncEvent,
      bodyUserId: effectiveBodyUserId,
      ownerAccount: connectedAccount,
    })
    if (depositResult?.handled) {
      return {
        kind: 'seller_deposit',
        ownerType: 'establishment',
        matchedFlow: 'deposit',
        connectedAccount,
        flowMatch,
        depositResult,
        responseBody: {
          ok: true,
          processed: true,
          deposit: true,
          status: depositResult.status || null,
        },
      }
    }
    if (depositResult?.ok && depositResult?.status) {
      return {
        kind: 'seller_deposit',
        ownerType: 'establishment',
        matchedFlow: 'deposit',
        connectedAccount,
        flowMatch,
        depositResult,
        responseBody: {
          ok: true,
          processed: false,
          deposit: true,
          status: depositResult.status,
        },
      }
    }

    const loyaltyResult = await loyaltyPaymentHandler(resourceId, {
      bodyUserId: effectiveBodyUserId,
      gatewayEventId: resourceId,
      sellerAccount: connectedAccount,
    })
    if (loyaltyResult?.ok) {
      return {
        kind: 'seller_loyalty',
        ownerType: 'establishment',
        matchedFlow: 'loyalty',
        connectedAccount,
        flowMatch,
        loyaltyResult,
        responseBody: {
          ok: true,
          processed: Boolean(loyaltyResult?.handled),
          loyalty: true,
          status: loyaltyResult?.status || null,
          reason: loyaltyResult?.reason || null,
        },
      }
    }

    return {
      kind: 'ignored_foreign_user_unmatched_flow',
      ownerType: 'establishment',
      matchedFlow: null,
      connectedAccount,
      flowMatch,
      depositResult,
      loyaltyResult,
      responseBody: {
        ok: true,
        ignored: true,
        reason: 'unmatched_connected_seller_flow',
      },
    }
  }

  const depositResult = await depositHandler({
    resourceId,
    event: syncEvent,
    bodyUserId: effectiveBodyUserId,
  })
  if (depositResult?.handled) {
    return {
      kind: 'platform_deposit',
      ownerType: 'platform',
      matchedFlow: 'deposit',
      depositResult,
      responseBody: {
        ok: true,
        processed: true,
        deposit: true,
        status: depositResult.status || null,
      },
    }
  }
  if (depositResult?.ok && depositResult?.status) {
    return {
      kind: 'platform_deposit',
      ownerType: 'platform',
      matchedFlow: 'deposit',
      depositResult,
      responseBody: {
        ok: true,
        processed: false,
        deposit: true,
        status: depositResult.status,
      },
    }
  }

  const recoveryResult = await recoveryHandler(resourceId, {
    gatewayEventId: resourceId,
  })
  if (recoveryResult?.ok) {
    return {
      kind: 'platform_recovery',
      ownerType: 'platform',
      matchedFlow: 'platform_saas',
      recoveryResult,
      responseBody: {
        ok: true,
        processed: Boolean(recoveryResult?.handled),
        recovery: true,
        status: recoveryResult?.status || null,
        reason: recoveryResult?.reason || null,
      },
    }
  }

  const platformResult = await platformPaymentHandler(resourceId, syncEvent)
  return {
    kind: 'platform_payment',
    ownerType: 'platform',
    matchedFlow: 'platform_saas',
    platformResult,
    responseBody: {
      ok: true,
      processed: !!platformResult?.ok,
      reason: platformResult?.reason || null,
      already_processed: platformResult?.already_processed === true,
      stale: platformResult?.stale === true,
    },
  }
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
  const retryWithNewToken =
    normalized?.retry_with_new_token === true ||
    normalized?.details?.retry_with_new_token === true
  console.error(routeLabel, {
    request_id: requestId || null,
    error: code,
    message,
    retry_with_new_token: retryWithNewToken,
    details: normalized?.details || null,
  })
  return res.status(status).json({
    error: code,
    message,
    retry_with_new_token: retryWithNewToken,
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

async function processUpgradeCreditAfterActivationTx(targetSubscriptionId, {
  paymentMethod = null,
  paymentId = null,
  externalReference = null,
  rawPayload = null,
  db = pool,
} = {}) {
  const targetSubscription = await getSubscriptionById(targetSubscriptionId, { db })
  if (!targetSubscription?.id) {
    return {
      subscription: null,
      sourceSubscription: null,
      credit: null,
      schedulePlan: null,
      applied: false,
    }
  }

  const paidAt = targetSubscription.currentPeriodStart || targetSubscription.lastPaymentAt || new Date()
  const sourceSubscription = await findUpgradeSourceSubscription(targetSubscription.estabelecimentoId, {
    targetSubscriptionId: targetSubscription.id,
    targetPlan: targetSubscription.plan,
    changedAt: paidAt,
    db,
  })
  let creditResult = { credit: null, created: false }

  if (sourceSubscription?.id) {
    await releaseScheduledSubscriptionCreditApplicationsTx(sourceSubscription.id, {
      db,
      reason: 'source_subscription_upgraded',
      externalReference,
    })

    creditResult = await createUpgradeProrationCreditTx({
      sourceSubscription,
      targetSubscription,
      changedAt: paidAt,
      paymentMethod,
      paymentId,
      externalReference,
      rawPayload,
      db,
    })

    if (sourceSubscription.id !== targetSubscription.id) {
      await updateSubscription(sourceSubscription.id, {
        status: 'canceled',
        canceledAt: paidAt,
        cancelAt: paidAt,
        nextBillingAt: null,
        graceUntil: null,
      }, { db })
    }

    if (creditResult?.credit) {
      await appendUpgradeCreditEventsTx(sourceSubscription, targetSubscription, {
        credit: creditResult.credit,
        paymentMethod,
        paymentId,
        externalReference,
        db,
      })
    }
  }

  const refreshedTargetSubscription = await getSubscriptionById(targetSubscription.id, { db })
  const schedulePlan =
    refreshedTargetSubscription?.gatewaySubscriptionId &&
    String(refreshedTargetSubscription.paymentMethod || '').toLowerCase() === 'credit_card'
      ? await scheduleSubscriptionCreditsForCardTx(refreshedTargetSubscription, {
          externalReference,
          db,
        })
      : null

  if (schedulePlan?.reserved_credit_cents > 0) {
    await appendSubscriptionEvent(refreshedTargetSubscription.id, {
      eventType: 'subscription_credit_reserved',
      gatewayEventId: `credit-reserved:${refreshedTargetSubscription.id}:${paymentId || externalReference || Date.now()}`,
      payload: {
        payment_method: paymentMethod,
        payment_id: paymentId || null,
        external_reference: externalReference || null,
        nominal_amount_cents: schedulePlan.nominal_amount_cents,
        next_charge_amount_cents: schedulePlan.next_charge_amount_cents,
        next_charge_credit_cents: schedulePlan.scheduled_discount_cents,
        next_payable_at: schedulePlan.next_payable_at,
        scheduled_full_cycles: schedulePlan.scheduled_full_cycles,
        reserved_credit_cents: schedulePlan.reserved_credit_cents,
      },
    }, { db })
  }

  return {
    subscription: refreshedTargetSubscription,
    sourceSubscription,
    credit: creditResult?.credit || null,
    schedulePlan,
    applied: Boolean(creditResult?.credit),
  }
}

async function syncCardCreditScheduleWithGateway(targetSubscription, schedulePlan, {
  requestId = null,
  operation = 'subscription_credit_schedule_sync',
} = {}) {
  if (!targetSubscription?.gatewaySubscriptionId || !schedulePlan) return null
  const nextPayableAt = schedulePlan.next_payable_at ? new Date(schedulePlan.next_payable_at) : null
  return updateMercadoPagoCardSubscription(targetSubscription.gatewaySubscriptionId, {
    amountCents: schedulePlan.next_charge_amount_cents || schedulePlan.nominal_amount_cents,
    billingCycle: targetSubscription.billingCycle,
    status: 'authorized',
    startDate: nextPayableAt,
    requestContext: {
      requestId,
      route: '/billing/webhook',
      operation,
      subscriptionId: targetSubscription.id,
      externalReference: targetSubscription.externalReference || null,
    },
  })
}

async function releaseCardCreditScheduleOnFailure(targetSubscriptionId, {
  reason,
  externalReference = null,
} = {}) {
  if (!targetSubscriptionId) return
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const released = await releaseScheduledSubscriptionCreditApplicationsTx(targetSubscriptionId, {
      db: conn,
      reason,
      externalReference,
    })
    if (released?.released_amount_cents > 0) {
      await appendSubscriptionEvent(targetSubscriptionId, {
        eventType: 'subscription_credit_released',
        gatewayEventId: `credit-release:${targetSubscriptionId}:${reason}`,
        payload: {
          reason,
          external_reference: externalReference || null,
          released_credit_cents: released.released_amount_cents,
        },
      }, { db: conn })
    }
    await conn.commit()
  } catch (error) {
    try { await conn.rollback() } catch {}
    console.warn('[billing][credit_schedule][release_failed]', {
      subscription_id: targetSubscriptionId,
      reason,
      message: error?.message || error,
    })
  } finally {
    conn.release()
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

function sumReservedCreditApplications(applications = []) {
  return (Array.isArray(applications) ? applications : []).reduce((total, item) => (
    total + Math.max(0, Math.trunc(Number(item?.amount_cents || 0) || 0))
  ), 0)
}

async function tryApplyFullCreditRenewal({
  estabelecimentoId,
  subscriptionId,
  plan,
  billingCycle,
  nominalAmountCents,
} = {}) {
  if (!estabelecimentoId || !subscriptionId || nominalAmountCents <= 0) {
    return { covered: false, subscription: null, appliedAmountCents: 0 }
  }

  const conn = await pool.getConnection()
  let rolledBack = false
  try {
    await conn.beginTransaction()
    const locked = await getSubscriptionById(subscriptionId, { db: conn })
    if (!locked?.id) {
      await conn.rollback()
      rolledBack = true
      return { covered: false, subscription: null, appliedAmountCents: 0 }
    }

    const groupKey = `manual-renewal-credit:${locked.id}:${Date.now()}`
    const applications = await reserveSubscriptionCreditApplicationsTx({
      estabelecimentoId,
      targetSubscriptionId: locked.id,
      amountCents: nominalAmountCents,
      paymentMethod: 'pix',
      applicationType: 'manual_renewal_credit',
      applicationGroupKey: groupKey,
      scheduledFor: new Date(),
      externalReference: groupKey,
      payload: {
        plan,
        billing_cycle: billingCycle,
        nominal_amount_cents: nominalAmountCents,
      },
      db: conn,
    })
    const reservedAmountCents = sumReservedCreditApplications(applications)
    if (reservedAmountCents < nominalAmountCents) {
      if (applications.length) {
        await releaseReservedSubscriptionCreditApplicationsTx(applications, {
          externalReference: groupKey,
          payloadPatch: { reason: 'insufficient_manual_renewal_credit' },
          db: conn,
        })
      }
      await conn.rollback()
      rolledBack = true
      return { covered: false, subscription: null, appliedAmountCents: 0 }
    }

    const appliedAmountCents = await applyReservedSubscriptionCreditApplicationsTx(applications, {
      paymentId: groupKey,
      externalReference: groupKey,
      payloadPatch: {
        applied_reason: 'manual_renewal_fully_covered',
        payment_method: 'credit_balance',
      },
      db: conn,
    })
    if (appliedAmountCents < nominalAmountCents) {
      throw new Error('manual_renewal_credit_application_incomplete')
    }

    const now = new Date()
    const currentPeriodEnd = locked.currentPeriodEnd instanceof Date ? locked.currentPeriodEnd : (locked.currentPeriodEnd ? new Date(locked.currentPeriodEnd) : null)
    const anchorEnd =
      currentPeriodEnd && Number.isFinite(currentPeriodEnd.getTime()) && currentPeriodEnd.getTime() > now.getTime()
        ? currentPeriodEnd
        : now
    const nextEnd = addBillingCycleDate(anchorEnd, billingCycle)
    const updated = await updateSubscription(locked.id, {
      status: 'active',
      paymentMethod: 'pix',
      amountCents: nominalAmountCents,
      billingCycle,
      currentPeriodStart:
        currentPeriodEnd && Number.isFinite(currentPeriodEnd.getTime()) && currentPeriodEnd.getTime() > now.getTime()
          ? locked.currentPeriodStart || now
          : now,
      currentPeriodEnd: nextEnd,
      nextBillingAt: nextEnd,
      graceUntil: null,
      lastPaymentAt: now,
    }, { db: conn })

    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_credit_applied',
      gatewayEventId: `manual-renewal-credit:${updated.id}:${groupKey}`,
      payload: {
        payment_method: 'credit_balance',
        application_type: 'manual_renewal_credit',
        amount_cents: appliedAmountCents,
        plan,
        billing_cycle: billingCycle,
      },
    }, { db: conn })
    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_renewed',
      gatewayEventId: `manual-renewal-covered:${updated.id}:${groupKey}`,
      payload: {
        payment_method: 'credit_balance',
        covered_by_credit: true,
        credit_applied_cents: appliedAmountCents,
        plan,
        billing_cycle: billingCycle,
        cycle_end: nextEnd ? nextEnd.toISOString() : null,
      },
    }, { db: conn })

    await conn.commit()
    return { covered: true, subscription: updated, appliedAmountCents }
  } catch (error) {
    if (!rolledBack) {
      try { await conn.rollback() } catch {}
    }
    throw error
  } finally {
    conn.release()
  }
}

async function reservePendingPixCreditDiscount({
  estabelecimentoId,
  plan,
  billingCycle,
  nominalAmountCents,
} = {}) {
  if (!estabelecimentoId || nominalAmountCents <= 0) {
    return { placeholderSubscription: null, reservedAmountCents: 0, shouldRetryFullCredit: false }
  }

  const conn = await pool.getConnection()
  let rolledBack = false
  try {
    await conn.beginTransaction()
    const totals = await getAvailableSubscriptionCreditTotals(estabelecimentoId, { db: conn })
    const availableAmountCents = Math.max(0, Math.trunc(Number(totals?.remaining_credit_cents || 0) || 0))
    if (availableAmountCents <= 0) {
      await conn.rollback()
      rolledBack = true
      return { placeholderSubscription: null, reservedAmountCents: 0, shouldRetryFullCredit: false }
    }
    if (availableAmountCents >= nominalAmountCents) {
      await conn.rollback()
      rolledBack = true
      return { placeholderSubscription: null, reservedAmountCents: 0, shouldRetryFullCredit: true }
    }

    const placeholderSubscription = await createSubscription({
      estabelecimentoId,
      plan,
      amountCents: nominalAmountCents,
      currency: (config.billing?.currency || 'BRL').toUpperCase(),
      paymentMethod: 'pix',
      status: 'canceled',
      gatewaySubscriptionId: null,
      gatewayPaymentId: null,
      gatewayPreferenceId: null,
      externalReference: null,
      billingCycle,
    }, { db: conn })

    const groupKey = `pending-pix-discount:${placeholderSubscription.id}:${Date.now()}`
    const applications = await reserveSubscriptionCreditApplicationsTx({
      estabelecimentoId,
      targetSubscriptionId: placeholderSubscription.id,
      amountCents: availableAmountCents,
      paymentMethod: 'pix',
      applicationType: 'pending_pix_discount',
      applicationGroupKey: groupKey,
      scheduledFor: new Date(),
      externalReference: groupKey,
      payload: {
        plan,
        billing_cycle: billingCycle,
        nominal_amount_cents: nominalAmountCents,
        requested_discount_cents: availableAmountCents,
      },
      db: conn,
    })
    const reservedAmountCents = sumReservedCreditApplications(applications)
    if (reservedAmountCents <= 0) {
      await conn.rollback()
      rolledBack = true
      return { placeholderSubscription: null, reservedAmountCents: 0, shouldRetryFullCredit: false }
    }

    await conn.commit()
    return {
      placeholderSubscription,
      reservedAmountCents,
      shouldRetryFullCredit: false,
    }
  } catch (error) {
    if (!rolledBack) {
      try { await conn.rollback() } catch {}
    }
    throw error
  } finally {
    conn.release()
  }
}

async function cleanupPendingPixCreditDiscount(subscriptionId, {
  reason = 'pending_pix_creation_failed',
  externalReference = null,
} = {}) {
  if (!subscriptionId) return { released_amount_cents: 0 }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const released = await releaseScheduledSubscriptionCreditApplicationsTx(subscriptionId, {
      db: conn,
      reason,
      externalReference,
    })
    await updateSubscription(subscriptionId, {
      status: 'canceled',
      gatewayPaymentId: null,
      gatewayPreferenceId: null,
      externalReference: null,
      nextBillingAt: null,
      graceUntil: null,
    }, { db: conn })
    if (released?.released_amount_cents > 0) {
      await appendSubscriptionEvent(subscriptionId, {
        eventType: 'subscription_credit_released',
        gatewayEventId: `credit-release:${subscriptionId}:${reason}`,
        payload: {
          reason,
          external_reference: externalReference || null,
          released_credit_cents: released.released_amount_cents,
        },
      }, { db: conn })
    }
    await conn.commit()
    return released
  } catch (error) {
    try { await conn.rollback() } catch {}
    console.warn('[billing][renew_pix][credit_cleanup_failed]', {
      subscription_id: subscriptionId,
      reason,
      message: error?.message || error,
    })
    return { released_amount_cents: 0, failed: true }
  } finally {
    conn.release()
  }
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
  accessToken = null,
} = {}) {
  const localSubscription = await getSubscriptionByGatewayId(gatewaySubscriptionId)
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const gatewayResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackPlan: localSubscription.plan,
    fallbackCycle: localSubscription.billingCycle,
    accessToken,
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
  accessToken = null,
} = {}) {
  const paymentResult = await getMercadoPagoAuthorizedPayment(authorizedPaymentId, { accessToken })
  const authorizedPayment = paymentResult.authorizedPayment
  const paymentOutcome = authorizedPayment?.paymentResult || summarizeMercadoPagoGatewayResult(paymentResult.raw)
  const localSubscription =
    await getSubscriptionByGatewayPaymentId(authorizedPaymentId) ||
    (authorizedPayment?.preapprovalId
      ? await getSubscriptionByGatewayId(authorizedPayment.preapprovalId)
      : null) ||
    await getSubscriptionByExternalReference(authorizedPayment?.externalReference || '')
  if (!authorizedPayment?.preapprovalId && !localSubscription) {
    return { ok: false, reason: 'preapproval_not_found' }
  }
  if (!localSubscription) {
    return { ok: false, reason: 'subscription_not_found' }
  }

  const gatewaySubscriptionId =
    authorizedPayment?.preapprovalId ||
    localSubscription.gatewaySubscriptionId ||
    null
  if (!gatewaySubscriptionId) {
    return { ok: false, reason: 'preapproval_not_found' }
  }

  const preapprovalResult = await getMercadoPagoCardSubscription(gatewaySubscriptionId, {
    fallbackPlan: localSubscription.plan,
    fallbackCycle: localSubscription.billingCycle,
    accessToken,
  })
  const paymentDate = authorizedPayment.paidAt ? new Date(authorizedPayment.paidAt) : new Date()
  const fallbackCurrentPeriodEnd = addBillingCycleDate(paymentDate, localSubscription.billingCycle || preapprovalResult.subscription?.billingCycle || 'mensal')
  const graceDays = Number(config.billing?.reminders?.graceDays ?? process.env.SUBSCRIPTION_GRACE_DAYS ?? 3) || 3
  const graceUntil = authorizedPayment.status === 'past_due'
    ? new Date(Date.now() + graceDays * DAY_MS)
    : null

  const conn = await pool.getConnection()
  let updated = null
  let upgradeProcessing = {
    applied: false,
    credit: null,
    sourceSubscription: null,
    schedulePlan: null,
    subscription: null,
  }
  const eventPayload = buildMercadoPagoPaymentEventPayload({
    payment: paymentResult.raw,
    paymentResult: paymentOutcome,
    gatewaySubscription: preapprovalResult.raw,
    operation: 'subscription_authorized_payment',
    source: 'webhook',
    previousStatus: localSubscription.status,
    nextStatus: authorizedPayment.status || localSubscription.status,
    externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
    decision: paymentOutcome?.decision || null,
  })

  try {
    await conn.beginTransaction()
    updated = await updateSubscription(localSubscription.id, {
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
    }, { db: conn })

    const normalizedEventType = authorizedPayment.status === 'active'
      ? 'payment_approved'
      : authorizedPayment.status === 'past_due'
        ? 'payment_failed'
        : 'payment_pending'
    await appendSubscriptionEvent(updated.id, {
      eventType: normalizedEventType,
      gatewayEventId: gatewayEventId || authorizedPayment.id,
      payload: {
        ...eventPayload,
        next_status: updated.status,
      },
    }, { db: conn })
    if (authorizedPayment.status === 'active') {
      const appliedScheduledDiscount = await applyScheduledDiscountForSubscriptionPaymentTx(updated.id, {
        paymentId: authorizedPayment.id || gatewayEventId || authorizedPaymentId,
        externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
        paymentDate,
        db: conn,
      })

      if (appliedScheduledDiscount?.applied_credit_cents > 0) {
        await appendSubscriptionEvent(updated.id, {
          eventType: 'subscription_credit_applied',
          gatewayEventId: `credit-discount:${authorizedPayment.id || gatewayEventId || authorizedPaymentId}`,
          payload: {
            payment_method: 'credit_card',
            payment_id: authorizedPayment.id || null,
            external_reference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
            application_type: 'scheduled_discount',
            amount_cents: appliedScheduledDiscount.applied_credit_cents,
            scheduled_for: appliedScheduledDiscount.group?.scheduled_for || null,
          },
        }, { db: conn })
      }

      await appendSubscriptionEvent(updated.id, {
        eventType: 'subscription_renewed',
        gatewayEventId: `renewal:${authorizedPayment.id}`,
        payload: {
          ...eventPayload,
          next_status: updated.status,
          credit_applied_cents: appliedScheduledDiscount?.applied_credit_cents || 0,
        },
      }, { db: conn })
      upgradeProcessing = await processUpgradeCreditAfterActivationTx(updated.id, {
        paymentMethod: 'credit_card',
        paymentId: authorizedPayment.id || gatewayEventId || authorizedPaymentId,
        externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
        rawPayload: {
          payment: paymentResult.raw,
          gateway_subscription: preapprovalResult.raw,
        },
        db: conn,
      })
      updated = upgradeProcessing.subscription || updated
    }

    await conn.commit()
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }

  if (upgradeProcessing?.schedulePlan?.reserved_credit_cents > 0) {
    try {
      await syncCardCreditScheduleWithGateway(updated, upgradeProcessing.schedulePlan, {
        requestId: gatewayEventId || authorizedPayment.id || authorizedPaymentId,
        operation: 'subscription_credit_schedule_sync',
      })
    } catch (error) {
      await releaseCardCreditScheduleOnFailure(updated?.id, {
        reason: 'gateway_schedule_sync_failed',
        externalReference: preapprovalResult?.subscription?.externalReference || localSubscription.externalReference || null,
      })
      console.warn('[billing][authorized_payment][credit_schedule_sync_failed]', {
        subscription_id: updated?.id || null,
        gateway_subscription_id: updated?.gatewaySubscriptionId || null,
        message: error?.message || error,
      })
    }
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
    upgrade_credit: upgradeProcessing?.credit || null,
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

async function handleDepositPaymentWebhook({
  resourceId,
  event,
  bodyUserId = null,
  ownerAccount = null,
  prefetchedPayment = null,
  accessToken: providedAccessToken = null,
}) {
  const providerPaymentId = normalizeId(resourceId)
  if (!providerPaymentId) return { ok: false, reason: 'missing_resource_id' }

  let paymentRow = await fetchAppointmentPaymentByProvider(providerPaymentId)
  let estabelecimentoId = paymentRow?.estabelecimento_id ?? ownerAccount?.estabelecimento_id ?? ownerAccount?.estabelecimentoId ?? null

  if (!estabelecimentoId && bodyUserId != null) {
    const account = ownerAccount || await getMpAccountBySellerIdentifier(bodyUserId)
    if (account?.estabelecimento_id || account?.estabelecimentoId) {
      estabelecimentoId = Number(account.estabelecimento_id || account.estabelecimentoId)
    }
  }

  if (!estabelecimentoId) {
    return { ok: false, reason: 'estabelecimento_not_found' }
  }

  const mpAccess = providedAccessToken
    ? { accessToken: providedAccessToken }
    : await resolveMpAccessToken(estabelecimentoId, { allowFallback: false })
  const accessToken = mpAccess.accessToken || null
  if (!accessToken) {
    return { ok: false, reason: 'mp_token_missing', estabelecimentoId }
  }

  let payment = prefetchedPayment || null
  if (!payment) {
    try {
      payment = await fetchMercadoPagoPayment(providerPaymentId, { accessToken })
    } catch (err) {
      console.warn('[billing:webhook][deposit] fetch_payment_failed', err?.message || err)
      return { ok: false, reason: 'mp_fetch_failed' }
    }
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
    const creditOverview = await getSubscriptionCreditOverview(req.user.id, {
      subscription: effective,
    })

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
      credits: creditOverview,
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
        message: createGuard.user_message || 'Já existe uma configuração recente de assinatura no cartão. Aguarde antes de tentar novamente.',
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
          message: createGuard.user_message || 'Já existe uma configuração recente de assinatura no cartão. Aguarde antes de tentar novamente.',
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
                ? 'Já existe uma cobrança em análise. Aguarde a confirmação antes de tentar novamente.'
                : 'A última tentativa no cartão não foi aprovada. Você pode tentar novamente ou gerar um PIX.'
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
        message: recoveryGuard?.user_message || 'Não foi possível iniciar a cobrança agora.',
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
          ? 'O pagamento está em análise pelo Mercado Pago. Aguarde a confirmação antes de tentar novamente.'
          : 'O cartão foi validado, mas a cobrança pendente não foi aprovada. Tente novamente ou gere um PIX.'
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
  const bodyUserId = resolveBillingWebhookBodyUserId(req, event)
  const liveMode = typeof event?.live_mode === 'boolean' ? event.live_mode : null
  const bodyType = event?.type ?? event?.topic ?? null
  const bodyAction = event?.action ?? null
  const syncDecision = resolveBillingWebhookSyncDecision({
    req,
    event,
    bodyUserId,
    bodyType,
    bodyAction,
  })
  const topic = syncDecision.topic || ''

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
  const requestId = String(req.headers['x-request-id'] || '').trim() || null
  const syncEvent = {
    ...event,
    _webhook: {
      request_id: requestId,
      topic: topic || null,
      query_topic: syncDecision.queryTopic || null,
      body_topic: syncDecision.bodyTopic || null,
      chosen_sync_target: syncDecision.chosenSyncTarget || null,
      chosen_by_rule: syncDecision.chosenByRule || null,
    },
  }

  try {
    const preResolvedOwnerResolution =
      syncDecision.chosenSyncTarget === 'authorized_payment'
        ? await resolveAuthorizedPaymentWebhookOwnerContext({
          resourceId,
          event: syncEvent,
          bodyUserId,
        })
        : syncDecision.chosenSyncTarget === 'subscription'
          ? await resolveSubscriptionWebhookOwnerContext({
            resourceId,
            event: syncEvent,
            bodyUserId,
          })
          : null

    logBillingWebhookSyncDecision({
      requestId,
      resourceId,
      decision: syncDecision,
      bodyType,
      bodyAction,
      event,
      ownerResolution: preResolvedOwnerResolution,
    })

    if (syncDecision.chosenSyncTarget === 'payment') {
      const paymentAction = await resolveBillingPaymentWebhookAction({
        resourceId,
        syncEvent,
        syncDecision,
        bodyUserId,
      })

      if (paymentAction.kind === 'seller_card_validation_ignored') {
        const estabelecimentoId =
          paymentAction.connectedAccount?.estabelecimento_id ||
          paymentAction.connectedAccount?.estabelecimentoId ||
          paymentAction.flowMatch?.estabelecimentoId ||
          null
        console.info('[billing:webhook] seller_card_validation_ignored', {
          request_id: requestId || null,
          resource_id: resourceId || null,
          body_user_id: bodyUserId ?? null,
          estabelecimento_id: estabelecimentoId,
          owner_type: 'establishment',
          matched_flow: 'card_validation',
          payment_status: paymentAction.flowMatch?.paymentStatus || null,
          operation_type: paymentAction.flowMatch?.operationType || null,
          transaction_amount: paymentAction.flowMatch?.transactionAmount ?? null,
          action_taken: 'ignored_card_validation',
          ignored_reason: 'card_validation_payment',
        })
        return res.status(200).json(paymentAction.responseBody)
      }

      if (
        paymentAction.connectedAccount &&
        (
          paymentAction.kind === 'seller_deposit' ||
          paymentAction.kind === 'seller_loyalty' ||
          paymentAction.kind === 'ignored_foreign_user_unmatched_flow' ||
          paymentAction.kind === 'conflicting_connected_seller_flow'
        )
      ) {
        const sellerFlowPayload = buildBillingWebhookSellerFlowMatchPayload({
          requestId,
          resourceId,
          syncDecision,
          bodyType,
          bodyAction,
          bodyUserId,
          connectedAccount: paymentAction.connectedAccount,
          matchedFlow: paymentAction.matchedFlow,
          flowMatch: paymentAction.flowMatch,
        })
        console.info('[billing:webhook] seller_payment_flow_match', sellerFlowPayload)
        if (paymentAction.kind === 'ignored_foreign_user_unmatched_flow' && paymentAction.flowMatch?.paymentFetched) {
          logSellerPaymentMatchFailures(sellerFlowPayload, paymentAction.flowMatch)
          console.warn('[billing:webhook] seller_payment_unmatched_after_gateway_fetch', sellerFlowPayload)
        }
        if (paymentAction.kind === 'conflicting_connected_seller_flow') {
          console.warn('[billing:webhook] conflicting_connected_seller_flow', sellerFlowPayload)
          return res.status(200).json(paymentAction.responseBody)
        }
      }

      if (paymentAction.kind === 'seller_deposit' || paymentAction.kind === 'seller_loyalty') {
        const actionTaken =
          paymentAction.kind === 'seller_deposit'
            ? (paymentAction.responseBody.processed ? 'deposit_processed' : 'deposit_acknowledged')
            : (paymentAction.responseBody.processed ? 'loyalty_processed' : 'loyalty_acknowledged')
        console.info('[billing:webhook] accepted_connected_seller_user', buildBillingWebhookSellerLogPayload({
          requestId,
          resourceId,
          syncDecision,
          bodyType,
          bodyAction,
          bodyUserId,
          connectedAccount: paymentAction.connectedAccount,
          matchedFlow: paymentAction.matchedFlow,
          actionTaken,
          reason:
            paymentAction.kind === 'seller_deposit'
              ? paymentAction.depositResult?.reason || null
              : paymentAction.loyaltyResult?.reason || null,
          depositReason: paymentAction.depositResult?.reason || null,
          loyaltyReason: paymentAction.loyaltyResult?.reason || null,
        }))
        return res.status(200).json(paymentAction.responseBody)
      }

      if (paymentAction.kind === 'ignored_foreign_user_unknown_account') {
        console.warn('[billing:webhook] ignored_foreign_user_unknown_account', buildBillingWebhookSellerLogPayload({
          requestId,
          resourceId,
          syncDecision,
          bodyType,
          bodyAction,
          bodyUserId,
          connectedAccount: null,
          matchedFlow: null,
          actionTaken: 'ignored',
          reason: paymentAction.responseBody.reason,
        }))
        return res.status(200).json(paymentAction.responseBody)
      }

      if (paymentAction.kind === 'ignored_foreign_user_unmatched_flow') {
        console.warn('[billing:webhook] ignored_foreign_user_unmatched_flow', buildBillingWebhookSellerLogPayload({
          requestId,
          resourceId,
          syncDecision,
          bodyType,
          bodyAction,
          bodyUserId,
          connectedAccount: paymentAction.connectedAccount,
          matchedFlow: null,
          actionTaken: 'ignored',
          reason: paymentAction.responseBody.reason,
          depositReason: paymentAction.depositResult?.reason || null,
          loyaltyReason: paymentAction.loyaltyResult?.reason || null,
        }))
        return res.status(200).json(paymentAction.responseBody)
      }

      if (paymentAction.kind === 'platform_deposit') {
        if (paymentAction.depositResult?.handled) {
          console.log('[billing:webhook][deposit] handled', resourceId, paymentAction.depositResult.status || 'ok')
        }
        return res.status(200).json(paymentAction.responseBody)
      }

      if (paymentAction.kind === 'platform_recovery') {
        const recoveryResult = paymentAction.recoveryResult
        console.log('[billing:webhook] subscription_recovery_payment', resourceId, recoveryResult?.handled ? 'processed' : 'ignored', {
          ok: !!recoveryResult?.ok,
          reason: recoveryResult?.reason || null,
          status: recoveryResult?.status || null,
          normalized_reason: recoveryResult?.paymentResult?.normalized_reason || null,
          status_detail: recoveryResult?.paymentResult?.status_detail || null,
        })
        return res.status(200).json(paymentAction.responseBody)
      }

      const r = paymentAction.platformResult
      console.log('[billing:webhook] payment', resourceId, r?.ok ? 'approved' : 'ignored', {
        ok: !!r?.ok,
        reason: r?.reason || null,
        already_processed: r?.already_processed === true,
        stale: r?.stale === true,
      })
      return res.status(200).json(paymentAction.responseBody)
    }

    if (syncDecision.chosenSyncTarget === 'authorized_payment') {
      const authorizedPaymentAction = await resolveBillingAuthorizedPaymentWebhookAction({
        resourceId,
        syncEvent,
        syncDecision,
        bodyUserId,
        ownerResolution: preResolvedOwnerResolution,
      })
      const ownerResolution = authorizedPaymentAction.ownerResolution || null
      const ownerResolutionPayload = buildBillingWebhookOwnerResolutionPayload({
        requestId,
        resourceId,
        syncDecision,
        bodyType,
        bodyAction,
        bodyUserId,
        event: syncEvent,
        ownerResolution,
      })
      console.info('[billing:webhook] owner_resolution_authorized_payment', ownerResolutionPayload)

      if (authorizedPaymentAction.kind === 'ignored_unresolved_authorized_payment_owner') {
        logAuthorizedPaymentLookupFailures(ownerResolutionPayload, ownerResolution)
        if (ownerResolution?.reason === 'seller_account_found_but_no_valid_token') {
          console.warn('[billing:webhook] seller_account_found_but_no_valid_token', ownerResolutionPayload)
        }
        if (ownerResolution?.reason === 'conflicting_owner_resolution') {
          console.warn('[billing:webhook] conflicting_owner_resolution', ownerResolutionPayload)
        } else {
          console.warn('[billing:webhook] unresolved_owner_for_authorized_payment', ownerResolutionPayload)
        }
        if (ownerResolution?.fallbackBlocked) {
          console.warn('[billing:webhook] fallback_to_platform_blocked', ownerResolutionPayload)
        }
        return res.status(200).json(authorizedPaymentAction.responseBody)
      }

      if (authorizedPaymentAction.kind === 'seller_authorized_payment') {
        const loyaltyResult = authorizedPaymentAction.loyaltyResult
        console.log('[billing:webhook][loyalty] subscription_authorized_payment', resourceId, loyaltyResult?.handled ? 'processed' : 'ignored', {
          ok: !!loyaltyResult?.ok,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
          interpreted_outcome: loyaltyResult?.payment_interpretation?.interpretedOutcome || null,
          transition_rule: loyaltyResult?.payment_interpretation?.transitionRule || null,
          status_detail: loyaltyResult?.failure?.status_detail || null,
          rejection_code: loyaltyResult?.failure?.code || null,
          rejection_description: loyaltyResult?.failure?.description || null,
          owner_type: ownerResolution?.ownerType || null,
          matched_flow: ownerResolution?.matchedFlow || null,
          token_source: ownerResolution?.tokenSource || null,
          resolution_rule: ownerResolution?.resolutionRule || null,
        })
        return res.status(200).json(authorizedPaymentAction.responseBody)
      }

      const result = authorizedPaymentAction.platformResult
      console.log('[billing:webhook] subscription_authorized_payment', resourceId, result?.ok ? 'processed' : 'ignored', {
        ok: !!result?.ok,
        reason: result?.reason || null,
        status: result?.paymentResult?.status || null,
        status_detail: result?.paymentResult?.status_detail || null,
        normalized_reason: result?.paymentResult?.normalized_reason || null,
        owner_type: ownerResolution?.ownerType || null,
        matched_flow: ownerResolution?.matchedFlow || null,
        token_source: ownerResolution?.tokenSource || null,
        resolution_rule: ownerResolution?.resolutionRule || null,
      })
      return res.status(200).json(authorizedPaymentAction.responseBody)
    }

    if (syncDecision.chosenSyncTarget === 'subscription') {
      const subscriptionAction = await resolveBillingSubscriptionWebhookAction({
        resourceId,
        syncEvent,
        syncDecision,
        bodyUserId,
        ownerResolution: preResolvedOwnerResolution,
      })
      const ownerResolution = subscriptionAction.ownerResolution || null
      const ownerResolutionPayload = buildBillingWebhookOwnerResolutionPayload({
        requestId,
        resourceId,
        syncDecision,
        bodyType,
        bodyAction,
        bodyUserId,
        event: syncEvent,
        ownerResolution,
      })
      console.info('[billing:webhook] owner_resolution_preapproval', ownerResolutionPayload)

      if (subscriptionAction.kind === 'ignored_unresolved_subscription_owner') {
        if (ownerResolution?.reason === 'seller_account_found_but_no_valid_token') {
          console.warn('[billing:webhook] seller_account_found_but_no_valid_token', ownerResolutionPayload)
        }
        if (ownerResolution?.reason === 'conflicting_owner_resolution') {
          console.warn('[billing:webhook] conflicting_owner_resolution', ownerResolutionPayload)
        } else {
          console.warn('[billing:webhook] unresolved_owner_for_preapproval', ownerResolutionPayload)
        }
        if (ownerResolution?.fallbackBlocked) {
          console.warn('[billing:webhook] fallback_to_platform_blocked', ownerResolutionPayload)
        }
        return res.status(200).json(subscriptionAction.responseBody)
      }

      if (subscriptionAction.kind === 'seller_subscription') {
        const loyaltyResult = subscriptionAction.loyaltyResult
        console.log('[billing:webhook][loyalty] subscription_preapproval', resourceId, loyaltyResult?.handled ? 'processed' : 'ignored', {
          ok: !!loyaltyResult?.ok,
          reason: loyaltyResult?.reason || null,
          status: loyaltyResult?.status || null,
          owner_type: ownerResolution?.ownerType || null,
          matched_flow: ownerResolution?.matchedFlow || null,
          token_source: ownerResolution?.tokenSource || null,
          lookup_by: ownerResolution?.lookupBy || null,
          resolution_rule: ownerResolution?.resolutionRule || null,
        })
        return res.status(200).json(subscriptionAction.responseBody)
      }

      const result = subscriptionAction.platformResult
      console.log('[billing:webhook] subscription_preapproval', resourceId, result?.ok ? 'processed' : 'ignored', {
        ok: !!result?.ok,
        reason: result?.reason || null,
        owner_type: ownerResolution?.ownerType || null,
        matched_flow: ownerResolution?.matchedFlow || null,
        token_source: ownerResolution?.tokenSource || null,
        lookup_by: ownerResolution?.lookupBy || null,
        resolution_rule: ownerResolution?.resolutionRule || null,
      })
      return res.status(200).json(subscriptionAction.responseBody)
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
    const currentContext = await loadEffectiveSubscriptionContext(req.user.id)
    const planContext = currentContext.planContext
    if (!planContext) {
      return res.status(404).json({ error: 'plan_context_not_found' })
    }
    const targetPlan = normalizePlanKey(planContext.plan || req.user.plan || 'starter') || 'starter'
    const targetCycle = normalizeBillingCycle(planContext.cycle || req.user.plan_cycle || 'mensal')
    const effectiveSubscription = currentContext.subscription || null
    const nominalAmountCents = getPlanPriceCents(targetPlan, targetCycle)

    const canApplyRenewalCredit =
      effectiveSubscription?.id &&
      normalizePlanKey(effectiveSubscription.plan) === targetPlan &&
      normalizeBillingCycle(effectiveSubscription.billingCycle) === targetCycle

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
      await releaseScheduledSubscriptionCreditApplicationsTx(pending.id, {
        reason: 'pending_pix_replaced',
        externalReference: pending.externalReference || null,
      })
    }

    if (canApplyRenewalCredit) {
      const fullCreditRenewal = await tryApplyFullCreditRenewal({
        estabelecimentoId: req.user.id,
        subscriptionId: effectiveSubscription.id,
        plan: targetPlan,
        billingCycle: targetCycle,
        nominalAmountCents,
      })
      if (fullCreditRenewal.covered && fullCreditRenewal.subscription) {
        await syncUserPlanContextFromSubscription(req.user.id, {
          plan: targetPlan,
          status: 'active',
          billingCycle: targetCycle,
          trialEndsAt: null,
          activeUntil: fullCreditRenewal.subscription.currentPeriodEnd || null,
          subscriptionId: fullCreditRenewal.subscription.id || null,
        })

        return res.json({
          ok: true,
          renewal: {
            hasOpenPayment: false,
            coveredByCredit: true,
            credit_applied_cents: fullCreditRenewal.appliedAmountCents,
          },
          subscription: serializeSubscription(fullCreditRenewal.subscription),
          credits: await getSubscriptionCreditOverview(req.user.id, {
            subscription: fullCreditRenewal.subscription,
          }),
        })
      }
    }

    let partialCreditCents = 0
    let placeholderSubscription = null
    if (canApplyRenewalCredit) {
      const reservation = await reservePendingPixCreditDiscount({
        estabelecimentoId: req.user.id,
        plan: targetPlan,
        billingCycle: targetCycle,
        nominalAmountCents,
      })
      if (reservation.shouldRetryFullCredit) {
        const fullCreditRenewal = await tryApplyFullCreditRenewal({
          estabelecimentoId: req.user.id,
          subscriptionId: effectiveSubscription.id,
          plan: targetPlan,
          billingCycle: targetCycle,
          nominalAmountCents,
        })
        if (fullCreditRenewal.covered && fullCreditRenewal.subscription) {
          await syncUserPlanContextFromSubscription(req.user.id, {
            plan: targetPlan,
            status: 'active',
            billingCycle: targetCycle,
            trialEndsAt: null,
            activeUntil: fullCreditRenewal.subscription.currentPeriodEnd || null,
            subscriptionId: fullCreditRenewal.subscription.id || null,
          })

          return res.json({
            ok: true,
            renewal: {
              hasOpenPayment: false,
              coveredByCredit: true,
              credit_applied_cents: fullCreditRenewal.appliedAmountCents,
            },
            subscription: serializeSubscription(fullCreditRenewal.subscription),
            credits: await getSubscriptionCreditOverview(req.user.id, {
              subscription: fullCreditRenewal.subscription,
            }),
          })
        }
      }
      partialCreditCents = reservation.reservedAmountCents || 0
      placeholderSubscription = reservation.placeholderSubscription || null
    }

    let result = null
    try {
      result = await createMercadoPagoPixCheckout({
        estabelecimento: { id: req.user.id, email: req.user.email },
        plan: targetPlan,
        billingCycle: targetCycle,
        amountCentsOverride: partialCreditCents > 0 ? nominalAmountCents - partialCreditCents : null,
        metadataExtras: partialCreditCents > 0
          ? {
              charge_kind: 'renewal',
              credit_reserved_cents: partialCreditCents,
            }
          : { charge_kind: 'renewal' },
        existingSubscriptionId: placeholderSubscription?.id || null,
      })
    } catch (error) {
      if (placeholderSubscription?.id) {
        await cleanupPendingPixCreditDiscount(placeholderSubscription.id, {
          reason: 'pending_pix_checkout_failed',
        })
      }
      throw error
    }

    if (partialCreditCents > 0 && result?.subscription?.id) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await appendSubscriptionEvent(result.subscription.id, {
          eventType: 'subscription_credit_reserved',
          gatewayEventId: `pending-pix-credit:${result.subscription.id}`,
          payload: {
            payment_method: 'pix',
            application_type: 'pending_pix_discount',
            amount_cents: partialCreditCents,
            nominal_amount_cents: nominalAmountCents,
            discounted_amount_cents: nominalAmountCents - partialCreditCents,
            plan: targetPlan,
            billing_cycle: targetCycle,
          },
        }, { db: conn })
        await conn.commit()
      } catch (error) {
        try { await conn.rollback() } catch {}
        await cleanupPendingPixCreditDiscount(result.subscription.id, {
          reason: 'pending_pix_credit_event_failed',
          externalReference: result.subscription.externalReference || null,
        })
        throw error
      } finally {
        conn.release()
      }
    }
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
      renewal: {
        hasOpenPayment: true,
        openPayment: newOpenPayment,
        nominal_amount_cents: nominalAmountCents,
        credit_reserved_cents: partialCreditCents,
      },
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

export {
  normalizeBillingWebhookTopic,
  resolveAuthorizedPaymentWebhookOwnerContext,
  resolveBillingAuthorizedPaymentWebhookAction,
  resolveBillingSubscriptionWebhookAction,
  resolveBillingWebhookBodyUserId,
  resolveConnectedSellerPaymentFlowMatch,
  resolveBillingPaymentWebhookAction,
  resolveBillingWebhookSyncDecision,
  resolveSubscriptionWebhookOwnerContext,
}

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
