// backend/src/lib/maintenance.js
// Periodic maintenance tasks.
import { cancelPendingPaymentAppointmentTx, cancelPublicPendingAppointmentTx } from './appointment_loyalty.js'
import { createAsaasPayments } from '../services/asaas/payments.js'
import { applyAsaasWebhookAction, mapAsaasEvent } from '../routes/webhooks_asaas.js'
import { notifyAppointmentConfirmed } from './appointment_confirmation.js'

const ASAAS_PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])

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

/**
 * Revalida um sinal Asaas vencido no gateway ANTES de expirá-lo, corrigindo a corrida
 * "pago no último segundo + webhook atrasado". Retorna 'confirmed' | 'expired' | 'deferred'.
 * `payments` é injetável para testes.
 */
export async function reconcileExpiredAsaasDeposit({ pool, row, payments }) {
  const pay = payments || createAsaasPayments()

  if (!row?.provider_payment_id) {
    await pool.query("UPDATE appointment_payments SET status='expired' WHERE id=? AND status='pending'", [row.id])
    await cancelPendingPaymentAppointmentTx(row.agendamento_id, { db: pool })
    return 'expired'
  }

  let remote
  try {
    remote = await pay.getPayment(row.provider_payment_id)
  } catch (err) {
    // Falha de rede: não expira agora (evita cancelar um sinal possivelmente pago); tenta no próximo tick.
    console.warn('[maintenance][asaas] getPayment falhou; adia', row.id, err?.message || err)
    return 'deferred'
  }

  const status = String(remote?.status || '').toUpperCase()
  if (ASAAS_PAID_STATUSES.has(status)) {
    const valueCents = Number.isFinite(Number(remote?.value)) ? Math.round(Number(remote.value) * 100) : null
    const netValueCents = Number.isFinite(Number(remote?.netValue)) ? Math.round(Number(remote.netValue) * 100) : null
    const descriptor = { kind: 'deposit', action: 'confirm', internalId: row.id, paymentId: row.provider_payment_id, valueCents, netValueCents }
    const result = await applyAsaasWebhookAction(descriptor, { db: pool, rawPayload: JSON.stringify(remote || {}) })
    if (result?.matched && result.agendamentoId != null) notifyAppointmentConfirmed(result.agendamentoId).catch(() => {})
    return 'confirmed'
  }

  // Não pago: remove a cobrança (evita pagamento tardio) e expira/cancela.
  try {
    await pay.deletePayment(row.provider_payment_id)
  } catch (err) {
    console.warn('[maintenance][asaas] deletePayment falhou', row.id, err?.message || err)
  }
  await pool.query("UPDATE appointment_payments SET status='expired' WHERE id=? AND status='pending'", [row.id])
  await cancelPendingPaymentAppointmentTx(row.agendamento_id, { db: pool })
  return 'expired'
}

export async function cleanupExpiredAppointmentPayments(pool, { limit = 200, payments } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT id, agendamento_id, provider, provider_payment_id
         FROM appointment_payments
        WHERE status='pending'
          AND expires_at < NOW()
        ORDER BY expires_at ASC
        LIMIT ?`,
      [Number(limit)]
    )
    if (!rows.length) return { expiredPayments: 0 }

    const asaasRows = rows.filter((row) => String(row.provider) === 'asaas')
    const otherRows = rows.filter((row) => String(row.provider) !== 'asaas')

    let expiredPayments = 0
    let confirmedLate = 0

    // Legado (Mercado Pago e afins): comportamento atual — expira em lote e cancela.
    if (otherRows.length) {
      const paymentIds = otherRows.map((row) => row.id)
      const paymentPlaceholders = paymentIds.map(() => '?').join(',')
      await pool.query(
        `UPDATE appointment_payments SET status='expired' WHERE id IN (${paymentPlaceholders})`,
        paymentIds
      )
      for (const row of otherRows) {
        const result = await cancelPendingPaymentAppointmentTx(row.agendamento_id, { db: pool })
        if (result?.canceled) expiredPayments += 1
      }
    }

    // Asaas: revalida no gateway antes de expirar (corrige a corrida pago-porém-expirado).
    for (const row of asaasRows) {
      const outcome = await reconcileExpiredAsaasDeposit({ pool, row, payments })
      if (outcome === 'confirmed') confirmedLate += 1
      else if (outcome === 'expired') expiredPayments += 1
      // 'deferred' -> tenta no próximo tick
    }

    return { expiredPayments, confirmedLate }
  } catch (e) {
    console.error('[maintenance] cleanupExpiredAppointmentPayments error:', e?.message || e)
    return { expiredPayments: 0, error: e?.message || String(e) }
  }
}

/**
 * Reprocessa eventos de webhook Asaas registrados mas não concluídos (processed_at NULL).
 * Cobre falhas de processamento inline sem depender de reenvio do Asaas (desenho 200-always).
 */
export async function reprocessPendingAsaasWebhookEvents(pool, { limit = 100, olderThanSeconds = 60 } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT id, payload
         FROM asaas_webhook_events
        WHERE processed_at IS NULL
          AND payload IS NOT NULL
          AND received_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
        ORDER BY received_at ASC
        LIMIT ?`,
      [Number(olderThanSeconds), Number(limit)]
    )
    if (!rows.length) return { reprocessed: 0 }

    let reprocessed = 0
    for (const row of rows) {
      let body = null
      try { body = JSON.parse(row.payload) } catch { body = null }
      if (!body) {
        await pool.query("UPDATE asaas_webhook_events SET error='payload_unparseable' WHERE id=?", [row.id]).catch(() => {})
        continue
      }
      try {
        const descriptor = mapAsaasEvent(body)
        const result = await applyAsaasWebhookAction(descriptor, { db: pool, rawPayload: row.payload })
        await pool.query('UPDATE asaas_webhook_events SET processed_at=NOW(), error=NULL WHERE id=?', [row.id])
        if (result?.notify === 'confirmed' && result.agendamentoId != null) {
          notifyAppointmentConfirmed(result.agendamentoId).catch(() => {})
        }
        reprocessed += 1
      } catch (err) {
        await pool
          .query('UPDATE asaas_webhook_events SET error=? WHERE id=?', [String(err?.message || err).slice(0, 1000), row.id])
          .catch(() => {})
      }
    }
    return { reprocessed }
  } catch (e) {
    console.error('[maintenance] reprocessPendingAsaasWebhookEvents error:', e?.message || e)
    return { reprocessed: 0, error: e?.message || String(e) }
  }
}

// Retenção da trilha de auditoria. Sem purga a tabela cresce para sempre; purgar rápido demais
// destrói a prova. 12 meses é o padrão (ajustável por AUDIT_RETENTION_DAYS) e a exclusão é feita
// em lotes para não travar a tabela num DELETE gigante.
const AUDIT_RETENTION_DAYS = Math.max(1, Number(process.env.AUDIT_RETENTION_DAYS || 365))

export async function purgeAuditLog(pool, { batchSize = 1000, maxBatches = 20 } = {}) {
  let deleted = 0
  try {
    for (let i = 0; i < maxBatches; i += 1) {
      const [r] = await pool.query(
        'DELETE FROM audit_log WHERE criado_em < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?',
        [AUDIT_RETENTION_DAYS, batchSize]
      )
      const rows = r?.affectedRows || 0
      deleted += rows
      if (rows < batchSize) break
    }
    return { deleted, retentionDays: AUDIT_RETENTION_DAYS }
  } catch (e) {
    console.error('[maintenance] purgeAuditLog error:', e?.message || e)
    return { deleted, retentionDays: AUDIT_RETENTION_DAYS, error: e?.message || String(e) }
  }
}

export function startMaintenance(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || 6 * 60 * 60 * 1000)
  async function tick() {
    const r = await cleanupPasswordResets(pool)
    console.log('[maintenance] password_resets cleanup', r)
    const a = await purgeAuditLog(pool)
    if (a?.deleted || a?.error) {
      console.log('[maintenance] audit_log purge', a)
    }
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
    if (r?.expiredPayments || r?.confirmedLate) {
      console.log('[maintenance] appointment payments cleanup', r)
    }
    const w = await reprocessPendingAsaasWebhookEvents(pool)
    if (w?.reprocessed) {
      console.log('[maintenance] asaas webhook reprocess', w)
    }
  }
  setTimeout(tick, 10_000)
  return setInterval(tick, every)
}
