import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  filterClientLoyaltyDetailsForAuthenticatedClient,
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
