function normalizeValue(value) {
  return String(value || '').trim()
}

function normalizeSpaces(value) {
  return normalizeValue(value).replace(/\s+/g, ' ')
}

function digitsOnly(value) {
  return normalizeValue(value).replace(/\D/g, '')
}

function isValidEmail(value) {
  const email = normalizeValue(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

function isValidCpf(value) {
  const cpf = digitsOnly(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i)
  let digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i)
  digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  return digit === Number(cpf[10])
}

function hasMeaningfulFullName(value) {
  const name = normalizeSpaces(value)
  const parts = name.split(' ').filter(Boolean)
  return name.length >= 5 && parts.length >= 2 && parts.every((part) => part.length >= 2)
}

function normalizeDocumentType(value) {
  return normalizeValue(value).toUpperCase()
}

function normalizePhone(value) {
  const digits = digitsOnly(value)
  if (!digits) return ''
  const normalized = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  return normalized.length >= 10 && normalized.length <= 11 ? normalized : ''
}

export function validateLoyaltyCardPayerData({
  payerEmail = '',
  cardholderName = '',
  identificationType = '',
  identificationNumber = '',
  payerPhone = '',
} = {}) {
  const normalized = {
    payerEmail: normalizeValue(payerEmail).toLowerCase(),
    cardholderName: normalizeSpaces(cardholderName),
    identificationType: normalizeDocumentType(identificationType),
    identificationNumber: digitsOnly(identificationNumber),
    payerPhone: normalizePhone(payerPhone),
  }
  const errors = {}
  const warnings = {}

  if (!isValidEmail(normalized.payerEmail)) {
    errors.payer_email = 'Informe um e-mail válido para a cobrança.'
  }
  if (!hasMeaningfulFullName(normalized.cardholderName)) {
    errors.cardholder_name = 'Informe o nome completo do titular do cartão.'
  }
  if (!normalized.identificationType) {
    errors.identification_type = 'Informe o tipo do documento do titular.'
  }
  if (!normalized.identificationNumber) {
    errors.identification_number = 'Informe o CPF do titular.'
  } else if (normalized.identificationType === 'CPF' && !isValidCpf(normalized.identificationNumber)) {
    errors.identification_number = 'Informe um CPF válido para o titular.'
  } else if (normalized.identificationType !== 'CPF' && normalized.identificationNumber.length < 5) {
    errors.identification_number = 'Informe um documento válido para o titular.'
  }
  if (!normalized.payerPhone) {
    warnings.payer_phone = 'Telefone ausente no contexto do pagador.'
  }

  const firstError = Object.values(errors)[0] || ''
  return {
    valid: !Object.keys(errors).length,
    message: firstError,
    errors,
    warnings,
    normalized,
  }
}

export function getMercadoPagoDeviceSessionId() {
  if (typeof window === 'undefined') return ''
  const documentDeviceId = typeof document !== 'undefined'
    ? document.getElementById?.('deviceId')?.value
    : ''
  return normalizeValue(
    window.MP_DEVICE_SESSION_ID ||
    window.deviceId ||
    documentDeviceId ||
    ''
  )
}

export function buildLoyaltyRiskContext(extra = {}) {
  const deviceSessionId = getMercadoPagoDeviceSessionId()
  const nav = typeof window !== 'undefined' ? window.navigator || {} : {}
  const screen = typeof window !== 'undefined' ? window.screen || {} : {}
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    } catch {
      return ''
    }
  })()

  return {
    ...extra,
    mp_device_session_id: deviceSessionId || null,
    user_agent: normalizeValue(nav.userAgent),
    language: normalizeValue(nav.language),
    timezone: normalizeValue(timezone),
    screen_width: Number(screen.width || 0) || null,
    screen_height: Number(screen.height || 0) || null,
    device_memory: Number(nav.deviceMemory || 0) || null,
    hardware_concurrency: Number(nav.hardwareConcurrency || 0) || null,
  }
}
