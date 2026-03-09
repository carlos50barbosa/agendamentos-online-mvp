import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const DEFAULT_TIMEOUT_MS = Number(process.env.WA_BOT_HTTP_TIMEOUT_MS || 8_000);

function resolveApiBase() {
  const envBase =
    process.env.BOT_INTERNAL_API_BASE_URL ||
    process.env.INTERNAL_API_BASE_URL ||
    process.env.API_BASE_URL ||
    '';
  if (envBase) return String(envBase).replace(/\/$/, '');

  const port = Number(process.env.PORT || 3002);
  const host = process.env.BOT_INTERNAL_API_HOST || '127.0.0.1';
  return `http://${host}:${port}/api`;
}

function buildUrl(path, query) {
  const base = resolveApiBase();
  const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const url = new URL(`${base}${cleanPath}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry === undefined || entry === null || entry === '') return;
          url.searchParams.append(key, String(entry));
        });
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }
  return url;
}

function buildTimeoutSignal(timeoutMs) {
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildInternalAuthToken(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const secret = process.env.JWT_SECRET || 'secret';
  return jwt.sign({ id }, secret, { expiresIn: '5m' });
}

async function requestJson(path, { method = 'GET', query, body, headers = {}, authUserId } = {}) {
  const url = buildUrl(path, query);
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(headers || {}),
  };
  if (authUserId) {
    const token = buildInternalAuthToken(authUserId);
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers: finalHeaders,
    signal: buildTimeoutSignal(DEFAULT_TIMEOUT_MS),
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, options);
    const data = await parseBody(response);
    const botErrorCode = !response.ok && response.status >= 500 ? 'BOT_UPSTREAM_5XX' : null;
    if (!response.ok) {
      console.warn('[bot/internal-api] non-2xx', {
        method,
        url: url.toString(),
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
        bot_error_code: botErrorCode,
      });
    }
    if (botErrorCode && data && typeof data === 'object' && !data.error_code) {
      data.error_code = botErrorCode;
    }
    return {
      ok: response.ok,
      status: response.status,
      url: url.toString(),
      data,
      elapsedMs: Date.now() - startedAt,
      botErrorCode,
    };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    const botErrorCode = isTimeout ? 'BOT_UPSTREAM_TIMEOUT' : null;
    console.error('[bot/internal-api] request_failed', {
      method,
      url: url.toString(),
      elapsed_ms: Date.now() - startedAt,
      error: err?.message || String(err),
      bot_error_code: botErrorCode,
    });
    return {
      ok: false,
      status: 0,
      url: url.toString(),
      data: {
        error: isTimeout ? 'request_timeout' : 'request_failed',
        message: err?.message || 'request_failed',
        error_code: botErrorCode || undefined,
      },
      elapsedMs: Date.now() - startedAt,
      botErrorCode,
    };
  }
}

export { resolveApiBase, requestJson, buildInternalAuthToken };
