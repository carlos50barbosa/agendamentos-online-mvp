import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  normalizeBillingWebhookTopic,
  resolveBillingWebhookSyncDecision,
} = await import('../src/routes/billing.js')

test('normalizeBillingWebhookTopic canonicalizes subscription aliases', () => {
  assert.equal(normalizeBillingWebhookTopic('payment'), 'payment')
  assert.equal(normalizeBillingWebhookTopic('automatic-payments'), 'subscription_authorized_payment')
  assert.equal(normalizeBillingWebhookTopic('subscription_authorized_payment'), 'subscription_authorized_payment')
  assert.equal(normalizeBillingWebhookTopic('subscription'), 'subscription_preapproval')
})

test('billing webhook routes conflicting body payment to payment sync', () => {
  const decision = resolveBillingWebhookSyncDecision({
    req: {
      query: { type: 'subscription_authorized_payment' },
      headers: {},
    },
    event: {
      type: 'payment',
      action: 'payment.created',
      user_id: 281768531,
    },
    bodyUserId: 281768531,
    bodyType: 'payment',
    bodyAction: 'payment.created',
  })

  assert.equal(decision.topic, 'payment')
  assert.equal(decision.queryTopic, 'subscription_authorized_payment')
  assert.equal(decision.bodyTopic, 'payment')
  assert.equal(decision.chosenSyncTarget, 'payment')
  assert.match(decision.chosenByRule, /^body_topic_overrides_query_topic:/)
  assert.equal(decision.chosenEndpoint, '/v1/payments/{id}')
  assert.equal(decision.ownerType, 'platform')
  assert.equal(decision.matchedFlow, 'platform_saas')
  assert.equal(decision.topicsConflict, true)
})

test('billing webhook keeps authorized payment sync when only query topic is present', () => {
  const decision = resolveBillingWebhookSyncDecision({
    req: {
      query: { type: 'subscription_authorized_payment' },
      headers: {},
    },
    event: {},
    bodyUserId: null,
    bodyType: null,
    bodyAction: null,
  })

  assert.equal(decision.topic, 'subscription_authorized_payment')
  assert.equal(decision.chosenSyncTarget, 'authorized_payment')
  assert.equal(decision.chosenByRule, 'query_topic_fallback')
  assert.equal(decision.chosenEndpoint, '/authorized_payments/{id}')
})
