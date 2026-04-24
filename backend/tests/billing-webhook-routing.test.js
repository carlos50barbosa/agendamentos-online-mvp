import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  normalizeBillingWebhookTopic,
  resolveAuthorizedPaymentWebhookOwnerContext,
  resolveBillingAuthorizedPaymentWebhookAction,
  resolveBillingWebhookBodyUserId,
  resolveBillingPaymentWebhookAction,
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

test('billing webhook resolves body user id from query when Mercado Pago omits it from body', () => {
  const bodyUserId = resolveBillingWebhookBodyUserId(
    { query: { user_id: '1055436081' } },
    { type: 'subscription_authorized_payment', action: 'updated' }
  )

  const decision = resolveBillingWebhookSyncDecision({
    req: {
      query: { type: 'subscription_authorized_payment', user_id: '1055436081' },
      headers: {},
    },
    event: {
      type: 'subscription_authorized_payment',
      action: 'updated',
    },
    bodyUserId,
    bodyType: 'subscription_authorized_payment',
    bodyAction: 'updated',
  })

  assert.equal(bodyUserId, 1055436081)
  assert.equal(decision.ownerType, 'establishment')
  assert.equal(decision.matchedFlow, 'loyalty')
  assert.equal(decision.chosenSyncTarget, 'authorized_payment')
})

test('billing payment webhook keeps platform payments on the platform flow', async () => {
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 281768531,
    depositHandler: async () => ({ ok: false, reason: 'not_deposit' }),
    recoveryHandler: async () => ({ ok: false, reason: 'not_subscription_recovery' }),
    platformPaymentHandler: async () => ({ ok: true, reason: null, already_processed: false, stale: false }),
  })

  assert.equal(result.kind, 'platform_payment')
  assert.equal(result.ownerType, 'platform')
  assert.equal(result.matchedFlow, 'platform_saas')
  assert.equal(result.responseBody.processed, true)
})

test('billing payment webhook accepts connected seller deposits', async () => {
  let loyaltyCalls = 0
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => ({ id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' }),
    depositHandler: async () => ({ handled: true, status: 'approved' }),
    loyaltyPaymentHandler: async () => {
      loyaltyCalls += 1
      return { ok: true, handled: true, status: 'active' }
    },
  })

  assert.equal(result.kind, 'seller_deposit')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'deposit')
  assert.equal(result.connectedAccount?.estabelecimento_id, 26)
  assert.equal(result.responseBody.deposit, true)
  assert.equal(result.responseBody.processed, true)
  assert.equal(loyaltyCalls, 0)
})

test('billing payment webhook accepts connected seller loyalty payments after deposit miss', async () => {
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => ({ id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' }),
    depositHandler: async () => ({ ok: false, reason: 'not_deposit' }),
    loyaltyPaymentHandler: async () => ({ ok: true, handled: true, status: 'active', reason: null }),
  })

  assert.equal(result.kind, 'seller_loyalty')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.connectedAccount?.estabelecimento_id, 26)
  assert.equal(result.responseBody.loyalty, true)
  assert.equal(result.responseBody.processed, true)
})

test('billing payment webhook ignores unknown foreign users', async () => {
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => null,
  })

  assert.equal(result.kind, 'ignored_foreign_user_unknown_account')
  assert.equal(result.connectedAccount, null)
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'foreign_user_unknown_account')
})

test('billing payment webhook keeps known seller users blocked when no internal flow matches', async () => {
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => ({ id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' }),
    depositHandler: async () => ({ ok: false, reason: 'not_deposit' }),
    loyaltyPaymentHandler: async () => ({ ok: false, reason: 'subscription_not_found' }),
  })

  assert.equal(result.kind, 'ignored_foreign_user_unmatched_flow')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.connectedAccount?.estabelecimento_id, 26)
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'unmatched_connected_seller_flow')
  assert.equal(result.depositResult?.reason, 'not_deposit')
  assert.equal(result.loyaltyResult?.reason, 'subscription_not_found')
})

test('authorized payment owner resolution prefers connected seller users with valid token', async () => {
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027488798',
    event: { type: 'subscription_authorized_payment' },
    bodyUserId: 1055436081,
    getConnectedAccountBySellerIdentifier: async (value) => (
      String(value) === '1055436081'
        ? { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' }
        : null
    ),
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.tokenSource, 'establishment')
  assert.equal(result.resolutionRule, 'connected_seller_user')
  assert.equal(result.estabelecimentoId, 26)
  assert.equal(result.accessToken, 'seller-token')
})

test('authorized payment owner resolution finds loyalty seller by preapproval link when body user is missing', async () => {
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027488798',
    event: { metadata: { preapproval_id: 'preapp_456' } },
    bodyUserId: null,
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByGatewayId: async (value) => (
      String(value) === 'preapp_456'
        ? { id: 88, estabelecimentoId: 26, gatewaySubscriptionId: 'preapp_456' }
        : null
    ),
    getConnectedAccountByEstabelecimentoId: async (value) => (
      Number(value) === 26
        ? { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' }
        : null
    ),
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.resolutionRule, 'loyalty_preapproval_id')
  assert.equal(result.estabelecimentoId, 26)
})

test('authorized payment owner resolution keeps platform flow explicit', async () => {
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027488798',
    event: { type: 'subscription_authorized_payment' },
    bodyUserId: 281768531,
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByGatewayId: async () => null,
    getLoyaltySubscriptionByExternalReference: async () => null,
    platformAccessToken: 'platform-token',
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'platform')
  assert.equal(result.matchedFlow, 'platform_saas')
  assert.equal(result.tokenSource, 'platform')
  assert.equal(result.resolutionRule, 'platform_user_id')
  assert.equal(result.accessToken, 'platform-token')
})

test('authorized payment webhook uses establishment token and skips platform fallback for seller flow', async () => {
  let platformCalls = 0
  const result = await resolveBillingAuthorizedPaymentWebhookAction({
    resourceId: '7027488798',
    syncEvent: { type: 'subscription_authorized_payment' },
    syncDecision: { topic: 'subscription_authorized_payment', chosenSyncTarget: 'authorized_payment', chosenEndpoint: '/authorized_payments/{id}' },
    bodyUserId: 1055436081,
    ownerResolver: async () => ({
      ok: true,
      ownerType: 'establishment',
      matchedFlow: 'loyalty',
      tokenSource: 'establishment',
      resolutionRule: 'connected_seller_user',
      bodyUserId: 1055436081,
      estabelecimentoId: 26,
      mpUserId: '1055436081',
      mpCollectorId: '1055436081',
      sellerAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
      accessToken: 'seller-token',
    }),
    loyaltyAuthorizedPaymentHandler: async (_resourceId, options) => {
      assert.equal(options.bodyUserId, 1055436081)
      assert.equal(options.accessToken, 'seller-token')
      assert.equal(options.sellerAccount?.estabelecimento_id, 26)
      return { ok: true, handled: true, status: 'active' }
    },
    platformAuthorizedPaymentHandler: async () => {
      platformCalls += 1
      return { ok: true }
    },
  })

  assert.equal(result.kind, 'seller_authorized_payment')
  assert.equal(result.ownerResolution?.ownerType, 'establishment')
  assert.equal(result.responseBody.processed, true)
  assert.equal(platformCalls, 0)
})

test('authorized payment webhook blocks silent fallback to platform when owner is unresolved', async () => {
  let platformCalls = 0
  const result = await resolveBillingAuthorizedPaymentWebhookAction({
    resourceId: '7027488798',
    syncEvent: { type: 'subscription_authorized_payment' },
    syncDecision: { topic: 'subscription_authorized_payment', chosenSyncTarget: 'authorized_payment', chosenEndpoint: '/authorized_payments/{id}' },
    bodyUserId: null,
    ownerResolver: async () => ({
      ok: false,
      ownerType: null,
      matchedFlow: null,
      tokenSource: null,
      resolutionRule: 'no_confident_owner',
      reason: 'unresolved_owner_for_authorized_payment',
      fallbackBlocked: true,
      accessToken: null,
    }),
    loyaltyAuthorizedPaymentHandler: async () => ({ ok: true, handled: true, status: 'active' }),
    platformAuthorizedPaymentHandler: async () => {
      platformCalls += 1
      return { ok: true }
    },
  })

  assert.equal(result.kind, 'ignored_unresolved_authorized_payment_owner')
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'unresolved_authorized_payment_owner')
  assert.equal(platformCalls, 0)
})
