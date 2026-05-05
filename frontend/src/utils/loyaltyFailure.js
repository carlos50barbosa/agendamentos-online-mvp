function normalizeValue(value) {
  return String(value || '').trim()
}

function normalizeKey(value) {
  return normalizeValue(value).toLowerCase().replace(/-/g, '_')
}

const PENDING_PAYMENT_STATUS_KEYS = new Set([
  'scheduled',
  'pending',
  'pending_payment',
  'in_process',
  'processing',
  'authorized',
  'created',
])

const PENDING_PAYMENT_DETAIL_KEYS = new Set([
  'pending_review_manual',
  'pending_contingency',
  'offline_process',
  'deferred_retry',
  'pending_capture',
])

function isRealFailureCode(value) {
  const key = normalizeKey(value)
  if (!key || PENDING_PAYMENT_DETAIL_KEYS.has(key)) return false
  return key.startsWith('cc_rejected') || key.startsWith('rejected_')
}

export function getLoyaltyFailureFriendlyMessage(code, fallbackMessage = null) {
  const normalized = normalizeKey(code)
  if (normalized === 'cc_rejected_high_risk') {
    return 'Não foi possível aprovar este cartão no momento. Você pode tentar outro cartão ou pagar por PIX.'
  }
  const messages = {
    cc_rejected_high_risk: 'A última tentativa de cobrança foi recusada por análise de risco do cartão.',
    cc_rejected_insufficient_amount: 'A última tentativa de cobrança foi recusada por saldo ou limite insuficiente.',
    cc_rejected_bad_filled_security_code: 'A última tentativa de cobrança foi recusada por dados do cartão inválidos.',
  }
  return messages[normalized] || normalizeValue(fallbackMessage) || ''
}

function getHighRiskRetryMessage(count = 1) {
  const safeCount = Number(count || 0) || 1
  if (safeCount >= 3) {
    return 'Por segurança, novas tentativas com este cartão foram pausadas. Atualize o cartão ou pague por PIX para manter sua assinatura ativa.'
  }
  if (safeCount >= 2) {
    return 'Este cartão continua sendo recusado por análise de segurança. Recomendamos pagar por PIX ou usar outro cartão.'
  }
  return 'Não foi possível aprovar este cartão no momento. Você pode tentar outro cartão ou pagar por PIX.'
}

export function resolveLoyaltyFailureDisplay(details = null) {
  const subscriptionStatus = normalizeValue(
    details?.subscription?.status ||
    details?.subscription_status
  ).toLowerCase() || null
  const rawFailure = details?.latest_failure || null
  const rawTechnicalCode = normalizeValue(
    details?.last_failure_code ||
    details?.subscription?.last_failure_code ||
    rawFailure?.code ||
    rawFailure?.status_detail
  ) || null
  const technicalCode = isRealFailureCode(rawTechnicalCode) ? rawTechnicalCode : null
  const technicalMessage = normalizeValue(
    details?.last_failure_message ||
    details?.subscription?.last_failure_message ||
    details?.last_failure_gateway_message ||
    details?.subscription?.last_failure_gateway_message ||
    rawFailure?.message ||
    rawFailure?.description ||
    rawFailure?.friendly_message
  ) || null
  const occurredAt = (
    details?.last_failure_at ||
    details?.subscription?.last_failure_at ||
    rawFailure?.created_at ||
    null
  )
  const source = normalizeValue(
    details?.last_failure_source ||
    details?.subscription?.last_failure_source ||
    rawFailure?.source
  ) || null

  return {
    subscriptionStatus,
    technicalCode,
    technicalMessage: technicalCode
      ? (technicalMessage || getLoyaltyFailureFriendlyMessage(technicalCode))
      : '',
    occurredAt,
    source,
    raw: rawFailure,
  }
}

export function resolveLoyaltyPaymentStateDisplay(details = null) {
  const latestPayment =
    details?.latest_payment_snapshot ||
    details?.subscription?.latest_payment_snapshot ||
    null
  const subscriptionStatus = normalizeKey(
    details?.subscription?.status ||
    details?.subscription_status
  ) || null
  const paymentMethod = normalizeKey(details?.subscription?.payment_method)
  const statusKey = normalizeKey(latestPayment?.status)
  const detailKey = normalizeKey(latestPayment?.status_detail)

  if (detailKey === 'pending_review_manual') {
    return {
      show: true,
      kind: 'pending_review',
      title: 'Pagamento em análise',
      description: 'Estamos aguardando a revisão manual do Mercado Pago.',
      statusLabel: 'Pagamento em análise',
    }
  }

  if (statusKey === 'scheduled') {
    return {
      show: true,
      kind: 'scheduled',
      title: 'Cobrança agendada',
      description: 'Estamos aguardando a confirmação do pagamento.',
      statusLabel: 'Cobrança agendada',
    }
  }

  if (PENDING_PAYMENT_STATUS_KEYS.has(statusKey) || PENDING_PAYMENT_DETAIL_KEYS.has(detailKey)) {
    return {
      show: true,
      kind: 'processing',
      title: 'Cobrança em processamento',
      description: 'Sua cobrança está em processamento. Aguarde a confirmação do pagamento.',
      statusLabel: 'Pagamento em processamento',
    }
  }

  if (subscriptionStatus === 'pending_payment' && paymentMethod === 'credit_card') {
    return {
      show: true,
      kind: 'pending_payment',
      title: 'Aguardando confirmação do pagamento',
      description: 'A primeira cobrança será confirmada pelo Mercado Pago.',
      statusLabel: 'Aguardando pagamento',
    }
  }

  return {
    show: false,
    kind: null,
    title: '',
    description: '',
    statusLabel: '',
  }
}

export function resolveLoyaltyRetryDisplay(details = null) {
  const failure = resolveLoyaltyFailureDisplay(details)
  const retryOptions = details?.retry_options || details?.subscription?.retry_options || null
  const cardRetry = retryOptions?.card || null
  const pixRetry = retryOptions?.pix || null
  const highRisk = failure.technicalCode === 'cc_rejected_high_risk'
  const highRiskCount = Number(
    retryOptions?.high_risk_consecutive_count ||
      cardRetry?.high_risk_consecutive_count ||
      details?.high_risk_consecutive_failures ||
      details?.subscription?.high_risk_consecutive_failures ||
      0
  ) || (highRisk ? 1 : 0)
  const highRiskMessage = highRisk ? getHighRiskRetryMessage(highRiskCount) : ''

  if (highRisk) {
    return {
      showRecovery: true,
      title: highRiskMessage,
      description: '',
      cardActionLabel: highRiskCount >= 3 ? 'Atualizar cartão' : 'Tentar outro cartão',
      pixActionLabel: 'Pagar por PIX agora',
      cardCooldownActive: cardRetry?.cooldown_active === true || cardRetry?.same_card_cooldown_active === true,
      cardAttemptLimitActive: cardRetry?.cooldown_active === true,
      sameCardCooldownActive: cardRetry?.same_card_cooldown_active === true,
      cardCooldownRemainingMs: Number(
        cardRetry?.cooldown_remaining_ms ||
          cardRetry?.same_card_cooldown_remaining_ms ||
          0
      ) || 0,
      sameCardCooldownRemainingMs: Number(cardRetry?.same_card_cooldown_remaining_ms || 0) || 0,
      cardEnabled: cardRetry?.enabled !== false,
      pixEnabled: pixRetry?.enabled !== false,
      highRiskConsecutiveCount: highRiskCount,
      paymentMethodActionRequired: retryOptions?.high_risk_action_required === true || cardRetry?.action_required === true,
    }
  }

  return {
    showRecovery: Boolean(failure.technicalCode || retryOptions?.suggested),
    title: highRisk
      ? 'Não foi possível aprovar este cartão no momento.'
      : (failure.technicalCode ? 'Você pode regularizar a assinatura.' : ''),
    description: highRisk
      ? 'Você pode tentar outro cartão ou pagar por PIX. Por segurança, novas tentativas com este cartão podem ficar indisponíveis por alguns minutos.'
      : (
        cardRetry?.message ||
        pixRetry?.message ||
        ''
      ),
    cardActionLabel: 'Tentar outro cartão',
    pixActionLabel: highRisk ? 'Pagar por PIX agora' : 'Pagar por PIX',
    cardCooldownActive: cardRetry?.cooldown_active === true,
    cardCooldownRemainingMs: Number(cardRetry?.cooldown_remaining_ms || 0) || 0,
    cardEnabled: cardRetry?.enabled !== false,
    pixEnabled: pixRetry?.enabled !== false,
  }
}
