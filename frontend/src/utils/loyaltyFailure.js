function normalizeValue(value) {
  return String(value || '').trim()
}

export function getLoyaltyFailureFriendlyMessage(code, fallbackMessage = null) {
  const normalized = normalizeValue(code).toLowerCase()
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
  const technicalCode = normalizeValue(
    details?.last_failure_code ||
    details?.subscription?.last_failure_code ||
    rawFailure?.code ||
    rawFailure?.status_detail
  ) || null
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
      ? 'Tente outro cartao ou pague por PIX.'
      : (
        cardRetry?.message ||
        pixRetry?.message ||
        ''
      ),
    cardActionLabel: 'Tentar outro cartao',
    pixActionLabel: 'Pagar por PIX',
    cardCooldownActive: cardRetry?.cooldown_active === true,
    cardCooldownRemainingMs: Number(cardRetry?.cooldown_remaining_ms || 0) || 0,
    cardEnabled: cardRetry?.enabled !== false,
    pixEnabled: pixRetry?.enabled !== false,
  }
}
