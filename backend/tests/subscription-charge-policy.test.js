import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecoveryChargeFingerprint,
  canCreateSubscription,
  canRunRecoveryCharge,
} from '../src/lib/subscription_charge_policy.js'

function makeEvent({
  eventType,
  createdAt,
  subscriptionId = 266,
  plan = 'pro',
  billingCycle = 'mensal',
  amountCents = 7990,
  payerEmail = 'owner@example.com',
  paymentMethodId = 'master',
  paymentResult = null,
  fingerprint = null,
} = {}) {
  return {
    subscription_id: subscriptionId,
    event_type: eventType,
    created_at: createdAt,
    plan,
    billing_cycle: billingCycle,
    payload: {
      subscription_id: String(subscriptionId),
      plan,
      billing_cycle: billingCycle,
      amount_cents: amountCents,
      payer_email: payerEmail,
      payment_method_id: paymentMethodId,
      duplicate_fingerprint: fingerprint,
      payment_result: paymentResult,
    },
  }
}

test('canRunRecoveryCharge allows recovery for delinquent subscription without recent conflicting events', () => {
  const subscription = {
    id: 266,
    gatewaySubscriptionId: 'preapp_123',
    plan: 'pro',
    billingCycle: 'mensal',
    amountCents: 7990,
    status: 'past_due',
  }

  const result = canRunRecoveryCharge({
    subscription,
    currentStatus: 'past_due',
    recentEvents: [],
    amountCents: 7990,
    payerEmail: 'owner@example.com',
    paymentMethodId: 'master',
    plan: 'pro',
    billingCycle: 'mensal',
    nowMs: Date.parse('2026-04-17T12:00:00.000Z'),
  })

  assert.equal(result.can_run, true)
  assert.equal(result.decision, 'allow')
  assert.equal(result.normalized_reason, 'recovery_allowed')
})

test('canRunRecoveryCharge defers when subscription was configured on the card very recently', () => {
  const subscription = {
    id: 266,
    gatewaySubscriptionId: 'preapp_123',
    plan: 'pro',
    billingCycle: 'mensal',
    amountCents: 7990,
    status: 'past_due',
  }
  const nowMs = Date.parse('2026-04-17T12:00:00.000Z')

  const result = canRunRecoveryCharge({
    subscription,
    currentStatus: 'past_due',
    recentEvents: [
      makeEvent({
        eventType: 'subscription_created',
        createdAt: '2026-04-17T11:57:00.000Z',
      }),
    ],
    amountCents: 7990,
    payerEmail: 'owner@example.com',
    paymentMethodId: 'master',
    plan: 'pro',
    billingCycle: 'mensal',
    nowMs,
  })

  assert.equal(result.can_run, false)
  assert.equal(result.should_defer, true)
  assert.equal(result.decision, 'defer')
  assert.equal(result.normalized_reason, 'recent_subscription_setup')
})

test('canRunRecoveryCharge blocks high risk retries during cooldown', () => {
  const subscription = {
    id: 266,
    gatewaySubscriptionId: 'preapp_123',
    plan: 'pro',
    billingCycle: 'mensal',
    amountCents: 7990,
    status: 'past_due',
  }
  const nowMs = Date.parse('2026-04-17T12:00:00.000Z')

  const result = canRunRecoveryCharge({
    subscription,
    currentStatus: 'past_due',
    recentEvents: [
      makeEvent({
        eventType: 'payment_failed',
        createdAt: '2026-04-17T11:30:00.000Z',
        paymentResult: {
          status: 'rejected',
          status_detail: 'cc_rejected_high_risk',
          status_group: 'rejected',
          normalized_reason: 'risk_declined',
        },
      }),
    ],
    amountCents: 7990,
    payerEmail: 'owner@example.com',
    paymentMethodId: 'master',
    plan: 'pro',
    billingCycle: 'mensal',
    nowMs,
  })

  assert.equal(result.can_run, false)
  assert.equal(result.decision, 'block')
  assert.equal(result.normalized_reason, 'high_risk_cooldown')
  assert.equal(result.cooldown_active, true)
  assert.equal(result.duplicate_risk, true)
})

test('canRunRecoveryCharge detects recent duplicate recovery attempts with same fingerprint', () => {
  const subscription = {
    id: 266,
    gatewaySubscriptionId: 'preapp_123',
    plan: 'pro',
    billingCycle: 'mensal',
    amountCents: 7990,
    status: 'past_due',
  }
  const nowMs = Date.parse('2026-04-17T12:00:00.000Z')
  const fingerprint = buildRecoveryChargeFingerprint({
    subscriptionId: 266,
    plan: 'pro',
    billingCycle: 'mensal',
    amountCents: 7990,
    payerEmail: 'owner@example.com',
    paymentMethodId: 'master',
  })

  const result = canRunRecoveryCharge({
    subscription,
    currentStatus: 'past_due',
    recentEvents: [
      makeEvent({
        eventType: 'payment_recovery_attempt',
        createdAt: '2026-04-17T11:55:00.000Z',
        fingerprint,
      }),
    ],
    amountCents: 7990,
    payerEmail: 'owner@example.com',
    paymentMethodId: 'master',
    plan: 'pro',
    billingCycle: 'mensal',
    nowMs,
  })

  assert.equal(result.can_run, false)
  assert.equal(result.decision, 'defer')
  assert.equal(result.normalized_reason, 'duplicate_recovery_attempt')
  assert.equal(result.recent_similar_attempt_found, true)
})

test('canCreateSubscription blocks duplicate onboarding in a short window', () => {
  const result = canCreateSubscription({
    currentSubscription: {
      gatewaySubscriptionId: 'preapp_123',
      paymentMethod: 'credit_card',
      plan: 'pro',
      billingCycle: 'mensal',
    },
    recentEvents: [
      makeEvent({
        eventType: 'subscription_created',
        createdAt: '2026-04-17T11:59:10.000Z',
      }),
    ],
    targetPlan: 'pro',
    billingCycle: 'mensal',
    nowMs: Date.parse('2026-04-17T12:00:00.000Z'),
  })

  assert.equal(result.allowed, false)
  assert.equal(result.normalized_reason, 'recent_subscription_setup')
  assert.equal(result.decision, 'block')
})
