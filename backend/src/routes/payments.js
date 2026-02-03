// backend/src/routes/payments.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js';
import { fetchMercadoPagoPayment } from '../lib/billing.js';
import { notifyAppointmentConfirmed } from '../lib/appointment_confirmation.js';
import { resolveMpAccessToken } from '../services/mpAccounts.js';

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
    `SELECT * FROM appointment_payments WHERE id=? LIMIT 1${lock}`,
    [id]
  );
  return rows?.[0] || null;
}

async function fetchPaymentByProvider(providerPaymentId, { forUpdate = false, connection = null } = {}) {
  const db = connection || pool;
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `SELECT * FROM appointment_payments WHERE provider_payment_id=? LIMIT 1${lock}`,
    [String(providerPaymentId)]
  );
  return rows?.[0] || null;
}

async function markPaymentExpired({ paymentRow, rawPayload = null, connection }) {
  await connection.query(
    'UPDATE appointment_payments SET status=?, raw_payload=? WHERE id=?',
    ['expired', rawPayload, paymentRow.id]
  );
  await connection.query(
    "UPDATE agendamentos SET status='cancelado', deposit_expires_at=NOW() WHERE id=? AND status='pendente_pagamento'",
    [paymentRow.agendamento_id]
  );
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

router.get('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'invalid_payment_id' });
    }

    let payment = await fetchPaymentById(id);
    if (!payment) {
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
            await syncPaymentIfApproved(payment.provider_payment_id, mpPayment);
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

    const normalized = normalizePaymentStatus(payment.status);
    return res.json({
      ok: true,
      id: payment.id,
      status: normalized,
      paid: normalized === 'paid',
      expired: isExpiredStatus(normalized),
      expires_at: payment.expires_at ? new Date(payment.expires_at).toISOString() : null,
      paid_at: payment.paid_at ? new Date(payment.paid_at).toISOString() : null,
      amount_centavos: payment.amount_centavos,
      agendamento_id: payment.agendamento_id,
    });
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
    console.warn('[payments:webhook] invalid_signature', { reason: verification.reason, topic });
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
    if (syncResult.ok && syncResult.updatedAppointment) {
      notifyAppointmentConfirmed(syncResult.appointmentId).catch((err) => {
        console.warn('[payments:webhook] notify failed', err?.message || err);
      });
    }

    return res.status(200).json({ ok: true, processed: !!syncResult.ok });
  } catch (err) {
    console.error('[payments:webhook] falha ao processar', err);
    return res.status(200).json({ ok: true, ignored: 'internal_error' });
  }
});

export default router;
