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



const LIST_QUERY = `
SELECT
  u.id,
  u.nome,
  u.email,
  u.telefone,
  u.cep,
  u.endereco,
  u.numero,
  u.complemento,
  u.bairro,
  u.cidade,
  u.estado,
  u.avatar_url,
  r.avg_rating AS rating_average,
  r.total_reviews AS rating_count
FROM usuarios u
LEFT JOIN (
  SELECT estabelecimento_id, AVG(nota) AS avg_rating, COUNT(*) AS total_reviews
  FROM estabelecimento_reviews
  GROUP BY estabelecimento_id
) r ON r.estabelecimento_id = u.id
WHERE u.tipo = 'estabelecimento'
ORDER BY u.nome
`;


const toFiniteOrNull = (value) => {

  const num = Number(value);

  return Number.isFinite(num) ? num : null;

};



const EMPTY_RATING_DISTRIBUTION = Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

function cloneRatingDistribution() {
  return { ...EMPTY_RATING_DISTRIBUTION };
}

function toISODate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function reviewerDisplayName(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Cliente';
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;
}

function reviewerInitials(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'CL';
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function sanitizePlainText(value, { maxLength = 800, allowNewLines = true } = {}) {
  if (value == null) return null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(/<[^>]*>/g, ''); // remove tags simples
  text = text.replace(/\r\n/g, '\n');
  if (!allowNewLines) {
    text = text.replace(/\s+/g, ' ');
  } else {
    text = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }
  if (maxLength && text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  return text;
}

function sanitizeEmail(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(text)) return null;
  return text.slice(0, 160);
}

function sanitizePhone(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function sanitizeUrl(value) {
  if (value == null) return null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(/\s+/g, '');
  if (text.startsWith('@')) text = text.slice(1);
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().slice(0, 255);
  } catch {
    return null;
  }
}

const WEEKDAY_TOKEN_MAP = Object.freeze({
  monday: ['segunda', 'segunda-feira', 'seg', 'mon', 'monday'],
  tuesday: ['terca', 'terca-feira', 'ter', 'tue', 'tuesday'],
  wednesday: ['quarta', 'quarta-feira', 'qua', 'wed', 'wednesday'],
  thursday: ['quinta', 'quinta-feira', 'qui', 'thu', 'thursday'],
  friday: ['sexta', 'sexta-feira', 'sex', 'fri', 'friday'],
  saturday: ['sabado', 'sabado-feira', 'sab', 'sat', 'saturday'],
  sunday: ['domingo', 'domingo-feira', 'dom', 'sun', 'sunday'],
});

const WEEKDAY_LABEL_MAP = Object.freeze({
  monday: 'Segunda',
  tuesday: 'Terca',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sabado',
  sunday: 'Domingo',
});

const WEEKDAY_SLUGS = Object.keys(WEEKDAY_TOKEN_MAP);

function normalizeString(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeDaySlug(value) {
  const token = normalizeString(value);
  if (!token) return '';
  for (const slug of WEEKDAY_SLUGS) {
    const tokens = WEEKDAY_TOKEN_MAP[slug];
    if (tokens && tokens.some((item) => normalizeString(item) === token)) {
      return slug;
    }
  }
  return '';
}

function sanitizeTimeValue(value) {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;
  const directMatch = text.match(/^([01]?\d|2[0-3]):?([0-5]\d)?$/);
  if (directMatch) {
    const hours = directMatch[1];
    const minutes = directMatch[2] ?? '00';
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 2) {
    const hoursNum = Number(digits);
    if (!Number.isInteger(hoursNum) || hoursNum < 0 || hoursNum > 23) return null;
    return `${String(hoursNum).padStart(2, '0')}:00`;
  }
  const hoursDigits = digits.slice(0, -2);
  const minutesDigits = digits.slice(-2);
  const hoursNum = Number(hoursDigits);
  const minutesNum = Number(minutesDigits);
  if (
    !Number.isInteger(hoursNum) ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    !Number.isInteger(minutesNum) ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return null;
  }
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
}

function sanitizeHorariosInput(input) {
  if (input == null) return null;
  let entries = [];
  if (Array.isArray(input)) {
    entries = input;
  } else if (typeof input === 'string') {
    entries = input.split(/\r?\n/).map((line) => line && line.trim()).filter(Boolean);
  } else if (typeof input === 'object') {
    entries = Object.values(input || {});
  }

  const normalized = [];
  for (const item of entries) {
    if (!item) continue;
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text) continue;
      normalized.push({ label: '', value: text });
      continue;
    }
    if (typeof item === 'object') {
      const label = String(item.label ?? item.day ?? item.dia ?? '').trim();
      let valueText = String(
        item.value ?? item.horario ?? item.horarios ?? item.hours ?? item.text ?? ''
      ).trim();
      if (!valueText && label) valueText = label;
      if (!valueText) continue;

      const normalizedEntry = { label, value: valueText };

      // Preserve optional keys so downstream sanitization can infer the weekday.
      const possibleKeys = ['day', 'key', 'weekday', 'week_day', 'dia'];
      for (const key of possibleKeys) {
        if (item[key] != null && normalizedEntry[key] == null) {
          normalizedEntry[key] = item[key];
        }
      }

      // Keep raw start/end hints when provided.
      const startLike = item.start ?? item.begin ?? item.from ?? null;
      const endLike = item.end ?? item.finish ?? item.to ?? null;
      if (startLike != null) normalizedEntry.start = startLike;
      if (endLike != null) normalizedEntry.end = endLike;

      // Preserve block/break metadata.
      const blocks =
        Array.isArray(item.blocks) && item.blocks.length
          ? item.blocks
          : Array.isArray(item.breaks) && item.breaks.length
          ? item.breaks
          : null;
      if (blocks) {
        normalizedEntry.blocks = blocks;
      }
      if (Array.isArray(item.breaks) && item.breaks.length) {
        normalizedEntry.breaks = item.breaks;
      }
      const blockStart = item.block_start ?? item.blockStart ?? null;
      const blockEnd = item.block_end ?? item.blockEnd ?? null;
      if (blockStart != null) normalizedEntry.block_start = blockStart;
      if (blockEnd != null) normalizedEntry.block_end = blockEnd;

      normalized.push(normalizedEntry);
    }
  }

  if (!normalized.length) return null;

  const sanitized = [];
  const seen = new Set();
  for (const entry of normalized) {
    let label = entry.label ? String(entry.label).trim() : '';
    let value = entry.value ? String(entry.value).trim() : '';
    const daySlug =
      normalizeDaySlug(entry.day ?? entry.key ?? entry.weekday ?? entry.week_day ?? label) || '';
    const defaultLabel = daySlug ? (WEEKDAY_LABEL_MAP[daySlug] || '') : '';
    label = label ? label.slice(0, 60) : defaultLabel.slice(0, 60);
    if (!label && !value) continue;
    value = value ? value.slice(0, 160) : label;
    if (!value) continue;
    let start = sanitizeTimeValue(entry.start ?? entry.begin ?? entry.from ?? null);
    let end = sanitizeTimeValue(entry.end ?? entry.finish ?? entry.to ?? null);
    if (start && end && start > end) {
      const temp = start;
      start = end;
      end = temp;
    }
    const sanitizedEntry = { label, value };
    if (daySlug) sanitizedEntry.day = daySlug;
    if (start) sanitizedEntry.start = start;
    if (end) sanitizedEntry.end = end;

    const rawBlocks = Array.isArray(entry.blocks)
      ? entry.blocks
      : Array.isArray(entry.breaks)
      ? entry.breaks
      : entry.block_start || entry.blockStart || entry.block_end || entry.blockEnd
      ? [{
          start: entry.block_start ?? entry.blockStart ?? null,
          end: entry.block_end ?? entry.blockEnd ?? null,
        }]
      : [];

    const sanitizedBlocks = [];
    for (const block of rawBlocks) {
      if (!block) continue;
      const blockStart = sanitizeTimeValue(block.start ?? block.begin ?? block.from ?? null);
      const blockEnd = sanitizeTimeValue(block.end ?? block.finish ?? block.to ?? null);
      if (!blockStart || !blockEnd) continue;
      if (blockStart >= blockEnd) continue;
      if (start && blockStart < start) continue;
      if (end && blockEnd > end) continue;
      sanitizedBlocks.push({ start: blockStart, end: blockEnd });
      if (sanitizedBlocks.length >= 3) break;
    }
    if (sanitizedBlocks.length) {
      sanitizedEntry.blocks = sanitizedBlocks;
      sanitizedEntry.breaks = sanitizedBlocks;
    }

    const key = `${daySlug || label}::${value}::${start || ''}-${end || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push(sanitizedEntry);
    if (sanitized.length >= 20) break;
  }

  return sanitized.length ? JSON.stringify(sanitized) : null;
}

function buildProfileUpdatePayload(body = {}) {
  const errors = [];

  const sobre = sanitizePlainText(body.sobre, { maxLength: 1200, allowNewLines: true });
  const contato_email =
    body.contato_email != null ? sanitizeEmail(body.contato_email) : null;
  if (body.contato_email && !contato_email) {
    errors.push({ field: 'contato_email', code: 'invalid_email' });
  }

  const contato_telefone =
    body.contato_telefone != null ? sanitizePhone(body.contato_telefone) : null;
  if (body.contato_telefone && !contato_telefone) {
    errors.push({ field: 'contato_telefone', code: 'invalid_phone' });
  }

  const site_url = body.site_url != null ? sanitizeUrl(body.site_url) : null;
  if (body.site_url && !site_url) {
    errors.push({ field: 'site_url', code: 'invalid_url' });
  }

  const instagram_url = body.instagram_url != null ? sanitizeUrl(body.instagram_url) : null;
  if (body.instagram_url && !instagram_url) {
    errors.push({ field: 'instagram_url', code: 'invalid_url' });
  }

  const facebook_url = body.facebook_url != null ? sanitizeUrl(body.facebook_url) : null;
  if (body.facebook_url && !facebook_url) {
    errors.push({ field: 'facebook_url', code: 'invalid_url' });
  }

  const linkedin_url = body.linkedin_url != null ? sanitizeUrl(body.linkedin_url) : null;
  if (body.linkedin_url && !linkedin_url) {
    errors.push({ field: 'linkedin_url', code: 'invalid_url' });
  }

  const youtube_url = body.youtube_url != null ? sanitizeUrl(body.youtube_url) : null;
  if (body.youtube_url && !youtube_url) {
    errors.push({ field: 'youtube_url', code: 'invalid_url' });
  }

  const tiktok_url = body.tiktok_url != null ? sanitizeUrl(body.tiktok_url) : null;
  if (body.tiktok_url && !tiktok_url) {
    errors.push({ field: 'tiktok_url', code: 'invalid_url' });
  }

  const horariosInput =
    body.horarios ??
    body.horarios_json ??
    body.horarios_raw ??
    (typeof body.horarios_text === 'string' ? body.horarios_text : null);
  const horarios_json = sanitizeHorariosInput(horariosInput);

  return {
    values: {
      sobre,
      contato_email,
      contato_telefone,
      site_url,
      instagram_url,
      facebook_url,
      linkedin_url,
      youtube_url,
      tiktok_url,
      horarios_json,
    },
    errors,
  };
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
            const daySlug = normalizeDaySlug(
              item.day ?? item.key ?? item.weekday ?? item.week_day ?? label
            );
            let resolvedLabel = label;
            if (!resolvedLabel && daySlug && WEEKDAY_LABEL_MAP[daySlug]) {
              resolvedLabel = WEEKDAY_LABEL_MAP[daySlug];
            }
            let start = sanitizeTimeValue(item.start ?? item.begin ?? item.from ?? null);
            let end = sanitizeTimeValue(item.end ?? item.finish ?? item.to ?? null);
            if (start && end && start > end) {
              const temp = start;
              start = end;
              end = temp;
            }
            const rawBlocks = Array.isArray(item.blocks)
              ? item.blocks
              : Array.isArray(item.breaks)
              ? item.breaks
              : item.block_start || item.blockStart || item.block_end || item.blockEnd
              ? [{
                  start: item.block_start ?? item.blockStart ?? null,
                  end: item.block_end ?? item.blockEnd ?? null,
                }]
              : [];
            const sanitizedBlocks = [];
            for (const block of rawBlocks) {
              if (!block) continue;
              const blockStart = sanitizeTimeValue(block.start ?? block.begin ?? block.from ?? null);
              const blockEnd = sanitizeTimeValue(block.end ?? block.finish ?? block.to ?? null);
              if (!blockStart || !blockEnd) continue;
              if (blockStart >= blockEnd) continue;
              if (start && blockStart < start) continue;
              if (end && blockEnd > end) continue;
              sanitizedBlocks.push({ start: blockStart, end: blockEnd });
              if (sanitizedBlocks.length >= 3) break;
            }
            const result = {
              label: resolvedLabel,
              value: valueText || resolvedLabel,
              day: daySlug || null,
              start: start || null,
              end: end || null,
            };
            if (sanitizedBlocks.length) {
              result.blocks = sanitizedBlocks;
              result.breaks = sanitizedBlocks;
            }
            return result;
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
          return { label, value: valueText || label, day: normalizeDaySlug(label) || null, start: null, end: null };
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

router.get('/:id/reviews', async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId)) {
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });
    }

    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    const pageParam = Number(req.query?.page);
    const limitParam = Number(req.query?.limit ?? req.query?.per_page);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const perPageRaw = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 10;
    const perPage = Math.max(1, Math.min(perPageRaw, 50));
    const offset = (page - 1) * perPage;

    const [[countRow]] = await pool.query(
      'SELECT COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id=?',
      [estabelecimentoId]
    );
    const total = Number(countRow?.total || 0);
    const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

    const [rows] = await pool.query(
      `SELECT r.id, r.nota, r.comentario, r.created_at, r.updated_at,
              r.cliente_id, u.nome AS cliente_nome, u.avatar_url
         FROM estabelecimento_reviews r
         JOIN usuarios u ON u.id = r.cliente_id
        WHERE r.estabelecimento_id=?
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT ? OFFSET ?`,
      [estabelecimentoId, perPage, offset]
    );

    const items = rows.map((row) => {
      const commentRaw = typeof row.comentario === 'string' ? row.comentario.trim() : null;
      const comment = commentRaw ? commentRaw : null;
      const nota = Number(row.nota);
      return {
        id: row.id,
        nota: Number.isFinite(nota) ? nota : null,
        comentario: comment,
        created_at: toISODate(row.created_at),
        updated_at: toISODate(row.updated_at),
        author: {
          id: row.cliente_id,
          name: reviewerDisplayName(row.cliente_nome),
          full_name: String(row.cliente_nome || '').trim() || null,
          initials: reviewerInitials(row.cliente_nome),
          avatar_url: row.avatar_url || null,
        },
      };
    });

    return res.json({
      items,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: totalPages,
        has_next: offset + items.length < total,
        has_prev: page > 1,
      },
    });
  } catch (err) {
    console.error('GET /establishments/:id/reviews', err);
    return res.status(500).json({ error: 'reviews_fetch_failed' });
  }
});

router.put('/:id/profile', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    const { values, errors } = buildProfileUpdatePayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({ error: 'invalid_profile_payload', details: errors });
    }

    await pool.query(
      `INSERT INTO estabelecimento_perfis (
         estabelecimento_id, sobre, contato_email, contato_telefone,
         site_url, instagram_url, facebook_url, linkedin_url,
         youtube_url, tiktok_url, horarios_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sobre=VALUES(sobre),
         contato_email=VALUES(contato_email),
         contato_telefone=VALUES(contato_telefone),
         site_url=VALUES(site_url),
         instagram_url=VALUES(instagram_url),
         facebook_url=VALUES(facebook_url),
         linkedin_url=VALUES(linkedin_url),
         youtube_url=VALUES(youtube_url),
         tiktok_url=VALUES(tiktok_url),
         horarios_json=VALUES(horarios_json)`,
      [
        estabelecimentoId,
        values.sobre,
        values.contato_email,
        values.contato_telefone,
        values.site_url,
        values.instagram_url,
        values.facebook_url,
        values.linkedin_url,
        values.youtube_url,
        values.tiktok_url,
        values.horarios_json,
      ]
    );

    const [profileRows] = await pool.query(
      `SELECT estabelecimento_id, sobre, contato_email, contato_telefone,
              site_url, instagram_url, facebook_url, linkedin_url,
              youtube_url, tiktok_url, horarios_json, updated_at
         FROM estabelecimento_perfis
        WHERE estabelecimento_id=? LIMIT 1`,
      [estabelecimentoId]
    );
    const profile = normalizeProfile(est, profileRows?.[0] || null);

    return res.json({ ok: true, profile });
  } catch (err) {
    console.error('PUT /establishments/:id/profile', err);
    return res.status(500).json({ error: 'profile_save_failed' });
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

























