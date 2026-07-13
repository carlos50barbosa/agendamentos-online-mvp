import { pool } from './db.js'
import { toDatabaseDateTime } from './database_datetime.js'
import { sanitizeMercadoPagoSensitivePayload } from './mercadopago_card_tokens.js'
import { createHash } from 'node:crypto'

export const CLIENT_LOYALTY_STATUSES = new Set([
  'trialing',
  'active',
  'pending_payment',
  'pending_pix',
  'past_due',
  'unpaid',
  'expired',
  'canceled',
])

export const CLIENT_LOYALTY_PAYMENT_METHODS = new Set(['credit_card', 'pix'])
export const CLIENT_LOYALTY_OWNER_TYPES = new Set(['platform', 'establishment'])
export const CLIENT_LOYALTY_GATEWAY_EVENT_ID_DB_LENGTH = 191
export const CLIENT_LOYALTY_GATEWAY_EVENT_ID_SAFE_LENGTH = 120
export const CLIENT_LOYALTY_IGNORED_REASON_DB_LENGTH = 191
export const CLIENT_LOYALTY_IGNORED_REASON_SAFE_LENGTH = 80

const COLUMN_MAP = {
  clienteId: 'cliente_id',
  estabelecimentoId: 'estabelecimento_id',
  loyaltyPlanId: 'loyalty_plan_id',
  ownerType: 'owner_type',
  sellerMpAccountId: 'seller_mp_account_id',
  status: 'status',
  paymentMethod: 'payment_method',
  gateway: 'gateway',
  gatewayCustomerId: 'gateway_customer_id',
  mpPayerId: 'mp_payer_id',
  gatewaySubscriptionId: 'gateway_subscription_id',
  mpPreapprovalId: 'mp_preapproval_id',
  gatewayPaymentId: 'gateway_payment_id',
  externalReference: 'external_reference',
  startedAt: 'started_at',
  currentPeriodStart: 'current_period_start',
  currentPeriodEnd: 'current_period_end',
  nextBillingAt: 'next_billing_at',
  lastPaymentAt: 'last_payment_at',
  graceUntil: 'grace_until',
  cancelAt: 'cancel_at',
  canceledAt: 'canceled_at',
  autoRenew: 'auto_renew',
}

const DATETIME_FIELDS = new Set([
  'startedAt',
  'currentPeriodStart',
  'currentPeriodEnd',
  'nextBillingAt',
  'lastPaymentAt',
  'graceUntil',
  'cancelAt',
  'canceledAt',
])

function safeJsonParse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function stableHash(value, length = 32) {
  const input = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return createHash('sha256').update(input || '').digest('hex').slice(0, length)
}

function normalizeReasonToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function resolveClientLoyaltyIgnoredReasonForStorage(value, {
  maxLength = CLIENT_LOYALTY_IGNORED_REASON_SAFE_LENGTH,
} = {}) {
  const originalReason = value == null ? '' : String(value).trim()
  if (!originalReason) {
    return {
      originalReason: null,
      normalizedReason: null,
      originalLength: 0,
      changed: false,
      strategy: 'empty',
    }
  }

  const normalizedText = originalReason.toLowerCase()
  if (/card token was generated without cvv validation/i.test(originalReason) ||
      /without cvv validation/i.test(originalReason) ||
      normalizedText === 'card_token_without_cvv_validation') {
    return {
      originalReason,
      normalizedReason: 'card_token_without_cvv_validation',
      originalLength: originalReason.length,
      changed: originalReason !== 'card_token_without_cvv_validation',
      strategy: 'known_gateway_error',
    }
  }

  const token = normalizeReasonToken(originalReason) || 'ignored'
  if (token.length <= maxLength) {
    return {
      originalReason,
      normalizedReason: token,
      originalLength: originalReason.length,
      changed: token !== originalReason,
      strategy: 'normalized_token',
    }
  }

  const hash = stableHash(originalReason, 8)
  const normalizedReason = `${token.slice(0, Math.max(1, maxLength - 9))}_${hash}`
  return {
    originalReason,
    normalizedReason,
    originalLength: originalReason.length,
    changed: true,
    strategy: 'normalized_token_hash_suffix',
  }
}

function normalizeIdToken(value, fallback = '') {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '_')
  return normalized || fallback
}

function resolveGatewayEventIdResourceType({ mpTopic = null, paymentType = null, payload = null } = {}) {
  const snapshot = payload?.snapshot || payload?.payment_snapshot || null
  const target = String(snapshot?.payment_target || '').trim().toLowerCase()
  const topic = String(mpTopic || '').trim().toLowerCase()
  const type = String(paymentType || '').trim().toLowerCase()
  if (target === 'authorized_payment' || topic === 'automatic-payments' || type === 'subscription_authorized_payment') {
    return 'ap'
  }
  if (target === 'preapproval' || topic === 'subscription' || type === 'subscription_preapproval') {
    return 'pa'
  }
  return 'pay'
}

function resolveGatewayEventIdResourceId(raw = '', {
  mpPaymentId = null,
  payload = null,
} = {}) {
  const snapshot = payload?.snapshot || payload?.payment_snapshot || null
  const rawPayment = payload?.payment || payload?.raw?.payment || payload?.raw || null
  const direct = normalizeIdToken(
    mpPaymentId ||
      snapshot?.payment_id ||
      rawPayment?.id ||
      payload?.authorized_payment_id ||
      payload?.payment_id ||
      ''
  )
  if (direct) return direct

  const text = String(raw || '')
  const authorizedMatch = text.match(/(?:authorized_payment|automatic-payments|ap)[:/_-]+([A-Za-z0-9._-]+)/i)
  if (authorizedMatch?.[1]) return normalizeIdToken(authorizedMatch[1])
  const preapprovalMatch = text.match(/(?:preapproval|subscription|pa)[:/_-]+([A-Za-z0-9._-]+)/i)
  if (preapprovalMatch?.[1]) return normalizeIdToken(preapprovalMatch[1])
  const paymentMatch = text.match(/(?:payment|pay)[:/_-]+([A-Za-z0-9._-]+)/i)
  if (paymentMatch?.[1]) return normalizeIdToken(paymentMatch[1])
  return ''
}

function resolveGatewayEventIdPrefix(eventType = '') {
  const type = String(eventType || '').trim().toLowerCase()
  const prefixes = {
    payment_snapshot: 'snap',
    payment_status_transition: 'pst',
    payment_pending: 'pending',
    payment_failed: 'failed',
    payment_expired: 'expired',
    subscription_renewed: 'renewal',
    subscription_canceled: 'cancel',
    card_subscription_created: 'sub',
    card_subscription_create_failed: 'subfail',
  }
  return prefixes[type] || normalizeIdToken(type, 'evt').slice(0, 24)
}

function resolveGatewayEventIdHashSource(raw = '', { payload = null } = {}) {
  if (payload && typeof payload === 'object') {
    return {
      previous_subscription_status: payload.previous_subscription_status || null,
      next_subscription_status: payload.next_subscription_status || null,
      transition_rule: payload.transition_rule || null,
      snapshot: payload.snapshot || payload.payment_snapshot || null,
    }
  }
  return String(raw || '')
}

export function normalizeClientLoyaltyGatewayEventId(gatewayEventId, context = {}) {
  const originalId = gatewayEventId == null ? '' : String(gatewayEventId).trim()
  if (!originalId) {
    return {
      originalId: null,
      normalizedId: null,
      originalLength: 0,
      changed: false,
      strategy: 'empty',
      hashFallback: false,
    }
  }

  if (originalId.length <= CLIENT_LOYALTY_GATEWAY_EVENT_ID_SAFE_LENGTH) {
    return {
      originalId,
      normalizedId: originalId,
      originalLength: originalId.length,
      changed: false,
      strategy: 'original',
      hashFallback: false,
    }
  }

  const eventType = String(context.eventType || '').trim()
  const resourceId = resolveGatewayEventIdResourceId(originalId, context)
  if (resourceId) {
    const prefix = resolveGatewayEventIdPrefix(eventType)
    const resourceType = resolveGatewayEventIdResourceType(context)
    const hash = stableHash(resolveGatewayEventIdHashSource(originalId, context), 12)
    const normalizedId = `${prefix}:${resourceType}:${resourceId}:${hash}`.slice(0, CLIENT_LOYALTY_GATEWAY_EVENT_ID_SAFE_LENGTH)
    return {
      originalId,
      normalizedId,
      originalLength: originalId.length,
      changed: normalizedId !== originalId,
      strategy: `${resourceType}_resource_hash`,
      hashFallback: false,
    }
  }

  return {
    originalId,
    normalizedId: `hash:${stableHash(originalId, 32)}`,
    originalLength: originalId.length,
    changed: true,
    strategy: 'sha256_32',
    hashFallback: true,
  }
}

function logClientLoyaltyGatewayEventIdNormalization(resolution, context = {}) {
  if (!resolution?.changed) return
  console.info('[client-loyalty] event_id_normalized', {
    event_type: context.eventType || null,
    mp_topic: context.mpTopic || null,
    payment_type: context.paymentType || null,
    original_length: resolution.originalLength || 0,
    original_id: resolution.originalId && resolution.originalId.length <= 220
      ? resolution.originalId
      : `${String(resolution.originalId || '').slice(0, 200)}...`,
    normalized_id: resolution.normalizedId || null,
    strategy: resolution.strategy || null,
    fallback_hash: Boolean(resolution.hashFallback),
  })
}

function withGatewayEventIdNormalizationPayload(payload, resolution) {
  if (!resolution?.changed) return payload
  const metadata = {
    original_gateway_event_id: resolution.originalId || null,
    original_gateway_event_id_length: resolution.originalLength || 0,
    normalized_gateway_event_id: resolution.normalizedId || null,
    strategy: resolution.strategy || null,
    fallback_hash: Boolean(resolution.hashFallback),
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...payload,
      event_id_normalization: metadata,
    }
  }
  return {
    value: payload ?? null,
    event_id_normalization: metadata,
  }
}

function withIgnoredReasonNormalizationPayload(payload, resolution) {
  if (!resolution?.changed) return payload
  const metadata = {
    original_reason: resolution.originalReason || null,
    original_length: resolution.originalLength || 0,
    normalized_reason: resolution.normalizedReason || null,
    strategy: resolution.strategy || null,
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...payload,
      ignored_reason_normalization: metadata,
    }
  }
  return {
    value: payload ?? null,
    ignored_reason_normalization: metadata,
  }
}

function isMissingTableError(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146
}

export function normalizeClientLoyaltyOwnerType(value, fallback = 'establishment') {
  const normalized = String(value || '').trim().toLowerCase()
  return CLIENT_LOYALTY_OWNER_TYPES.has(normalized) ? normalized : fallback
}

export function normalizeClientLoyaltyStatus(value, fallback = 'pending_pix') {
  const normalized = String(value || '').trim().toLowerCase()
  return CLIENT_LOYALTY_STATUSES.has(normalized) ? normalized : fallback
}

export function normalizeClientLoyaltyPaymentMethod(value, fallback = 'pix') {
  const normalized = String(value || '').trim().toLowerCase()
  return CLIENT_LOYALTY_PAYMENT_METHODS.has(normalized) ? normalized : fallback
}

/**
 * Serializa a data no fuso LOCAL, e não em UTC.
 *
 * O MySQL deste projeto roda em horário local — medido, não suposto:
 *   NOW() lido em JS        -> 18:48Z  (= agora, correto)
 *   UTC_TIMESTAMP() lido    -> 21:48Z  (3h à frente)
 * E o mysql2 lê DATETIME interpretando no fuso local do processo (a conexão não define
 * `timezone`). Ou seja: gravar `toISOString()` (UTC) enfia um relógio UTC numa coluna local,
 * e o valor volta 3 HORAS NO FUTURO.
 *
 * O estrago concreto: `current_period_start` nascia 3h adiante, `withinCurrentPeriod` ficava
 * false, `benefitsActive` ficava false — **o cliente pagava o plano e ficava 3 horas sem
 * benefício nenhum**, justamente quando ele iria agendar. Só apareceu ao rodar o ciclo
 * completo contra o Asaas de verdade.
 *
 * Este arquivo só é usado pelo módulo de fidelidade (sem dados em produção). O
 * `toDatabaseDateTime` global tem o mesmo defeito e é usado por `subscriptions.js` (o billing
 * do tenant, esse SIM com dados em produção) — corrigir lá é outra conversa, com outro risco.
 */
function toLocalDatabaseDateTime(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function normalizePersistenceValue(key, value, fields = {}) {
  if (key === 'ownerType') return normalizeClientLoyaltyOwnerType(value, fields.ownerType || 'establishment')
  if (key === 'status') return normalizeClientLoyaltyStatus(value, fields.status || 'pending_pix')
  if (key === 'paymentMethod') return normalizeClientLoyaltyPaymentMethod(value, fields.paymentMethod || 'pix')
  if (key === 'autoRenew') return value ? 1 : 0
  if (DATETIME_FIELDS.has(key)) return toLocalDatabaseDateTime(value)
  return value
}

function toDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function mapRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    clienteId: Number(row.cliente_id),
    estabelecimentoId: Number(row.estabelecimento_id),
    loyaltyPlanId: Number(row.loyalty_plan_id),
    ownerType: normalizeClientLoyaltyOwnerType(row.owner_type),
    sellerMpAccountId: row.seller_mp_account_id == null ? null : Number(row.seller_mp_account_id),
    status: normalizeClientLoyaltyStatus(row.status),
    paymentMethod: normalizeClientLoyaltyPaymentMethod(row.payment_method),
    gateway: row.gateway || 'mercadopago',
    gatewayCustomerId: row.gateway_customer_id || null,
    mpPayerId: row.mp_payer_id || row.gateway_customer_id || null,
    gatewaySubscriptionId: row.gateway_subscription_id || null,
    mpPreapprovalId: row.mp_preapproval_id || row.gateway_subscription_id || null,
    gatewayPaymentId: row.gateway_payment_id || null,
    externalReference: row.external_reference || null,
    startedAt: toDate(row.started_at),
    currentPeriodStart: toDate(row.current_period_start),
    currentPeriodEnd: toDate(row.current_period_end),
    nextBillingAt: toDate(row.next_billing_at),
    lastPaymentAt: toDate(row.last_payment_at),
    graceUntil: toDate(row.grace_until),
    cancelAt: toDate(row.cancel_at),
    canceledAt: toDate(row.canceled_at),
    autoRenew: Boolean(row.auto_renew ?? 1),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  }
}

export function computeClientLoyaltySubscriptionState(subscription, { referenceDate = new Date() } = {}) {
  if (!subscription) {
    return {
      resolvedStatus: 'expired',
      withinCurrentPeriod: false,
      benefitsActive: false,
      cancelScheduled: false,
      renewalAllowed: false,
    }
  }

  const status = normalizeClientLoyaltyStatus(subscription.status)
  const reference = toDate(referenceDate) || new Date()
  const start = toDate(subscription.currentPeriodStart)
  const end = toDate(subscription.currentPeriodEnd)
  const withinCurrentPeriod = Boolean(
    start &&
    end &&
    reference.getTime() >= start.getTime() &&
    reference.getTime() <= end.getTime()
  )

  const cancelScheduled = Boolean(subscription.canceledAt && end && end.getTime() > Date.now())
  const benefitsActive =
    withinCurrentPeriod &&
    ['active', 'past_due', 'unpaid', 'canceled'].includes(status)

  let resolvedStatus = status
  if (['active', 'past_due', 'unpaid', 'canceled'].includes(status) && end && reference.getTime() > end.getTime()) {
    resolvedStatus = 'expired'
  }
  if (status === 'pending_pix' && end && reference.getTime() > end.getTime()) {
    resolvedStatus = 'expired'
  }

  return {
    resolvedStatus,
    withinCurrentPeriod,
    benefitsActive,
    cancelScheduled,
    renewalAllowed: Boolean(subscription.autoRenew && !subscription.canceledAt),
  }
}

export function serializeClientLoyaltySubscription(subscription, options = {}) {
  if (!subscription) return null
  const state = computeClientLoyaltySubscriptionState(subscription, options)
  return {
    id: subscription.id,
    cliente_id: subscription.clienteId,
    estabelecimento_id: subscription.estabelecimentoId,
    loyalty_plan_id: subscription.loyaltyPlanId,
    owner_type: normalizeClientLoyaltyOwnerType(subscription.ownerType),
    seller_mp_account_id: subscription.sellerMpAccountId ?? null,
    status: state.resolvedStatus,
    status_raw: normalizeClientLoyaltyStatus(subscription.status),
    payment_method: normalizeClientLoyaltyPaymentMethod(subscription.paymentMethod),
    gateway: subscription.gateway || 'mercadopago',
    gateway_customer_id: subscription.gatewayCustomerId || null,
    mp_payer_id: subscription.mpPayerId || subscription.gatewayCustomerId || null,
    gateway_subscription_id: subscription.gatewaySubscriptionId || null,
    mp_preapproval_id: subscription.mpPreapprovalId || subscription.gatewaySubscriptionId || null,
    gateway_payment_id: subscription.gatewayPaymentId || null,
    external_reference: subscription.externalReference || null,
    started_at: subscription.startedAt ? subscription.startedAt.toISOString() : null,
    current_period_start: subscription.currentPeriodStart ? subscription.currentPeriodStart.toISOString() : null,
    current_period_end: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    next_billing_at: subscription.nextBillingAt ? subscription.nextBillingAt.toISOString() : null,
    last_payment_at: subscription.lastPaymentAt ? subscription.lastPaymentAt.toISOString() : null,
    grace_until: subscription.graceUntil ? subscription.graceUntil.toISOString() : null,
    cancel_at: subscription.cancelAt ? subscription.cancelAt.toISOString() : null,
    canceled_at: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
    auto_renew: Boolean(subscription.autoRenew),
    created_at: subscription.createdAt ? subscription.createdAt.toISOString() : null,
    updated_at: subscription.updatedAt ? subscription.updatedAt.toISOString() : null,
    computed_state: state,
  }
}

export async function getClientLoyaltySubscriptionById(id, { db = pool } = {}) {
  const [rows] = await db.query('SELECT * FROM client_loyalty_subscriptions WHERE id=? LIMIT 1', [id])
  return mapRow(rows?.[0])
}

export async function getClientLoyaltySubscriptionByGatewayId(gatewaySubscriptionId, { db = pool } = {}) {
  if (!gatewaySubscriptionId) return null
  const [rows] = await db.query(
    'SELECT * FROM client_loyalty_subscriptions WHERE gateway_subscription_id=? OR mp_preapproval_id=? LIMIT 1',
    [String(gatewaySubscriptionId), String(gatewaySubscriptionId)]
  )
  return mapRow(rows?.[0])
}

export async function getClientLoyaltySubscriptionByGatewayPaymentId(gatewayPaymentId, { db = pool } = {}) {
  if (!gatewayPaymentId) return null
  const [rows] = await db.query(
    'SELECT * FROM client_loyalty_subscriptions WHERE gateway_payment_id=? ORDER BY id DESC LIMIT 1',
    [String(gatewayPaymentId)]
  )
  return mapRow(rows?.[0])
}

export async function getClientLoyaltySubscriptionByExternalReference(externalReference, { db = pool } = {}) {
  if (!externalReference) return null
  const [rows] = await db.query(
    'SELECT * FROM client_loyalty_subscriptions WHERE external_reference=? ORDER BY id DESC LIMIT 1',
    [String(externalReference)]
  )
  return mapRow(rows?.[0])
}

export async function getClientLoyaltySubscriptionByEventResourceId(resourceId, {
  mpTopic = null,
  paymentType = null,
  db = pool,
} = {}) {
  if (!resourceId) return null

  const filters = ['(ev.mp_payment_id=? OR ev.gateway_event_id=?)']
  const values = [String(resourceId), String(resourceId)]

  if (mpTopic) {
    filters.push('ev.mp_topic=?')
    values.push(String(mpTopic))
  }
  if (paymentType) {
    filters.push('ev.payment_type=?')
    values.push(String(paymentType))
  }

  try {
    const [rows] = await db.query(
      `SELECT cls.*
         FROM client_loyalty_subscription_events ev
         JOIN client_loyalty_subscriptions cls
           ON cls.id = ev.client_loyalty_subscription_id
        WHERE ${filters.join(' AND ')}
        ORDER BY ev.id DESC
        LIMIT 1`,
      values
    )
    return mapRow(rows?.[0])
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

export async function getClientLoyaltySubscriptionByWebhookResourceId(resourceId, {
  topic = null,
  db = pool,
} = {}) {
  if (!resourceId) return null

  const filters = [
    'mw.resource_id=?',
    'mw.loyalty_subscription_id IS NOT NULL',
  ]
  const values = [String(resourceId)]

  if (topic) {
    filters.push('mw.topic=?')
    values.push(String(topic))
  }

  try {
    const [rows] = await db.query(
      `SELECT cls.*
         FROM mercadopago_webhook_events mw
         JOIN client_loyalty_subscriptions cls
           ON cls.id = mw.loyalty_subscription_id
        WHERE ${filters.join(' AND ')}
        ORDER BY mw.updated_at DESC, mw.id DESC
        LIMIT 1`,
      values
    )
    return mapRow(rows?.[0])
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

export async function listClientLoyaltySubscriptionsForClient(clienteId, { db = pool } = {}) {
  const [rows] = await db.query(
    'SELECT * FROM client_loyalty_subscriptions WHERE cliente_id=? ORDER BY updated_at DESC, id DESC',
    [clienteId]
  )
  return rows.map(mapRow)
}

export async function listClientLoyaltySubscriptionsForEstablishment(estabelecimentoId, { db = pool } = {}) {
  const [rows] = await db.query(
    'SELECT * FROM client_loyalty_subscriptions WHERE estabelecimento_id=? ORDER BY updated_at DESC, id DESC',
    [estabelecimentoId]
  )
  return rows.map(mapRow)
}

export async function listClientLoyaltyAuthorizedPaymentProbeCandidates({ db = pool, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 50) || 50, 200))
  const [rows] = await db.query(
    `SELECT estabelecimento_id,
            MAX(updated_at) AS last_updated_at
       FROM client_loyalty_subscriptions
      WHERE payment_method='credit_card'
        AND gateway='mercadopago'
        AND estabelecimento_id IS NOT NULL
        AND (mp_preapproval_id IS NOT NULL OR external_reference IS NOT NULL)
        AND status IN ('trialing', 'active', 'pending_payment', 'past_due', 'unpaid', 'canceled')
      GROUP BY estabelecimento_id
      ORDER BY last_updated_at DESC, estabelecimento_id DESC
      LIMIT ${safeLimit}`
  )
  return rows.map((row) => ({
    estabelecimentoId: Number(row.estabelecimento_id || 0) || null,
    lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at) : null,
  })).filter((candidate) => candidate.estabelecimentoId)
}

export function pickPreferredClientLoyaltySubscription(subscriptions = [], { referenceDate = new Date() } = {}) {
  const reference = toDate(referenceDate) || new Date()
  const candidates = Array.isArray(subscriptions) ? subscriptions.filter(Boolean) : []
  const scored = candidates
    .map((subscription) => {
      const state = computeClientLoyaltySubscriptionState(subscription, { referenceDate: reference })
      const end = toDate(subscription.currentPeriodEnd)
      const start = toDate(subscription.currentPeriodStart)
      return {
        subscription,
        state,
        score: [
          state.benefitsActive ? 3 : 0,
          state.withinCurrentPeriod ? 2 : 0,
          ['pending_payment', 'pending_pix'].includes(state.resolvedStatus) ? 1 : 0,
          end ? end.getTime() : 0,
          start ? start.getTime() : 0,
          Number(subscription.id || 0),
        ],
      }
    })
    .sort((a, b) => {
      for (let index = 0; index < a.score.length; index += 1) {
        if (a.score[index] === b.score[index]) continue
        return b.score[index] - a.score[index]
      }
      return 0
    })

  return scored[0]?.subscription || null
}

export async function getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db = pool, referenceDate = new Date() } = {}) {
  const [rows] = await db.query(
    `SELECT *
       FROM client_loyalty_subscriptions
      WHERE cliente_id=?
        AND estabelecimento_id=?
      ORDER BY updated_at DESC, id DESC`,
    [clienteId, estabelecimentoId]
  )
  return pickPreferredClientLoyaltySubscription(rows.map(mapRow), { referenceDate })
}

export async function createClientLoyaltySubscription(data = {}, { db = pool } = {}) {
  const payload = {
    ...data,
    ownerType: normalizeClientLoyaltyOwnerType(data.ownerType || data.owner_type, 'establishment'),
    status: normalizeClientLoyaltyStatus(data.status, 'pending_pix'),
    paymentMethod: normalizeClientLoyaltyPaymentMethod(data.paymentMethod || data.payment_method, 'pix'),
    gateway: String(data.gateway || 'mercadopago').trim() || 'mercadopago',
    autoRenew: data.autoRenew ?? data.auto_renew ?? true,
  }
  const columns = []
  const placeholders = []
  const values = []
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (payload[key] === undefined) continue
    columns.push(column)
    placeholders.push('?')
    values.push(normalizePersistenceValue(key, payload[key], payload))
  }
  const sql = `INSERT INTO client_loyalty_subscriptions (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
  const [result] = await db.query(sql, values)
  return getClientLoyaltySubscriptionById(result.insertId, { db })
}

export async function updateClientLoyaltySubscription(id, fields = {}, { db = pool } = {}) {
  const sets = []
  const values = []
  for (const [key, value] of Object.entries(fields)) {
    const column = COLUMN_MAP[key]
    if (!column) continue
    sets.push(`${column}=?`)
    values.push(normalizePersistenceValue(key, value, fields))
  }
  if (!sets.length) return getClientLoyaltySubscriptionById(id, { db })
  sets.push('updated_at=CURRENT_TIMESTAMP')
  values.push(id)
  await db.query(`UPDATE client_loyalty_subscriptions SET ${sets.join(', ')} WHERE id=? LIMIT 1`, values)
  return getClientLoyaltySubscriptionById(id, { db })
}

export async function appendClientLoyaltySubscriptionEvent(
  subscriptionId,
  {
    eventType,
    gatewayEventId = null,
    mpTopic = null,
    ownerType = 'establishment',
    ownerId = null,
    estabelecimentoId = null,
    mpUserId = null,
    mpCollectorId = null,
    mpPaymentId = null,
    paymentStatus = null,
    paymentMethod = null,
    paymentType = null,
    amountCents = null,
    actionTaken = null,
    ignoredReason = null,
    payload = null,
  },
  { db = pool } = {}
) {
  if (!subscriptionId || !eventType) return { duplicated: false, id: null }
  const gatewayEventIdResolution = normalizeClientLoyaltyGatewayEventId(gatewayEventId, {
    eventType,
    mpTopic,
    mpPaymentId,
    paymentType,
    payload,
  })
  const normalizedGatewayEventId = gatewayEventIdResolution.normalizedId
  logClientLoyaltyGatewayEventIdNormalization(gatewayEventIdResolution, {
    eventType,
    mpTopic,
    paymentType,
  })
  const ignoredReasonResolution = resolveClientLoyaltyIgnoredReasonForStorage(ignoredReason)
  const normalizedIgnoredReason = ignoredReasonResolution.normalizedReason

  if (normalizedGatewayEventId) {
    const [existing] = await db.query(
      `SELECT id
         FROM client_loyalty_subscription_events
        WHERE client_loyalty_subscription_id=?
          AND tipo_evento=?
          AND gateway_event_id=?
        LIMIT 1`,
      [subscriptionId, String(eventType), normalizedGatewayEventId]
    )
    if (existing?.length) return { duplicated: true, id: existing[0].id }
  }
  const payloadWithEventId = withGatewayEventIdNormalizationPayload(payload, gatewayEventIdResolution)
  const payloadWithIgnoredReason = withIgnoredReasonNormalizationPayload(payloadWithEventId, ignoredReasonResolution)
  const safePayload = payloadWithIgnoredReason == null ? null : sanitizeMercadoPagoSensitivePayload(payloadWithIgnoredReason)
  const [result] = await db.query(
    `INSERT INTO client_loyalty_subscription_events
      (
        client_loyalty_subscription_id,
        tipo_evento,
        gateway_event_id,
        mp_topic,
        owner_type,
        owner_id,
        estabelecimento_id,
        mp_user_id,
        mp_collector_id,
        mp_payment_id,
        payment_status,
        payment_method,
        payment_type,
        amount_cents,
        action_taken,
        ignored_reason,
        payload_json
      )
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      subscriptionId,
      String(eventType),
      normalizedGatewayEventId,
      mpTopic == null ? null : String(mpTopic),
      normalizeClientLoyaltyOwnerType(ownerType),
      ownerId == null ? null : Number(ownerId),
      estabelecimentoId == null ? null : Number(estabelecimentoId),
      mpUserId == null ? null : String(mpUserId),
      mpCollectorId == null ? null : String(mpCollectorId),
      mpPaymentId == null ? null : String(mpPaymentId),
      paymentStatus == null ? null : String(paymentStatus),
      paymentMethod == null ? null : String(paymentMethod),
      paymentType == null ? null : String(paymentType),
      amountCents == null ? null : Number(amountCents),
      actionTaken == null ? null : String(actionTaken),
      normalizedIgnoredReason,
      safePayload == null ? null : JSON.stringify(safePayload),
    ]
  )
  return { duplicated: false, id: result.insertId }
}

export async function listClientLoyaltySubscriptionEvents(subscriptionId, { db = pool, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 50) || 50, 200))
  const [rows] = await db.query(
    `SELECT id,
            client_loyalty_subscription_id,
            tipo_evento,
            gateway_event_id,
            mp_topic,
            owner_type,
            owner_id,
            estabelecimento_id,
            mp_user_id,
            mp_collector_id,
            mp_payment_id,
            payment_status,
            payment_method,
            payment_type,
            amount_cents,
            action_taken,
            ignored_reason,
            payload_json,
            created_at
       FROM client_loyalty_subscription_events
      WHERE client_loyalty_subscription_id=?
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}`,
    [subscriptionId]
  )
  return rows.map((row) => ({
    id: Number(row.id),
    client_loyalty_subscription_id: Number(row.client_loyalty_subscription_id),
    tipo_evento: row.tipo_evento || '',
    gateway_event_id: row.gateway_event_id || null,
    mp_topic: row.mp_topic || null,
    owner_type: normalizeClientLoyaltyOwnerType(row.owner_type),
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
    payload_json: sanitizeMercadoPagoSensitivePayload(safeJsonParse(row.payload_json)),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }))
}
