import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import {
  resolvePlanConfig,
} from '../lib/plans.js';
import { saveServiceImageFromDataUrl, removeServiceImageFile } from '../lib/service_images.js';
import { ensureSubscriptionOperationalAccess } from '../middleware/billing.js';
import { normalizeServiceSlotCapacity } from '../lib/service_capacity.js';
import { setAudit, diffFields } from '../lib/audit.js';

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
    const err = new Error('Profissional não encontrado para este estabelecimento.');
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

// Janela e tamanho do destaque "mais agendados" na vitrine pública.
const POPULAR_WINDOW_DAYS = 90;
const POPULAR_LIMIT = 3;

/**
 * Conta agendamentos por serviço nos últimos POPULAR_WINDOW_DAYS.
 * O UNION ALL existe porque agendamentos antigos (pré agendamento_itens) só têm
 * agendamentos.servico_id; a metade legada é restrita a agendamentos sem itens
 * para o mesmo agendamento não ser contado duas vezes.
 */
async function fetchBookingCounts(establishmentId) {
  const [rows] = await pool.query(
    `SELECT servico_id, COUNT(*) AS total
       FROM (
         SELECT ai.servico_id AS servico_id
           FROM agendamento_itens ai
           JOIN agendamentos a ON a.id = ai.agendamento_id
          WHERE a.estabelecimento_id=?
            AND a.status IN ('confirmado','concluido')
            AND COALESCE(a.no_show,0)=0
            AND a.inicio >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
         UNION ALL
         SELECT a.servico_id AS servico_id
           FROM agendamentos a
           LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
          WHERE ai.id IS NULL
            AND a.estabelecimento_id=?
            AND a.status IN ('confirmado','concluido')
            AND COALESCE(a.no_show,0)=0
            AND a.inicio >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
       ) t
      WHERE servico_id IS NOT NULL
      GROUP BY servico_id`,
    [establishmentId, POPULAR_WINDOW_DAYS, establishmentId, POPULAR_WINDOW_DAYS]
  );
  const counts = new Map();
  rows.forEach((row) => counts.set(Number(row.servico_id), Number(row.total) || 0));
  return counts;
}

/**
 * Ordena a vitrine: os POPULAR_LIMIT mais agendados primeiro (marcados com `popular`),
 * o restante em ordem alfabética. Sem histórico, a lista continua alfabética.
 */
function sortByPopularity(services, counts) {
  services.forEach((svc) => {
    svc.booking_count = counts.get(Number(svc.id)) || 0;
    svc.popular = false;
  });
  const byName = (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  const top = services
    .filter((svc) => svc.booking_count > 0)
    .sort((a, b) => b.booking_count - a.booking_count || byName(a, b))
    .slice(0, POPULAR_LIMIT);
  top.forEach((svc) => { svc.popular = true; });
  const topIds = new Set(top.map((svc) => svc.id));
  const rest = services.filter((svc) => !topIds.has(svc.id)).sort(byName);
  return [...top, ...rest];
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
      `SELECT id, nome AS title, nome, descricao, imagem_url, duracao_min, preco_centavos, capacidade_por_horario, ativo
         FROM servicos
        WHERE estabelecimento_id=?
          AND (ativo IS NULL OR ativo=1)
        ORDER BY nome`,
      [estabId]
    );
    await attachProfessionals(rows);
    // Popularidade é enfeite da vitrine: se a contagem falhar, a lista alfabética ainda vai.
    const counts = await fetchBookingCounts(estabId).catch((e) => {
      console.error('GET /servicos (public) booking counts', e);
      return new Map();
    });
    return res.json(sortByPopularity(rows || [], counts));
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
router.post('/', auth, isEstabelecimento, ensureSubscriptionOperationalAccess({
  message: 'Regularize a assinatura para cadastrar novos serviços.',
}), async (req, res) => {
  let conn;
  try {
    const estId = req.user.id;
    const { nome, descricao, duracao_min, preco_centavos, capacidade_por_horario, ativo = 1, professionalIds, imagem } = req.body || {};
    const nomeTrim = String(nome || '').trim();
    const descricaoTrim = descricao != null ? String(descricao).trim() : null;
    const duracao = Number(duracao_min);
    const preco = Number(preco_centavos ?? 0);
    const capacidade = normalizeServiceSlotCapacity(capacidade_por_horario ?? 1);
    const isActive = toBoolean(ativo);
    if (!nomeTrim || !duracao) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Preencha nome, duração e selecione pelo menos um profissional para cadastrar o serviço.',
      });
    }

    const planContext = req.subscriptionContext?.planContext || null;
    const planConfig = planContext?.config || resolvePlanConfig('starter');

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
        message: 'Selecione pelo menos um profissional para vincular a este serviço.',
      });
    }

    let imagemUrl = null;
    if (imagem) {
      const rawImage = String(imagem || '').trim();
      if (rawImage && !rawImage.startsWith('data:')) {
        return res.status(400).json({ error: 'imagem_invalida', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
      }
      if (rawImage) {
        try {
          imagemUrl = await saveServiceImageFromDataUrl(rawImage, estId, null);
        } catch (err) {
          if (err?.code === 'SERVICE_IMAGE_TOO_LARGE') {
            return res.status(400).json({ error: 'imagem_grande', message: 'Imagem maior que 2MB.' });
          }
          if (err?.code === 'SERVICE_IMAGE_INVALID') {
            return res.status(400).json({ error: 'imagem_invalida', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
          }
          console.error('[servicos][create] imagem', err);
          return res.status(500).json({ error: 'imagem_falhou', message: 'Não foi possível salvar a imagem.' });
        }
      }
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [insert] = await conn.query(
      'INSERT INTO servicos (estabelecimento_id, nome, descricao, imagem_url, duracao_min, preco_centavos, capacidade_por_horario, ativo) VALUES (?,?,?,?,?,?,?,?)',
      [estId, nomeTrim, descricaoTrim || null, imagemUrl, Number.isFinite(duracao) ? Math.max(0, Math.round(duracao)) : 0, Number.isFinite(preco) ? Math.max(0, Math.round(preco)) : 0, capacidade, isActive ? 1 : 0]
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
    setAudit(req, {
      acao: 'servico.criar',
      entidade: 'servico',
      entidade_id: serviceId,
      estabelecimento_id: estId,
      dados_depois: { nome: service?.nome, preco_centavos: service?.preco_centavos, duracao_min: service?.duracao_min, ativo: service?.ativo },
    });
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
router.put('/:id', auth, isEstabelecimento, ensureSubscriptionOperationalAccess({
  message: 'Regularize a assinatura para editar serviços.',
}), async (req, res) => {
  let conn;
  try {
    const estId = req.user.id;
    const serviceId = Number(req.params.id);
    if (!Number.isFinite(serviceId)) {
      return res.status(400).json({ error: 'invalid_id', message: 'Serviço inválido.' });
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
      capacidade_por_horario: Object.prototype.hasOwnProperty.call(req.body || {}, 'capacidade_por_horario')
        ? normalizeServiceSlotCapacity(req.body.capacidade_por_horario)
        : normalizeServiceSlotCapacity(current.capacidade_por_horario),
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
      return res.status(400).json({ error: 'invalid_payload', message: 'Informe nome e duração.' });
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

    const rawImage = typeof req.body?.imagem === 'string' ? req.body.imagem.trim() : '';
    const wantsRemoveImage = req.body?.imagemRemove === true || req.body?.imagemRemove === 'true';
    const hasImageData = !!rawImage && rawImage.startsWith('data:');

    let nextImageUrl = current.imagem_url || null;
    if (wantsRemoveImage && nextImageUrl) {
      try { await removeServiceImageFile(nextImageUrl); } catch (err) { if (err?.code !== 'ENOENT') console.warn('[servicos][imagem remove]', err?.message || err); }
      nextImageUrl = null;
    }
    if (rawImage && !hasImageData) {
      return res.status(400).json({ error: 'imagem_invalida', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
    }
    if (hasImageData) {
      try {
        nextImageUrl = await saveServiceImageFromDataUrl(rawImage, estId, wantsRemoveImage ? null : current.imagem_url);
      } catch (err) {
        if (err?.code === 'SERVICE_IMAGE_TOO_LARGE') {
          return res.status(400).json({ error: 'imagem_grande', message: 'Imagem maior que 2MB.' });
        }
        if (err?.code === 'SERVICE_IMAGE_INVALID') {
          return res.status(400).json({ error: 'imagem_invalida', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[servicos][update] imagem', err);
        return res.status(500).json({ error: 'imagem_falhou', message: 'Não foi possível salvar a imagem.' });
      }
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      'UPDATE servicos SET nome=?, descricao=?, imagem_url=?, duracao_min=?, preco_centavos=?, capacidade_por_horario=?, ativo=? WHERE id=? AND estabelecimento_id=?',
      [updates.nome, updates.descricao, nextImageUrl, updates.duracao_min, updates.preco_centavos, updates.capacidade_por_horario, updates.ativo ? 1 : 0, serviceId, estId]
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
    const diff = diffFields(current, updates, ['nome', 'descricao', 'duracao_min', 'preco_centavos', 'capacidade_por_horario', 'ativo']);
    setAudit(req, {
      acao: 'servico.atualizar',
      entidade: 'servico',
      entidade_id: serviceId,
      estabelecimento_id: estId,
      dados_antes: diff?.antes || null,
      dados_depois: diff?.depois || null,
    });
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
router.delete('/:id', auth, isEstabelecimento, ensureSubscriptionOperationalAccess({
  message: 'Regularize a assinatura para excluir serviços.',
}), async (req, res) => {
  try {
    const estId = req.user.id;
    const serviceId = Number(req.params.id);
    if (!Number.isFinite(serviceId)) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const [[lockedAppointment]] = await pool.query(
      `SELECT a.id
         FROM agendamentos a
         JOIN agendamento_itens ai ON ai.agendamento_id = a.id
        WHERE ai.servico_id=?
          AND a.estabelecimento_id=?
          AND a.status IN ('confirmado','pendente')
        LIMIT 1`,
      [serviceId, estId]
    );
    if (lockedAppointment) {
      return res.status(409).json({
        error: 'service_has_appointments',
        message: 'Não é possível excluir um serviço com agendamentos confirmados.',
      });
    }

    // Snapshot completo antes do DELETE: depois da exclusão, esta é a única prova do que existia.
    const [[row]] = await pool.query(
      'SELECT id, nome, descricao, imagem_url, duracao_min, preco_centavos, capacidade_por_horario, ativo FROM servicos WHERE id=? AND estabelecimento_id=?',
      [serviceId, estId]
    );

    const [result] = await pool.query(
      'DELETE FROM servicos WHERE id=? AND estabelecimento_id=?',
      [serviceId, estId]
    );

    if (result.affectedRows) {
      await pool.query('DELETE FROM servico_profissionais WHERE servico_id=?', [serviceId]);
      if (row?.imagem_url) {
        await removeServiceImageFile(row.imagem_url).catch(() => {});
      }
    }

    setAudit(req, {
      acao: 'servico.excluir',
      entidade: 'servico',
      entidade_id: serviceId,
      estabelecimento_id: estId,
      resultado: result.affectedRows ? 'sucesso' : 'falha',
      motivo: result.affectedRows ? null : 'servico_inexistente',
      dados_antes: row || null,
    });
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (e) {
    console.error('[servicos][delete]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
