// backend/src/routes/estabelecimentos.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db.js";
import { resolveEstablishmentCoordinates } from "../lib/geocode.js";
import { auth, isEstabelecimento, isCliente } from "../middleware/auth.js";
import {
  PLAN_TIERS,
  PLAN_STATUS,
  getPlanContext,
  resolvePlanConfig,
  countProfessionals,
  formatPlanLimitExceeded,
  isDelinquentStatus,
  serializePlanContext,
  isDowngrade,
} from "../lib/plans.js";

const router = Router();

const LIST_QUERY = "SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url FROM usuarios WHERE tipo = 'estabelecimento' ORDER BY nome";

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const EMPTY_RATING_DISTRIBUTION = Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

function cloneRatingDistribution() {
  return { ...EMPTY_RATING_DISTRIBUTION };
}

async function resolveViewerFromRequest(req) {
  const header = (req && req.headers && req.headers.authorization) || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const userId = Number(payload?.id);
    if (!Number.isFinite(userId)) return null;
    const [rows] = await pool.query(
      "SELECT id, nome, tipo, email FROM usuarios WHERE id=? LIMIT 1",
      [userId]
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      nome: row.nome,
      tipo: row.tipo || 'cliente',
      email: row.email || null,
    };
  } catch (err) {
    return null;
  }
}

function parseHorarios(value) {
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (!item) return null;
          if (typeof item === 'string') {
            const text = item.trim();
            if (!text) return null;
            return { label: '', value: text };
          }
          if (typeof item === 'object') {
            const label = String(item.label ?? item.day ?? item.dia ?? '').trim();
            const valueText = String(item.value ?? item.horario ?? item.horarios ?? item.hours ?? '').trim();
            if (!label && !valueText) return null;
            return { label, value: valueText || label };
          }
          return null;
        })
        .filter(Boolean);
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([key, val]) => {
          const label = String(key || '').trim();
          const valueText = String(val ?? '').trim();
          if (!label && !valueText) return null;
          return { label, value: valueText || label };
        })
        .filter(Boolean);
    }
  } catch (err) {
    // fallback
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/[:\-]/);
    if (parts.length >= 2) {
      const [label, ...rest] = parts;
      const valueText = rest.join(' - ').trim();
      return {
        label: label.trim(),
        value: valueText || line,
      };
    }
    return { label: '', value: line };
  });
}

function normalizeProfile(establishmentRow, profileRow) {
  const fallbackEmail = establishmentRow?.email || null;
  const fallbackPhone = establishmentRow?.telefone || null;
  if (!profileRow) {
    return {
      sobre: null,
      contato_email: fallbackEmail,
      contato_telefone: fallbackPhone,
      site_url: null,
      instagram_url: null,
      facebook_url: null,
      linkedin_url: null,
      youtube_url: null,
      tiktok_url: null,
      horarios: [],
      horarios_raw: null,
      updated_at: null,
    };
  }
  const updatedAt = profileRow.updated_at ? new Date(profileRow.updated_at) : null;
  return {
    sobre: profileRow.sobre || null,
    contato_email: profileRow.contato_email || fallbackEmail,
    contato_telefone: profileRow.contato_telefone || fallbackPhone,
    site_url: profileRow.site_url || null,
    instagram_url: profileRow.instagram_url || null,
    facebook_url: profileRow.facebook_url || null,
    linkedin_url: profileRow.linkedin_url || null,
    youtube_url: profileRow.youtube_url || null,
    tiktok_url: profileRow.tiktok_url || null,
    horarios: parseHorarios(profileRow.horarios_json),
    horarios_raw: profileRow.horarios_json || null,
    updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  };
}

async function getRatingSummary(estabelecimentoId) {
  const [[summary]] = await pool.query(
    "SELECT AVG(nota) AS media, COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id=?",
    [estabelecimentoId]
  );
  const [distRows] = await pool.query(
    "SELECT nota, COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id=? GROUP BY nota",
    [estabelecimentoId]
  );
  const distribution = cloneRatingDistribution();
  for (const row of distRows || []) {
    const score = Number(row?.nota);
    const total = Number(row?.total || 0);
    if (Number.isFinite(score) && score >= 1 && score <= 5) {
      distribution[score] = total;
    }
  }
  const total = Number(summary?.total || 0);
  const avgRaw = summary?.media;
  let average = null;
  if (total > 0 && avgRaw != null) {
    const numeric = Number(avgRaw);
    if (Number.isFinite(numeric)) {
      average = Math.round(numeric * 10) / 10;
    }
  }
  return { average, count: total, distribution };
}

async function fetchUserReview(estabelecimentoId, clienteId) {
  const [rows] = await pool.query(
    "SELECT nota, comentario, updated_at FROM estabelecimento_reviews WHERE estabelecimento_id=? AND cliente_id=? LIMIT 1",
    [estabelecimentoId, clienteId]
  );
  const row = rows?.[0];
  if (!row) return null;
  const nota = Number(row.nota);
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  return {
    nota: Number.isFinite(nota) ? nota : null,
    comentario: row.comentario || null,
    updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  };
}

async function isFavoriteFor(estabelecimentoId, clienteId) {
  const [rows] = await pool.query(
    "SELECT 1 FROM cliente_favoritos WHERE estabelecimento_id=? AND cliente_id=? LIMIT 1",
    [estabelecimentoId, clienteId]
  );
  return Boolean(rows && rows.length);
}

async function ensureEstabelecimento(estabelecimentoId) {
  const id = Number(estabelecimentoId);
  if (!Number.isFinite(id)) return null;
  const [rows] = await pool.query(
    "SELECT id, nome, email, telefone FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
    [id]
  );
  return rows?.[0] || null;
}

async function attachCoordinates(rows, includeCoords) {
  if (!includeCoords) return rows;
  const enriched = [];
  for (const est of rows) {
    const lat = toFiniteOrNull(est?.latitude ?? est?.lat ?? est?.coord_lat);
    const lng = toFiniteOrNull(est?.longitude ?? est?.lng ?? est?.coord_lng);
    if (lat !== null && lng !== null) {
      enriched.push({ ...est, latitude: lat, longitude: lng });
      continue;
    }
    let coords = null;
    try {
      coords = await resolveEstablishmentCoordinates(est);
    } catch (err) {
      console.warn('[establishments] geocode failed id=%s: %s', est?.id, err?.message || err);
    }
    enriched.push({
      ...est,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    });
  }
  return enriched;
}

async function listEstablishmentsHandler(req, res) {
  try {
    const [rows] = await pool.query(LIST_QUERY);
    const includeCoords = String((req.query?.coords ?? '1')).toLowerCase() !== '0';
    const payload = await attachCoordinates(rows, includeCoords);
    res.json(payload);
  } catch (e) {
    console.error('GET ' + req.path, e);
    res.status(500).json({ error: 'list_establishments_failed' });
  }
}

// Lista todos os usuarios com perfil de estabelecimento
router.get('/', listEstablishmentsHandler);
// Alias em pt-BR (opcional): /estabelecimentos
router.get('/pt', listEstablishmentsHandler);
// Detalhe por ID ou slug
router.get('/:idOrSlug', async (req, res) => {
  try {
    const idOrSlug = String(req.params.idOrSlug || '').trim();
    let rows;
    const id = Number(idOrSlug);
    if (Number.isFinite(id)) {
      [rows] = await pool.query(
        "SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
        [id]
      );
    } else {
      [rows] = await pool.query(
        "SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE slug=? AND tipo='estabelecimento' LIMIT 1",
        [idOrSlug]
      );
    }
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const est = rows[0];

    const viewer = await resolveViewerFromRequest(req);

    const [planContext, profileResult, rating] = await Promise.all([
      getPlanContext(est.id),
      pool.query(
        "SELECT estabelecimento_id, sobre, contato_email, contato_telefone, site_url, instagram_url, facebook_url, linkedin_url, youtube_url, tiktok_url, horarios_json, updated_at FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1",
        [est.id]
      ),
      getRatingSummary(est.id),
    ]);

    const [profileRows] = profileResult;
    const profileRow = profileRows?.[0] || null;

    let userReview = null;
    let isFavorite = false;

    if (viewer?.tipo === 'cliente') {
      const [review, favorite] = await Promise.all([
        fetchUserReview(est.id, viewer.id),
        isFavoriteFor(est.id, viewer.id),
      ]);
      userReview = review;
      isFavorite = favorite;
    }

    const payload = {
      ...est,
      plan_context: serializePlanContext(planContext),
      profile: normalizeProfile(est, profileRow),
      rating,
      user_review: userReview,
      is_favorite: isFavorite,
    };

    return res.json(payload);
  } catch (e) {
    console.error('GET /establishments/:id', e);
    res.status(500).json({ error: 'establishment_fetch_failed' });
  }
});

// Templates por estabelecimento (protegido)
router.get('/:id/messages', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const [rows] = await pool.query('SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?', [id]);
    res.json(rows[0] || { email_subject: null, email_html: null, wa_template: null });
  } catch (e) {
    console.error('GET /establishments/:id/messages', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/:id/messages', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const subject = req.body?.email_subject ?? null;
    const html = req.body?.email_html ?? null;
    const wa = req.body?.wa_template ?? null;
    await pool.query(
      'INSERT INTO estab_messages (estabelecimento_id, email_subject, email_html, wa_template) VALUES (?,?,?,?)\n       ON DUPLICATE KEY UPDATE email_subject=?, email_html=?, wa_template=?',
      [id, subject, html, wa, subject, html, wa]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /establishments/:id/messages', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Atualizar slug do estabelecimento
router.put('/:id/slug', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const slugRaw = String(req.body?.slug || '').trim().toLowerCase();
    if (!/^([a-z0-9]+(?:-[a-z0-9]+)*)$/.test(slugRaw) || slugRaw.length < 3 || slugRaw.length > 160) {
      return res.status(400).json({ error: 'invalid_slug', message: 'Use apenas letras, numeros e hifens. Min 3, max 160.' });
    }
    // checa unicidade
    const [rows] = await pool.query("SELECT id FROM usuarios WHERE slug=? LIMIT 1", [slugRaw]);
    if (rows.length && rows[0].id !== id) return res.status(409).json({ error: 'slug_taken' });
    await pool.query('UPDATE usuarios SET slug=? WHERE id=? AND tipo=\'estabelecimento\'', [slugRaw, id]);
    return res.json({ ok: true, slug: slugRaw });
  } catch (e) {
    console.error('PUT /establishments/:id/slug', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.put('/:id/plan', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const rawPlan = String(req.body?.plan || '').toLowerCase();
    if (!PLAN_TIERS.includes(rawPlan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plano invalido.' });
    }

    const context = await getPlanContext(id);
    if (!context) {
      return res.status(404).json({ error: 'not_found' });
    }

    const currentPlan = context.plan;
    const currentStatus = context.status;
    const targetConfig = resolvePlanConfig(rawPlan);

    if (isDowngrade(currentPlan, rawPlan)) {
      const [[svcRow]] = await pool.query(
        'SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?',
        [id]
      );
      const totalServices = Number(svcRow?.total || 0);
      if (targetConfig.maxServices !== null && totalServices > targetConfig.maxServices) {
        return res.status(409).json({
          error: 'plan_downgrade_blocked',
          message: formatPlanLimitExceeded(targetConfig, 'services'),
          details: { services: totalServices, limit: targetConfig.maxServices },
        });
      }

      if (targetConfig.maxProfessionals !== null) {
        const totalProfessionals = await countProfessionals(id);
        if (totalProfessionals > targetConfig.maxProfessionals) {
          return res.status(409).json({
            error: 'plan_downgrade_blocked',
            message: formatPlanLimitExceeded(targetConfig, 'professionals'),
            details: { professionals: totalProfessionals, limit: targetConfig.maxProfessionals },
          });
        }
      }
    }

    let planStatus = currentStatus;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      const nextStatus = String(req.body.status || '').toLowerCase();
      if (!PLAN_STATUS.includes(nextStatus)) {
        return res.status(400).json({ error: 'invalid_status', message: 'Status de plano invalido.' });
      }
      planStatus = nextStatus;
    }

    let planTrialEndsAt = context.trialEndsAt;
    if (req.body?.trialEndsAt) {
      const parsed = new Date(req.body.trialEndsAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialEndsAt invalido.' });
      }
      planTrialEndsAt = parsed;
    } else if (req.body?.trialDays) {
      let days = Number(req.body.trialDays);
      if (!Number.isFinite(days) || days <= 0) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialDays deve ser um número positivo.' });
      }
      // Política: teste grátis de 7 dias
      if (days > 7) days = 7;
      const dt = new Date();
      dt.setDate(dt.getDate() + days);
      planTrialEndsAt = dt;
    } else if (rawPlan === 'starter') {
      planTrialEndsAt = null;
    }

    if (planStatus !== 'trialing') {
      planTrialEndsAt = null;
    }

    let planActiveUntil = context.activeUntil;
    if (req.body?.activeUntil) {
      const parsed = new Date(req.body.activeUntil);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_active_until', message: 'activeUntil invalido.' });
      }
      planActiveUntil = parsed;
    }

    let subscriptionId = context.subscriptionId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'subscriptionId')) {
      const nextSubId = String(req.body.subscriptionId || '').trim();
      subscriptionId = nextSubId ? nextSubId : null;
    }

    await pool.query(
      "UPDATE usuarios SET plan=?, plan_status=?, plan_trial_ends_at=?, plan_active_until=?, plan_subscription_id=? WHERE id=? AND tipo='estabelecimento'",
      [rawPlan, planStatus, planTrialEndsAt, planActiveUntil, subscriptionId, id]
    );

    const updatedContext = await getPlanContext(id);
    if (!updatedContext) {
      return res.status(404).json({ error: 'not_found' });
    }

    req.user = {
      ...req.user,
      plan: updatedContext.plan,
      plan_status: updatedContext.status,
      plan_trial_ends_at: updatedContext.trialEndsAt ? updatedContext.trialEndsAt.toISOString() : null,
      plan_active_until: updatedContext.activeUntil ? updatedContext.activeUntil.toISOString() : null,
      plan_subscription_id: updatedContext.subscriptionId,
    };

    return res.json({
      ok: true,
      plan: serializePlanContext(updatedContext),
    });
  } catch (e) {
    console.error('PUT /establishments/:id/plan', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.put('/:id/review', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId)) {
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });
    }
    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    let nota = Number(req.body?.nota);
    if (!Number.isFinite(nota)) {
      return res.status(400).json({ error: 'nota_invalida', message: 'Informe uma nota entre 1 e 5.' });
    }
    nota = Math.round(nota);
    if (nota < 1) nota = 1;
    if (nota > 5) nota = 5;

    let comentario = req.body?.comentario;
    if (comentario != null) {
      comentario = String(comentario).trim();
      if (!comentario) comentario = null;
      else if (comentario.length > 600) comentario = comentario.slice(0, 600);
    } else {
      comentario = null;
    }

    await pool.query(
      "INSERT INTO estabelecimento_reviews (estabelecimento_id, cliente_id, nota, comentario) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE nota=VALUES(nota), comentario=VALUES(comentario), updated_at=CURRENT_TIMESTAMP",
      [estabelecimentoId, req.user.id, nota, comentario]
    );

    const [rating, userReview] = await Promise.all([
      getRatingSummary(estabelecimentoId),
      fetchUserReview(estabelecimentoId, req.user.id),
    ]);

    return res.json({ ok: true, rating, user_review: userReview });
  } catch (err) {
    console.error('PUT /establishments/:id/review', err);
    return res.status(500).json({ error: 'review_save_failed' });
  }
});

router.delete('/:id/review', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId)) {
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });
    }
    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    await pool.query(
      "DELETE FROM estabelecimento_reviews WHERE estabelecimento_id=? AND cliente_id=?",
      [estabelecimentoId, req.user.id]
    );

    const rating = await getRatingSummary(estabelecimentoId);
    return res.json({ ok: true, rating, user_review: null });
  } catch (err) {
    console.error('DELETE /establishments/:id/review', err);
    return res.status(500).json({ error: 'review_delete_failed' });
  }
});

router.post('/:id/favorite', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId)) {
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });
    }
    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    await pool.query(
      "INSERT IGNORE INTO cliente_favoritos (cliente_id, estabelecimento_id) VALUES (?, ?)",
      [req.user.id, estabelecimentoId]
    );

    return res.json({ ok: true, is_favorite: true });
  } catch (err) {
    console.error('POST /establishments/:id/favorite', err);
    return res.status(500).json({ error: 'favorite_failed' });
  }
});

router.delete('/:id/favorite', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId)) {
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });
    }
    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    await pool.query(
      "DELETE FROM cliente_favoritos WHERE cliente_id=? AND estabelecimento_id=?",
      [req.user.id, estabelecimentoId]
    );

    return res.json({ ok: true, is_favorite: false });
  } catch (err) {
    console.error('DELETE /establishments/:id/favorite', err);
    return res.status(500).json({ error: 'favorite_failed' });
  }
});

// Estatísticas rápidas do estabelecimento (serviços e profissionais)
router.get('/:id/stats', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' })

    // Conta serviços
    const [[svcRow]] = await pool.query(
      'SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?',
      [id]
    )
    const services = Number(svcRow?.total || 0)

    // Conta profissionais (se houver a tabela)
    const professionals = await countProfessionals(id)

    return res.json({ services, professionals })
  } catch (e) {
    console.error('GET /establishments/:id/stats', e)
    return res.status(500).json({ error: 'server_error' })
  }
})

export default router;












