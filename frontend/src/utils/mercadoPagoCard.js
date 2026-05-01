function getErrorCode(error) {
  return String(error?.data?.error || error?.code || '').trim().toLowerCase()
}

function normalizeErrorText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getStatusDetail(error) {
  return String(
    error?.data?.payment_result?.status_detail ||
    error?.data?.details?.status_detail ||
    error?.data?.details?.gateway_cause_code ||
    ''
  ).trim().toLowerCase()
}

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

function normalizeNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return 0
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0
}

export const CLIENT_LOYALTY_MP_CARD_FORM_IDS = Object.freeze({
  form: 'client-loyalty-card-form',
  cardNumber: 'client-loyalty-card-number',
  expirationDate: 'client-loyalty-card-expiration',
  securityCode: 'client-loyalty-card-cvv',
  cardholderName: 'client-loyalty-card-holder',
  issuer: 'client-loyalty-card-issuer',
  installments: 'client-loyalty-card-installments',
  identificationType: 'client-loyalty-card-doc-type',
  identificationNumber: 'client-loyalty-card-doc-number',
  cardholderEmail: 'client-loyalty-card-email',
})

export const CLIENT_LOYALTY_MP_CARD_FORM_FIELD_KEYS = Object.freeze([
  'cardNumber',
  'expirationDate',
  'securityCode',
  'cardholderName',
  'issuer',
  'installments',
  'identificationType',
  'identificationNumber',
  'cardholderEmail',
])

export function buildClientLoyaltyMercadoPagoCardFormConfig({
  amount,
  callbacks = {},
} = {}) {
  return {
    amount,
    iframe: true,
    form: {
      id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.form,
      cardNumber: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.cardNumber, placeholder: 'Numero do cartao' },
      expirationDate: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.expirationDate, placeholder: 'MM/AA' },
      securityCode: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.securityCode, placeholder: 'CVV' },
      cardholderName: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.cardholderName, placeholder: 'Titular do cartao' },
      issuer: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.issuer, placeholder: 'Banco emissor' },
      installments: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.installments, placeholder: 'Parcelas' },
      identificationType: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.identificationType, placeholder: 'Documento' },
      identificationNumber: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.identificationNumber, placeholder: 'Numero do documento' },
      cardholderEmail: { id: CLIENT_LOYALTY_MP_CARD_FORM_IDS.cardholderEmail, placeholder: 'E-mail' },
    },
    callbacks,
  }
}

function getElementById(id) {
  if (typeof document === 'undefined' || !id) return null
  return document.getElementById(id)
}

function queryAll(selector) {
  if (typeof document === 'undefined') return []
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    return []
  }
}

export function getMercadoPagoHiddenCardToken(formId = CLIENT_LOYALTY_MP_CARD_FORM_IDS.form) {
  const form = getElementById(formId)
  const tokenInput = form?.querySelector?.('input[name="MPHiddenInputToken"]') ||
    queryAll(`#${formId} input[name="MPHiddenInputToken"]`)[0] ||
    queryAll('input[name="MPHiddenInputToken"]')[0]
  return typeof tokenInput?.value === 'string' ? tokenInput.value.trim() : ''
}

export function clearMercadoPagoHiddenCardTokens(formId = CLIENT_LOYALTY_MP_CARD_FORM_IDS.form) {
  const form = getElementById(formId)
  const scoped = form?.querySelectorAll
    ? Array.from(form.querySelectorAll('input[name="MPHiddenInputToken"]'))
    : []
  const global = queryAll('input[name="MPHiddenInputToken"]')
  const targets = [...new Set([...scoped, ...global])]
  for (const target of targets) {
    try {
      target.remove?.()
    } catch {
      if ('value' in target) target.value = ''
    }
  }
  return targets.length
}

export function getMercadoPagoCardFormBindingDiagnostics({
  formConfig = null,
  formId = CLIENT_LOYALTY_MP_CARD_FORM_IDS.form,
} = {}) {
  const configForm = formConfig?.form || {}
  const securityCodeFieldId = String(configForm.securityCode?.id || CLIENT_LOYALTY_MP_CARD_FORM_IDS.securityCode)
  const configuredFields = CLIENT_LOYALTY_MP_CARD_FORM_FIELD_KEYS.filter((field) => configForm?.[field]?.id)
  const securityElement = getElementById(securityCodeFieldId)
  const securityIframePresent = Boolean(securityElement?.querySelector?.('iframe'))
  const securityInputValuePresent = typeof securityElement?.value === 'string'
    ? Boolean(securityElement.value.trim())
    : false
  return {
    cvv_field_present: Boolean(securityElement),
    cvv_dom_value_present: securityInputValuePresent,
    cvv_field_bound_to_mp_form: Boolean(
      formConfig?.iframe === true &&
      configuredFields.includes('securityCode') &&
      securityElement &&
      securityIframePresent
    ),
    token_from_mp_sdk_submit: false,
    mp_cardform_fields_configured: configuredFields,
    security_code_field_id: securityCodeFieldId,
    security_code_iframe_present: securityIframePresent,
    form_id: String(configForm.id || formId),
  }
}

export function buildClientLoyaltyMercadoPagoCardSubmitContext({
  cardFormData = {},
  bindingDiagnostics = {},
  submittedAtMs = Date.now(),
  tokenGeneratedAtMs = Date.now(),
  hiddenTokenBeforeSubmit = '',
  hiddenTokenAfterSubmit = '',
  hiddenTokensCleared = 0,
  previousSubmittedToken = '',
  retryWithNewToken = false,
} = {}) {
  const token = normalizeValue(cardFormData?.token)
  const hiddenTokenBefore = normalizeValue(hiddenTokenBeforeSubmit)
  const hiddenTokenAfter = normalizeValue(hiddenTokenAfterSubmit)
  const previousToken = normalizeValue(previousSubmittedToken)
  const hiddenTokenReused = Boolean(token && hiddenTokenBefore && token === hiddenTokenBefore)
  const previousSubmittedTokenReused = Boolean(token && previousToken && token === previousToken)
  const cvvFieldBoundToMpForm = normalizeBoolean(bindingDiagnostics.cvv_field_bound_to_mp_form)
  const tokenFromMpSdkSubmit = Boolean(
    token &&
    cvvFieldBoundToMpForm &&
    !hiddenTokenReused &&
    !previousSubmittedTokenReused
  )
  const tokenSource = tokenFromMpSdkSubmit
    ? 'cardform_submit'
    : hiddenTokenReused
      ? 'hidden_token_before_submit'
      : previousSubmittedTokenReused
        ? 'previous_submit_token'
        : token
          ? 'cardform_submit_unverified'
          : 'unknown'

  return {
    submittedAtMs,
    tokenGeneratedAtMs,
    cvvFieldPresent: normalizeBoolean(bindingDiagnostics.cvv_field_present),
    cvvDomValuePresent: normalizeBoolean(bindingDiagnostics.cvv_dom_value_present),
    cvvFieldBoundToMpForm,
    securityCodeIframePresent: normalizeBoolean(bindingDiagnostics.security_code_iframe_present),
    tokenFromMpSdkSubmit,
    mpCardformFieldsConfigured: Array.isArray(bindingDiagnostics.mp_cardform_fields_configured)
      ? bindingDiagnostics.mp_cardform_fields_configured
      : [],
    securityCodeFieldId: normalizeValue(bindingDiagnostics.security_code_field_id),
    tokenSource,
    hiddenTokenPresentBeforeSubmit: Boolean(hiddenTokenBefore),
    hiddenTokenPresentAfterSubmit: Boolean(hiddenTokenAfter),
    hiddenTokensCleared: normalizeNonNegativeInteger(hiddenTokensCleared),
    hiddenTokenReused,
    previousSubmittedTokenReused,
    retryWithNewToken: normalizeBoolean(retryWithNewToken),
  }
}

export function waitForMercadoPagoCardFormBindingDiagnostics({
  formConfig = null,
  formId = CLIENT_LOYALTY_MP_CARD_FORM_IDS.form,
  timeoutMs = 2500,
  intervalMs = 100,
} = {}) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const diagnostics = getMercadoPagoCardFormBindingDiagnostics({ formConfig, formId })
      if (
        diagnostics.cvv_field_bound_to_mp_form ||
        (Date.now() - startedAt) >= Number(timeoutMs || 0)
      ) {
        resolve(diagnostics)
        return
      }
      setTimeout(check, Number(intervalMs || 100) || 100)
    }
    check()
  })
}

export function isMercadoPagoCardTokenRefreshRequired(error) {
  const code = getErrorCode(error)
  if ([
    'card_token_refresh_required',
    'card_token_already_consumed',
    'card_token_invalid_format',
    'card_token_required',
    'card_token_without_cvv_validation',
  ].includes(code)) {
    return true
  }

  if (error?.data?.retry_with_new_token === true) return true
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
    message.includes('without cvv validation') ||
    message.includes('sem validacao de cvv') ||
    message.includes('token do cartao')
  )
}

export function getMercadoPagoCardErrorMessage(error, fallback = 'Não foi possível processar o cartão.') {
  if (getErrorCode(error) === 'card_token_without_cvv_validation') {
    return 'Informe novamente o c\u00f3digo de seguran\u00e7a do cart\u00e3o.'
  }

  if (isMercadoPagoCardTokenRefreshRequired(error)) {
    return 'Os dados do cartão precisam ser confirmados novamente para gerar um novo token de segurança.'
  }

  if (getErrorCode(error) === 'client_loyalty_card_retry_cooldown') {
    return error?.data?.message || 'Não foi possível aprovar este cartão no momento. Tente PIX ou aguarde antes de tentar novamente.'
  }

  if (getStatusDetail(error) === 'cc_rejected_high_risk') {
    return 'Não foi possível aprovar este cartão no momento. Revise os dados do titular ou tente outro cartão.'
  }

  return error?.data?.message || error?.message || fallback
}
