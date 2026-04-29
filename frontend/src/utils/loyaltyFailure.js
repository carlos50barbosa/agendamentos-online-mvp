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
  const messages = {
    cc_rejected_high_risk: 'A ultima tentativa de cobranca foi recusada por analise de risco do cartao.',
    cc_rejected_insufficient_amount: 'A ultima tentativa de cobranca foi recusada por saldo ou limite insuficiente.',
    cc_rejected_bad_filled_security_code: 'A ultima tentativa de cobranca foi recusada por dados do cartao invalidos.',
  }
  return messages[normalized] || normalizeValue(fallbackMessage) || ''
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
      title: 'Pagamento em analise',
      description: 'Estamos aguardando a revisao manual do Mercado Pago.',
      statusLabel: 'Pagamento em analise',
    }
  }

  if (statusKey === 'scheduled') {
    return {
      show: true,
      kind: 'scheduled',
      title: 'Cobranca agendada',
      description: 'Estamos aguardando a confirmacao do pagamento.',
      statusLabel: 'Cobranca agendada',
    }
  }

  if (PENDING_PAYMENT_STATUS_KEYS.has(statusKey) || PENDING_PAYMENT_DETAIL_KEYS.has(detailKey)) {
    return {
      show: true,
      kind: 'processing',
      title: 'Cobranca em processamento',
      description: 'Sua cobranca esta em processamento. Aguarde a confirmacao do pagamento.',
      statusLabel: 'Pagamento em processamento',
    }
  }

  if (subscriptionStatus === 'pending_payment' && paymentMethod === 'credit_card') {
    return {
      show: true,
      kind: 'pending_payment',
      title: 'Aguardando confirmacao do pagamento',
      description: 'A primeira cobranca sera confirmada pelo Mercado Pago.',
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

  return {
    showRecovery: Boolean(failure.technicalCode || retryOptions?.suggested),
    title: highRisk
      ? 'Nao foi possivel aprovar este cartao no momento.'
      : (failure.technicalCode ? 'Voce pode regularizar a assinatura.' : ''),
    description: highRisk
      ? 'Voce pode tentar outro cartao ou pagar por PIX. Por seguranca, novas tentativas com este cartao podem ficar indisponiveis por alguns minutos.'
      : (
        cardRetry?.message ||
        pixRetry?.message ||
        ''
      ),
    cardActionLabel: 'Tentar outro cartao',
    pixActionLabel: highRisk ? 'Pagar por PIX agora' : 'Pagar por PIX',
    cardCooldownActive: cardRetry?.cooldown_active === true,
    cardCooldownRemainingMs: Number(cardRetry?.cooldown_remaining_ms || 0) || 0,
    cardEnabled: cardRetry?.enabled !== false,
    pixEnabled: pixRetry?.enabled !== false,
  }
}
