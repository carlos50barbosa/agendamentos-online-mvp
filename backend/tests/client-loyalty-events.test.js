import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  appendClientLoyaltySubscriptionEvent,
  resolveClientLoyaltyIgnoredReasonForStorage,
} = await import('../src/lib/client_loyalty_subscriptions.js')

test('client loyalty ignored_reason normalizes Mercado Pago CVV message to a short stable code', () => {
  const result = resolveClientLoyaltyIgnoredReasonForStorage(
    'Card token was generated without CVV validation'
  )

  assert.equal(result.normalizedReason, 'card_token_without_cvv_validation')
  assert.equal(result.strategy, 'known_gateway_error')
  assert.equal(result.normalizedReason.length <= 80, true)
})

test('client loyalty event insert keeps long ignored_reason out of the indexed column and in payload_json', async () => {
  const longGatewayMessage = `Card token was generated without CVV validation ${'x'.repeat(220)}`
  let insertValues = null
  const db = {
    async query(sql, values = []) {
      if (/SELECT id\s+FROM client_loyalty_subscription_events/i.test(sql)) {
        return [[]]
      }
      if (/INSERT INTO client_loyalty_subscription_events/i.test(sql)) {
        insertValues = values
        return [{ insertId: 123 }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  const result = await appendClientLoyaltySubscriptionEvent(22, {
    eventType: 'card_subscription_create_failed',
    gatewayEventId: 'loyalty:sub:22:est:26:cli:1:plan:1:uuid:test',
    mpTopic: 'subscription',
    actionTaken: 'create_failed',
    ignoredReason: longGatewayMessage,
    payload: {
      gateway_message: longGatewayMessage,
    },
  }, { db })

  assert.equal(result.id, 123)
  assert.equal(insertValues[15], 'card_token_without_cvv_validation')
  assert.equal(insertValues[15].length <= 80, true)

  const payload = JSON.parse(insertValues[16])
  assert.equal(payload.gateway_message, longGatewayMessage)
  assert.equal(payload.ignored_reason_normalization.normalized_reason, 'card_token_without_cvv_validation')
  assert.equal(payload.ignored_reason_normalization.original_reason, longGatewayMessage)
})

test('schema and migration allow ignored_reason headroom while code still stores short values', () => {
  const schema = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8')
  const migration = readFileSync(new URL('../sql/2026-04-30-expand-loyalty-ignored-reason.sql', import.meta.url), 'utf8')
  const ownerMigration = readFileSync(new URL('../sql/2026-05-01-allow-unresolved-mercadopago-webhook-owner.sql', import.meta.url), 'utf8')

  assert.match(schema, /ignored_reason VARCHAR\(191\) NULL/)
  assert.match(migration, /client_loyalty_subscription_events\s+[\s\S]*ignored_reason VARCHAR\(191\) NULL/)
  assert.match(migration, /mercadopago_webhook_events\s+[\s\S]*ignored_reason VARCHAR\(191\) NULL/)
  assert.match(schema, /mercadopago_webhook_events\s+[\s\S]*owner_type ENUM\('platform','establishment','unresolved'\) NOT NULL/)
  assert.match(ownerMigration, /owner_type ENUM\('platform','establishment','unresolved'\) NOT NULL/)
})
