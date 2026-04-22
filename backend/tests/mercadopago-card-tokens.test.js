import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimMercadoPagoDisposableCardToken,
  resetMercadoPagoDisposableCardTokenRegistryForTests,
} from '../src/lib/mercadopago_card_tokens.js'

test.beforeEach(() => {
  resetMercadoPagoDisposableCardTokenRegistryForTests()
})

test.after(() => {
  resetMercadoPagoDisposableCardTokenRegistryForTests()
})

test('claimMercadoPagoDisposableCardToken blocks reuse across different operations with traceable metadata', () => {
  const token = 'tok_test_same_card_token_1234567890'

  const firstClaim = claimMercadoPagoDisposableCardToken({
    token,
    operation: 'card_subscription_update',
    endpoint: '/preapproval/preapp_123',
    environment: 'test',
    externalReference: 'subscription:266:update',
    subscriptionId: '266',
    preapprovalId: 'preapp_123',
    requestId: 'req-update-1',
  })

  assert.equal(firstClaim.registryEntry.operation, 'card_subscription_update')
  assert.equal(firstClaim.registryEntry.requestId, 'req-update-1')

  assert.throws(
    () => claimMercadoPagoDisposableCardToken({
      token,
      operation: 'card_recovery_payment',
      endpoint: '/v1/payments',
      environment: 'test',
      externalReference: 'subscription_recovery:sub:266:attempt:req-recover-1',
      subscriptionId: '266',
      preapprovalId: 'preapp_123',
      requestId: 'req-recover-1',
    }),
    (error) => {
      assert.equal(error?.code, 'card_token_already_consumed')
      assert.equal(error?.status, 409)
      assert.equal(error?.details?.retry_with_new_token, true)
      assert.equal(error?.details?.operation, 'card_recovery_payment')
      assert.equal(error?.details?.request_id, 'req-recover-1')
      assert.equal(error?.details?.subscription_id, '266')
      assert.equal(error?.details?.preapproval_id, 'preapp_123')
      assert.equal(error?.details?.external_reference, 'subscription_recovery:sub:266:attempt:req-recover-1')
      assert.equal(error?.details?.first_token_operation, 'card_subscription_update')
      assert.equal(error?.details?.first_token_request_id, 'req-update-1')
      assert.equal(error?.details?.first_token_subscription_id, '266')
      assert.equal(error?.details?.first_token_preapproval_id, 'preapp_123')
      assert.equal(error?.details?.first_token_external_reference, 'subscription:266:update')
      assert.equal(error?.details?.first_token_endpoint, '/preapproval/preapp_123')
      return true
    }
  )
})
