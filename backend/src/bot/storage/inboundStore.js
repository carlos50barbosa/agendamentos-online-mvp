import { pool } from '../../lib/db.js';

function safeJson(payload) {
  try {
    return JSON.stringify(payload ?? null);
  } catch {
    return null;
  }
}

function normalizeError(err) {
  if (!err) return null;
  const base = String(err?.message || err).slice(0, 400);
  return base || null;
}

async function findInboundEvent({ tenantId, messageId }) {
  const tenant = Number(tenantId);
  const msgId = String(messageId || '').trim();
  if (!tenant || !msgId) return null;
  const [rows] = await pool.query(
    `SELECT id, status, processed_at
       FROM wa_inbound_events
      WHERE tenant_id=? AND message_id=?
      LIMIT 1`,
    [tenant, msgId]
  );
  return rows?.[0] || null;
}

async function createInboundEvent({ tenantId, fromPhone, messageId, type, payload }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  const msgId = String(messageId || '').trim();
  if (!tenant || !phone || !msgId) {
    return { ok: false, reason: 'invalid_input', shouldProcess: false, duplicate: false };
  }
  const kind = String(type || 'unknown').slice(0, 64);
  const payloadJson = safeJson(payload);
  try {
    const [result] = await pool.query(
      `INSERT INTO wa_inbound_events
       (tenant_id, from_phone, message_id, type, payload_json, received_at, status)
       VALUES (?,?,?,?,?,NOW(),'new')`,
      [tenant, phone, msgId, kind, payloadJson]
    );
    return {
      ok: true,
      duplicate: false,
      shouldProcess: true,
      id: result?.insertId || null,
    };
  } catch (err) {
    if (err?.code !== 'ER_DUP_ENTRY') throw err;
    const existing = await findInboundEvent({ tenantId: tenant, messageId: msgId });
    const status = String(existing?.status || '').toLowerCase();
    const shouldProcess = status === 'new';
    return {
      ok: true,
      duplicate: true,
      shouldProcess,
      status,
      id: existing?.id || null,
    };
  }
}

async function markInboundProcessed({ tenantId, messageId, status = 'processed', error = null }) {
  const tenant = Number(tenantId);
  const msgId = String(messageId || '').trim();
  if (!tenant || !msgId) return { ok: false };
  const finalStatus = String(status || 'processed').slice(0, 32);
  await pool.query(
    `UPDATE wa_inbound_events
        SET status=?,
            processed_at=NOW(),
            error=?
      WHERE tenant_id=? AND message_id=?`,
    [finalStatus, normalizeError(error), tenant, msgId]
  );
  return { ok: true };
}

export { createInboundEvent, findInboundEvent, markInboundProcessed };
