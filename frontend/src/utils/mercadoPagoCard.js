function getErrorCode(error) {
  return String(error?.data?.error || error?.code || '').trim().toLowerCase()
}

function normalizeErrorText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function isMercadoPagoCardTokenRefreshRequired(error) {
  const code = getErrorCode(error)
  if ([
    'card_token_refresh_required',
    'card_token_already_consumed',
    'card_token_invalid_format',
    'card_token_required',
  ].includes(code)) {
    return true
  }

  if (error?.data?.details?.retry_with_new_token === true) return true

  const message = normalizeErrorText(
    [
      error?.data?.message,
      error?.message,
      error?.data?.details?.gateway_message,
      error?.data?.details?.gateway_cause_description,
    ]
      .filter(Boolean)
      .join(' ')
  )

  return (
    message.includes('invalid card_token_id') ||
    message.includes('token do cartao')
  )
}

export function getMercadoPagoCardErrorMessage(error, fallback = 'Não foi possível processar o cartão.') {
  if (isMercadoPagoCardTokenRefreshRequired(error)) {
    return 'Os dados do cartão precisam ser informados novamente para gerar um novo token.'
  }
  return error?.data?.message || error?.message || fallback
}
