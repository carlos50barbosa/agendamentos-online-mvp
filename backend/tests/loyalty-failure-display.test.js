import test from 'node:test'
import assert from 'node:assert/strict'

const {
  getLoyaltyFailureFriendlyMessage,
  resolveLoyaltyFailureDisplay,
  resolveLoyaltyRetryDisplay,
} = await import('../../frontend/src/utils/loyaltyFailure.js')

test('loyalty failure display keeps subscription status separate from technical failure code', () => {
  const display = resolveLoyaltyFailureDisplay({
    subscription: {
      status: 'past_due',
    },
    last_failure_code: 'cc_rejected_high_risk',
    last_failure_message: 'A ultima tentativa de cobranca foi recusada por analise de risco do cartao.',
    last_failure_at: '2026-04-25T08:00:00.000Z',
    latest_failure: {
      payment_method_id: 'master',
    },
  })

  assert.equal(display.subscriptionStatus, 'past_due')
  assert.equal(display.technicalCode, 'cc_rejected_high_risk')
  assert.equal(display.technicalMessage, 'A ultima tentativa de cobranca foi recusada por analise de risco do cartao.')
  assert.equal(display.occurredAt, '2026-04-25T08:00:00.000Z')
})

test('loyalty failure display falls back to mapped friendly message when backend only sends technical code', () => {
  assert.equal(
    getLoyaltyFailureFriendlyMessage('cc_rejected_insufficient_amount'),
    'A ultima tentativa de cobranca foi recusada por saldo ou limite insuficiente.'
  )

  const display = resolveLoyaltyFailureDisplay({
    subscription_status: 'past_due',
    latest_failure: {
      status_detail: 'cc_rejected_insufficient_amount',
    },
  })

  assert.equal(display.subscriptionStatus, 'past_due')
  assert.equal(display.technicalCode, 'cc_rejected_insufficient_amount')
  assert.equal(display.technicalMessage, 'A ultima tentativa de cobranca foi recusada por saldo ou limite insuficiente.')
})

test('loyalty retry display exposes PIX fallback for high risk declines', () => {
  const display = resolveLoyaltyRetryDisplay({
    subscription_status: 'past_due',
    last_failure_code: 'cc_rejected_high_risk',
    retry_options: {
      suggested: true,
      card: {
        enabled: false,
        cooldown_active: true,
        cooldown_remaining_ms: 1800000,
      },
      pix: {
        enabled: true,
      },
    },
  })

  assert.equal(display.showRecovery, true)
  assert.equal(display.title, 'Nao foi possivel aprovar este cartao no momento.')
  assert.equal(display.description, 'Tente outro cartao ou pague por PIX.')
  assert.equal(display.cardCooldownActive, true)
  assert.equal(display.pixEnabled, true)
})
