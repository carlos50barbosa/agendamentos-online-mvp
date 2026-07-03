// backend/src/services/asaas/client.js
// Wrapper fino sobre node-fetch para a API do Asaas.
// - Injeta a base URL conforme ASAAS_ENV (sandbox|production).
// - Injeta o header `access_token` em todas as chamadas.
// - Padroniza erros (AsaasError com status + corpo).
// `fetchImpl` é injetável para testes (node --test) sem tocar a rede.
import fetchDefault from 'node-fetch';
import { config } from '../../lib/config.js';

const BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com',
  production: 'https://api.asaas.com',
};

export function resolveBaseUrl(env) {
  const key = String(env || 'sandbox').trim().toLowerCase();
  return key === 'production' || key === 'prod' ? BASE_URLS.production : BASE_URLS.sandbox;
}

export class AsaasError extends Error {
  constructor(message, { status = null, body = null, code = null } = {}) {
    super(message);
    this.name = 'AsaasError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function extractErrorMessage(body, status) {
  const first = Array.isArray(body?.errors) ? body.errors[0] : null;
  if (first?.description) return first.description;
  if (typeof body?.message === 'string') return body.message;
  return `Asaas respondeu HTTP ${status}`;
}

/**
 * Cria um client Asaas.
 * @param {object} [opts]
 * @param {string} [opts.apiKey] default: config.asaas.apiKey
 * @param {string} [opts.env] sandbox|production (default: config.asaas.env)
 * @param {string} [opts.baseUrl] sobrescreve a base (tem prioridade sobre env)
 * @param {Function} [opts.fetchImpl] implementação de fetch (default: node-fetch)
 */
export function createAsaasClient({ apiKey, env, baseUrl, fetchImpl } = {}) {
  const key = apiKey ?? config.asaas.apiKey;
  const base = String(baseUrl || resolveBaseUrl(env ?? config.asaas.env)).replace(/\/+$/, '');
  const doFetch = fetchImpl || fetchDefault;

  async function request(method, path, { body, query, headers } = {}) {
    if (!key) throw new AsaasError('ASAAS_API_KEY ausente', { code: 'config_missing' });
    const url = `${base}${path}${buildQuery(query)}`;

    let res;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          access_token: key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'agendamentos-online',
          ...headers,
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AsaasError(`Falha de rede ao chamar o Asaas: ${err?.message || err}`, { code: 'network_error' });
    }

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      throw new AsaasError(extractErrorMessage(parsed, res.status), {
        status: res.status,
        body: parsed,
        code: Array.isArray(parsed?.errors) ? parsed.errors[0]?.code || null : null,
      });
    }

    return parsed;
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    put: (path, opts) => request('PUT', path, opts),
    delete: (path, opts) => request('DELETE', path, opts),
    baseUrl: base,
  };
}

// Client default (lazy) para uso na aplicação.
let defaultClient = null;
export function getAsaasClient() {
  if (!defaultClient) defaultClient = createAsaasClient();
  return defaultClient;
}
