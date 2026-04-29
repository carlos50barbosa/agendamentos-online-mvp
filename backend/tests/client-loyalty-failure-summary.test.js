import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  buildClientLoyaltyPaymentSnapshot,
  interpretClientLoyaltyAuthorizedPaymentStatus,
  resolveClientLoyaltyRecentCardAttemptSummary,
  resolveClientLoyaltyRetryOptions,
  resolveLatestClientLoyaltyFailureSummary,
  resolveLatestClientLoyaltyPaymentSnapshot,
  validateClientLoyaltyCardPayerData,
} = await import('../src/lib/client_loyalty_billing.js')

test('client loyalty failure summary prefers payment status_detail over newer authorized payment without detail', () => {
  const summary = resolveLatestClientLoyaltyFailureSummary([
    {
      id: 11,
      tipo_evento: 'payment_failed',
      mp_topic: 'automatic-payments',
      payment_type: 'subscription_authorized_payment',
      gateway_event_id: 'auth_7027501745',
      payload_json: {
        payment_status: 'scheduled',
        payment_status_detail: null,
        raw: {
          payment: {
            id: '7027501745',
            status: 'scheduled',
            status_detail: null,
            payment_method_id: 'visa',
            payment_type_id: 'credit_card',
            date_created: '2026-04-25T09:00:00.000Z',
          },
        },
      },
      created_at: '2026-04-25T09:05:00.000Z',
    },
    {
      id: 10,
      tipo_evento: 'payment_failed',
      mp_topic: 'payment',
      payment_type: 'payment',
      gateway_event_id: 'pay_155550314653',
      payload_json: {
        payment_status: 'rejected',
        payment_status_detail: 'cc_rejected_high_risk',
        raw: {
          payment: {
            id: '155550314653',
            status: 'rejected',
            status_detail: 'cc_rejected_high_risk',
            payment_method_id: 'master',
            payment_type_id: 'credit_card',
            date_created: '2026-04-25T08:00:00.000Z',
          },
        },
      },
      created_at: '2026-04-25T08:05:00.000Z',
    },
  ], {
    subscriptionStatus: 'past_due',
  })

  assert.equal(summary?.source, 'payment')
  assert.equal(summary?.code, 'cc_rejected_high_risk')
  assert.equal(summary?.friendly_message, 'A última tentativa de cobrança foi recusada por análise de risco do cartão.')
  assert.equal(summary?.created_at, '2026-04-25T08:00:00.000Z')
  assert.equal(summary?.payment_method_id, 'master')
  assert.equal(summary?.payment_type_id, 'credit_card')
})

test('client loyalty failure summary stays empty when past_due has no technical status_detail', () => {
  const summary = resolveLatestClientLoyaltyFailureSummary([
    {
      id: 11,
      tipo_evento: 'payment_failed',
      mp_topic: 'automatic-payments',
      payment_type: 'subscription_authorized_payment',
      gateway_event_id: 'auth_7027501745',
      payload_json: {
        payment_status: 'scheduled',
        payment_status_detail: null,
        raw: {
          payment: {
            id: '7027501745',
            status: 'scheduled',
            status_detail: null,
          },
        },
      },
      created_at: '2026-04-25T09:05:00.000Z',
    },
  ], {
    subscriptionStatus: 'past_due',
  })

  assert.equal(summary, null)
})

test('client loyalty failure summary ignores pending review details from old failed events', () => {
  const summary = resolveLatestClientLoyaltyFailureSummary([
    {
      id: 12,
      tipo_evento: 'payment_failed',
      mp_topic: 'automatic-payments',
      payment_type: 'subscription_authorized_payment',
      gateway_event_id: 'auth_7027536608',
      payload_json: {
        payment_status: 'in-process',
        payment_status_detail: 'pending_review_manual',
        raw: {
          payment: {
            id: '7027536608',
            status: 'in-process',
            status_detail: 'pending_review_manual',
          },
        },
      },
      created_at: '2026-04-25T09:05:00.000Z',
    },
  ], {
    subscriptionStatus: 'past_due',
  })

  assert.equal(summary, null)
})

test('client loyalty authorized payment interpretation keeps scheduled pending', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027536608',
    status: 'pending_payment',
    rawStatus: 'scheduled',
    statusDetail: null,
    paymentResult: {
      status_group: 'pending',
      should_activate_subscription: false,
    },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(interpretation.interpretedOutcome, 'pending')
  assert.equal(interpretation.nextSubscriptionStatus, 'pending_payment')
  assert.equal(interpretation.transitionRule, 'authorized_payment_scheduled_pending')
  assert.equal(interpretation.isFailure, false)
})

test('client loyalty authorized payment interpretation keeps manual review pending', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '155757899565',
    status: 'pending_payment',
    rawStatus: 'in-process',
    statusDetail: 'pending_review_manual',
    paymentResult: {
      status_group: 'pending',
      status_detail: 'pending_review_manual',
      should_activate_subscription: false,
    },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(interpretation.interpretedOutcome, 'pending_review')
  assert.equal(interpretation.nextSubscriptionStatus, 'pending_payment')
  assert.equal(interpretation.transitionRule, 'authorized_payment_pending_review')
  assert.equal(interpretation.eventName, 'authorized_payment_in_process')
  assert.equal(interpretation.isFailure, false)
})

test('client loyalty authorized payment interpretation keeps rejected as failure', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027536609',
    status: 'past_due',
    rawStatus: 'rejected',
    statusDetail: 'cc_rejected_high_risk',
    paymentResult: {
      status_group: 'rejected',
      should_activate_subscription: false,
    },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(interpretation.interpretedOutcome, 'failed')
  assert.equal(interpretation.nextSubscriptionStatus, 'past_due')
  assert.equal(interpretation.transitionRule, 'authorized_payment_rejected_past_due')
  assert.equal(interpretation.isFailure, true)
})

test('client loyalty authorized payment interpretation sends rejected expired subscriptions to retry state', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '155757899565',
    status: 'past_due',
    rawStatus: 'rejected',
    statusDetail: 'cc_rejected_high_risk',
    paymentResult: {
      status_group: 'rejected',
      should_activate_subscription: false,
    },
  }, {
    currentSubscription: {
      status: 'expired',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(interpretation.interpretedOutcome, 'failed')
  assert.equal(interpretation.nextSubscriptionStatus, 'past_due')
  assert.equal(interpretation.transitionRule, 'authorized_payment_rejected_past_due')
})

test('client loyalty authorized payment interpretation keeps approved as activation', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027536610',
    status: 'active',
    rawStatus: 'approved',
    statusDetail: 'accredited',
    paymentResult: {
      status_group: 'approved',
      should_activate_subscription: true,
    },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(interpretation.interpretedOutcome, 'approved')
  assert.equal(interpretation.nextSubscriptionStatus, 'active')
  assert.equal(interpretation.transitionRule, 'authorized_payment_approved')
})

test('client loyalty payment snapshot keeps status_detail audit fields', () => {
  const snapshot = buildClientLoyaltyPaymentSnapshot({
    id: '155550314653',
    status: 'rejected',
    status_detail: 'cc_rejected_high_risk',
    payment_type_id: 'credit_card',
    payment_method_id: 'master',
    transaction_amount: 79.9,
    external_reference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
    date_created: '2026-04-25T08:00:00.000Z',
    date_approved: null,
  }, {
    paymentTarget: 'payment',
  })

  assert.equal(snapshot?.payment_id, '155550314653')
  assert.equal(snapshot?.status, 'rejected')
  assert.equal(snapshot?.status_detail, 'cc_rejected_high_risk')
  assert.equal(snapshot?.payment_method_id, 'master')
  assert.equal(snapshot?.transaction_amount, 79.9)
})

test('client loyalty payment snapshot resolver reads explicit snapshot payloads', () => {
  const snapshot = resolveLatestClientLoyaltyPaymentSnapshot([
    {
      id: 22,
      tipo_evento: 'payment_snapshot',
      mp_topic: 'payment',
      payload_json: {
        snapshot: {
          payment_target: 'payment',
          payment_id: '155550314653',
          status: 'rejected',
          status_detail: 'cc_rejected_high_risk',
          payment_method_id: 'master',
          payment_type_id: 'credit_card',
          transaction_amount: 79.9,
          external_reference: 'loyalty:sub:17:est:26:cli:158:plan:1:uuid:test',
          date_created: '2026-04-25T08:00:00.000Z',
        },
      },
      created_at: '2026-04-25T08:05:00.000Z',
    },
  ])

  assert.equal(snapshot?.payment_id, '155550314653')
  assert.equal(snapshot?.status_detail, 'cc_rejected_high_risk')
  assert.equal(snapshot?.payment_target, 'payment')
})

test('client loyalty retry options block card cooldown after high risk while keeping PIX enabled', () => {
  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: 'past_due',
    latestFailure: {
      code: 'cc_rejected_high_risk',
      created_at: '2026-04-25T08:30:00.000Z',
    },
    referenceDate: '2026-04-25T09:00:00.000Z',
  })

  assert.equal(retryOptions?.recommended_method, 'pix')
  assert.equal(retryOptions?.card?.cooldown_active, true)
  assert.equal(retryOptions?.card?.cooldown_reason, 'cc_rejected_high_risk')
  assert.equal(retryOptions?.card?.enabled, false)
  assert.equal(retryOptions?.pix?.enabled, true)
})

test('client loyalty retry options block repeated similar card attempts while keeping PIX enabled', () => {
  const summary = resolveClientLoyaltyRecentCardAttemptSummary([
    {
      id: 1,
      tipo_evento: 'payment_snapshot',
      mp_payment_id: '155',
      payment_method: 'credit_card',
      payment_type: 'credit_card',
      amount_cents: 7990,
      created_at: '2026-04-25T08:52:00.000Z',
    },
    {
      id: 2,
      tipo_evento: 'payment_failed',
      mp_payment_id: '155',
      payment_method: 'credit_card',
      payment_type: 'credit_card',
      amount_cents: 7990,
      created_at: '2026-04-25T08:53:00.000Z',
    },
    {
      id: 3,
      tipo_evento: 'card_subscription_created',
      gateway_event_id: 'preapproval-2',
      payment_method: 'credit_card',
      payment_type: 'credit_card',
      amount_cents: 7990,
      created_at: '2026-04-25T08:58:00.000Z',
    },
  ], {
    amountCents: 7990,
    referenceDate: '2026-04-25T09:00:00.000Z',
    windowMs: 15 * 60 * 1000,
    duplicateThreshold: 2,
  })

  assert.equal(summary.retry_count_recent, 2)
  assert.equal(summary.cooldown_active, true)
  assert.equal(summary.cooldown_reason, 'recent_similar_attempts')

  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: 'past_due',
    recentAttemptSummary: summary,
  })

  assert.equal(retryOptions.recommended_method, 'pix')
  assert.equal(retryOptions.card.enabled, false)
  assert.equal(retryOptions.card.cooldown_reason, 'recent_similar_attempts')
  assert.equal(retryOptions.pix.enabled, true)
})

test('client loyalty card payer validation rejects weak payer data and normalizes valid CPF data', () => {
  const invalid = validateClientLoyaltyCardPayerData({
    payerEmail: 'cliente',
    cardholderName: 'A B',
    identificationType: 'CPF',
    identificationNumber: '123',
  })

  assert.equal(invalid.valid, false)
  assert.equal(Boolean(invalid.errors.payer_email), true)
  assert.equal(Boolean(invalid.errors.cardholder_name), true)
  assert.equal(Boolean(invalid.errors.identification_number), true)

  const valid = validateClientLoyaltyCardPayerData({
    payerEmail: 'CLIENTE@EXAMPLE.COM',
    cardholderName: 'Maria Silva',
    identificationType: 'cpf',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  })

  assert.equal(valid.valid, true)
  assert.equal(valid.normalized.payerEmail, 'cliente@example.com')
  assert.equal(valid.normalized.identificationType, 'CPF')
  assert.equal(valid.normalized.identificationNumber, '52998224725')
  assert.equal(valid.normalized.payerPhone, '11987654321')
})
