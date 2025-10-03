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

const PROFESSIONAL_FIELDS = 'id, nome, descricao, avatar_url';

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const entry of value) {
    const num = Number(entry);
    if (Number.isFinite(num) && num > 0) ids.push(num);
  }
  return Array.from(new Set(ids));
}

function toBoolean(value) {
  if (value === true || value === false) return !!value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(normalized);
}

async function validateProfessionalIds(establishmentId, ids) {
  const normalized = normalizeIds(ids);
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, ativo FROM profissionais WHERE estabelecimento_id=? AND id IN (${placeholders})`,
    [establishmentId, ...normalized]
  );
  const foundIds = rows.map((row) => row.id);
  const missing = normalized.filter((id) => !foundIds.includes(id));
  if (missing.length) {
    const err = new Error('Profissional nao encontrado para este estabelecimento.');
    err.status = 400;
    err.code = 'profissional_invalido';
    err.details = { missing };
    throw err;
  }
  const inactive = rows.filter((row) => !row.ativo).map((row) => row.id);
  if (inactive.length) {
    const err = new Error('Profissional inativo.');
    err.status = 400;
    err.code = 'profissional_inativo';
    err.details = { inactive };
    throw err;
  }
  return normalized;
}

async function attachProfessionals(services) {
  if (!services || !services.length) return services;
  const serviceIds = services.map((svc) => svc.id);
  const placeholders = serviceIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT sp.servico_id, p.id, p.nome, p.descricao, p.avatar_url
       FROM servico_profissionais sp
       JOIN profissionais p ON p.id = sp.profissional_id
      WHERE sp.servico_id IN (${placeholders})
      ORDER BY p.nome`,
    serviceIds
  );
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.servico_id)) grouped.set(row.servico_id, []);
    grouped.get(row.servico_id).push({
      id: row.id,
      nome: row.nome,
      descricao: row.descricao,
      avatar_url: row.avatar_url,
    });
  });
  services.forEach((svc) => {
    svc.professionals = grouped.get(svc.id) || [];
  });
  return services;
}

async function fetchService(establishmentId, serviceId) {
  const [[service]] = await pool.query(
    'SELECT * FROM servicos WHERE id=? AND estabelecimento_id=?',
    [serviceId, establishmentId]
  );
  if (!service) return null;
  await attachProfessionals([service]);
  return service;
}

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

  if (!estabId) return next();

  try {
    const [rows] = await pool.query(
      `SELECT id, nome AS title, nome, descricao, duracao_min, preco_centavos, ativo
         FROM servicos
        WHERE estabelecimento_id=?
          AND (ativo IS NULL OR ativo=1)
        ORDER BY nome`,
      [estabId]
    );
    await attachProfessionals(rows);
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
    await attachProfessionals(rows);
    res.json(rows);
  } catch (e) {
    console.error('GET /servicos (mine)', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /servicos
 */
router.post('/', auth, isEstabelecimento, async (req, res) => {
  let conn;
  try {
    const estId = req.user.id;
    const { nome, descricao, duracao_min, preco_centavos, ativo = 1, professionalIds } = req.body || {};
    const nomeTrim = String(nome || '').trim();
    const descricaoTrim = descricao != null ? String(descricao).trim() : null;
    const duracao = Number(duracao_min);
    const preco = Number(preco_centavos ?? 0);
    const isActive = toBoolean(ativo);
    if (!nomeTrim || !duracao) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Informe nome e duracao.' });
    }

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
        'SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?',
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

    let professionalIdsToLink = [];
    try {
      professionalIdsToLink = await validateProfessionalIds(estId, professionalIds);
    } catch (err) {
      if (err?.status) {
        return res.status(err.status).json({ error: err.code || 'profissional_invalido', message: err.message, ...(err.details ? { details: err.details } : {}) });
      }
      throw err;
    }

    if (!professionalIdsToLink.length) {
      return res.status(400).json({
        error: 'missing_professionals',
        message: 'Associe pelo menos um profissional ao serviço.',
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [insert] = await conn.query(
      'INSERT INTO servicos (estabelecimento_id, nome, descricao, duracao_min, preco_centavos, ativo) VALUES (?,?,?,?,?,?)',
      [estId, nomeTrim, descricaoTrim || null, Number.isFinite(duracao) ? Math.max(0, Math.round(duracao)) : 0, Number.isFinite(preco) ? Math.max(0, Math.round(preco)) : 0, isActive ? 1 : 0]
    );
    const serviceId = insert.insertId;

    for (const profissionalId of professionalIdsToLink) {
      await conn.query(
        'INSERT INTO servico_profissionais (servico_id, profissional_id) VALUES (?,?)',
        [serviceId, profissionalId]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    const service = await fetchService(estId, serviceId);
    res.json(service);
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      try { conn.release(); } catch {}
    }
    console.error('[servicos][create]', e);
    if (e?.status) {
      return res.status(e.status).json({ error: e.code || 'server_error', message: e.message, ...(e.details ? { details: e.details } : {}) });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /servicos/:id
 */
router.put('/:id', auth, isEstabelecimento, async (req, res) => {
  let conn;
  try {
    const estId = req.user.id;
    const serviceId = Number(req.params.id);
    if (!Number.isFinite(serviceId)) {
      return res.status(400).json({ error: 'invalid_id', message: 'Servico invalido.' });
    }

    const [[current]] = await pool.query(
      'SELECT * FROM servicos WHERE id=? AND estabelecimento_id=?',
      [serviceId, estId]
    );
    if (!current) return res.status(404).json({ error: 'not_found' });

    const updates = {
      nome: req.body?.nome != null ? String(req.body.nome).trim() : current.nome,
      descricao: Object.prototype.hasOwnProperty.call(req.body || {}, 'descricao')
        ? (req.body.descricao != null ? String(req.body.descricao).trim() : null)
        : current.descricao,
      duracao_min: req.body?.duracao_min != null ? Number(req.body.duracao_min) : current.duracao_min,
      preco_centavos: req.body?.preco_centavos != null ? Number(req.body.preco_centavos) : current.preco_centavos,
      ativo: req.body?.ativo != null ? (toBoolean(req.body.ativo) ? 1 : 0) : current.ativo,
    };

    updates.nome = String(updates.nome || '').trim();
    if (updates.descricao != null) {
      updates.descricao = String(updates.descricao).trim();
      if (!updates.descricao) updates.descricao = null;
    }
    updates.duracao_min = Number.isFinite(updates.duracao_min) ? Math.max(0, Math.round(updates.duracao_min)) : 0;
    updates.preco_centavos = Number.isFinite(updates.preco_centavos) ? Math.max(0, Math.round(updates.preco_centavos)) : 0;

    if (!updates.nome || !updates.duracao_min) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Informe nome e duracao.' });
    }

    let professionalIdsToLink = null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'professionalIds')) {
      try {
        professionalIdsToLink = await validateProfessionalIds(estId, req.body.professionalIds);
      } catch (err) {
        if (err?.status) {
          return res.status(err.status).json({ error: err.code || 'profissional_invalido', message: err.message, ...(err.details ? { details: err.details } : {}) });
        }
        throw err;
      }
    }

    if (professionalIdsToLink !== null && !professionalIdsToLink.length) {
      return res.status(400).json({
        error: 'missing_professionals',
        message: 'Associe pelo menos um profissional ao serviço.',
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      'UPDATE servicos SET nome=?, descricao=?, duracao_min=?, preco_centavos=?, ativo=? WHERE id=? AND estabelecimento_id=?',
      [updates.nome, updates.descricao, updates.duracao_min, updates.preco_centavos, updates.ativo ? 1 : 0, serviceId, estId]
    );

    if (professionalIdsToLink !== null) {
      await conn.query('DELETE FROM servico_profissionais WHERE servico_id=?', [serviceId]);
      for (const profissionalId of professionalIdsToLink) {
        await conn.query(
          'INSERT INTO servico_profissionais (servico_id, profissional_id) VALUES (?,?)',
          [serviceId, profissionalId]
        );
      }
    }

    await conn.commit();
    conn.release();
    conn = null;

    const service = await fetchService(estId, serviceId);
    res.json(service);
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      try { conn.release(); } catch {}
    }
    console.error('[servicos][update]', e);
    if (e?.status) {
      return res.status(e.status).json({ error: e.code || 'server_error', message: e.message, ...(e.details ? { details: e.details } : {}) });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * DELETE /servicos/:id
 */
router.delete('/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const serviceId = Number(req.params.id);
    if (!Number.isFinite(serviceId)) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const [[lockedAppointment]] = await pool.query(
      "SELECT id FROM agendamentos WHERE servico_id=? AND estabelecimento_id=? AND status IN ('confirmado','pendente') LIMIT 1",
      [serviceId, estId]
    );
    if (lockedAppointment) {
      return res.status(409).json({
        error: 'service_has_appointments',
        message: 'Não é possível excluir um serviço com agendamentos confirmados.',
      });
    }

    const [result] = await pool.query(
      'DELETE FROM servicos WHERE id=? AND estabelecimento_id=?',
      [serviceId, estId]
    );

    if (result.affectedRows) {
      await pool.query('DELETE FROM servico_profissionais WHERE servico_id=?', [serviceId]);
    }

    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) {
    console.error('[servicos][delete]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
