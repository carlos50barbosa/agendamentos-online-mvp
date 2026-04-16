// backend/src/lib/subscriptions.js
import { pool } from './db.js'
import { toDatabaseDateTime } from './database_datetime.js'
import { sanitizeMercadoPagoSensitivePayload } from './mercadopago_card_tokens.js'
import { normalizePaymentMethod, normalizeSubscriptionStatus } from './subscription_normalization.js'

const COLUMN_MAP = {
  estabelecimentoId: 'estabelecimento_id',
  plan: 'plan',
  gateway: 'gateway',
  paymentMethod: 'payment_method',
  gatewayCustomerId: 'gateway_customer_id',
  gatewaySubscriptionId: 'gateway_subscription_id',
  gatewayPaymentId: 'gateway_payment_id',
  gatewayPreferenceId: 'gateway_preference_id',
  externalReference: 'external_reference',
  status: 'status',
  amountCents: 'amount_cents',
  currency: 'currency',
  billingCycle: 'billing_cycle',
  trialEndsAt: 'trial_ends_at',
  currentPeriodStart: 'current_period_start',
  currentPeriodEnd: 'current_period_end',
  nextBillingAt: 'next_billing_at',
  graceUntil: 'grace_until',
  lastPaymentAt: 'last_payment_at',
  cancelAt: 'cancel_at',
  canceledAt: 'canceled_at',
  lastEventId: 'last_event_id',
}

const DATETIME_FIELDS = new Set([
  'trialEndsAt',
  'currentPeriodStart',
  'currentPeriodEnd',
  'nextBillingAt',
  'graceUntil',
  'lastPaymentAt',
  'cancelAt',
  'canceledAt',
])

function normalizePersistenceValue(key, value, fields = {}) {
  if (key === 'paymentMethod') return normalizePaymentMethod(value)
  if (key === 'status') {
    return normalizeSubscriptionStatus(value, {
      paymentMethod: fields.paymentMethod,
    })
  }
  if (DATETIME_FIELDS.has(key)) return toDatabaseDateTime(value)
  return value
}

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    estabelecimentoId: row.estabelecimento_id,
    plan: row.plan,
    gateway: row.gateway,
    paymentMethod: normalizePaymentMethod(row.payment_method),
    gatewayCustomerId: row.gateway_customer_id,
    gatewaySubscriptionId: row.gateway_subscription_id,
    gatewayPaymentId: row.gateway_payment_id,
    gatewayPreferenceId: row.gateway_preference_id,
    externalReference: row.external_reference,
    status: normalizeSubscriptionStatus(row.status, { paymentMethod: row.payment_method }),
    amountCents: row.amount_cents,
    currency: row.currency,
    billingCycle: row.billing_cycle || 'mensal',
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    nextBillingAt: row.next_billing_at ? new Date(row.next_billing_at) : null,
    graceUntil: row.grace_until ? new Date(row.grace_until) : null,
    lastPaymentAt: row.last_payment_at ? new Date(row.last_payment_at) : null,
    cancelAt: row.cancel_at ? new Date(row.cancel_at) : null,
    canceledAt: row.canceled_at ? new Date(row.canceled_at) : null,
    lastEventId: row.last_event_id,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }
}

export async function getSubscriptionById(id) {
  const [rows] = await pool.query('SELECT * FROM subscriptions WHERE id=? LIMIT 1', [id])
  return mapRow(rows?.[0])
}

export async function getSubscriptionByGatewayId(gatewaySubscriptionId) {
  if (!gatewaySubscriptionId) return null
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE gateway_subscription_id=? LIMIT 1',
    [gatewaySubscriptionId]
  )
  return mapRow(rows?.[0])
}

export async function getSubscriptionByGatewayPaymentId(gatewayPaymentId) {
  if (!gatewayPaymentId) return null
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE gateway_payment_id=? ORDER BY id DESC LIMIT 1',
    [String(gatewayPaymentId)]
  )
  return mapRow(rows?.[0])
}

export async function getSubscriptionByPlanId(gatewayPreferenceId) {
  if (!gatewayPreferenceId) return null
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE gateway_preference_id=? LIMIT 1',
    [gatewayPreferenceId]
  )
  return mapRow(rows?.[0])
}

export async function getSubscriptionByExternalReference(externalReference) {
  if (!externalReference) return null
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE external_reference=? ORDER BY id DESC LIMIT 1',
    [String(externalReference)]
  )
  return mapRow(rows?.[0])
}

export async function getLatestSubscriptionForEstabelecimento(estabelecimentoId) {
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE estabelecimento_id=? ORDER BY created_at DESC LIMIT 1',
    [estabelecimentoId]
  )
  return mapRow(rows?.[0])
}

export async function listSubscriptionsForEstabelecimento(estabelecimentoId) {
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE estabelecimento_id=? ORDER BY created_at DESC',
    [estabelecimentoId]
  )
  return rows.map(mapRow)
}

export async function createSubscription(data) {
  const columns = []
  const placeholders = []
  const values = []

  const payload = {
    ...data,
    gateway: data.gateway || 'mercadopago',
    currency: data.currency || 'BRL',
    billingCycle: data.billingCycle || 'mensal',
    paymentMethod: normalizePaymentMethod(data.paymentMethod || data.payment_method || null),
    status: normalizeSubscriptionStatus(data.status, {
      paymentMethod: data.paymentMethod || data.payment_method || null,
    }),
  }

  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (payload[key] === undefined) continue
    columns.push(column)
    placeholders.push('?')
    values.push(normalizePersistenceValue(key, payload[key], payload))
  }

  if (!columns.includes('estabelecimento_id')) {
    columns.unshift('estabelecimento_id')
    placeholders.unshift('?')
    values.unshift(payload.estabelecimentoId)
  }

  if (!columns.includes('plan')) {
    columns.push('plan')
    placeholders.push('?')
    values.push(payload.plan)
  }

  if (!columns.includes('amount_cents')) {
    columns.push('amount_cents')
    placeholders.push('?')
    values.push(payload.amountCents)
  }

  const sql = `INSERT INTO subscriptions (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
  const [result] = await pool.query(sql, values)
  return getSubscriptionById(result.insertId)
}

export async function updateSubscription(id, fields = {}) {
  const sets = []
  const values = []
  for (const [key, value] of Object.entries(fields)) {
    const column = COLUMN_MAP[key]
    if (!column) continue
    const nextValue = normalizePersistenceValue(key, value, fields)
    sets.push(`${column}=?`)
    values.push(nextValue)
  }

  if (!sets.length) return getSubscriptionById(id)

  sets.push('updated_at=CURRENT_TIMESTAMP')
  values.push(id)

  const sql = `UPDATE subscriptions SET ${sets.join(', ')} WHERE id=? LIMIT 1`
  await pool.query(sql, values)
  return getSubscriptionById(id)
}

export async function appendSubscriptionEvent(subscriptionId, { eventType, gatewayEventId, payload }) {
  if (gatewayEventId) {
    const [existing] = await pool.query(
      `SELECT id
         FROM subscription_events
        WHERE subscription_id=?
          AND event_type=?
          AND gateway_event_id=?
        LIMIT 1`,
      [subscriptionId, eventType, String(gatewayEventId)]
    )
    if (existing?.length) return { duplicated: true, id: existing[0].id }
  }

  const sql = `
    INSERT INTO subscription_events (subscription_id, event_type, gateway_event_id, payload)
    VALUES (?, ?, ?, ?)
  `
  const safePayload = payload == null ? null : sanitizeMercadoPagoSensitivePayload(payload)
  const stringPayload = safePayload == null ? null : JSON.stringify(safePayload)
  const [result] = await pool.query(sql, [subscriptionId, eventType, gatewayEventId || null, stringPayload])
  return { duplicated: false, id: result.insertId }
}

export async function getSubscriptionEventByGatewayEventId(subscriptionId, gatewayEventId, { eventTypes = [] } = {}) {
  if (!subscriptionId || !gatewayEventId) return null

  const filters = [
    'subscription_id=?',
    'gateway_event_id=?',
  ]
  const values = [
    subscriptionId,
    String(gatewayEventId),
  ]

  const normalizedTypes = Array.isArray(eventTypes)
    ? eventTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (normalizedTypes.length) {
    filters.push(`event_type IN (${normalizedTypes.map(() => '?').join(', ')})`)
    values.push(...normalizedTypes)
  }

  const [rows] = await pool.query(
    `SELECT id, subscription_id, event_type, gateway_event_id, payload, created_at
       FROM subscription_events
      WHERE ${filters.join(' AND ')}
      ORDER BY id DESC
      LIMIT 1`,
    values
  )
  const row = rows?.[0]
  if (!row) return null
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    event_type: row.event_type,
    gateway_event_id: row.gateway_event_id || null,
    payload: row.payload ? sanitizeMercadoPagoSensitivePayload(safeJsonParse(row.payload)) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

export async function listSubscriptionEventsForEstabelecimento(estabelecimentoId, { limit = 30 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 30) || 30, 100))
  const [rows] = await pool.query(
    `SELECT se.id,
            se.subscription_id,
            se.event_type,
            se.gateway_event_id,
            se.payload,
            se.created_at,
            s.plan,
            s.status,
            s.payment_method,
            s.gateway,
            s.billing_cycle
       FROM subscription_events se
       JOIN subscriptions s ON s.id = se.subscription_id
      WHERE s.estabelecimento_id=?
      ORDER BY se.created_at DESC, se.id DESC
      LIMIT ${safeLimit}`,
    [estabelecimentoId]
  )
  return rows.map((row) => ({
    id: row.id,
    subscription_id: row.subscription_id,
    event_type: row.event_type,
    gateway_event_id: row.gateway_event_id || null,
    payload: row.payload ? sanitizeMercadoPagoSensitivePayload(safeJsonParse(row.payload)) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    plan: row.plan || null,
    status: normalizeSubscriptionStatus(row.status, { paymentMethod: row.payment_method }),
    payment_method: normalizePaymentMethod(row.payment_method),
    gateway: row.gateway || null,
    billing_cycle: row.billing_cycle || 'mensal',
  }))
}

export function serializeSubscription(subscription) {
  if (!subscription) return null
  return {
    id: subscription.id,
    plan: subscription.plan,
    status: normalizeSubscriptionStatus(subscription.status, { paymentMethod: subscription.paymentMethod }),
    amount_cents: subscription.amountCents,
    currency: subscription.currency,
    billing_cycle: subscription.billingCycle || 'mensal',
    gateway: subscription.gateway,
    payment_method: normalizePaymentMethod(subscription.paymentMethod),
    gateway_customer_id: subscription.gatewayCustomerId || null,
    gateway_subscription_id: subscription.gatewaySubscriptionId,
    gateway_payment_id: subscription.gatewayPaymentId || null,
    gateway_preference_id: subscription.gatewayPreferenceId,
    external_reference: subscription.externalReference,
    trial_ends_at: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
    current_period_start: subscription.currentPeriodStart ? subscription.currentPeriodStart.toISOString() : null,
    current_period_end: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    next_billing_at: subscription.nextBillingAt ? subscription.nextBillingAt.toISOString() : null,
    grace_until: subscription.graceUntil ? subscription.graceUntil.toISOString() : null,
    last_payment_at: subscription.lastPaymentAt ? subscription.lastPaymentAt.toISOString() : null,
    cancel_at: subscription.cancelAt ? subscription.cancelAt.toISOString() : null,
    canceled_at: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
    created_at: subscription.createdAt ? subscription.createdAt.toISOString() : null,
    updated_at: subscription.updatedAt ? subscription.updatedAt.toISOString() : null,
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}



