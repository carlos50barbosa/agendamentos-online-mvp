function normalizeToken(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

const securityEventCounters = new Map();

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

export function getRequestAccessLogContext(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').trim();
  return {
    method: String(req?.method || '').trim() || null,
    url: String(req?.originalUrl || req?.url || '').trim() || null,
    ip: forwarded || String(req?.ip || '').trim() || null,
    host: String(req?.headers?.host || '').trim() || null,
    origin: String(req?.headers?.origin || '').trim() || null,
    referer: String(req?.headers?.referer || '').trim() || null,
    user_agent: String(req?.headers?.['user-agent'] || '').trim() || null,
  };
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
  const normalizedBucketKey = String(bucketKey || context.ip || 'unknown').trim() || 'unknown';
  const counter = incrementSecurityEventCounter(`${eventKey}:${normalizedBucketKey}`, windowMs);
  const logger = typeof console[level] === 'function' ? console[level].bind(console) : console.warn.bind(console);
  logger(`[security][${eventKey}] event`, {
    ...context,
    ...details,
    counter_window_ms: windowMs,
    counter_window_count: counter.windowCount,
    counter_total_count: counter.totalCount,
  });
}

export function logBlockedRouteAccess(routeKey, req, details = {}) {
  const context = getRequestAccessLogContext(req);
  const bucketKey = String(context.ip || 'unknown').trim() || 'unknown';
  const counter = incrementSecurityEventCounter(`${routeKey}:${bucketKey}:blocked`, 300000);
  console.warn(`[security][${routeKey}] blocked`, {
    ...context,
    ...details,
    counter_window_ms: 300000,
    counter_window_count: counter.windowCount,
    counter_total_count: counter.totalCount,
  });
}

export function resetSecurityEventCounters() {
  securityEventCounters.clear();
}
