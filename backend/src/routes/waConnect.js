import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import {
  buildOAuthState,
  describeOAuthStateError,
  verifyOAuthState,
} from '../lib/oauth_state.js';
import { encryptAccessToken } from '../services/waCrypto.js';
import { exchangeOAuthCode, getGraph } from '../services/waGraph.js';
import {
  getWaAccountByEstabelecimentoId,
  getWaAccountByPhoneNumberId,
  upsertWaAccount,
  disconnectWaAccount,
} from '../services/waTenant.js';

const router = Router();

const APP_ID = process.env.WA_APP_ID;
const APP_SECRET = process.env.WA_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const DIALOG_VERSION = process.env.WA_API_VERSION || 'v23.0';
const WA_STATE_SECRET = process.env.WA_STATE_SECRET || process.env.JWT_SECRET;
const WA_STATE_TTL = String(process.env.WA_STATE_TTL || '1h').trim() || '1h';
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
  return buildOAuthState(
    { estabelecimentoId },
    { secret: WA_STATE_SECRET, expiresIn: WA_STATE_TTL },
  );
}

function resolveRedirect(status, reason) {
  const url = new URL(`${FRONTEND_BASE}/whatsappbusiness`);
  url.searchParams.set('wa', status || 'connected');
  if (reason) url.searchParams.set('reason', reason);
  return url.toString();
}

router.get('/connect/start', auth, isEstabelecimento, async (req, res) => {
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
    return res.status(500).json({ error: 'wa_config_missing' });
  }
  if (!WA_STATE_SECRET) {
    return res.status(500).json({ error: 'wa_state_secret_missing' });
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
      ok: true,
      connected: account.status === 'connected',
      status: account.status,
      display_phone_number: account.display_phone_number,
      phone_number_id: account.phone_number_id,
      waba_id: account.waba_id,
      connected_at: account.connected_at,
    });
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
  const code = typeof req.query?.code === 'string' ? req.query.code : null;
  const state = typeof req.query?.state === 'string' ? req.query.state : null;
  if (!code || !state) {
    return res.redirect(302, resolveRedirect('error', 'missing_code_or_state'));
  }
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
    return res.redirect(302, resolveRedirect('error', 'wa_config_missing'));
  }

  let estabelecimentoId = null;
  try {
    const payload = verifyOAuthState(state, { secret: WA_STATE_SECRET });
    estabelecimentoId = Number(payload?.estabelecimentoId);
  } catch (err) {
    const stateError = describeOAuthStateError(err);
    console.warn('[wa/connect/callback][state]', stateError);
    return res.redirect(302, resolveRedirect('error', stateError.reason));
  }

  if (!Number.isFinite(estabelecimentoId) || estabelecimentoId <= 0) {
    return res.redirect(302, resolveRedirect('error', 'state_invalid'));
  }

  try {
    const tokenResp = await exchangeOAuthCode({
      code,
      redirectUri: REDIRECT_URI,
      appId: APP_ID,
      appSecret: APP_SECRET,
    });
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
        `${businessId}/owned_whatsapp_business_accounts`,
        accessToken,
        { fields: 'id,name', limit: 10 }
      );
      const wabas = Array.isArray(wabaResp?.data) ? wabaResp.data : [];
      rawKeys.waba_keys = Object.keys(wabaResp || {});
      for (const waba of wabas) {
        if (!waba?.id) continue;
        const phonesResp = await getGraph(
          `${waba.id}/phone_numbers`,
          accessToken,
          { fields: 'id,display_phone_number,verified_name', limit: 10 }
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
        business_id: businessId,
        waba_id: wabaId,
        phone_numbers_count: phoneNumbersCount,
        raw_keys: rawKeys,
      });
      return res.redirect(302, resolveRedirect('error', 'missing_phone_number'));
    }

    const existingPhone = await getWaAccountByPhoneNumberId(phoneNumberId);
    if (existingPhone && Number(existingPhone.estabelecimento_id) !== Number(estabelecimentoId)) {
      return res.redirect(302, resolveRedirect('phone_in_use'));
    }

    const { enc, last4 } = encryptAccessToken(accessToken);
    await upsertWaAccount({
      estabelecimentoId,
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      businessId,
      accessTokenEnc: enc,
      tokenLast4: last4,
      status: 'connected',
      connectedAt: new Date(),
    });

    return res.redirect(302, resolveRedirect('connected'));
  } catch (err) {
    console.error('[wa/connect/callback]', err?.message || err);
    return res.redirect(302, resolveRedirect('error', 'oauth_exchange_failed'));
  }
});

export default router;
