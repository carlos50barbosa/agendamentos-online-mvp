// backend/src/lib/deposit_payments.js
import { pool } from './db.js';

function parseJsonMaybe(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'object') return payload;
  const raw = String(payload || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractPixPayloadFromPayment(payment, amountCents = null) {
  if (!payment || typeof payment !== 'object') return null;
  const tx = payment?.point_of_interaction?.transaction_data || {};
  const amount =
    Number.isFinite(Number(amountCents))
      ? Number(amountCents)
      : Math.round(Number(payment?.transaction_amount || 0) * 100);
  const pix = {
    payment_id: payment?.id ? String(payment.id) : null,
    qr_code: tx.qr_code || null,
    qr_code_base64: tx.qr_code_base64 || null,
    copia_e_cola: tx.copia_e_cola || tx.qr_code || null,
    ticket_url: tx.ticket_url || null,
    expires_at: tx.expires_at || payment?.date_of_expiration || null,
    amount_cents: Number.isFinite(amount) ? amount : null,
  };
  if (!pix.qr_code && !pix.qr_code_base64 && !pix.ticket_url) return null;
  return pix;
}

export function extractPixPayloadFromRaw(rawPayload, amountCents = null) {
  const payment = parseJsonMaybe(rawPayload);
  if (!payment) return null;
  return extractPixPayloadFromPayment(payment, amountCents);
}

export function isExpiredAt(value) {
  if (!value) return false;
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return false;
  return dt.getTime() <= Date.now();
}

export async function fetchPendingDepositPayment(dbOrConn, agendamentoId, { forUpdate = false } = {}) {
  const db = dbOrConn || pool;
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `SELECT * FROM appointment_payments
      WHERE agendamento_id=?
        AND type='deposit'
        AND status='pending'
      ORDER BY id DESC
      LIMIT 1${lock}`,
    [agendamentoId]
  );
  return rows?.[0] || null;
}

export async function markDepositPaymentExpired(dbOrConn, paymentRow) {
  if (!paymentRow?.id) return { ok: false };
  const db = dbOrConn || pool;
  await db.query(
    'UPDATE appointment_payments SET status=? WHERE id=?',
    ['expired', paymentRow.id]
  );
  await db.query(
    "UPDATE agendamentos SET status='cancelado', deposit_expires_at=NOW() WHERE id=? AND status='pendente_pagamento'",
    [paymentRow.agendamento_id]
  );
  return { ok: true };
}

