// backend/src/routes/estabelecimentos.js

import { Router } from "express";

import jwt from "jsonwebtoken";

import { pool } from "../lib/db.js";

import { resolveEstablishmentCoordinates } from "../lib/geocode.js";
import {
  saveEstablishmentImageFromDataUrl,
  removeEstablishmentImageFile,
} from "../lib/establishment_images.js";
import {
  CRM_DEFAULT_DORMANT_DAYS,
  CRM_INACTIVE_DAYS,
  classifyRelationship,
  computeAverageReturnDays,
  computeBirthdayInfo,
  normalizeCrmTags,
} from "../lib/crm.js";

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
import { getLatestSubscriptionForEstabelecimento } from "../lib/subscriptions.js";



const router = Router();
const PLAN_CHANGE_COOLDOWN_HOURS = Number(process.env.PLAN_CHANGE_COOLDOWN_HOURS || 12);



const LIST_SELECT = `
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
`;
const LIST_ORDER = 'ORDER BY u.nome';
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;
const CRM_PERIOD_DAYS = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
});
const CRM_SORT_COLUMNS = Object.freeze({
  name: 'base.nome',
  last: 'base.last_appointment_at',
  appointments: 'base.total_appointments',
  cancelled: 'base.total_cancelled',
  revenue: 'base.revenue_centavos',
  ticket: 'base.ticket_medio_centavos',
  dormant: 'base.days_since_last_visit',
});
const CRM_RELATIONSHIP_FILTERS = new Set(['novo', 'recorrente', 'vip', 'inativo', 'sumido']);
const CRM_DAY_FILTER_OPTIONS = Object.freeze([15, 30, 45, 60, 90]);
const CRM_REALIZED_VISIT_SQL = "(a.status='concluido' OR (a.status='confirmado' AND a.fim < NOW())) AND COALESCE(a.no_show,0)=0";


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

function sanitizeHexColor(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(prefixed)) return null;
  if (prefixed.length === 4) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  return prefixed.toLowerCase();
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
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
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

  const accentColorInput =
    body.accent_color ??
    body.brand_color ??
    body.cor_primaria ??
    null;
  const accent_color =
    accentColorInput != null ? sanitizeHexColor(accentColorInput) : null;
  if (accentColorInput && !accent_color) {
    errors.push({ field: 'accent_color', code: 'invalid_hex_color' });
  }

  const accentStrongColorInput =
    body.accent_strong_color ??
    body.secondary_color ??
    body.cor_secundaria ??
    null;
  const accent_strong_color =
    accentStrongColorInput != null
      ? sanitizeHexColor(accentStrongColorInput)
      : null;
  if (accentStrongColorInput && !accent_strong_color) {
    errors.push({ field: 'accent_strong_color', code: 'invalid_hex_color' });
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
      contato_telefone,
      site_url,
      instagram_url,
      facebook_url,
      linkedin_url,
      youtube_url,
      tiktok_url,
      accent_color,
      accent_strong_color,
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

  const fallbackPhone = establishmentRow?.telefone || null;

  if (!profileRow) {

    return {

      sobre: null,

      contato_telefone: fallbackPhone,

      site_url: null,

      instagram_url: null,

      facebook_url: null,

      linkedin_url: null,

      youtube_url: null,

      tiktok_url: null,

      accent_color: null,

      brand_color: null,

      cor_primaria: null,

      accent_strong_color: null,

      secondary_color: null,

      cor_secundaria: null,

      horarios: [],

      horarios_raw: null,

      updated_at: null,

    };

  }

  const updatedAt = profileRow.updated_at ? new Date(profileRow.updated_at) : null;

  return {

    sobre: profileRow.sobre || null,

    contato_telefone: profileRow.contato_telefone || fallbackPhone,

    site_url: profileRow.site_url || null,

    instagram_url: profileRow.instagram_url || null,

    facebook_url: profileRow.facebook_url || null,

    linkedin_url: profileRow.linkedin_url || null,

    youtube_url: profileRow.youtube_url || null,

    tiktok_url: profileRow.tiktok_url || null,

    accent_color: profileRow.accent_color || null,

    brand_color: profileRow.accent_color || null,

    cor_primaria: profileRow.accent_color || null,

    accent_strong_color: profileRow.accent_strong_color || null,

    secondary_color: profileRow.accent_strong_color || null,

    cor_secundaria: profileRow.accent_strong_color || null,

    horarios: parseHorarios(profileRow.horarios_json),

    horarios_raw: profileRow.horarios_json || null,

    updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,

  };

}

function normalizeGalleryImage(row) {
  if (!row) return null;
  return {
    id: row.id,
    estabelecimento_id: row.estabelecimento_id,
    url: row.file_path,
    titulo: row.titulo || null,
    descricao: row.descricao || null,
    ordem: Number.isFinite(row.ordem) ? Number(row.ordem) : 0,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function fetchGalleryImages(estabelecimentoId) {
  const [rows] = await pool.query(
    `SELECT id, estabelecimento_id, file_path, titulo, descricao, ordem, created_at
     FROM estabelecimento_imagens
     WHERE estabelecimento_id=?
     ORDER BY ordem ASC, id ASC`,
    [estabelecimentoId]
  );
  return rows.map(normalizeGalleryImage);
}

async function countGalleryImages(estabelecimentoId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM estabelecimento_imagens WHERE estabelecimento_id=?',
    [estabelecimentoId]
  );
  return Number(row?.total || 0);
}

async function resolveNextGalleryOrder(estabelecimentoId) {
  const [[row]] = await pool.query(
    'SELECT COALESCE(MAX(ordem), 0) AS max_ordem FROM estabelecimento_imagens WHERE estabelecimento_id=?',
    [estabelecimentoId]
  );
  return Number(row?.max_ordem || 0) + 1;
}

function sanitizeGalleryText(value, { maxLength = 255 } = {}) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (maxLength && text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function resolveGalleryLimit(planContext) {
  const limit = planContext?.config?.maxGalleryImages;
  if (limit === null || limit === undefined) return null;
  return Number.isFinite(limit) ? limit : null;
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

    const queryRaw = String(req.query?.q || '').trim().toLowerCase();
    const idsRaw = String(req.query?.ids || '').trim();
    const pageRaw = Number(req.query?.page);
    const limitRaw = Number(req.query?.limit);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;

    const where = ["u.tipo = 'estabelecimento'"];
    const params = [];

    if (idsRaw) {
      const ids = idsRaw
        .split(',')
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
        .slice(0, 50);
      if (ids.length) {
        where.push(`u.id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }
    }

    if (queryRaw) {
      const tokens = queryRaw.split(/\s+/).filter(Boolean).slice(0, 6);
      tokens.forEach((token) => {
        const like = `%${token}%`;
        where.push(
          '(LOWER(u.nome) LIKE ? OR LOWER(u.bairro) LIKE ? OR LOWER(u.cidade) LIKE ? OR LOWER(u.estado) LIKE ? OR LOWER(u.cep) LIKE ? OR LOWER(u.endereco) LIKE ? OR LOWER(u.numero) LIKE ? OR LOWER(u.email) LIKE ?)'
        );
        params.push(like, like, like, like, like, like, like, like);
      });
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sql = `${LIST_SELECT} ${whereSql} ${LIST_ORDER} LIMIT ? OFFSET ?`;

    const [rows] = await pool.query(sql, [...params, limit + 1, offset]);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);

    const includeCoords = String((req.query?.coords ?? '1')).toLowerCase() !== '0';
    const payload = await attachCoordinates(pageRows, includeCoords);

    res.json({ items: payload, page, limit, has_more: hasMore });

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

        "SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",

        [id]

      );

    } else {

      [rows] = await pool.query(

        "SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE slug=? AND tipo='estabelecimento' LIMIT 1",

        [idOrSlug]

      );

    }

    if (!rows.length) return res.status(404).json({ error: 'not_found' });

    const est = rows[0];



    const viewer = await resolveViewerFromRequest(req);



    const [planContext, profileResult, rating, galleryImages] = await Promise.all([

      getPlanContext(est.id),

      pool.query(

        "SELECT estabelecimento_id, sobre, contato_telefone, site_url, instagram_url, facebook_url, linkedin_url, youtube_url, tiktok_url, accent_color, accent_strong_color, horarios_json, updated_at FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1",

        [est.id]

      ),

      getRatingSummary(est.id),

      fetchGalleryImages(est.id),

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

      gallery: galleryImages,

      gallery_limit: resolveGalleryLimit(planContext),

    };



    return res.json(payload);

  } catch (e) {

    console.error('GET /establishments/:id', e);

    res.status(500).json({ error: 'establishment_fetch_failed' });
  }
});

router.get('/:id/images', async (req, res) => {

  try {

    const estabelecimentoId = Number(req.params.id);

    if (!Number.isFinite(estabelecimentoId)) {

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador invalido.' });

    }

    const est = await ensureEstabelecimento(estabelecimentoId);

    if (!est) return res.status(404).json({ error: 'not_found' });

    const images = await fetchGalleryImages(estabelecimentoId);

    return res.json({ images });

  } catch (e) {

    console.error('GET /establishments/:id/images', e);

    return res.status(500).json({ error: 'gallery_fetch_failed' });

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
         estabelecimento_id, sobre, contato_telefone,
         site_url, instagram_url, facebook_url, linkedin_url,
         youtube_url, tiktok_url, accent_color, accent_strong_color, horarios_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sobre=VALUES(sobre),
         contato_telefone=VALUES(contato_telefone),
         site_url=VALUES(site_url),
         instagram_url=VALUES(instagram_url),
         facebook_url=VALUES(facebook_url),
         linkedin_url=VALUES(linkedin_url),
         youtube_url=VALUES(youtube_url),
         tiktok_url=VALUES(tiktok_url),
         accent_color=VALUES(accent_color),
         accent_strong_color=VALUES(accent_strong_color),
         horarios_json=VALUES(horarios_json)`,
      [
        estabelecimentoId,
        values.sobre,
        values.contato_telefone,
        values.site_url,
        values.instagram_url,
        values.facebook_url,
        values.linkedin_url,
        values.youtube_url,
        values.tiktok_url,
        values.accent_color,
        values.accent_strong_color,
        values.horarios_json,
      ]
    );

    const [profileRows] = await pool.query(
      `SELECT estabelecimento_id, sobre, contato_telefone,
              site_url, instagram_url, facebook_url, linkedin_url,
              youtube_url, tiktok_url, accent_color, accent_strong_color, horarios_json, updated_at
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

function parseCrmStatuses(raw) {
  if (!raw) return [];
  const allowed = new Set(['confirmado', 'pendente', 'cancelado', 'concluido']);
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  parts.forEach((part) => {
    const value = String(part || '').trim().toLowerCase();
    if (!value || !allowed.has(value) || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function parsePositiveId(raw) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveIdList(raw) {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  parts.forEach((part) => {
    const value = parsePositiveId(part);
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function normalizeCrmOrigin(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  return value.slice(0, 32);
}

function resolveCrmFilters(query = {}) {
  const periodRaw = String(query.period || '30d').trim().toLowerCase();
  const normalizedPeriod = Object.prototype.hasOwnProperty.call(CRM_PERIOD_DAYS, periodRaw) ? periodRaw : '30d';
  const sortRaw = String(query.sort || 'last').trim().toLowerCase();
  const dirRaw = String(query.dir || 'desc').trim().toLowerCase();
  const relationshipRaw = String(
    query.relationship || query.statusRelacionamento || query.relationshipStatus || ''
  )
    .trim()
    .toLowerCase();
  const dormantDaysRaw = Number(
    query.dormantDays || query.daysWithoutReturn || query.diasSemRetorno || query.days_since_last_visit || 0
  );

  return {
    search: String(query.q || '').trim().toLowerCase(),
    period: normalizedPeriod,
    periodDays: CRM_PERIOD_DAYS[normalizedPeriod] || null,
    statuses: parseCrmStatuses(query.status),
    riskOnly: String(query.risk || '').trim() === '1',
    vipOnly: String(query.vip || '').trim() === '1',
    sortKey: Object.prototype.hasOwnProperty.call(CRM_SORT_COLUMNS, sortRaw) ? sortRaw : 'last',
    sortDir: dirRaw === 'asc' ? 'asc' : 'desc',
    relationship: CRM_RELATIONSHIP_FILTERS.has(relationshipRaw) ? relationshipRaw : 'all',
    serviceIds: parsePositiveIdList(
      query.serviceIds || query.serviceId || query.servicoId || query.servico_ids || query.servico
    ),
    profissionalId: parsePositiveId(
      query.profissionalId || query.profissional_id || query.profissional || query.professionalId
    ),
    origin: normalizeCrmOrigin(query.origem || query.origin || query.canal),
    dormantDays: CRM_DAY_FILTER_OPTIONS.includes(dormantDaysRaw) ? dormantDaysRaw : null,
  };
}

function buildCrmAppointmentFilterSql(estabelecimentoId, filters) {
  const clauses = ['a.estabelecimento_id = ?'];
  const params = [estabelecimentoId];

  if (filters.period !== 'all' && filters.periodDays) {
    clauses.push('a.inicio >= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(filters.periodDays);
  }

  if (filters.statuses.length) {
    const placeholders = filters.statuses.map(() => '?').join(', ');
    clauses.push(`a.status IN (${placeholders})`);
    params.push(...filters.statuses);
  }

  if (filters.profissionalId) {
    clauses.push('a.profissional_id = ?');
    params.push(filters.profissionalId);
  }

  if (filters.origin) {
    if (filters.origin === 'desconhecido') {
      clauses.push("(a.origem IS NULL OR a.origem='')");
    } else {
      clauses.push('a.origem = ?');
      params.push(filters.origin);
    }
  }

  if (filters.serviceIds.length) {
    const placeholders = filters.serviceIds.map(() => '?').join(', ');
    clauses.push(
      `EXISTS (SELECT 1 FROM agendamento_itens ai_filter WHERE ai_filter.agendamento_id = a.id AND ai_filter.servico_id IN (${placeholders}))`
    );
    params.push(...filters.serviceIds);
  }

  return {
    whereClause: clauses.join(' AND '),
    params,
  };
}

function buildCrmRelationshipClause(relationship) {
  switch (relationship) {
    case 'vip':
      return { clause: 'base.is_vip = 1', params: [] };
    case 'inativo':
      return { clause: 'base.is_vip = 0 AND COALESCE(base.days_since_last_visit, 0) >= ?', params: [CRM_INACTIVE_DAYS] };
    case 'sumido':
      return {
        clause:
          'base.is_vip = 0 AND COALESCE(base.days_since_last_visit, 0) >= ? AND COALESCE(base.days_since_last_visit, 0) < ?',
        params: [CRM_DEFAULT_DORMANT_DAYS, CRM_INACTIVE_DAYS],
      };
    case 'recorrente':
      return {
        clause:
          'base.is_vip = 0 AND base.lifetime_appointments >= 2 AND COALESCE(base.days_since_last_visit, 0) < ?',
        params: [CRM_DEFAULT_DORMANT_DAYS],
      };
    case 'novo':
      return {
        clause:
          'base.is_vip = 0 AND base.lifetime_appointments < 2 AND (base.days_since_last_visit IS NULL OR base.days_since_last_visit < ?)',
        params: [CRM_INACTIVE_DAYS],
      };
    default:
      return { clause: '', params: [] };
  }
}

function buildCrmOuterFilters(filters) {
  const clauses = ['1=1'];
  const params = [];

  if (filters.search) {
    const like = `%${filters.search}%`;
    const digits = filters.search.replace(/\D/g, '');
    const telLike = `%${digits || filters.search.replace(/\s+/g, '')}%`;
    clauses.push(
      "(LOWER(base.nome) LIKE ? OR LOWER(base.email) LIKE ? OR REPLACE(REPLACE(REPLACE(base.telefone,'+',''),'-',''),' ','') LIKE ?)"
    );
    params.push(like, like, telLike);
  }

  if (filters.vipOnly) {
    clauses.push('base.is_vip = 1');
  }

  if (filters.dormantDays) {
    clauses.push('COALESCE(base.days_since_last_visit, 0) >= ?');
    params.push(filters.dormantDays);
  }

  if (filters.riskOnly) {
    clauses.push(
      '(COALESCE(base.days_since_last_visit, 0) >= ? OR (base.total_appointments > 0 AND (base.total_cancelled / base.total_appointments) >= 0.35))'
    );
    params.push(CRM_DEFAULT_DORMANT_DAYS);
  }

  if (filters.relationship !== 'all') {
    const relationshipFilter = buildCrmRelationshipClause(filters.relationship);
    if (relationshipFilter.clause) {
      clauses.push(relationshipFilter.clause);
      params.push(...relationshipFilter.params);
    }
  }

  return {
    whereClause: clauses.join(' AND '),
    params,
  };
}

function buildCrmBaseQuery(estabelecimentoId, filters) {
  const appointmentFilters = buildCrmAppointmentFilterSql(estabelecimentoId, filters);
  const statsSql = `
    SELECT
      a.cliente_id,
      COUNT(*) AS total_appointments,
      SUM(a.status='cancelado') AS total_cancelled,
      MAX(a.inicio) AS last_appointment_at,
      SUBSTRING_INDEX(GROUP_CONCAT(a.status ORDER BY a.inicio DESC, a.id DESC SEPARATOR ','), ',', 1) AS last_status,
      SUBSTRING_INDEX(GROUP_CONCAT(a.id ORDER BY a.inicio DESC, a.id DESC SEPARATOR ','), ',', 1) AS last_appointment_id,
      COALESCE(SUM(CASE WHEN a.status <> 'cancelado' THEN a.total_centavos ELSE 0 END), 0) AS revenue_centavos,
      COUNT(CASE WHEN a.status <> 'cancelado' THEN 1 END) AS billable_appointments
    FROM agendamentos a
    WHERE ${appointmentFilters.whereClause}
    GROUP BY a.cliente_id
  `;

  const lifetimeSql = `
    SELECT
      a.cliente_id,
      COUNT(DISTINCT CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.id END) AS lifetime_appointments,
      COALESCE(SUM(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.total_centavos ELSE 0 END), 0) AS total_spent_centavos,
      MAX(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.inicio END) AS last_visit_at
    FROM agendamentos a
    WHERE a.estabelecimento_id = ?
    GROUP BY a.cliente_id
  `;

  const vipSql = `
    SELECT cliente_id, 1 AS is_vip
    FROM cliente_tags
    WHERE estabelecimento_id = ? AND UPPER(tag) = 'VIP'
    GROUP BY cliente_id
  `;

  const baseSql = `
    SELECT
      u.id,
      u.nome,
      u.email,
      u.telefone,
      u.data_nascimento,
      u.cep,
      u.endereco,
      u.numero,
      u.complemento,
      u.bairro,
      u.cidade,
      u.estado,
      stats.total_appointments,
      stats.total_cancelled,
      stats.last_appointment_at,
      stats.last_status,
      stats.last_appointment_id,
      stats.revenue_centavos,
      CASE
        WHEN stats.billable_appointments > 0 THEN ROUND(stats.revenue_centavos / stats.billable_appointments)
        ELSE 0
      END AS ticket_medio_centavos,
      COALESCE(life.lifetime_appointments, 0) AS lifetime_appointments,
      COALESCE(life.total_spent_centavos, 0) AS total_spent_centavos,
      life.last_visit_at,
      CASE
        WHEN life.last_visit_at IS NULL THEN NULL
        ELSE DATEDIFF(CURDATE(), DATE(life.last_visit_at))
      END AS days_since_last_visit,
      COALESCE(vip.is_vip, 0) AS is_vip
    FROM (${statsSql}) stats
    JOIN usuarios u ON u.id = stats.cliente_id
    LEFT JOIN (${lifetimeSql}) life ON life.cliente_id = stats.cliente_id
    LEFT JOIN (${vipSql}) vip ON vip.cliente_id = stats.cliente_id
  `;

  return {
    baseSql,
    params: [...appointmentFilters.params, estabelecimentoId, estabelecimentoId],
  };
}

async function ensureCrmClient(estabelecimentoId, clientId) {
  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.nome,
       u.email,
       u.telefone,
       u.data_nascimento,
       u.cep,
       u.endereco,
       u.numero,
       u.complemento,
       u.bairro,
       u.cidade,
       u.estado
     FROM usuarios u
     WHERE u.id = ?
       AND EXISTS (
         SELECT 1
         FROM agendamentos a
         WHERE a.estabelecimento_id = ?
           AND a.cliente_id = u.id
         LIMIT 1
       )
     LIMIT 1`,
    [clientId, estabelecimentoId]
  );
  return rows?.[0] || null;
}

async function loadCrmDerivedMetrics(estabelecimentoId, clientIds = []) {
  if (!clientIds.length) return new Map();

  const placeholders = clientIds.map(() => '?').join(', ');
  const baseParams = [estabelecimentoId, ...clientIds];

  const [historyRows, serviceRows, professionalRows] = await Promise.all([
    pool.query(
      `SELECT
         a.id,
         a.cliente_id,
         a.inicio,
         a.fim,
         a.status,
         a.total_centavos,
         p.nome AS profissional,
         COALESCE(NULLIF(GROUP_CONCAT(DISTINCT s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS service_label
       FROM agendamentos a
       LEFT JOIN profissionais p ON p.id = a.profissional_id
       LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
       LEFT JOIN servicos s ON s.id = ai.servico_id
       LEFT JOIN servicos s0 ON s0.id = a.servico_id
       WHERE a.estabelecimento_id = ?
         AND a.cliente_id IN (${placeholders})
         AND ${CRM_REALIZED_VISIT_SQL}
       GROUP BY a.id, a.cliente_id, a.inicio, a.fim, a.status, a.total_centavos, p.nome, s0.nome
       ORDER BY a.cliente_id ASC, a.inicio ASC`,
      baseParams
    ),
    pool.query(
      `SELECT
         a.cliente_id,
         s.id AS servico_id,
         s.nome,
         COUNT(*) AS total
       FROM agendamentos a
       JOIN agendamento_itens ai ON ai.agendamento_id = a.id
       JOIN servicos s ON s.id = ai.servico_id
       WHERE a.estabelecimento_id = ?
         AND a.cliente_id IN (${placeholders})
         AND ${CRM_REALIZED_VISIT_SQL}
       GROUP BY a.cliente_id, s.id, s.nome
       ORDER BY a.cliente_id ASC, total DESC, s.nome ASC`,
      baseParams
    ),
    pool.query(
      `SELECT
         a.cliente_id,
         p.id AS profissional_id,
         p.nome,
         COUNT(*) AS total
       FROM agendamentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.estabelecimento_id = ?
         AND a.cliente_id IN (${placeholders})
         AND ${CRM_REALIZED_VISIT_SQL}
       GROUP BY a.cliente_id, p.id, p.nome
       ORDER BY a.cliente_id ASC, total DESC, p.nome ASC`,
      baseParams
    ),
  ]);

  const history = Array.isArray(historyRows?.[0]) ? historyRows[0] : [];
  const services = Array.isArray(serviceRows?.[0]) ? serviceRows[0] : [];
  const professionals = Array.isArray(professionalRows?.[0]) ? professionalRows[0] : [];

  const derivedMap = new Map();
  clientIds.forEach((clientId) => {
    derivedMap.set(Number(clientId), {
      visit_dates: [],
      frequent_services: [],
      preferred_service: null,
      preferred_professional: null,
      last_service: null,
      avg_return_days: null,
    });
  });

  history.forEach((row) => {
    const clientId = Number(row.cliente_id);
    const bucket = derivedMap.get(clientId);
    if (!bucket) return;
    bucket.visit_dates.push(row.inicio);
    if (row.service_label) bucket.last_service = row.service_label;
  });

  const serviceCountMap = new Map();
  services.forEach((row) => {
    const clientId = Number(row.cliente_id);
    const bucket = derivedMap.get(clientId);
    if (!bucket) return;
    const item = {
      servico_id: Number(row.servico_id),
      nome: row.nome,
      total: Number(row.total || 0),
    };
    if (!serviceCountMap.has(clientId)) serviceCountMap.set(clientId, []);
    serviceCountMap.get(clientId).push(item);
  });

  const professionalCountMap = new Map();
  professionals.forEach((row) => {
    const clientId = Number(row.cliente_id);
    const bucket = derivedMap.get(clientId);
    if (!bucket) return;
    const item = {
      profissional_id: Number(row.profissional_id),
      nome: row.nome,
      total: Number(row.total || 0),
    };
    if (!professionalCountMap.has(clientId)) professionalCountMap.set(clientId, []);
    professionalCountMap.get(clientId).push(item);
  });

  derivedMap.forEach((bucket, clientId) => {
    const clientServices = serviceCountMap.get(clientId) || [];
    const clientProfessionals = professionalCountMap.get(clientId) || [];
    bucket.frequent_services = clientServices.slice(0, 5);
    bucket.preferred_service = clientServices[0] || null;
    bucket.preferred_professional = clientProfessionals[0] || null;
    bucket.avg_return_days = computeAverageReturnDays(bucket.visit_dates);
  });

  return derivedMap;
}

// Lista clientes do estabelecimento com resumo de agendamentos
router.get('/:id/clients', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || req.query.limit || 20)));
    const offset = (page - 1) * pageSize;
    const filters = resolveCrmFilters(req.query || {});
    const { baseSql, params: baseParams } = buildCrmBaseQuery(estabelecimentoId, filters);
    const outerFilters = buildCrmOuterFilters(filters);
    const orderColumn = CRM_SORT_COLUMNS[filters.sortKey] || CRM_SORT_COLUMNS.last;
    const orderDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (${baseSql}) base
      WHERE ${outerFilters.whereClause}
    `;

    const aggregationsSql = `
      SELECT
        COUNT(*) AS clients,
        COALESCE(SUM(base.total_appointments), 0) AS appointments,
        COALESCE(SUM(base.total_cancelled), 0) AS cancelled,
        COALESCE(SUM(base.revenue_centavos), 0) AS revenue_centavos,
        COALESCE(
          SUM(CASE WHEN base.total_appointments > base.total_cancelled THEN base.total_appointments - base.total_cancelled ELSE 0 END),
          0
        ) AS billable_appointments,
        SUM(CASE WHEN base.is_vip = 1 THEN 1 ELSE 0 END) AS vip_clients,
        SUM(
          CASE
            WHEN COALESCE(base.days_since_last_visit, 0) >= ${CRM_DEFAULT_DORMANT_DAYS}
              OR (base.total_appointments > 0 AND (base.total_cancelled / base.total_appointments) >= 0.35)
            THEN 1
            ELSE 0
          END
        ) AS risk_clients,
        SUM(CASE WHEN base.is_vip = 1 THEN 1 ELSE 0 END) AS relationship_vip,
        SUM(
          CASE
            WHEN base.is_vip = 0 AND COALESCE(base.days_since_last_visit, 0) >= ${CRM_INACTIVE_DAYS}
            THEN 1
            ELSE 0
          END
        ) AS relationship_inativo,
        SUM(
          CASE
            WHEN base.is_vip = 0
              AND COALESCE(base.days_since_last_visit, 0) >= ${CRM_DEFAULT_DORMANT_DAYS}
              AND COALESCE(base.days_since_last_visit, 0) < ${CRM_INACTIVE_DAYS}
            THEN 1
            ELSE 0
          END
        ) AS relationship_sumido,
        SUM(
          CASE
            WHEN base.is_vip = 0
              AND base.lifetime_appointments >= 2
              AND COALESCE(base.days_since_last_visit, 0) < ${CRM_DEFAULT_DORMANT_DAYS}
            THEN 1
            ELSE 0
          END
        ) AS relationship_recorrente,
        SUM(
          CASE
            WHEN base.is_vip = 0
              AND base.lifetime_appointments < 2
              AND (base.days_since_last_visit IS NULL OR base.days_since_last_visit < ${CRM_INACTIVE_DAYS})
            THEN 1
            ELSE 0
          END
        ) AS relationship_novo
      FROM (${baseSql}) base
      WHERE ${outerFilters.whereClause}
    `;

    const dataSql = `
      SELECT base.*
      FROM (${baseSql}) base
      WHERE ${outerFilters.whereClause}
      ORDER BY ${orderColumn} ${orderDir}, base.nome ASC
      LIMIT ? OFFSET ?
    `;

    const originsSql = `
      SELECT
        COALESCE(NULLIF(a.origem, ''), 'desconhecido') AS origem,
        COUNT(*) AS total
      FROM agendamentos a
      WHERE a.estabelecimento_id = ?
      GROUP BY origem
      ORDER BY total DESC, origem ASC
      LIMIT 12
    `;

    const [[countRows], [aggregationRows], [rows], [originRows]] = await Promise.all([
      pool.query(countSql, [...baseParams, ...outerFilters.params]),
      pool.query(aggregationsSql, [...baseParams, ...outerFilters.params]),
      pool.query(dataSql, [...baseParams, ...outerFilters.params, pageSize, offset]),
      pool.query(originsSql, [estabelecimentoId]),
    ]);

    const total = Number(countRows?.[0]?.total || 0);
    const lastAppointmentIds = Array.from(
      new Set(
        (rows || [])
          .map((row) => Number(row.last_appointment_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    let serviceMap = new Map();
    if (lastAppointmentIds.length) {
      const placeholders = lastAppointmentIds.map(() => '?').join(', ');
      const [serviceRows] = await pool.query(
        `SELECT a.id AS agendamento_id,
                COALESCE(NULLIF(GROUP_CONCAT(s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS service_label
           FROM agendamentos a
           LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
           LEFT JOIN servicos s ON s.id = ai.servico_id
           LEFT JOIN servicos s0 ON s0.id = a.servico_id
          WHERE a.id IN (${placeholders})
          GROUP BY a.id, s0.nome`,
        lastAppointmentIds
      );
      serviceMap = new Map(
        (serviceRows || []).map((row) => [Number(row.agendamento_id), row.service_label || ''])
      );
    }
    const clientIds = (rows || []).map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0);
    const derivedMap = await loadCrmDerivedMetrics(estabelecimentoId, clientIds);

    const items = (rows || []).map((row) => {
      const clientId = Number(row.id);
      const derived = derivedMap.get(clientId) || {};
      const relationship = classifyRelationship({
        totalAppointments: Number(row.lifetime_appointments || 0),
        daysSinceLastVisit: row.days_since_last_visit == null ? null : Number(row.days_since_last_visit),
        isVip: Boolean(row.is_vip),
      });
      const cancelRate = Number(row.total_appointments || 0)
        ? Math.round((Number(row.total_cancelled || 0) / Math.max(Number(row.total_appointments || 0), 1)) * 100)
        : 0;
      const birthday = computeBirthdayInfo(row.data_nascimento);
      const serviceLabel = serviceMap.get(Number(row.last_appointment_id)) || derived.last_service || '';
      const { last_appointment_id, ...rest } = row;
      return {
        ...rest,
        last_service: serviceLabel,
        avg_return_days: derived.avg_return_days ?? null,
        preferred_service: derived.preferred_service || null,
        preferred_professional: derived.preferred_professional || null,
        relationship_status: relationship.code,
        relationship_label: relationship.label,
        cancel_rate: cancelRate,
        is_at_risk:
          (row.days_since_last_visit != null && Number(row.days_since_last_visit) >= CRM_DEFAULT_DORMANT_DAYS) ||
          cancelRate >= 35,
        birthday,
      };
    });

    const aggregationRow = aggregationRows?.[0] || {};
    const aggregationAppointments = Number(aggregationRow.appointments || 0);
    const aggregationCancelled = Number(aggregationRow.cancelled || 0);
    const aggregationRevenue = Number(aggregationRow.revenue_centavos || 0);
    const aggregationBillable = Number(aggregationRow.billable_appointments || 0);
    const aggregations = {
      period: filters.period,
      clients: Number(aggregationRow.clients || 0),
      appointments: aggregationAppointments,
      cancelled: aggregationCancelled,
      cancel_rate: aggregationAppointments ? Math.round((aggregationCancelled / aggregationAppointments) * 100) : 0,
      revenue_centavos: aggregationRevenue,
      ticket_medio_centavos: aggregationBillable ? Math.round(aggregationRevenue / aggregationBillable) : 0,
      vip_clients: Number(aggregationRow.vip_clients || 0),
      risk_clients: Number(aggregationRow.risk_clients || 0),
      relationship_novo: Number(aggregationRow.relationship_novo || 0),
      relationship_recorrente: Number(aggregationRow.relationship_recorrente || 0),
      relationship_vip: Number(aggregationRow.relationship_vip || 0),
      relationship_inativo: Number(aggregationRow.relationship_inativo || 0),
      relationship_sumido: Number(aggregationRow.relationship_sumido || 0),
    };

    return res.json({
      items,
      page,
      pageSize,
      total,
      hasNext: offset + (rows?.length || 0) < total,
      aggregations,
      meta: {
        origins: (originRows || []).map((row) => ({
          origem: row.origem,
          total: Number(row.total || 0),
        })),
        day_filters: CRM_DAY_FILTER_OPTIONS,
      },
    });
  } catch (err) {
    console.error('GET /establishments/:id/clients', err);
    return res.status(500).json({ error: 'clients_fetch_failed' });
  }
});

router.get('/:id/clients/:clientId/details', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const cliente = await ensureCrmClient(estabelecimentoId, clientId);
    if (!cliente) {
      return res.status(404).json({ error: 'client_not_found' });
    }

    const periodFilter = resolveCrmFilters({ period: req.query.period || '30d' });
    const periodAppointmentFilters = buildCrmAppointmentFilterSql(estabelecimentoId, {
      ...periodFilter,
      statuses: [],
      serviceIds: [],
      profissionalId: null,
      origin: null,
    });

    const metricsSql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(a.status='cancelado') AS total_cancelled,
        COALESCE(SUM(CASE WHEN a.status <> 'cancelado' THEN a.total_centavos ELSE 0 END), 0) AS revenue_centavos,
        COUNT(CASE WHEN a.status <> 'cancelado' THEN 1 END) AS billable_appointments
      FROM agendamentos a
      WHERE ${periodAppointmentFilters.whereClause}
        AND a.cliente_id = ?
    `;

    const lastAppointmentSql = `
      SELECT
        MAX(a.inicio) AS last_appointment_at,
        SUBSTRING_INDEX(GROUP_CONCAT(a.status ORDER BY a.inicio DESC, a.id DESC SEPARATOR ','), ',', 1) AS last_status
      FROM agendamentos a
      WHERE a.estabelecimento_id = ?
        AND a.cliente_id = ?
    `;

    const lifetimeSql = `
      SELECT
        COUNT(DISTINCT CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.id END) AS lifetime_appointments,
        COALESCE(SUM(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.total_centavos ELSE 0 END), 0) AS total_spent_centavos,
        MAX(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.inicio END) AS last_visit_at
      FROM agendamentos a
      WHERE a.estabelecimento_id = ?
        AND a.cliente_id = ?
    `;

    const historySql = `
      SELECT
        a.id,
        a.inicio,
        a.fim,
        a.status,
        a.total_centavos,
        COALESCE(NULLIF(a.origem, ''), 'desconhecido') AS origem,
        p.nome AS profissional,
        COALESCE(NULLIF(GROUP_CONCAT(DISTINCT s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS servico
      FROM agendamentos a
      LEFT JOIN profissionais p ON p.id = a.profissional_id
      LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ai.servico_id
      LEFT JOIN servicos s0 ON s0.id = a.servico_id
      WHERE a.estabelecimento_id = ?
        AND a.cliente_id = ?
      GROUP BY a.id, a.inicio, a.fim, a.status, a.total_centavos, a.origem, p.nome, s0.nome
      ORDER BY a.inicio DESC, a.id DESC
      LIMIT 12
    `;

    const notesSql = `
      SELECT notas
      FROM cliente_notas
      WHERE estabelecimento_id = ?
        AND cliente_id = ?
      LIMIT 1
    `;

    const tagsSql = `
      SELECT tag
      FROM cliente_tags
      WHERE estabelecimento_id = ?
        AND cliente_id = ?
      ORDER BY tag ASC
    `;

    const [
      [metricsRows],
      [lastAppointmentRows],
      [lifetimeRows],
      [historyRows],
      [notesRows],
      [tagsRows],
      derivedMap,
    ] = await Promise.all([
      pool.query(metricsSql, [...periodAppointmentFilters.params, clientId]),
      pool.query(lastAppointmentSql, [estabelecimentoId, clientId]),
      pool.query(lifetimeSql, [estabelecimentoId, clientId]),
      pool.query(historySql, [estabelecimentoId, clientId]),
      pool.query(notesSql, [estabelecimentoId, clientId]),
      pool.query(tagsSql, [estabelecimentoId, clientId]),
      loadCrmDerivedMetrics(estabelecimentoId, [clientId]),
    ]);

    const periodMetrics = metricsRows?.[0] || {};
    const lastAppointment = lastAppointmentRows?.[0] || {};
    const lifetimeMetrics = lifetimeRows?.[0] || {};
    const derived = derivedMap.get(clientId) || {};
    const birthday = computeBirthdayInfo(cliente.data_nascimento);
    const daysSinceLastVisit =
      lifetimeMetrics.last_visit_at == null
        ? null
        : Math.max(0, Number(new Date() - new Date(lifetimeMetrics.last_visit_at)) / (24 * 60 * 60 * 1000));
    const relationship = classifyRelationship({
      totalAppointments: Number(lifetimeMetrics.lifetime_appointments || 0),
      daysSinceLastVisit:
        lifetimeMetrics.last_visit_at == null ? null : Math.floor(daysSinceLastVisit),
      isVip: (tagsRows || []).some((row) => String(row.tag || '').trim().toUpperCase() === 'VIP'),
    });
    const totalAppointments = Number(periodMetrics.total_appointments || 0);
    const totalCancelled = Number(periodMetrics.total_cancelled || 0);
    const revenueCentavos = Number(periodMetrics.revenue_centavos || 0);
    const billableAppointments = Number(periodMetrics.billable_appointments || 0);
    const history = (historyRows || []).map((row) => ({
      id: Number(row.id),
      inicio: toISODate(row.inicio),
      fim: toISODate(row.fim),
      status: row.status,
      total_centavos: Number(row.total_centavos || 0),
      origem: row.origem || 'desconhecido',
      profissional: row.profissional || null,
      servico: row.servico || null,
    }));

    return res.json({
      cliente: {
        ...cliente,
        birthday,
      },
      metrics: {
        total_appointments: totalAppointments,
        total_cancelled: totalCancelled,
        cancel_rate: totalAppointments ? Math.round((totalCancelled / totalAppointments) * 100) : 0,
        revenue_centavos: revenueCentavos,
        ticket_medio_centavos: billableAppointments ? Math.round(revenueCentavos / billableAppointments) : 0,
        total_spent_centavos: Number(lifetimeMetrics.total_spent_centavos || 0),
        lifetime_appointments: Number(lifetimeMetrics.lifetime_appointments || 0),
        lifetime_ticket_medio_centavos: Number(lifetimeMetrics.lifetime_appointments || 0)
          ? Math.round(
              Number(lifetimeMetrics.total_spent_centavos || 0) / Math.max(Number(lifetimeMetrics.lifetime_appointments || 0), 1)
            )
          : 0,
        last_appointment_at: toISODate(lastAppointment.last_appointment_at),
        last_visit_at: toISODate(lifetimeMetrics.last_visit_at),
        last_status: lastAppointment.last_status || null,
        last_service: history[0]?.servico || derived.last_service || null,
        avg_return_days: derived.avg_return_days ?? null,
        days_since_last_visit:
          lifetimeMetrics.last_visit_at == null ? null : Math.floor(daysSinceLastVisit),
        preferred_service: derived.preferred_service || null,
        preferred_professional: derived.preferred_professional || null,
        relationship_status: relationship.code,
        relationship_label: relationship.label,
      },
      frequent_services: derived.frequent_services || [],
      notes: notesRows?.[0]?.notas ?? null,
      tags: (tagsRows || []).map((row) => row.tag).filter(Boolean),
      history,
    });
  } catch (err) {
    console.error('GET /establishments/:id/clients/:clientId/details', err);
    return res.status(500).json({ error: 'client_details_failed' });
  }
});

router.put('/:id/clients/:clientId/notes', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const cliente = await ensureCrmClient(estabelecimentoId, clientId);
    if (!cliente) {
      return res.status(404).json({ error: 'client_not_found' });
    }

    const notes = sanitizePlainText(req.body?.notes, { maxLength: 2000 });
    await pool.query(
      `INSERT INTO cliente_notas (estabelecimento_id, cliente_id, notas)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE notas = VALUES(notas), updated_at = CURRENT_TIMESTAMP`,
      [estabelecimentoId, clientId, notes]
    );

    return res.json({ ok: true, notes });
  } catch (err) {
    console.error('PUT /establishments/:id/clients/:clientId/notes', err);
    return res.status(500).json({ error: 'client_notes_failed' });
  }
});

router.put('/:id/clients/:clientId/tags', auth, isEstabelecimento, async (req, res) => {
  let conn = null;
  try {
    const estabelecimentoId = Number(req.params.id);
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const cliente = await ensureCrmClient(estabelecimentoId, clientId);
    if (!cliente) {
      return res.status(404).json({ error: 'client_not_found' });
    }

    const tags = normalizeCrmTags(req.body?.tags);

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      'DELETE FROM cliente_tags WHERE estabelecimento_id = ? AND cliente_id = ?',
      [estabelecimentoId, clientId]
    );

    if (tags.length) {
      const valuesSql = tags.map(() => '(?, ?, ?)').join(', ');
      const params = tags.flatMap((tag) => [estabelecimentoId, clientId, tag]);
      await conn.query(
        `INSERT INTO cliente_tags (estabelecimento_id, cliente_id, tag) VALUES ${valuesSql}`,
        params
      );
    }

    await conn.commit();
    return res.json({ ok: true, tags });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error('PUT /establishments/:id/clients/:clientId/tags', err);
    return res.status(500).json({ error: 'client_tags_failed' });
  } finally {
    if (conn) conn.release();
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



    // Cooldown para evitar alternancias frequentes de plano
    if (PLAN_CHANGE_COOLDOWN_HOURS > 0 && rawPlan !== currentPlan) {
      try {
        const latestSub = await getLatestSubscriptionForEstabelecimento(id);
        if (latestSub?.createdAt instanceof Date && Number.isFinite(latestSub.createdAt.getTime())) {
          const diffMs = Date.now() - latestSub.createdAt.getTime();
          const cooldownMs = PLAN_CHANGE_COOLDOWN_HOURS * 3600 * 1000;
          if (diffMs < cooldownMs) {
            const remainingHours = Math.max(1, Math.ceil((cooldownMs - diffMs) / 3600000));
            return res.status(429).json({
              error: 'plan_change_cooldown',
              message: `Aguarde ${remainingHours}h para mudar de plano novamente.`,
            });
          }
        }
      } catch (err) {
        console.warn('[plan_change][cooldown_check] failed', err?.message || err);
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

    const trialActive = Boolean(context.trial?.isTrial);
    const trialEver = Boolean(context.trialEndsAt);
    const wantsTrial =
      planStatus === 'trialing' ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'trialDays') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'trialEndsAt');

    if (trialEver && !trialActive && wantsTrial) {
      return res.status(400).json({ error: 'trial_already_used', message: 'O teste gratis ja foi usado nesta conta.' });
    }

    let planTrialEndsAt = context.trialEndsAt;

    if (trialActive) {
      // Mantem o trial atual sem renovacao/extensao
      planStatus = 'trialing';
      planTrialEndsAt = context.trialEndsAt;
    } else if (req.body?.trialEndsAt) {
      const parsed = new Date(req.body.trialEndsAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialEndsAt invalido.' });
      }
      planTrialEndsAt = parsed;
    } else if (req.body?.trialDays) {
      let days = Number(req.body.trialDays);
      if (!Number.isFinite(days) || days <= 0) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialDays deve ser um numero positivo.' });
      }
      // Politica: teste gratis de 7 dias
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



router.post('/:id/images', auth, isEstabelecimento, async (req, res) => {

  try {

    const estabelecimentoId = Number(req.params.id);

    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {

      return res.status(403).json({ error: 'forbidden' });

    }

    const est = await ensureEstabelecimento(estabelecimentoId);

    if (!est) return res.status(404).json({ error: 'not_found' });

    const imageRaw = typeof req.body?.image === 'string' ? req.body.image.trim() : '';

    if (!imageRaw) {

      return res.status(400).json({ error: 'image_required', message: 'Envie a imagem em formato data URL.' });

    }

    const titulo = sanitizeGalleryText(req.body?.titulo, { maxLength: 120 });

    const descricao = sanitizeGalleryText(req.body?.descricao, { maxLength: 240 });

    const planContext = await getPlanContext(estabelecimentoId);

    const limit = resolveGalleryLimit(planContext);

    const total = await countGalleryImages(estabelecimentoId);

    if (limit !== null && total >= limit) {

      const message =

        limit === 0

          ? 'Seu plano atual não permite adicionar imagens.'

          : `Seu plano atual permite cadastrar até ${limit} imagens.`;

      return res.status(409).json({ error: 'gallery_limit_reached', message, details: { limit } });

    }

    let filePath = null;

    try {

      filePath = await saveEstablishmentImageFromDataUrl(imageRaw, estabelecimentoId);

    } catch (err) {

      if (err?.code === 'GALLERY_IMAGE_TOO_LARGE') {

        return res.status(400).json({ error: 'gallery_image_large', message: 'A imagem deve ter no maximo 3MB.' });

      }

      if (err?.code === 'GALLERY_IMAGE_INVALID') {

        return res.status(400).json({ error: 'gallery_image_invalid', message: 'Envie PNG, JPG ou WEBP validos.' });

      }

      console.error('POST /establishments/:id/images parse', err);

      return res.status(500).json({ error: 'gallery_upload_failed' });

    }

    const ordem = await resolveNextGalleryOrder(estabelecimentoId);

    const [insertResult] = await pool.query(

      'INSERT INTO estabelecimento_imagens (estabelecimento_id, file_path, titulo, descricao, ordem) VALUES (?,?,?,?,?)',

      [estabelecimentoId, filePath, titulo, descricao, ordem]

    );

    const insertedId = insertResult.insertId;

    const [[row]] = await pool.query(

      'SELECT id, estabelecimento_id, file_path, titulo, descricao, ordem, created_at FROM estabelecimento_imagens WHERE id=? LIMIT 1',

      [insertedId]

    );

    return res.status(201).json({

      ok: true,

      image: normalizeGalleryImage(row),

      remaining_slots: limit === null ? null : Math.max(0, limit - (total + 1)),

    });

  } catch (err) {

    console.error('POST /establishments/:id/images', err);

    return res.status(500).json({ error: 'gallery_upload_failed' });

  }

});



router.delete('/:id/images/:imageId', auth, isEstabelecimento, async (req, res) => {

  try {

    const estabelecimentoId = Number(req.params.id);

    const imageId = Number(req.params.imageId);

    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {

      return res.status(403).json({ error: 'forbidden' });

    }

    if (!Number.isFinite(imageId)) {

      return res.status(400).json({ error: 'invalid_image', message: 'Imagem invalida.' });

    }

    const [[row]] = await pool.query(

      'SELECT id, estabelecimento_id, file_path FROM estabelecimento_imagens WHERE id=? LIMIT 1',

      [imageId]

    );

    if (!row || row.estabelecimento_id !== estabelecimentoId) {

      return res.status(404).json({ error: 'not_found' });

    }

    await pool.query('DELETE FROM estabelecimento_imagens WHERE id=? LIMIT 1', [imageId]);

    if (row.file_path) {

      try {

        await removeEstablishmentImageFile(row.file_path);

      } catch (e) {

        if (e?.code !== 'ENOENT') {

          console.warn('Failed to remove gallery image file', e?.message || e);

        }

      }

    }

    const images = await fetchGalleryImages(estabelecimentoId);

    return res.json({ ok: true, images });

  } catch (err) {

    console.error('DELETE /establishments/:id/images/:imageId', err);

    return res.status(500).json({ error: 'gallery_delete_failed' });

  }

});



router.put('/:id/images/reorder', auth, isEstabelecimento, async (req, res) => {

  try {

    const estabelecimentoId = Number(req.params.id);

    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {

      return res.status(403).json({ error: 'forbidden' });

    }

    const est = await ensureEstabelecimento(estabelecimentoId);

    if (!est) return res.status(404).json({ error: 'not_found' });

    if (!Array.isArray(req.body?.order)) {

      return res.status(400).json({ error: 'invalid_payload', message: 'Envie a lista ordenada de IDs.' });

    }

    const incomingOrder = req.body.order

      .map((value) => Number(value))

      .filter((num) => Number.isInteger(num) && num > 0);

    const [rows] = await pool.query(

      'SELECT id FROM estabelecimento_imagens WHERE estabelecimento_id=? ORDER BY ordem ASC, id ASC',

      [estabelecimentoId]

    );

    if (!rows.length) {

      return res.json({ ok: true, images: [] });

    }

    const existingIds = rows.map((r) => r.id);

    const seen = new Set();

    const normalized = [];

    for (const imageId of incomingOrder) {

      if (existingIds.includes(imageId) && !seen.has(imageId)) {

        seen.add(imageId);

        normalized.push(imageId);

      }

    }

    const remainder = existingIds.filter((id) => !seen.has(id));

    const finalOrder = normalized.concat(remainder);

    await Promise.all(

      finalOrder.map((imageId, index) =>

        pool.query('UPDATE estabelecimento_imagens SET ordem=? WHERE id=? LIMIT 1', [index + 1, imageId])

      )

    );

    const images = await fetchGalleryImages(estabelecimentoId);

    return res.json({ ok: true, images });

  } catch (err) {

    console.error('PUT /establishments/:id/images/reorder', err);

    return res.status(500).json({ error: 'gallery_reorder_failed' });

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














