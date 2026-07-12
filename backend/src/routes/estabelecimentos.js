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
  buildCrmPeriodSql,
  buildCrmPreviousPeriodSql,
  buildCrmRelationshipSql,
  buildCrmRiskSql,
  classifyRelationship,
  computeAverageReturnDays,
  computeBirthdayInfo,
  isAtRisk,
  normalizeCrmTags,
} from "../lib/crm.js";
import { EST_TZ_OFFSET_MIN } from "../lib/datetime_tz.js";
import {
  csvLine,
  formatCsvBoolean,
  formatCsvMoney,
  sanitizeFilenameSegment,
  startCsvResponse,
} from "../lib/csv.js";

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
import { setAudit } from "../lib/audit.js";



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
  // "last" agora é a última VISITA realizada, não o último agendamento: um cancelamento
  // de ontem fazia um cliente sumido há 60 dias parecer ativo no topo da lista.
  last: 'base.last_visit_at',
  booked: 'base.last_appointment_at',
  appointments: 'base.total_appointments',
  cancelled: 'base.total_cancelled',
  revenue: 'base.revenue_centavos',
  ticket: 'base.ticket_medio_centavos',
  dormant: 'base.days_since_last_visit',
});
const CRM_RELATIONSHIP_FILTERS = new Set(['novo', 'recorrente', 'vip', 'inativo', 'sumido']);
const CRM_DAY_FILTER_OPTIONS = Object.freeze([15, 30, 45, 60, 90]);
// a.inicio/a.fim são gravados em UTC; NOW() seguiria o fuso do MySQL.
const CRM_REALIZED_VISIT_SQL = "(a.status='concluido' OR (a.status='confirmado' AND a.fim < UTC_TIMESTAMP())) AND COALESCE(a.no_show,0)=0";
// Receita prevista: mesma régua de /relatorios (confirmados + pendentes + concluídos, sem no-show).
const CRM_EXPECTED_REVENUE_SQL = "a.status IN ('confirmado','pendente','concluido') AND COALESCE(a.no_show,0)=0";


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

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });

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
      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });
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

    // Save PARCIAL: cada bloco do perfil público tem menu próprio. Os campos que este request
    // NÃO enviou são preservados com o valor atual do banco (evita um menu zerar os outros).
    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k);
    const [[cur]] = await pool.query(
      `SELECT sobre, contato_telefone, site_url, instagram_url, facebook_url, linkedin_url,
              youtube_url, tiktok_url, accent_color, accent_strong_color, horarios_json
         FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1`,
      [estabelecimentoId]
    );
    if (cur) {
      const keep = (field, ...bodyKeys) => {
        if (!bodyKeys.some(has)) values[field] = cur[field] ?? null;
      };
      keep('sobre', 'sobre');
      keep('contato_telefone', 'contato_telefone');
      keep('site_url', 'site_url');
      keep('instagram_url', 'instagram_url');
      keep('facebook_url', 'facebook_url');
      keep('linkedin_url', 'linkedin_url');
      keep('youtube_url', 'youtube_url');
      keep('tiktok_url', 'tiktok_url');
      keep('accent_color', 'accent_color', 'brand_color', 'cor_primaria');
      keep('accent_strong_color', 'accent_strong_color', 'secondary_color', 'cor_secundaria');
      keep('horarios_json', 'horarios', 'horarios_json', 'horarios_raw', 'horarios_text');
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

// Horários de funcionamento têm menu próprio nas Configurações; este save toca SÓ em horarios_json,
// preservando os demais campos do perfil (sobre, redes, cores).
router.put('/:id/hours', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const est = await ensureEstabelecimento(estabelecimentoId);
    if (!est) return res.status(404).json({ error: 'not_found' });

    const horariosInput =
      req.body?.horarios ??
      req.body?.horarios_json ??
      req.body?.horarios_raw ??
      (typeof req.body?.horarios_text === 'string' ? req.body.horarios_text : null);
    const horarios_json = sanitizeHorariosInput(horariosInput);

    await pool.query(
      `INSERT INTO estabelecimento_perfis (estabelecimento_id, horarios_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE horarios_json=VALUES(horarios_json)`,
      [estabelecimentoId, horarios_json]
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
    console.error('PUT /establishments/:id/hours', err);
    return res.status(500).json({ error: 'hours_save_failed' });
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
    // `vip=1` foi removido: gerava exatamente o mesmo SQL que relationship=vip. Eram dois
    // controles na tela para um filtro só, com comportamentos diferentes.
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
    birthdayMonth: String(query.birthday || query.aniversario || '').trim().toLowerCase() === 'mes',
  };
}

// Recortes de DIMENSÃO: definem QUEM entra na lista (quem já agendou aquele serviço, com
// aquele profissional, por aquele canal). O período NÃO entra aqui — era ele que escondia
// justamente os clientes sumidos, que é quem a página existe para achar.
function buildCrmAppointmentFilterSql(estabelecimentoId, filters) {
  const clauses = ['a.estabelecimento_id = ?'];
  const params = [estabelecimentoId];

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

// `includeRelationship: false` monta o mesmo recorte SEM o filtro de segmento — é o que
// permite contar quantos há em CADA segmento (com o filtro dentro, "Novos" contaria 0
// enquanto você olha os "Sumidos").
function buildCrmOuterFilters(filters, { includeRelationship = true } = {}) {
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

  if (filters.dormantDays) {
    clauses.push('COALESCE(base.days_since_last_visit, 0) >= ?');
    params.push(filters.dormantDays);
  }

  if (filters.riskOnly) {
    clauses.push(buildCrmRiskSql('base'));
  }

  if (filters.birthdayMonth) {
    // Mês LOCAL do estabelecimento. Em UTC puro, no último dia do mês depois das 21h a
    // lista já mostraria os aniversariantes do mês seguinte.
    clauses.push(
      `MONTH(base.data_nascimento) = MONTH(DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${EST_TZ_OFFSET_MIN} MINUTE))`
    );
  }

  if (includeRelationship && filters.relationship !== 'all') {
    const clause = buildCrmRelationshipSql(filters.relationship, 'base');
    if (clause) clauses.push(`(${clause})`);
  }

  return {
    whereClause: clauses.join(' AND '),
    params,
  };
}

function buildCrmBaseQuery(estabelecimentoId, filters) {
  const appointmentFilters = buildCrmAppointmentFilterSql(estabelecimentoId, filters);
  // Predicado do período como literal (periodDays vem de um mapa congelado, nunca do
  // usuário), então pode se repetir na agregação condicional sem embaralhar parâmetros.
  const inPeriod = buildCrmPeriodSql(filters.period === 'all' ? null : filters.periodDays);
  // Janela anterior, do mesmo tamanho. Vem como mais colunas no MESMO scan — o comparativo
  // dos KPIs não custa nenhuma query a mais.
  const inPrevPeriod = buildCrmPreviousPeriodSql(filters.period === 'all' ? null : filters.periodDays);

  const statsSql = `
    SELECT
      a.cliente_id,
      -- Números DO PERÍODO (agregação condicional). O cliente continua na lista mesmo
      -- que não tenha nada no período — é exatamente esse o cliente sumido.
      COUNT(CASE WHEN ${inPeriod} THEN 1 END) AS total_appointments,
      COUNT(CASE WHEN ${inPrevPeriod} THEN 1 END) AS prev_total_appointments,
      SUM(CASE WHEN ${inPeriod} AND a.status='cancelado' THEN 1 ELSE 0 END) AS total_cancelled,
      SUM(CASE WHEN ${inPrevPeriod} AND a.status='cancelado' THEN 1 ELSE 0 END) AS prev_total_cancelled,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND ${CRM_REALIZED_VISIT_SQL} THEN a.total_centavos ELSE 0 END), 0) AS revenue_centavos,
      COALESCE(SUM(CASE WHEN ${inPrevPeriod} AND ${CRM_REALIZED_VISIT_SQL} THEN a.total_centavos ELSE 0 END), 0) AS prev_revenue_centavos,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND ${CRM_EXPECTED_REVENUE_SQL} THEN a.total_centavos ELSE 0 END), 0) AS expected_revenue_centavos,
      COUNT(CASE WHEN ${inPeriod} AND ${CRM_REALIZED_VISIT_SQL} THEN 1 END) AS billable_appointments,
      COUNT(CASE WHEN ${inPrevPeriod} AND ${CRM_REALIZED_VISIT_SQL} THEN 1 END) AS prev_billable_appointments,
      -- Vitalícios: a última vez que agendou (qualquer status) e o status desse agendamento.
      MAX(a.inicio) AS last_appointment_at,
      SUBSTRING_INDEX(GROUP_CONCAT(a.status ORDER BY a.inicio DESC, a.id DESC SEPARATOR ','), ',', 1) AS last_status,
      SUBSTRING_INDEX(GROUP_CONCAT(a.id ORDER BY a.inicio DESC, a.id DESC SEPARATOR ','), ',', 1) AS last_appointment_id
    FROM agendamentos a
    WHERE ${appointmentFilters.whereClause}
    GROUP BY a.cliente_id
  `;

  const lifetimeSql = `
    SELECT
      a.cliente_id,
      COUNT(*) AS lifetime_total,
      SUM(a.status='cancelado') AS lifetime_cancelled,
      -- lifetime_appointments = visitas REALIZADAS (é o que alimenta novo/recorrente).
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
      stats.expected_revenue_centavos,
      stats.prev_total_appointments,
      stats.prev_total_cancelled,
      stats.prev_revenue_centavos,
      stats.prev_billable_appointments,
      -- Ticket médio por ATENDIMENTO realizado (a legenda dizia "por cliente", e dividia
      -- por agendamentos — errava a conta e o nome).
      CASE
        WHEN stats.billable_appointments > 0 THEN ROUND(stats.revenue_centavos / stats.billable_appointments)
        ELSE 0
      END AS ticket_medio_centavos,
      COALESCE(life.lifetime_appointments, 0) AS lifetime_appointments,
      COALESCE(life.lifetime_total, 0) AS lifetime_total,
      COALESCE(life.lifetime_cancelled, 0) AS lifetime_cancelled,
      COALESCE(life.total_spent_centavos, 0) AS total_spent_centavos,
      life.last_visit_at,
      -- Os dois lados em UTC. Antes era a data local do servidor contra um timestamp UTC.
      CASE
        WHEN life.last_visit_at IS NULL THEN NULL
        ELSE DATEDIFF(UTC_DATE(), DATE(life.last_visit_at))
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

const CRM_EXPORT_MAX_ROWS = 5000;
const CRM_CONTACTS_MAX = 500;

// Campos derivados de uma linha do CRM. Uma função só, para a lista, a exportação e a fila
// nunca discordarem sobre quem é "sumido" ou quem está "em risco".
function decorateCrmRow(row) {
  const totalAppointments = Number(row.total_appointments || 0);
  const totalCancelled = Number(row.total_cancelled || 0);
  const daysSinceLastVisit = row.days_since_last_visit == null ? null : Number(row.days_since_last_visit);

  return {
    relationship: classifyRelationship({
      totalAppointments: Number(row.lifetime_appointments || 0),
      daysSinceLastVisit,
      isVip: Boolean(row.is_vip),
    }),
    days_since_last_visit: daysSinceLastVisit,
    cancel_rate: totalAppointments
      ? Math.round((totalCancelled / Math.max(totalAppointments, 1)) * 100)
      : 0,
    is_at_risk: isAtRisk({
      daysSinceLastVisit,
      lifetimeTotal: Number(row.lifetime_total || 0),
      lifetimeCancelled: Number(row.lifetime_cancelled || 0),
    }),
    birthday: computeBirthdayInfo(row.data_nascimento),
  };
}

// Linhas do CRM já filtradas, sem paginação — para a exportação e para a fila de contatos.
// `ids` é a seleção manual da tela: restringe dentro do filtro, nunca o contorna.
async function fetchCrmRows(estabelecimentoId, filters, { ids = [], limit }) {
  const { baseSql, params: baseParams } = buildCrmBaseQuery(estabelecimentoId, filters);
  const outerFilters = buildCrmOuterFilters(filters);
  const orderColumn = CRM_SORT_COLUMNS[filters.sortKey] || CRM_SORT_COLUMNS.last;
  const orderDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const idClause = ids.length ? ` AND base.id IN (${ids.map(() => '?').join(', ')})` : '';

  const sql = `
    SELECT base.*
    FROM (${baseSql}) base
    WHERE ${outerFilters.whereClause}${idClause}
    ORDER BY ${orderColumn} ${orderDir}, base.nome ASC
    LIMIT ${Number(limit)}
  `;
  // Ordem dos '?': subqueries da derivada, WHERE externo, ids.
  const [rows] = await pool.query(sql, [...baseParams, ...outerFilters.params, ...ids]);
  return rows || [];
}

async function loadCrmTags(estabelecimentoId, clientIds = []) {
  if (!clientIds.length) return new Map();
  const placeholders = clientIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT cliente_id, tag
       FROM cliente_tags
      WHERE estabelecimento_id = ?
        AND cliente_id IN (${placeholders})
      ORDER BY tag ASC`,
    [estabelecimentoId, ...clientIds]
  );
  const map = new Map();
  (rows || []).forEach((row) => {
    const id = Number(row.cliente_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row.tag);
  });
  return map;
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

    // COUNT(*) aqui É o total da paginação — a query de count separada materializava a
    // derivada (cara) uma terceira vez para chegar ao mesmo número.
    const aggregationsSql = `
      SELECT
        COUNT(*) AS clients,
        -- A lista agora é vitalícia; este é o número que antes era "Clientes".
        SUM(CASE WHEN base.total_appointments > 0 THEN 1 ELSE 0 END) AS active_clients,
        SUM(CASE WHEN base.prev_total_appointments > 0 THEN 1 ELSE 0 END) AS prev_active_clients,
        COALESCE(SUM(base.total_appointments), 0) AS appointments,
        COALESCE(SUM(base.prev_total_appointments), 0) AS prev_appointments,
        COALESCE(SUM(base.total_cancelled), 0) AS cancelled,
        COALESCE(SUM(base.prev_total_cancelled), 0) AS prev_cancelled,
        COALESCE(SUM(base.revenue_centavos), 0) AS revenue_centavos,
        COALESCE(SUM(base.prev_revenue_centavos), 0) AS prev_revenue_centavos,
        COALESCE(SUM(base.expected_revenue_centavos), 0) AS expected_revenue_centavos,
        -- Atendimentos realizados no período. Antes era (agendamentos - cancelados), uma
        -- aproximação que contava pendente e futuro como atendimento.
        COALESCE(SUM(base.billable_appointments), 0) AS billable_appointments,
        COALESCE(SUM(base.prev_billable_appointments), 0) AS prev_billable_appointments,
        SUM(CASE WHEN ${buildCrmRiskSql('base')} THEN 1 ELSE 0 END) AS risk_clients
      FROM (${baseSql}) base
      WHERE ${outerFilters.whereClause}
    `;

    // Contagem por segmento SEM o filtro de segmento — senão, olhando "Sumidos", o chip
    // "Novos" mostraria 0. Os cinco predicados são exclusivos e exaustivos: somam o total.
    const segmentFilters = buildCrmOuterFilters(filters, { includeRelationship: false });
    const segmentsSql = `
      SELECT
        COUNT(*) AS total,
        ${['novo', 'recorrente', 'vip', 'sumido', 'inativo']
          .map((code) => `SUM(CASE WHEN ${buildCrmRelationshipSql(code, 'base')} THEN 1 ELSE 0 END) AS ${code}`)
          .join(',\n        ')}
      FROM (${baseSql}) base
      WHERE ${segmentFilters.whereClause}
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

    const [[aggregationRows], [segmentRows], [rows], [originRows]] = await Promise.all([
      pool.query(aggregationsSql, [...baseParams, ...outerFilters.params]),
      pool.query(segmentsSql, [...baseParams, ...segmentFilters.params]),
      pool.query(dataSql, [...baseParams, ...outerFilters.params, pageSize, offset]),
      pool.query(originsSql, [estabelecimentoId]),
    ]);

    const total = Number(aggregationRows?.[0]?.clients || 0);
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
      // Mesma decoração da exportação e da fila — e o is_at_risk vem da mesma função que
      // gera o SQL do KPI, então linha marcada e número contado não discordam.
      const extra = decorateCrmRow(row);
      const serviceLabel = serviceMap.get(Number(row.last_appointment_id)) || derived.last_service || '';
      const { last_appointment_id, ...rest } = row;
      return {
        ...rest,
        last_service: serviceLabel,
        avg_return_days: derived.avg_return_days ?? null,
        preferred_service: derived.preferred_service || null,
        preferred_professional: derived.preferred_professional || null,
        relationship_status: extra.relationship.code,
        relationship_label: extra.relationship.label,
        cancel_rate: extra.cancel_rate,
        is_at_risk: extra.is_at_risk,
        birthday: extra.birthday,
      };
    });

    const aggregationRow = aggregationRows?.[0] || {};
    const num = (value) => Number(value || 0);
    const ratePct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
    const ticket = (revenue, atendimentos) => (atendimentos ? Math.round(revenue / atendimentos) : 0);

    const aggregationAppointments = num(aggregationRow.appointments);
    const aggregationCancelled = num(aggregationRow.cancelled);
    const aggregationRevenue = num(aggregationRow.revenue_centavos);
    const aggregationBillable = num(aggregationRow.billable_appointments);

    const prevAppointments = num(aggregationRow.prev_appointments);
    const prevCancelled = num(aggregationRow.prev_cancelled);
    const prevRevenue = num(aggregationRow.prev_revenue_centavos);
    const prevBillable = num(aggregationRow.prev_billable_appointments);

    const aggregations = {
      period: filters.period,
      clients: num(aggregationRow.clients),
      active_clients: num(aggregationRow.active_clients),
      appointments: aggregationAppointments,
      cancelled: aggregationCancelled,
      cancel_rate: ratePct(aggregationCancelled, aggregationAppointments),
      revenue_centavos: aggregationRevenue,
      expected_revenue_centavos: num(aggregationRow.expected_revenue_centavos),
      ticket_medio_centavos: ticket(aggregationRevenue, aggregationBillable),
      risk_clients: num(aggregationRow.risk_clients),
      // Mesma régua, janela deslocada. Ausente quando period=all: não há "anterior" a "tudo".
      previous: filters.period === 'all' ? null : {
        active_clients: num(aggregationRow.prev_active_clients),
        appointments: prevAppointments,
        cancelled: prevCancelled,
        cancel_rate: ratePct(prevCancelled, prevAppointments),
        revenue_centavos: prevRevenue,
        ticket_medio_centavos: ticket(prevRevenue, prevBillable),
      },
    };

    const segmentRow = segmentRows?.[0] || {};
    const segments = {
      all: num(segmentRow.total),
      novo: num(segmentRow.novo),
      recorrente: num(segmentRow.recorrente),
      vip: num(segmentRow.vip),
      sumido: num(segmentRow.sumido),
      inativo: num(segmentRow.inativo),
    };

    return res.json({
      items,
      page,
      pageSize,
      total,
      hasNext: offset + (rows?.length || 0) < total,
      aggregations,
      segments,
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

// Exporta o recorte atual (ou a seleção da tela) em CSV. Registrado ANTES de
// /:id/clients/:clientId/* para "export.csv" não ser lido como um clientId.
router.get('/:id/clients/export.csv', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const filters = resolveCrmFilters(req.query || {});
    const ids = parsePositiveIdList(req.query.ids);
    const rows = await fetchCrmRows(estabelecimentoId, filters, { ids, limit: CRM_EXPORT_MAX_ROWS });
    const clientIds = rows.map((row) => Number(row.id)).filter(Boolean);
    const tagsMap = await loadCrmTags(estabelecimentoId, clientIds);

    // Extração em massa de dados pessoais de clientes: é leitura, mas é exatamente o evento que
    // uma auditoria de LGPD precisa conseguir reconstruir.
    setAudit(req, {
      acao: 'cliente.export_csv',
      entidade: 'cliente',
      estabelecimento_id: estabelecimentoId,
      metadados: { total_registros: rows.length, periodo: filters.period, filtro_ids: ids?.length || 0 },
    });

    const headers = [
      'Nome', 'Telefone', 'E-mail', 'Relacionamento', 'Última visita', 'Dias sem retorno',
      `Agendamentos (${filters.period})`, `Cancelamentos (${filters.period})`, '% Cancelamento',
      `Receita realizada (${filters.period})`, 'Total gasto', 'Ticket médio',
      'Em risco', 'Aniversário', 'Tags',
    ];

    const filenameBase = sanitizeFilenameSegment(`clientes-${filters.period}-${new Date().toISOString().slice(0, 10)}`);
    startCsvResponse(res, `${filenameBase || 'clientes'}.csv`, headers);

    rows.forEach((row) => {
      const extra = decorateCrmRow(row);
      const birthday = row.data_nascimento
        ? String(row.data_nascimento).slice(0, 10).split('-').reverse().join('/')
        : '';
      res.write(csvLine([
        row.nome || '',
        row.telefone || '',
        row.email || '',
        extra.relationship.label,
        row.last_visit_at ? new Date(row.last_visit_at).toISOString().slice(0, 10) : 'Nunca veio',
        extra.days_since_last_visit ?? '',
        Number(row.total_appointments || 0),
        Number(row.total_cancelled || 0),
        `${extra.cancel_rate}%`,
        formatCsvMoney(row.revenue_centavos),
        formatCsvMoney(row.total_spent_centavos),
        formatCsvMoney(row.ticket_medio_centavos),
        formatCsvBoolean(extra.is_at_risk),
        birthday,
        (tagsMap.get(Number(row.id)) || []).join(', '),
      ]));
    });

    return res.end();
  } catch (err) {
    console.error('GET /establishments/:id/clients/export.csv', err);
    if (!res.headersSent) return res.status(500).json({ error: 'clients_export_failed' });
    return res.end();
  }
});

// Contatos do recorte atual, para montar a fila de WhatsApp sem depender da paginação.
router.get('/:id/clients/contacts', auth, isEstabelecimento, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.params.id);
    if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const filters = resolveCrmFilters(req.query || {});
    const ids = parsePositiveIdList(req.query.ids);
    // Pede um a mais que o teto para saber se cortou — cortar em silêncio faria a campanha
    // parecer completa quando não está.
    const rows = await fetchCrmRows(estabelecimentoId, filters, { ids, limit: CRM_CONTACTS_MAX + 1 });
    const truncated = rows.length > CRM_CONTACTS_MAX;
    const page = truncated ? rows.slice(0, CRM_CONTACTS_MAX) : rows;

    return res.json({
      items: page.map((row) => {
        const extra = decorateCrmRow(row);
        return {
          id: Number(row.id),
          nome: row.nome,
          telefone: row.telefone || null,
          relationship_label: extra.relationship.label,
          days_since_last_visit: extra.days_since_last_visit,
          last_visit_at: toISODate(row.last_visit_at),
        };
      }),
      total: page.length,
      truncated,
      limit: CRM_CONTACTS_MAX,
    });
  } catch (err) {
    console.error('GET /establishments/:id/clients/contacts', err);
    return res.status(500).json({ error: 'clients_contacts_failed' });
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

    // O período saiu de buildCrmAppointmentFilterSql (lá ele escondia os sumidos); aqui,
    // onde o cliente já está fixado, ele volta explicitamente ao WHERE.
    const inPeriod = buildCrmPeriodSql(periodFilter.period === 'all' ? null : periodFilter.periodDays);
    const metricsSql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(a.status='cancelado') AS total_cancelled,
        COALESCE(SUM(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN a.total_centavos ELSE 0 END), 0) AS revenue_centavos,
        COALESCE(SUM(CASE WHEN ${CRM_EXPECTED_REVENUE_SQL} THEN a.total_centavos ELSE 0 END), 0) AS expected_revenue_centavos,
        COUNT(CASE WHEN ${CRM_REALIZED_VISIT_SQL} THEN 1 END) AS billable_appointments
      FROM agendamentos a
      WHERE ${periodAppointmentFilters.whereClause}
        AND a.cliente_id = ?
        AND ${inPeriod}
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
        expected_revenue_centavos: Number(periodMetrics.expected_revenue_centavos || 0),
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



// Slugs reservados: o link público vive na raiz (agenda0.com.br/<slug>), então um slug igual
// a uma rota do app (ex.: "login") ou a um caminho de infra (ex.: "api") sequestraria a rota.
const RESERVED_SLUGS = new Set([
  // rotas do app
  'admin-tools', 'agenda-nova', 'agendar', 'ajuda', 'assinatura', 'cadastro', 'cliente', 'clientes',
  'configuracao-inicial', 'configuracoes', 'contato', 'definir-senha', 'divulgacao', 'estab',
  'financeiro', 'implantacao', 'link-phone', 'loading', 'login', 'login-cliente',
  'login-estabelecimento', 'novo', 'novo-agendamento', 'planos', 'politica-privacidade',
  'profissionais', 'recuperar-senha', 'relatorios', 'servicos', 'sinal', 'termos', 'whatsappbusiness',
  // infra e reservas futuras
  'api', 'admin', 'app', 'assets', 'auth', 'blog', 'checkout', 'conta', 'dashboard', 'favicon',
  'health', 'index', 'pagamento', 'pagamentos', 'painel', 'perfil', 'privacidade', 'public',
  'robots', 'sitemap', 'sobre', 'static', 'suporte', 'uploads', 'webhook', 'webhooks', 'www',
]);

// Atualizar slug do estabelecimento

router.put('/:id/slug', auth, isEstabelecimento, async (req, res) => {

  try {

    const id = Number(req.params.id);

    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });

    const slugRaw = String(req.body?.slug || '').trim().toLowerCase();

    if (!/^([a-z0-9]+(?:-[a-z0-9]+)*)$/.test(slugRaw) || slugRaw.length < 3 || slugRaw.length > 160) {

      return res.status(400).json({ error: 'invalid_slug', message: 'Use apenas letras, números e hífens. Mínimo 3, máximo 160 caracteres.' });

    }

    if (RESERVED_SLUGS.has(slugRaw)) {
      return res.status(409).json({ error: 'slug_reserved', message: 'Esse link é reservado pelo sistema. Escolha outro.' });
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

      return res.status(400).json({ error: 'invalid_plan', message: 'Plano inválido.' });

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
        return res.status(400).json({ error: 'invalid_status', message: 'Status de plano inválido.' });
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
      return res.status(400).json({ error: 'trial_already_used', message: 'O teste grátis já foi usado nesta conta.' });
    }

    let planTrialEndsAt = context.trialEndsAt;

    if (trialActive) {
      // Mantem o trial atual sem renovacao/extensao
      planStatus = 'trialing';
      planTrialEndsAt = context.trialEndsAt;
    } else if (req.body?.trialEndsAt) {
      const parsed = new Date(req.body.trialEndsAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_trial', message: 'Valor inválido para trialEndsAt.' });
      }
      planTrialEndsAt = parsed;
    } else if (req.body?.trialDays) {
      let days = Number(req.body.trialDays);
      if (!Number.isFinite(days) || days <= 0) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialDays deve ser um número positivo.' });
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

        return res.status(400).json({ error: 'invalid_active_until', message: 'Valor inválido para activeUntil.' });

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

    setAudit(req, {
      acao: 'plano.alterar',
      entidade: 'plano',
      entidade_id: id,
      estabelecimento_id: id,
      dados_antes: { plan: currentPlan, status: currentStatus },
      dados_depois: { plan: updatedContext.plan, status: updatedContext.status },
    });



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

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });

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

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });

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

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });

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

      return res.status(400).json({ error: 'invalid_estabelecimento', message: 'Identificador inválido.' });

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

        return res.status(400).json({ error: 'gallery_image_large', message: 'A imagem deve ter no máximo 3MB.' });

      }

      if (err?.code === 'GALLERY_IMAGE_INVALID') {

        return res.status(400).json({ error: 'gallery_image_invalid', message: 'Envie PNG, JPG ou WEBP válidos.' });

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

      return res.status(400).json({ error: 'invalid_image', message: 'Imagem inválida.' });

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














