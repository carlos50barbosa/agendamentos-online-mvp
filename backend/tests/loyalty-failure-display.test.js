import test from 'node:test'
import assert from 'node:assert/strict'

const {
  getLoyaltyFailureFriendlyMessage,
  resolveLoyaltyFailureDisplay,
  resolveLoyaltyPaymentStateDisplay,
  resolveLoyaltyRetryDisplay,
} = await import('../../frontend/src/utils/loyaltyFailure.js')
const {
  LOYALTY_CARDHOLDER_NAME_FIELD,
  buildLoyaltyCardPaymentPayload,
  buildLoyaltyCardTokenSubmitContext,
  buildLoyaltyRiskContext,
  resolveLoyaltyCardholderName,
  validateLoyaltyCardTokenSubmitContext,
  validateLoyaltyCardPayerData,
} = await import('../../frontend/src/utils/loyaltyPaymentValidation.js')
const {
  getMercadoPagoCardErrorMessage,
  isMercadoPagoCardTokenRefreshRequired,
} = await import('../../frontend/src/utils/mercadoPagoCard.js')

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

test('loyalty card payer validation accepts complete names with flexible characters', () => {
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
    const result = validateLoyaltyCardPayerData({
      ...base,
      [LOYALTY_CARDHOLDER_NAME_FIELD]: name,
    })
    assert.equal(result.valid, true, name)
    assert.equal(result.normalized.cardholderName, expected)
    assert.equal(result.sourceFields.cardholderName, LOYALTY_CARDHOLDER_NAME_FIELD)
  }
})

test('loyalty card payer validation rejects a single holder name', () => {
  const result = validateLoyaltyCardPayerData({
    payerEmail: 'cliente@example.com',
    [LOYALTY_CARDHOLDER_NAME_FIELD]: 'Maria',
    identificationType: 'CPF',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  })

  assert.equal(result.valid, false)
  assert.equal(Boolean(result.errors.cardholder_name), true)
})

test('loyalty card payload uses the same holder-name key validated by the UI', () => {
  const payerValidation = validateLoyaltyCardPayerData({
    payerEmail: 'cliente@example.com',
    [LOYALTY_CARDHOLDER_NAME_FIELD]: '  Maria   Silva  ',
    identificationType: 'CPF',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  })
  const payload = buildLoyaltyCardPaymentPayload({
    estabelecimentoId: '26',
    loyaltyPlanId: '7',
    cardFormData: {
      token: 'card-token',
      paymentMethodId: 'visa',
      issuerId: '25',
    },
    payerValidation,
    riskContext: {
      mp_device_session_id: 'device-session-123',
    },
  })

  assert.equal(payload[LOYALTY_CARDHOLDER_NAME_FIELD], payerValidation.normalized.cardholderName)
  assert.equal(payload.cardholderName, undefined)
})

test('loyalty card payload carries safe submit-time token telemetry', () => {
  const payerValidation = validateLoyaltyCardPayerData({
    payerEmail: 'cliente@example.com',
    [LOYALTY_CARDHOLDER_NAME_FIELD]: 'Maria Silva',
    identificationType: 'CPF',
    identificationNumber: '529.982.247-25',
    payerPhone: '+55 (11) 98765-4321',
  })
  const payload = buildLoyaltyCardPaymentPayload({
    estabelecimentoId: '26',
    loyaltyPlanId: '7',
    cardFormData: {
      token: 'card-token',
      paymentMethodId: 'visa',
    },
    payerValidation,
    cardTokenContext: {
      cvvFieldPresent: true,
      tokenSource: 'cardform_submit',
      tokenGeneratedAtMs: Date.now(),
    },
  })

  assert.equal(payload.card_token, 'card-token')
  assert.equal(payload.cvv_field_present, true)
  assert.equal(payload.token_generated_at_submit, true)
  assert.equal(payload.card_token_source, 'cardform_submit')
  assert.equal(payload.risk_context.cvv_field_present, true)
  assert.equal(payload.security_code, undefined)
  assert.equal(payload.cvv, undefined)
})

test('loyalty card token submit validation blocks missing CVV tokenization', () => {
  const context = buildLoyaltyCardTokenSubmitContext({
    cardFormData: { token: '' },
    cvvFieldPresent: true,
    tokenSource: 'cardform_submit',
    tokenGeneratedAtMs: Date.now(),
  })
  const result = validateLoyaltyCardTokenSubmitContext(context)

  assert.equal(result.valid, false)
  assert.match(result.message, /c[oó]digo de seguran/i)
})

test('Mercado Pago CVV-validation token error forces a new card token in the frontend', () => {
  const error = {
    data: {
      error: 'card_token_without_cvv_validation',
      retry_with_new_token: true,
      details: {
        gateway_message: 'Card token was generated without CVV validation',
      },
    },
  }

  assert.equal(isMercadoPagoCardTokenRefreshRequired(error), true)
  assert.match(getMercadoPagoCardErrorMessage(error), /c[oó]digo de seguran/i)
})

test('loyalty cardholder resolver accepts SDK aliases before validation', () => {
  const resolved = resolveLoyaltyCardholderName({
    holder_name: "  João   D'Ávila  ",
  })

  assert.equal(resolved.normalized, "João D'Ávila")
  assert.equal(resolved.sourceField, 'holder_name')
  assert.equal(resolved.analysis.wordCount, 2)
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
