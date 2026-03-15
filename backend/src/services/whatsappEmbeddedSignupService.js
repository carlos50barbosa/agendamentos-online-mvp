import { encryptAccessToken } from './waCrypto.js';
import {
  exchangeEmbeddedSignupCode,
  fetchPhoneNumberDetails,
  fetchWabaAssets,
  fetchWabaDetails,
} from './waGraph.js';
import {
  disconnectWaAccount,
  getWaAccountByEstabelecimentoId,
  getWaAccountByPhoneNumberId,
  releaseWaPhoneNumberFromAccount,
  upsertWaAccount,
} from './waTenant.js';

const APP_ID = String(process.env.WA_APP_ID || '').trim();
const APP_SECRET = String(process.env.WA_APP_SECRET || '').trim();
const API_VERSION = String(process.env.WA_API_VERSION || 'v24.0').trim() || 'v24.0';
const CONFIG_ID = String(
  process.env.WA_EMBEDDED_SIGNUP_CONFIG_ID ||
  process.env.WA_FB_LOGIN_CONFIG_ID ||
  ''
).trim();
const SDK_LOCALE = String(process.env.WA_EMBEDDED_SIGNUP_SDK_LOCALE || 'en_US').trim() || 'en_US';
const SESSION_INFO_VERSION = String(process.env.WA_EMBEDDED_SIGNUP_SESSION_INFO_VERSION || '3').trim() || '3';
const FEATURE = String(process.env.WA_EMBEDDED_SIGNUP_FEATURE || 'whatsapp_embedded_signup').trim() || 'whatsapp_embedded_signup';
const FEATURE_TYPE = String(process.env.WA_EMBEDDED_SIGNUP_FEATURE_TYPE || '').trim();
const FLOW_VERSION = String(process.env.WA_EMBEDDED_SIGNUP_FLOW_VERSION || '').trim();
const REDIRECT_URI = String(
  process.env.WA_EMBEDDED_SIGNUP_REDIRECT_URI ||
  process.env.META_REDIRECT_URI ||
  ''
).trim();

function createHttpError(status, code, message, details) {
  const err = new Error(message || code || 'wa_embedded_signup_error');
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function maskToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function truncate(value, max = 255) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function sanitizeGraphError(err) {
  const error = err?.body?.error && typeof err.body.error === 'object'
    ? err.body.error
    : null;
  return {
    status: Number(err?.status || 0) || null,
    message: truncate(error?.message || err?.message || 'graph_error', 500),
    code: error?.code ?? err?.code ?? null,
    error_subcode: error?.error_subcode ?? null,
    fbtrace_id: error?.fbtrace_id ?? null,
    error_data: error?.error_data ?? null,
  };
}

export function normalizeEmbeddedSignupSessionInfo(sessionInfo) {
  const parsed = parseJsonSafe(sessionInfo);
  if (!parsed || typeof parsed !== 'object') return null;
  const rawData = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  return {
    type: typeof parsed.type === 'string' ? parsed.type : 'WA_EMBEDDED_SIGNUP',
    event: typeof parsed.event === 'string' ? parsed.event.toUpperCase() : null,
    version: parsed.version != null ? String(parsed.version) : null,
    origin: typeof parsed.origin === 'string' ? parsed.origin : null,
    current_step: typeof rawData.current_step === 'string' ? rawData.current_step : null,
    error_message: truncate(rawData.error_message || rawData.error || parsed.error_message || null, 500),
    error_code: rawData.error_code || parsed.error_code || null,
    waba_id: rawData.waba_id ? String(rawData.waba_id) : null,
    phone_number_id: rawData.phone_number_id ? String(rawData.phone_number_id) : null,
    business_account_id:
      rawData.business_id != null
        ? String(rawData.business_id)
        : (rawData.business_account_id != null ? String(rawData.business_account_id) : null),
    display_phone_number:
      rawData.display_phone_number != null ? String(rawData.display_phone_number) : null,
    raw: parsed,
  };
}

function buildEmbeddedSignupExtras() {
  const extras = {
    feature: FEATURE,
    sessionInfoVersion: SESSION_INFO_VERSION,
    setup: {},
  };
  if (FEATURE_TYPE) extras.featureType = FEATURE_TYPE;
  if (FLOW_VERSION) extras.version = FLOW_VERSION;
  return extras;
}

function ensureEmbeddedSignupConfigured() {
  if (!APP_ID || !APP_SECRET || !CONFIG_ID) {
    throw createHttpError(
      500,
      'wa_embedded_signup_config_missing',
      'A configuracao do Embedded Signup da Meta esta incompleta no backend.',
      {
        app_id: Boolean(APP_ID),
        app_secret: Boolean(APP_SECRET),
        config_id: Boolean(CONFIG_ID),
      }
    );
  }
}

function serializeAccount(account) {
  if (!account) {
    return {
      connected: false,
      status: 'not_connected',
      account: null,
    };
  }

  const metadata = account?.metadata || parseJsonSafe(account?.metadata_json) || null;
  const connected = String(account.status || '').toLowerCase() === 'connected'
    && Boolean(account.phone_number_id)
    && Boolean(account.access_token_enc);

  const serialized = {
    id: account.id || null,
    estabelecimento_id: account.estabelecimento_id || null,
    provider: account.provider || 'meta_cloud',
    connected,
    status: account.status || (connected ? 'connected' : 'disconnected'),
    waba_id: account.waba_id || null,
    phone_number_id: account.phone_number_id || null,
    business_account_id: account.business_id || null,
    display_phone_number: account.display_phone_number || null,
    verified_name: account.verified_name || null,
    connected_at: toIso(account.connected_at),
    disconnected_at: toIso(account.disconnected_at),
    last_sync_at: toIso(account.last_sync_at || account.updated_at || account.connected_at),
    token_last_validated_at: toIso(account.token_last_validated_at),
    updated_at: toIso(account.updated_at),
    last_error: account.last_error || null,
    business_name:
      metadata?.waba?.name ||
      metadata?.graph?.wabaName ||
      metadata?.graph?.businessName ||
      null,
    onboarding_source: metadata?.onboarding?.source || null,
  };

  return {
    connected,
    status: serialized.status,
    account: serialized,
  };
}

function describeEmbeddedSignupError(err) {
  const graph = sanitizeGraphError(err);
  const message = String(graph.message || err?.message || '').toLowerCase();

  if (graph.code === 190 || message.includes('invalid oauth access token')) {
    return {
      status: 401,
      code: 'wa_embedded_signup_token_invalid',
      message: 'A Meta retornou um token invalido para o WhatsApp. Tente conectar novamente.',
      graph,
    };
  }

  if (graph.code === 10 || graph.code === 200 || message.includes('permission')) {
    return {
      status: 403,
      code: 'wa_embedded_signup_permission_missing',
      message: 'A conexao foi autorizada, mas faltam permissoes da Meta para concluir o WhatsApp.',
      graph,
    };
  }

  if (message.includes('code') && message.includes('expired')) {
    return {
      status: 400,
      code: 'wa_embedded_signup_code_expired',
      message: 'O codigo do Embedded Signup expirou antes da troca. Inicie a conexao novamente.',
      graph,
    };
  }

  return {
    status: Number(err?.status || 502) || 502,
    code: err?.code || 'wa_embedded_signup_failed',
    message: truncate(err?.message || 'Falha ao concluir o Embedded Signup do WhatsApp.', 500),
    graph,
  };
}

export function mergeResolvedAssets({ graphAssets, sessionInfo, phoneDetails, wabaDetails }) {
  const assets = graphAssets || {};
  const session = sessionInfo || {};
  const phone = phoneDetails || {};
  const waba = wabaDetails || {};
  return {
    wabaId: assets.wabaId || session.waba_id || null,
    phoneNumberId: assets.phoneNumberId || session.phone_number_id || null,
    businessId: assets.businessId || session.business_account_id || null,
    displayPhoneNumber:
      phone.display_phone_number ||
      assets.displayPhoneNumber ||
      session.display_phone_number ||
      null,
    verifiedName:
      phone.verified_name ||
      assets.verifiedName ||
      null,
    businessName:
      waba.name ||
      assets.wabaName ||
      assets.businessName ||
      null,
  };
}

async function persistAccountError({
  estabelecimentoId,
  sessionInfo,
  status = 'error',
  lastError,
  metadata,
  accessTokenEnc,
  tokenLast4,
}) {
  return upsertWaAccount(estabelecimentoId, {
    provider: 'meta_embedded_signup',
    status,
    access_token_enc: accessTokenEnc,
    token_last4: tokenLast4,
    connected_at: null,
    disconnected_at: null,
    token_last_validated_at: accessTokenEnc ? new Date() : null,
    last_sync_at: new Date(),
    last_error: truncate(lastError, 255),
    metadata_json: {
      onboarding: {
        flow: 'meta_embedded_signup',
        source: 'embedded_signup_exchange',
      },
      session_info: sessionInfo || null,
      ...metadata,
    },
  });
}

export function getEmbeddedSignupPublicConfig() {
  ensureEmbeddedSignupConfigured();
  return {
    app_id: APP_ID,
    config_id: CONFIG_ID,
    api_version: API_VERSION,
    sdk_locale: SDK_LOCALE,
    response_type: 'code',
    override_default_response_type: true,
    extras: buildEmbeddedSignupExtras(),
  };
}

export async function getTenantWhatsAppAccount(estabelecimentoId) {
  const account = await getWaAccountByEstabelecimentoId(estabelecimentoId);
  return serializeAccount(account);
}

export async function disconnectTenantWhatsAppAccount(estabelecimentoId) {
  await disconnectWaAccount(estabelecimentoId);
  const account = await getWaAccountByEstabelecimentoId(estabelecimentoId);
  return serializeAccount(account);
}

export async function completeEmbeddedSignup({
  estabelecimentoId,
  code,
  sessionInfo,
}) {
  ensureEmbeddedSignupConfigured();

  const tenantId = Number(estabelecimentoId || 0);
  const signupCode = String(code || '').trim();
  if (!tenantId) {
    throw createHttpError(401, 'wa_embedded_signup_unauthorized', 'Tenant nao autenticado.');
  }
  if (!signupCode) {
    throw createHttpError(400, 'wa_embedded_signup_code_missing', 'Codigo do Embedded Signup ausente.');
  }

  const normalizedSession = normalizeEmbeddedSignupSessionInfo(sessionInfo);
  console.info('[wa][embedded-signup][exchange:start]', {
    estabelecimento_id: tenantId,
    code: maskToken(signupCode),
    session_event: normalizedSession?.event || null,
    session_waba_id: normalizedSession?.waba_id || null,
    session_phone_number_id: normalizedSession?.phone_number_id || null,
  });

  let tokenResponse = null;
  try {
    tokenResponse = await exchangeEmbeddedSignupCode({
      code: signupCode,
      appId: APP_ID,
      appSecret: APP_SECRET,
      redirectUri: REDIRECT_URI || undefined,
    });
  } catch (err) {
    const info = describeEmbeddedSignupError(err);
    console.error('[wa][embedded-signup][exchange:token_error]', {
      estabelecimento_id: tenantId,
      error: info.graph,
    });
    await persistAccountError({
      estabelecimentoId: tenantId,
      sessionInfo: normalizedSession,
      lastError: info.code,
      metadata: {
        phase: 'token_exchange',
        graph_error: info.graph,
      },
      accessTokenEnc: null,
      tokenLast4: null,
    }).catch(() => null);
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  const accessToken = String(tokenResponse?.access_token || '').trim();
  if (!accessToken) {
    await persistAccountError({
      estabelecimentoId: tenantId,
      sessionInfo: normalizedSession,
      lastError: 'missing_access_token',
      metadata: {
        phase: 'token_exchange',
        token_response: {
          keys: tokenResponse ? Object.keys(tokenResponse) : [],
        },
      },
      accessTokenEnc: null,
      tokenLast4: null,
    }).catch(() => null);
    throw createHttpError(
      502,
      'wa_embedded_signup_missing_access_token',
      'A Meta nao retornou um access token valido para o WhatsApp.'
    );
  }

  const encryptedToken = encryptAccessToken(accessToken);
  let graphAssets = null;
  try {
    graphAssets = await fetchWabaAssets(accessToken);
  } catch (err) {
    const info = describeEmbeddedSignupError(err);
    console.error('[wa][embedded-signup][exchange:asset_error]', {
      estabelecimento_id: tenantId,
      error: info.graph,
    });
    await persistAccountError({
      estabelecimentoId: tenantId,
      sessionInfo: normalizedSession,
      lastError: info.code,
      metadata: {
        phase: 'fetch_assets',
        graph_error: info.graph,
      },
      accessTokenEnc: encryptedToken.enc,
      tokenLast4: encryptedToken.last4,
    }).catch(() => null);
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  const resolvedIds = mergeResolvedAssets({
    graphAssets,
    sessionInfo: normalizedSession,
  });
  const phoneDetails = resolvedIds.phoneNumberId
    ? await fetchPhoneNumberDetails(accessToken, resolvedIds.phoneNumberId).catch(() => null)
    : null;
  const wabaDetails = resolvedIds.wabaId
    ? await fetchWabaDetails(accessToken, resolvedIds.wabaId).catch(() => null)
    : null;
  const resolvedAssets = mergeResolvedAssets({
    graphAssets,
    sessionInfo: normalizedSession,
    phoneDetails,
    wabaDetails,
  });

  const missingAssets = [];
  if (!resolvedAssets.wabaId) missingAssets.push('waba_id');
  if (!resolvedAssets.phoneNumberId) missingAssets.push('phone_number_id');

  if (missingAssets.length) {
    console.warn('[wa][embedded-signup][exchange:missing_assets]', {
      estabelecimento_id: tenantId,
      missing_assets: missingAssets,
      graph_trace: graphAssets?.trace || null,
    });
    await persistAccountError({
      estabelecimentoId: tenantId,
      sessionInfo: normalizedSession,
      lastError: `missing_assets:${missingAssets.join(',')}`,
      metadata: {
        phase: 'asset_validation',
        missing_assets: missingAssets,
        graph: graphAssets,
      },
      accessTokenEnc: encryptedToken.enc,
      tokenLast4: encryptedToken.last4,
    }).catch(() => null);
    throw createHttpError(
      422,
      'wa_embedded_signup_missing_assets',
      `A Meta concluiu a autorizacao, mas nao retornou ${missingAssets.join(', ')}. Reconecte o WhatsApp e tente novamente.`,
      { missing_assets: missingAssets }
    );
  }

  const conflictingAccount = await getWaAccountByPhoneNumberId(resolvedAssets.phoneNumberId);
  if (
    conflictingAccount &&
    Number(conflictingAccount.estabelecimento_id) !== tenantId
  ) {
    const conflictingConnected = String(conflictingAccount.status || '').toLowerCase() === 'connected';
    if (conflictingConnected) {
      console.warn('[wa][embedded-signup][exchange:phone_in_use]', {
        estabelecimento_id: tenantId,
        phone_number_id: resolvedAssets.phoneNumberId,
        conflicting_estabelecimento_id: conflictingAccount.estabelecimento_id,
      });
      await persistAccountError({
        estabelecimentoId: tenantId,
        sessionInfo: normalizedSession,
        lastError: 'phone_in_use',
        metadata: {
          phase: 'conflict_check',
          conflicting_estabelecimento_id: conflictingAccount.estabelecimento_id,
        },
        accessTokenEnc: null,
        tokenLast4: null,
      }).catch(() => null);
      throw createHttpError(
        409,
        'wa_embedded_signup_phone_in_use',
        'Esse numero ja esta conectado a outro estabelecimento no Agendamentos Online.'
      );
    }

    await releaseWaPhoneNumberFromAccount(conflictingAccount.estabelecimento_id).catch(() => null);
  }

  const persisted = await upsertWaAccount(tenantId, {
    provider: 'meta_embedded_signup',
    waba_id: resolvedAssets.wabaId,
    phone_number_id: resolvedAssets.phoneNumberId,
    display_phone_number: resolvedAssets.displayPhoneNumber,
    verified_name: resolvedAssets.verifiedName,
    business_id: resolvedAssets.businessId,
    access_token_enc: encryptedToken.enc,
    token_last4: encryptedToken.last4,
    status: 'connected',
    connected_at: new Date(),
    disconnected_at: null,
    token_last_validated_at: new Date(),
    last_sync_at: new Date(),
    last_error: null,
    metadata_json: {
      onboarding: {
        flow: 'meta_embedded_signup',
        source: 'embedded_signup_exchange',
      },
      session_info: normalizedSession,
      graph: graphAssets,
      waba: wabaDetails ? { id: wabaDetails.id || resolvedAssets.wabaId, name: wabaDetails.name || null } : null,
      phone: phoneDetails
        ? {
            id: phoneDetails.id || resolvedAssets.phoneNumberId,
            display_phone_number: phoneDetails.display_phone_number || resolvedAssets.displayPhoneNumber,
            verified_name: phoneDetails.verified_name || resolvedAssets.verifiedName,
            name_status: phoneDetails.name_status || null,
            quality_rating: phoneDetails.quality_rating || null,
          }
        : null,
    },
  });

  console.info('[wa][embedded-signup][exchange:connected]', {
    estabelecimento_id: tenantId,
    provider: persisted?.provider || 'meta_embedded_signup',
    waba_id: persisted?.waba_id || null,
    phone_number_id: persisted?.phone_number_id || null,
    verified_name: persisted?.verified_name || null,
  });

  return serializeAccount(persisted);
}
