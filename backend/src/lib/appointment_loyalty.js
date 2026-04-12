import { pool } from './db.js'
import { restoreClientLoyaltyBenefitsFromSnapshotTx } from './client_loyalty_credits.js'

function safeJsonParse(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function fetchAppointmentLoyaltySnapshot(appointmentId, { db = pool, forUpdate = false } = {}) {
  if (!appointmentId) return null
  const lock = forUpdate ? ' FOR UPDATE' : ''
  const [rows] = await db.query(
    `SELECT id, status, loyalty_benefit_snapshot_json
       FROM agendamentos
      WHERE id=?
      LIMIT 1${lock}`,
    [appointmentId]
  )
  const row = rows?.[0] || null
  if (!row) return null
  return {
    id: Number(row.id),
    status: String(row.status || '').toLowerCase(),
    snapshot: safeJsonParse(row.loyalty_benefit_snapshot_json),
  }
}

export async function restoreAppointmentLoyaltyBenefitsTx(appointmentId, { db = pool } = {}) {
  const appointment = await fetchAppointmentLoyaltySnapshot(appointmentId, { db, forUpdate: false })
  if (!appointment?.snapshot) {
    return { ok: false, restored: false, reason: 'snapshot_missing' }
  }
  await restoreClientLoyaltyBenefitsFromSnapshotTx(appointment.snapshot, { db })
  return { ok: true, restored: true, appointment }
}

export async function cancelPendingPaymentAppointmentTx(appointmentId, { db = pool } = {}) {
  const appointment = await fetchAppointmentLoyaltySnapshot(appointmentId, { db, forUpdate: true })
  if (!appointment) return { ok: false, canceled: false, reason: 'not_found' }
  if (appointment.status !== 'pendente_pagamento') {
    return { ok: false, canceled: false, reason: 'not_pending_payment', appointment }
  }

  const [result] = await db.query(
    "UPDATE agendamentos SET status='cancelado', deposit_expires_at=NOW() WHERE id=? AND status='pendente_pagamento'",
    [appointmentId]
  )
  if (!result?.affectedRows) {
    return { ok: false, canceled: false, reason: 'not_updated', appointment }
  }
  if (appointment.snapshot) {
    await restoreClientLoyaltyBenefitsFromSnapshotTx(appointment.snapshot, { db })
  }
  return { ok: true, canceled: true, appointment }
}

export async function cancelPublicPendingAppointmentTx(appointmentId, { db = pool } = {}) {
  const appointment = await fetchAppointmentLoyaltySnapshot(appointmentId, { db, forUpdate: true })
  if (!appointment) return { ok: false, canceled: false, reason: 'not_found' }
  if (appointment.status !== 'pendente') {
    return { ok: false, canceled: false, reason: 'not_pending', appointment }
  }

  const [result] = await db.query(
    `UPDATE agendamentos
        SET status='cancelado'
      WHERE id=?
        AND status='pendente'`,
    [appointmentId]
  )
  if (!result?.affectedRows) {
    return { ok: false, canceled: false, reason: 'not_updated', appointment }
  }
  if (appointment.snapshot) {
    await restoreClientLoyaltyBenefitsFromSnapshotTx(appointment.snapshot, { db })
  }
  return { ok: true, canceled: true, appointment }
}
