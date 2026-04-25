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
