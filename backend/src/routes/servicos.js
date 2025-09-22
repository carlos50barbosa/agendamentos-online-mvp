// src/routes/servicos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

const STARTER_MAX_SERVICES = 10;

async function getPlanForEstabelecimento(estId) {
  const [rows] = await pool.query("SELECT plan FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1", [estId]);
  return rows && rows.length ? rows[0].plan || 'starter' : 'starter';
}

/**
 * GET /servicos?establishmentId=ID
 * Aceita também: ?estabelecimento_id= ou ?establishment_id=
 * — Público: lista serviços do estabelecimento informado (apenas ativos).
 * — Se não houver o parâmetro, repassa para o próximo handler (o protegido).
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
 * — Protegido: lista os serviços do estabelecimento logado (gestão)
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
 * — Criar serviço (estabelecimento logado)
 */
router.post('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { nome, duracao_min, preco_centavos, ativo = 1 } = req.body;
    if (!nome || !duracao_min) return res.status(400).json({ error: 'invalid_payload' });

    const plan = await getPlanForEstabelecimento(estId);
    if (plan === 'starter') {
      const [[countRow]] = await pool.query("SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?", [estId]);
      if (Number(countRow?.total || 0) >= STARTER_MAX_SERVICES) {
        return res.status(403).json({ error: 'plan_limit', message: 'Seu plano atual (Starter) permite cadastrar at� 10 servi�os. Para continuar adicionando servi�os, atualize para o plano Pro ou Premium em Configura��es > Planos.' });
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
 * — Atualizar serviço (somente do próprio estabelecimento)
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
 * — Remover serviço (somente do próprio estabelecimento)
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
