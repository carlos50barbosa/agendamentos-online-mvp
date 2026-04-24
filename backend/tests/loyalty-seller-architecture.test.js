import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeClientLoyaltyOwnerType,
  serializeClientLoyaltySubscription,
} from '../src/lib/client_loyalty_subscriptions.js'
import { summarizeMpAccount } from '../src/services/mpAccounts.js'
import {
  buildMercadoPagoSellerWebhookDeliveryKey,
  normalizeMercadoPagoSellerWebhookTopic,
} from '../src/services/loyaltySubscriptions.js'

test('normalizeClientLoyaltyOwnerType keeps establishment ownership by default', () => {
  assert.equal(normalizeClientLoyaltyOwnerType(null), 'establishment')
  assert.equal(normalizeClientLoyaltyOwnerType('invalid'), 'establishment')
})

test('normalizeClientLoyaltyOwnerType accepts platform ownership explicitly', () => {
  assert.equal(normalizeClientLoyaltyOwnerType('platform'), 'platform')
})

test('serializeClientLoyaltySubscription exposes seller ownership and MP fields', () => {
  const serialized = serializeClientLoyaltySubscription({
    id: 88,
    clienteId: 5,
    estabelecimentoId: 27,
    loyaltyPlanId: 14,
    ownerType: 'establishment',
    sellerMpAccountId: 9,
    status: 'active',
    paymentMethod: 'credit_card',
    gateway: 'mercadopago',
    gatewayCustomerId: 'payer_123',
    mpPayerId: 'payer_123',
    gatewaySubscriptionId: 'preapp_456',
    mpPreapprovalId: 'preapp_456',
    gatewayPaymentId: 'pay_789',
    externalReference: 'loyalty:sub:88:est:27:cli:5:plan:14:uuid:test',
    startedAt: new Date('2026-04-24T12:00:00.000Z'),
    currentPeriodStart: new Date('2026-04-24T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-05-24T12:00:00.000Z'),
    nextBillingAt: new Date('2026-05-24T12:00:00.000Z'),
    lastPaymentAt: new Date('2026-04-24T12:05:00.000Z'),
    graceUntil: null,
    cancelAt: null,
    canceledAt: null,
    autoRenew: true,
    createdAt: new Date('2026-04-24T11:59:00.000Z'),
    updatedAt: new Date('2026-04-24T12:05:00.000Z'),
  })

  assert.equal(serialized.owner_type, 'establishment')
  assert.equal(serialized.seller_mp_account_id, 9)
  assert.equal(serialized.mp_payer_id, 'payer_123')
  assert.equal(serialized.mp_preapproval_id, 'preapp_456')
  assert.equal(serialized.started_at, '2026-04-24T12:00:00.000Z')
})

test('summarizeMpAccount returns disconnected defaults when there is no seller account', () => {
  const summary = summarizeMpAccount(null)

  assert.equal(summary.connected, false)
  assert.equal(summary.status, 'disconnected')
  assert.equal(summary.owner_type, 'establishment')
})

test('summarizeMpAccount preserves seller identifiers and public key', () => {
  const summary = summarizeMpAccount({
    id: 3,
    estabelecimentoId: 27,
    connected: true,
    status: 'connected',
    mpUserId: '123456',
    mpCollectorId: '123456',
    publicKey: 'APP_USR-123',
    tokenLast4: 'abcd',
    tokenExpiresAt: new Date('2026-04-30T12:00:00.000Z'),
    createdAt: new Date('2026-04-24T10:00:00.000Z'),
    updatedAt: new Date('2026-04-24T10:05:00.000Z'),
    source: 'establishment_mp_accounts',
  })

  assert.equal(summary.connected, true)
  assert.equal(summary.mp_user_id, '123456')
  assert.equal(summary.mp_collector_id, '123456')
  assert.equal(summary.public_key, 'APP_USR-123')
  assert.equal(summary.source, 'establishment_mp_accounts')
})

test('normalizeMercadoPagoSellerWebhookTopic maps preapproval aliases to subscription', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription_preapproval'), 'subscription')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription'), 'subscription')
})

test('normalizeMercadoPagoSellerWebhookTopic maps recurring charge aliases to automatic-payments', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('subscription_authorized_payment'), 'automatic-payments')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('automatic-payments'), 'automatic-payments')
})

test('normalizeMercadoPagoSellerWebhookTopic maps mp-connect aliases consistently', () => {
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('mp-connect'), 'mp-connect')
  assert.equal(normalizeMercadoPagoSellerWebhookTopic('mp_connect'), 'mp-connect')
})

test('buildMercadoPagoSellerWebhookDeliveryKey keeps owner and resource traceability', () => {
  const key = buildMercadoPagoSellerWebhookDeliveryKey({
    topic: 'payment',
    actionName: 'payment.updated',
    resourceId: 'pay_999',
    bodyUserId: 281768531,
    estabelecimentoId: 27,
  })

  assert.equal(key, 'seller:payment:payment.updated:pay_999:281768531:27')
})
