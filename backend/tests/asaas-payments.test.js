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
