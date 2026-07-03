import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createAsaasClient, resolveBaseUrl, AsaasError } = await import('../src/services/asaas/client.js')

function mockFetch(responses) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    const next = typeof responses === 'function' ? responses(url, options) : responses.shift()
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => (next.body === undefined ? '' : typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    }
  }
  impl.calls = calls
  return impl
}

test('resolveBaseUrl escolhe sandbox/produção', () => {
  assert.equal(resolveBaseUrl('sandbox'), 'https://api-sandbox.asaas.com')
  assert.equal(resolveBaseUrl('production'), 'https://api.asaas.com')
  assert.equal(resolveBaseUrl('prod'), 'https://api.asaas.com')
  assert.equal(resolveBaseUrl(undefined), 'https://api-sandbox.asaas.com')
})

test('injeta access_token, monta URL e serializa o body', async () => {
  const fetchImpl = mockFetch([{ status: 200, body: { id: 'cus_1' } }])
  const client = createAsaasClient({ apiKey: 'key-123', env: 'sandbox', fetchImpl })

  const res = await client.post('/v3/customers', { body: { name: 'Fulano' } })

  assert.deepEqual(res, { id: 'cus_1' })
  assert.equal(fetchImpl.calls.length, 1)
  const call = fetchImpl.calls[0]
  assert.equal(call.url, 'https://api-sandbox.asaas.com/v3/customers')
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.headers.access_token, 'key-123')
  assert.equal(call.options.body, JSON.stringify({ name: 'Fulano' }))
})

test('anexa query string quando fornecida', async () => {
  const fetchImpl = mockFetch([{ status: 200, body: { data: [] } }])
  const client = createAsaasClient({ apiKey: 'k', fetchImpl })
  await client.get('/v3/payments', { query: { limit: 10, offset: 0, empty: '' } })
  assert.equal(fetchImpl.calls[0].url, 'https://api-sandbox.asaas.com/v3/payments?limit=10&offset=0')
})

test('erro HTTP vira AsaasError com status/code/body', async () => {
  const fetchImpl = mockFetch([
    { status: 400, body: { errors: [{ code: 'invalid_cpfCnpj', description: 'CPF inválido' }] } },
  ])
  const client = createAsaasClient({ apiKey: 'k', fetchImpl })

  await assert.rejects(
    () => client.post('/v3/customers', { body: {} }),
    (err) => {
      assert.ok(err instanceof AsaasError)
      assert.equal(err.status, 400)
      assert.equal(err.code, 'invalid_cpfCnpj')
      assert.equal(err.message, 'CPF inválido')
      return true
    },
  )
})

test('sem apiKey lança config_missing antes de chamar a rede', async () => {
  const fetchImpl = mockFetch([])
  const client = createAsaasClient({ apiKey: '', fetchImpl })
  await assert.rejects(() => client.get('/v3/customers'), (err) => {
    assert.equal(err.code, 'config_missing')
    return true
  })
  assert.equal(fetchImpl.calls.length, 0)
})

test('falha de rede vira AsaasError network_error', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNRESET')
  }
  const client = createAsaasClient({ apiKey: 'k', fetchImpl })
  await assert.rejects(() => client.get('/v3/customers'), (err) => {
    assert.equal(err.code, 'network_error')
    return true
  })
})
