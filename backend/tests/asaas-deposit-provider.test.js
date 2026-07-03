import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createAsaasDepositPixPayment, resolveDepositProvider } = await import('../src/lib/deposit_provider.js')

// client Asaas de baixo nível (get/post) com respostas canned por path.
function stubClient(byKey = {}) {
  const calls = []
  const handle = (method) => async (path, opts = {}) => {
    calls.push({ method, path, ...opts })
    const canned = byKey[`${method} ${path}`] ?? byKey[path]
    return typeof canned === 'function' ? canned(path, opts) : canned ?? {}
  }
  return { calls, get: handle('GET'), post: handle('POST'), put: handle('PUT'), delete: handle('DELETE') }
}

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

test('resolveDepositProvider respeita DEPOSIT_PROVIDER', () => {
  const prev = process.env.DEPOSIT_PROVIDER
  process.env.DEPOSIT_PROVIDER = 'asaas'
  assert.equal(resolveDepositProvider(), 'asaas')
  process.env.DEPOSIT_PROVIDER = 'mercadopago'
  assert.equal(resolveDepositProvider(), 'mercadopago')
  delete process.env.DEPOSIT_PROVIDER
  assert.equal(resolveDepositProvider(), 'mercadopago')
  if (prev !== undefined) process.env.DEPOSIT_PROVIDER = prev
})

test('reusa asaas_customer_id cacheado e devolve shape MP', async () => {
  const client = stubClient({
    'POST /v3/payments': { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://asaas/inv/1' },
    'GET /v3/payments/pay_1/pixQrCode': { encodedImage: 'B64==', payload: '000201PIX', expirationDate: '2026-07-02 23:59:59' },
  })
  const db = fakeDb([
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[{ asaas_customer_id: 'cus_cached' }]] },
  ])

  const { payment, pix, providerPaymentId } = await createAsaasDepositPixPayment({
    amountCents: 1500,
    description: 'Sinal - Corte',
    externalReference: 'deposit:42',
    payer: { name: 'Fulano', email: 'f@x.com', cpfCnpj: '12345678909', phone: '11999998888' },
    userId: 7,
    expiresAt: new Date('2026-07-02T12:00:00Z'),
    client,
    db,
  })

  // não criou customer novo (usou o cacheado)
  assert.ok(!client.calls.some((c) => c.path === '/v3/customers'))
  const chargeCall = client.calls.find((c) => c.path === '/v3/payments')
  assert.equal(chargeCall.body.customer, 'cus_cached')
  assert.equal(chargeCall.body.value, 15) // 1500 centavos -> 15 reais
  assert.equal(chargeCall.body.billingType, 'PIX')
  assert.equal(chargeCall.body.externalReference, 'deposit:42')

  assert.equal(providerPaymentId, 'pay_1')
  assert.equal(payment.__provider, 'asaas')
  assert.equal(payment.point_of_interaction.transaction_data.qr_code_base64, 'B64==')
  assert.equal(payment.point_of_interaction.transaction_data.copia_e_cola, '000201PIX')
  assert.equal(pix.qr_code_base64, 'B64==')
  assert.equal(pix.amount_cents, 1500)
})

test('cria customer quando não há cache e persiste em usuarios', async () => {
  const client = stubClient({
    'POST /v3/customers': { id: 'cus_new' },
    'POST /v3/payments': { id: 'pay_2', status: 'PENDING' },
    'GET /v3/payments/pay_2/pixQrCode': { encodedImage: 'X', payload: 'Y', expirationDate: null },
  })
  const db = fakeDb([
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[]] }, // sem cache
    { match: /UPDATE usuarios SET asaas_customer_id/, result: [{ affectedRows: 1 }] },
  ])

  const { providerPaymentId } = await createAsaasDepositPixPayment({
    amountCents: 2500,
    description: 'Sinal',
    externalReference: 'deposit:99',
    payer: { name: 'Beltrano' },
    userId: 9,
    client,
    db,
  })

  assert.ok(client.calls.some((c) => c.path === '/v3/customers'))
  const charge = client.calls.find((c) => c.path === '/v3/payments')
  assert.equal(charge.body.customer, 'cus_new')
  assert.equal(providerPaymentId, 'pay_2')
  // persistiu o customer id
  assert.ok(db.calls.some((c) => /UPDATE usuarios SET asaas_customer_id/.test(c.sql) && c.params.includes('cus_new')))
})
