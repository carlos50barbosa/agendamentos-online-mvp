import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  buildBillingWebhookOwnerResolutionPayload,
  normalizeBillingWebhookTopic,
  recordUnresolvedAuthorizedPaymentWebhookAudit,
  resolveAuthorizedPaymentWebhookOwnerContext,
  resolveBillingAuthorizedPaymentWebhookAction,
  resolveConnectedSellerPaymentFlowMatch,
  resolveBillingSubscriptionWebhookAction,
  resolveBillingWebhookBodyUserId,
  resolveBillingPaymentWebhookAction,
  resolveBillingWebhookSyncDecision,
  resolveSubscriptionWebhookOwnerContext,
} = await import('../src/routes/billing.js')
const {
  resolveClientLoyaltyPaymentMatch,
} = await import('../src/lib/client_loyalty_billing.js')

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
    implementationPaymentHandler: async () => ({ ok: false, handled: false, reason: 'not_implementation_payment' }),
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
    sellerPaymentFlowMatcher: async () => ({
      paymentFetched: true,
      matchedFlow: 'deposit',
      matchRule: 'metadata_type_deposit',
      depositMatch: true,
      depositReason: 'metadata_type_deposit',
      loyaltyMatch: false,
      loyaltyReason: 'not_loyalty_payment',
      payment: { id: '155488227017' },
      accessToken: 'seller-token',
      sellerAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    }),
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
    sellerPaymentFlowMatcher: async () => ({
      paymentFetched: true,
      accessToken: 'seller-token',
      sellerAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
      payment: { id: '155488227017', external_reference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test' },
      paymentStatus: 'approved',
      operationType: 'recurring_payment',
      externalReference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
      metadataPreapprovalId: 'preapp_456',
      poiType: 'SUBSCRIPTIONS',
      subscriptionId: 'preapp_456',
      depositMatch: false,
      depositReason: 'not_deposit',
      loyaltyMatch: true,
      loyaltyReason: null,
      matchedFlow: 'loyalty',
      matchRule: 'recurring_payment_subscription_linkage',
      loyaltyMatchContext: {
        matched: true,
        matchRule: 'recurring_payment_subscription_linkage',
      },
    }),
    depositHandler: async () => ({ ok: false, reason: 'not_deposit' }),
    loyaltyPaymentHandler: async (_paymentId, options) => {
      assert.equal(options.accessToken, 'seller-token')
      assert.equal(options.prefetchedPayment?.id, '155488227017')
      assert.equal(options.paymentMatch?.matchRule, 'recurring_payment_subscription_linkage')
      return { ok: true, handled: true, status: 'active', reason: null }
    },
  })

  assert.equal(result.kind, 'seller_loyalty')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.connectedAccount?.estabelecimento_id, 26)
  assert.equal(result.responseBody.loyalty, true)
  assert.equal(result.responseBody.processed, true)
})

test('billing payment webhook ignores connected seller card validation payments as auxiliary', async () => {
  let depositCalls = 0
  let loyaltyCalls = 0
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155488227017',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => ({ id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' }),
    sellerPaymentFlowMatcher: async () => ({
      paymentFetched: true,
      accessToken: 'seller-token',
      sellerAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
      payment: {
        id: '155488227017',
        status: 'approved',
        operation_type: 'card_validation',
        transaction_amount: 0,
      },
      paymentStatus: 'approved',
      operationType: 'card_validation',
      transactionAmount: 0,
      externalReference: null,
      metadataPreapprovalId: null,
      poiType: 'UNSPECIFIED',
      subscriptionId: null,
      cardValidationMatch: true,
      depositMatch: false,
      depositReason: 'card_validation_payment',
      loyaltyMatch: false,
      loyaltyReason: 'card_validation_payment',
      matchedFlow: 'card_validation',
      matchRule: 'operation_type_card_validation',
      loyaltyMatchContext: null,
    }),
    depositHandler: async () => {
      depositCalls += 1
      return { handled: true, status: 'approved' }
    },
    loyaltyPaymentHandler: async () => {
      loyaltyCalls += 1
      return { ok: true, handled: true, status: 'active' }
    },
  })

  assert.equal(result.kind, 'seller_card_validation_ignored')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'card_validation')
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'card_validation_payment')
  assert.equal(result.responseBody.matched_flow, 'card_validation')
  assert.equal(result.responseBody.action_taken, 'ignored_card_validation')
  assert.equal(result.responseBody.ignored_reason, 'card_validation_payment')
  assert.equal(result.depositResult, null)
  assert.equal(result.loyaltyResult, null)
  assert.equal(depositCalls, 0)
  assert.equal(loyaltyCalls, 0)
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
    sellerPaymentFlowMatcher: async () => ({
      paymentFetched: true,
      paymentStatus: 'rejected',
      operationType: 'regular_payment',
      externalReference: null,
      metadataPreapprovalId: null,
      poiType: null,
      subscriptionId: null,
      depositMatch: false,
      depositReason: 'not_deposit',
      loyaltyMatch: false,
      loyaltyReason: 'not_loyalty_payment',
      matchedFlow: null,
      matchRule: null,
      loyaltyMatchContext: {
        matched: false,
        reason: 'not_loyalty_payment',
        failureCodes: ['missing_external_reference', 'missing_preapproval_linkage'],
      },
    }),
  })

  assert.equal(result.kind, 'ignored_foreign_user_unmatched_flow')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.connectedAccount?.estabelecimento_id, 26)
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'unmatched_connected_seller_flow')
  assert.equal(result.depositResult?.reason, 'not_deposit')
  assert.equal(result.loyaltyResult?.reason, 'not_loyalty_payment')
})

test('billing payment webhook blocks conflicting seller flow matches', async () => {
  const result = await resolveBillingPaymentWebhookAction({
    resourceId: '155337500782',
    syncEvent: {},
    syncDecision: { topic: 'payment', chosenSyncTarget: 'payment', chosenByRule: 'body_topic' },
    bodyUserId: 1055436081,
    resolveConnectedAccount: async () => ({ id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' }),
    sellerPaymentFlowMatcher: async () => ({
      paymentFetched: true,
      depositMatch: true,
      depositReason: 'metadata_type_deposit',
      loyaltyMatch: true,
      loyaltyReason: null,
      matchedFlow: null,
      matchRule: 'conflicting_connected_seller_flow',
      conflict: true,
    }),
  })

  assert.equal(result.kind, 'conflicting_connected_seller_flow')
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'conflicting_connected_seller_flow')
})

test('connected seller payment flow match fetches payment.created and classifies loyalty safely', async () => {
  const result = await resolveConnectedSellerPaymentFlowMatch({
    resourceId: '155337500782',
    connectedAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    bodyUserId: 1055436081,
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    }),
    fetchPayment: async (_paymentId, options) => {
      assert.equal(options.accessToken, 'seller-token')
      return {
        id: '155337500782',
        status: 'rejected',
        operation_type: 'recurring_payment',
        external_reference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
        metadata: { preapproval_id: '87b2057170144ef3a7b8f13bfc5150e3' },
        point_of_interaction: {
          type: 'SUBSCRIPTIONS',
          transaction_data: { subscription_id: '87b2057170144ef3a7b8f13bfc5150e3' },
        },
      }
    },
    loyaltyPaymentMatcher: (payment, options) => resolveClientLoyaltyPaymentMatch(payment, {
      gatewayEventId: options?.gatewayEventId,
      getSubscriptionByGatewayId: async (value) => (
        String(value) === '87b2057170144ef3a7b8f13bfc5150e3'
          ? { id: 17, estabelecimentoId: 26, gatewaySubscriptionId: '87b2057170144ef3a7b8f13bfc5150e3' }
          : null
      ),
      getSubscriptionByExternalReference: async (value) => (
        String(value).startsWith('loyalty:sub:17:')
          ? { id: 17, estabelecimentoId: 26, externalReference: value }
          : null
      ),
    }),
  })

  assert.equal(result.paymentFetched, true)
  assert.equal(result.depositMatch, false)
  assert.equal(result.loyaltyMatch, true)
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.matchRule, 'recurring_payment_subscription_linkage')
  assert.equal(result.metadataPreapprovalId, '87b2057170144ef3a7b8f13bfc5150e3')
  assert.equal(result.externalReference, 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test')
  assert.equal(result.poiType, 'SUBSCRIPTIONS')
})

test('connected seller payment flow match classifies operation_type card_validation before loyalty matching', async () => {
  let loyaltyCalls = 0
  const result = await resolveConnectedSellerPaymentFlowMatch({
    resourceId: '155488227017',
    connectedAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    bodyUserId: 1055436081,
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    }),
    fetchPayment: async (_paymentId, options) => {
      assert.equal(options.accessToken, 'seller-token')
      return {
        id: '155488227017',
        status: 'approved',
        operation_type: 'card_validation',
        transaction_amount: 0,
        external_reference: null,
        metadata: {},
        point_of_interaction: { type: 'UNSPECIFIED', transaction_data: {} },
      }
    },
    loyaltyPaymentMatcher: async () => {
      loyaltyCalls += 1
      return { matched: false, reason: 'not_loyalty_payment' }
    },
  })

  assert.equal(result.paymentFetched, true)
  assert.equal(result.cardValidationMatch, true)
  assert.equal(result.depositMatch, false)
  assert.equal(result.loyaltyMatch, false)
  assert.equal(result.matchedFlow, 'card_validation')
  assert.equal(result.matchRule, 'operation_type_card_validation')
  assert.equal(result.paymentStatus, 'approved')
  assert.equal(result.operationType, 'card_validation')
  assert.equal(result.transactionAmount, 0)
  assert.equal(result.externalReference, null)
  assert.equal(result.metadataPreapprovalId, null)
  assert.equal(result.subscriptionId, null)
  assert.equal(loyaltyCalls, 0)
})

test('connected seller payment flow match classifies zero amount approved payment without linkage as card validation', async () => {
  const result = await resolveConnectedSellerPaymentFlowMatch({
    resourceId: '155488227018',
    connectedAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    bodyUserId: 1055436081,
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
    }),
    fetchPayment: async () => ({
      id: '155488227018',
      status: 'approved',
      operation_type: 'regular_payment',
      transaction_amount: '0.00',
      external_reference: '',
      metadata: {},
      point_of_interaction: { type: 'UNSPECIFIED', transaction_data: {} },
    }),
    loyaltyPaymentMatcher: async () => {
      throw new Error('loyalty matcher should not run for card validation payments')
    },
  })

  assert.equal(result.paymentFetched, true)
  assert.equal(result.cardValidationMatch, true)
  assert.equal(result.matchedFlow, 'card_validation')
  assert.equal(result.matchRule, 'approved_zero_amount_without_business_linkage')
  assert.equal(result.transactionAmount, 0)
  assert.equal(result.depositReason, 'card_validation_payment')
  assert.equal(result.loyaltyReason, 'card_validation_payment')
})

test('client loyalty payment matcher recognizes recurring seller payments by subscription linkage', async () => {
  const result = await resolveClientLoyaltyPaymentMatch({
    id: '155337500782',
    status: 'rejected',
    operation_type: 'recurring_payment',
    external_reference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
    metadata: { preapproval_id: '87b2057170144ef3a7b8f13bfc5150e3' },
    point_of_interaction: {
      type: 'SUBSCRIPTIONS',
      transaction_data: { subscription_id: '87b2057170144ef3a7b8f13bfc5150e3' },
    },
  }, {
    gatewayEventId: '155337500782',
    getSubscriptionByGatewayId: async (value) => (
      String(value) === '87b2057170144ef3a7b8f13bfc5150e3'
        ? { id: 17, estabelecimentoId: 26, gatewaySubscriptionId: '87b2057170144ef3a7b8f13bfc5150e3' }
        : null
    ),
    getSubscriptionByExternalReference: async () => null,
    getSubscriptionByGatewayPaymentId: async () => null,
    getSubscriptionByEventResourceId: async () => null,
    getSubscriptionByWebhookResourceId: async () => null,
  })

  assert.equal(result.matched, true)
  assert.equal(result.matchRule, 'recurring_payment_subscription_linkage')
  assert.equal(result.lookupBy, 'mp_preapproval_id')
  assert.equal(result.localSubscription?.estabelecimentoId, 26)
})

test('client loyalty payment matcher keeps unknown seller payments unmatched', async () => {
  const result = await resolveClientLoyaltyPaymentMatch({
    id: '155337500782',
    status: 'approved',
    operation_type: 'regular_payment',
    metadata: {},
    point_of_interaction: {
      type: 'CHECKOUT',
      transaction_data: {},
    },
  }, {
    gatewayEventId: '155337500782',
    getSubscriptionByGatewayId: async () => null,
    getSubscriptionByExternalReference: async () => null,
    getSubscriptionByGatewayPaymentId: async () => null,
    getSubscriptionByEventResourceId: async () => null,
    getSubscriptionByWebhookResourceId: async () => null,
  })

  assert.equal(result.matched, false)
  assert.equal(result.reason, 'not_loyalty_payment')
  assert.deepEqual(result.failureCodes, ['missing_external_reference', 'missing_preapproval_linkage'])
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
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByGatewayId: async () => null,
    getLoyaltySubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByEventResourceId: async () => null,
    getLoyaltySubscriptionByWebhookResourceId: async () => null,
    listLoyaltyAuthorizedPaymentProbeCandidates: async () => [],
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
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
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.lookupBy, 'metadata_preapproval_id')
  assert.equal(result.resolutionRule, 'loyalty_authorized_payment_linkage')
  assert.equal(result.estabelecimentoId, 26)
})

test('authorized payment owner resolution finds loyalty seller by event linkage when payload omits user and preapproval', async () => {
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027488798',
    event: { type: 'subscription_authorized_payment' },
    bodyUserId: null,
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByGatewayId: async () => null,
    getLoyaltySubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByEventResourceId: async (value, options) => {
      assert.equal(options?.mpTopic, 'automatic-payments')
      assert.equal(options?.paymentType, 'subscription_authorized_payment')
      return String(value) === '7027488798'
        ? { id: 88, estabelecimentoId: 26, mpPreapprovalId: 'preapp_456' }
        : null
    },
    getConnectedAccountByEstabelecimentoId: async (value) => (
      Number(value) === 26
        ? { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' }
        : null
    ),
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
    resolveEstablishmentAccessToken: async () => ({
      accessToken: 'seller-token',
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.lookupBy, 'event_linkage')
  assert.equal(result.resolutionRule, 'loyalty_authorized_payment_linkage')
  assert.equal(result.estabelecimentoId, 26)
})

test('authorized payment owner resolution probes known loyalty sellers and resolves by internal subscription linkage', async () => {
  const attemptedTokens = []
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027501745',
    event: { type: 'subscription_authorized_payment' },
    bodyUserId: null,
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByEventResourceId: async () => null,
    getLoyaltySubscriptionByWebhookResourceId: async () => null,
    listLoyaltyAuthorizedPaymentProbeCandidates: async () => ([
      { estabelecimentoId: 26 },
    ]),
    resolveEstablishmentAccessToken: async (value) => ({
      accessToken: Number(value) === 26 ? 'seller-token-26' : null,
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
    getAuthorizedPayment: async (value, options) => {
      attemptedTokens.push(options?.accessToken || null)
      assert.equal(String(value), '7027501745')
      return {
        authorizedPayment: {
          id: '7027501745',
          preapprovalId: '87b2057170144ef3a7b8f13bfc5150e3',
          externalReference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
        },
      }
    },
    getConnectedAccountByEstabelecimentoId: async (value) => (
      Number(value) === 26
        ? { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' }
        : null
    ),
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByGatewayId: async (value) => (
      String(value) === '87b2057170144ef3a7b8f13bfc5150e3'
        ? {
          id: 17,
          estabelecimentoId: 26,
          gatewaySubscriptionId: '87b2057170144ef3a7b8f13bfc5150e3',
          mpPreapprovalId: '87b2057170144ef3a7b8f13bfc5150e3',
          externalReference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
        }
        : null
    ),
  })

  assert.deepEqual(attemptedTokens, ['seller-token-26'])
  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.tokenSource, 'establishment')
  assert.equal(result.lookupBy, 'loyalty_subscription_linkage')
  assert.equal(result.resolutionRule, 'loyalty_authorized_payment_linkage')
  assert.equal(result.metadataPreapprovalId, '87b2057170144ef3a7b8f13bfc5150e3')
  assert.equal(result.externalReference, 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test')
  assert.equal(result.estabelecimentoId, 26)
})

test('authorized payment owner resolution prefers loyalty linkage even when webhook body user is the platform collector', async () => {
  const result = await resolveAuthorizedPaymentWebhookOwnerContext({
    resourceId: '7027501745',
    event: { type: 'subscription_authorized_payment' },
    bodyUserId: 281768531,
    getLoyaltySubscriptionByGatewayPaymentId: async () => null,
    getLoyaltySubscriptionByGatewayId: async (value) => (
      String(value) === '87b2057170144ef3a7b8f13bfc5150e3'
        ? {
          id: 17,
          estabelecimentoId: 26,
          gatewaySubscriptionId: '87b2057170144ef3a7b8f13bfc5150e3',
          mpPreapprovalId: '87b2057170144ef3a7b8f13bfc5150e3',
          externalReference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
        }
        : null
    ),
    getLoyaltySubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByEventResourceId: async () => null,
    getLoyaltySubscriptionByWebhookResourceId: async () => null,
    listLoyaltyAuthorizedPaymentProbeCandidates: async () => ([
      { estabelecimentoId: 26 },
    ]),
    resolveEstablishmentAccessToken: async (value) => ({
      accessToken: Number(value) === 26 ? 'seller-token-26' : null,
      account: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' },
    }),
    getAuthorizedPayment: async () => ({
      authorizedPayment: {
        id: '7027501745',
        preapprovalId: '87b2057170144ef3a7b8f13bfc5150e3',
        externalReference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
      },
    }),
    getConnectedAccountByEstabelecimentoId: async (value) => (
      Number(value) === 26
        ? { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081', mp_collector_id: '1055436081' }
        : null
    ),
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
    platformAccessToken: 'platform-token',
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'establishment')
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.tokenSource, 'establishment')
  assert.equal(result.lookupBy, 'loyalty_subscription_linkage')
  assert.equal(result.resolutionRule, 'loyalty_authorized_payment_linkage')
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
    getLoyaltySubscriptionByEventResourceId: async () => null,
    getLoyaltySubscriptionByWebhookResourceId: async () => null,
    listLoyaltyAuthorizedPaymentProbeCandidates: async () => [],
    getPlatformSubscriptionByGatewayPaymentId: async () => null,
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
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
  let loyaltyCalls = 0
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
    loyaltyAuthorizedPaymentHandler: async () => {
      loyaltyCalls += 1
      return { ok: true, handled: true, status: 'active' }
    },
    platformAuthorizedPaymentHandler: async () => {
      platformCalls += 1
      return { ok: true }
    },
  })

  assert.equal(result.kind, 'ignored_unresolved_authorized_payment_owner')
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'unresolved_authorized_payment_ignored')
  assert.equal(result.responseBody.resolution_reason, 'unresolved_owner_for_authorized_payment')
  assert.equal(loyaltyCalls, 0)
  assert.equal(platformCalls, 0)
})

test('unresolved authorized payment audit records required fields and logs ignored event', async () => {
  let insert = null
  const logs = []
  const ownerResolutionPayload = buildBillingWebhookOwnerResolutionPayload({
    requestId: 'req-7027485215',
    resourceId: '7027485215',
    syncDecision: {
      topic: 'subscription_authorized_payment',
      chosenSyncTarget: 'authorized_payment',
      chosenEndpoint: '/authorized_payments/{id}',
    },
    bodyType: 'subscription_authorized_payment',
    bodyAction: 'updated',
    bodyUserId: null,
    event: { type: 'subscription_authorized_payment', action: 'updated' },
    ownerResolution: {
      ok: false,
      ownerType: null,
      matchedFlow: null,
      tokenSource: null,
      resolutionRule: 'no_confident_owner',
      reason: 'unresolved_owner_for_authorized_payment',
      fallbackBlocked: true,
      failedLookups: [
        { lookupBy: 'authorized_payment_id', reason: 'subscription_not_found' },
        { lookupBy: 'event_linkage', reason: 'subscription_not_found' },
        { lookupBy: 'webhook_linkage', reason: 'subscription_not_found' },
        {
          lookupBy: 'loyalty_subscription_linkage',
          reason: 'authorized_payment_not_accessible_with_known_seller_tokens',
        },
      ],
    },
  })

  const result = await recordUnresolvedAuthorizedPaymentWebhookAudit({
    ownerResolutionPayload,
    db: {
      async query(sql, values = []) {
        insert = { sql, values }
        return [{ insertId: 321 }]
      },
    },
    logger: {
      info(message, payload) {
        logs.push({ message, payload })
      },
    },
  })

  assert.equal(result.eventName, 'unresolved_authorized_payment_ignored')
  assert.equal(result.persisted, true)
  assert.match(insert.sql, /INSERT INTO mercadopago_webhook_events/)
  assert.equal(insert.values[0], 'req-7027485215')
  assert.equal(insert.values[2], 'unresolved')
  assert.equal(insert.values[7], 'subscription_authorized_payment')
  assert.equal(insert.values[8], 'updated')
  assert.equal(insert.values[9], '7027485215')
  assert.equal(insert.values[12], 'unresolved_authorized_payment_ignored')
  assert.equal(insert.values[13], 'unresolved_authorized_payment_ignored')

  const rawPayload = JSON.parse(insert.values[14])
  assert.equal(rawPayload.resource_id, '7027485215')
  assert.equal(rawPayload.topic, 'subscription_authorized_payment')
  assert.equal(rawPayload.body_action, 'updated')
  assert.equal(rawPayload.resolution_reason, 'unresolved_owner_for_authorized_payment')
  assert.equal(rawPayload.platform_user_id, 281768531)
  assert.equal(rawPayload.body_user_id, null)
  assert.equal(rawPayload.body_user_estabelecimento_id, null)
  assert.equal(rawPayload.request_id, 'req-7027485215')
  assert.deepEqual(rawPayload.failed_lookups, [
    { lookupBy: 'authorized_payment_id', reason: 'subscription_not_found' },
    { lookupBy: 'event_linkage', reason: 'subscription_not_found' },
    { lookupBy: 'webhook_linkage', reason: 'subscription_not_found' },
    {
      lookupBy: 'loyalty_subscription_linkage',
      reason: 'authorized_payment_not_accessible_with_known_seller_tokens',
    },
  ])

  assert.equal(logs.length, 1)
  assert.equal(logs[0].message, '[billing:webhook] unresolved_authorized_payment_ignored')
  assert.equal(logs[0].payload.audit_persisted, true)
  assert.equal(logs[0].payload.resource_id, '7027485215')
})

test('unresolved authorized payment audit logs cleanly when storage is unavailable', async () => {
  const logs = []
  const result = await recordUnresolvedAuthorizedPaymentWebhookAudit({
    ownerResolutionPayload: {
      request_id: 'req-no-table',
      resource_id: '7027485215',
      topic: 'subscription_authorized_payment',
      body_action: 'updated',
      failed_lookups: [{ lookupBy: 'authorized_payment_id', reason: 'subscription_not_found' }],
      resolution_reason: 'unresolved_owner_for_authorized_payment',
      platform_user_id: 281768531,
      body_user_id: null,
      body_user_estabelecimento_id: null,
    },
    db: {
      async query() {
        const error = new Error('Table does not exist')
        error.code = 'ER_NO_SUCH_TABLE'
        error.errno = 1146
        throw error
      },
    },
    logger: {
      info(message, payload) {
        logs.push({ message, payload })
      },
    },
  })

  assert.equal(result.persisted, false)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].message, '[billing:webhook] unresolved_authorized_payment_ignored')
  assert.equal(logs[0].payload.audit_persisted, false)
  assert.equal(logs[0].payload.audit_storage_error.code, 'ER_NO_SUCH_TABLE')
})

test('preapproval owner resolution finds loyalty seller by internal preapproval linkage', async () => {
  const result = await resolveSubscriptionWebhookOwnerContext({
    resourceId: 'preapp_456',
    event: { type: 'subscription_preapproval' },
    bodyUserId: null,
    getLoyaltySubscriptionByGatewayId: async (value) => (
      String(value) === 'preapp_456'
        ? { id: 88, estabelecimentoId: 26, gatewaySubscriptionId: 'preapp_456' }
        : null
    ),
    getPlatformSubscriptionByGatewayId: async () => null,
    getPlatformSubscriptionByExternalReference: async () => null,
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
  assert.equal(result.matchedFlow, 'loyalty')
  assert.equal(result.tokenSource, 'establishment')
  assert.equal(result.lookupBy, 'mp_preapproval_id')
  assert.equal(result.resolutionRule, 'loyalty_preapproval_linkage')
  assert.equal(result.estabelecimentoId, 26)
})

test('preapproval owner resolution keeps platform SaaS explicit when subscription belongs to the platform', async () => {
  const result = await resolveSubscriptionWebhookOwnerContext({
    resourceId: 'preapp_platform_123',
    event: { type: 'subscription_preapproval' },
    bodyUserId: 281768531,
    getLoyaltySubscriptionByGatewayId: async () => null,
    getLoyaltySubscriptionByExternalReference: async () => null,
    getLoyaltySubscriptionByEventResourceId: async () => null,
    getLoyaltySubscriptionByWebhookResourceId: async () => null,
    getPlatformSubscriptionByGatewayId: async (value) => (
      String(value) === 'preapp_platform_123'
        ? { id: 44, gatewaySubscriptionId: 'preapp_platform_123' }
        : null
    ),
    platformAccessToken: 'platform-token',
  })

  assert.equal(result.ok, true)
  assert.equal(result.ownerType, 'platform')
  assert.equal(result.matchedFlow, 'platform_saas')
  assert.equal(result.tokenSource, 'platform')
  assert.equal(result.lookupBy, 'mp_preapproval_id')
  assert.equal(result.resolutionRule, 'platform_subscription_linkage')
  assert.equal(result.accessToken, 'platform-token')
})

test('preapproval webhook uses establishment token and skips platform fallback for loyalty flow', async () => {
  let platformCalls = 0
  const result = await resolveBillingSubscriptionWebhookAction({
    resourceId: 'preapp_456',
    syncEvent: { type: 'subscription_preapproval' },
    syncDecision: { topic: 'subscription_preapproval', chosenSyncTarget: 'subscription', chosenEndpoint: '/preapproval/{id}' },
    bodyUserId: null,
    ownerResolver: async () => ({
      ok: true,
      ownerType: 'establishment',
      matchedFlow: 'loyalty',
      tokenSource: 'establishment',
      lookupBy: 'mp_preapproval_id',
      resolutionRule: 'loyalty_preapproval_linkage',
      estabelecimentoId: 26,
      mpUserId: '1055436081',
      mpCollectorId: '1055436081',
      sellerAccount: { id: 9, estabelecimento_id: 26, mp_user_id: '1055436081' },
      accessToken: 'seller-token',
    }),
    loyaltySubscriptionHandler: async (_resourceId, options) => {
      assert.equal(options.accessToken, 'seller-token')
      assert.equal(options.sellerAccount?.estabelecimento_id, 26)
      return { ok: true, handled: true, status: 'active' }
    },
    platformSubscriptionHandler: async () => {
      platformCalls += 1
      return { ok: true }
    },
  })

  assert.equal(result.kind, 'seller_subscription')
  assert.equal(result.ownerResolution?.ownerType, 'establishment')
  assert.equal(result.responseBody.processed, true)
  assert.equal(platformCalls, 0)
})

test('preapproval webhook blocks silent fallback to platform when owner is unresolved', async () => {
  let platformCalls = 0
  const result = await resolveBillingSubscriptionWebhookAction({
    resourceId: 'preapp_456',
    syncEvent: { type: 'subscription_preapproval' },
    syncDecision: { topic: 'subscription_preapproval', chosenSyncTarget: 'subscription', chosenEndpoint: '/preapproval/{id}' },
    bodyUserId: null,
    ownerResolver: async () => ({
      ok: false,
      ownerType: null,
      matchedFlow: null,
      tokenSource: null,
      lookupBy: null,
      resolutionRule: 'no_confident_owner',
      reason: 'unresolved_owner_for_preapproval',
      fallbackBlocked: true,
      accessToken: null,
    }),
    loyaltySubscriptionHandler: async () => ({ ok: true, handled: true, status: 'active' }),
    platformSubscriptionHandler: async () => {
      platformCalls += 1
      return { ok: true }
    },
  })

  assert.equal(result.kind, 'ignored_unresolved_subscription_owner')
  assert.equal(result.responseBody.ignored, true)
  assert.equal(result.responseBody.reason, 'unresolved_subscription_owner')
  assert.equal(platformCalls, 0)
})
