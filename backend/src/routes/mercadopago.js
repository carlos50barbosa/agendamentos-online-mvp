import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { encryptMpToken } from '../services/mpCrypto.js';
import {
getMpAccountByEstabelecimentoId, upsertMpAccount, disconnectMpAccount,
} from '../services/mpAccounts.js';
const router = Router();
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const MP_AUTH_URL = process.env.MP_AUTH_URL || 'https://auth.mercadopago.com/authorization';
const MP_TOKEN_URL = process.env.MP_TOKEN_URL || 'https://api.mercadopago.com/oauth/token';
const MP_PLATFORM_ID = process.env.MP_PLATFORM_ID || 'mp';
const MP_SCOPE = process.env.MP_OAUTH_SCOPE || 'read write offline_access';
const MP_OAUTH_ENV_GROUPS = [ { names: ['MP_CLIENT_ID', 'MERCADOPAGO_CLIENT_ID'], recommended: 'MP_CLIENT_ID' }, { names: ['MP_CLIENT_SECRET', 'MERCADOPAGO_CLIENT_SECRET'], recommended: 'MP_CLIENT_SECRET' }, { names: ['MP_REDIRECT_URI', 'MERCADOPAGO_REDIRECT_URI'], recommended: 'MP_REDIRECT_URI' },
];
function normalizeEnvValue(value) {
if (value === undefined || value === null) return '';
return String(value).trim();
}
function pickEnv(names = []) {
for (const name of names) {
const value = normalizeEnvValue(process.env[name]);
if (value) return value;
}
  return '';
}
const MP_CLIENT_ID = pickEnv(['MP_CLIENT_ID', 'MERCADOPAGO_CLIENT_ID']);
const MP_CLIENT_SECRET = pickEnv(['MP_CLIENT_SECRET', 'MERCADOPAGO_CLIENT_SECRET']);
const MP_REDIRECT_URI = pickEnv(['MP_REDIRECT_URI', 'MERCADOPAGO_REDIRECT_URI']);
function getMissingMpOAuthEnv() {
const missing = [];
for (const group of MP_OAUTH_ENV_GROUPS) {
const hasValue = pickEnv(group.names);
if (!hasValue) missing.push(group.recommended);
}
  return missing;
}
function buildConnectUrl(state) {
const url = new URL(MP_AUTH_URL);
url.searchParams.set('client_id', String(MP_CLIENT_ID || ''));
url.searchParams.set('response_type', 'code');
url.searchParams.set('platform_id', MP_PLATFORM_ID);
url.searchParams.set('redirect_uri', String(MP_REDIRECT_URI || ''));
if (MP_SCOPE) url.searchParams.set('scope', MP_SCOPE);
if (state) url.searchParams.set('state', state);
return url.toString();
}
function buildState(estabelecimentoId) {
const payload = {
estabelecimentoId, nonce: crypto.randomBytes(8).toString('hex'), ts: Date.now(), };
return jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '15m' });
}
function resolveRedirect(status) {
const safe = status || 'connected';
return `${FRONTEND_BASE}/configuracoes?mp=${encodeURIComponent(safe)}`;
}
async function exchangeOAuthCode({ code }) {
const body = new URLSearchParams();
body.set('client_id', String(MP_CLIENT_ID || ''));
body.set('client_secret', String(MP_CLIENT_SECRET || ''));
body.set('grant_type', 'authorization_code');
body.set('code', String(code || ''));
body.set('redirect_uri', String(MP_REDIRECT_URI || ''));
const resp = await fetch(MP_TOKEN_URL, {
method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, });
const raw = await resp.text();
let data = null;
try {
data = raw ? JSON.parse(raw) : null;
} catch {
data = null;
}
  if (!resp.ok) {
const detail = data?.message || data?.error || raw || `HTTP ${resp.status}`;
throw new Error(`mp_oauth_failed: ${detail}`);
}
  return data || {};
}
router.get('/connect', auth, isEstabelecimento, async (req, res) => {
const wantsJson = String(req.query?.json || '').trim() === '1' || String(req.headers?.accept || '').includes('application/json');
try {
const missing = getMissingMpOAuthEnv();
if (missing.length) {
console.warn('[mp/connect] config missing', { missing });
return res.status(400).json({
ok: false, error: 'mp_config_missing', missing, hint: 'check backend/.env and dotenv loading', });
}
    const state = buildState(req.user.id);
const url = buildConnectUrl(state);
if (wantsJson) return res.json({ url });
return res.redirect(302, url);
} catch (err) {
console.error('[mp/connect]', err?.stack || err);
return res.status(500).json({ ok: false, error: 'mp_connect_error' });
}
});
router.get('/status', auth, isEstabelecimento, async (req, res) => {
try {
const account = await getMpAccountByEstabelecimentoId(req.user.id);
if (!account) {
return res.json({ ok: true, connected: false, status: 'disconnected' });
}
    const connected = account.status === 'connected' && !!account.access_token_enc;
return res.json({
ok: true, connected, status: account.status, token_last4: account.token_last4 || null, mp_user_id: account.mp_user_id || null, expires_at: account.expires_at ? new Date(account.expires_at).toISOString() : null, });
} catch (err) {
console.error('[mp/status]', err?.message || err);
return res.json({ ok: true, connected: false, degraded: true });
}
});
router.post('/disconnect', auth, isEstabelecimento, async (req, res) => {
try {
const result = await disconnectMpAccount(req.user.id);
return res.json({ ok: !!result.ok });
} catch (err) {
console.error('[mp/disconnect]', err?.message || err);
return res.status(500).json({ error: 'mp_disconnect_failed' });
}
});
router.get('/callback', async (req, res) => {
const code = typeof req.query?.code === 'string' ? req.query.code : null;
const state = typeof req.query?.state === 'string' ? req.query.state : null;
if (!code || !state) {
return res.status(400).send('Missing code/state');
}
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET || !MP_REDIRECT_URI) {
return res.status(500).send('MP config missing');
}

  let estabelecimentoId = null;
try {
const payload = jwt.verify(state, process.env.JWT_SECRET || 'secret');
estabelecimentoId = Number(payload?.estabelecimentoId);
} catch (err) {
console.error('[mp/callback][state]', err?.message || err);
return res.status(400).send('Invalid state');
}

  if (!Number.isFinite(estabelecimentoId) || estabelecimentoId <= 0) {
return res.status(400).send('Invalid state');
}

  try {
const tokenResp = await exchangeOAuthCode({ code });
const accessToken = tokenResp?.access_token;
if (!accessToken) throw new Error('missing_access_token');
const refreshToken = tokenResp?.refresh_token || null;
const expiresIn = Number(tokenResp?.expires_in || 0) || null;
const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
const mpUserId = tokenResp?.user_id ? String(tokenResp.user_id) : null;
const { enc: accessEnc, last4 } = encryptMpToken(accessToken);
const refreshEnc = refreshToken ? encryptMpToken(refreshToken).enc : null;
await upsertMpAccount({
estabelecimentoId, mpUserId, accessTokenEnc: accessEnc, refreshTokenEnc: refreshEnc, tokenLast4: last4, expiresAt, status: 'connected', });
return res.redirect(302, resolveRedirect('connected'));
} catch (err) {
console.error('[mp/callback]', err?.message || err);
return res.redirect(302, resolveRedirect('error'));
}
});
export default router;



