import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { encryptAccessToken } from '../services/waCrypto.js';
import { exchangeOAuthCode, getGraph } from '../services/waGraph.js';
import {
getWaAccountByEstabelecimentoId, getWaAccountByPhoneNumberId, upsertWaAccount, disconnectWaAccount,
} from '../services/waTenant.js';
const router = Router();
const APP_ID = process.env.WA_APP_ID;
const APP_SECRET = process.env.WA_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const DIALOG_VERSION = process.env.WA_API_VERSION || 'v23.0';
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const SCOPES = [
  'business_management',
  'whatsapp_business_management',
  'whatsapp_business_messaging',
].join(',');
function buildConnectUrl(state) {
const url = new URL(`https://www.facebook.com/${DIALOG_VERSION}/dialog/oauth`);
url.searchParams.set('client_id', String(APP_ID || ''));
url.searchParams.set('redirect_uri', String(REDIRECT_URI || ''));
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', SCOPES);
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
return `${FRONTEND_BASE}/configuracoes?wa=${encodeURIComponent(safe)}`;
}
router.get('/connect/start', auth, isEstabelecimento, async (req, res) => {
if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
return res.status(500).json({ error: 'wa_config_missing' });
}
  try {
const state = buildState(req.user.id);
const url = buildConnectUrl(state);
return res.json({ url });
} catch (err) {
console.error('[wa/connect/start]', err?.message || err);
return res.status(500).json({ error: 'wa_connect_failed' });
}
});
router.get('/connect/status', auth, isEstabelecimento, async (req, res) => {
try {
const account = await getWaAccountByEstabelecimentoId(req.user.id);
if (!account) return res.json({ ok: true, connected: false });
return res.json({
ok: true, connected: account.status === 'connected', status: account.status, display_phone_number: account.display_phone_number, phone_number_id: account.phone_number_id, waba_id: account.waba_id, connected_at: account.connected_at, });
} catch (err) {
console.error('[wa/connect/status]', err);
return res.json({ ok: true, connected: false, degraded: true });
}
});
router.post('/connect/disconnect', auth, isEstabelecimento, async (req, res) => {
try {
const result = await disconnectWaAccount(req.user.id);
return res.json({ ok: !!result.ok });
} catch (err) {
console.error('[wa/connect/disconnect]', err?.message || err);
return res.status(500).json({ error: 'wa_disconnect_failed' });
}
});
router.get('/connect/callback', async (req, res) => {
const code = typeof req.query?.code === 'string'  req.query.code : null;
const state = typeof req.query?.state === 'string'  req.query.state : null;
if (!code || !state) {
return res.status(400).send('Missing code/state');
}
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
return res.status(500).send('WA config missing');
}

  let estabelecimentoId = null;
try {
const payload = jwt.verify(state, process.env.JWT_SECRET || 'secret');
estabelecimentoId = Number(payload?.estabelecimentoId);
} catch (err) {
console.error('[wa/connect/callback][state]', err?.message || err);
return res.status(400).send('Invalid state');
}

  if (!Number.isFinite(estabelecimentoId) || estabelecimentoId <= 0) {
return res.status(400).send('Invalid state');
}

  try {
const tokenResp = await exchangeOAuthCode({
code, redirectUri: REDIRECT_URI, appId: APP_ID, appSecret: APP_SECRET, });
const accessToken = tokenResp?.access_token;
if (!accessToken) throw new Error('missing_access_token');
let businessId = null;
try {
const businesses = await getGraph('me/businesses', accessToken, { fields: 'id,name', limit: 1 });
businessId = businesses?.data?.[0]?.id || null;
} catch {}
if (!businessId) {
try {
const me = await getGraph('me', accessToken, { fields: 'id' });
businessId = me?.id || null;
} catch {}
}

    let wabaId = null;
let phoneNumberId = null;
let displayPhoneNumber = null;
let phoneNumbersCount = 0;
let rawKeys = {};
if (businessId) {
const wabaResp = await getGraph(
        `${businessId}/owned_whatsapp_business_accounts`, accessToken, { fields: 'id,name', limit: 10 }
);
const wabas = Array.isArray(wabaResp?.data) ? wabaResp.data : [];
rawKeys.waba_keys = Object.keys(wabaResp || {});
for (const waba of wabas) {
if (!waba?.id) continue;
const phonesResp = await getGraph(
          `${waba.id}/phone_numbers`, accessToken, { fields: 'id,display_phone_number,verified_name', limit: 10 }
);
const phones = Array.isArray(phonesResp?.data) ? phonesResp.data : [];
phoneNumbersCount += phones.length;
rawKeys.phone_keys = Object.keys(phonesResp || {});
if (!phones.length) continue;
const first = phones[0];
if (first?.id) {
wabaId = String(waba.id);
phoneNumberId = String(first.id);
displayPhoneNumber = first.display_phone_number ? String(first.display_phone_number) : null;
break;
}
      }
}

    if (!phoneNumberId) {
console.warn('[wa/connect/callback] missing phone_number', {
business_id: businessId, waba_id: wabaId, phone_numbers_count: phoneNumbersCount, raw_keys: rawKeys, });
return res.redirect(302, `${FRONTEND_BASE}/configuracoes?wa=error&reason=missing_phone_number`);
}

    const existingPhone = await getWaAccountByPhoneNumberId(phoneNumberId);
if (existingPhone && Number(existingPhone.estabelecimento_id) !== Number(estabelecimentoId)) {
return res.redirect(302, resolveRedirect('phone_in_use'));
}

    const { enc, last4 } = encryptAccessToken(accessToken);
await upsertWaAccount({
estabelecimentoId, wabaId, phoneNumberId, displayPhoneNumber, businessId, accessTokenEnc: enc, tokenLast4: last4, status: 'connected', connectedAt: new Date(), });
return res.redirect(302, resolveRedirect('connected'));
} catch (err) {
console.error('[wa/connect/callback]', err?.message || err);
return res.redirect(302, resolveRedirect('error'));
}
});
export default router;


