import test from 'node:test'
import assert from 'node:assert/strict'

const {
  getLoyaltyFailureFriendlyMessage,
  resolveLoyaltyFailureDisplay,
  resolveLoyaltyPaymentStateDisplay,
  resolveLoyaltyRetryDisplay,
} = await import('../../frontend/src/utils/loyaltyFailure.js')
const {
  buildLoyaltyRiskContext,
  validateLoyaltyCardPayerData,
} = await import('../../frontend/src/utils/loyaltyPaymentValidation.js')

test('loyalty failure display keeps subscription status separate from technical failure code', () => {
  const display = resolveLoyaltyFailureDisplay({
    subscription: {
      status: 'past_due',
    },
    last_failure_code: 'cc_rejected_high_risk',
    last_failure_message: 'A última tentativa de cobrança foi recusada por análise de risco do cartão.',
    last_failure_at: '2026-04-25T08:00:00.000Z',
    latest_failure: {
      payment_method_id: 'master',
    },
  })

  assert.equal(display.subscriptionStatus, 'past_due')
  assert.equal(display.technicalCode, 'cc_rejected_high_risk')
  assert.equal(display.technicalMessage, 'A última tentativa de cobrança foi recusada por análise de risco do cartão.')
  assert.equal(display.occurredAt, '2026-04-25T08:00:00.000Z')
})

test('loyalty failure display falls back to mapped friendly message when backend only sends technical code', () => {
  assert.equal(
    getLoyaltyFailureFriendlyMessage('cc_rejected_insufficient_amount'),
    'A última tentativa de cobrança foi recusada por saldo ou limite insuficiente.'
  )

  const display = resolveLoyaltyFailureDisplay({
    subscription_status: 'past_due',
    latest_failure: {
      status_detail: 'cc_rejected_insufficient_amount',
    },
  })

  assert.equal(display.subscriptionStatus, 'past_due')
  assert.equal(display.technicalCode, 'cc_rejected_insufficient_amount')
  assert.equal(display.technicalMessage, 'A última tentativa de cobrança foi recusada por saldo ou limite insuficiente.')
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
  assert.equal(display.title, 'Não foi possível aprovar este cartão no momento.')
  assert.equal(display.description, 'Você pode tentar outro cartão ou pagar por PIX. Por segurança, novas tentativas com este cartão podem ficar indisponíveis por alguns minutos.')
  assert.equal(display.cardCooldownActive, true)
  assert.equal(display.pixEnabled, true)
  assert.equal(display.pixActionLabel, 'Pagar por PIX agora')
})

test('loyalty failure display does not show manual review as technical failure', () => {
  const display = resolveLoyaltyFailureDisplay({
    subscription_status: 'pending_payment',
    latest_failure: {
      status: 'in-process',
      status_detail: 'pending_review_manual',
      friendly_message: 'Pagamento em análise.',
    },
  })

  assert.equal(display.subscriptionStatus, 'pending_payment')
  assert.equal(display.technicalCode, null)
  assert.equal(display.technicalMessage, '')
})

test('loyalty payment state display describes manual review and scheduled payments', () => {
  const review = resolveLoyaltyPaymentStateDisplay({
    subscription: {
      status: 'pending_payment',
      payment_method: 'credit_card',
      latest_payment_snapshot: {
        status: 'in-process',
        status_detail: 'pending_review_manual',
      },
    },
  })

  assert.equal(review.show, true)
  assert.equal(review.kind, 'pending_review')
  assert.equal(review.statusLabel, 'Pagamento em análise')

  const scheduled = resolveLoyaltyPaymentStateDisplay({
    subscription_status: 'pending_payment',
    latest_payment_snapshot: {
      status: 'scheduled',
      status_detail: null,
    },
  })

  assert.equal(scheduled.show, true)
  assert.equal(scheduled.kind, 'scheduled')
  assert.equal(scheduled.statusLabel, 'Cobrança agendada')
})

test('loyalty payment state display keeps real expiration separate from pending payment states', () => {
  const display = resolveLoyaltyPaymentStateDisplay({
    subscription: {
      status: 'expired',
      payment_method: 'credit_card',
    },
    latest_payment_snapshot: {
      status: 'expired',
      status_detail: null,
    },
  })

  assert.equal(display.show, false)
  assert.equal(display.statusLabel, '')
})

test('loyalty card payer validation blocks weak UI data before gateway retry', () => {
  const invalid = validateLoyaltyCardPayerData({
    payerEmail: 'cliente',
    cardholderName: 'Jo',
    identificationType: 'CPF',
    identificationNumber: '111.111.111-11',
  })

  assert.equal(invalid.valid, false)
  assert.equal(Boolean(invalid.errors.payer_email), true)
  assert.equal(Boolean(invalid.errors.cardholder_name), true)
  assert.equal(Boolean(invalid.errors.identification_number), true)
})

test('loyalty risk context captures Mercado Pago device session id when available', () => {
  const previousWindow = global.window
  const previousDocument = global.document
  global.window = {
    MP_DEVICE_SESSION_ID: 'device-session-123',
    navigator: {
      userAgent: 'node-test-agent',
      language: 'pt-BR',
      deviceMemory: 8,
      hardwareConcurrency: 4,
    },
    screen: {
      width: 1440,
      height: 900,
    },
  }
  global.document = { getElementById: () => null }

  const context = buildLoyaltyRiskContext({ payment_method: 'credit_card' })

  assert.equal(context.mp_device_session_id, 'device-session-123')
  assert.equal(context.payment_method, 'credit_card')
  assert.equal(context.user_agent, 'node-test-agent')
  assert.equal(context.screen_width, 1440)

  global.window = previousWindow
  global.document = previousDocument
})
