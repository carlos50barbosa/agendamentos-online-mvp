import { pool } from '../../lib/db.js';

function safeJson(payload) {
  try {
    const raw = JSON.stringify(payload ?? null);
    if (!raw) return null;
    if (raw.length <= 2000) return raw;
    return `${raw.slice(0, 1990)}...`;
  } catch {
    return null;
  }
}

async function logConversation({
  tenantId,
  fromPhone,
  messageId,
  intent,
  prevState,
  nextState,
  action,
  endpointCalled,
  endpointResult,
  replyType,
  tenantResolutionSource,
  latencyMs,
}) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!tenant || !phone) return { ok: false };
  const paramsWithHardening = [
    tenant,
    phone,
    messageId ? String(messageId).slice(0, 191) : null,
    intent ? String(intent).slice(0, 64) : null,
    prevState ? String(prevState).slice(0, 64) : null,
    nextState ? String(nextState).slice(0, 64) : null,
    action ? String(action).slice(0, 64) : null,
    endpointCalled ? String(endpointCalled).slice(0, 255) : null,
    safeJson(endpointResult),
    replyType ? String(replyType).slice(0, 32) : 'text',
    tenantResolutionSource ? String(tenantResolutionSource).slice(0, 128) : null,
    Number.isFinite(Number(latencyMs)) ? Math.max(0, Math.round(Number(latencyMs))) : null,
  ];
  try {
    await pool.query(
      `INSERT INTO wa_conversation_logs
        (tenant_id, from_phone, message_id, intent, prev_state, next_state, action, endpoint_called, endpoint_result, reply_type, tenant_resolution_source, latency_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      paramsWithHardening
    );
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.errno !== 1054) throw err;
    await pool.query(
      `INSERT INTO wa_conversation_logs
        (tenant_id, from_phone, message_id, intent, prev_state, next_state, action, endpoint_called, endpoint_result, reply_type, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      paramsWithHardening.slice(0, 10)
    );
  }
  return { ok: true };
}

export { logConversation };
