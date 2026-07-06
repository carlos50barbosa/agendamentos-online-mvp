import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { reconcileExpiredAsaasDeposit, reprocessPendingAsaasWebhookEvents } = await import('../src/lib/maintenance.js')
const { refundAsaasDepositForCancellation } = await import('../src/lib/deposit_provider.js')

function fakeDb(handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      for (const h of handlers) if (h.match.test(sql)) return h.result
      return [{ affectedRows: 0 }]
    },
  }
}

function lowLevelClient(byKey = {}) {
  const calls = []
  const handle = (method) => async (path, opts = {}) => {
    calls.push({ method, path, ...opts })
    const canned = byKey[`${method} ${path}`] ?? byKey[path]
    return typeof canned === 'function' ? canned(path, opts) : canned ?? {}
  }
  return { calls, get: handle('GET'), post: handle('POST'), put: handle('PUT'), delete: handle('DELETE') }
}

// ---------------- reconcileExpiredAsaasDeposit ----------------
test('reconcile: pago no gateway -> confirma (não expira)', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77 }]] },
    { match: /UPDATE appointment_payments/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE agendamentos/, result: [{ affectedRows: 1 }] },
  ])
  let deleted = false
  const payments = {
    getPayment: async () => ({ status: 'RECEIVED', value: 30, netValue: 28.01 }),
    deletePayment: async () => { deleted = true },
  }
  const outcome = await reconcileExpiredAsaasDeposit({ pool: db, row: { id: 5, agendamento_id: 77, provider_payment_id: 'pay_x' }, payments })
  assert.equal(outcome, 'confirmed')
  assert.equal(deleted, false) // não remove a cobrança de um sinal pago
})

test('reconcile: não pago -> remove a cobrança e expira', async () => {
  const db = fakeDb([
    { match: /UPDATE appointment_payments SET status='expired'/, result: [{ affectedRows: 1 }] },
    { match: /FROM agendamentos/, result: [[]] }, // snapshot do cancel -> vazio (no-op)
  ])
  let deletedId = null
  const payments = {
    getPayment: async () => ({ status: 'PENDING' }),
    deletePayment: async (id) => { deletedId = id },
  }
  const outcome = await reconcileExpiredAsaasDeposit({ pool: db, row: { id: 5, agendamento_id: 77, provider_payment_id: 'pay_x' }, payments })
  assert.equal(outcome, 'expired')
  assert.equal(deletedId, 'pay_x')
  assert.ok(db.calls.some((c) => /status='expired'/.test(c.sql)))
})

test('reconcile: falha ao consultar o gateway -> adia (não expira)', async () => {
  const db = fakeDb()
  const payments = { getPayment: async () => { throw new Error('network') }, deletePayment: async () => {} }
  const outcome = await reconcileExpiredAsaasDeposit({ pool: db, row: { id: 5, agendamento_id: 77, provider_payment_id: 'pay_x' }, payments })
  assert.equal(outcome, 'deferred')
  assert.ok(!db.calls.some((c) => /status='expired'/.test(c.sql))) // não expirou
})

// ---------------- refundAsaasDepositForCancellation ----------------
test('refund: sinal pago dentro da janela é estornado (com flag de origem)', async () => {
  const futureInicio = new Date(Date.now() + 48 * 3_600_000).toISOString() // 48h à frente
  const db = fakeDb([
    { match: /FROM appointment_payments ap/, result: [[{ id: 9, provider_payment_id: 'pay_r', status: 'paid', inicio: futureInicio, refund_window_hours: 24 }]] },
    { match: /UPDATE appointment_payments SET refund_initiated_by_cancellation=1/, result: [{ affectedRows: 1 }] },
  ])
  const client = lowLevelClient({ 'POST /v3/payments/pay_r/refund': { status: 'REFUNDED' } })
  const r = await refundAsaasDepositForCancellation(123, { db, client })
  assert.equal(r.refunded, true)
  assert.ok(db.calls.some((c) => /refund_initiated_by_cancellation=1/.test(c.sql)))
  assert.ok(client.calls.some((c) => c.method === 'POST' && c.path === '/v3/payments/pay_r/refund'))
})

test('refund: fora da janela não estorna', async () => {
  const soonInicio = new Date(Date.now() + 1 * 3_600_000).toISOString() // 1h à frente < 24h
  const db = fakeDb([
    { match: /FROM appointment_payments ap/, result: [[{ id: 9, provider_payment_id: 'pay_r', status: 'paid', inicio: soonInicio, refund_window_hours: 24 }]] },
  ])
  const client = lowLevelClient()
  const r = await refundAsaasDepositForCancellation(123, { db, client })
  assert.equal(r.refunded, false)
  assert.equal(r.reason, 'outside_refund_window')
  assert.equal(client.calls.length, 0)
})

test('refund: ignoreWindow estorna mesmo com o horário no passado (no-show)', async () => {
  const pastInicio = new Date(Date.now() - 2 * 3_600_000).toISOString() // 2h atrás
  const db = fakeDb([
    { match: /FROM appointment_payments ap/, result: [[{ id: 9, provider_payment_id: 'pay_r', status: 'paid', inicio: pastInicio, refund_window_hours: 24 }]] },
    { match: /UPDATE appointment_payments SET refund_initiated_by_cancellation=1/, result: [{ affectedRows: 1 }] },
  ])
  const client = lowLevelClient({ 'POST /v3/payments/pay_r/refund': { status: 'REFUNDED' } })
  const r = await refundAsaasDepositForCancellation(123, { db, client, ignoreWindow: true })
  assert.equal(r.refunded, true)
  assert.ok(client.calls.some((c) => c.method === 'POST' && c.path === '/v3/payments/pay_r/refund'))
})

test('refund: sinal não pago não estorna', async () => {
  const db = fakeDb([
    { match: /FROM appointment_payments ap/, result: [[{ id: 9, provider_payment_id: 'pay_r', status: 'pending', inicio: null, refund_window_hours: 24 }]] },
  ])
  const client = lowLevelClient()
  const r = await refundAsaasDepositForCancellation(123, { db, client })
  assert.equal(r.refunded, false)
  assert.equal(r.reason, 'not_paid')
})

// ---------------- reprocessPendingAsaasWebhookEvents ----------------
test('reprocess: evento pendente é reprocessado e marcado processed_at', async () => {
  const payload = JSON.stringify({ id: 'evt9', event: 'PAYMENT_RECEIVED', payment: { id: 'pay1', externalReference: 'deposit:5' } })
  const db = fakeDb([
    { match: /FROM asaas_webhook_events/, result: [[{ id: 'evt9', payload }]] },
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77 }]] },
    { match: /UPDATE appointment_payments/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE agendamentos/, result: [{ affectedRows: 1 }] },
    { match: /SET processed_at=NOW\(\)/, result: [{ affectedRows: 1 }] },
  ])
  const r = await reprocessPendingAsaasWebhookEvents(db)
  assert.equal(r.reprocessed, 1)
  assert.ok(db.calls.some((c) => /SET processed_at=NOW\(\)/.test(c.sql)))
})
