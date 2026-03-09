import { pool } from '../../lib/db.js';

const DEFAULT_STATE = 'START';
const DEFAULT_TTL_MINUTES = (() => {
  const raw = Number(process.env.WA_BOT_SESSION_TTL_MIN || 120);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 120;
})();

function isMissingColumnError(err) {
  return err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054;
}

function emptySession(overrides = {}) {
  return {
    state: DEFAULT_STATE,
    context: {},
    expiresAt: null,
    lastInteractionAt: null,
    ...overrides,
  };
}

function parseContext(raw) {
  if (!raw) return {};
  try {
    if (typeof raw === 'string') return JSON.parse(raw) || {};
    if (typeof raw === 'object') return raw;
    return {};
  } catch {
    return {};
  }
}

function computeExpiry(ttlMinutes = DEFAULT_TTL_MINUTES) {
  const minutes = Number.isFinite(Number(ttlMinutes)) && Number(ttlMinutes) > 0
    ? Number(ttlMinutes)
    : DEFAULT_TTL_MINUTES;
  return new Date(Date.now() + minutes * 60_000);
}

async function getSession({ tenantId, fromPhone }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!tenant || !phone) return emptySession();
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT state, context_json, expires_at, last_interaction_at
         FROM wa_sessions
        WHERE tenant_id=? AND from_phone=?
        LIMIT 1`,
      [tenant, phone]
    );
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    [rows] = await pool.query(
      `SELECT state, context_json, expires_at
         FROM wa_sessions
        WHERE tenant_id=? AND from_phone=?
        LIMIT 1`,
      [tenant, phone]
    );
  }
  const row = rows?.[0];
  if (!row) return emptySession();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return emptySession({
      lastInteractionAt: row.last_interaction_at ? new Date(row.last_interaction_at).toISOString() : null,
    });
  }
  return emptySession({
    state: String(row.state || DEFAULT_STATE),
    context: parseContext(row.context_json),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    lastInteractionAt: row.last_interaction_at ? new Date(row.last_interaction_at).toISOString() : null,
  });
}

async function saveSession({ tenantId, fromPhone, state, context, ttlMinutes, lastInteractionAt }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!tenant || !phone) return { ok: false };
  const nextState = String(state || DEFAULT_STATE);
  const nextContext = context && typeof context === 'object' ? context : {};
  const expiresAt = computeExpiry(ttlMinutes);
  const parsedInteraction = lastInteractionAt ? new Date(lastInteractionAt) : null;
  const interactionValue = parsedInteraction && Number.isFinite(parsedInteraction.getTime())
    ? parsedInteraction
    : null;
  const contextJson = JSON.stringify(nextContext);
  try {
    await pool.query(
      `INSERT INTO wa_sessions (tenant_id, from_phone, state, context_json, updated_at, expires_at, last_interaction_at)
       VALUES (?,?,?,?,NOW(),?,?)
       ON DUPLICATE KEY UPDATE
         state=VALUES(state),
         context_json=VALUES(context_json),
         updated_at=NOW(),
         expires_at=VALUES(expires_at),
         last_interaction_at=COALESCE(VALUES(last_interaction_at), last_interaction_at)`,
      [tenant, phone, nextState, contextJson, expiresAt, interactionValue]
    );
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    await pool.query(
      `INSERT INTO wa_sessions (tenant_id, from_phone, state, context_json, updated_at, expires_at)
       VALUES (?,?,?,?,NOW(),?)
       ON DUPLICATE KEY UPDATE
         state=VALUES(state),
         context_json=VALUES(context_json),
         updated_at=NOW(),
         expires_at=VALUES(expires_at)`,
      [tenant, phone, nextState, contextJson, expiresAt]
    );
  }
  return {
    ok: true,
    expiresAt: expiresAt.toISOString(),
    lastInteractionAt: interactionValue ? interactionValue.toISOString() : null,
  };
}

async function clearSession({ tenantId, fromPhone }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!tenant || !phone) return { ok: false };
  await pool.query('DELETE FROM wa_sessions WHERE tenant_id=? AND from_phone=?', [tenant, phone]);
  return { ok: true };
}

async function touchLastInteraction({ tenantId, fromPhone, at = new Date() }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!tenant || !phone) return { ok: false };
  const dt = new Date(at);
  if (!Number.isFinite(dt.getTime())) return { ok: false };
  const expiresAt = computeExpiry();
  try {
    await pool.query(
      `INSERT INTO wa_sessions (tenant_id, from_phone, state, context_json, updated_at, expires_at, last_interaction_at)
       VALUES (?,?,'START','{}',NOW(),?,?)
       ON DUPLICATE KEY UPDATE
         updated_at=NOW(),
         expires_at=VALUES(expires_at),
         last_interaction_at=VALUES(last_interaction_at)`,
      [tenant, phone, expiresAt, dt]
    );
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    await pool.query(
      `INSERT INTO wa_sessions (tenant_id, from_phone, state, context_json, updated_at, expires_at)
       VALUES (?,?,'START','{}',NOW(),?)
       ON DUPLICATE KEY UPDATE
         updated_at=NOW(),
         expires_at=VALUES(expires_at)`,
      [tenant, phone, expiresAt]
    );
    return { ok: true, skipped: true, reason: 'column_missing' };
  }
  return { ok: true, lastInteractionAt: dt.toISOString() };
}

export { DEFAULT_STATE, DEFAULT_TTL_MINUTES, emptySession, getSession, saveSession, clearSession, touchLastInteraction };
