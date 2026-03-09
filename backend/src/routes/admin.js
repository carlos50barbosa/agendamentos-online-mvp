// backend/src/routes/admin.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { syncMercadoPagoPayment } from '../lib/billing.js';
import { cleanupPasswordResets } from '../lib/maintenance.js';
import { getTenantBotSettings, upsertTenantBotSettings } from '../bot/storage/settingsStore.js';

const IDENT_RE = /^[a-zA-Z0-9_]+$/;
function isIdent(s = '') { return IDENT_RE.test(String(s)); }

const router = Router();

function checkAdmin(req, res, next){
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(404).json({ error: 'admin_disabled' });
  const header = req.headers['x-admin-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && header === adminToken) return next();
  return res.status(403).json({ error: 'forbidden' });
}

function parseDateParam(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'sim'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off', 'nao'].includes(raw)) return false;
  return fallback;
}

router.post('/cleanup', checkAdmin, async (_req, res) => {
  const r = await cleanupPasswordResets(pool);
  res.json({ ok: true, ...r });
});

// Billing: listar eventos recentes (subscription_events)
router.get('/billing/events', checkAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  try {
    const sql = `
      SELECT se.id, se.subscription_id, se.event_type, se.gateway_event_id, se.created_at, se.payload,
             s.estabelecimento_id, s.plan, s.status AS subscription_status, s.billing_cycle,
             u.nome AS estab_nome, u.email AS estab_email
      FROM subscription_events se
      JOIN subscriptions s ON s.id = se.subscription_id
      LEFT JOIN usuarios u ON u.id = s.estabelecimento_id
      ORDER BY se.id DESC
      LIMIT ?`;
    const [rows] = await pool.query(sql, [limit]);
    const events = rows.map((r) => {
      let status = null;
      let status_detail = null;
      let kind = null;
      try {
        const payload = r.payload ? JSON.parse(r.payload) : null;
        if (payload?.preapproval) {
          kind = 'preapproval';
          status = payload.preapproval.status || null;
          status_detail = payload.preapproval.status_detail || null;
        } else if (payload?.payment) {
          kind = 'payment';
          status = payload.payment.status || null;
          status_detail = payload.payment.status_detail || null;
        } else if (payload?.event?.type) {
          kind = String(payload.event.type);
        }
      } catch {}
      const { payload, ...rest } = r;
      return { ...rest, kind, status, status_detail };
    });
    res.json({ events, limit });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Billing: listar assinaturas recentes
router.get('/billing/subscriptions', checkAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  try {
    const sql = `
      SELECT s.id, s.estabelecimento_id, s.plan, s.status, s.amount_cents, s.currency, s.billing_cycle,
             s.gateway, s.gateway_subscription_id, s.gateway_preference_id, s.external_reference,
             s.current_period_end, s.created_at, s.updated_at,
             u.nome AS estab_nome, u.email AS estab_email
      FROM subscriptions s
      LEFT JOIN usuarios u ON u.id = s.estabelecimento_id
      ORDER BY s.id DESC
      LIMIT ?`;
    const [rows] = await pool.query(sql, [limit]);
    res.json({ subscriptions: rows, limit });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Forçar sincronização de um pagamento (PIX) por payment_id
router.post('/billing/sync-payment', checkAdmin, async (req, res) => {
  const id = String(
    (req.body && (req.body.payment_id || req.body.id)) ||
    (req.query && (req.query.payment_id || req.query.id)) ||
    ''
  ).trim();
  if (!id) return res.status(400).json({ error: 'missing_payment_id' });
  try {
    const r = await syncMercadoPagoPayment(id, { forced_by: 'admin' });
    res.json({ ok: !!(r && r.ok), result: r });
  } catch (e) {
    res.status(400).json({ error: 'sync_failed', message: e?.message || String(e) });
  }
});

// Listar tabelas do banco
router.get('/db/tables', checkAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SHOW TABLES');
    const list = rows.map((r) => Object.values(r)[0]);
    res.json({ tables: list });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Descrever colunas de uma tabela
router.get('/db/table/:name/columns', checkAdmin, async (req, res) => {
  const table = String(req.params.name || '').trim();
  if (!isIdent(table)) return res.status(400).json({ error: 'invalid_table' });
  try {
    const [rows] = await pool.query(`DESCRIBE \`${table}\``);
    res.json({ table, columns: rows });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Obter linhas de uma tabela (simples, sem filtros complexos)
router.get('/db/table/:name/rows', checkAdmin, async (req, res) => {
  const table = String(req.params.name || '').trim();
  if (!isIdent(table)) return res.status(400).json({ error: 'invalid_table' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const order = String(req.query.order || '').trim();
  let orderSql = '';
  if (order) {
    const parts = order.split(/\s+/);
    const col = parts[0]; const dir = (parts[1] || '').toUpperCase();
    if (isIdent(col)) {
      orderSql = `ORDER BY \`${col}\` ${dir === 'DESC' ? 'DESC' : 'ASC'}`;
    }
  }
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` ${orderSql} LIMIT ? OFFSET ?`, [limit, offset]);
    const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    res.json({ table, rows, total: Number(countRow?.total || 0), limit, offset });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Executar SQL (modo leitura por padrão). Para escrita, exija cabeçalho X-Admin-Allow-Write: 1
router.post('/db/exec', checkAdmin, async (req, res) => {
  const sql = String(req.body?.sql || '').trim();
  const params = Array.isArray(req.body?.params) ? req.body.params : [];
  const allowWrite = String(req.headers['x-admin-allow-write'] || req.query.write || '') === '1';
  if (!sql) return res.status(400).json({ error: 'sql_missing' });
  const first = sql.split(/\s+/)[0].toUpperCase();
  const isRead = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(first);
  if (!isRead && !allowWrite) {
    return res.status(403).json({ error: 'write_not_allowed', message: 'Para comandos de escrita, envie X-Admin-Allow-Write: 1' });
  }
  try {
    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ error: 'sql_error', message: e?.message || String(e) });
  }
});

// Listagem rápida de usuários
router.get('/users', checkAdmin, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const [rows] = await pool.query(
      `SELECT id, nome, email, tipo, plan, plan_status, plan_trial_ends_at, plan_active_until
       FROM usuarios ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]
    );
    res.json({ users: rows, limit, offset });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

// Atualização básica de um usuário (campos específicos)
router.put('/users/:id', checkAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  const allowed = ['nome','email','tipo','plan','plan_status','plan_trial_ends_at','plan_active_until'];
  const sets = []; const values = [];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      sets.push(`${k}=?`);
      values.push(req.body[k] ?? null);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'no_fields' });
  values.push(id);
  try {
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id=? LIMIT 1`, values);
    const [[row]] = await pool.query(`SELECT id, nome, email, tipo, plan, plan_status, plan_trial_ends_at, plan_active_until FROM usuarios WHERE id=?`, [id]);
    res.json({ ok: true, user: row });
  } catch (e) {
    res.status(400).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

router.get('/wa-bot/settings', checkAdmin, async (req, res) => {
  const tenantId = Number(req.query.tenant_id || 0);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return res.status(400).json({ error: 'invalid_tenant_id' });
  }
  try {
    const settings = await getTenantBotSettings(tenantId);
    return res.json({ tenant_id: tenantId, settings });
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

router.put('/wa-bot/settings/:tenantId', checkAdmin, async (req, res) => {
  const tenantId = Number(req.params.tenantId || 0);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return res.status(400).json({ error: 'invalid_tenant_id' });
  }
  const mode = String(req.body?.mode || 'hybrid').toLowerCase();
  if (!['bot_only', 'hybrid', 'human_only'].includes(mode)) {
    return res.status(400).json({ error: 'invalid_mode' });
  }
  const rolloutPercent = Number(req.body?.rollout_percent ?? req.body?.rolloutPercent ?? 0);
  if (!Number.isFinite(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    return res.status(400).json({ error: 'invalid_rollout_percent' });
  }
  try {
    await upsertTenantBotSettings({
      tenantId,
      enabled: parseBool(req.body?.enabled, false),
      mode,
      rolloutPercent,
      killSwitch: parseBool(req.body?.kill_switch ?? req.body?.killSwitch, false),
    });
    const settings = await getTenantBotSettings(tenantId);
    return res.json({ ok: true, tenant_id: tenantId, settings });
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

router.get('/wa-bot/metrics', checkAdmin, async (req, res) => {
  const tenantIdRaw = req.query.tenant_id;
  const tenantId = tenantIdRaw != null ? Number(tenantIdRaw) : null;
  if (tenantIdRaw != null && (!Number.isFinite(tenantId) || tenantId <= 0)) {
    return res.status(400).json({ error: 'invalid_tenant_id' });
  }
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = parseDateParam(req.query.from, defaultFrom);
  const to = parseDateParam(req.query.to, today);
  if (!from || !to) {
    return res.status(400).json({ error: 'invalid_date_range' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'invalid_date_order' });
  }
  try {
    const params = [from, to];
    let whereTenant = '';
    if (tenantId) {
      whereTenant = ' AND tenant_id=?';
      params.push(tenantId);
    }
    const [rows] = await pool.query(
      `SELECT tenant_id, day, inbound_count, started_agendar, completed_agendar,
              started_remarcar, completed_remarcar, started_cancelar, completed_cancelar,
              conflicts_409, handoff_opened, outside_window_template_sent, errors_count, updated_at
         FROM wa_bot_metrics_daily
        WHERE day BETWEEN ? AND ?${whereTenant}
        ORDER BY day DESC, tenant_id ASC`,
      params
    );
    return res.json({ metrics: rows, from, to, tenant_id: tenantId || null });
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

router.get('/wa-bot/conversations', checkAdmin, async (req, res) => {
  const tenantIdRaw = req.query.tenant_id;
  const tenantId = tenantIdRaw != null ? Number(tenantIdRaw) : null;
  if (tenantIdRaw != null && (!Number.isFinite(tenantId) || tenantId <= 0)) {
    return res.status(400).json({ error: 'invalid_tenant_id' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  try {
    const params = [];
    let whereTenant = '';
    if (tenantId) {
      whereTenant = 'WHERE l.tenant_id=?';
      params.push(tenantId);
    }
    params.push(limit);
    const [rows] = await pool.query(
      `SELECT l.id, l.tenant_id, l.from_phone, l.message_id, l.intent, l.prev_state, l.next_state,
              l.action, l.endpoint_called, l.endpoint_result, l.reply_type,
              l.tenant_resolution_source, l.latency_ms, l.created_at,
              s.state AS session_state, s.expires_at, s.last_interaction_at,
              hq.status AS handoff_status, hq.id AS handoff_id
         FROM wa_conversation_logs l
         LEFT JOIN wa_sessions s ON s.tenant_id=l.tenant_id AND s.from_phone=l.from_phone
         LEFT JOIN wa_handoff_queue hq ON hq.id = (
           SELECT x.id
             FROM wa_handoff_queue x
            WHERE x.tenant_id=l.tenant_id AND x.from_phone=l.from_phone AND x.status IN ('open','assigned')
            ORDER BY x.id DESC
            LIMIT 1
         )
         ${whereTenant}
        ORDER BY l.id DESC
        LIMIT ?`,
      params
    );
    return res.json({ conversations: rows, limit, tenant_id: tenantId || null });
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
});

export default router;

