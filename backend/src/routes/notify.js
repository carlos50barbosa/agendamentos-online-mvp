// backend/src/routes/notify.js
import { Router } from 'express';
import { config } from '../lib/config.js';
import { sendTemplate, sendWhatsAppSmart } from '../lib/notifications.js';
import { buildRateLimitClientKey, createRateLimitMiddleware } from '../lib/request_rate_limit.js';
import { tryAuthenticateRequest } from '../middleware/auth.js';
import { logBlockedRouteAccess, resolveRouteTokenAccess } from '../lib/route_access.js';

const router = Router();
const notifyRateLimit = createRateLimitMiddleware({
  routeKey: 'notify',
  max: () => config.security?.rateLimit?.notify?.max,
  windowMs: () => config.security?.rateLimit?.notify?.windowMs,
  keyResolver: (req) => `notify:${buildRateLimitClientKey(req)}`,
});

router.use(notifyRateLimit);

export function resolveNotifyTokenAccess(req, env = process.env) {
  return resolveRouteTokenAccess(req, {
    env,
    envNames: ['NOTIFY_ROUTE_TOKEN', 'ADMIN_TOKEN'],
    headerNames: ['x-notify-token', 'x-admin-token'],
    allowAuthorizationBearer: false,
  });
}

export function decideNotifyAccess({ tokenAccess, authResult }) {
  if (tokenAccess?.ok) {
    return {
      ok: true,
      source: tokenAccess.source,
      user: null,
    };
  }

  if (authResult?.user?.tipo === 'estabelecimento') {
    return {
      ok: true,
      source: 'jwt_estabelecimento',
      user: authResult.user,
    };
  }

  if (authResult?.error) {
    return {
      ok: false,
      status: authResult.error.code === 'token_expired' ? 401 : 403,
      error: authResult.error.code,
    };
  }

  return {
    ok: false,
    status: 403,
    error: 'forbidden',
  };
}

export async function requireNotifyAccess(req, res, next) {
  const tokenAccess = resolveNotifyTokenAccess(req);
  const authResult = tokenAccess.ok ? { user: null, error: null } : await tryAuthenticateRequest(req);
  const decision = decideNotifyAccess({ tokenAccess, authResult });

  if (decision.ok) {
    if (decision.user) req.user = decision.user;
    req.routeAccess = { source: decision.source };
    return next();
  }

  logBlockedRouteAccess('notify', req, {
    reason: decision.error || tokenAccess.reason || 'forbidden',
    has_auth_header: Boolean(req.headers.authorization),
    token_configured: tokenAccess.configured,
  });

  return res.status(decision.status).json({ ok: false, error: decision.error });
}

// Texto livre
router.post('/whatsapp/text', requireNotifyAccess, async (req, res) => {
  try {
    const { to, message, text, templateNameFallback } = req.body || {};
    const fallbackName =
      templateNameFallback ||
      process.env.WA_TEMPLATE_NAME_FALLBACK ||
      process.env.WA_TEMPLATE_NAME ||
      'hello_world';
    const payloadText = message ?? text ?? 'Teste via Cloud API';
    const { result, meta } = await sendWhatsAppSmart({
      to,
      text: payloadText,
      templateNameFallback: fallbackName,
      returnMeta: true,
    });
    res.json({
      ok: true,
      decision: meta?.decision || null,
      window_open: meta?.window_open ?? null,
      force_template: meta?.force_template ?? false,
      wamid: meta?.wamid || null,
      data: result,
    });
  } catch (e) {
    console.error('[notify/text]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Template hello_world
router.post('/whatsapp/template', requireNotifyAccess, async (req, res) => {
  try {
    const { to, name, lang } = req.body || {};
    const data = await sendTemplate({ to, name, lang });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[notify/template]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
