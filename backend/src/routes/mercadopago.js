import { Router } from 'express'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { getPlanContext } from '../lib/plans.js'
import { config } from '../lib/config.js'
import { buildOAuthState, describeOAuthStateError, verifyOAuthState } from '../lib/oauth_state.js'
import { encryptMpToken } from '../services/mpCrypto.js'
import {
  disconnectMpAccount,
  getMpAccountByEstabelecimentoId,
  summarizeMpAccount,
  upsertMpAccount,
} from '../services/mpAccounts.js'

const router = Router()

const DEPOSIT_ALLOWED_PLANS = new Set(['pro', 'premium'])
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const MP_AUTH_URL = process.env.MP_AUTH_URL || 'https://auth.mercadopago.com/authorization'
const MP_TOKEN_URL = process.env.MP_TOKEN_URL || 'https://api.mercadopago.com/oauth/token'
const MP_PLATFORM_ID = process.env.MP_PLATFORM_ID || 'mp'
const MP_SCOPE = process.env.MP_OAUTH_SCOPE || 'read write offline_access'
const MP_STATE_SECRET = process.env.MP_STATE_SECRET || process.env.JWT_SECRET
const MP_OAUTH_ENV_GROUPS = [
  { names: ['MP_CLIENT_ID', 'MERCADOPAGO_CLIENT_ID'], recommended: 'MP_CLIENT_ID' },
  { names: ['MP_CLIENT_SECRET', 'MERCADOPAGO_CLIENT_SECRET'], recommended: 'MP_CLIENT_SECRET' },
  { names: ['MP_REDIRECT_URI', 'MERCADOPAGO_REDIRECT_URI'], recommended: 'MP_REDIRECT_URI' },
]

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
const MP_REDIRECT_URI = pickEnv(['MP_REDIRECT_URI', 'MERCADOPAGO_REDIRECT_URI'])

function normalizeCapability(value, fallback = 'deposit') {
  const normalized = String(value || '').trim().toLowerCase()
  if (['deposit', 'loyalty', 'all'].includes(normalized)) return normalized
  return fallback
}

function inferCapabilityFromRequest(req) {
  return normalizeCapability(
    req.query?.capability ||
      req.query?.feature ||
      req.query?.context ||
      req.headers['x-mp-capability'] ||
      'deposit'
  )
}

function normalizeReturnTo(value, capability = 'deposit') {
  const raw = String(value || '').trim()
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  return capability === 'loyalty' ? '/fidelidade' : '/sinal'
}

function buildMpRedirectUriExample() {
  const explicitApiBase = normalizeEnvValue(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL)
  if (explicitApiBase) {
    return `${explicitApiBase.replace(/\/$/, '')}/marketplace/mp/connect/callback`
  }
  const frontBase = normalizeEnvValue(process.env.FRONTEND_BASE_URL || process.env.APP_URL)
  if (!frontBase) return ''
  if (/localhost:3001$/i.test(frontBase.replace(/\/$/, ''))) {
    return 'http://localhost:3002/marketplace/mp/connect/callback'
  }
  return `${frontBase.replace(/\/$/, '')}/api/marketplace/mp/connect/callback`
}

function getMissingMpOAuthEnv() {
  const missing = []
  for (const group of MP_OAUTH_ENV_GROUPS) {
    if (!pickEnv(group.names)) missing.push(group.recommended)
  }
  return missing
}

function buildConnectUrl(state) {
  const url = new URL(MP_AUTH_URL)
  url.searchParams.set('client_id', String(MP_CLIENT_ID || ''))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', MP_PLATFORM_ID)
  url.searchParams.set('redirect_uri', String(MP_REDIRECT_URI || ''))
  if (MP_SCOPE) url.searchParams.set('scope', MP_SCOPE)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

function buildState(estabelecimentoId, { capability = 'deposit', returnTo = null } = {}) {
  return buildOAuthState(
    {
      estabelecimentoId,
      capability: normalizeCapability(capability),
      returnTo: normalizeReturnTo(returnTo, capability),
    },
    { secret: MP_STATE_SECRET, expiresIn: '15m' }
  )
}

function appendRedirectStatus(targetUrl, status, reason = null) {
  const url = new URL(`${FRONTEND_BASE}${normalizeReturnTo(targetUrl)}`)
  url.searchParams.set('mp', String(status || 'error').toLowerCase())
  if (reason) url.searchParams.set('reason', String(reason))
  return url.toString()
}

async function exchangeOAuthCode({ code }) {
  const body = new URLSearchParams()
  body.set('client_id', String(MP_CLIENT_ID || ''))
  body.set('client_secret', String(MP_CLIENT_SECRET || ''))
  body.set('grant_type', 'authorization_code')
  body.set('code', String(code || ''))
  body.set('redirect_uri', String(MP_REDIRECT_URI || ''))

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
    throw new Error(`mp_oauth_failed:${detail}`)
  }
  return data || {}
}

async function assertCapabilityAllowed(estabelecimentoId, capability) {
  if (capability !== 'deposit') return
  const planContext = await getPlanContext(estabelecimentoId)
  if (!planContext) {
    const error = new Error('plan_context_not_found')
    error.status = 404
    error.code = 'plan_context_not_found'
    throw error
  }
  const allowed = DEPOSIT_ALLOWED_PLANS.has(String(planContext.plan || '').toLowerCase())
  if (!allowed) {
    const error = new Error('Disponível apenas para planos Pro ou Premium.')
    error.status = 403
    error.code = 'plan_not_allowed'
    throw error
  }
}

function wantsJsonResponse(req) {
  return String(req.query?.json || '').trim() === '1' || String(req.headers?.accept || '').includes('application/json')
}

async function handleConnectStart(req, res) {
  const wantsJson = wantsJsonResponse(req)
  const capability = inferCapabilityFromRequest(req)
  const returnTo = normalizeReturnTo(req.query?.return_to || req.query?.returnTo, capability)

  try {
    const missing = getMissingMpOAuthEnv()
    if (missing.length) {
      const exampleRedirectUri = buildMpRedirectUriExample()
      const message = [
        'Configuração incompleta do OAuth do Mercado Pago no backend.',
        missing.length ? `Preencha: ${missing.join(', ')}.` : '',
        missing.includes('MP_REDIRECT_URI') && exampleRedirectUri
          ? `Sugestão para MP_REDIRECT_URI: ${exampleRedirectUri}.`
          : '',
      ].filter(Boolean).join(' ')
      console.warn('[marketplace/mp][connect] config_missing', { missing, capability, return_to: returnTo })
      return res.status(400).json({
        ok: false,
        error: 'mp_config_missing',
        missing,
        capability,
        message,
        hint: 'check backend/.env and dotenv loading',
        example_redirect_uri: exampleRedirectUri || null,
      })
    }

    await assertCapabilityAllowed(req.user.id, capability)
    const state = buildState(req.user.id, { capability, returnTo })
    const url = buildConnectUrl(state)
    if (wantsJson) {
      return res.json({
        ok: true,
        url,
        capability,
        return_to: returnTo,
        owner_type: 'establishment',
      })
    }
    return res.redirect(302, url)
  } catch (error) {
    const status = Number(error?.status || 500)
    const code = error?.code || 'mp_connect_error'
    const message = error?.message || 'Não foi possível iniciar a conexão do Mercado Pago.'
    console.error('[marketplace/mp][connect]', {
      estabelecimento_id: req.user?.id || null,
      capability,
      return_to: returnTo,
      error: code,
      message,
    })
    return res.status(status).json({ ok: false, error: code, message })
  }
}

async function handleAccountStatus(req, res) {
  try {
    const account = await getMpAccountByEstabelecimentoId(req.user.id)
    const summary = summarizeMpAccount(account)
    return res.json({
      ok: true,
      account: summary,
      connected: summary.connected,
      status: summary.status,
      mp_user_id: summary.mp_user_id,
      mp_collector_id: summary.mp_collector_id,
      token_last4: summary.token_last4,
      expires_at: summary.token_expires_at,
      token_expires_at: summary.token_expires_at,
    })
  } catch (error) {
    console.error('[marketplace/mp][account]', {
      estabelecimento_id: req.user?.id || null,
      message: error?.message || String(error),
    })
    return res.status(500).json({
      ok: false,
      error: 'mp_account_status_failed',
      message: 'Não foi possível carregar a conta Mercado Pago.',
    })
  }
}

async function handleDisconnect(req, res) {
  try {
    const result = await disconnectMpAccount(req.user.id)
    return res.json({ ok: !!result.ok })
  } catch (error) {
    console.error('[marketplace/mp][disconnect]', {
      estabelecimento_id: req.user?.id || null,
      message: error?.message || String(error),
    })
    return res.status(500).json({
      ok: false,
      error: 'mp_disconnect_failed',
      message: 'Não foi possível desconectar o Mercado Pago.',
    })
  }
}

async function handleCallback(req, res) {
  const code = typeof req.query?.code === 'string' ? req.query.code : null
  const state = typeof req.query?.state === 'string' ? req.query.state : null
  if (!code || !state) {
    return res.status(400).send('Missing code/state')
  }

  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET || !MP_REDIRECT_URI) {
    return res.status(500).send('MP config missing')
  }

  let statePayload = null
  try {
    statePayload = verifyOAuthState(state, { secret: MP_STATE_SECRET })
  } catch (error) {
    const description = describeOAuthStateError(error)
    console.warn('[marketplace/mp][callback][state]', description)
    return res.status(400).send(description.responseMessage)
  }

  const estabelecimentoId = Number(statePayload?.estabelecimentoId || 0) || null
  const capability = normalizeCapability(statePayload?.capability || 'deposit')
  const returnTo = normalizeReturnTo(statePayload?.returnTo, capability)

  if (!estabelecimentoId) {
    return res.status(400).send('Invalid state')
  }

  try {
    const tokenResponse = await exchangeOAuthCode({ code })
    const accessToken = String(tokenResponse?.access_token || '').trim()
    if (!accessToken) throw new Error('missing_access_token')

    const refreshToken = String(tokenResponse?.refresh_token || '').trim() || null
    const expiresIn = Number(tokenResponse?.expires_in || 0) || null
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
    const mpUserId = tokenResponse?.user_id ? String(tokenResponse.user_id) : null
    const mpCollectorId = tokenResponse?.collector_id
      ? String(tokenResponse.collector_id)
      : (mpUserId || null)
    const { enc: accessTokenEnc, last4 } = encryptMpToken(accessToken)
    const refreshTokenEnc = refreshToken ? encryptMpToken(refreshToken).enc : null

    const account = await upsertMpAccount({
      estabelecimentoId,
      mpUserId,
      mpCollectorId,
      accessTokenEnc,
      refreshTokenEnc,
      publicKey: tokenResponse?.public_key || config.billing?.mercadopago?.publicKey || null,
      expiresAt: tokenExpiresAt,
      scope: tokenResponse?.scope || MP_SCOPE || null,
      status: 'connected',
      rawOauthMetadata: {
        oauth: tokenResponse,
        capability,
        return_to: returnTo,
      },
      tokenLast4: last4,
    })

    console.info('[marketplace/mp][callback] connected', {
      estabelecimento_id: estabelecimentoId,
      capability,
      return_to: returnTo,
      mp_user_id: account?.mp_user_id || mpUserId || null,
      mp_collector_id: account?.mp_collector_id || mpCollectorId || null,
      token_expires_at: account?.token_expires_at ? account.token_expires_at.toISOString() : null,
      scope: account?.scope || tokenResponse?.scope || null,
    })

    return res.redirect(302, appendRedirectStatus(returnTo, 'connected'))
  } catch (error) {
    console.error('[marketplace/mp][callback]', {
      estabelecimento_id: estabelecimentoId,
      capability,
      return_to: returnTo,
      message: error?.message || String(error),
    })
    return res.redirect(302, appendRedirectStatus(returnTo, 'error'))
  }
}

router.get(['/connect/start', '/connect'], auth, isEstabelecimento, handleConnectStart)
router.get(['/account', '/status'], auth, isEstabelecimento, handleAccountStatus)
router.delete('/account', auth, isEstabelecimento, handleDisconnect)
router.post('/disconnect', auth, isEstabelecimento, handleDisconnect)
router.get(['/connect/callback', '/callback'], handleCallback)

export default router
