import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyMercadoPagoPaymentOutcome,
  findLatestMercadoPagoPaymentResult,
  summarizeMercadoPagoGatewayResult,
} from '../src/lib/mercadopago_payment_outcome.js'

test('classifyMercadoPagoPaymentOutcome maps cc_rejected_high_risk as risk decline', () => {
  const result = classifyMercadoPagoPaymentOutcome({
    status: 'rejected',
    statusDetail: 'cc_rejected_high_risk',
    paymentMethodId: 'master',
    paymentTypeId: 'credit_card',
    liveMode: true,
  })

  assert.equal(result.status_group, 'rejected')
  assert.equal(result.normalized_reason, 'risk_declined')
  assert.equal(result.category, 'risk')
  assert.equal(result.decision, 'reject')
  assert.equal(result.automatic_retry_allowed, false)
  assert.equal(result.manual_retry_allowed, true)
  assert.equal(result.requires_new_card, true)
  assert.equal(result.suggests_other_payment_method, true)
  assert.equal(result.should_activate_subscription, false)
})

test('summarizeMercadoPagoGatewayResult maps insufficient data rejections to review card data', () => {
  const result = summarizeMercadoPagoGatewayResult({
    id: 901,
    status: 'rejected',
    status_detail: 'rejected_insufficient_data',
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
    transaction_amount: 79.9,
  })

  assert.equal(result.status_group, 'rejected')
  assert.equal(result.normalized_reason, 'insufficient_data')
  assert.equal(result.action_recommendation, 'review_card_data')
  assert.equal(result.user_message, 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.')
  assert.equal(result.payment_id, '901')
})

test('summarizeMercadoPagoGatewayResult keeps pending_review_manual as pending without retry', () => {
  const result = summarizeMercadoPagoGatewayResult({
    id: 902,
    status: 'in_process',
    status_detail: 'pending_review_manual',
    payment_method_id: 'elo',
    payment_type_id: 'credit_card',
  })

  assert.equal(result.status_group, 'pending')
  assert.equal(result.normalized_reason, 'manual_review')
  assert.equal(result.manual_retry_allowed, false)
  assert.equal(result.wait_for_webhook, true)
  assert.equal(result.should_activate_subscription, false)
})

test('summarizeMercadoPagoGatewayResult keeps scheduled authorized payments pending', () => {
  const result = summarizeMercadoPagoGatewayResult({
    id: 904,
    status: 'scheduled',
    status_detail: null,
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
  })

  assert.equal(result.status_group, 'pending')
  assert.equal(result.normalized_reason, 'scheduled')
  assert.equal(result.decision, 'pending')
  assert.equal(result.wait_for_webhook, true)
  assert.equal(result.should_activate_subscription, false)
})

test('summarizeMercadoPagoGatewayResult accepts hyphenated in-process as pending', () => {
  const result = summarizeMercadoPagoGatewayResult({
    id: 905,
    status: 'in-process',
    status_detail: 'pending_review_manual',
    payment_method_id: 'elo',
    payment_type_id: 'credit_card',
  })

  assert.equal(result.status_group, 'pending')
  assert.equal(result.status, 'in-process')
  assert.equal(result.normalized_reason, 'manual_review')
  assert.equal(result.should_activate_subscription, false)
})

test('summarizeMercadoPagoGatewayResult maps approved payments to activation', () => {
  const result = summarizeMercadoPagoGatewayResult({
    id: 903,
    status: 'approved',
    status_detail: 'accredited',
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
    live_mode: true,
  })

  assert.equal(result.status_group, 'approved')
  assert.equal(result.normalized_reason, 'accredited')
  assert.equal(result.decision, 'activate')
  assert.equal(result.should_activate_subscription, true)
  assert.equal(result.should_mark_payment_approved, true)
})

test('findLatestMercadoPagoPaymentResult ignores older failures when a newer approval already exists', () => {
  const events = [
    {
      event_type: 'payment_recovered',
      created_at: '2026-04-17T10:00:00.000Z',
      payload: {
        payment_result: {
          status: 'approved',
          status_detail: 'accredited',
          status_group: 'approved',
          normalized_reason: 'accredited',
          decision: 'activate',
          should_activate_subscription: true,
          should_mark_payment_approved: true,
        },
      },
    },
    {
      event_type: 'payment_failed',
      created_at: '2026-04-16T10:00:00.000Z',
      payload: {
        payment_result: {
          status: 'rejected',
          status_detail: 'cc_rejected_high_risk',
          status_group: 'rejected',
          normalized_reason: 'risk_declined',
          decision: 'reject',
          manual_retry_allowed: true,
        },
      },
    },
  ]

  assert.equal(findLatestMercadoPagoPaymentResult(events, { includePending: true }), null)
  assert.equal(findLatestMercadoPagoPaymentResult(events, { includePending: true, onlyFailures: true }), null)
})
