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
method, headers, body: payload ? JSON.stringify(payload) : undefined, });
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

export async function fetchWabaAssets(accessToken) {
const result = {
businessId: null, wabaId: null, phoneNumberId: null, displayPhoneNumber: null, };
try {
const businesses = await getGraph('me/businesses', accessToken, { fields: 'id,name', limit: 1 });
result.businessId = businesses?.data?.[0]?.id || null;
} catch {}
let wabas = [];
try {
const me = await getGraph('me', accessToken, {
fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}', });
wabas = me?.whatsapp_business_accounts?.data || [];
} catch {}
if (!wabas.length) {
try {
const direct = await getGraph('me/whatsapp_business_accounts', accessToken, {
fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}', limit: 5, });
wabas = direct?.data || [];
} catch {}
}

  if (!wabas.length && result.businessId) {
try {
const owned = await getGraph(`${result.businessId}/owned_whatsapp_business_accounts`, accessToken, {
fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}', limit: 5, });
wabas = owned?.data || [];
} catch {}
}

  const waba = wabas[0];
if (waba?.id) result.wabaId = String(waba.id);
let phones = waba?.phone_numbers?.data || [];
if (!phones.length && result.wabaId) {
try {
const phoneResp = await getGraph(`${result.wabaId}/phone_numbers`, accessToken, {
fields: 'id,display_phone_number,verified_name', limit: 10, });
phones = phoneResp?.data || [];
} catch {}
}

  const phone = phones[0];
if (phone?.id) result.phoneNumberId = String(phone.id);
if (phone?.display_phone_number) result.displayPhoneNumber = String(phone.display_phone_number);
if (!result.displayPhoneNumber && result.phoneNumberId) {
try {
const phoneDetails = await getGraph(result.phoneNumberId, accessToken, {
fields: 'display_phone_number,verified_name', });
if (phoneDetails?.display_phone_number) {
result.displayPhoneNumber = String(phoneDetails.display_phone_number);
}
    } catch {}
}

  return result;
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
const data = (error && typeof error === 'object') || {
            message: error.message, code: error.code, error_data: error.error_data, fbtrace_id: error.fbtrace_id, } ? : err?.body;
console.error('[wa/graph/error]', { status: err?.status || null, data });
}
    throw err;
}
}


