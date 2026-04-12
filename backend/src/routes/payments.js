// backend/src/routes/payments.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js';
import { fetchMercadoPagoPayment } from '../lib/billing.js';
import { notifyAppointmentConfirmed } from '../lib/appointment_confirmation.js';
import { resolveMpAccessToken } from '../services/mpAccounts.js';
import { tryAuthenticateRequest } from '../middleware/auth.js';
import { verifyPublicDepositToken } from '../lib/public_deposit_token.js';
import { canAccessPaymentStatus, serializePaymentStatusResponse } from '../lib/payment_status_access.js';
import { buildRateLimitClientKey, consumeRateLimit, observeAbuseFlood, setRateLimitHeaders } from '../lib/request_rate_limit.js';
import { logBlockedRouteAccess, logSecurityEvent } from '../lib/route_access.js';
import { cancelPendingPaymentAppointmentTx } from '../lib/appointment_loyalty.js';

const router = Router();

function normalizePaymentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isApprovedStatus(status) {
  return status === 'approved' || status === 'paid';
}

function isExpiredStatus(status) {
  return ['expired', 'canceled', 'cancelled', 'failed', 'rejected'].includes(status);
}

function safeJson(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

async function fetchPaymentById(id, { forUpdate = false, connection = null } = {}) {
  const db = connection || pool;
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `SELECT ap.*, a.cliente_id
       FROM appointment_payments ap
       LEFT JOIN agendamentos a ON a.id = ap.agendamento_id
      WHERE ap.id=? LIMIT 1${lock}`,
    [id]
  );
  return rows?.[0] || null;
}

async function fetchPaymentByProvider(providerPaymentId, { forUpdate = false, connection = null } = {}) {
  const db = connection || pool;
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `SELECT ap.*, a.cliente_id
       FROM appointment_payments ap
       LEFT JOIN agendamentos a ON a.id = ap.agendamento_id
      WHERE ap.provider_payment_id=? LIMIT 1${lock}`,
    [String(providerPaymentId)]
  );
  return rows?.[0] || null;
}

async function markPaymentExpired({ paymentRow, rawPayload = null, connection }) {
  await connection.query(
    'UPDATE appointment_payments SET status=?, raw_payload=? WHERE id=?',
    ['expired', rawPayload, paymentRow.id]
  );
  await cancelPendingPaymentAppointmentTx(paymentRow.agendamento_id, { db: connection });
}

async function markPaymentPaid({ paymentRow, rawPayload = null, providerReference = null, connection }) {
  const payload = rawPayload || null;
  await connection.query(
    'UPDATE appointment_payments SET status=?, paid_at=NOW(), raw_payload=?, provider_reference=COALESCE(provider_reference, ?) WHERE id=?',
    ['paid', payload, providerReference, paymentRow.id]
  );
  const [result] = await connection.query(
    "UPDATE agendamentos SET status='confirmado', deposit_paid_at=NOW() WHERE id=? AND status='pendente_pagamento'",
    [paymentRow.agendamento_id]
  );
  return result?.affectedRows || 0;
}

async function syncPaymentIfApproved(providerPaymentId, paymentData, eventPayload = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const paymentRow = await fetchPaymentByProvider(providerPaymentId, { forUpdate: true, connection: conn });
    if (!paymentRow) {
      await conn.rollback();
      return { ok: false, reason: 'not_found' };
    }
    if (paymentRow.status === 'paid') {
      await conn.commit();
      return { ok: true, already_processed: true, appointmentId: paymentRow.agendamento_id };
    }
    if (paymentRow.status !== 'pending') {
      await conn.commit();
      return { ok: false, reason: 'not_pending' };
    }

    const expiresAt = paymentRow.expires_at ? new Date(paymentRow.expires_at) : null;
    if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      await markPaymentExpired({
        paymentRow,
        rawPayload: safeJson({ event: eventPayload, payment: paymentData }),
        connection: conn,
      });
      await conn.commit();
      return { ok: false, reason: 'expired' };
    }

    const affected = await markPaymentPaid({
      paymentRow,
      rawPayload: safeJson({ event: eventPayload, payment: paymentData }),
      providerReference: paymentData?.external_reference || null,
      connection: conn,
    });
    await conn.commit();
    return { ok: true, appointmentId: paymentRow.agendamento_id, updatedAppointment: affected > 0 };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

function notifyIfAppointmentJustConfirmed(syncResult, source) {
  if (!syncResult?.ok || !syncResult?.updatedAppointment || !syncResult?.appointmentId) return;
  notifyAppointmentConfirmed(syncResult.appointmentId).catch((err) => {
    console.warn(`[payments][${source}] notify failed`, err?.message || err);
  });
}

function resolveDepositStatusToken(req) {
  const headerToken = String(req.headers['x-deposit-token'] || '').trim();
  if (headerToken) {
    return { token: headerToken, source: 'header' };
  }

  const legacyQueryTokenEnabled = config.security?.payments?.legacyQueryToken?.enabled !== false;
  const queryToken = String(req.query?.token || '').trim();
  if (queryToken) {
    return {
      token: legacyQueryTokenEnabled ? queryToken : '',
      source: legacyQueryTokenEnabled ? 'query_legacy' : 'query_legacy_disabled',
    };
  }

  return { token: '', source: 'missing' };
}

function buildLegacyQueryTokenTelemetry(req, { paymentId, tokenSource }) {
  if (tokenSource !== 'query_legacy' && tokenSource !== 'query_legacy_disabled') return null;
  const legacyConfig = config.security?.payments?.legacyQueryToken || {};
  const sunsetAtMs = legacyConfig.sunsetAt ? new Date(legacyConfig.sunsetAt).getTime() : NaN;
  let deprecationStage = legacyConfig.enabled === false ? 'disabled' : 'enabled';
  let sunsetRemainingDays = null;
  if (legacyConfig.enabled !== false && Number.isFinite(sunsetAtMs)) {
    const remainingMs = sunsetAtMs - Date.now();
    sunsetRemainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    if (remainingMs <= 0) deprecationStage = 'sunset_elapsed';
    else deprecationStage = remainingMs <= 30 * 24 * 60 * 60 * 1000 ? 'sunset_imminent' : 'sunset_scheduled';
  } else if (legacyConfig.enabled === false) {
    if (Number.isFinite(sunsetAtMs)) {
      const remainingMs = sunsetAtMs - Date.now();
      sunsetRemainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    }
    deprecationStage = 'disabled';
  }
  return {
    paymentId,
    tokenSource,
    legacyConfig,
    deprecationStage,
    sunsetRemainingDays,
    routeVariant: String(req.originalUrl || req.baseUrl || req.url || '').startsWith('/api/')
      ? 'api'
      : 'direct',
  };
}

function markLegacyQueryTokenUsage(req, res, telemetry) {
  if (!telemetry || telemetry.tokenSource !== 'query_legacy') return telemetry;
  const { legacyConfig } = telemetry;
  const routeVariant = String(req.originalUrl || req.baseUrl || req.url || '').startsWith('/api/')
    ? 'api'
    : 'direct';
  res.set('Deprecation', 'true');
  res.set('Warning', '299 - "Query token fallback is deprecated; use X-Deposit-Token"');
  res.set('X-Legacy-Token-Fallback', 'query-param');
  res.set('X-Deprecated-Replacement', 'X-Deposit-Token');
  res.set('X-Legacy-Token-Phase', telemetry.deprecationStage);
  if (legacyConfig.sunsetAt) {
    res.set('Sunset', new Date(legacyConfig.sunsetAt).toUTCString());
  }
  if (legacyConfig.deprecationUrl) {
    res.append('Link', `<${legacyConfig.deprecationUrl}>; rel="deprecation"; type="text/html"`);
  }
  telemetry.routeVariant = routeVariant;
  return telemetry;
}

function logLegacyQueryTokenUsage(req, telemetry, details = {}) {
  if (!telemetry) return;
  const eventKey =
    telemetry.tokenSource === 'query_legacy_disabled'
      ? 'payments:legacy-query-token-disabled'
      : 'payments:legacy-query-token';
  logSecurityEvent(eventKey, req, {
    payment_id: telemetry.paymentId,
    token_source: telemetry.tokenSource,
    replacement: 'x-deposit-token',
    legacy_query_token_enabled: telemetry.legacyConfig?.enabled !== false,
    deprecation_stage: telemetry.deprecationStage,
    route_variant: telemetry.routeVariant,
    client_key: buildRateLimitClientKey(req),
    sunset_at: telemetry.legacyConfig?.sunsetAt || null,
    sunset_remaining_days: telemetry.sunsetRemainingDays,
    deprecation_url: telemetry.legacyConfig?.deprecationUrl || null,
    ...details,
  }, { level: telemetry.tokenSource === 'query_legacy_disabled' ? 'warn' : 'info' });
}

async function enforcePublicPaymentStatusRateLimit(req, res, { paymentId, authResult, tokenSource }) {
  if (authResult?.user) return false;

  const result = await consumeRateLimit({
    bucketKey: `payments-public:${buildRateLimitClientKey(req)}:${paymentId}`,
    windowMs: config.security?.rateLimit?.paymentStatusPublic?.windowMs,
    max: config.security?.rateLimit?.paymentStatusPublic?.max,
  });
  setRateLimitHeaders(res, result);
  if (!result.limited) return false;

  logSecurityEvent('payments:status-rate-limit', req, {
    payment_id: paymentId,
    token_source: tokenSource,
    limit: result.limit,
    retry_after_sec: result.retryAfterSec,
    store_driver: result.storeDriver || null,
  }, { level: 'warn' });
  res.status(429).json({ error: 'rate_limited' });
  return true;
}

router.get('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_payment_id' });
    }

    const authResult = await tryAuthenticateRequest(req);
    const { token: depositToken, source: depositTokenSource } = resolveDepositStatusToken(req);
    const legacyQueryTokenTelemetry = markLegacyQueryTokenUsage(
      req,
      res,
      buildLegacyQueryTokenTelemetry(req, { paymentId: id, tokenSource: depositTokenSource })
    );
    if (await enforcePublicPaymentStatusRateLimit(req, res, {
      paymentId: id,
      authResult,
      tokenSource: depositTokenSource,
    })) {
      logLegacyQueryTokenUsage(req, legacyQueryTokenTelemetry, {
        access_outcome: 'rate_limited',
        auth_user_present: Boolean(authResult.user),
        auth_user_tipo: authResult.user?.tipo || null,
      });
      return;
    }
    const depositVerification = verifyPublicDepositToken(depositToken);
    const hasLookupAccess = Boolean(authResult.user) || depositVerification.ok;

    if (!hasLookupAccess) {
      logLegacyQueryTokenUsage(req, legacyQueryTokenTelemetry, {
        access_outcome: 'blocked_lookup',
        auth_user_present: Boolean(authResult.user),
        auth_user_tipo: authResult.user?.tipo || null,
        token_valid: depositVerification.ok,
      });
      logBlockedRouteAccess('payments:status', req, {
        payment_id: id,
        reason: authResult.error?.code || depositVerification.reason || 'missing_access',
        token_access: depositVerification.ok ? 'valid' : (depositVerification.reason || 'missing'),
        user_id: authResult.user?.id || null,
        user_tipo: authResult.user?.tipo || null,
      });
      if (authResult.error) {
        return res.status(authResult.error.code === 'token_expired' ? 401 : 403).json({
          error: authResult.error.code,
        });
      }
      return res.status(404).json({ error: 'payment_not_found' });
    }

    let payment = await fetchPaymentById(id);
    if (!payment) {
      return res.status(404).json({ error: 'payment_not_found' });
    }

    const access = canAccessPaymentStatus({
      payment,
      user: authResult.user,
      depositPayload: depositVerification.ok ? depositVerification.payload : null,
    });

    if (!access.ok) {
      logLegacyQueryTokenUsage(req, legacyQueryTokenTelemetry, {
        access_outcome: 'blocked_scope',
        auth_user_present: Boolean(authResult.user),
        auth_user_tipo: authResult.user?.tipo || null,
        token_valid: depositVerification.ok,
      });
      logBlockedRouteAccess('payments:status', req, {
        payment_id: id,
        reason: authResult.error?.code || access.reason || depositVerification.reason || 'forbidden',
        token_access: depositVerification.ok ? 'valid' : (depositVerification.reason || 'missing'),
        user_id: authResult.user?.id || null,
        user_tipo: authResult.user?.tipo || null,
      });
      if (authResult.error && !depositVerification.ok) {
        return res.status(authResult.error.code === 'token_expired' ? 401 : 403).json({
          error: authResult.error.code,
        });
      }
      return res.status(404).json({ error: 'payment_not_found' });
    }

    const status = normalizePaymentStatus(payment.status);
    const shouldSync =
      status === 'pending' &&
      payment.provider_payment_id &&
      (!payment.updated_at || new Date(payment.updated_at).getTime() < Date.now() - 15000);

    if (shouldSync) {
      try {
        const mpAccess = await resolveMpAccessToken(payment.estabelecimento_id);
        const accessToken = mpAccess.accessToken || null;
        if (!accessToken && !mpAccess.allowFallback) {
          console.warn('[payments][status] mp token missing', {
            estabelecimento_id: payment.estabelecimento_id,
            reason: mpAccess.reason || 'missing_token',
          });
        } else {
          const mpPayment = await fetchMercadoPagoPayment(
            payment.provider_payment_id,
            accessToken ? { accessToken } : undefined
          );
          const mpStatus = normalizePaymentStatus(mpPayment?.status || '');
          if (isApprovedStatus(mpStatus)) {
            const syncResult = await syncPaymentIfApproved(payment.provider_payment_id, mpPayment);
            notifyIfAppointmentJustConfirmed(syncResult, 'status');
            payment = await fetchPaymentById(id);
          } else if (isExpiredStatus(mpStatus)) {
            const conn = await pool.getConnection();
            try {
              await conn.beginTransaction();
              const locked = await fetchPaymentById(id, { forUpdate: true, connection: conn });
              if (locked && locked.status === 'pending') {
                await markPaymentExpired({
                  paymentRow: locked,
                  rawPayload: safeJson({ payment: mpPayment }),
                  connection: conn,
                });
              }
              await conn.commit();
              payment = await fetchPaymentById(id);
            } catch (err) {
              try {
                await conn.rollback();
              } catch {}
              throw err;
            } finally {
              conn.release();
            }
          }
        }
      } catch (err) {
        console.warn('[payments][status] sync failed', err?.message || err);
      }
    }

    logLegacyQueryTokenUsage(req, legacyQueryTokenTelemetry, {
      access_outcome: 'allowed',
      access_mode: access.mode || null,
      auth_user_present: Boolean(authResult.user),
      auth_user_tipo: authResult.user?.tipo || null,
      token_valid: depositVerification.ok,
      required_for_access: access.mode === 'public_deposit_token',
    });
    return res.json(
      serializePaymentStatusResponse(payment, {
        includePrivate: access.mode !== 'public_deposit_token',
      })
    );
  } catch (err) {
    console.error('GET /payments/:id/status', err);
    return res.status(500).json({ error: 'payment_status_failed' });
  }
});

router.post('/webhook', async (req, res) => {
  const event = req.body || {};
  const topic = String(
    req.query?.type ||
      req.query?.topic ||
      event?.type ||
      event?.topic ||
      req.headers['x-topic'] ||
      ''
  ).toLowerCase();

  const verification = verifyMercadoPagoWebhookSignature(req);
  const allowUnsigned = Boolean(config.billing?.mercadopago?.allowUnsigned);
  if (!verification.ok && !allowUnsigned) {
    logSecurityEvent('payments:webhook-invalid-signature', req, {
      reason: verification.reason,
      topic,
    }, { level: 'warn' });
    await observeAbuseFlood({
      routeKey: 'payments:webhook-invalid-signature',
      req,
      bucketKey: `payments-webhook-invalid:${buildRateLimitClientKey(req)}`,
      windowMs: config.security?.telemetry?.webhookInvalidSignature?.windowMs,
      threshold: config.security?.telemetry?.webhookInvalidSignature?.threshold,
      details: { reason: verification.reason, topic },
      level: 'error',
    });
    return res.status(200).json({ ok: true, ignored: true, reason: verification.reason });
  }

  if (topic !== 'payment') {
    return res.status(200).json({ ok: true, ignored: 'unsupported_topic' });
  }

  const resourceId = verification.id || req.query?.id || req.query?.['data.id'] || event?.data?.id || event?.id;
  if (!resourceId) {
    return res.status(200).json({ ok: true, ignored: 'missing_resource_id' });
  }

  try {
    const paymentRow = await fetchPaymentByProvider(resourceId);
    if (!paymentRow) {
      return res.status(200).json({ ok: true, ignored: 'payment_not_tracked' });
    }

    const mpAccess = await resolveMpAccessToken(paymentRow.estabelecimento_id);
    const accessToken = mpAccess.accessToken || null;
    if (!accessToken && !mpAccess.allowFallback) {
      console.warn('[payments:webhook] mp token missing', {
        estabelecimento_id: paymentRow.estabelecimento_id,
        reason: mpAccess.reason || 'missing_token',
      });
      return res.status(200).json({ ok: true, ignored: 'mp_token_missing' });
    }

    const payment = await fetchMercadoPagoPayment(
      resourceId,
      accessToken ? { accessToken } : undefined
    );
    if (!payment?.id) {
      return res.status(200).json({ ok: true, ignored: 'payment_not_found' });
    }

    const status = normalizePaymentStatus(payment.status);
    if (!isApprovedStatus(status)) {
      return res.status(200).json({ ok: true, ignored: `status_${status || 'unknown'}` });
    }

    const syncResult = await syncPaymentIfApproved(String(payment.id), payment, event);
    notifyIfAppointmentJustConfirmed(syncResult, 'webhook');

    return res.status(200).json({ ok: true, processed: !!syncResult.ok });
  } catch (err) {
    console.error('[payments:webhook] falha ao processar', err);
    return res.status(200).json({ ok: true, ignored: 'internal_error' });
  }
});

export default router;
