import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPixPaymentContext,
  isSamePixLogicalContext,
  resolvePixPaymentDisposition,
  selectPixSubscriptionCandidate,
} from '../src/lib/pix_reconciliation.js'

test('buildPixPaymentContext extracts metadata and external reference fallbacks', () => {
  const context = buildPixPaymentContext({
    id: 99123,
    status: 'approved',
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    external_reference: 'plan:pro:cycle:mensal:est:41:uuid:abc123',
    metadata: {
      establishment_id: undefined,
      estabelecimento_id: '41',
      charge_kind: 'renewal',
    },
    transaction_amount: 29.9,
  })

  assert.equal(context.payment_id, '99123')
  assert.equal(context.establishment_id, 41)
  assert.equal(context.plan, 'pro')
  assert.equal(context.billing_cycle, 'mensal')
  assert.equal(context.charge_kind, 'renewal')
  assert.equal(context.transaction_amount_cents, 2990)
})

test('selectPixSubscriptionCandidate prefers exact payment match over newer pending pix', () => {
  const paymentContext = buildPixPaymentContext({
    id: 'mp-approved-1',
    status: 'approved',
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    external_reference: 'plan:pro:cycle:mensal:est:8:uuid:older',
    metadata: {
      estabelecimento_id: '8',
      charge_kind: 'renewal',
    },
    transaction_amount: 29.9,
  })

  const olderMatching = {
    id: 10,
    estabelecimentoId: 8,
    plan: 'pro',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    gatewayPaymentId: 'mp-approved-1',
    gatewayPreferenceId: 'mp-approved-1',
    externalReference: 'plan:pro:cycle:mensal:est:8:uuid:older',
    amountCents: 2990,
    createdAt: '2026-04-21T10:00:00.000Z',
  }
  const newerButWrong = {
    id: 11,
    estabelecimentoId: 8,
    plan: 'pro',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    gatewayPaymentId: 'another-pending',
    gatewayPreferenceId: 'another-pending',
    externalReference: 'plan:pro:cycle:mensal:est:8:uuid:newer',
    amountCents: 2990,
    createdAt: '2026-04-22T09:00:00.000Z',
  }

  const selected = selectPixSubscriptionCandidate([newerButWrong, olderMatching], paymentContext)

  assert.equal(selected.candidate?.id, 10)
  assert.ok(selected.reasons.includes('gateway_payment_id'))
})

test('selectPixSubscriptionCandidate falls back by logical context when external reference changed', () => {
  const paymentContext = buildPixPaymentContext({
    id: 'mp-approved-2',
    status: 'approved',
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    external_reference: 'plan:starter:cycle:mensal:est:15:uuid:new-external',
    metadata: {
      estabelecimento_id: '15',
      charge_kind: 'renewal',
    },
    transaction_amount: 1490 / 100,
  })

  const candidate = {
    id: 70,
    estabelecimentoId: 15,
    plan: 'starter',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    gatewayPaymentId: null,
    gatewayPreferenceId: 'older-preference-id',
    externalReference: 'plan:starter:cycle:mensal:est:15:uuid:old-external',
    amountCents: 1490,
    createdAt: '2026-04-22T08:00:00.000Z',
  }

  const selected = selectPixSubscriptionCandidate([candidate], paymentContext)

  assert.equal(selected.candidate?.id, 70)
  assert.ok(selected.score >= 120)
  assert.ok(selected.reasons.includes('estabelecimento_id'))
  assert.ok(selected.reasons.includes('plan'))
  assert.ok(selected.reasons.includes('billing_cycle'))
})

test('isSamePixLogicalContext groups multiple pending pix for the same subscription context', () => {
  const left = {
    estabelecimentoId: 99,
    plan: 'pro',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    externalReference: 'plan:pro:cycle:mensal:est:99:uuid:left',
  }
  const right = {
    estabelecimentoId: 99,
    plan: 'pro',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    externalReference: 'plan:pro:cycle:mensal:est:99:uuid:right',
  }
  const unrelated = {
    estabelecimentoId: 99,
    plan: 'starter',
    billingCycle: 'mensal',
    paymentMethod: 'pix',
    status: 'pending_pix',
    externalReference: 'plan:starter:cycle:mensal:est:99:uuid:other',
  }

  assert.equal(isSamePixLogicalContext(left, right), true)
  assert.equal(isSamePixLogicalContext(left, unrelated), false)
})

test('resolvePixPaymentDisposition keeps approved processing idempotent and blocks stale pix', () => {
  assert.equal(resolvePixPaymentDisposition({
    status: 'approved',
    paymentId: '123',
    subscriptionLastEventId: '123',
    hasObsoleteMarker: false,
  }), 'already_processed')

  assert.equal(resolvePixPaymentDisposition({
    status: 'approved',
    paymentId: '124',
    subscriptionLastEventId: '100',
    hasObsoleteMarker: true,
  }), 'stale_superseded')

  assert.equal(resolvePixPaymentDisposition({
    status: 'pending',
    paymentId: '124',
    subscriptionLastEventId: '100',
    hasObsoleteMarker: true,
  }), 'stale_superseded')

  assert.equal(resolvePixPaymentDisposition({
    status: 'pending',
    paymentId: '125',
    subscriptionLastEventId: null,
    hasObsoleteMarker: false,
  }), 'pending')
})
