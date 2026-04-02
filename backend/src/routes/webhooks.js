// backend/src/routes/webhooks.js
import express from 'express';
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js';
import { config } from '../lib/config.js';
import { buildRateLimitClientKey, observeAbuseFlood } from '../lib/request_rate_limit.js';
import { logBlockedRouteAccess, logSecurityEvent, resolveRouteTokenAccess } from '../lib/route_access.js';
export const router = express.Router();

// se você for validar assinatura do MP, salve o raw body:
function rawSaver(req, res, buf) { req.rawBody = buf; }

function sanitizeLogValue(value, maxLength = 96) {
  const normalized = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildLegacyWebhookLogSummary(req, verification, resourceId) {
  return {
    url: sanitizeLogValue(req.originalUrl, 160),
    resource_id: sanitizeLogValue(resourceId, 64),
    topic: sanitizeLogValue(req.query?.type || req.query?.topic || req.body?.type || req.body?.topic, 32),
    x_request_id: sanitizeLogValue(req.headers['x-request-id'], 64),
    x_signature_present: Boolean(String(req.headers['x-signature'] || '').trim()),
    x_signature_prefix: sanitizeLogValue(String(req.headers['x-signature'] || '').slice(0, 24), 24),
    verification: verification.ok ? 'verified' : (verification.skipped || 'unsigned_allowed'),
  };
}

export function mountWebhooks(app, withApiPrefix = false) {
  const paths = withApiPrefix
    ? ['/api/webhook/mercadopago', '/webhook/mercadopago'] // aceita ambos
    : ['/webhook/mercadopago', '/api/webhook/mercadopago'];

  app.use(paths, express.json({ verify: rawSaver, limit: '5mb' }));
  app.use(paths, express.urlencoded({ extended: true, verify: rawSaver, limit: '5mb' }));

  app.post(paths, async (req, res) => {
    try {
      const verification = verifyMercadoPagoWebhookSignature(req);
      if (!verification.ok && !config.billing?.mercadopago?.allowUnsigned) {
        logBlockedRouteAccess('mercadopago:legacy-webhook', req, {
          reason: verification.reason || 'invalid_signature',
        });
        await observeAbuseFlood({
          routeKey: 'mercadopago:legacy-webhook-invalid-signature',
          req,
          bucketKey: `mp-legacy-invalid:${buildRateLimitClientKey(req)}`,
          windowMs: config.security?.telemetry?.webhookInvalidSignature?.windowMs,
          threshold: config.security?.telemetry?.webhookInvalidSignature?.threshold,
          details: { reason: verification.reason || 'invalid_signature' },
          level: 'error',
        });
        return res.status(200).send('IGNORED');
      }

      // Mercado Pago envia identificadores por query e/ou body
      const q = req.query || {};
      const b = req.body || {};
      const resourceId =
        q['data.id'] ||
        b?.data?.id ||
        q.id ||
        b.id ||
        b.resource ||
        null;

      const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
      logSecurityEvent('mercadopago:legacy-webhook-hit', req, {
        ...buildLegacyWebhookLogSummary(req, verification, resourceId),
        production_unsafe: nodeEnv === 'production' && !verification.ok,
      }, { level: 'info' });
      await observeAbuseFlood({
        routeKey: 'mercadopago:legacy-webhook-hit',
        req,
        bucketKey: `mp-legacy-hit:${buildRateLimitClientKey(req)}`,
        windowMs: config.security?.telemetry?.legacyWebhookHits?.windowMs,
        threshold: config.security?.telemetry?.legacyWebhookHits?.threshold,
        details: { resource_id: resourceId || null },
        level: 'warn',
      });


      if (!resourceId) {
        console.warn('[MP] webhook without resource id; skipping sync');
        return res.status(200).send('OK');
      }

      // Apenas registra e responde rápido para evitar retries agressivos do MP
      res.status(200).send('OK');
    } catch (e) {
      console.error('[MP] webhook error', e);
      // Ainda devolva 200 para o MP não retentar sem fim
      res.status(200).send('OK');
    }
  });

  // opcional, para testes manuais por GET:
  app.get(paths, (req, res) => {
    const access = resolveRouteTokenAccess(req, {
      envNames: ['ADMIN_TOKEN', 'BILLING_WEBHOOK_HEALTH_TOKEN'],
      headerNames: ['x-admin-token', 'x-billing-health-token'],
      allowAuthorizationBearer: false,
    });
    if (!access.ok) {
      logBlockedRouteAccess('mercadopago:legacy-webhook-get', req, {
        reason: access.reason || 'forbidden',
        token_configured: access.configured,
      });
      return res.status(404).send('Not Found');
    }
    return res.status(200).send('OK');
  });
}
