import { encryptAccessToken } from './waCrypto.js';
import {
  fetchPhoneNumberDetails,
  fetchWabaAssets,
  fetchWabaDetails,
  getGraph,
} from './waGraph.js';
import {
  disconnectWaAccount,
  getWaAccountByEstabelecimentoId,
  getWaAccountByPhoneNumberId,
  releaseWaPhoneNumberFromAccount,
  upsertWaAccount,
} from './waTenant.js';

const MANUAL_PROVIDER = 'meta_manual_cloud_api';
const PHONE_FIELDS = 'id,display_phone_number,verified_name,name_status,quality_rating';

function createHttpError(status, code, message, details) {
  const err = new Error(message || code || 'wa_manual_connect_error');
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
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

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function maskToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function normalizeText(value, max = 255) {
  const text = String(value || '').trim();
  if (!text) return null;
  return truncate(text, max);
}

function normalizeId(value) {
  return normalizeText(value, 64);
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
      metadata?.business?.name ||
      metadata?.waba?.name ||
      metadata?.graph?.businessName ||
      null,
    descriptive_name:
      metadata?.manual_input?.descriptive_name ||
      metadata?.manual_input?.label ||
      null,
    onboarding_source: metadata?.onboarding?.source || null,
  };

  return {
    connected,
    status: serialized.status,
    account: serialized,
  };
}

function describeGraphFailure(err, phase) {
  const graph = sanitizeGraphError(err);
  const message = String(graph.message || err?.message || '').toLowerCase();

  if (graph.code === 190 || message.includes('invalid oauth access token')) {
    return {
      status: 401,
      code: 'wa_manual_token_invalid',
      message: 'O access token informado e invalido ou expirou. Gere um token valido na Meta e tente novamente.',
      graph,
    };
  }

  if (graph.code === 10 || graph.code === 200 || message.includes('permission')) {
    return {
      status: 403,
      code: 'wa_manual_permission_missing',
      message: 'O token informado nao possui permissoes suficientes para acessar a WhatsApp Cloud API.',
      graph,
    };
  }

  if (phase === 'phone' && (graph.code === 100 || graph.status === 404 || message.includes('unsupported get request'))) {
    return {
      status: 422,
      code: 'wa_manual_phone_not_found',
      message: 'O phone_number_id informado nao foi encontrado ou nao pertence a esse token.',
      graph,
    };
  }

  if (phase === 'waba' && (graph.code === 100 || graph.status === 404 || message.includes('unsupported get request'))) {
    return {
      status: 422,
      code: 'wa_manual_waba_not_found',
      message: 'O WABA ID informado nao foi encontrado ou nao pertence a esse token.',
      graph,
    };
  }

  if (phase === 'business' && (graph.code === 100 || graph.status === 404 || message.includes('unsupported get request'))) {
    return {
      status: 422,
      code: 'wa_manual_business_not_found',
      message: 'O Business Account ID informado nao foi encontrado ou nao pertence a esse token.',
      graph,
    };
  }

  return {
    status: Number(err?.status || 502) || 502,
    code: err?.code || `wa_manual_${phase}_failed`,
    message: truncate(err?.message || 'Falha ao validar os dados do WhatsApp na Meta.', 500),
    graph,
  };
}

function normalizeManualInput(payload = {}) {
  return {
    businessAccountId: normalizeId(
      payload.business_account_id ??
      payload.business_id ??
      payload.businessManagerId ??
      payload.businessAccountId
    ),
    wabaId: normalizeId(payload.waba_id ?? payload.wabaId),
    phoneNumberId: normalizeId(payload.phone_number_id ?? payload.phoneNumberId),
    accessToken: String(payload.access_token ?? payload.accessToken ?? '').trim(),
    descriptiveName: normalizeText(
      payload.descriptive_name ??
      payload.descriptiveName ??
      payload.label ??
      payload.name,
      120
    ),
  };
}

function assertManualInput(input) {
  const missing = [];
  if (!input.wabaId) missing.push('waba_id');
  if (!input.phoneNumberId) missing.push('phone_number_id');
  if (!input.accessToken) missing.push('access_token');
  if (missing.length) {
    throw createHttpError(
      400,
      'wa_manual_missing_fields',
      `Preencha ${missing.join(', ')} antes de validar a conexao.`,
      { missing_fields: missing }
    );
  }
}

async function fetchWabaPhoneNumbers(accessToken, wabaId, deps = {}) {
  const graphGet = deps.getGraph || getGraph;
  const items = [];
  let after = null;
  let guard = 0;

  do {
    const response = await graphGet(`${wabaId}/phone_numbers`, accessToken, {
      fields: PHONE_FIELDS,
      limit: 100,
      after,
    });
    const chunk = Array.isArray(response?.data) ? response.data : [];
    items.push(...chunk);
    after = response?.paging?.cursors?.after || null;
    guard += 1;
  } while (after && guard < 10);

  return items;
}

async function validateBusinessOwnership(accessToken, businessAccountId, wabaId, deps = {}) {
  if (!businessAccountId) return null;
  const graphGet = deps.getGraph || getGraph;
  let business = null;
  try {
    business = await graphGet(String(businessAccountId), accessToken, { fields: 'id,name' });
  } catch (err) {
    const info = describeGraphFailure(err, 'business');
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  let owned = null;
  try {
    owned = await graphGet(`${businessAccountId}/owned_whatsapp_business_accounts`, accessToken, {
      fields: 'id,name',
      limit: 200,
    });
  } catch (err) {
    const info = describeGraphFailure(err, 'business');
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  const matches = Array.isArray(owned?.data)
    ? owned.data.some((item) => String(item?.id || '') === String(wabaId))
    : false;
  if (!matches) {
    throw createHttpError(
      422,
      'wa_manual_business_mismatch',
      'O Business Account ID informado nao possui o WABA ID fornecido.',
      { business_account_id: businessAccountId, waba_id: wabaId }
    );
  }

  return {
    id: normalizeId(business?.id || businessAccountId),
    name: normalizeText(business?.name, 255),
  };
}

async function discoverBusinessContext(accessToken, wabaId, deps = {}) {
  const fetchAssets = deps.fetchWabaAssets || fetchWabaAssets;
  try {
    const assets = await fetchAssets(accessToken);
    if (String(assets?.wabaId || '') !== String(wabaId)) {
      return null;
    }
    return {
      id: normalizeId(assets.businessId),
      name: normalizeText(assets.businessName, 255),
      trace: assets?.trace || null,
    };
  } catch {
    return null;
  }
}

function buildValidationPreview(input, resolved, now) {
  return {
    provider: MANUAL_PROVIDER,
    status: 'validating',
    business_account_id: resolved.business?.id || input.businessAccountId || null,
    business_name: resolved.business?.name || resolved.waba?.name || null,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    display_phone_number: resolved.phone.display_phone_number || null,
    verified_name: resolved.phone.verified_name || null,
    descriptive_name: input.descriptiveName || null,
    name_status: resolved.phone.name_status || null,
    quality_rating: resolved.phone.quality_rating || null,
    token_last4: input.accessToken.slice(-4) || null,
    token_masked: maskToken(input.accessToken),
    validated_at: now.toISOString(),
    token_last_validated_at: now.toISOString(),
  };
}

function buildMetadata(input, resolved, now, businessTrace = null) {
  return {
    onboarding: {
      flow: 'meta_manual_assisted',
      source: 'manual_connect_form',
    },
    manual_input: {
      business_account_id: input.businessAccountId || null,
      descriptive_name: input.descriptiveName || null,
    },
    business: resolved.business
      ? {
          id: resolved.business.id || null,
          name: resolved.business.name || null,
        }
      : null,
    waba: {
      id: input.wabaId,
      name: resolved.waba?.name || null,
    },
    phone: {
      id: input.phoneNumberId,
      display_phone_number: resolved.phone.display_phone_number || null,
      verified_name: resolved.phone.verified_name || null,
      name_status: resolved.phone.name_status || null,
      quality_rating: resolved.phone.quality_rating || null,
    },
    validation: {
      validated_at: now.toISOString(),
      token_last4: input.accessToken.slice(-4) || null,
      mode: 'manual_assisted',
    },
    graph: businessTrace ? { business_trace: businessTrace } : null,
  };
}

async function runManualValidation({ estabelecimentoId, payload }, deps = {}) {
  const tenantId = Number(estabelecimentoId || 0) || null;
  const input = normalizeManualInput(payload);
  assertManualInput(input);

  console.info('[wa][manual][validate:start]', {
    estabelecimento_id: tenantId,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    business_account_id: input.businessAccountId,
    token: maskToken(input.accessToken),
  });

  const phoneFetcher = deps.fetchPhoneNumberDetails || fetchPhoneNumberDetails;
  const wabaFetcher = deps.fetchWabaDetails || fetchWabaDetails;

  let phoneDetails = null;
  try {
    phoneDetails = await phoneFetcher(input.accessToken, input.phoneNumberId);
  } catch (err) {
    const info = describeGraphFailure(err, 'phone');
    console.warn('[wa][manual][validate:phone_error]', {
      estabelecimento_id: tenantId,
      phone_number_id: input.phoneNumberId,
      error: info.graph,
    });
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  let wabaDetails = null;
  try {
    wabaDetails = await wabaFetcher(input.accessToken, input.wabaId);
  } catch (err) {
    const info = describeGraphFailure(err, 'waba');
    console.warn('[wa][manual][validate:waba_error]', {
      estabelecimento_id: tenantId,
      waba_id: input.wabaId,
      error: info.graph,
    });
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  let phones = null;
  try {
    phones = await fetchWabaPhoneNumbers(input.accessToken, input.wabaId, deps);
  } catch (err) {
    const info = describeGraphFailure(err, 'waba');
    console.warn('[wa][manual][validate:waba_phones_error]', {
      estabelecimento_id: tenantId,
      waba_id: input.wabaId,
      error: info.graph,
    });
    throw createHttpError(info.status, info.code, info.message, info.graph);
  }

  const matchedPhone = Array.isArray(phones)
    ? phones.find((item) => String(item?.id || '') === String(input.phoneNumberId))
    : null;

  if (!matchedPhone) {
    console.warn('[wa][manual][validate:mismatch]', {
      estabelecimento_id: tenantId,
      waba_id: input.wabaId,
      phone_number_id: input.phoneNumberId,
      available_phone_ids: Array.isArray(phones) ? phones.map((item) => item?.id).filter(Boolean).slice(0, 20) : [],
    });
    throw createHttpError(
      422,
      'wa_manual_waba_phone_mismatch',
      'O phone_number_id informado nao pertence ao WABA ID fornecido.',
      {
        waba_id: input.wabaId,
        phone_number_id: input.phoneNumberId,
      }
    );
  }

  let business = null;
  let businessTrace = null;
  if (input.businessAccountId) {
    business = await validateBusinessOwnership(input.accessToken, input.businessAccountId, input.wabaId, deps);
  } else {
    const discoveredBusiness = await discoverBusinessContext(input.accessToken, input.wabaId, deps);
    if (discoveredBusiness) {
      business = {
        id: discoveredBusiness.id || null,
        name: discoveredBusiness.name || null,
      };
      businessTrace = discoveredBusiness.trace || null;
    }
  }

  const resolved = {
    business,
    waba: {
      id: normalizeId(wabaDetails?.id || input.wabaId),
      name: normalizeText(wabaDetails?.name, 255),
    },
    phone: {
      id: normalizeId(phoneDetails?.id || matchedPhone?.id || input.phoneNumberId),
      display_phone_number: normalizeText(
        phoneDetails?.display_phone_number ||
        matchedPhone?.display_phone_number,
        32
      ),
      verified_name: normalizeText(
        phoneDetails?.verified_name ||
        matchedPhone?.verified_name,
        255
      ),
      name_status: normalizeText(phoneDetails?.name_status || matchedPhone?.name_status, 64),
      quality_rating: normalizeText(phoneDetails?.quality_rating || matchedPhone?.quality_rating, 64),
    },
  };

  const now = new Date();
  const preview = buildValidationPreview(input, resolved, now);
  const metadata = buildMetadata(input, resolved, now, businessTrace);

  console.info('[wa][manual][validate:ok]', {
    estabelecimento_id: tenantId,
    waba_id: preview.waba_id,
    phone_number_id: preview.phone_number_id,
    business_account_id: preview.business_account_id,
  });

  return {
    valid: true,
    preview,
    normalized: {
      input,
      resolved,
      now,
      metadata,
    },
  };
}

async function persistConnectFailure({ estabelecimentoId, payload, code, message }, deps = {}) {
  const tenantId = Number(estabelecimentoId || 0) || null;
  if (!tenantId) return null;
  const getAccount = deps.getWaAccountByEstabelecimentoId || getWaAccountByEstabelecimentoId;
  const persistAccount = deps.upsertWaAccount || upsertWaAccount;
  const existing = await getAccount(tenantId).catch(() => null);

  if (String(existing?.status || '').toLowerCase() === 'connected' && existing?.access_token_enc) {
    return existing;
  }

  const input = normalizeManualInput(payload);
  return persistAccount(tenantId, {
    provider: MANUAL_PROVIDER,
    status: 'error',
    waba_id: input.wabaId || existing?.waba_id || null,
    phone_number_id: input.phoneNumberId || existing?.phone_number_id || null,
    business_id: input.businessAccountId || existing?.business_id || null,
    access_token_enc: null,
    token_last4: input.accessToken ? input.accessToken.slice(-4) : null,
    connected_at: null,
    disconnected_at: null,
    token_last_validated_at: null,
    last_sync_at: new Date(),
    last_error: truncate(code || message, 255),
    metadata_json: {
      onboarding: {
        flow: 'meta_manual_assisted',
        source: 'manual_connect_form',
      },
      error: {
        code: code || null,
        message: truncate(message, 500),
      },
    },
  });
}

export async function validateManualWhatsAppAccount({ estabelecimentoId, payload }, deps = {}) {
  const result = await runManualValidation({ estabelecimentoId, payload }, deps);
  return {
    valid: true,
    preview: result.preview,
  };
}

export async function connectManualWhatsAppAccount({ estabelecimentoId, payload }, deps = {}) {
  const tenantId = Number(estabelecimentoId || 0) || null;
  if (!tenantId) {
    throw createHttpError(401, 'wa_manual_unauthorized', 'Tenant nao autenticado.');
  }

  let validation = null;
  try {
    validation = await runManualValidation({ estabelecimentoId: tenantId, payload }, deps);
  } catch (err) {
    await persistConnectFailure({
      estabelecimentoId: tenantId,
      payload,
      code: err?.code || 'wa_manual_validation_failed',
      message: err?.message || 'Falha na validacao manual do WhatsApp.',
    }, deps).catch(() => null);
    throw err;
  }

  const {
    input,
    resolved,
    now,
    metadata,
  } = validation.normalized;

  const findByPhone = deps.getWaAccountByPhoneNumberId || getWaAccountByPhoneNumberId;
  const releasePhone = deps.releaseWaPhoneNumberFromAccount || releaseWaPhoneNumberFromAccount;
  const persistAccount = deps.upsertWaAccount || upsertWaAccount;
  const encryptToken = deps.encryptAccessToken || encryptAccessToken;

  const conflictingAccount = await findByPhone(input.phoneNumberId);
  if (conflictingAccount && Number(conflictingAccount.estabelecimento_id) !== tenantId) {
    const conflictingConnected = String(conflictingAccount.status || '').toLowerCase() === 'connected';
    if (conflictingConnected) {
      console.warn('[wa][manual][connect:phone_in_use]', {
        estabelecimento_id: tenantId,
        phone_number_id: input.phoneNumberId,
        conflicting_estabelecimento_id: conflictingAccount.estabelecimento_id,
      });
      throw createHttpError(
        409,
        'wa_manual_phone_in_use',
        'Esse numero ja esta conectado a outro estabelecimento no Agendamentos Online.'
      );
    }
    await releasePhone(conflictingAccount.estabelecimento_id).catch(() => null);
  }

  const encryptedToken = encryptToken(input.accessToken);
  const persisted = await persistAccount(tenantId, {
    provider: MANUAL_PROVIDER,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    display_phone_number: resolved.phone.display_phone_number,
    verified_name: resolved.phone.verified_name,
    business_id: resolved.business?.id || input.businessAccountId || null,
    access_token_enc: encryptedToken.enc,
    token_last4: encryptedToken.last4,
    status: 'connected',
    connected_at: now,
    disconnected_at: null,
    token_last_validated_at: now,
    last_sync_at: now,
    last_error: null,
    metadata_json: metadata,
  });

  console.info('[wa][manual][connect:connected]', {
    estabelecimento_id: tenantId,
    provider: persisted?.provider || MANUAL_PROVIDER,
    waba_id: persisted?.waba_id || null,
    phone_number_id: persisted?.phone_number_id || null,
    verified_name: persisted?.verified_name || null,
  });

  return serializeAccount(persisted);
}

export async function getTenantWhatsAppAccount(estabelecimentoId, deps = {}) {
  const getAccount = deps.getWaAccountByEstabelecimentoId || getWaAccountByEstabelecimentoId;
  const account = await getAccount(estabelecimentoId);
  return serializeAccount(account);
}

export async function disconnectTenantWhatsAppAccount(estabelecimentoId, deps = {}) {
  const disconnectAccount = deps.disconnectWaAccount || disconnectWaAccount;
  const getAccount = deps.getWaAccountByEstabelecimentoId || getWaAccountByEstabelecimentoId;
  await disconnectAccount(estabelecimentoId);
  const account = await getAccount(estabelecimentoId);
  return serializeAccount(account);
}

export {
  MANUAL_PROVIDER,
  maskToken,
  normalizeManualInput,
  serializeAccount as serializeWhatsAppAccount,
};
