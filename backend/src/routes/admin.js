// backend/src/routes/admin.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { syncMercadoPagoPayment } from '../lib/billing.js';
import { cleanupPasswordResets } from '../lib/maintenance.js';
import { enrichMercadoPagoSubscriptionEvent } from '../lib/mercadopago_payment_outcome.js';
import { getTenantBotSettings, upsertTenantBotSettings } from '../bot/storage/settingsStore.js';
import { setAudit, diffFields } from '../lib/audit.js';
import { reconcileTenantSubscription } from '../lib/subscription_reconcile.js';
import {
  FEEDBACK_TYPES,
  NPS_EVENT_DISPENSADO,
  NPS_EVENT_EXIBIDO,
  summarizeNps,
  summarizeNpsResponseRate,
} from '../lib/product_feedback.js';

const IDENT_RE = /^[a-zA-Z0-9_]+$/;
function isIdent(s = '') { return IDENT_RE.test(String(s)); }

const router = Router();

function checkAdmin(req, res, next){
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(404).json({ error: 'admin_disabled' });
  const header = req.headers['x-admin-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && header === adminToken) {
    // Admin não tem JWT: sem esta marca o ator sairia como "anônimo" na trilha.
    req.isAdminRequest = true;
    return next();
  }
  // Tentativa de acesso admin com token errado é o tipo de evento que só faz sentido se for
  // registrado no momento em que acontece.
  setAudit(req, {
    acao: 'admin.acesso_negado',
    ator_tipo: 'anonimo',
    resultado: 'negado',
    motivo: header ? 'token_invalido' : 'token_ausente',
  });
  return res.status(403).json({ error: 'forbidden' });
}

// Toda rota admin é auditável por natureza: GET inclusive (listar usuários, ler tabela do banco).
// O middleware genérico só persiste mutações, então aqui marcamos tudo explicitamente.
function auditAdmin(acao, extra = {}) {
  return (req, _res, next) => {
    setAudit(req, { acao, ator_tipo: 'admin', ...extra });
    next();
  };
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

// Reconcilia a assinatura de um tenant preso em "PIX pendente" apesar de ativo (pendente orfa que
// sobrou de cliques repetidos antes da trava/supersede-protegido). DRY-RUN por padrao: so devolve o
// plano. Passe apply=true para aplicar (cancela orfas local+gateway e restaura a linha paga).
//   body: { estabelecimentoId | email, apply?, cancelGateway? }
router.post('/subscriptions/reconcile', checkAdmin, auditAdmin('admin.subscription_reconcile'), async (req, res) => {
  try {
    let estabelecimentoId = Number(req.body?.estabelecimentoId || req.body?.estabelecimento_id || 0) || null;
    const email = String(req.body?.email || '').trim();
    if (!estabelecimentoId && email) {
      const [rows] = await pool.query("SELECT id FROM usuarios WHERE email=? AND tipo='estabelecimento' LIMIT 1", [email]);
      estabelecimentoId = rows?.[0]?.id || null;
    }
    if (!estabelecimentoId) {
      return res.status(400).json({ error: 'estabelecimento_required', message: 'Informe estabelecimentoId ou email.' });
    }
    const apply = parseBool(req.body?.apply, false);
    const cancelGateway = parseBool(req.body?.cancelGateway, true);
    const report = await reconcileTenantSubscription(estabelecimentoId, { apply, cancelGateway });
    return res.status(200).json({ ok: true, dry_run: !apply, ...report });
  } catch (err) {
    console.error('[admin/subscriptions/reconcile]', err?.message || err);
    const code = err?.message === 'estabelecimento_not_found' ? 404 : 500;
    return res.status(code).json({ error: 'reconcile_failed', message: err?.message || 'Falha ao reconciliar.' });
  }
});

// Panorama de TODOS os estabelecimentos: plano/status/vencimento + contagens (profissionais, servicos
// ativos/inativos, agendamentos). Agregados por GROUP BY (uma query por metrica) e casados em memoria —
// bem mais barato que subquery correlacionada por linha.
router.get('/establishments/overview', checkAdmin, auditAdmin('admin.establishments_overview', { entidade: 'estabelecimentos' }), async (_req, res) => {
  try {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;

    const [estabs] = await pool.query(
      `SELECT id, nome, email, telefone, plan, plan_status, plan_cycle, plan_active_until
         FROM usuarios WHERE tipo='estabelecimento' ORDER BY nome ASC`,
    );
    const [profRows] = await pool.query(
      `SELECT estabelecimento_id AS eid, COUNT(*) AS total, SUM(ativo=1) AS ativos
         FROM profissionais GROUP BY estabelecimento_id`,
    );
    // servico ativo = ativo IS NULL OR ativo=1 (mesma regra do app); inativo = ativo=0 explicito.
    const [svcRows] = await pool.query(
      `SELECT estabelecimento_id AS eid, COUNT(*) AS total,
              SUM(ativo IS NULL OR ativo=1) AS ativos, SUM(ativo=0) AS inativos
         FROM servicos GROUP BY estabelecimento_id`,
    );
    const [aptRows] = await pool.query(
      `SELECT estabelecimento_id AS eid, COUNT(*) AS total,
              SUM(inicio >= ?) AS mes, SUM(status='cancelado') AS cancelados
         FROM agendamentos GROUP BY estabelecimento_id`,
      [startOfMonth],
    );

    // Sinal de satisfação por tenant. Grão de ESTABELECIMENTO (a última nota daquela conta e se ela
    // sinalizou saída), que é o que justifica morar aqui — o painel de feedback tem grão de
    // resposta e boa parte das linhas de lá é anônima, sem tenant nenhum.
    //
    // Vale a pena ao lado do plano e do vencimento: dono insatisfeito com renovação chegando é a
    // combinação que decide para quem ligar hoje.
    const [feedbackRows] = await pool.query(
      `SELECT usuario_id AS eid,
              MAX(CASE WHEN tipo = 'nps' AND nota IS NOT NULL THEN created_at END) AS nps_em,
              SUBSTRING_INDEX(
                GROUP_CONCAT(CASE WHEN tipo = 'nps' AND nota IS NOT NULL THEN nota END
                             ORDER BY created_at DESC), ',', 1
              ) AS nps_nota,
              MAX(tipo IN ('cancelamento', 'downgrade')
                  AND created_at >= (NOW() - INTERVAL 90 DAY)) AS sinalizou_saida
         FROM product_feedback
        WHERE usuario_id IS NOT NULL
        GROUP BY usuario_id`,
    );

    const indexBy = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(Number(r.eid), r);
      return m;
    };
    const profMap = indexBy(profRows);
    const svcMap = indexBy(svcRows);
    const aptMap = indexBy(aptRows);
    const fbMap = indexBy(feedbackRows);
    const num = (v) => Number(v || 0);

    const establishments = estabs.map((e) => {
      const p = profMap.get(Number(e.id)) || {};
      const s = svcMap.get(Number(e.id)) || {};
      const a = aptMap.get(Number(e.id)) || {};
      const f = fbMap.get(Number(e.id)) || {};
      return {
        id: e.id,
        nome: e.nome,
        email: e.email,
        telefone: e.telefone || null,
        plan: e.plan || null,
        plan_status: e.plan_status || null,
        plan_cycle: e.plan_cycle || null,
        plan_active_until: e.plan_active_until || null,
        professionals: { active: num(p.ativos), total: num(p.total) },
        services: { active: num(s.ativos), inactive: num(s.inativos), total: num(s.total) },
        appointments: { total: num(a.total), month: num(a.mes), canceled: num(a.cancelados) },
        feedback: {
          // null (nunca respondeu) é diferente de 0 (respondeu zero) — a tela precisa distinguir
          // "não sei o que essa pessoa acha" de "essa pessoa nos odeia".
          nps: f.nps_nota === null || f.nps_nota === undefined || f.nps_nota === '' ? null : Number(f.nps_nota),
          nps_em: f.nps_em || null,
          sinalizou_saida: Boolean(Number(f.sinalizou_saida || 0)),
        },
      };
    });

    return res.json({ ok: true, count: establishments.length, generated_at: now.toISOString(), month_start: startOfMonth, establishments });
  } catch (e) {
    console.error('[admin/establishments/overview]', e?.message || e);
    return res.status(500).json({ error: 'db_error', message: e?.message || String(e) });
  }
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
      let normalized_reason = null;
      let action_recommendation = null;
      let decision = null;
      try {
        const payload = r.payload ? JSON.parse(r.payload) : null;
        const enriched = enrichMercadoPagoSubscriptionEvent({
          event_type: r.event_type,
          gateway_event_id: r.gateway_event_id,
          created_at: r.created_at,
          payload,
        }, { includePending: true });
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
        status = enriched?.status || status;
        status_detail = enriched?.status_detail || status_detail;
        normalized_reason = enriched?.normalized_reason || null;
        action_recommendation = enriched?.action_recommendation || null;
        decision = enriched?.decision || null;
      } catch {}
      const { payload, ...rest } = r;
      return { ...rest, kind, status, status_detail, normalized_reason, action_recommendation, decision };
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

// Feedback de produto: respostas cruas + NPS consolidado.
//
// Admin, e não uma tela do dono, porque isto é o que os CLIENTES acham da plataforma — inclusive
// os que saíram. Não é dado de tenant nenhum; é dado sobre nós.
router.get('/feedback', checkAdmin, auditAdmin('admin.feedback.listar', { entidade: 'product_feedback' }), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const tipo = String(req.query.tipo || '').trim().toLowerCase();
  // Filtro validado contra a lista, e não interpolado: `tipo` vem da query string.
  const tipoFiltro = FEEDBACK_TYPES.includes(tipo) ? tipo : null;
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 90, 1), 730);
  try {
    const where = ['created_at >= (NOW() - INTERVAL ? DAY)'];
    const params = [dias];
    if (tipoFiltro) { where.push('tipo = ?'); params.push(tipoFiltro); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // A listagem esconde os eventos de exibição/dispensa: eles não são resposta de ninguém e
    // encheriam o feed com dezenas de linhas vazias, afogando os comentários — que são o conteúdo.
    // Eles seguem contando nos agregados (é de lá que sai a taxa de resposta).
    const [rows] = await pool.query(
      `SELECT f.id, f.tipo, f.motivo, f.nota, f.comentario, f.usuario_id, f.plano, f.contexto, f.created_at,
              u.nome AS usuario_nome, u.email AS usuario_email, u.telefone AS usuario_telefone
         FROM product_feedback f
         LEFT JOIN usuarios u ON u.id = f.usuario_id
         ${whereSql} AND NOT (f.tipo = 'nps' AND f.nota IS NULL)
        ORDER BY f.id DESC
        LIMIT ?`,
      [...params, limit]
    );

    // Agregados sobre a JANELA inteira, não sobre as `limit` linhas devolvidas: senão o NPS
    // mudaria conforme o tamanho da página, que é o jeito mais silencioso de errar uma métrica.
    const [motivos] = await pool.query(
      `SELECT tipo, motivo, COUNT(*) AS total
         FROM product_feedback
         ${whereSql} AND NOT (tipo = 'nps' AND nota IS NULL)
        GROUP BY tipo, motivo
        ORDER BY total DESC`,
      params
    );
    const [notas] = await pool.query(
      `SELECT nota FROM product_feedback ${whereSql} AND tipo = 'nps' AND nota IS NOT NULL`,
      params
    );

    // Denominador da taxa de resposta. Sem isto, NPS vazio é ambíguo entre "ninguém insatisfeito"
    // e "a caixa não apareceu para ninguém".
    const [[alcance]] = await pool.query(
      `SELECT SUM(motivo = ?) AS exibicoes,
              SUM(motivo = ?) AS dispensas,
              SUM(nota IS NOT NULL) AS respostas
         FROM product_feedback
        WHERE created_at >= (NOW() - INTERVAL ? DAY) AND tipo = 'nps'`,
      [NPS_EVENT_EXIBIDO, NPS_EVENT_DISPENSADO, dias]
    );

    // Série mensal do NPS. Agrupada no MySQL (e não em JS sobre as linhas devolvidas) para não
    // depender do `limit` — a série precisa enxergar a janela inteira.
    const [serie] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS mes,
              COUNT(*) AS respostas,
              SUM(nota >= 9) AS promotores,
              SUM(nota BETWEEN 7 AND 8) AS neutros,
              SUM(nota <= 6) AS detratores
         FROM product_feedback
        WHERE created_at >= (NOW() - INTERVAL ? DAY) AND tipo = 'nps' AND nota IS NOT NULL
        GROUP BY mes
        ORDER BY mes ASC`,
      [dias]
    );

    res.json({
      feedback: rows,
      motivos,
      nps: summarizeNps(notas),
      alcance: summarizeNpsResponseRate({
        exibicoes: Number(alcance?.exibicoes || 0),
        dispensas: Number(alcance?.dispensas || 0),
        respostas: Number(alcance?.respostas || 0),
      }),
      serie: serie.map((s) => ({
        mes: s.mes,
        respostas: Number(s.respostas || 0),
        promotores: Number(s.promotores || 0),
        neutros: Number(s.neutros || 0),
        detratores: Number(s.detratores || 0),
        score: Number(s.respostas)
          ? Math.round(((Number(s.promotores || 0) - Number(s.detratores || 0)) / Number(s.respostas)) * 100)
          : null,
      })),
      limit,
      dias,
      tipo: tipoFiltro,
    });
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
router.get('/db/tables', checkAdmin, auditAdmin('admin.db.tables', { entidade: 'banco' }), async (_req, res) => {
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
  // Leitura direta de dados de produção: fica na trilha com o nome da tabela lida.
  setAudit(req, { acao: 'admin.db.rows', ator_tipo: 'admin', entidade: 'banco', entidade_id: table });
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
  const first = sql.split(/\s+/)[0].toUpperCase();
  const isRead = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(first);

  // A rota mais perigosa do sistema: SQL arbitrário contra o banco de produção. A trilha guarda o
  // comando exato, sempre — inclusive quando ele é recusado.
  setAudit(req, {
    acao: 'admin.db_exec',
    ator_tipo: 'admin',
    entidade: 'banco',
    metadados: { sql, param_count: params.length, escrita: !isRead, write_header: allowWrite },
  });

  if (!sql) return res.status(400).json({ error: 'sql_missing' });
  if (!isRead && !allowWrite) {
    setAudit(req, { resultado: 'negado', motivo: 'write_not_allowed' });
    return res.status(403).json({ error: 'write_not_allowed', message: 'Para comandos de escrita, envie X-Admin-Allow-Write: 1' });
  }
  try {
    const [rows] = await pool.query(sql, params);
    setAudit(req, { metadados: { linhas_afetadas: Array.isArray(rows) ? rows.length : (rows?.affectedRows ?? null) } });
    res.json({ ok: true, rows });
  } catch (e) {
    setAudit(req, { resultado: 'falha', motivo: (e?.message || String(e)).slice(0, 255) });
    res.status(400).json({ error: 'sql_error', message: e?.message || String(e) });
  }
});

// Listagem rápida de usuários
router.get('/users', checkAdmin, auditAdmin('admin.usuarios.listar', { entidade: 'usuario' }), async (req, res) => {
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
    const SNAPSHOT = `SELECT id, nome, email, tipo, plan, plan_status, plan_trial_ends_at, plan_active_until FROM usuarios WHERE id=?`;
    const [[before]] = await pool.query(SNAPSHOT, [id]);
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id=? LIMIT 1`, values);
    const [[row]] = await pool.query(SNAPSHOT, [id]);
    const diff = diffFields(before, row, allowed);
    setAudit(req, {
      acao: 'admin.usuario.update',
      ator_tipo: 'admin',
      entidade: 'usuario',
      entidade_id: id,
      dados_antes: diff?.antes || null,
      dados_depois: diff?.depois || null,
    });
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

