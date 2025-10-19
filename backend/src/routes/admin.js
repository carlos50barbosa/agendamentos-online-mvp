// backend/src/routes/admin.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { cleanupPasswordResets } from '../lib/maintenance.js';

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

export default router;

