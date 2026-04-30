function normalizeValue(value) {
  return String(value || '').trim()
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value
  const normalized = normalizeValue(value).toLowerCase()
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true
  if (['false', '0', 'no', 'nao'].includes(normalized)) return false
  return false
}

function normalizeNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null
}

function normalizeSpaces(value) {
  return normalizeValue(value).replace(/\s+/g, ' ')
}

export const LOYALTY_CARDHOLDER_NAME_FIELD = 'cardholder_name'
export const LOYALTY_CARDHOLDER_NAME_FIELDS = [
  LOYALTY_CARDHOLDER_NAME_FIELD,
  'cardholderName',
  'payer_name',
  'payerName',
  'holder_name',
  'holderName',
  'name',
]

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

export function normalizeLoyaltyCardholderName(value) {
  return normalizeSpaces(value)
    .normalize('NFC')
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
}

function getNameParts(value) {
  return normalizeLoyaltyCardholderName(value).split(' ').filter(Boolean)
}

function isNameLikePart(part) {
  return /^\p{L}(?:[\p{L}\p{M}'-]*\p{L})?$/u.test(String(part || ''))
}

function isValidNameWord(part) {
  return isNameLikePart(part) && String(part || '').replace(/[-']/g, '').length >= 2
}

export function analyzeLoyaltyCardholderName(value) {
  const normalized = normalizeLoyaltyCardholderName(value)
  const parts = getNameParts(normalized)
  const validWordCount = parts.filter(isValidNameWord).length
  const invalidPartCount = parts.filter((part) => !isNameLikePart(part)).length
  return {
    normalized,
    length: normalized.length,
    partCount: parts.length,
    wordCount: validWordCount,
    invalidPartCount,
    valid: normalized.length >= 5 && parts.length >= 2 && validWordCount >= 2 && invalidPartCount === 0,
  }
}

function hasMeaningfulFullName(value) {
  return analyzeLoyaltyCardholderName(value).valid
}

export function resolveLoyaltyCardholderName(input = {}, fields = LOYALTY_CARDHOLDER_NAME_FIELDS) {
  const sourceField = fields.find((field) => normalizeLoyaltyCardholderName(input?.[field])) ||
    fields.find((field) => Object.prototype.hasOwnProperty.call(input || {}, field)) ||
    LOYALTY_CARDHOLDER_NAME_FIELD
  const analysis = analyzeLoyaltyCardholderName(input?.[sourceField])
  return {
    value: input?.[sourceField] || '',
    normalized: analysis.normalized,
    sourceField,
    fieldPresent: Boolean(analysis.normalized),
    analysis,
  }
}

export function getLoyaltyCardholderNameDebugInfo(input = {}) {
  const resolved = input?.analysis ? input : resolveLoyaltyCardholderName(input)
  return {
    field_present: Boolean(resolved.normalized),
    length: resolved.analysis?.length || 0,
    word_count: resolved.analysis?.wordCount || 0,
    source_field: resolved.sourceField || LOYALTY_CARDHOLDER_NAME_FIELD,
  }
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

export function validateLoyaltyCardPayerData(input = {}) {
  const {
    payerEmail = '',
    identificationType = '',
    identificationNumber = '',
    payerPhone = '',
  } = input || {}
  const cardholderNameInput = resolveLoyaltyCardholderName(input)
  const normalized = {
    payerEmail: normalizeValue(payerEmail).toLowerCase(),
    cardholderName: cardholderNameInput.normalized,
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
    sourceFields: {
      cardholderName: cardholderNameInput.sourceField,
    },
    debug: {
      cardholderName: getLoyaltyCardholderNameDebugInfo(cardholderNameInput),
    },
  }
}

export function buildLoyaltyCardPaymentPayload({
  estabelecimentoId,
  loyaltyPlanId,
  cardFormData = {},
  payerValidation = {},
  user = {},
  riskContext = {},
  cardTokenContext = {},
} = {}) {
  const normalized = payerValidation.normalized || {}
  const tokenContext = buildLoyaltyCardTokenSubmitContext({
    cardFormData,
    ...cardTokenContext,
  })
  return {
    estabelecimento_id: Number(estabelecimentoId),
    loyalty_plan_id: Number(loyaltyPlanId),
    card_token: cardFormData.token,
    payer_email: normalized.payerEmail,
    [LOYALTY_CARDHOLDER_NAME_FIELD]: normalized.cardholderName,
    payer_phone: normalized.payerPhone || user?.telefone || user?.phone || null,
    payment_method_id: cardFormData.paymentMethodId || null,
    issuer_id: cardFormData.issuerId || null,
    identification_type: normalized.identificationType || null,
    identification_number: normalized.identificationNumber || null,
    mp_device_session_id: riskContext.mp_device_session_id || null,
    card_token_source: tokenContext.tokenSource,
    token_generated_at_submit: tokenContext.tokenGeneratedAtSubmit,
    token_age_ms: tokenContext.tokenAgeMs,
    cvv_field_present: tokenContext.cvvFieldPresent,
    risk_context: {
      ...riskContext,
      card_token_source: tokenContext.tokenSource,
      token_generated_at_submit: tokenContext.tokenGeneratedAtSubmit,
      token_age_ms: tokenContext.tokenAgeMs,
      cvv_field_present: tokenContext.cvvFieldPresent,
    },
  }
}

export function buildLoyaltyCardTokenSubmitContext({
  cardFormData = {},
  submittedAtMs = Date.now(),
  tokenGeneratedAtMs = null,
  cvvFieldPresent = false,
  tokenSource = 'cardform_submit',
} = {}) {
  const token = normalizeValue(cardFormData?.token)
  const generatedAtMs = normalizeNonNegativeNumber(tokenGeneratedAtMs) || normalizeNonNegativeNumber(submittedAtMs) || Date.now()
  const ageMs = Math.max(0, Date.now() - generatedAtMs)
  const source = normalizeValue(tokenSource) || 'cardform_submit'
  return {
    cardTokenPresent: Boolean(token),
    cvvFieldPresent: normalizeBoolean(cvvFieldPresent),
    tokenGeneratedAtSubmit: Boolean(token && source === 'cardform_submit'),
    tokenAgeMs: ageMs,
    tokenSource: source,
  }
}

export function validateLoyaltyCardTokenSubmitContext(context = {}) {
  const normalized = {
    cardTokenPresent: Boolean(context.cardTokenPresent),
    cvvFieldPresent: normalizeBoolean(context.cvvFieldPresent),
    tokenGeneratedAtSubmit: normalizeBoolean(context.tokenGeneratedAtSubmit),
    tokenAgeMs: normalizeNonNegativeNumber(context.tokenAgeMs),
    tokenSource: normalizeValue(context.tokenSource) || 'unknown',
  }

  if (!normalized.cvvFieldPresent) {
    return {
      valid: false,
      message: 'N\u00e3o foi poss\u00edvel carregar o campo de c\u00f3digo de seguran\u00e7a do cart\u00e3o. Recarregue o formul\u00e1rio e tente novamente.',
      normalized,
    }
  }

  if (!normalized.cardTokenPresent || !normalized.tokenGeneratedAtSubmit || normalized.tokenSource !== 'cardform_submit') {
    return {
      valid: false,
      message: 'Informe novamente o c\u00f3digo de seguran\u00e7a do cart\u00e3o para gerar um novo token.',
      normalized,
    }
  }

  return {
    valid: true,
    message: '',
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
