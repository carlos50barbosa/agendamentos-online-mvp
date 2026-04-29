import { getClientIpInfo } from './client_ip.js';

function normalizeToken(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

const securityEventCounters = new Map();
const SUSPICIOUS_PATH_PATTERNS = [
  /\/api\/v\d+\//i,
  /(?:force-reset-password|recover-password|modular-connector|raster\/search)/i,
  /(?:select\s+.+from|union\s+select|cast\s*\(|version\s*\(|information_schema|sleep\s*\(|benchmark\s*\()/i,
  /(?:\.\.|%2e%2e|\/\.env|\/\.git|wp-admin|wp-login|phpmyadmin|adminer|cgi-bin|boaform|actuator|jmx-console)/i,
];
const SUSPICIOUS_QUERY_PATTERNS = [
  /(?:union(?:\s|%20)+select|select(?:\s|%20)+version|cast\s*\(|information_schema|sleep\s*\(|benchmark\s*\()/i,
  /(?:\-\-|%2d%2d|\/\*|\*\/|%27|%22|%3b)/i,
];

export function extractBearerTokenValue(headerValue) {
  const header = normalizeToken(headerValue);
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function resolveRouteTokenAccess(req, {
  env = process.env,
  envNames = [],
  headerNames = [],
  allowAuthorizationBearer = true,
} = {}) {
  const configuredTokens = envNames
    .map((name) => normalizeToken(env[name]))
    .filter(Boolean);

  const candidates = [];
  for (const headerName of headerNames) {
    const headerValue = normalizeToken(req?.headers?.[headerName]);
    if (headerValue) candidates.push({ source: `header:${headerName}`, value: headerValue });
  }

  if (allowAuthorizationBearer) {
    const bearer = extractBearerTokenValue(req?.headers?.authorization);
    if (bearer) candidates.push({ source: 'header:authorization', value: bearer });
  }

  if (!configuredTokens.length) {
    return {
      ok: false,
      reason: 'token_not_configured',
      configured: false,
      candidateSources: candidates.map((entry) => entry.source),
    };
  }

  for (const candidate of candidates) {
    if (configuredTokens.includes(candidate.value)) {
      return {
        ok: true,
        source: candidate.source,
        configured: true,
      };
    }
  }

  return {
    ok: false,
    reason: candidates.length ? 'token_mismatch' : 'missing_token',
    configured: true,
    candidateSources: candidates.map((entry) => entry.source),
  };
}

function sanitizeLogValue(value, maxLength = 256) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function parseBooleanEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function shouldExposeFullIpDiagnostics() {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (parseBooleanEnv(process.env.LOG_FULL_IP, false)) return true;
  return !nodeEnv || ['development', 'dev', 'test', 'staging', 'stage'].includes(nodeEnv);
}

function redactIpDiagnostics(context) {
  if (shouldExposeFullIpDiagnostics()) return context;
  const {
    req_ip: _reqIp,
    req_ips: _reqIps,
    socket_remote_address: _socketRemoteAddress,
    x_forwarded_for: _xForwardedFor,
    x_real_ip: _xRealIp,
    cf_connecting_ip: _cfConnectingIp,
    ...redacted
  } = context;
  return redacted;
}

export function maskIpForLog(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;

  if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  if (normalized.includes(':')) {
    const parts = normalized.split(':').filter((part) => part.length > 0);
    if (parts.length >= 2) {
      return `${parts.slice(0, 3).join(':')}:*`;
    }
  }

  return normalized;
}

export function normalizeRequestId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
}

export function getRequestAccessLogContext(req) {
  const ipInfo = getClientIpInfo(req);
  const ip = ipInfo.ip || null;
  const originalUrl = String(req?.originalUrl || req?.url || '').trim();
  return {
    method: String(req?.method || '').trim() || null,
    url: originalUrl || null,
    path: originalUrl ? originalUrl.split('?')[0] : (String(req?.path || '').trim() || null),
    ip,
    ip_masked: maskIpForLog(ip),
    ip_source: ipInfo.source || null,
    ip_trusted_proxy: ipInfo.trusted_proxy,
    req_ip: ipInfo.req_ip,
    req_ips: ipInfo.req_ips,
    socket_remote_address: ipInfo.socket_remote_address,
    x_forwarded_for: sanitizeLogValue(ipInfo.x_forwarded_for, 512),
    x_real_ip: sanitizeLogValue(ipInfo.x_real_ip, 128),
    cf_connecting_ip: sanitizeLogValue(ipInfo.cf_connecting_ip, 128),
    host: sanitizeLogValue(req?.headers?.host, 128),
    origin: sanitizeLogValue(req?.headers?.origin, 256),
    referer: sanitizeLogValue(req?.headers?.referer, 256),
    user_agent: sanitizeLogValue(req?.headers?.['user-agent'], 256),
    request_id: normalizeRequestId(req?.requestId || req?.headers?.['x-request-id']),
  };
}

export function classifySuspiciousRequest(req) {
  const method = String(req?.method || '').trim().toUpperCase();
  const url = String(req?.originalUrl || req?.url || '').trim();
  const decodedUrl = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  })();
  const normalized = `${url} ${decodedUrl}`.trim();
  const reasons = [];

  if (['TRACE', 'CONNECT'].includes(method)) {
    reasons.push('unexpected_method');
  }
  if (SUSPICIOUS_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('suspicious_path');
  }
  if (SUSPICIOUS_QUERY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('suspicious_query');
  }

  return Array.from(new Set(reasons));
}

function incrementSecurityEventCounter(counterKey, windowMs) {
  const now = Date.now();
  const existing = securityEventCounters.get(counterKey);
  if (!existing || existing.resetAt <= now) {
    const next = {
      totalCount: (existing?.totalCount || 0) + 1,
      windowCount: 1,
      resetAt: now + windowMs,
    };
    securityEventCounters.set(counterKey, next);
    return next;
  }

  existing.totalCount += 1;
  existing.windowCount += 1;
  return existing;
}

export function logSecurityEvent(eventKey, req, details = {}, {
  level = 'warn',
  windowMs = 300000,
  bucketKey = null,
} = {}) {
  const context = getRequestAccessLogContext(req);
  const logContext = redactIpDiagnostics(context);
  const normalizedBucketKey = String(bucketKey || context.ip || 'unknown').trim() || 'unknown';
  const counter = incrementSecurityEventCounter(`${eventKey}:${normalizedBucketKey}`, windowMs);
  const logger = typeof console[level] === 'function' ? console[level].bind(console) : console.warn.bind(console);
  logger(`[security][${eventKey}] event`, {
    ...logContext,
    ip: context.ip_masked || context.ip || null,
    ...details,
    counter_window_ms: windowMs,
    counter_window_count: counter.windowCount,
    counter_total_count: counter.totalCount,
  });
}

export function logBlockedRouteAccess(routeKey, req, details = {}) {
  const context = getRequestAccessLogContext(req);
  const logContext = redactIpDiagnostics(context);
  const bucketKey = String(context.ip || 'unknown').trim() || 'unknown';
  const counter = incrementSecurityEventCounter(`${routeKey}:${bucketKey}:blocked`, 300000);
  console.warn(`[security][${routeKey}] blocked`, {
    ...logContext,
    ip: context.ip_masked || context.ip || null,
    ...details,
    counter_window_ms: 300000,
    counter_window_count: counter.windowCount,
    counter_total_count: counter.totalCount,
  });
}

export function resetSecurityEventCounters() {
  securityEventCounters.clear();
}
