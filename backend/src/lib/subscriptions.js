// backend/src/lib/subscriptions.js
import { pool } from './db.js'

const COLUMN_MAP = {
  estabelecimentoId: 'estabelecimento_id',
  plan: 'plan',
  gateway: 'gateway',
  gatewaySubscriptionId: 'gateway_subscription_id',
  gatewayPreferenceId: 'gateway_preference_id',
  externalReference: 'external_reference',
  status: 'status',
  amountCents: 'amount_cents',
  currency: 'currency',
  trialEndsAt: 'trial_ends_at',
  currentPeriodEnd: 'current_period_end',
  cancelAt: 'cancel_at',
  canceledAt: 'canceled_at',
  lastEventId: 'last_event_id',
}

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    estabelecimentoId: row.estabelecimento_id,
    plan: row.plan,
    gateway: row.gateway,
    gatewaySubscriptionId: row.gateway_subscription_id,
    gatewayPreferenceId: row.gateway_preference_id,
    externalReference: row.external_reference,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
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
  }

  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (payload[key] === undefined) continue
    columns.push(column)
    placeholders.push('?')
    values.push(payload[key])
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
    sets.push(`${column}=?`)
    values.push(value)
  }

  if (!sets.length) return getSubscriptionById(id)

  sets.push('updated_at=CURRENT_TIMESTAMP')
  values.push(id)

  const sql = `UPDATE subscriptions SET ${sets.join(', ')} WHERE id=? LIMIT 1`
  await pool.query(sql, values)
  return getSubscriptionById(id)
}

export async function appendSubscriptionEvent(subscriptionId, { eventType, gatewayEventId, payload }) {
  const sql = `
    INSERT INTO subscription_events (subscription_id, event_type, gateway_event_id, payload)
    VALUES (?, ?, ?, ?)
  `
  const stringPayload = payload == null ? null : JSON.stringify(payload)
  await pool.query(sql, [subscriptionId, eventType, gatewayEventId || null, stringPayload])
}

export function serializeSubscription(subscription) {
  if (!subscription) return null
  return {
    id: subscription.id,
    plan: subscription.plan,
    status: subscription.status,
    amount_cents: subscription.amountCents,
    currency: subscription.currency,
    gateway: subscription.gateway,
    gateway_subscription_id: subscription.gatewaySubscriptionId,
    gateway_preference_id: subscription.gatewayPreferenceId,
    external_reference: subscription.externalReference,
    trial_ends_at: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
    current_period_end: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
    cancel_at: subscription.cancelAt ? subscription.cancelAt.toISOString() : null,
    canceled_at: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
    created_at: subscription.createdAt ? subscription.createdAt.toISOString() : null,
    updated_at: subscription.updatedAt ? subscription.updatedAt.toISOString() : null,
  }
}



