import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD,
  buildClientLoyaltyActivationEventPayload,
  buildClientLoyaltyPaymentSnapshot,
  interpretClientLoyaltyAuthorizedPaymentStatus,
  resolveClientLoyaltyAuthorizedPaymentPriority,
  resolveDominantClientLoyaltyFinalRealPayment,
  resolveClientLoyaltyCardholderNameInput,
  resolveClientLoyaltyHighRiskFailureSequence,
  resolveClientLoyaltyRecentCardAttemptSummary,
  resolveClientLoyaltyRetryOptions,
  resolveLatestClientLoyaltyFailureSummary,
  resolveLatestClientLoyaltyPaymentSnapshot,
  validateClientLoyaltyCardPayerData,
} = await import('../src/lib/client_loyalty_billing.js')
const {
  LOYALTY_CARDHOLDER_NAME_FIELD,
} = await import('../../frontend/src/utils/loyaltyPaymentValidation.js')

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
  assert.equal(summary?.friendly_message, 'Não foi possível aprovar este cartão no momento. Você pode tentar outro cartão ou pagar por PIX.')
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

test('client loyalty retry options apply 24h same-card cooldown after high risk while keeping PIX and new card available', () => {
  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: 'past_due',
    latestFailure: {
      code: 'cc_rejected_high_risk',
      created_at: '2026-04-25T08:30:00.000Z',
    },
    referenceDate: '2026-04-25T09:00:00.000Z',
  })

  assert.equal(retryOptions?.recommended_method, 'pix')
  assert.equal(retryOptions?.same_card_cooldown_active, true)
  assert.equal(retryOptions?.same_card_cooldown_remaining_ms, 23.5 * 60 * 60 * 1000)
  assert.equal(retryOptions?.card?.same_card_cooldown_reason, 'cc_rejected_high_risk')
  assert.equal(retryOptions?.card?.cooldown_active, false)
  assert.equal(retryOptions?.card?.enabled, true)
  assert.equal(retryOptions?.card?.manual_new_card_allowed, true)
  assert.equal(retryOptions?.pix?.enabled, true)
})

test('client loyalty high risk sequence counts consecutive distinct rejected payments', () => {
  const events = [
    {
      id: 12,
      tipo_evento: 'payment_failed',
      mp_payment_id: 'pay-2',
      payment_status: 'rejected',
      payment_type: 'credit_card',
      payload_json: {
        payment_status: 'rejected',
        payment_status_detail: 'cc_rejected_high_risk',
        raw: { payment: { id: 'pay-2', status: 'rejected', status_detail: 'cc_rejected_high_risk' } },
      },
      created_at: '2026-04-25T09:00:00.000Z',
    },
    {
      id: 11,
      tipo_evento: 'payment_snapshot',
      mp_payment_id: 'pay-2',
      payment_status: 'rejected',
      payment_type: 'credit_card',
      payload_json: {
        snapshot: { payment_id: 'pay-2', status: 'rejected', status_detail: 'cc_rejected_high_risk' },
      },
      created_at: '2026-04-25T08:59:30.000Z',
    },
    {
      id: 10,
      tipo_evento: 'payment_failed',
      mp_payment_id: 'pay-1',
      payment_status: 'rejected',
      payment_type: 'credit_card',
      payload_json: {
        payment_status: 'rejected',
        payment_status_detail: 'cc_rejected_high_risk',
        raw: { payment: { id: 'pay-1', status: 'rejected', status_detail: 'cc_rejected_high_risk' } },
      },
      created_at: '2026-04-25T08:00:00.000Z',
    },
  ]

  const sequence = resolveClientLoyaltyHighRiskFailureSequence(events)
  const failure = resolveLatestClientLoyaltyFailureSummary(events, { subscriptionStatus: 'past_due' })

  assert.equal(sequence.high_risk_consecutive_count, 2)
  assert.equal(sequence.same_day_auto_retry_blocked, true)
  assert.equal(sequence.action_required, false)
  assert.equal(failure.high_risk_consecutive_count, 2)
  assert.equal(failure.high_risk_same_day_auto_retry_blocked, true)
})

test('client loyalty retry options require customer action after third consecutive high risk rejection', () => {
  const retryOptions = resolveClientLoyaltyRetryOptions({
    subscriptionStatus: 'past_due',
    latestFailure: {
      code: 'cc_rejected_high_risk',
      created_at: '2026-04-25T08:30:00.000Z',
      high_risk_consecutive_count: 3,
    },
    referenceDate: '2026-04-25T09:00:00.000Z',
  })

  assert.equal(retryOptions.recommended_method, 'pix')
  assert.equal(retryOptions.automatic_retry_allowed, false)
  assert.equal(retryOptions.high_risk_action_required, true)
  assert.equal(retryOptions.card.action_required, true)
  assert.equal(retryOptions.card.action, 'update_card')
  assert.equal(retryOptions.card.enabled, true)
  assert.equal(retryOptions.pix.enabled, true)
})

test('client loyalty PIX activation payload records fallback source and previous failure code', () => {
  const payload = buildClientLoyaltyActivationEventPayload({
    id: 'pix-123',
    status: 'approved',
    payment_method_id: 'pix',
    metadata: {
      fallback_reason: 'card_high_risk',
      fallback_source: 'pix',
      fallback_origin: 'failure_recovery',
      previous_failure_code: 'cc_rejected_high_risk',
    },
  }, {
    paymentMethod: 'pix',
  })

  assert.equal(payload.fallback_source, 'pix')
  assert.equal(payload.fallback_reason, 'card_high_risk')
  assert.equal(payload.fallback_origin, 'failure_recovery')
  assert.equal(payload.previous_failure_code, 'cc_rejected_high_risk')
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

test('client loyalty card payer validation accepts normalized full holder names', () => {
  const base = {
    payerEmail: 'cliente@example.com',
    identificationType: 'CPF',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  }
  const cases = [
    ['Maria Silva', 'Maria Silva'],
    ['  Maria   Silva  ', 'Maria Silva'],
    ['João Pedro', 'João Pedro'],
    ["Ana-Maria D'Ávila", "Ana-Maria D'Ávila"],
  ]

  for (const [name, expected] of cases) {
    const result = validateClientLoyaltyCardPayerData({
      ...base,
      [CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD]: name,
    })
    assert.equal(result.valid, true, name)
    assert.equal(result.normalized.cardholderName, expected)
    assert.equal(result.sourceFields.cardholderName, CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD)
  }
})

test('client loyalty card payer validation rejects a single holder name', () => {
  const result = validateClientLoyaltyCardPayerData({
    payerEmail: 'cliente@example.com',
    [CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD]: 'Maria',
    identificationType: 'CPF',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  })

  assert.equal(result.valid, false)
  assert.equal(Boolean(result.errors.cardholder_name), true)
})

test('client loyalty cardholder field stays aligned with frontend payload key', () => {
  const resolved = resolveClientLoyaltyCardholderNameInput({
    [CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD]: '  Maria   Silva  ',
    payer_name: 'Nome Ignorado',
  })

  assert.equal(CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD, LOYALTY_CARDHOLDER_NAME_FIELD)
  assert.equal(resolved.normalized, 'Maria Silva')
  assert.equal(resolved.sourceField, CLIENT_LOYALTY_CARDHOLDER_NAME_FIELD)
})

test('client loyalty prioritizes rejected real payment over scheduled authorized payment', () => {
  const events = [
    {
      id: 30,
      tipo_evento: 'payment_snapshot',
      mp_topic: 'automatic-payments',
      payment_type: 'subscription_authorized_payment',
      mp_payment_id: '7027639889',
      payload_json: {
        snapshot: {
          payment_target: 'authorized_payment',
          payment_id: '7027639889',
          status: 'scheduled',
          status_detail: 'cc_rejected_high_risk',
        },
      },
      created_at: '2026-04-29T12:02:00.000Z',
    },
    {
      id: 29,
      tipo_evento: 'payment_failed',
      mp_topic: 'payment',
      payment_type: 'credit_card',
      mp_payment_id: '156205780317',
      payment_status: 'rejected',
      payload_json: {
        payment_status: 'rejected',
        payment_status_detail: 'cc_rejected_high_risk',
        raw: {
          payment: {
            id: '156205780317',
            status: 'rejected',
            status_detail: 'cc_rejected_high_risk',
            payment_method_id: 'master',
            payment_type_id: 'credit_card',
            external_reference: 'loyalty:sub:20:est:26:cli:1:plan:1:uuid:test',
            date_created: '2026-04-29T12:00:00.000Z',
          },
        },
      },
      created_at: '2026-04-29T12:01:00.000Z',
    },
    {
      id: 28,
      tipo_evento: 'payment_snapshot',
      mp_topic: 'payment',
      payment_type: 'credit_card',
      mp_payment_id: '156205780317',
      payload_json: {
        snapshot: {
          payment_target: 'payment',
          payment_id: '156205780317',
          status: 'rejected',
          status_detail: 'cc_rejected_high_risk',
          payment_method_id: 'master',
          payment_type_id: 'credit_card',
          external_reference: 'loyalty:sub:20:est:26:cli:1:plan:1:uuid:test',
        },
      },
      created_at: '2026-04-29T12:00:30.000Z',
    },
  ]
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027639889',
    rawStatus: 'scheduled',
    statusDetail: 'cc_rejected_high_risk',
    paymentResult: { status_group: 'pending' },
  }, {
    currentSubscription: {
      status: 'past_due',
      paymentMethod: 'credit_card',
    },
  })
  const dominant = resolveDominantClientLoyaltyFinalRealPayment(events, {
    gatewayPaymentId: '156205780317',
  })
  const priority = resolveClientLoyaltyAuthorizedPaymentPriority({
    interpretation,
    dominantPayment: dominant,
    currentSubscriptionStatus: 'past_due',
  })
  const latestSnapshot = resolveLatestClientLoyaltyPaymentSnapshot(events)
  const latestFailure = resolveLatestClientLoyaltyFailureSummary(events, {
    subscriptionStatus: 'past_due',
  })

  assert.equal(dominant?.payment_id, '156205780317')
  assert.equal(priority.suppressTransition, true)
  assert.equal(priority.preservedSubscriptionStatus, 'past_due')
  assert.equal(priority.priorityRule, 'real_payment_final_status_wins')
  assert.equal(latestSnapshot?.payment_target, 'payment')
  assert.equal(latestSnapshot?.status, 'rejected')
  assert.equal(latestFailure?.code, 'cc_rejected_high_risk')
  assert.equal(latestFailure?.source, 'payment')
})

test('client loyalty does not downgrade approved real payment when authorized payment is scheduled', () => {
  const events = [
    {
      tipo_evento: 'payment_approved',
      mp_topic: 'payment',
      payment_type: 'credit_card',
      mp_payment_id: '156205780318',
      payment_status: 'approved',
      payload_json: {
        payment: {
          id: '156205780318',
          status: 'approved',
          payment_type_id: 'credit_card',
        },
      },
      created_at: '2026-04-29T12:00:00.000Z',
    },
  ]
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027639890',
    rawStatus: 'scheduled',
    paymentResult: { status_group: 'pending' },
  }, {
    currentSubscription: {
      status: 'active',
      paymentMethod: 'credit_card',
      currentPeriodStart: new Date('2026-04-29T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-05-29T12:00:00.000Z'),
    },
  })
  const priority = resolveClientLoyaltyAuthorizedPaymentPriority({
    interpretation,
    dominantPayment: resolveDominantClientLoyaltyFinalRealPayment(events, {
      gatewayPaymentId: '156205780318',
    }),
    currentSubscriptionStatus: 'active',
  })

  assert.equal(priority.suppressTransition, true)
  assert.equal(priority.preservedSubscriptionStatus, 'active')
  assert.equal(priority.conflict, false)
})

test('client loyalty keeps authorized payment pending behavior when there is no final real payment', () => {
  const scheduled = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027639891',
    rawStatus: 'scheduled',
    paymentResult: { status_group: 'pending' },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })
  const inProcess = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027639892',
    rawStatus: 'in_process',
    statusDetail: 'pending_review_manual',
    paymentResult: {
      status_group: 'pending',
      status_detail: 'pending_review_manual',
    },
  }, {
    currentSubscription: {
      status: 'pending_payment',
      paymentMethod: 'credit_card',
    },
  })

  assert.equal(resolveClientLoyaltyAuthorizedPaymentPriority({
    interpretation: scheduled,
    dominantPayment: null,
    currentSubscriptionStatus: 'pending_payment',
  }).suppressTransition, false)
  assert.equal(scheduled.nextSubscriptionStatus, 'pending_payment')

  assert.equal(resolveClientLoyaltyAuthorizedPaymentPriority({
    interpretation: inProcess,
    dominantPayment: null,
    currentSubscriptionStatus: 'pending_payment',
  }).suppressTransition, false)
  assert.equal(inProcess.interpretedOutcome, 'pending_review')
})

test('client loyalty logs priority conflict when authorized approved conflicts with rejected real payment', () => {
  const interpretation = interpretClientLoyaltyAuthorizedPaymentStatus({
    id: '7027639893',
    rawStatus: 'approved',
    paymentResult: {
      status_group: 'approved',
      should_activate_subscription: true,
    },
  }, {
    currentSubscription: {
      status: 'past_due',
      paymentMethod: 'credit_card',
    },
  })
  const priority = resolveClientLoyaltyAuthorizedPaymentPriority({
    interpretation,
    dominantPayment: {
      source: 'payment',
      payment_id: '156205780317',
      status: 'rejected',
      status_detail: 'cc_rejected_high_risk',
      subscription_status: 'past_due',
    },
    currentSubscriptionStatus: 'past_due',
  })

  assert.equal(priority.suppressTransition, true)
  assert.equal(priority.conflict, true)
  assert.equal(priority.attemptedNextStatus, 'active')
  assert.equal(priority.preservedSubscriptionStatus, 'past_due')
})
