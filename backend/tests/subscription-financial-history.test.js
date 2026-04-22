import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSubscriptionFinancialHistory } from '../../frontend/src/utils/subscriptionFinancialHistory.js'

test('buildSubscriptionFinancialHistory hides pix_generated after pix_paid for the same payment', () => {
  const history = buildSubscriptionFinancialHistory([
    {
      id: 1,
      event_type: 'pix_generated',
      gateway_event_id: 'pay-1',
      payload: {
        payment_method: 'pix',
        payment: {
          id: 'pay-1',
          payment_type_id: 'bank_transfer',
          payment_method_id: 'pix',
        },
      },
      created_at: '2026-04-22T10:00:00.000Z',
      plan: 'pro',
      billing_cycle: 'mensal',
      payment_method: 'pix',
      status: 'pending_pix',
    },
    {
      id: 2,
      event_type: 'pix_paid',
      gateway_event_id: 'pay-1',
      payload: {
        payment_method: 'pix',
        payment: {
          id: 'pay-1',
          payment_type_id: 'bank_transfer',
          payment_method_id: 'pix',
          status: 'approved',
        },
      },
      created_at: '2026-04-22T10:05:00.000Z',
      plan: 'pro',
      billing_cycle: 'mensal',
      payment_method: 'pix',
      status: 'active',
    },
  ], { subscriptionStatus: 'active' })

  assert.equal(history.open_pix_event, null)
  assert.equal(history.timeline.some((item) => item.event_type === 'pix_generated'), false)
  assert.equal(history.timeline.some((item) => item.event_type === 'pix_paid'), true)
})

test('buildSubscriptionFinancialHistory hides pix_generated after pix_obsolete for the same payment', () => {
  const history = buildSubscriptionFinancialHistory([
    {
      id: 10,
      event_type: 'pix_generated',
      gateway_event_id: 'pay-stale',
      payload: {
        payment_method: 'pix',
        payment: {
          id: 'pay-stale',
          payment_type_id: 'bank_transfer',
          payment_method_id: 'pix',
        },
      },
      created_at: '2026-04-22T09:00:00.000Z',
      plan: 'starter',
      billing_cycle: 'mensal',
      payment_method: 'pix',
      status: 'pending_pix',
    },
    {
      id: 11,
      event_type: 'pix_obsolete',
      gateway_event_id: 'pix-obsolete:pay-approved:44',
      payload: {
        payment_method: 'pix',
        payment_id: 'pay-stale',
        approved_payment_id: 'pay-approved',
      },
      created_at: '2026-04-22T09:10:00.000Z',
      plan: 'starter',
      billing_cycle: 'mensal',
      payment_method: 'pix',
      status: 'canceled',
    },
  ], { subscriptionStatus: 'active' })

  assert.equal(history.open_pix_event, null)
  assert.equal(history.timeline.some((item) => item.event_type === 'pix_generated'), false)
  assert.equal(history.timeline.some((item) => item.event_type === 'pix_obsolete'), true)
})

test('buildSubscriptionFinancialHistory keeps unresolved pix_generated visible when no resolution event exists', () => {
  const history = buildSubscriptionFinancialHistory([
    {
      id: 21,
      event_type: 'pix_generated',
      gateway_event_id: 'pay-open',
      payload: {
        payment_method: 'pix',
        payment: {
          id: 'pay-open',
          payment_type_id: 'bank_transfer',
          payment_method_id: 'pix',
        },
      },
      created_at: '2026-04-22T11:00:00.000Z',
      plan: 'pro',
      billing_cycle: 'mensal',
      payment_method: 'pix',
      status: 'pending_pix',
    },
  ], { subscriptionStatus: 'pending_pix' })

  assert.equal(history.open_pix_event?.event_type, 'pix_generated')
  assert.equal(history.timeline.some((item) => item.event_type === 'pix_generated'), true)
})
