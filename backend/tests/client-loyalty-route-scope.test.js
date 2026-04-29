import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  filterClientLoyaltyDetailsForAuthenticatedClient,
  resolveClientLoyaltyCardholderNamePayload,
} = await import('../src/routes/client_loyalty.js')

test('client loyalty route filter keeps same-establishment history isolated by authenticated client', () => {
  const filtered = filterClientLoyaltyDetailsForAuthenticatedClient([
    {
      subscription: {
        id: 11,
        cliente_id: 101,
        estabelecimento_id: 26,
      },
    },
    {
      subscription: {
        id: 12,
        cliente_id: 202,
        estabelecimento_id: 26,
      },
    },
    {
      subscription: {
        id: 13,
        cliente_id: 101,
        estabelecimento_id: 99,
      },
    },
  ], {
    clienteId: 101,
    estabelecimentoId: 26,
  })

  assert.deepEqual(filtered.map((entry) => entry.subscription.id), [11])
})

test('client loyalty route filter returns empty list when the authenticated client has no subscription', () => {
  const filtered = filterClientLoyaltyDetailsForAuthenticatedClient([
    {
      subscription: {
        id: 22,
        cliente_id: 202,
        estabelecimento_id: 26,
      },
    },
  ], {
    clienteId: 303,
    estabelecimentoId: 26,
  })

  assert.deepEqual(filtered, [])
})

test('client loyalty card route resolves the canonical cardholder payload key', () => {
  const resolved = resolveClientLoyaltyCardholderNamePayload({
    cardholder_name: '  Maria   Silva  ',
    payer_name: 'Nome Ignorado',
  })

  assert.equal(resolved.normalized, 'Maria Silva')
  assert.equal(resolved.sourceField, 'cardholder_name')
  assert.equal(resolved.analysis.wordCount, 2)
})

test('client loyalty card route accepts known cardholder aliases', () => {
  const resolved = resolveClientLoyaltyCardholderNamePayload({
    holder_name: "Ana-Maria D'Ávila",
  })

  assert.equal(resolved.normalized, "Ana-Maria D'Ávila")
  assert.equal(resolved.sourceField, 'holder_name')
  assert.equal(resolved.analysis.valid, true)
})
