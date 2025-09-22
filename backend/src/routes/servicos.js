// src/routes/servicos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import {
  getPlanContext,
  resolvePlanConfig,
  formatPlanLimitExceeded,
  isDelinquentStatus,
} from '../lib/plans.js';

const router = Router();

/**
 * GET /servicos?establishmentId=ID
 * Aceita tambem: ?estabelecimento_id= ou ?establishment_id=
 * - Publico: lista servicos do estabelecimento informado (apenas ativos).
 * - Se nao houver o parametro, repassa para o proximo handler (o protegido).
 */
router.get('/', async (req, res, next) => {
  const estabId =
    req.query.establishmentId ||
    req.query.estabelecimento_id ||
    req.query.establishment_id ||
    null;

  if (!estabId) return next(); // segue para o handler protegido abaixo

  try {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        nome                              AS title,         -- compat com o front (title || nome)
        nome,
        duracao_min,
        preco_centavos,
        ativo
      FROM servicos
      WHERE estabelecimento_id = ?
        AND (ativo IS NULL OR ativo = 1)
      ORDER BY nome
      `,
      [estabId]
    );
    return res.json(rows || []);
  } catch (e) {
    console.error('GET /servicos (public)', e);
    return res.status(500).json({ error: 'list_services_failed' });
  }
});

/**
 * GET /servicos
 * - Protegido: lista os servicos do estabelecimento logado (gestao)
 */
router.get('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const [rows] = await pool.query(
      'SELECT * FROM servicos WHERE estabelecimento_id=? ORDER BY id DESC',
      [estId]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /servicos (mine)', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /servicos
 * - Criar servico (estabelecimento logado)
 */
router.post('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { nome, duracao_min, preco_centavos, ativo = 1 } = req.body;
    if (!nome || !duracao_min) return res.status(400).json({ error: 'invalid_payload' });

    const planContext = await getPlanContext(estId);
    const planConfig = planContext?.config || resolvePlanConfig('starter');
    const planStatus = planContext?.status || 'trialing';

    if (isDelinquentStatus(planStatus)) {
      return res.status(402).json({
        error: 'plan_delinquent',
        message: 'Sua assinatura esta em atraso. Regularize o pagamento para cadastrar novos servicos.',
      });
    }

    if (planConfig.maxServices !== null) {
      const [[countRow]] = await pool.query(
        "SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?",
        [estId]
      );
      const total = Number(countRow?.total || 0);
      if (total >= planConfig.maxServices) {
        return res.status(403).json({
          error: 'plan_limit',
          message: formatPlanLimitExceeded(planConfig, 'services') || 'Limite de servicos atingido.',
          details: { limit: planConfig.maxServices, total },
        });
      }
    }

    const [r] = await pool.query(
      'INSERT INTO servicos (estabelecimento_id, nome, duracao_min, preco_centavos, ativo) VALUES (?,?,?,?,?)',
      [estId, nome, duracao_min, preco_centavos || 0, ativo ? 1 : 0]
    );
    const [novo] = await pool.query('SELECT * FROM servicos WHERE id=?', [r.insertId]);
    res.json(novo[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /servicos/:id
 * - Atualizar servico (somente do proprio estabelecimento)
 */
router.put('/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    const { nome, duracao_min, preco_centavos, ativo } = req.body;

    const [rows] = await pool.query(
      'SELECT * FROM servicos WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });

    await pool.query(
      'UPDATE servicos SET nome=?, duracao_min=?, preco_centavos=?, ativo=? WHERE id=?',
      [
        nome || rows[0].nome,
        duracao_min || rows[0].duracao_min,
        preco_centavos ?? rows[0].preco_centavos,
        (ativo ? 1 : 0),
        id
      ]
    );
    const [novo] = await pool.query('SELECT * FROM servicos WHERE id=?', [id]);
    res.json(novo[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * DELETE /servicos/:id
 * - Remover servico (somente do proprio estabelecimento)
 */
router.delete('/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    const [rows] = await pool.query(
      'DELETE FROM servicos WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    res.json({ ok: true, affectedRows: rows.affectedRows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;



