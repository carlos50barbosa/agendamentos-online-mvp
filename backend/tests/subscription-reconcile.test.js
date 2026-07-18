import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { planTenantReconciliation, reconcileTenantSubscription } = await import('../src/lib/subscription_reconcile.js')

const NOW = new Date('2026-07-18T12:00:00.000Z')
const FUTURE = new Date('2026-08-06T12:00:00.000Z') // periodo pago vigente
const PAST = new Date('2026-07-01T12:00:00.000Z')

// Assinatura ja MAPEADA (camelCase), como listSubscriptionsForEstabelecimento devolve.
const sub = (over = {}) => ({
  id: 1,
  gateway: 'asaas',
  externalReference: 'subscription:estab:9',
  status: 'pending_pix',
  plan: 'pro',
  billingCycle: 'mensal',
  gatewaySubscriptionId: 'sub_x',
  lastPaymentAt: null,
  currentPeriodEnd: null,
  createdAt: PAST,
  ...over,
})

// O plan_status do usuario esta CORROMPIDO para 'pending_pix' (sincronizado com a efetiva orfa). O gate
// NAO pode depender dele — depende do periodo PAGO vigente (plan_active_until preservado / period_end).
const corruptedUser = { plan_status: 'pending_pix', plan_active_until: FUTURE, plan: 'pro', plan_cycle: 'mensal', plan_subscription_id: 20 }

test('planner: dispara MESMO com plan_status corrompido — paga cancelada + orfa -> reconcile', () => {
  const paid = sub({ id: 10, status: 'canceled', gatewaySubscriptionId: 'sub_paid', lastPaymentAt: PAST, currentPeriodEnd: FUTURE })
  const orphan = sub({ id: 20, status: 'pending_pix', gatewaySubscriptionId: 'sub_orphan', createdAt: new Date('2026-07-10T00:00:00Z') })
  const plan = planTenantReconciliation({ user: corruptedUser, subscriptions: [orphan, paid], now: NOW })

  assert.equal(plan.action, 'reconcile')
  assert.equal(plan.canonical.id, 10)
  assert.equal(plan.canonicalNeedsRestore, true)
  assert.deepEqual(plan.orphans.map((o) => o.id), [20])
  assert.equal(plan.orphans[0].gatewaySubscriptionId, 'sub_orphan')
})

test('planner: paidThrough vem do period_end da canonica quando plan_active_until e nulo', () => {
  const paid = sub({ id: 10, status: 'canceled', lastPaymentAt: PAST, currentPeriodEnd: FUTURE })
  const orphan = sub({ id: 20, status: 'pending_pix' })
  const plan = planTenantReconciliation({
    user: { plan_status: 'pending_pix', plan_active_until: null },
    subscriptions: [paid, orphan],
    now: NOW,
  })
  assert.equal(plan.action, 'reconcile')
  assert.equal(plan.paidThrough.getTime(), FUTURE.getTime())
})

test('planner: assinatura efetiva JA active -> noop', () => {
  const activeSub = sub({ id: 10, status: 'active', lastPaymentAt: PAST, currentPeriodEnd: FUTURE })
  const plan = planTenantReconciliation({ user: corruptedUser, subscriptions: [activeSub], now: NOW })
  assert.equal(plan.action, 'noop')
  assert.equal(plan.effectiveStatus, 'active')
})

test('planner: SEM periodo pago vigente (venceu) -> noop (nao mexe em quem nao tem periodo pago)', () => {
  const paidExpired = sub({ id: 10, status: 'expired', lastPaymentAt: PAST, currentPeriodEnd: PAST })
  const orphan = sub({ id: 20, status: 'pending_pix' })
  const plan = planTenantReconciliation({
    user: { plan_status: 'expired', plan_active_until: PAST },
    subscriptions: [paidExpired, orphan],
    now: NOW,
  })
  assert.equal(plan.action, 'noop')
})

test('planner: periodo pago vigente mas NENHUMA linha paga -> manual_review (nao auto-cancela sem canonica)', () => {
  const p1 = sub({ id: 20, status: 'pending_pix', lastPaymentAt: null })
  const p2 = sub({ id: 21, status: 'pending_payment', lastPaymentAt: null })
  const plan = planTenantReconciliation({ user: corruptedUser, subscriptions: [p1, p2], now: NOW })
  assert.equal(plan.action, 'manual_review')
  assert.equal(plan.canonical, null)
})

test('planner: cancela TODAS as pendentes orfas menos a canonica; ignora topup/MP', () => {
  const paid = sub({ id: 10, status: 'canceled', gatewaySubscriptionId: 'sub_paid', lastPaymentAt: PAST, currentPeriodEnd: FUTURE })
  const orphanA = sub({ id: 20, status: 'pending_pix' })
  const orphanB = sub({ id: 21, status: 'pending_payment' })
  const topup = sub({ id: 30, status: 'pending_pix', externalReference: 'wallet:whatsapp_topup:9' })
  const mp = sub({ id: 31, status: 'pending_pix', gateway: 'mercadopago' })
  const plan = planTenantReconciliation({ user: corruptedUser, subscriptions: [paid, orphanA, orphanB, topup, mp], now: NOW })
  assert.equal(plan.action, 'reconcile')
  assert.deepEqual(plan.orphans.map((o) => o.id).sort(), [20, 21])
})

// ---- Executor (fake db/payments) ----

function rawRow(over = {}) {
  return {
    id: 1,
    estabelecimento_id: 9,
    plan: 'pro',
    gateway: 'asaas',
    payment_method: 'pix',
    gateway_subscription_id: 'sub_x',
    external_reference: 'subscription:estab:9',
    status: 'pending_pix',
    amount_cents: 2990,
    currency: 'BRL',
    billing_cycle: 'mensal',
    current_period_end: null,
    last_payment_at: null,
    created_at: PAST,
    ...over,
  }
}

function fakeDb(rows) {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      calls.push({ sql: s, params })
      if (/SELECT plan_status, plan_active_until/.test(s)) {
        return [[{ plan_status: 'pending_pix', plan_active_until: FUTURE, plan: 'pro', plan_cycle: 'mensal', plan_subscription_id: 20 }]]
      }
      if (/SELECT \* FROM subscriptions WHERE estabelecimento_id=/.test(s)) return [rows]
      if (/SELECT \* FROM subscriptions WHERE id=/.test(s)) return [[rows[0]]]
      if (/UPDATE/.test(s)) return [{ affectedRows: 1 }]
      return [[]]
    },
  }
}

function fakePayments({ pendingCharge = { id: 'pay_orphan', status: 'PENDING' } } = {}) {
  const calls = []
  return {
    calls,
    getSubscriptionPayments: async (id) => { calls.push(['getSubscriptionPayments', id]); return pendingCharge ? [pendingCharge] : [] },
    deletePayment: async (id) => { calls.push(['deletePayment', id]); return { deleted: true } },
    setSubscriptionStatus: async (...args) => { calls.push(['setSubscriptionStatus', ...args]); return { status: args[1] } },
    updateSubscription: async (id, fields) => { calls.push(['updateSubscription', id, fields]); return { id, ...fields } },
  }
}

const MESSY_ROWS = [
  rawRow({ id: 20, status: 'pending_pix', gateway_subscription_id: 'sub_orphan', created_at: new Date('2026-07-10T00:00:00Z') }),
  rawRow({ id: 10, status: 'canceled', gateway_subscription_id: 'sub_paid', last_payment_at: PAST, current_period_end: FUTURE }),
]

test('executor DRY-RUN (apply=false): reporta o plano mas NAO altera nada (sem UPDATE, sem gateway)', async () => {
  const db = fakeDb(MESSY_ROWS)
  const payments = fakePayments()
  const report = await reconcileTenantSubscription(9, { apply: false, db, payments, now: NOW })

  assert.equal(report.action, 'reconcile')
  assert.equal(report.applied, false)
  assert.equal(report.canonical.id, 10)
  assert.deepEqual(report.orphans.map((o) => o.id), [20])
  assert.ok(!db.calls.some((c) => /UPDATE/.test(c.sql)), 'dry-run nao pode emitir UPDATE')
  assert.equal(payments.calls.length, 0, 'dry-run nao pode tocar o gateway')
})

test('executor APPLY: apaga cobranca da orfa, INATIVA orfa, restaura+REATIVA a paga e realinha usuarios', async () => {
  const db = fakeDb(MESSY_ROWS)
  const payments = fakePayments()
  const report = await reconcileTenantSubscription(9, { apply: true, db, payments, now: NOW })

  assert.equal(report.applied, true)
  assert.equal(report.restored, true)
  assert.equal(report.canonicalReactivated, true)
  assert.equal(report.userRealigned, true)
  assert.equal(report.gatewayConsistent, true)

  // Orfa: cobranca aberta apagada + INATIVADA no gateway (sub_orphan)
  assert.deepEqual(payments.calls.filter((c) => c[0] === 'deletePayment'), [['deletePayment', 'pay_orphan']])
  assert.ok(payments.calls.some((c) => c[0] === 'setSubscriptionStatus' && c[1] === 'sub_orphan' && c[2] === 'INACTIVE'))
  // Paga: REATIVADA no gateway (sub_paid) via updateSubscription com status ACTIVE + nextDueDate ancorado
  // no periodo pago (nao dispara cobranca imediata). NUNCA inativa a paga.
  const reactivate = payments.calls.find((c) => c[0] === 'updateSubscription' && c[1] === 'sub_paid')
  assert.ok(reactivate, 'deve reativar a paga via updateSubscription')
  assert.equal(reactivate[2].status, 'ACTIVE')
  assert.equal(reactivate[2].nextDueDate.getTime(), FUTURE.getTime())
  assert.ok(!payments.calls.some((c) => c[0] === 'setSubscriptionStatus' && c[1] === 'sub_paid' && c[2] === 'INACTIVE'))
  // Orfa cancelada local + canonica restaurada para active + usuarios realinhado a active
  assert.ok(db.calls.some((c) => /UPDATE subscriptions SET status=\?/.test(c.sql) && c.params.includes('canceled')))
  assert.ok(db.calls.some((c) => /UPDATE subscriptions SET status=\?/.test(c.sql) && c.params.includes('active')))
  const realign = db.calls.find((c) => /UPDATE usuarios SET plan=\?, plan_status='active'/.test(c.sql))
  assert.ok(realign && realign.params.includes('10'), 'usuarios deve ser realinhado e apontar para a canonica')
})

test('executor APPLY cancelGateway=false: reconcilia SO local, sem tocar o Asaas', async () => {
  const db = fakeDb(MESSY_ROWS)
  const payments = fakePayments()
  const report = await reconcileTenantSubscription(9, { apply: true, cancelGateway: false, db, payments, now: NOW })
  assert.equal(report.applied, true)
  assert.equal(payments.calls.length, 0, 'cancelGateway=false nao pode tocar o gateway')
  assert.ok(db.calls.some((c) => /UPDATE subscriptions SET status=\?/.test(c.sql) && c.params.includes('canceled')))
})

test('executor: estabelecimento inexistente lanca estabelecimento_not_found', async () => {
  const db = { query: async () => [[]] }
  await assert.rejects(
    () => reconcileTenantSubscription(9, { apply: true, db, payments: fakePayments(), now: NOW }),
    (e) => /estabelecimento_not_found/.test(e.message),
  )
})
