import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createAsaasPayments, toDateOnly } = await import('../src/services/asaas/payments.js')

// Client stub que registra chamadas e devolve respostas canned por path.
function stubClient(byPath = {}) {
  const calls = []
  const handle = (method) => async (path, opts = {}) => {
    calls.push({ method, path, ...opts })
    const key = `${method} ${path}`
    const canned = byPath[key] ?? byPath[path]
    return typeof canned === 'function' ? canned(path, opts) : canned ?? {}
  }
  return {
    calls,
    get: handle('GET'),
    post: handle('POST'),
    put: handle('PUT'),
    delete: handle('DELETE'),
  }
}

test('toDateOnly normaliza Date e string para YYYY-MM-DD', () => {
  assert.equal(toDateOnly('2026-07-02T10:30:00Z'), '2026-07-02')
  assert.equal(toDateOnly(new Date('2026-07-02T00:00:00Z')), '2026-07-02')
  assert.equal(toDateOnly(''), undefined)
})

test('createCustomer posta /v3/customers com os campos', async () => {
  const client = stubClient({ 'POST /v3/customers': { id: 'cus_1', name: 'Fulano' } })
  const pay = createAsaasPayments(client)
  const res = await pay.createCustomer({ name: 'Fulano', cpfCnpj: '12345678909', email: 'f@x.com', phone: '11999998888' })
  assert.equal(res.id, 'cus_1')
  assert.equal(client.calls[0].path, '/v3/customers')
  assert.equal(client.calls[0].body.name, 'Fulano')
  assert.equal(client.calls[0].body.cpfCnpj, '12345678909')
})

test('createCustomer exige name', async () => {
  const pay = createAsaasPayments(stubClient())
  await assert.rejects(() => pay.createCustomer({}), (e) => e.code === 'missing_field')
})

test('createSubscription usa cycle MONTHLY e nextDueDate normalizado', async () => {
  const client = stubClient({ 'POST /v3/subscriptions': { id: 'sub_1' } })
  const pay = createAsaasPayments(client)
  const res = await pay.createSubscription({
    customerId: 'cus_1',
    value: 49.9,
    nextDueDate: '2026-08-01T12:00:00Z',
    description: 'Plano Pro',
    externalReference: 'sub-internal-7',
  })
  assert.equal(res.id, 'sub_1')
  const body = client.calls[0].body
  assert.equal(body.customer, 'cus_1')
  assert.equal(body.value, 49.9)
  assert.equal(body.cycle, 'MONTHLY')
  assert.equal(body.nextDueDate, '2026-08-01')
  assert.equal(body.externalReference, 'sub-internal-7')
})

test('getSubscriptionPayments retorna o array data', async () => {
  const client = stubClient({ 'GET /v3/subscriptions/sub_1/payments': { data: [{ id: 'pay_1' }, { id: 'pay_2' }] } })
  const pay = createAsaasPayments(client)
  const list = await pay.getSubscriptionPayments('sub_1')
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 'pay_1')
})

test('setSubscriptionStatus aceita ACTIVE/INACTIVE e rejeita o resto', async () => {
  const client = stubClient({ 'POST /v3/subscriptions/sub_1': { id: 'sub_1', status: 'INACTIVE' } })
  const pay = createAsaasPayments(client)
  const res = await pay.setSubscriptionStatus('sub_1', 'inactive')
  assert.equal(res.status, 'INACTIVE')
  assert.equal(client.calls[0].body.status, 'INACTIVE')
  await assert.rejects(() => pay.setSubscriptionStatus('sub_1', 'paused'), (e) => e.code === 'invalid_status')
})

test('createPixCharge posta /v3/payments com billingType PIX', async () => {
  const client = stubClient({ 'POST /v3/payments': { id: 'pay_9' } })
  const pay = createAsaasPayments(client)
  const res = await pay.createPixCharge({ customerId: 'cus_1', value: 15, dueDate: '2026-07-03', externalReference: 'appt-pay-42' })
  assert.equal(res.id, 'pay_9')
  const body = client.calls[0].body
  assert.equal(body.billingType, 'PIX')
  assert.equal(body.value, 15)
  assert.equal(body.dueDate, '2026-07-03')
  assert.equal(body.externalReference, 'appt-pay-42')
  assert.equal(body.split, undefined) // conta única da plataforma: sem split
})

test('getPixQrCode mapeia encodedImage/payload/expirationDate', async () => {
  const client = stubClient({
    'GET /v3/payments/pay_9/pixQrCode': { encodedImage: 'BASE64==', payload: '000201...', expirationDate: '2026-07-03 23:59:59' },
  })
  const pay = createAsaasPayments(client)
  const qr = await pay.getPixQrCode('pay_9')
  assert.deepEqual(qr, { encodedImage: 'BASE64==', payload: '000201...', expirationDate: '2026-07-03 23:59:59' })
})

// ---------------------------------------------------------------------------
// Fase 1 do plano recorrente cliente -> estabelecimento (docs/PLANO-FIDELIDADE-ASAAS.md):
// split na assinatura + cartao tokenizado (debito automatico a cada ciclo).
// ---------------------------------------------------------------------------

test('createSubscription aceita split percentual (o Asaas replica em toda cobranca do ciclo)', async () => {
  const client = stubClient({ 'POST /v3/subscriptions': { id: 'sub_1' } })
  const pay = createAsaasPayments(client)
  await pay.createSubscription({
    customerId: 'cus_1',
    value: 80,
    externalReference: 'clientplan:77',
    split: [{ walletId: 'wal_abc', percentualValue: 95 }],
  })
  const body = client.calls[0].body
  assert.deepEqual(body.split, [{ walletId: 'wal_abc', percentualValue: 95 }])
  assert.equal(body.externalReference, 'clientplan:77')
})

test('assinatura no cartao envia token + remoteIp', async () => {
  const client = stubClient({ 'POST /v3/subscriptions': { id: 'sub_2' } })
  const pay = createAsaasPayments(client)
  await pay.createSubscription({
    customerId: 'cus_1',
    value: 80,
    billingType: 'credit_card', // minusculo de proposito: precisa normalizar
    creditCardToken: 'tok_123',
    remoteIp: '203.0.113.9',
  })
  const body = client.calls[0].body
  assert.equal(body.billingType, 'CREDIT_CARD')
  assert.equal(body.creditCardToken, 'tok_123')
  assert.equal(body.remoteIp, '203.0.113.9')
})

test('cartao sem token e sem dados do cartao falha ANTES de chamar o Asaas', async () => {
  const client = stubClient()
  const pay = createAsaasPayments(client)
  await assert.rejects(
    () => pay.createSubscription({ customerId: 'cus_1', value: 80, billingType: 'CREDIT_CARD', remoteIp: '1.2.3.4' }),
    (err) => err.code === 'missing_credit_card',
  )
  assert.equal(client.calls.length, 0, 'nao pode ter batido no Asaas')
})

test('cartao sem remoteIp falha ANTES de chamar o Asaas (o antifraude exige)', async () => {
  const client = stubClient()
  const pay = createAsaasPayments(client)
  await assert.rejects(
    () => pay.createSubscription({ customerId: 'cus_1', value: 80, billingType: 'CREDIT_CARD', creditCardToken: 'tok_1' }),
    (err) => err.code === 'missing_field',
  )
  assert.equal(client.calls.length, 0)
})

test('a assinatura do tenant segue sem split e em checkout hospedado', async () => {
  const client = stubClient({ 'POST /v3/subscriptions': { id: 'sub_3' } })
  const pay = createAsaasPayments(client)
  await pay.createSubscription({ customerId: 'cus_1', value: 29.9, externalReference: 'subscription:estab:5' })
  const body = client.calls[0].body
  assert.equal(body.billingType, 'UNDEFINED')
  assert.equal(body.split, undefined)
  assert.equal(body.creditCardToken, undefined)
})

test('tokenizeCreditCard devolve token + bandeira + 4 ultimos, e nao guarda o cartao', async () => {
  const client = stubClient({
    'POST /v3/creditCard/tokenize': { creditCardNumber: '1234', creditCardBrand: 'VISA', creditCardToken: 'tok_xyz' },
  })
  const pay = createAsaasPayments(client)
  const res = await pay.tokenizeCreditCard({
    customerId: 'cus_1',
    creditCard: { holderName: 'Jose C Barbosa', number: '4111111111111111', expiryMonth: '12', expiryYear: '2030', ccv: '123' },
    creditCardHolderInfo: { name: 'Jose C Barbosa', email: 'j@x.com', cpfCnpj: '12345678909', postalCode: '01001000', addressNumber: '10', phone: '11999990000' },
    remoteIp: '203.0.113.9',
  })
  assert.deepEqual(res, { creditCardNumber: '1234', creditCardBrand: 'VISA', creditCardToken: 'tok_xyz' })
})

test('tokenizeCreditCard exige remoteIp', async () => {
  const client = stubClient()
  const pay = createAsaasPayments(client)
  await assert.rejects(
    () => pay.tokenizeCreditCard({ customerId: 'cus_1', creditCard: {}, creditCardHolderInfo: {} }),
    (err) => err.code === 'missing_field',
  )
  assert.equal(client.calls.length, 0)
})

test('updateSubscription propaga a mudanca para as cobrancas ja geradas (upgrade no meio do ciclo)', async () => {
  const client = stubClient({ 'POST /v3/subscriptions/sub_9': { id: 'sub_9' } })
  const pay = createAsaasPayments(client)
  await pay.updateSubscription('sub_9', { value: 120, updatePendingPayments: true })
  const call = client.calls[0]
  assert.equal(call.path, '/v3/subscriptions/sub_9')
  assert.equal(call.body.value, 120)
  assert.equal(call.body.updatePendingPayments, true)
})

test('deleteSubscription remove de vez (cancelamento pelo cliente), diferente de INACTIVE', async () => {
  const client = stubClient({ 'DELETE /v3/subscriptions/sub_9': { deleted: true } })
  const pay = createAsaasPayments(client)
  await pay.deleteSubscription('sub_9')
  assert.equal(client.calls[0].method, 'DELETE')
  assert.equal(client.calls[0].path, '/v3/subscriptions/sub_9')
})

test('getSubscription consulta a assinatura', async () => {
  const client = stubClient({ 'GET /v3/subscriptions/sub_9': { id: 'sub_9', status: 'ACTIVE' } })
  const pay = createAsaasPayments(client)
  const sub = await pay.getSubscription('sub_9')
  assert.equal(sub.status, 'ACTIVE')
})
