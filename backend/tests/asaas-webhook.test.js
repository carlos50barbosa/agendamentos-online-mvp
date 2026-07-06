import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'
process.env.ASAAS_WEBHOOK_TOKEN = 'whk-secret-123'

const { isAuthorizedAsaasWebhook, mapAsaasEvent, applyAsaasWebhookAction } = await import('../src/routes/webhooks_asaas.js')

// Fake db: casa a SQL por regex e devolve um resultado canned ([rows] | [okResult]).
function fakeDb(handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      for (const h of handlers) {
        if (h.match.test(sql)) return h.result
      }
      return [{ affectedRows: 0 }]
    },
  }
}

// ----------------------- auth -----------------------
test('auth: valida asaas-access-token', () => {
  assert.equal(isAuthorizedAsaasWebhook({ 'asaas-access-token': 'whk-secret-123' }, 'whk-secret-123'), true)
  assert.equal(isAuthorizedAsaasWebhook({ 'asaas-access-token': 'errado' }, 'whk-secret-123'), false)
  assert.equal(isAuthorizedAsaasWebhook({}, 'whk-secret-123'), false)
  assert.equal(isAuthorizedAsaasWebhook({ 'asaas-access-token': 'x' }, ''), false)
})

// ----------------------- mapeamento -----------------------
test('map: sinal confirma em RECEIVED e CONFIRMED', () => {
  const received = mapAsaasEvent({ id: 'evt1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  assert.equal(received.kind, 'deposit')
  assert.equal(received.internalId, 42)
  assert.equal(received.action, 'confirm')

  const confirmed = mapAsaasEvent({ id: 'evt1b', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  assert.equal(confirmed.action, 'confirm') // CONFIRMED cobre bloqueio cautelar de conta PF
})

test('map: sinal vencido/removido libera o slot (fail_release)', () => {
  assert.equal(mapAsaasEvent({ event: 'PAYMENT_OVERDUE', payment: { externalReference: 'deposit:9' } }).action, 'fail_release')
  assert.equal(mapAsaasEvent({ event: 'PAYMENT_DELETED', payment: { externalReference: 'deposit:9' } }).action, 'fail_release')
  // assinatura mantém past_due no overdue
  assert.equal(mapAsaasEvent({ event: 'PAYMENT_OVERDUE', payment: { subscription: 'sub_x' } }).action, 'past_due')
})

test('map: extrai value/netValue em centavos (para a taxa real do Asaas)', () => {
  const d = mapAsaasEvent({ id: 'e', event: 'PAYMENT_RECEIVED', payment: { externalReference: 'deposit:1', value: 30, netValue: 28.01 } })
  assert.equal(d.valueCents, 3000)
  assert.equal(d.netValueCents, 2801)
})

test('map: assinatura ativa no CONFIRMED ou RECEIVED', () => {
  const c = mapAsaasEvent({ id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'p', subscription: 'sub_x' } })
  assert.equal(c.kind, 'subscription')
  assert.equal(c.subscriptionId, 'sub_x')
  assert.equal(c.action, 'confirm')
  const r = mapAsaasEvent({ id: 'e2', event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub_x' } })
  assert.equal(r.action, 'confirm')
})

test('map: overdue/refunded e desconhecido', () => {
  assert.equal(mapAsaasEvent({ event: 'PAYMENT_OVERDUE', payment: { subscription: 'sub_x' } }).action, 'past_due')
  assert.equal(mapAsaasEvent({ event: 'PAYMENT_REFUNDED', payment: { externalReference: 'deposit:9' } }).action, 'refunded')
  const unk = mapAsaasEvent({ event: 'PAYMENT_RECEIVED', payment: { id: 'p', externalReference: 'outro:1' } })
  assert.equal(unk.kind, 'unknown')
})

// ----------------------- aplicação -----------------------
test('apply: sinal pago confirma pagamento, agendamento e taxa real', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77, split_centavos: 2750, refund_initiated_by_cancellation: 0 }]] },
    { match: /UPDATE appointment_payments/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE agendamentos/, result: [{ affectedRows: 1 }] },
  ])
  const desc = mapAsaasEvent({ id: 'evt1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay1', externalReference: 'deposit:42', value: 30, netValue: 28.01 } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.matched, true)
  assert.equal(res.agendamentoId, 77)
  assert.equal(res.notify, 'confirmed')
  assert.equal(db.calls.length, 3)
  assert.match(db.calls[0].sql, /SELECT agendamento_id/)
  assert.match(db.calls[1].sql, /UPDATE appointment_payments/)
  assert.equal(db.calls[1].params[0], 199) // asaas_fee_centavos = (30 - 28,01)*100
  assert.match(db.calls[2].sql, /UPDATE agendamentos/)
  assert.equal(db.calls[2].params.at(-1), 77)
})

test('apply: sinal já não-pendente não mexe no agendamento', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77 }]] },
    { match: /UPDATE appointment_payments/, result: [{ affectedRows: 0 }] },
  ])
  const desc = mapAsaasEvent({ id: 'evt1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.matched, false)
  assert.equal(db.calls.length, 2) // SELECT + UPDATE, sem tocar agendamentos
})

test('apply: estorno cancela o agendamento e sinaliza estorno inesperado', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77, refund_initiated_by_cancellation: 0 }]] },
    { match: /UPDATE appointment_payments SET status='refunded'/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE agendamentos SET status='cancelado'/, result: [{ affectedRows: 1 }] },
  ])
  const desc = mapAsaasEvent({ id: 'r1', event: 'PAYMENT_REFUNDED', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.matched, true)
  assert.equal(res.unexpectedRefund, true)
  assert.match(db.calls[2].sql, /UPDATE agendamentos SET status='cancelado'/)
})

test('apply: estorno de um cancelamento nosso não é inesperado', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77, refund_initiated_by_cancellation: 1 }]] },
    { match: /UPDATE appointment_payments SET status='refunded'/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE agendamentos SET status='cancelado'/, result: [{ affectedRows: 1 }] },
  ])
  const desc = mapAsaasEvent({ id: 'r2', event: 'PAYMENT_REFUNDED', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.matched, true)
  assert.equal(res.unexpectedRefund, false)
})

test('apply: fail_release marca sinal failed e libera o slot', async () => {
  const db = fakeDb([
    { match: /SELECT agendamento_id, split_centavos/, result: [[{ agendamento_id: 77 }]] },
    { match: /UPDATE appointment_payments SET status='failed'/, result: [{ affectedRows: 1 }] },
    // cancelPendingPaymentAppointmentTx lê o snapshot; vazio -> no-op seguro
    { match: /FROM agendamentos/, result: [[]] },
  ])
  const desc = mapAsaasEvent({ id: 'o1', event: 'PAYMENT_OVERDUE', payment: { id: 'pay1', externalReference: 'deposit:42' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.action, 'fail_release')
  assert.equal(res.matched, true)
  assert.match(db.calls[1].sql, /status='failed'/)
})

test('apply: assinatura confirmada ativa subscription + usuario + evento', async () => {
  const db = fakeDb([
    { match: /SELECT id, estabelecimento_id, plan FROM subscriptions/, result: [[{ id: 5, estabelecimento_id: 9, plan: 'pro' }]] },
    { match: /UPDATE subscriptions/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE usuarios/, result: [{ affectedRows: 1 }] },
    { match: /INSERT INTO subscription_events/, result: [{ insertId: 1 }] },
  ])
  const desc = mapAsaasEvent({ id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay2', subscription: 'sub_x' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.handled, true)
  assert.match(db.calls[1].sql, /UPDATE subscriptions SET status='active'/)
  assert.match(db.calls[2].sql, /UPDATE usuarios SET plan_status='active'/)
  assert.ok(db.calls[2].params.includes('pro')) // ativa o plano do estabelecimento
  assert.match(db.calls[3].sql, /INSERT INTO subscription_events/)
})

test('apply: assinatura vencida -> past_due', async () => {
  const db = fakeDb([
    { match: /SELECT id, estabelecimento_id, plan FROM subscriptions/, result: [[{ id: 5, estabelecimento_id: 9, plan: 'pro' }]] },
    { match: /UPDATE subscriptions/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE usuarios/, result: [{ affectedRows: 1 }] },
    { match: /INSERT INTO subscription_events/, result: [{ insertId: 1 }] },
  ])
  const desc = mapAsaasEvent({ id: 'e3', event: 'PAYMENT_OVERDUE', payment: { subscription: 'sub_x' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.handled, true)
  assert.match(db.calls[1].sql, /past_due/)
})

test('apply: assinatura inexistente é no-op', async () => {
  const db = fakeDb([{ match: /SELECT id, estabelecimento_id, plan FROM subscriptions/, result: [[]] }])
  const desc = mapAsaasEvent({ id: 'e4', event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub_inexistente' } })
  const res = await applyAsaasWebhookAction(desc, { db, rawPayload: '{}' })
  assert.equal(res.handled, false)
  assert.equal(res.reason, 'subscription_not_found')
})

test('apply: evento ignorado não toca no banco', async () => {
  const db = fakeDb()
  const desc = mapAsaasEvent({ id: 'e5', event: 'PAYMENT_CREATED', payment: { externalReference: 'deposit:1' } })
  const res = await applyAsaasWebhookAction(desc, { db })
  assert.equal(res.handled, false)
  assert.equal(db.calls.length, 0)
})
