import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const __dirname = dirname(fileURLToPath(import.meta.url))

const {
  appendClientLoyaltySubscriptionEvent,
  computeClientLoyaltySubscriptionState,
  normalizeClientLoyaltyGatewayEventId,
  normalizeClientLoyaltyOwnerType,
  serializeClientLoyaltySubscription,
} = await import('../src/lib/client_loyalty_subscriptions.js')
const { summarizeMpAccount } = await import('../src/services/mpAccounts.js')
const {
  buildMercadoPagoSellerWebhookDeliveryKey,
  normalizeMercadoPagoSellerWebhookTopic,
} = await import('../src/services/loyaltySubscriptions.js')

test('normalizeClientLoyaltyOwnerType keeps establishment ownership by default', () => {
  assert.equal(normalizeClientLoyaltyOwnerType(null), 'establishment')
  assert.equal(normalizeClientLoyaltyOwnerType('invalid'), 'establishment')
})

test('normalizeClientLoyaltyOwnerType accepts platform ownership explicitly', () => {
  assert.equal(normalizeClientLoyaltyOwnerType('platform'), 'platform')
})

test('serializeClientLoyaltySubscription exposes seller ownership and MP fields', () => {
  const serialized = serializeClientLoyaltySubscription({
    id: 88,
    clienteId: 5,
    estabelecimentoId: 27,
    loyaltyPlanId: 14,
    ownerType: 'establishment',
    sellerMpAccountId: 9,
    status: 'active',
    paymentMethod: 'credit_card',
    gateway: 'mercadopago',
    gatewayCustomerId: 'payer_123',
    mpPayerId: 'payer_123',
    gatewaySubscriptionId: 'preapp_456',
    mpPreapprovalId: 'preapp_456',
    gatewayPaymentId: 'pay_789',
    externalReference: 'loyalty:sub:88:est:27:cli:5:plan:14:uuid:test',
    startedAt: new Date('2026-04-24T12:00:00.000Z'),
    currentPeriodStart: new Date('2026-04-24T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-05-24T12:00:00.000Z'),
    nextBillingAt: new Date('2026-05-24T12:00:00.000Z'),
    lastPaymentAt: new Date('2026-04-24T12:05:00.000Z'),
    graceUntil: null,
    cancelAt: null,
    canceledAt: null,
    autoRenew: true,
    createdAt: new Date('2026-04-24T11:59:00.000Z'),
    updatedAt: new Date('2026-04-24T12:05:00.000Z'),
  })

  assert.equal(serialized.owner_type, 'establishment')
  assert.equal(serialized.seller_mp_account_id, 9)
  assert.equal(serialized.mp_payer_id, 'payer_123')
  assert.equal(serialized.mp_preapproval_id, 'preapp_456')
  assert.equal(serialized.started_at, '2026-04-24T12:00:00.000Z')
})

test('client loyalty pending card payment does not serialize as expired only because period ended', () => {
  const state = computeClientLoyaltySubscriptionState({
    status: 'pending_payment',
    paymentMethod: 'credit_card',
    currentPeriodStart: new Date('2026-03-24T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-04-24T12:00:00.000Z'),
    autoRenew: true,
  }, {
    referenceDate: new Date('2026-04-25T12:00:00.000Z'),
  })

  assert.equal(state.resolvedStatus, 'pending_payment')
  assert.equal(state.benefitsActive, false)
})

test('client loyalty pending PIX still expires when its period is over', () => {
  const state = computeClientLoyaltySubscriptionState({
    status: 'pending_pix',
    paymentMethod: 'pix',
    currentPeriodStart: new Date('2026-03-24T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-04-24T12:00:00.000Z'),
    autoRenew: true,
  }, {
    referenceDate: new Date('2026-04-25T12:00:00.000Z'),
  })

  assert.equal(state.resolvedStatus, 'expired')
})

test('summarizeMpAccount returns disconnected defaults when there is no seller account', () => {
  const summary = summarizeMpAccount(null)

  assert.equal(summary.connected, false)
  assert.equal(summary.status, 'disconnected')
  assert.equal(summary.owner_type, 'establishment')
})

test('summarizeMpAccount preserves seller identifiers and public key', () => {
  const summary = summarizeMpAccount({
    id: 3,
    estabelecimentoId: 27,
    connected: true,
    status: 'connected',
    mpUserId: '123456',
    mpCollectorId: '123456',
    publicKey: 'APP_USR-123',
    tokenLast4: 'abcd',
    tokenExpiresAt: new Date('2026-04-30T12:00:00.000Z'),
    createdAt: new Date('2026-04-24T10:00:00.000Z'),
    updatedAt: new Date('2026-04-24T10:05:00.000Z'),
    source: 'establishment_mp_accounts',
  })

  assert.equal(summary.connected, true)
  assert.equal(summary.mp_user_id, '123456')
  assert.equal(summary.mp_collector_id, '123456')
  assert.equal(summary.public_key, 'APP_USR-123')
  assert.equal(summary.source, 'establishment_mp_accounts')
})

test('normalizeMercadoPagoSellerWebhookTopic maps preapproval aliases to subscription', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription_preapproval'), 'subscription')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription'), 'subscription')
})

test('normalizeMercadoPagoSellerWebhookTopic maps recurring charge aliases to automatic-payments', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription_authorized_payment'), 'automatic-payments')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('automatic-payments'), 'automatic-payments')
})

test('normalizeMercadoPagoSellerWebhookTopic maps mp-connect aliases consistently', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('mp-connect'), 'mp-connect')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('mp_connect'), 'mp-connect')
})

test('buildMercadoPagoSellerWebhookDeliveryKey keeps owner and resource traceability', () => {
  const key = buildMercadoPagoSellerWebhookDeliveryKey({
    topic: 'payment',
    actionName: 'payment.updated',
    resourceId: 'pay_999',
    bodyUserId: 281768531,
    estabelecimentoId: 27,
  })

  assert.equal(key, 'seller:payment:payment.updated:pay_999:281768531:27')
})

test('client loyalty gateway event id normalization shortens long transition ids deterministically', () => {
  const original = 'payment_status_transition:authorized_payment:156205780317:in_process:pending_review_manual:pending_payment:pending_payment:authorized_payment_pending_review'
  const context = {
    eventType: 'payment_status_transition',
    mpTopic: 'automatic-payments',
    mpPaymentId: '156205780317',
    paymentType: 'subscription_authorized_payment',
    payload: {
      previous_subscription_status: 'pending_payment',
      next_subscription_status: 'pending_payment',
      transition_rule: 'authorized_payment_pending_review',
      snapshot: {
        payment_id: '156205780317',
        payment_target: 'authorized_payment',
        status: 'in_process',
        status_detail: 'pending_review_manual',
      },
    },
  }

  const first = normalizeClientLoyaltyGatewayEventId(original, context)
  const second = normalizeClientLoyaltyGatewayEventId(original, context)

  assert.equal(first.normalizedId, second.normalizedId)
  assert.equal(first.normalizedId.startsWith('pst:ap:156205780317:'), true)
  assert.equal(first.normalizedId.length <= 120, true)
  assert.equal(first.changed, true)
})

test('appendClientLoyaltySubscriptionEvent stores a short id and preserves full payload details', async () => {
  const queries = []
  const fakeDb = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (/SELECT id\s+FROM client_loyalty_subscription_events/.test(sql)) return [[]]
      if (/INSERT INTO client_loyalty_subscription_events/.test(sql)) return [{ insertId: 44 }]
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const original = 'payment_status_transition:authorized_payment:156205780317:in_process:pending_review_manual:pending_payment:pending_payment:authorized_payment_pending_review'

  const result = await appendClientLoyaltySubscriptionEvent(12, {
    eventType: 'payment_status_transition',
    gatewayEventId: original,
    mpTopic: 'automatic-payments',
    mpPaymentId: '156205780317',
    paymentType: 'subscription_authorized_payment',
    payload: {
      previous_subscription_status: 'pending_payment',
      next_subscription_status: 'pending_payment',
      transition_rule: 'authorized_payment_pending_review',
      snapshot: {
        payment_id: '156205780317',
        payment_target: 'authorized_payment',
        status: 'in_process',
        status_detail: 'pending_review_manual',
      },
      raw: {
        payment: {
          id: '156205780317',
          status: 'in_process',
        },
      },
    },
  }, { db: fakeDb })

  const insert = queries.find((entry) => /INSERT INTO client_loyalty_subscription_events/.test(entry.sql))
  const payloadJson = JSON.parse(insert.values[16])

  assert.equal(result.id, 44)
  assert.equal(insert.values[2].startsWith('pst:ap:156205780317:'), true)
  assert.equal(insert.values[2].length <= 120, true)
  assert.equal(payloadJson.transition_rule, 'authorized_payment_pending_review')
  assert.equal(payloadJson.snapshot.status_detail, 'pending_review_manual')
  assert.equal(payloadJson.event_id_normalization.original_gateway_event_id, original)
  assert.equal(payloadJson.event_id_normalization.normalized_gateway_event_id, insert.values[2])
})

test('appendClientLoyaltySubscriptionEvent deduplicates using the normalized event id', async () => {
  const queries = []
  const fakeDb = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (/SELECT id\s+FROM client_loyalty_subscription_events/.test(sql)) return [[{ id: 77 }]]
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const original = 'payment_status_transition:authorized_payment:156205780317:in_process:pending_review_manual:pending_payment:pending_payment:authorized_payment_pending_review'

  const result = await appendClientLoyaltySubscriptionEvent(12, {
    eventType: 'payment_status_transition',
    gatewayEventId: original,
    mpTopic: 'automatic-payments',
    mpPaymentId: '156205780317',
    paymentType: 'subscription_authorized_payment',
    payload: {
      transition_rule: 'authorized_payment_pending_review',
      snapshot: {
        payment_id: '156205780317',
        payment_target: 'authorized_payment',
      },
    },
  }, { db: fakeDb })

  assert.equal(result.duplicated, true)
  assert.equal(result.id, 77)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].values[2].startsWith('pst:ap:156205780317:'), true)
})

test('client loyalty event schema migration allows indexed normalized ids with compatibility headroom', () => {
  const migration = readFileSync(resolve(__dirname, '../sql/2026-04-29-normalize-client-loyalty-event-ids.sql'), 'utf8')
  const schema = readFileSync(resolve(__dirname, '../sql/schema.sql'), 'utf8')

  assert.match(migration, /gateway_event_id\s+VARCHAR\(191\)\s+NULL/i)
  assert.match(migration, /idx_client_loyalty_events_dedupe/i)
  assert.match(schema, /gateway_event_id\s+VARCHAR\(191\)\s+NULL/i)
  assert.match(schema, /idx_client_loyalty_events_dedupe\s+\(client_loyalty_subscription_id,\s*tipo_evento,\s*gateway_event_id\)/i)
})
