import { pool } from '../lib/db.js'
import {
  CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD,
  analyzeClientLoyaltyCardholderName,
  cancelClientLoyaltySubscriptionForClient,
  createClientLoyaltyPixCheckout,
  loadClientLoyaltySubscriptionDetails,
  resolveClientLoyaltyCardholderNameInput,
  startClientLoyaltyCardSubscription,
  syncClientLoyaltyPaymentFromGateway,
  syncClientLoyaltyAuthorizedPaymentFromGateway,
  syncClientLoyaltyCardSubscriptionFromGateway,
} from '../lib/client_loyalty_billing.js'
import { resolveClientLoyaltyIgnoredReasonForStorage } from '../lib/client_loyalty_subscriptions.js'
import { disconnectMpAccount, getMpAccountBySellerIdentifier } from './mpAccounts.js'

function safeJsonStringify(value) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function isMissingTableError(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146
}

function normalizeTopic(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'payment') return 'payment'
  if (['subscription_preapproval', 'subscription', 'preapproval'].includes(normalized)) return 'subscription'
  if (['subscription_authorized_payment', 'automatic-payments', 'automatic_payment', 'automatic-payments'].includes(normalized)) {
    return 'automatic-payments'
  }
  if (['mp-connect', 'mp_connect'].includes(normalized)) return 'mp-connect'
  return normalized
}

function resolveActionName(event = {}, req = null) {
  return String(
    event?.action ||
      req?.query?.action ||
      req?.headers?.['x-action'] ||
      ''
  ).trim().toLowerCase() || null
}

function resolveBodyUserId(event = {}, req = null) {
  const raw = req?.query?.user_id ?? event?.user_id ?? event?.userId ?? event?.data?.user_id ?? null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveResourceId(event = {}, req = null, verification = null) {
  return String(
    verification?.id ||
      req?.query?.id ||
      req?.query?.['data.id'] ||
      event?.data?.id ||
      event?.resource ||
      event?.id ||
      ''
  ).trim() || null
}

function buildOwnerContext(account = null) {
  return {
    ownerType: 'establishment',
    ownerId: account?.estabelecimento_id || account?.estabelecimentoId || null,
    estabelecimentoId: account?.estabelecimento_id || account?.estabelecimentoId || null,
    mpUserId: account?.mp_user_id || account?.mpUserId || null,
    mpCollectorId:
      account?.mp_collector_id ||
      account?.mpCollectorId ||
      account?.mp_user_id ||
      account?.mpUserId ||
      null,
  }
}

function buildDeliveryKey({ topic, actionName = null, resourceId, bodyUserId = null, estabelecimentoId = null }) {
  return [
    'seller',
    String(topic || ''),
    String(actionName || ''),
    String(resourceId || ''),
    String(bodyUserId || ''),
    String(estabelecimentoId || ''),
  ].join(':')
}

export const normalizeMercadoPagoSellerWebhookTopic = normalizeTopic
export const buildMercadoPagoSellerWebhookDeliveryKey = buildDeliveryKey

async function insertWebhookDelivery({
  requestId = null,
  deliveryKey,
  ownerContext,
  topic,
  actionName = null,
  resourceId = null,
  rawPayload = null,
}) {
  if (!deliveryKey) return { id: null, duplicated: false }
  try {
    const [result] = await pool.query(
      `INSERT INTO mercadopago_webhook_events
        (
          request_id,
          delivery_key,
          owner_type,
          owner_id,
          estabelecimento_id,
          mp_user_id,
          mp_collector_id,
          topic,
          action_name,
          resource_id,
          raw_payload
        )
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        requestId || null,
        deliveryKey,
        ownerContext.ownerType || 'establishment',
        ownerContext.ownerId || null,
        ownerContext.estabelecimentoId || null,
        ownerContext.mpUserId || null,
        ownerContext.mpCollectorId || null,
        topic || null,
        actionName || null,
        resourceId || null,
        safeJsonStringify(rawPayload),
      ]
    )
    return { id: result.insertId, duplicated: false }
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return { id: null, duplicated: true }
    }
    if (isMissingTableError(error)) {
      return { id: null, duplicated: false }
    }
    throw error
  }
}

async function finalizeWebhookDelivery(id, {
  ownerContext,
  externalReference = null,
  loyaltySubscriptionId = null,
  actionTaken = null,
  ignoredReason = null,
} = {}) {
  if (!id) return
  const ignoredReasonResolution = resolveClientLoyaltyIgnoredReasonForStorage(ignoredReason)
  try {
    await pool.query(
      `UPDATE mercadopago_webhook_events
          SET owner_type=?,
              owner_id=?,
              estabelecimento_id=?,
              mp_user_id=?,
              mp_collector_id=?,
              external_reference=?,
              loyalty_subscription_id=?,
              action_taken=?,
              ignored_reason=?,
              updated_at=NOW()
        WHERE id=?`,
      [
        ownerContext?.ownerType || 'establishment',
        ownerContext?.ownerId || null,
        ownerContext?.estabelecimentoId || null,
        ownerContext?.mpUserId || null,
        ownerContext?.mpCollectorId || null,
        externalReference || null,
        loyaltySubscriptionId || null,
        actionTaken || null,
        ignoredReasonResolution.normalizedReason || null,
        id,
      ]
    )
  } catch (error) {
    if (!isMissingTableError(error)) throw error
  }
}

function normalizeSellerWebhookResponse(result, defaults = {}) {
  return {
    ok: result?.ok !== false,
    processed: Boolean(result?.handled),
    status: result?.status || defaults.status || null,
    reason: result?.reason || defaults.reason || null,
    failure: result?.failure || null,
    subscription: result?.subscription || null,
  }
}

export {
  CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD,
  analyzeClientLoyaltyCardholderName,
  cancelClientLoyaltySubscriptionForClient,
  createClientLoyaltyPixCheckout,
  loadClientLoyaltySubscriptionDetails,
  resolveClientLoyaltyCardholderNameInput,
  startClientLoyaltyCardSubscription,
}

export async function processLoyaltyMercadoPagoSellerWebhook(req, verification) {
  const event = req.body || {}
  const topic = normalizeTopic(
    req.query?.topic ||
      req.query?.type ||
      event?.topic ||
      event?.type ||
      req.headers['x-topic'] ||
      ''
  )
  const actionName = resolveActionName(event, req)
  const bodyUserId = resolveBodyUserId(event, req)
  const resourceId = resolveResourceId(event, req, verification)

  if (!resourceId) {
    return {
      ok: true,
      processed: false,
      reason: 'missing_resource_id',
      owner: { owner_type: 'establishment' },
    }
  }

  const ownerAccount = bodyUserId ? await getMpAccountBySellerIdentifier(bodyUserId) : null
  const ownerContext = buildOwnerContext(ownerAccount)
  const deliveryKey = buildDeliveryKey({
    topic,
    actionName,
    resourceId,
    bodyUserId,
    estabelecimentoId: ownerContext.estabelecimentoId,
  })
  const delivery = await insertWebhookDelivery({
    requestId: req.requestId || null,
    deliveryKey,
    ownerContext,
    topic,
    actionName,
    resourceId,
    rawPayload: event,
  })

  if (delivery.duplicated) {
    return {
      ok: true,
      processed: false,
      reason: 'duplicate_delivery',
      owner: {
        owner_type: ownerContext.ownerType,
        owner_id: ownerContext.ownerId,
        estabelecimento_id: ownerContext.estabelecimentoId,
        mp_user_id: ownerContext.mpUserId,
        mp_collector_id: ownerContext.mpCollectorId,
      },
    }
  }

  let result = null
  let actionTaken = null
  let ignoredReason = null

  if (topic === 'payment') {
    result = normalizeSellerWebhookResponse(
      await syncClientLoyaltyPaymentFromGateway(resourceId, {
        bodyUserId,
        gatewayEventId: deliveryKey,
        sellerAccount: ownerAccount,
      })
    )
    actionTaken = result.processed ? 'payment_synced' : null
    ignoredReason = result.reason || null
  } else if (topic === 'subscription') {
    result = normalizeSellerWebhookResponse(
      await syncClientLoyaltyCardSubscriptionFromGateway(resourceId, {
        bodyUserId,
        gatewayEventId: deliveryKey,
      })
    )
    actionTaken = result.processed ? 'subscription_synced' : null
    ignoredReason = result.reason || null
  } else if (topic === 'automatic-payments') {
    result = normalizeSellerWebhookResponse(
      await syncClientLoyaltyAuthorizedPaymentFromGateway(resourceId, {
        bodyUserId,
        gatewayEventId: deliveryKey,
      })
    )
    actionTaken = result.processed ? 'automatic_payment_synced' : null
    ignoredReason = result.reason || null
  } else if (topic === 'mp-connect') {
    if (ownerContext.estabelecimentoId && /revok|disconnect|authoriz.*removed|authorization_deleted/.test(String(actionName || ''))) {
      await disconnectMpAccount(ownerContext.estabelecimentoId)
      actionTaken = 'account_revoked'
    } else {
      actionTaken = 'account_event_logged'
    }
    result = {
      ok: true,
      processed: false,
      status: null,
      reason: null,
      subscription: null,
      failure: null,
    }
  } else {
    result = {
      ok: true,
      processed: false,
      status: null,
      reason: 'unsupported_topic',
      subscription: null,
      failure: null,
    }
    ignoredReason = 'unsupported_topic'
  }

  const effectiveOwnerContext = result?.subscription?.estabelecimentoId
    ? {
        ...ownerContext,
        ownerId: result.subscription.estabelecimentoId,
        estabelecimentoId: result.subscription.estabelecimentoId,
      }
    : ownerContext

  await finalizeWebhookDelivery(delivery.id, {
    ownerContext: effectiveOwnerContext,
    externalReference: result?.subscription?.externalReference || null,
    loyaltySubscriptionId: result?.subscription?.id || null,
    actionTaken,
    ignoredReason,
  })

  return {
    ok: true,
    processed: Boolean(result?.processed),
    status: result?.status || null,
    reason: result?.reason || null,
    failure: result?.failure || null,
    owner: {
      owner_type: effectiveOwnerContext.ownerType,
      owner_id: effectiveOwnerContext.ownerId,
      estabelecimento_id: effectiveOwnerContext.estabelecimentoId,
      mp_user_id: effectiveOwnerContext.mpUserId,
      mp_collector_id: effectiveOwnerContext.mpCollectorId,
    },
    subscription_id: result?.subscription?.id || null,
  }
}
