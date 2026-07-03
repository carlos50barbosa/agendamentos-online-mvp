import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createTenantAsaasSubscription, setTenantAsaasSubscriptionStatus, resolveBillingProvider } = await import('../src/lib/asaas_subscription.js')

function fakeDb(handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      for (const h of handlers) if (h.match.test(sql)) return h.result
      return [[]]
    },
  }
}

// payments mock (nível alto): registra chamadas.
function fakePayments(overrides = {}) {
  const calls = []
  const wrap = (name, fn) => async (...args) => {
    calls.push({ name, args })
    return fn ? fn(...args) : {}
  }
  return {
    calls,
    createCustomer: wrap('createCustomer', overrides.createCustomer || (() => ({ id: 'cus_new' }))),
    createSubscription: wrap('createSubscription', overrides.createSubscription || (() => ({ id: 'sub_asaas_1' }))),
    getSubscriptionPayments: wrap('getSubscriptionPayments', overrides.getSubscriptionPayments || (() => [{ id: 'pay_1', invoiceUrl: 'https://asaas/checkout/1' }])),
    setSubscriptionStatus: wrap('setSubscriptionStatus', overrides.setSubscriptionStatus || (() => ({ status: 'INACTIVE' }))),
    createPixCharge: wrap('createPixCharge'),
    getPixQrCode: wrap('getPixQrCode'),
  }
}

const SUB_ROW = {
  id: 10,
  estabelecimento_id: 9,
  plan: 'pro',
  gateway: 'asaas',
  payment_method: 'pix',
  gateway_customer_id: 'cus_estab',
  gateway_subscription_id: 'sub_asaas_1',
  external_reference: 'subscription:estab:9',
  status: 'pending_pix',
  amount_cents: 2990,
  currency: 'BRL',
  billing_cycle: 'mensal',
}

test('resolveBillingProvider respeita BILLING_PROVIDER', () => {
  const prev = process.env.BILLING_PROVIDER
  process.env.BILLING_PROVIDER = 'asaas'
  assert.equal(resolveBillingProvider(), 'asaas')
  process.env.BILLING_PROVIDER = 'mercadopago'
  assert.equal(resolveBillingProvider(), 'mercadopago')
  if (prev === undefined) delete process.env.BILLING_PROVIDER
  else process.env.BILLING_PROVIDER = prev
})

test('cria assinatura Asaas, persiste (gateway=asaas) e devolve link hospedado', async () => {
  const db = fakeDb([
    { match: /SELECT nome, email, telefone, cpf_cnpj FROM usuarios/, result: [[{ nome: 'Barbearia', email: 'b@x.com', telefone: '1130000000', cpf_cnpj: '12345678000199' }]] },
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[{ asaas_customer_id: 'cus_estab' }]] },
    { match: /INSERT INTO subscriptions/, result: [{ insertId: 10 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[SUB_ROW]] },
    { match: /UPDATE usuarios SET plan_subscription_id/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  const result = await createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'pro', cycle: 'mensal', db, payments })

  assert.equal(result.asaasSubscriptionId, 'sub_asaas_1')
  assert.equal(result.checkoutUrl, 'https://asaas/checkout/1')
  assert.equal(result.firstPaymentId, 'pay_1')
  assert.equal(result.subscription.gatewaySubscriptionId, 'sub_asaas_1')
  assert.equal(result.subscription.gateway, 'asaas')

  const subCall = payments.calls.find((c) => c.name === 'createSubscription')
  assert.equal(subCall.args[0].customerId, 'cus_estab')
  assert.equal(subCall.args[0].value, 29.9) // pro mensal = 2990 centavos
  assert.equal(subCall.args[0].cycle, 'MONTHLY')
  // INSERT persistiu gateway='asaas'
  const insert = db.calls.find((c) => /INSERT INTO subscriptions/.test(c.sql))
  assert.ok(insert.params.includes('asaas'))
  assert.ok(insert.params.includes('sub_asaas_1'))
})

test('plano inválido é rejeitado', async () => {
  await assert.rejects(
    () => createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'ouro', db: fakeDb(), payments: fakePayments() }),
    (e) => /invalid_plan/.test(e.message),
  )
})

test('suspende via INACTIVE chamando o gateway', async () => {
  const db = fakeDb([
    { match: /SELECT \* FROM subscriptions WHERE estabelecimento_id=/, result: [[SUB_ROW]] },
    { match: /UPDATE subscriptions SET/, result: [{ affectedRows: 1 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[{ ...SUB_ROW, status: 'canceled' }]] },
  ])
  const payments = fakePayments()

  const res = await setTenantAsaasSubscriptionStatus(9, 'INACTIVE', { db, payments })
  assert.equal(res.ok, true)
  const call = payments.calls.find((c) => c.name === 'setSubscriptionStatus')
  assert.deepEqual(call.args, ['sub_asaas_1', 'INACTIVE'])
})
