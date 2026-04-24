import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'
import { decryptMpToken, encryptMpToken } from './mpCrypto.js'

const MP_TOKEN_URL = process.env.MP_TOKEN_URL || 'https://api.mercadopago.com/oauth/token'

function normalizeEnvValue(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function pickEnv(names = []) {
  for (const name of names) {
    const value = normalizeEnvValue(process.env[name])
    if (value) return value
  }
  return ''
}

const MP_CLIENT_ID = pickEnv(['MP_CLIENT_ID', 'MERCADOPAGO_CLIENT_ID'])
const MP_CLIENT_SECRET = pickEnv(['MP_CLIENT_SECRET', 'MERCADOPAGO_CLIENT_SECRET'])

function normalizeId(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const parsed = Math.trunc(num)
  return parsed > 0 ? parsed : null
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

const MP_FALLBACK_ALLOWED = (() => {
  return parseBool(
    process.env.MP_DEPOSIT_FALLBACK_PLATFORM ||
      process.env.MERCADOPAGO_DEPOSIT_FALLBACK ||
      process.env.MP_DEPOSIT_FALLBACK ||
      '',
    false
  )
})()

function toDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function safeJsonParse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function safeJsonStringify(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function isMissingTableError(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146
}

function buildNormalizedAccount(row, { source = 'establishment_mp_accounts' } = {}) {
  if (!row) return null

  const id = row.id != null ? Number(row.id) || null : null
  const estabelecimentoId = Number(row.estabelecimento_id || row.estabelecimentoId || 0) || null
  const mpUserId = row.mp_user_id != null ? String(row.mp_user_id) : null
  const mpCollectorId = row.mp_collector_id != null
    ? String(row.mp_collector_id)
    : (mpUserId || null)
  const accessTokenEncrypted =
    row.access_token_encrypted ||
    row.access_token_enc ||
    null
  const refreshTokenEncrypted =
    row.refresh_token_encrypted ||
    row.refresh_token_enc ||
    null
  const publicKey = row.public_key || null
  const scope = row.scope || null
  const status = String(row.status || '').trim().toLowerCase() || 'error'
  const tokenLast4 = row.token_last4 || null
  const tokenExpiresAt = toDate(row.token_expires_at || row.expires_at)
  const rawOauthMetadata = safeJsonParse(row.raw_oauth_metadata)
  const createdAt = toDate(row.created_at)
  const updatedAt = toDate(row.updated_at)
  const connected =
    status === 'connected' &&
    Boolean(accessTokenEncrypted) &&
    (!tokenExpiresAt || tokenExpiresAt.getTime() > Date.now())

  return {
    id,
    source,
    connected,
    estabelecimentoId,
    estabelecimento_id: estabelecimentoId,
    mpUserId,
    mp_user_id: mpUserId,
    mpCollectorId,
    mp_collector_id: mpCollectorId,
    accessTokenEncrypted,
    access_token_encrypted: accessTokenEncrypted,
    access_token_enc: accessTokenEncrypted,
    refreshTokenEncrypted,
    refresh_token_encrypted: refreshTokenEncrypted,
    refresh_token_enc: refreshTokenEncrypted,
    publicKey,
    public_key: publicKey,
    scope,
    status,
    tokenLast4,
    token_last4: tokenLast4,
    tokenExpiresAt,
    token_expires_at: tokenExpiresAt,
    expires_at: tokenExpiresAt,
    rawOauthMetadata,
    raw_oauth_metadata: rawOauthMetadata,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  }
}

async function fetchNewAccountBySql(whereSql, values) {
  try {
    const [rows] = await pool.query(
      `SELECT id,
              estabelecimento_id,
              mp_user_id,
              mp_collector_id,
              access_token_encrypted,
              refresh_token_encrypted,
              public_key,
              token_last4,
              token_expires_at,
              scope,
              status,
              raw_oauth_metadata,
              created_at,
              updated_at
         FROM establishment_mp_accounts
        WHERE ${whereSql}
        LIMIT 1`,
      values
    )
    return buildNormalizedAccount(rows?.[0], { source: 'establishment_mp_accounts' })
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

async function fetchLegacyAccountBySql(whereSql, values) {
  const [rows] = await pool.query(
    `SELECT NULL AS id,
            estabelecimento_id,
            mp_user_id,
            mp_user_id AS mp_collector_id,
            access_token_enc AS access_token_encrypted,
            refresh_token_enc AS refresh_token_encrypted,
            NULL AS public_key,
            token_last4,
            expires_at AS token_expires_at,
            NULL AS scope,
            status,
            NULL AS raw_oauth_metadata,
            created_at,
            updated_at
       FROM mercadopago_accounts
      WHERE ${whereSql}
      LIMIT 1`,
    values
  )
  return buildNormalizedAccount(rows?.[0], { source: 'mercadopago_accounts' })
}

export function isMpDepositFallbackAllowed() {
  return MP_FALLBACK_ALLOWED
}

export async function getEstablishmentMpAccountByEstabelecimentoId(estabelecimentoId) {
  const id = normalizeId(estabelecimentoId)
  if (!id) return null
  return (
    await fetchNewAccountBySql('estabelecimento_id=?', [id])
  ) || (
    await fetchLegacyAccountBySql('estabelecimento_id=?', [id])
  )
}

export async function getEstablishmentMpAccountByMpUserId(mpUserId) {
  const raw = String(mpUserId || '').trim()
  if (!raw) return null
  return (
    await fetchNewAccountBySql('mp_user_id=?', [raw])
  ) || (
    await fetchLegacyAccountBySql('mp_user_id=?', [raw])
  )
}

async function syncLegacyMercadoPagoAccount({
  estabelecimentoId,
  mpUserId,
  accessTokenEncrypted,
  refreshTokenEncrypted,
  tokenLast4,
  tokenExpiresAt,
  status,
}) {
  const id = normalizeId(estabelecimentoId)
  if (!id) return
  await pool.query(
    `
    INSERT INTO mercadopago_accounts (
      estabelecimento_id,
      mp_user_id,
      access_token_enc,
      refresh_token_enc,
      token_last4,
      expires_at,
      status,
      created_at,
      updated_at
    ) VALUES (?,?,?,?,?,?,?,NOW(),NOW())
    ON DUPLICATE KEY UPDATE
      mp_user_id=VALUES(mp_user_id),
      access_token_enc=VALUES(access_token_enc),
      refresh_token_enc=VALUES(refresh_token_enc),
      token_last4=VALUES(token_last4),
      expires_at=VALUES(expires_at),
      status=VALUES(status),
      updated_at=VALUES(updated_at)
    `,
    [
      id,
      mpUserId || null,
      accessTokenEncrypted || null,
      refreshTokenEncrypted || null,
      tokenLast4 || null,
      tokenExpiresAt || null,
      status || 'connected',
    ]
  )
}

export async function upsertEstablishmentMpAccount({
  estabelecimentoId,
  mpUserId,
  mpCollectorId = null,
  accessTokenEncrypted = null,
  accessTokenEnc = null,
  refreshTokenEncrypted = null,
  refreshTokenEnc = null,
  publicKey = null,
  tokenExpiresAt = null,
  expiresAt = null,
  scope = null,
  status = 'connected',
  rawOauthMetadata = null,
  tokenLast4 = null,
}) {
  const id = normalizeId(estabelecimentoId)
  if (!id) throw new Error('missing_estabelecimento_id')

  const normalizedAccessToken = accessTokenEncrypted || accessTokenEnc || null
  const normalizedRefreshToken = refreshTokenEncrypted || refreshTokenEnc || null
  const normalizedStatus = String(status || 'connected').trim().toLowerCase() || 'connected'
  const normalizedExpiry = toDate(tokenExpiresAt || expiresAt)
  const normalizedRawMetadata = safeJsonStringify(rawOauthMetadata)

  try {
    await pool.query(
      `
      INSERT INTO establishment_mp_accounts (
        estabelecimento_id,
        mp_user_id,
        mp_collector_id,
        access_token_encrypted,
        refresh_token_encrypted,
        public_key,
        token_last4,
        token_expires_at,
        scope,
        status,
        raw_oauth_metadata,
        created_at,
        updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
      ON DUPLICATE KEY UPDATE
        mp_user_id=VALUES(mp_user_id),
        mp_collector_id=VALUES(mp_collector_id),
        access_token_encrypted=VALUES(access_token_encrypted),
        refresh_token_encrypted=VALUES(refresh_token_encrypted),
        public_key=VALUES(public_key),
        token_last4=VALUES(token_last4),
        token_expires_at=VALUES(token_expires_at),
        scope=VALUES(scope),
        status=VALUES(status),
        raw_oauth_metadata=VALUES(raw_oauth_metadata),
        updated_at=VALUES(updated_at)
      `,
      [
        id,
        mpUserId ? String(mpUserId) : null,
        mpCollectorId ? String(mpCollectorId) : (mpUserId ? String(mpUserId) : null),
        normalizedAccessToken,
        normalizedRefreshToken,
        publicKey || null,
        tokenLast4 || null,
        normalizedExpiry,
        scope || null,
        normalizedStatus,
        normalizedRawMetadata,
      ]
    )
  } catch (error) {
    if (!isMissingTableError(error)) throw error
  }

  await syncLegacyMercadoPagoAccount({
    estabelecimentoId: id,
    mpUserId: mpUserId ? String(mpUserId) : null,
    accessTokenEncrypted: normalizedAccessToken,
    refreshTokenEncrypted: normalizedRefreshToken,
    tokenLast4: tokenLast4 || null,
    tokenExpiresAt: normalizedExpiry,
    status: normalizedStatus,
  })

  return getEstablishmentMpAccountByEstabelecimentoId(id)
}

export async function disconnectEstablishmentMpAccount(estabelecimentoId) {
  const id = normalizeId(estabelecimentoId)
  if (!id) return { ok: false }

  let newResult = null
  try {
    ;[newResult] = await pool.query(
      `UPDATE establishment_mp_accounts
          SET status='revoked',
              access_token_encrypted=NULL,
              refresh_token_encrypted=NULL,
              token_last4=NULL,
              token_expires_at=NULL,
              updated_at=NOW()
        WHERE estabelecimento_id=?`,
      [id]
    )
  } catch (error) {
    if (!isMissingTableError(error)) throw error
  }

  await pool.query(
    `UPDATE mercadopago_accounts
        SET status='revoked',
            access_token_enc=NULL,
            refresh_token_enc=NULL,
            token_last4=NULL,
            expires_at=NULL,
            updated_at=NOW()
      WHERE estabelecimento_id=?`,
    [id]
  )

  return { ok: newResult?.affectedRows > 0 }
}

async function requestMercadoPagoOAuthToken(body) {
  const response = await fetch(MP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const raw = await response.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const detail = data?.message || data?.error_description || data?.error || raw || `HTTP ${response.status}`
    const error = new Error(`mp_oauth_refresh_failed:${detail}`)
    error.status = response.status
    error.responseData = data
    throw error
  }
  return data || {}
}

export async function refreshEstablishmentMpAccessToken(accountInput) {
  const account = accountInput?.estabelecimentoId
    ? accountInput
    : await getEstablishmentMpAccountByEstabelecimentoId(accountInput)
  if (!account?.estabelecimentoId) {
    return { ok: false, reason: 'not_found', account: null }
  }
  if (!account.refreshTokenEncrypted) {
    return { ok: false, reason: 'refresh_token_missing', account }
  }
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET) {
    return { ok: false, reason: 'oauth_client_missing', account }
  }

  let refreshToken = null
  try {
    refreshToken = decryptMpToken(account.refreshTokenEncrypted)
  } catch (error) {
    return { ok: false, reason: 'refresh_token_decrypt_failed', account, error }
  }
  if (!refreshToken) {
    return { ok: false, reason: 'refresh_token_missing', account }
  }

  const body = new URLSearchParams()
  body.set('client_id', MP_CLIENT_ID)
  body.set('client_secret', MP_CLIENT_SECRET)
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)

  const tokenResponse = await requestMercadoPagoOAuthToken(body)
  const nextAccessToken = String(tokenResponse?.access_token || '').trim()
  if (!nextAccessToken) {
    return { ok: false, reason: 'access_token_missing', account }
  }

  const nextRefreshToken = String(tokenResponse?.refresh_token || '').trim() || refreshToken
  const expiresIn = Number(tokenResponse?.expires_in || 0) || null
  const nextExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

  const { enc: accessTokenEncrypted, last4 } = encryptMpToken(nextAccessToken)
  const refreshTokenEncrypted = encryptMpToken(nextRefreshToken).enc

  const refreshedAccount = await upsertEstablishmentMpAccount({
    estabelecimentoId: account.estabelecimentoId,
    mpUserId: tokenResponse?.user_id ? String(tokenResponse.user_id) : account.mpUserId,
    mpCollectorId: tokenResponse?.collector_id
      ? String(tokenResponse.collector_id)
      : (account.mpCollectorId || tokenResponse?.user_id || account.mpUserId || null),
    accessTokenEncrypted,
    refreshTokenEncrypted,
    publicKey: tokenResponse?.public_key || account.publicKey || config.billing?.mercadopago?.publicKey || null,
    tokenExpiresAt: nextExpiresAt,
    scope: tokenResponse?.scope || account.scope || null,
    status: 'connected',
    rawOauthMetadata: {
      previous_status: account.status || null,
      refreshed_at: new Date().toISOString(),
      oauth: tokenResponse,
    },
    tokenLast4: last4,
  })

  return {
    ok: true,
    reason: null,
    account: refreshedAccount,
    accessToken: nextAccessToken,
  }
}

export async function resolveEstablishmentMpAccessToken(
  estabelecimentoId,
  { allowFallback = isMpDepositFallbackAllowed(), refreshIfExpired = true } = {}
) {
  const account = await getEstablishmentMpAccountByEstabelecimentoId(estabelecimentoId)
  if (!account) {
    return { accessToken: null, account: null, reason: 'not_found', allowFallback }
  }

  if (!account.accessTokenEncrypted) {
    return { accessToken: null, account, reason: account.status || 'not_connected', allowFallback }
  }

  const expiresAt = toDate(account.tokenExpiresAt)
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    if (refreshIfExpired) {
      try {
        const refreshed = await refreshEstablishmentMpAccessToken(account)
        if (refreshed?.ok && refreshed.accessToken) {
          return {
            accessToken: refreshed.accessToken,
            account: refreshed.account,
            reason: null,
            allowFallback,
          }
        }
        return {
          accessToken: null,
          account,
          reason: refreshed?.reason || 'expired',
          allowFallback,
        }
      } catch (error) {
        return {
          accessToken: null,
          account,
          reason: 'refresh_failed',
          error,
          allowFallback,
        }
      }
    }
    return { accessToken: null, account, reason: 'expired', allowFallback }
  }

  try {
    const accessToken = decryptMpToken(account.accessTokenEncrypted)
    return { accessToken, account, reason: null, allowFallback }
  } catch (error) {
    return { accessToken: null, account, reason: 'decrypt_failed', error, allowFallback }
  }
}

export function summarizeEstablishmentMpAccount(account) {
  if (!account) {
    return {
      connected: false,
      status: 'disconnected',
      owner_type: 'establishment',
    }
  }

  const normalizedStatus =
    account.status === 'connected' && account.connected !== true
      ? 'expired'
      : (account.status || 'error')

  return {
    id: account.id || null,
    estabelecimento_id: account.estabelecimentoId || null,
    owner_type: 'establishment',
    connected: account.connected === true,
    status: normalizedStatus,
    mp_user_id: account.mpUserId || null,
    mp_collector_id: account.mpCollectorId || account.mpUserId || null,
    public_key: account.publicKey || config.billing?.mercadopago?.publicKey || null,
    scope: account.scope || null,
    token_last4: account.tokenLast4 || null,
    token_expires_at: account.tokenExpiresAt ? account.tokenExpiresAt.toISOString() : null,
    created_at: account.createdAt ? account.createdAt.toISOString() : null,
    updated_at: account.updatedAt ? account.updatedAt.toISOString() : null,
    source: account.source || null,
  }
}

export async function getEstablishmentMpPublicKey(estabelecimentoId, { fallbackToApp = true } = {}) {
  const account = await getEstablishmentMpAccountByEstabelecimentoId(estabelecimentoId)
  if (account?.publicKey) return account.publicKey
  return fallbackToApp ? (config.billing?.mercadopago?.publicKey || null) : null
}
