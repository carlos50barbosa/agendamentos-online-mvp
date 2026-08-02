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

/**
 * Assina NOSSO app aos webhooks da WABA do tenant.
 *
 * Sem isto, o Embedded Signup termina "com sucesso", a tela mostra Conectado — e nenhuma mensagem
 * dos clientes daquele salão chega. É a falha mais confusa possível: não há erro em lugar nenhum,
 * só silêncio. A assinatura é por WABA e é feita UMA vez, no fim da conexão.
 */
export async function subscribeAppToWaba({ accessToken, wabaId }) {
  if (!accessToken || !wabaId) throw new Error('wa_missing_token_or_waba');
  return postGraph(`${wabaId}/subscribed_apps`, accessToken, {});
}

/** Confere o que já está assinado — usado para diagnosticar "conectou mas não chega nada". */
export async function listWabaSubscribedApps({ accessToken, wabaId }) {
  if (!accessToken || !wabaId) return null;
  return getGraph(`${wabaId}/subscribed_apps`, accessToken);
}

/**
 * Registra o número na Cloud API. Obrigatório antes do primeiro envio: número não registrado
 * responde erro 133010 ("not registered") em toda mensagem.
 *
 * O `pin` é o PIN de verificação em duas etapas. Quando o número NUNCA teve 2FA, a Meta aceita
 * definir um agora; se o tenant já tinha um PIN diferente, a chamada falha com 136024 e não há como
 * adivinhar — nesse caso quem tem de informar é o dono, e o erro precisa chegar legível na tela.
 */
export async function registerWhatsAppPhoneNumber({ accessToken, phoneNumberId, pin }) {
  if (!accessToken || !phoneNumberId) throw new Error('wa_missing_token_or_phone');
  const codigo = String(pin || '').trim();
  if (!/^\d{6}$/.test(codigo)) throw new Error('wa_invalid_pin');
  return postGraph(`${phoneNumberId}/register`, accessToken, {
    messaging_product: 'whatsapp',
    pin: codigo,
  });
}

/**
 * Cria um modelo de mensagem na WABA indicada.
 *
 * Modelo pertence a UMA WABA: os aprovados da plataforma não existem na conta do tenant, e sem
 * modelo próprio todo envio fora da janela de 24h falha para os clientes dele. Ver
 * lib/wa_template_catalog.js.
 */
export async function createWhatsAppTemplate({ accessToken, wabaId, template }) {
  if (!accessToken || !wabaId) throw new Error('wa_missing_token_or_waba');
  if (!template?.name || !template?.components?.length) throw new Error('wa_invalid_template');
  return postGraph(`${wabaId}/message_templates`, accessToken, {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  });
}

/**
 * O erro de nome já usado não é falha: significa que o modelo existe naquela WABA — o caso normal
 * de uma reconexão. Tratar como erro faria toda reconexão parecer quebrada.
 */
export function isDuplicateTemplateError(err) {
  const error = err?.body?.error;
  if (!error) return false;
  const texto = `${error.message || ''} ${error.error_user_msg || ''}`.toLowerCase();
  return texto.includes('already exists') || texto.includes('ja existe') || texto.includes('já existe');
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
