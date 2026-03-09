import { pool } from '../../lib/db.js';

function normalizePhone(value) {
  return String(value || '').trim();
}

async function getActiveHandoff({ tenantId, fromPhone }) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) return null;
  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, from_phone, reason, status, assigned_to, created_at, updated_at
         FROM wa_handoff_queue
        WHERE tenant_id=? AND from_phone=? AND status IN ('open','assigned')
        ORDER BY id DESC
        LIMIT 1`,
      [tenant, phone]
    );
    return rows?.[0] || null;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) return null;
    throw err;
  }
}

async function openHandoff({ tenantId, fromPhone, reason }) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  const why = String(reason || 'manual').slice(0, 128);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) {
    return { ok: false, created: false, item: null };
  }
  const existing = await getActiveHandoff({ tenantId: tenant, fromPhone: phone });
  if (existing) return { ok: true, created: false, item: existing };
  try {
    const [result] = await pool.query(
      `INSERT INTO wa_handoff_queue
        (tenant_id, from_phone, reason, status, assigned_to, created_at, updated_at, closed_at)
       VALUES (?,?,?,'open',NULL,NOW(),NOW(),NULL)`,
      [tenant, phone, why]
    );
    const id = Number(result?.insertId || 0);
    const item = id
      ? await getActiveHandoff({ tenantId: tenant, fromPhone: phone })
      : null;
    return { ok: true, created: true, item: item || { id, tenant_id: tenant, from_phone: phone, reason: why, status: 'open' } };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, created: false, tableMissing: true, item: null };
    }
    throw err;
  }
}

async function closeHandoff({ tenantId, fromPhone, closedBy }) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  const actor = String(closedBy || 'bot').slice(0, 64);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) return { ok: false, affectedRows: 0 };
  try {
    const [result] = await pool.query(
      `UPDATE wa_handoff_queue
          SET status='closed',
              reason=CONCAT(IFNULL(reason,''), ' | closed_by:', ?),
              updated_at=NOW(),
              closed_at=NOW()
        WHERE tenant_id=? AND from_phone=? AND status IN ('open','assigned')`,
      [actor, tenant, phone]
    );
    return { ok: true, affectedRows: Number(result?.affectedRows || 0) };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, affectedRows: 0, tableMissing: true };
    }
    throw err;
  }
}

export { getActiveHandoff, openHandoff, closeHandoff };
