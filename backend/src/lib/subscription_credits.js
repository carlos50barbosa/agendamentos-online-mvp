import { pool } from './db.js'
import { toDatabaseDateTime } from './database_datetime.js'
import { getPlanPriceCents, isUpgrade, normalizeBillingCycle } from './plans.js'
import {
  appendSubscriptionEvent,
  getSubscriptionById,
  listSubscriptionsForEstabelecimento,
  updateSubscription,
} from './subscriptions.js'

const CREDIT_REASON_UPGRADE = 'upgrade_proration'
const CREDIT_STATUS_AVAILABLE = 'available'
const CREDIT_STATUS_PARTIALLY_RESERVED = 'partially_reserved'
const CREDIT_STATUS_RESERVED = 'reserved'
const CREDIT_STATUS_PARTIALLY_CONSUMED = 'partially_consumed'
const CREDIT_STATUS_CONSUMED = 'consumed'

function toDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function buildIsoKey(value) {
  const date = toDate(value)
  return date ? date.toISOString() : 'null'
}

function roundHalfUpBigInt(numerator, denominator) {
  if (denominator <= 0n) return 0n
  if (numerator <= 0n) return 0n
  return (numerator + (denominator / 2n)) / denominator
}

export function calculateProratedCreditCents({
  amountCents,
  cycleStart,
  cycleEnd,
  changedAt = new Date(),
} = {}) {
  const amount = Math.max(0, Math.trunc(Number(amountCents || 0) || 0))
  const start = toDate(cycleStart)
  const end = toDate(cycleEnd)
  const changed = toDate(changedAt) || new Date()
  if (!amount || !start || !end) return 0

  const totalMs = end.getTime() - start.getTime()
  const remainingMs = end.getTime() - changed.getTime()
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0

  const rounded = roundHalfUpBigInt(
    BigInt(amount) * BigInt(remainingMs),
    BigInt(totalMs)
  )
  return Number(rounded > BigInt(amount) ? BigInt(amount) : rounded)
}

export function addBillingCycles(dateValue, billingCycle = 'mensal', count = 1) {
  const date = toDate(dateValue)
  if (!date) return null
  const cycles = Math.max(0, Math.trunc(Number(count || 0) || 0))
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const next = new Date(date)
  if (normalizedCycle === 'anual') {
    next.setFullYear(next.getFullYear() + cycles)
    return next
  }

  const day = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + cycles)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

function normalizeCreditStatus(row) {
  const generated = Math.max(0, Math.trunc(Number(row?.generated_credit_cents || row?.generatedCreditCents || 0) || 0))
  const reserved = Math.max(0, Math.trunc(Number(row?.reserved_credit_cents || row?.reservedCreditCents || 0) || 0))
  const consumed = Math.max(0, Math.trunc(Number(row?.consumed_credit_cents || row?.consumedCreditCents || 0) || 0))
  const remaining = Math.max(0, Math.trunc(Number(row?.remaining_credit_cents || row?.remainingCreditCents || 0) || 0))

  if (!generated || (consumed >= generated && !reserved && !remaining)) return CREDIT_STATUS_CONSUMED
  if (reserved >= generated && !remaining) return CREDIT_STATUS_RESERVED
  if (reserved > 0 && remaining === 0) return CREDIT_STATUS_RESERVED
  if (reserved > 0) return CREDIT_STATUS_PARTIALLY_RESERVED
  if (consumed > 0 && !remaining) return CREDIT_STATUS_CONSUMED
  if (consumed > 0) return CREDIT_STATUS_PARTIALLY_CONSUMED
  return CREDIT_STATUS_AVAILABLE
}

function mapCreditRow(row) {
  if (!row) return null
  const auditPayload = row.audit_payload ? safeJsonParse(row.audit_payload) : null
  return {
    id: Number(row.id),
    estabelecimento_id: Number(row.estabelecimento_id),
    source_subscription_id: Number(row.source_subscription_id),
    target_subscription_id: row.target_subscription_id == null ? null : Number(row.target_subscription_id),
    source_plan: row.source_plan || null,
    target_plan: row.target_plan || null,
    source_cycle_started_at: row.source_cycle_started_at ? new Date(row.source_cycle_started_at).toISOString() : null,
    source_cycle_ends_at: row.source_cycle_ends_at ? new Date(row.source_cycle_ends_at).toISOString() : null,
    changed_at: row.changed_at ? new Date(row.changed_at).toISOString() : null,
    original_plan_amount_cents: Number(row.original_plan_amount_cents || 0),
    generated_credit_cents: Number(row.generated_credit_cents || 0),
    reserved_credit_cents: Number(row.reserved_credit_cents || 0),
    consumed_credit_cents: Number(row.consumed_credit_cents || 0),
    remaining_credit_cents: Number(row.remaining_credit_cents || 0),
    payment_method: row.payment_method || null,
    source_payment_id: row.source_payment_id || null,
    source_external_reference: row.source_external_reference || null,
    target_plan_amount_cents: Number(auditPayload?.target_plan_amount_cents || 0),
    reason: row.reason || CREDIT_REASON_UPGRADE,
    unique_key: row.unique_key || null,
    status: row.status || normalizeCreditStatus(row),
    audit_payload: auditPayload,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapApplicationRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    credit_id: Number(row.credit_id),
    estabelecimento_id: Number(row.estabelecimento_id),
    target_subscription_id: Number(row.target_subscription_id),
    payment_method: row.payment_method || null,
    application_type: row.application_type || null,
    application_group_key: row.application_group_key || null,
    application_key: row.application_key || null,
    scheduled_for: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
    payment_id: row.payment_id || null,
    external_reference: row.external_reference || null,
    amount_cents: Number(row.amount_cents || 0),
    status: row.status || 'scheduled',
    payload: row.payload ? safeJsonParse(row.payload) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function safeJsonParse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function buildApplicationKey(groupKey, creditId) {
  return `${String(groupKey || '').slice(0, 150)}:credit:${creditId}`
}

function buildUpgradeCreditKey(sourceSubscription, targetSubscription, paymentId, externalReference) {
  return [
    CREDIT_REASON_UPGRADE,
    'source',
    String(sourceSubscription?.id || ''),
    'target',
    String(targetSubscription?.id || ''),
    'payment',
    String(paymentId || ''),
    'external',
    String(externalReference || ''),
    'source-start',
    buildIsoKey(sourceSubscription?.currentPeriodStart),
    'source-end',
    buildIsoKey(sourceSubscription?.currentPeriodEnd),
  ].join(':').slice(0, 191)
}

function buildCycleGroupKey(subscriptionId, scheduledFor, applicationType) {
  return [
    applicationType,
    'subscription',
    String(subscriptionId || ''),
    'at',
    buildIsoKey(scheduledFor),
  ].join(':').slice(0, 191)
}

async function selectExistingCreditByKey(uniqueKey, { db = pool, forUpdate = false } = {}) {
  const suffix = forUpdate ? ' FOR UPDATE' : ''
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credits
      WHERE unique_key=?
      LIMIT 1${suffix}`,
    [uniqueKey]
  )
  return mapCreditRow(rows?.[0])
}

async function selectCreditRowsForReservation(estabelecimentoId, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credits
      WHERE estabelecimento_id=?
        AND remaining_credit_cents > 0
      ORDER BY changed_at ASC, id ASC
      FOR UPDATE`,
    [estabelecimentoId]
  )
  return rows
}

async function upsertCreditAmountsTx(creditId, patch = {}, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credits
      WHERE id=?
      LIMIT 1
      FOR UPDATE`,
    [creditId]
  )
  const row = rows?.[0]
  if (!row) return null

  const nextReserved = Math.max(0, Math.trunc(Number(patch.reserved_credit_cents ?? row.reserved_credit_cents ?? 0) || 0))
  const nextConsumed = Math.max(0, Math.trunc(Number(patch.consumed_credit_cents ?? row.consumed_credit_cents ?? 0) || 0))
  const nextRemaining = Math.max(0, Math.trunc(Number(patch.remaining_credit_cents ?? row.remaining_credit_cents ?? 0) || 0))
  const nextStatus = normalizeCreditStatus({
    ...row,
    reserved_credit_cents: nextReserved,
    consumed_credit_cents: nextConsumed,
    remaining_credit_cents: nextRemaining,
  })

  await db.query(
    `UPDATE subscription_credits
        SET reserved_credit_cents=?,
            consumed_credit_cents=?,
            remaining_credit_cents=?,
            status=?,
            updated_at=CURRENT_TIMESTAMP
      WHERE id=?
      LIMIT 1`,
    [nextReserved, nextConsumed, nextRemaining, nextStatus, creditId]
  )

  return {
    ...mapCreditRow(row),
    reserved_credit_cents: nextReserved,
    consumed_credit_cents: nextConsumed,
    remaining_credit_cents: nextRemaining,
    status: nextStatus,
  }
}

function groupApplications(rows = []) {
  const groups = new Map()
  for (const row of rows) {
    const mapped = mapApplicationRow(row)
    if (!mapped) continue
    const key = mapped.application_group_key || `${mapped.application_type}:${mapped.scheduled_for || mapped.id}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        application_type: mapped.application_type,
        scheduled_for: mapped.scheduled_for,
        payment_method: mapped.payment_method,
        status: mapped.status,
        amount_cents: 0,
        items: [],
      })
    }
    const group = groups.get(key)
    group.amount_cents += mapped.amount_cents
    group.items.push(mapped)
  }
  return Array.from(groups.values()).sort((a, b) => {
    const left = toDate(a.scheduled_for)?.getTime() || 0
    const right = toDate(b.scheduled_for)?.getTime() || 0
    if (left !== right) return left - right
    return String(a.key).localeCompare(String(b.key))
  })
}

async function insertApplicationReservationTx(creditId, {
  estabelecimentoId,
  targetSubscriptionId,
  paymentMethod,
  applicationType,
  applicationGroupKey,
  scheduledFor,
  amountCents,
  externalReference = null,
  payload = null,
}, { db = pool } = {}) {
  const applicationKey = buildApplicationKey(applicationGroupKey, creditId)
  const [existing] = await db.query(
    `SELECT id
       FROM subscription_credit_applications
      WHERE application_key=?
      LIMIT 1`,
    [applicationKey]
  )
  if (existing?.length) {
    const [rows] = await db.query(
      `SELECT *
         FROM subscription_credit_applications
        WHERE id=?
        LIMIT 1`,
      [existing[0].id]
    )
    return mapApplicationRow(rows?.[0])
  }

  const [result] = await db.query(
    `INSERT INTO subscription_credit_applications
      (credit_id, estabelecimento_id, target_subscription_id, payment_method, application_type,
       application_group_key, application_key, scheduled_for, external_reference, amount_cents, status, payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      creditId,
      estabelecimentoId,
      targetSubscriptionId,
      paymentMethod || null,
      applicationType,
      applicationGroupKey,
      applicationKey,
      toDatabaseDateTime(scheduledFor),
      externalReference || null,
      amountCents,
      'scheduled',
      payload == null ? null : JSON.stringify(payload),
    ]
  )
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credit_applications
      WHERE id=?
      LIMIT 1`,
    [result.insertId]
  )
  return mapApplicationRow(rows?.[0])
}

export async function listSubscriptionCreditsForEstablishment(estabelecimentoId, {
  db = pool,
  limit = 30,
} = {}) {
  if (!estabelecimentoId) return []
  const safeLimit = Math.max(1, Math.min(Number(limit || 30) || 30, 200))
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credits
      WHERE estabelecimento_id=?
      ORDER BY changed_at DESC, id DESC
      LIMIT ${safeLimit}`,
    [estabelecimentoId]
  )
  return rows.map(mapCreditRow)
}

export async function listScheduledSubscriptionCreditApplications(subscriptionId, {
  db = pool,
  statuses = ['scheduled'],
} = {}) {
  if (!subscriptionId) return []
  const normalizedStatuses = Array.isArray(statuses)
    ? statuses.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const filters = ['target_subscription_id=?']
  const values = [subscriptionId]
  if (normalizedStatuses.length) {
    filters.push(`status IN (${normalizedStatuses.map(() => '?').join(', ')})`)
    values.push(...normalizedStatuses)
  }
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credit_applications
      WHERE ${filters.join(' AND ')}
      ORDER BY scheduled_for ASC, id ASC`,
    values
  )
  return rows.map(mapApplicationRow)
}

export async function getAvailableSubscriptionCreditTotals(estabelecimentoId, { db = pool } = {}) {
  if (!estabelecimentoId) {
    return {
      generated_credit_cents: 0,
      reserved_credit_cents: 0,
      consumed_credit_cents: 0,
      remaining_credit_cents: 0,
    }
  }
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(generated_credit_cents), 0) AS generated_credit_cents,
            COALESCE(SUM(reserved_credit_cents), 0) AS reserved_credit_cents,
            COALESCE(SUM(consumed_credit_cents), 0) AS consumed_credit_cents,
            COALESCE(SUM(remaining_credit_cents), 0) AS remaining_credit_cents
       FROM subscription_credits
      WHERE estabelecimento_id=?`,
    [estabelecimentoId]
  )
  const row = rows?.[0] || {}
  return {
    generated_credit_cents: Number(row.generated_credit_cents || 0),
    reserved_credit_cents: Number(row.reserved_credit_cents || 0),
    consumed_credit_cents: Number(row.consumed_credit_cents || 0),
    remaining_credit_cents: Number(row.remaining_credit_cents || 0),
  }
}

export async function findUpgradeSourceSubscription(estabelecimentoId, {
  targetSubscriptionId = null,
  targetPlan = null,
  changedAt = new Date(),
  db = pool,
} = {}) {
  if (!estabelecimentoId || !targetPlan) return null
  const reference = toDate(changedAt) || new Date()
  const subscriptions = await listSubscriptionsForEstabelecimento(estabelecimentoId, { db })
  return subscriptions.find((item) => {
    if (!item?.id) return false
    if (targetSubscriptionId && Number(item.id) === Number(targetSubscriptionId)) return false
    if (!isUpgrade(item.plan, targetPlan)) return false
    const cycleStart = toDate(item.currentPeriodStart)
    const cycleEnd = toDate(item.currentPeriodEnd)
    if (!cycleStart || !cycleEnd) return false
    if (cycleEnd.getTime() <= reference.getTime()) return false
    return ['active', 'past_due', 'unpaid', 'canceled'].includes(String(item.status || '').toLowerCase())
  }) || null
}

export async function createUpgradeProrationCreditTx({
  sourceSubscription,
  targetSubscription,
  changedAt = new Date(),
  paymentMethod = null,
  paymentId = null,
  externalReference = null,
  rawPayload = null,
  db = pool,
} = {}) {
  if (!sourceSubscription?.id || !targetSubscription?.id) {
    return { created: false, credit: null, reason: 'subscription_missing' }
  }
  if (!isUpgrade(sourceSubscription.plan, targetSubscription.plan)) {
    return { created: false, credit: null, reason: 'not_upgrade' }
  }

  const sourceAmountCents = getPlanPriceCents(sourceSubscription.plan, sourceSubscription.billingCycle)
  const targetAmountCents = getPlanPriceCents(targetSubscription.plan, targetSubscription.billingCycle)
  const generatedCreditCents = calculateProratedCreditCents({
    amountCents: sourceAmountCents,
    cycleStart: sourceSubscription.currentPeriodStart,
    cycleEnd: sourceSubscription.currentPeriodEnd,
    changedAt,
  })
  if (generatedCreditCents <= 0) {
    return { created: false, credit: null, reason: 'no_remaining_credit' }
  }

  const uniqueKey = buildUpgradeCreditKey(sourceSubscription, targetSubscription, paymentId, externalReference)
  const existing = await selectExistingCreditByKey(uniqueKey, { db, forUpdate: true })
  if (existing) {
    return { created: false, credit: existing, reason: 'already_exists', duplicated: true }
  }

  const changedDate = toDate(changedAt) || new Date()
  const auditPayload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? {
          ...rawPayload,
          source_plan: sourceSubscription.plan,
          target_plan: targetSubscription.plan,
          source_plan_amount_cents: sourceAmountCents,
          target_plan_amount_cents: targetAmountCents,
          source_cycle_started_at: sourceSubscription.currentPeriodStart ? toDate(sourceSubscription.currentPeriodStart)?.toISOString() || null : null,
          source_cycle_ends_at: sourceSubscription.currentPeriodEnd ? toDate(sourceSubscription.currentPeriodEnd)?.toISOString() || null : null,
          changed_at: changedDate.toISOString(),
          payment_method: paymentMethod || null,
          source_payment_id: paymentId == null ? null : String(paymentId),
          source_external_reference: externalReference || null,
        }
      : {
          raw_payload: rawPayload ?? null,
          source_plan: sourceSubscription.plan,
          target_plan: targetSubscription.plan,
          source_plan_amount_cents: sourceAmountCents,
          target_plan_amount_cents: targetAmountCents,
          source_cycle_started_at: sourceSubscription.currentPeriodStart ? toDate(sourceSubscription.currentPeriodStart)?.toISOString() || null : null,
          source_cycle_ends_at: sourceSubscription.currentPeriodEnd ? toDate(sourceSubscription.currentPeriodEnd)?.toISOString() || null : null,
          changed_at: changedDate.toISOString(),
          payment_method: paymentMethod || null,
          source_payment_id: paymentId == null ? null : String(paymentId),
          source_external_reference: externalReference || null,
        }
  const [result] = await db.query(
    `INSERT INTO subscription_credits
      (estabelecimento_id, source_subscription_id, target_subscription_id, source_plan, target_plan,
       source_cycle_started_at, source_cycle_ends_at, changed_at, original_plan_amount_cents,
       generated_credit_cents, reserved_credit_cents, consumed_credit_cents, remaining_credit_cents,
       payment_method, source_payment_id, source_external_reference, reason, unique_key, status, audit_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(sourceSubscription.estabelecimentoId),
      Number(sourceSubscription.id),
      Number(targetSubscription.id),
      sourceSubscription.plan,
      targetSubscription.plan,
      toDatabaseDateTime(sourceSubscription.currentPeriodStart),
      toDatabaseDateTime(sourceSubscription.currentPeriodEnd),
      toDatabaseDateTime(changedDate),
      sourceAmountCents,
      generatedCreditCents,
      0,
      0,
      generatedCreditCents,
      paymentMethod || null,
      paymentId == null ? null : String(paymentId),
      externalReference || null,
      CREDIT_REASON_UPGRADE,
      uniqueKey,
      CREDIT_STATUS_AVAILABLE,
      JSON.stringify(auditPayload),
    ]
  )

  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credits
      WHERE id=?
      LIMIT 1`,
    [result.insertId]
  )
  const credit = mapCreditRow(rows?.[0])
  return {
    created: true,
    credit,
    reason: CREDIT_REASON_UPGRADE,
  }
}

async function reserveOldestCreditsTx(estabelecimentoId, amountCents, {
  targetSubscriptionId,
  paymentMethod,
  applicationType,
  applicationGroupKey,
  scheduledFor,
  externalReference = null,
  payload = null,
  db = pool,
} = {}) {
  let remainingToReserve = Math.max(0, Math.trunc(Number(amountCents || 0) || 0))
  if (!remainingToReserve) return []

  const rows = await selectCreditRowsForReservation(estabelecimentoId, { db })
  const reservations = []
  for (const row of rows) {
    if (!remainingToReserve) break
    const available = Math.max(0, Math.trunc(Number(row.remaining_credit_cents || 0) || 0))
    if (!available) continue

    const amountForCredit = Math.min(available, remainingToReserve)
    const nextReserved = Math.max(0, Math.trunc(Number(row.reserved_credit_cents || 0) || 0)) + amountForCredit
    const nextRemaining = available - amountForCredit
    await upsertCreditAmountsTx(row.id, {
      reserved_credit_cents: nextReserved,
      remaining_credit_cents: nextRemaining,
    }, { db })

    const application = await insertApplicationReservationTx(row.id, {
      estabelecimentoId,
      targetSubscriptionId,
      paymentMethod,
      applicationType,
      applicationGroupKey,
      scheduledFor,
      amountCents: amountForCredit,
      externalReference,
      payload,
    }, { db })

    reservations.push(application)
    remainingToReserve -= amountForCredit
  }

  return reservations
}

export async function reserveSubscriptionCreditApplicationsTx({
  estabelecimentoId,
  targetSubscriptionId,
  amountCents,
  paymentMethod = null,
  applicationType,
  applicationGroupKey,
  scheduledFor = null,
  externalReference = null,
  payload = null,
  db = pool,
} = {}) {
  return reserveOldestCreditsTx(estabelecimentoId, amountCents, {
    targetSubscriptionId,
    paymentMethod,
    applicationType,
    applicationGroupKey,
    scheduledFor,
    externalReference,
    payload,
    db,
  })
}

async function transitionApplicationsTx(applicationRows = [], {
  status,
  paymentId = null,
  externalReference = null,
  payloadPatch = null,
  db = pool,
} = {}) {
  const nextStatus = status === 'released' ? 'released' : 'applied'
  const items = Array.isArray(applicationRows) ? applicationRows.filter(Boolean) : []
  let transitionedAmount = 0

  for (const item of items) {
    const mapped = typeof item.amount_cents === 'number' ? item : mapApplicationRow(item)
    if (!mapped?.id || mapped.status !== 'scheduled') continue

    const [rows] = await db.query(
      `SELECT *
         FROM subscription_credit_applications
        WHERE id=?
        LIMIT 1
        FOR UPDATE`,
      [mapped.id]
    )
    const current = mapApplicationRow(rows?.[0])
    if (!current || current.status !== 'scheduled') continue

    const [creditRows] = await db.query(
      `SELECT *
         FROM subscription_credits
        WHERE id=?
        LIMIT 1
        FOR UPDATE`,
      [current.credit_id]
    )
    const creditRow = creditRows?.[0]
    if (!creditRow) continue

    const reserved = Math.max(0, Math.trunc(Number(creditRow.reserved_credit_cents || 0) || 0))
    const consumed = Math.max(0, Math.trunc(Number(creditRow.consumed_credit_cents || 0) || 0))
    const remaining = Math.max(0, Math.trunc(Number(creditRow.remaining_credit_cents || 0) || 0))
    const amount = Math.max(0, Math.trunc(Number(current.amount_cents || 0) || 0))

    if (nextStatus === 'released') {
      await upsertCreditAmountsTx(current.credit_id, {
        reserved_credit_cents: Math.max(0, reserved - amount),
        remaining_credit_cents: remaining + amount,
      }, { db })
    } else {
      await upsertCreditAmountsTx(current.credit_id, {
        reserved_credit_cents: Math.max(0, reserved - amount),
        consumed_credit_cents: consumed + amount,
      }, { db })
    }

    const nextPayload = payloadPatch == null
      ? current.payload
      : { ...(current.payload || {}), ...payloadPatch }

    await db.query(
      `UPDATE subscription_credit_applications
          SET status=?,
              payment_id=?,
              external_reference=?,
              payload=?,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=?
        LIMIT 1`,
      [
        nextStatus,
        paymentId == null ? current.payment_id || null : String(paymentId),
        externalReference == null ? current.external_reference || null : externalReference,
        nextPayload == null ? null : JSON.stringify(nextPayload),
        current.id,
      ]
    )
    transitionedAmount += amount
  }

  return transitionedAmount
}

export async function applyReservedSubscriptionCreditApplicationsTx(applicationRows = [], options = {}) {
  return transitionApplicationsTx(applicationRows, {
    ...options,
    status: 'applied',
  })
}

export async function releaseReservedSubscriptionCreditApplicationsTx(applicationRows = [], options = {}) {
  return transitionApplicationsTx(applicationRows, {
    ...options,
    status: 'released',
  })
}

export async function releaseScheduledSubscriptionCreditApplicationsTx(subscriptionId, {
  db = pool,
  reason = 'schedule_released',
  externalReference = null,
} = {}) {
  if (!subscriptionId) return { released_amount_cents: 0, released_groups: [] }
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credit_applications
      WHERE target_subscription_id=?
        AND status='scheduled'
      ORDER BY scheduled_for ASC, id ASC
      FOR UPDATE`,
    [subscriptionId]
  )
  const groups = groupApplications(rows)
  const releasedAmount = await transitionApplicationsTx(rows, {
    status: 'released',
    externalReference,
    payloadPatch: { reason },
    db,
  })
  return {
    released_amount_cents: releasedAmount,
    released_groups: groups,
  }
}

export async function scheduleSubscriptionCreditsForCardTx(subscription, {
  externalReference = null,
  db = pool,
} = {}) {
  if (!subscription?.id || Number(subscription.estabelecimentoId || 0) <= 0) {
    return {
      reserved_credit_cents: 0,
      scheduled_full_cycles: 0,
      scheduled_discount_cents: 0,
      next_payable_at: null,
      next_charge_amount_cents: 0,
      nominal_amount_cents: 0,
      groups: [],
    }
  }

  await releaseScheduledSubscriptionCreditApplicationsTx(subscription.id, {
    db,
    reason: 'card_schedule_recalculated',
    externalReference,
  })

  const totals = await getAvailableSubscriptionCreditTotals(subscription.estabelecimentoId, { db })
  const availableCredit = Math.max(0, Math.trunc(Number(totals.remaining_credit_cents || 0) || 0))
  const nominalAmount = getPlanPriceCents(subscription.plan, subscription.billingCycle)
  const dueAt = toDate(subscription.nextBillingAt || subscription.currentPeriodEnd)
  if (!availableCredit || !nominalAmount || !dueAt) {
    return {
      reserved_credit_cents: 0,
      scheduled_full_cycles: 0,
      scheduled_discount_cents: 0,
      next_payable_at: dueAt ? dueAt.toISOString() : null,
      next_charge_amount_cents: nominalAmount,
      nominal_amount_cents: nominalAmount,
      groups: [],
    }
  }

  const fullCycles = Math.max(0, Math.floor(availableCredit / nominalAmount))
  const partialDiscount = Math.max(0, availableCredit - (fullCycles * nominalAmount))
  const groups = []

  for (let index = 0; index < fullCycles; index += 1) {
    const scheduledFor = addBillingCycles(dueAt, subscription.billingCycle, index)
    const groupKey = buildCycleGroupKey(subscription.id, scheduledFor, 'scheduled_cycle')
    const items = await reserveOldestCreditsTx(subscription.estabelecimentoId, nominalAmount, {
      targetSubscriptionId: subscription.id,
      paymentMethod: 'credit_card',
      applicationType: 'scheduled_cycle',
      applicationGroupKey: groupKey,
      scheduledFor,
      externalReference,
      payload: {
        plan: subscription.plan,
        billing_cycle: subscription.billingCycle,
        nominal_amount_cents: nominalAmount,
      },
      db,
    })
    groups.push({
      key: groupKey,
      application_type: 'scheduled_cycle',
      scheduled_for: scheduledFor ? scheduledFor.toISOString() : null,
      amount_cents: nominalAmount,
      items,
    })
  }

  const nextPayableDate = addBillingCycles(dueAt, subscription.billingCycle, fullCycles)
  if (partialDiscount > 0) {
    const groupKey = buildCycleGroupKey(subscription.id, nextPayableDate, 'scheduled_discount')
    const items = await reserveOldestCreditsTx(subscription.estabelecimentoId, partialDiscount, {
      targetSubscriptionId: subscription.id,
      paymentMethod: 'credit_card',
      applicationType: 'scheduled_discount',
      applicationGroupKey: groupKey,
      scheduledFor: nextPayableDate,
      externalReference,
      payload: {
        plan: subscription.plan,
        billing_cycle: subscription.billingCycle,
        nominal_amount_cents: nominalAmount,
      },
      db,
    })
    groups.push({
      key: groupKey,
      application_type: 'scheduled_discount',
      scheduled_for: nextPayableDate ? nextPayableDate.toISOString() : null,
      amount_cents: partialDiscount,
      items,
    })
  }

  return {
    reserved_credit_cents: (fullCycles * nominalAmount) + partialDiscount,
    scheduled_full_cycles: fullCycles,
    scheduled_discount_cents: partialDiscount,
    next_payable_at: nextPayableDate ? nextPayableDate.toISOString() : null,
    next_charge_amount_cents: Math.max(0, nominalAmount - partialDiscount),
    nominal_amount_cents: nominalAmount,
    groups,
  }
}

export async function applyDueSubscriptionCreditRenewals(subscriptionId, {
  referenceDate = new Date(),
  db = pool,
} = {}) {
  if (!subscriptionId) {
    return { applied_count: 0, applied_credit_cents: 0, subscription: null }
  }

  const current = await getSubscriptionById(subscriptionId, { db })
  if (!current?.id) {
    return { applied_count: 0, applied_credit_cents: 0, subscription: null }
  }

  const reference = toDate(referenceDate) || new Date()
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credit_applications
      WHERE target_subscription_id=?
        AND status='scheduled'
        AND application_type='scheduled_cycle'
        AND scheduled_for IS NOT NULL
        AND scheduled_for<=?
      ORDER BY scheduled_for ASC, id ASC
      FOR UPDATE`,
    [subscriptionId, toDatabaseDateTime(reference)]
  )
  const groups = groupApplications(rows)
  if (!groups.length) {
    return { applied_count: 0, applied_credit_cents: 0, subscription: current }
  }

  let updated = current
  let appliedCount = 0
  let appliedAmount = 0

  for (const group of groups) {
    const scheduledFor = toDate(group.scheduled_for)
    if (!scheduledFor || scheduledFor.getTime() > reference.getTime()) continue
    const transitioned = await transitionApplicationsTx(group.items, {
      status: 'applied',
      paymentId: `credit:${subscriptionId}:${scheduledFor.toISOString()}`,
      externalReference: `credit-cycle:${subscriptionId}:${scheduledFor.toISOString()}`,
      payloadPatch: {
        applied_at: new Date().toISOString(),
        applied_reason: 'scheduled_cycle_due',
      },
      db,
    })
    if (!transitioned) continue

    const cycleEnd = addBillingCycles(scheduledFor, updated.billingCycle, 1)
    updated = await updateSubscription(updated.id, {
      status: 'active',
      currentPeriodStart: scheduledFor,
      currentPeriodEnd: cycleEnd,
      nextBillingAt: cycleEnd,
      graceUntil: null,
      lastPaymentAt: scheduledFor,
    }, { db })

    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_credit_applied',
      gatewayEventId: `credit-cycle:${updated.id}:${scheduledFor.toISOString()}`,
      payload: {
        payment_method: 'credit_balance',
        application_type: 'scheduled_cycle',
        amount_cents: transitioned,
        scheduled_for: scheduledFor.toISOString(),
        cycle_start: scheduledFor.toISOString(),
        cycle_end: cycleEnd ? cycleEnd.toISOString() : null,
        plan: updated.plan,
        billing_cycle: updated.billingCycle,
        covered_by_credit: true,
      },
    }, { db })

    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_renewed',
      gatewayEventId: `credit-renewal:${updated.id}:${scheduledFor.toISOString()}`,
      payload: {
        payment_method: 'credit_balance',
        credit_applied_cents: transitioned,
        cycle_start: scheduledFor.toISOString(),
        cycle_end: cycleEnd ? cycleEnd.toISOString() : null,
        covered_by_credit: true,
        plan: updated.plan,
        billing_cycle: updated.billingCycle,
      },
    }, { db })

    appliedCount += 1
    appliedAmount += transitioned
  }

  return {
    applied_count: appliedCount,
    applied_credit_cents: appliedAmount,
    subscription: updated,
  }
}

export async function applyScheduledDiscountForSubscriptionPaymentTx(subscriptionId, {
  paymentId = null,
  externalReference = null,
  paymentDate = new Date(),
  db = pool,
} = {}) {
  if (!subscriptionId) return { applied_credit_cents: 0, applications: [] }
  const reference = toDate(paymentDate) || new Date()
  const [rows] = await db.query(
    `SELECT *
       FROM subscription_credit_applications
      WHERE target_subscription_id=?
        AND status='scheduled'
        AND application_type IN ('scheduled_discount','pending_pix_discount')
      ORDER BY scheduled_for ASC, id ASC
      FOR UPDATE`,
    [subscriptionId]
  )
  const groups = groupApplications(rows)
  const targetGroup = groups.find((group) => {
    const scheduledFor = toDate(group.scheduled_for)
    if (!scheduledFor) return true
    return Math.abs(scheduledFor.getTime() - reference.getTime()) <= (36 * 60 * 60 * 1000)
  }) || groups[0] || null
  if (!targetGroup) return { applied_credit_cents: 0, applications: [] }

  const applied = await transitionApplicationsTx(targetGroup.items, {
    status: 'applied',
    paymentId,
    externalReference,
    payloadPatch: {
      applied_at: new Date().toISOString(),
      applied_reason: 'gateway_charge_discount',
    },
    db,
  })
  return {
    applied_credit_cents: applied,
    applications: targetGroup.items,
    group: targetGroup,
  }
}

export async function getSubscriptionCreditOverview(estabelecimentoId, {
  subscription = null,
  db = pool,
  limit = 20,
} = {}) {
  const creditEntries = await listSubscriptionCreditsForEstablishment(estabelecimentoId, { db, limit })
  const totals = await getAvailableSubscriptionCreditTotals(estabelecimentoId, { db })
  const currentSubscription =
    subscription?.id
      ? subscription
      : null
  const scheduledApplications = currentSubscription?.id
    ? await listScheduledSubscriptionCreditApplications(currentSubscription.id, { db, statuses: ['scheduled', 'applied'] })
    : []

  const groupedScheduled = groupApplications(
    scheduledApplications.map((item) => ({
      ...item,
      scheduled_for: item.scheduled_for,
      application_group_key: item.application_group_key,
      application_type: item.application_type,
      payment_method: item.payment_method,
      status: item.status,
      amount_cents: item.amount_cents,
    }))
  )
  const nominalAmount = currentSubscription?.plan
    ? getPlanPriceCents(currentSubscription.plan, currentSubscription.billingCycle)
    : 0
  const scheduledFullCycles = groupedScheduled.filter((group) => group.status === 'scheduled' && group.application_type === 'scheduled_cycle').length
  const nextDiscount = groupedScheduled.find((group) => group.status === 'scheduled' && group.application_type === 'scheduled_discount') || null
  const nextDueAt = toDate(currentSubscription?.nextBillingAt || currentSubscription?.currentPeriodEnd)
  const nextChargeAt = nextDiscount?.scheduled_for
    || (nextDueAt ? addBillingCycles(nextDueAt, currentSubscription?.billingCycle, scheduledFullCycles)?.toISOString() || null : null)

  return {
    summary: totals,
    preview: currentSubscription?.id
      ? {
          nominal_amount_cents: nominalAmount,
          scheduled_full_cycles: scheduledFullCycles,
          next_charge_credit_cents: nextDiscount?.amount_cents || 0,
          next_charge_amount_cents: Math.max(0, nominalAmount - Number(nextDiscount?.amount_cents || 0)),
          next_charge_at: nextChargeAt || null,
          next_renewal_covered_fully: scheduledFullCycles > 0,
        }
      : null,
    entries: creditEntries,
    scheduled_applications: scheduledApplications,
  }
}

export async function appendUpgradeCreditEventsTx(sourceSubscription, targetSubscription, {
  credit,
  paymentMethod = null,
  paymentId = null,
  externalReference = null,
  db = pool,
} = {}) {
  if (!credit || !targetSubscription?.id) return
  const payload = {
    payment_method: paymentMethod || null,
    payment_id: paymentId || null,
    external_reference: externalReference || null,
    source_subscription_id: sourceSubscription?.id || null,
    target_subscription_id: targetSubscription.id,
    source_plan: sourceSubscription?.plan || null,
    target_plan: targetSubscription.plan || null,
    source_cycle_started_at: credit.source_cycle_started_at,
    source_cycle_ends_at: credit.source_cycle_ends_at,
    changed_at: credit.changed_at,
    original_plan_amount_cents: credit.original_plan_amount_cents,
    target_plan_amount_cents: credit.target_plan_amount_cents || getPlanPriceCents(targetSubscription.plan, targetSubscription.billingCycle),
    generated_credit_cents: credit.generated_credit_cents,
    remaining_credit_cents: credit.remaining_credit_cents,
    reason: credit.reason,
  }

  await appendSubscriptionEvent(targetSubscription.id, {
    eventType: 'upgrade_credit_generated',
    gatewayEventId: `upgrade-credit:${credit.id}`,
    payload,
  }, { db })

  if (sourceSubscription?.id) {
    await appendSubscriptionEvent(sourceSubscription.id, {
      eventType: 'subscription_upgraded',
      gatewayEventId: `subscription-upgraded:${credit.id}`,
      payload,
    }, { db })
  }
}
