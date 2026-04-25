import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  buildClientLoyaltyPaymentSnapshot,
  resolveClientLoyaltyRetryOptions,
  resolveLatestClientLoyaltyFailureSummary,
  resolveLatestClientLoyaltyPaymentSnapshot,
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
  assert.equal(summary?.friendly_message, 'A ultima tentativa de cobranca foi recusada por analise de risco do cartao.')
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
  assert.equal(retryOptions?.card?.enabled, false)
  assert.equal(retryOptions?.pix?.enabled, true)
})
