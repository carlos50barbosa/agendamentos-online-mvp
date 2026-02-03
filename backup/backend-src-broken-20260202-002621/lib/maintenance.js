// backend/src/lib/maintenance.js
// Tarefas de manutenção periódicas (limpeza de tokens, etc.)

export async function cleanupPasswordResets(pool) {
try {
const [r1] = await pool.query(
      'DELETE FROM password_resets WHERE expires_at < NOW()'
    );
const [r2] = await pool.query(
      'DELETE FROM password_resets WHERE used_at IS NOT NULL AND used_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
    );
return {
expiredDeleted: r1?.affectedRows || 0, usedOldDeleted: r2?.affectedRows || 0, };
} catch (e) {
console.error('[maintenance] cleanupPasswordResets error:', e?.message || e);
return { expiredDeleted: 0, usedOldDeleted: 0, error: e?.message || String(e) };
}
}
export async function cleanupPublicPendingAppointments(pool) {
try {
const [r] = await pool.query(
      `UPDATE agendamentos
          SET status='cancelado'
        WHERE status='pendente'
          AND public_confirm_expires_at IS NOT NULL
          AND public_confirm_expires_at < NOW()`
    );
return { expiredCanceled: r?.affectedRows || 0 };
} catch (e) {
console.error('[maintenance] cleanupPublicPendingAppointments error:', e?.message || e);
return { expiredCanceled: 0, error: e?.message || String(e) };
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
        LIMIT ?`, [Number(limit)] );
if (!rows.length) return { expiredPayments: 0 };
const paymentIds = rows.map((row) => row.id);
const appointmentIds = rows.map((row) => row.agendamento_id);
const paymentPlaceholders = paymentIds.map(() => '?').join(',');
const appointmentPlaceholders = appointmentIds.map(() => '?').join(',');
await pool.query(
      `UPDATE appointment_payments
          SET status='expired'
        WHERE id IN (${paymentPlaceholders})`, paymentIds );
await pool.query(
      `UPDATE agendamentos
          SET status='cancelado',
              deposit_expires_at=NOW()
        WHERE id IN (${appointmentPlaceholders})
          AND status='pendente_pagamento'`, appointmentIds );
return { expiredPayments: paymentIds.length };
} catch (e) {
console.error('[maintenance] cleanupExpiredAppointmentPayments error:', e?.message || e);
return { expiredPayments: 0, error: e?.message || String(e) };
}
}
export function startMaintenance(pool, { intervalMs } = {}) {
const every = Number(intervalMs || 6 * 60 * 60 * 1000); // 6h
  async function tick() {
const r = await cleanupPasswordResets(pool);
console.log('[maintenance] password_resets cleanup', r);
}
  // primeira execução após pequeno delay para não travar o boot
  setTimeout(tick, 10_000);
  // agenda periódico
  return setInterval(tick, every);
}
export function startPublicPendingCleanup(pool, { intervalMs } = {}) {
const every = Number(intervalMs || 60_000);
async function tick() {
const r = await cleanupPublicPendingAppointments(pool);
if (r?.expiredCanceled) {
console.log('[maintenance] public pending cleanup', r);
}
  }
setTimeout(tick, 10_000);
return setInterval(tick, every);
}
export function startAppointmentPaymentCleanup(pool, { intervalMs } = {}) {
const every = Number(intervalMs || 60_000);
async function tick() {
const r = await cleanupExpiredAppointmentPayments(pool);
if (r?.expiredPayments) {
console.log('[maintenance] appointment payments cleanup', r);
}
  }
setTimeout(tick, 10_000);
return setInterval(tick, every);
}



