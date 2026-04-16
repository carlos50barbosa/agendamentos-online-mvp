import { createHash } from 'node:crypto'

const CARD_TOKEN_USAGE_TTL_MS = 8 * 24 * 60 * 60 * 1000
const CARD_TOKEN_USAGE_MAX_ENTRIES = 20000
const CARD_TOKEN_REDACTED = '[REDACTED_CARD_TOKEN]'
const CARD_NUMBER_REDACTED = '[REDACTED_CARD_NUMBER]'
const CVV_REDACTED = '[REDACTED_CVV]'
const disposableCardTokenRegistry = new Map()

function nowIso() {
  return new Date().toISOString()
}

function hashCardToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function pruneDisposableCardTokenRegistry(nowMs = Date.now()) {
  if (!disposableCardTokenRegistry.size) return

  for (const [key, entry] of disposableCardTokenRegistry.entries()) {
    if ((nowMs - Number(entry?.claimedAtMs || 0)) > CARD_TOKEN_USAGE_TTL_MS) {
      disposableCardTokenRegistry.delete(key)
    }
  }

  if (disposableCardTokenRegistry.size <= CARD_TOKEN_USAGE_MAX_ENTRIES) return

  const oldestEntries = [...disposableCardTokenRegistry.entries()]
    .sort((a, b) => Number(a[1]?.claimedAtMs || 0) - Number(b[1]?.claimedAtMs || 0))

  const overflow = disposableCardTokenRegistry.size - CARD_TOKEN_USAGE_MAX_ENTRIES
  for (let index = 0; index < overflow; index += 1) {
    const key = oldestEntries[index]?.[0]
    if (key) disposableCardTokenRegistry.delete(key)
  }
}

export function normalizeMercadoPagoCardToken(value) {
  return String(value || '').trim()
}

export function maskMercadoPagoCardToken(value) {
  const token = normalizeMercadoPagoCardToken(value)
  if (!token) return null
  if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-1)}`
  return `${token.slice(0, 6)}...${token.slice(-4)}`
}

export function isLikelyMercadoPagoCardToken(value) {
  const token = normalizeMercadoPagoCardToken(value)
  if (!token) return false
  if (/\s/.test(token)) return false
  return token.length >= 16 && token.length <= 256
}

export function buildMercadoPagoCardTokenMeta(token) {
  const normalized = normalizeMercadoPagoCardToken(token)
  return {
    card_token_present: Boolean(normalized),
    card_token_length: normalized ? normalized.length : 0,
    card_token_masked: maskMercadoPagoCardToken(normalized),
  }
}

export function classifyMercadoPagoCredentialEnvironment(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return 'missing'
  if (normalized.startsWith('TEST-')) return 'test'
  if (normalized.startsWith('APP_USR-') || normalized.startsWith('APP-')) return 'production'
  return 'unknown'
}

export function getMercadoPagoCredentialDiagnostics({ publicKey = null, accessToken = null } = {}) {
  const publicKeyEnvironment = classifyMercadoPagoCredentialEnvironment(publicKey)
  const accessTokenEnvironment = classifyMercadoPagoCredentialEnvironment(accessToken)
  const hasBoth = publicKeyEnvironment !== 'missing' && accessTokenEnvironment !== 'missing'
  const consistentEnvironment = hasBoth
    ? publicKeyEnvironment === accessTokenEnvironment
    : null

  return {
    public_key_present: publicKeyEnvironment !== 'missing',
    access_token_present: accessTokenEnvironment !== 'missing',
    public_key_environment: publicKeyEnvironment,
    access_token_environment: accessTokenEnvironment,
    consistent_environment: consistentEnvironment,
  }
}

export function createMercadoPagoCardFlowError(code, message, { status = 400, details = null, cause = null } = {}) {
  const error = new Error(message)
  error.code = code
  error.status = status
  if (details) error.details = details
  if (cause) error.cause = cause
  return error
}

export function buildMercadoPagoCardOperationLog({
  operation,
  endpoint,
  environment = 'unknown',
  token = null,
  externalReference = null,
  subscriptionId = null,
  preapprovalId = null,
  requestId = null,
  alreadyUsedInProcess = false,
  firstUsage = null,
} = {}) {
  return {
    operation: operation || null,
    mp_endpoint: endpoint || null,
    mp_environment: environment || 'unknown',
    external_reference: externalReference || null,
    subscription_id: subscriptionId || null,
    preapproval_id: preapprovalId || null,
    request_id: requestId || null,
    timestamp: nowIso(),
    card_token_already_used_in_process: Boolean(alreadyUsedInProcess),
    first_token_operation: firstUsage?.operation || null,
    first_token_request_id: firstUsage?.requestId || null,
    first_token_external_reference: firstUsage?.externalReference || null,
    first_token_claimed_at: firstUsage?.claimedAt || null,
    ...buildMercadoPagoCardTokenMeta(token),
  }
}

export function claimMercadoPagoDisposableCardToken({
  token,
  operation,
  endpoint,
  environment = 'unknown',
  externalReference = null,
  subscriptionId = null,
  preapprovalId = null,
  requestId = null,
} = {}) {
  const normalized = normalizeMercadoPagoCardToken(token)
  const baseLog = buildMercadoPagoCardOperationLog({
    operation,
    endpoint,
    environment,
    token: normalized,
    externalReference,
    subscriptionId,
    preapprovalId,
    requestId,
  })

  if (!normalized) {
    throw createMercadoPagoCardFlowError('card_token_required', 'Token do cartão não informado.', {
      status: 400,
      details: {
        ...baseLog,
        retry_with_new_token: true,
      },
    })
  }

  if (!isLikelyMercadoPagoCardToken(normalized)) {
    throw createMercadoPagoCardFlowError('card_token_invalid_format', 'Token do cartão inválido ou malformado.', {
      status: 400,
      details: {
        ...baseLog,
        retry_with_new_token: true,
      },
    })
  }

  pruneDisposableCardTokenRegistry()
  const registryKey = hashCardToken(normalized)
  const existing = disposableCardTokenRegistry.get(registryKey)

  if (existing) {
    throw createMercadoPagoCardFlowError(
      'card_token_already_consumed',
      'Este token do cartão já foi utilizado. Refaça os dados do cartão para gerar um novo token.',
      {
        status: 409,
        details: {
          ...buildMercadoPagoCardOperationLog({
            operation,
            endpoint,
            environment,
            token: normalized,
            externalReference,
            subscriptionId,
            preapprovalId,
            requestId,
            alreadyUsedInProcess: true,
            firstUsage: existing,
          }),
          retry_with_new_token: true,
        },
      }
    )
  }

  const entry = {
    operation: operation || null,
    endpoint: endpoint || null,
    environment: environment || 'unknown',
    externalReference: externalReference || null,
    subscriptionId: subscriptionId || null,
    preapprovalId: preapprovalId || null,
    requestId: requestId || null,
    claimedAt: nowIso(),
    claimedAtMs: Date.now(),
    outcome: 'claimed',
    lastUpdatedAt: nowIso(),
  }
  disposableCardTokenRegistry.set(registryKey, entry)

  return {
    token: normalized,
    registryKey,
    registryEntry: entry,
    logMeta: buildMercadoPagoCardOperationLog({
      operation,
      endpoint,
      environment,
      token: normalized,
      externalReference,
      subscriptionId,
      preapprovalId,
      requestId,
      alreadyUsedInProcess: false,
    }),
  }
}

export function markMercadoPagoDisposableCardTokenOutcome(token, outcome, extra = {}) {
  const normalized = normalizeMercadoPagoCardToken(token)
  if (!normalized) return null
  const registryKey = hashCardToken(normalized)
  const current = disposableCardTokenRegistry.get(registryKey)
  if (!current) return null
  const next = {
    ...current,
    outcome: outcome || current.outcome || 'unknown',
    lastUpdatedAt: nowIso(),
    ...extra,
  }
  disposableCardTokenRegistry.set(registryKey, next)
  return next
}

export function extractMercadoPagoErrorSnapshot(error) {
  const raw = error?.responseData || error?.data || null
  const cause = Array.isArray(raw?.cause) ? raw.cause.find(Boolean) || null : null
  return {
    status: Number(error?.status || raw?.status || 0) || null,
    gateway_error: raw?.error || null,
    gateway_message: raw?.message || error?.message || null,
    gateway_cause_code: cause?.code != null ? String(cause.code) : null,
    gateway_cause_description: cause?.description || null,
  }
}

export function isMercadoPagoInvalidCardTokenError(error) {
  const snapshot = extractMercadoPagoErrorSnapshot(error)
  return (
    snapshot.gateway_cause_code === '3003' ||
    /invalid card_token_id/i.test(String(snapshot.gateway_message || '')) ||
    /invalid card_token_id/i.test(String(snapshot.gateway_cause_description || ''))
  )
}

export function toMercadoPagoCardFlowError(error) {
  if (!error) return null

  if (error?.code === 'card_token_required') return error
  if (error?.code === 'card_token_invalid_format') return error
  if (error?.code === 'card_token_already_consumed') return error

  if (isMercadoPagoInvalidCardTokenError(error)) {
    const snapshot = extractMercadoPagoErrorSnapshot(error)
    return createMercadoPagoCardFlowError(
      'card_token_refresh_required',
      'O token do cartão expirou, já foi usado ou não corresponde ao ambiente atual. Refaça os dados do cartão para gerar um novo token.',
      {
        status: 409,
        details: {
          ...snapshot,
          retry_with_new_token: true,
        },
        cause: error,
      }
    )
  }

  return null
}

export function sanitizeMercadoPagoSensitivePayload(value, seen = new WeakSet()) {
  if (value == null) return value

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMercadoPagoSensitivePayload(entry, seen))
  }

  if (typeof value !== 'object') return value

  if (seen.has(value)) return null
  seen.add(value)

  const next = {}
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim().toLowerCase()

    if (['card_token_id', 'card_token', 'cardtoken'].includes(normalizedKey)) {
      next[key] = CARD_TOKEN_REDACTED
      continue
    }

    if (
      normalizedKey === 'token' &&
      typeof entry === 'string' &&
      isLikelyMercadoPagoCardToken(entry)
    ) {
      next[key] = CARD_TOKEN_REDACTED
      continue
    }

    if (['security_code', 'securitycode', 'cvv'].includes(normalizedKey)) {
      next[key] = CVV_REDACTED
      continue
    }

    if (['card_number', 'cardnumber'].includes(normalizedKey)) {
      next[key] = CARD_NUMBER_REDACTED
      continue
    }

    next[key] = sanitizeMercadoPagoSensitivePayload(entry, seen)
  }

  return next
}
