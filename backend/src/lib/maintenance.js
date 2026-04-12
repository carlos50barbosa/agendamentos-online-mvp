// backend/src/lib/maintenance.js
// Periodic maintenance tasks.
import { cancelPendingPaymentAppointmentTx, cancelPublicPendingAppointmentTx } from './appointment_loyalty.js'

export async function cleanupPasswordResets(pool) {
  try {
    const [r1] = await pool.query(
      'DELETE FROM password_resets WHERE expires_at < NOW()'
    )
    const [r2] = await pool.query(
      'DELETE FROM password_resets WHERE used_at IS NOT NULL AND used_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
    )
    return {
      expiredDeleted: r1?.affectedRows || 0,
      usedOldDeleted: r2?.affectedRows || 0,
    }
  } catch (e) {
    console.error('[maintenance] cleanupPasswordResets error:', e?.message || e)
    return { expiredDeleted: 0, usedOldDeleted: 0, error: e?.message || String(e) }
  }
}

export async function cleanupPublicPendingAppointments(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT id
         FROM agendamentos
        WHERE status='pendente'
          AND public_confirm_expires_at IS NOT NULL
          AND public_confirm_expires_at < NOW()`
    )
    if (!rows.length) return { expiredCanceled: 0 }

    let expiredCanceled = 0
    for (const row of rows) {
      const result = await cancelPublicPendingAppointmentTx(row.id, { db: pool })
      if (result?.canceled) expiredCanceled += 1
    }
    return { expiredCanceled }
  } catch (e) {
    console.error('[maintenance] cleanupPublicPendingAppointments error:', e?.message || e)
    return { expiredCanceled: 0, error: e?.message || String(e) }
  }
}

export async function cleanupExpiredAppointmentPayments(pool, { limit = 200 } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT id, agendamento_id
         FROM appointment_payments
        WHERE status='pending'
          AND expires_at < NOW()
        ORDER BY expires_at ASC
        LIMIT ?`,
      [Number(limit)]
    )
    if (!rows.length) return { expiredPayments: 0 }

    const paymentIds = rows.map((row) => row.id)
    const paymentPlaceholders = paymentIds.map(() => '?').join(',')
    await pool.query(
      `UPDATE appointment_payments
          SET status='expired'
        WHERE id IN (${paymentPlaceholders})`,
      paymentIds
    )

    let expiredPayments = 0
    for (const row of rows) {
      const result = await cancelPendingPaymentAppointmentTx(row.agendamento_id, { db: pool })
      if (result?.canceled) expiredPayments += 1
    }
    return { expiredPayments }
  } catch (e) {
    console.error('[maintenance] cleanupExpiredAppointmentPayments error:', e?.message || e)
    return { expiredPayments: 0, error: e?.message || String(e) }
  }
}

export function startMaintenance(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || 6 * 60 * 60 * 1000)
  async function tick() {
    const r = await cleanupPasswordResets(pool)
    console.log('[maintenance] password_resets cleanup', r)
  }
  setTimeout(tick, 10_000)
  return setInterval(tick, every)
}

export function startPublicPendingCleanup(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || 60_000)
  async function tick() {
    const r = await cleanupPublicPendingAppointments(pool)
    if (r?.expiredCanceled) {
      console.log('[maintenance] public pending cleanup', r)
    }
  }
  setTimeout(tick, 10_000)
  return setInterval(tick, every)
}

export function startAppointmentPaymentCleanup(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || 60_000)
  async function tick() {
    const r = await cleanupExpiredAppointmentPayments(pool)
    if (r?.expiredPayments) {
      console.log('[maintenance] appointment payments cleanup', r)
    }
  }
  setTimeout(tick, 10_000)
  return setInterval(tick, every)
}
