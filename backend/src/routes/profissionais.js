import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import {
  getPlanContext,
  resolvePlanConfig,
  formatPlanLimitExceeded,
  isDelinquentStatus,
} from '../lib/plans.js';
import { saveAvatarFromDataUrl, removeAvatarFile } from '../lib/avatar.js';

const router = Router();

function toBoolean(value) {
  if (value === true || value === false) return value;
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return false;
  return ['1', 'true', 'yes', 'on'].includes(lower);
}

router.get('/', async (req, res, next) => {
  const estabId =
    req.query.establishmentId ||
    req.query.estabelecimento_id ||
    req.query.establishment_id ||
    null;

  if (!estabId) return next();

  try {
    const [rows] = await pool.query(
      `SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo
       FROM profissionais
       WHERE estabelecimento_id=? AND (ativo IS NULL OR ativo=1)
       ORDER BY nome`,
      [estabId]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('[profissionais][public] list', err);
    res.status(500).json({ error: 'list_profissionais_failed' });
  }
});

router.get('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const [rows] = await pool.query(
      `SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, created_at
       FROM profissionais
       WHERE estabelecimento_id=?
       ORDER BY nome`,
      [estId]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('[profissionais][mine] list', err);
    res.status(500).json({ error: 'list_profissionais_failed' });
  }
});

router.post('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    let { nome, descricao, avatar, ativo = true } = req.body || {};
    nome = String(nome || '').trim();
    descricao = descricao == null ? null : String(descricao).trim();
    const isActive = toBoolean(ativo);

    if (!nome) {
      return res.status(400).json({ error: 'nome_obrigatorio', message: 'Informe o nome do profissional.' });
    }

    const planContext = await getPlanContext(estId);
    const planConfig = planContext?.config || resolvePlanConfig('starter');
    const planStatus = planContext?.status || 'trialing';

    if (isDelinquentStatus(planStatus)) {
      return res.status(402).json({
        error: 'plan_delinquent',
        message: 'Sua assinatura esta em atraso. Regularize o pagamento para cadastrar profissionais.',
      });
    }

    if (planConfig.maxProfessionals !== null) {
      const [[countRow]] = await pool.query(
        'SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id=?',
        [estId]
      );
      const total = Number(countRow?.total || 0);
      if (total >= planConfig.maxProfessionals) {
        return res.status(403).json({
          error: 'plan_limit',
          message: formatPlanLimitExceeded(planConfig, 'professionals') || 'Limite de profissionais atingido.',
          details: { limit: planConfig.maxProfessionals, total },
        });
      }
    }

    let avatarUrl = null;
    if (avatar) {
      try {
        avatarUrl = await saveAvatarFromDataUrl(avatar, estId, null);
      } catch (err) {
        if (err?.code === 'AVATAR_TOO_LARGE') {
          return res.status(400).json({ error: 'avatar_grande', message: 'A imagem deve ter no maximo 2MB.' });
        }
        if (err?.code === 'AVATAR_INVALID') {
          return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[profissionais][create] avatar', err);
        return res.status(500).json({ error: 'avatar_falhou', message: 'Nao foi possivel salvar a foto.' });
      }
    }

    const [insert] = await pool.query(
      'INSERT INTO profissionais (estabelecimento_id, nome, descricao, avatar_url, ativo) VALUES (?,?,?,?,?)',
      [estId, nome, descricao || null, avatarUrl, isActive ? 1 : 0]
    );

    const [[row]] = await pool.query(
      'SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, created_at FROM profissionais WHERE id=?',
      [insert.insertId]
    );
    return res.json(row);
  } catch (err) {
    console.error('[profissionais][create]', err);
    return res.status(500).json({ error: 'create_profissional_failed' });
  }
});

router.put('/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    let { nome, descricao, avatar, avatarRemove, ativo } = req.body || {};

    const [[row]] = await pool.query(
      'SELECT id, nome, descricao, avatar_url, ativo FROM profissionais WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });

    const nextNome = nome != null ? String(nome).trim() : row.nome;
    const nextDescricao = descricao != null ? String(descricao).trim() : row.descricao;
    const wantsRemove = avatarRemove === true || avatarRemove === 'true';
    const hasAvatarData = typeof avatar === 'string' && avatar.startsWith('data:');

    let nextAvatar = row.avatar_url;
    if (wantsRemove && nextAvatar) {
      try { await removeAvatarFile(nextAvatar); } catch (err) { if (err?.code !== 'ENOENT') console.warn('[profissionais][avatar remove]', err?.message || err); }
      nextAvatar = null;
    }
    if (hasAvatarData) {
      try {
        nextAvatar = await saveAvatarFromDataUrl(avatar, estId, wantsRemove ? null : row.avatar_url);
      } catch (err) {
        if (err?.code === 'AVATAR_TOO_LARGE') {
          return res.status(400).json({ error: 'avatar_grande', message: 'A imagem deve ter no maximo 2MB.' });
        }
        if (err?.code === 'AVATAR_INVALID') {
          return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[profissionais][update] avatar', err);
        return res.status(500).json({ error: 'avatar_falhou', message: 'Nao foi possivel salvar a foto.' });
      }
    }

    const nextAtivo = ativo == null ? row.ativo : (toBoolean(ativo) ? 1 : 0);

    await pool.query(
      'UPDATE profissionais SET nome=?, descricao=?, avatar_url=?, ativo=? WHERE id=? AND estabelecimento_id=?',
      [nextNome, nextDescricao || null, nextAvatar, nextAtivo, id, estId]
    );

    const [[updated]] = await pool.query(
      'SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, created_at FROM profissionais WHERE id=?',
      [id]
    );
    res.json(updated);
  } catch (err) {
    console.error('[profissionais][update]', err);
    res.status(500).json({ error: 'update_profissional_failed' });
  }
});

router.delete('/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    const [[row]] = await pool.query(
      'SELECT id, avatar_url FROM profissionais WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });

    await pool.query('DELETE FROM servico_profissionais WHERE profissional_id=?', [id]);
    await pool.query('DELETE FROM profissionais WHERE id=? AND estabelecimento_id=?', [id, estId]);
    if (row.avatar_url) {
      await removeAvatarFile(row.avatar_url).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[profissionais][delete]', err);
    res.status(500).json({ error: 'delete_profissional_failed' });
  }
});

export default router;
