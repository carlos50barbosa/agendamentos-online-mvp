import fetch from 'node-fetch';

const API_VERSION = process.env.WA_API_VERSION || 'v23.0';
const GRAPH_BASE = 'https://graph.facebook.com';

function buildUrl(path, params) {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${clean}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

async function parseGraphResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callGraph({ method, url, token, payload }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await parseGraphResponse(res);
  if (!res.ok) {
    const err = new Error(`Graph HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function getGraph(path, token, params) {
  const url = buildUrl(path, params);
  return callGraph({ method: 'GET', url, token });
}

export async function postGraph(path, token, payload) {
  const url = buildUrl(path);
  return callGraph({ method: 'POST', url, token, payload });
}

export function extractWamid(resp) {
  try {
    const id = resp?.messages?.[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export async function exchangeOAuthCode({ code, redirectUri, appId, appSecret }) {
  if (!code || !redirectUri || !appId || !appSecret) {
    throw new Error('oauth_missing_params');
  }
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', String(appId));
  url.searchParams.set('client_secret', String(appSecret));
  url.searchParams.set('redirect_uri', String(redirectUri));
  url.searchParams.set('code', String(code));
  return callGraph({ method: 'GET', url: url.toString() });
}

function shouldRetryAccessTokenExchange(err) {
  const message = String(
    err?.body?.error?.message ||
    err?.body?.message ||
    err?.message ||
    ''
  ).toLowerCase();
  return message.includes('redirect_uri');
}

async function exchangeCodeWithOptionalRedirectUri({
  code,
  appId,
  appSecret,
  redirectUri,
  forceRedirectUri = false,
}) {
  if (!code || !appId || !appSecret) {
    throw new Error('oauth_missing_params');
  }
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', String(appId));
  url.searchParams.set('client_secret', String(appSecret));
  url.searchParams.set('code', String(code));
  if (forceRedirectUri && redirectUri) {
    url.searchParams.set('redirect_uri', String(redirectUri));
  }
  return callGraph({ method: 'GET', url: url.toString() });
}

export async function exchangeEmbeddedSignupCode({ code, appId, appSecret, redirectUri }) {
  const allowRedirectRetry = Boolean(String(redirectUri || '').trim());
  try {
    return await exchangeCodeWithOptionalRedirectUri({
      code,
      appId,
      appSecret,
      redirectUri,
      forceRedirectUri: false,
    });
  } catch (err) {
    if (!allowRedirectRetry || !shouldRetryAccessTokenExchange(err)) {
      throw err;
    }
    return exchangeCodeWithOptionalRedirectUri({
      code,
      appId,
      appSecret,
      redirectUri,
      forceRedirectUri: true,
    });
  }
}

function listData(value) {
  return Array.isArray(value?.data) ? value.data : [];
}

function mergeWabas(target, source, items) {
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const key = item.id ? String(item.id) : `${source}:${index}`;
    const current = target.get(key);
    if (!current) {
      target.set(key, { ...item, _source: source });
      return;
    }
    const nextPhones = listData(item.phone_numbers);
    target.set(key, {
      ...current,
      ...item,
      phone_numbers: nextPhones.length ? item.phone_numbers : current.phone_numbers,
      _source: current._source === source ? current._source : `${current._source},${source}`,
    });
  });
}

export async function fetchWabaAssets(accessToken, options = {}) {
  const graphGet = typeof options.graphGet === 'function' ? options.graphGet : getGraph;
  const result = {
    businessId: null,
    businessName: null,
    wabaId: null,
    wabaName: null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    verifiedName: null,
    trace: {
      meId: null,
      sources: [],
      rawKeys: {},
      wabaCount: 0,
      phoneNumbersCount: 0,
    },
  };
  const wabaMap = new Map();

  try {
    const businesses = await graphGet('me/businesses', accessToken, { fields: 'id,name', limit: 1 });
    result.trace.sources.push('me/businesses');
    result.trace.rawKeys.me_businesses = Object.keys(businesses || {});
    result.businessId = businesses?.data?.[0]?.id || null;
    result.businessName = businesses?.data?.[0]?.name || null;
  } catch {}

  try {
    const me = await graphGet('me', accessToken, {
      fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
    });
    result.trace.sources.push('me');
    result.trace.rawKeys.me = Object.keys(me || {});
    result.trace.meId = me?.id ? String(me.id) : null;
    mergeWabas(wabaMap, 'me', listData(me?.whatsapp_business_accounts));
  } catch {}

  try {
    const direct = await graphGet('me/whatsapp_business_accounts', accessToken, {
      fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
      limit: 10,
    });
    result.trace.sources.push('me/whatsapp_business_accounts');
    result.trace.rawKeys.me_whatsapp_business_accounts = Object.keys(direct || {});
    mergeWabas(wabaMap, 'me/whatsapp_business_accounts', listData(direct));
  } catch {}

  if (result.businessId) {
    try {
      const owned = await graphGet(`${result.businessId}/owned_whatsapp_business_accounts`, accessToken, {
        fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
        limit: 10,
      });
      result.trace.sources.push('owned_whatsapp_business_accounts');
      result.trace.rawKeys.owned_whatsapp_business_accounts = Object.keys(owned || {});
      mergeWabas(wabaMap, 'owned_whatsapp_business_accounts', listData(owned));
    } catch {}
  }

  const wabas = Array.from(wabaMap.values());
  result.trace.wabaCount = wabas.length;

  for (const waba of wabas) {
    if (!waba?.id) continue;
    let phones = listData(waba.phone_numbers);
    result.trace.phoneNumbersCount += phones.length;
    if (!phones.length) {
      try {
        const phoneResp = await graphGet(`${waba.id}/phone_numbers`, accessToken, {
          fields: 'id,display_phone_number,verified_name',
          limit: 10,
        });
        result.trace.rawKeys[`phone_numbers:${waba.id}`] = Object.keys(phoneResp || {});
        phones = listData(phoneResp);
        result.trace.phoneNumbersCount += phones.length;
      } catch {}
    }
    const phone = phones[0];
    if (!phone?.id) continue;
    result.wabaId = String(waba.id);
    result.wabaName = waba?.name ? String(waba.name) : null;
    result.phoneNumberId = String(phone.id);
    if (phone?.display_phone_number) {
      result.displayPhoneNumber = String(phone.display_phone_number);
    }
    if (phone?.verified_name) {
      result.verifiedName = String(phone.verified_name);
    }
    break;
  }

  if (!result.displayPhoneNumber && result.phoneNumberId) {
    try {
      const phoneDetails = await graphGet(result.phoneNumberId, accessToken, {
        fields: 'id,display_phone_number,verified_name',
      });
      result.trace.rawKeys.phone_details = Object.keys(phoneDetails || {});
      if (phoneDetails?.display_phone_number) {
        result.displayPhoneNumber = String(phoneDetails.display_phone_number);
      }
      if (phoneDetails?.verified_name) {
        result.verifiedName = String(phoneDetails.verified_name);
      }
    } catch {}
  }

  return result;
}

export async function fetchPhoneNumberDetails(accessToken, phoneNumberId) {
  if (!accessToken || !phoneNumberId) return null;
  return getGraph(String(phoneNumberId), accessToken, {
    fields: 'id,display_phone_number,verified_name,name_status,quality_rating',
  });
}

export async function fetchWabaDetails(accessToken, wabaId) {
  if (!accessToken || !wabaId) return null;
  return getGraph(String(wabaId), accessToken, {
    fields: 'id,name',
  });
}

export async function sendWhatsAppMessage({ accessToken, phoneNumberId, payload }) {
  if (!accessToken || !phoneNumberId) {
    throw new Error('wa_missing_token_or_phone');
  }
  try {
    return await postGraph(`${phoneNumberId}/messages`, accessToken, payload);
  } catch (err) {
    if (err?.status >= 400) {
      const error = err?.body?.error;
      const data = (error && typeof error === 'object')
        ? {
            message: error.message,
            code: error.code,
            error_data: error.error_data,
            fbtrace_id: error.fbtrace_id,
          }
        : err?.body;
      console.error('[wa/graph/error]', { status: err?.status || null, data });
    }
    throw err;
  }
}
