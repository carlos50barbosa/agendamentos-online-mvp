// backend/src/routes/estabelecimentos.js

import { Router } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db.js";
import { resolveEstablishmentCoordinates } from "../lib/geocode.js";
import {
saveEstablishmentImageFromDataUrl, removeEstablishmentImageFile, } from "../lib/establishment_images.js";
import { auth, isEstabelecimento, isCliente } from "../middleware/auth.js";
import {
PLAN_TIERS, PLAN_STATUS, getPlanContext, resolvePlanConfig, countProfessionals, formatPlanLimitExceeded, isDelinquentStatus, serializePlanContext, isDowngrade, } from "../lib/plans.js";
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
text = text .split('\n') .map((line) => line.trim()) .filter(Boolean) .join('\n');
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
const WEEKDAY_TOKEN_MAP = Object.freeze({
monday: ['segunda', 'segunda-feira', 'seg', 'mon', 'monday'], tuesday: ['terca', 'terca-feira', 'ter', 'tue', 'tuesday'], wednesday: ['quarta', 'quarta-feira', 'qua', 'wed', 'wednesday'], thursday: ['quinta', 'quinta-feira', 'qui', 'thu', 'thursday'], friday: ['sexta', 'sexta-feira', 'sex', 'fri', 'friday'], saturday: ['sabado', 'sabado-feira', 'sab', 'sat', 'saturday'], sunday: ['domingo', 'domingo-feira', 'dom', 'sun', 'sunday'], });
const WEEKDAY_LABEL_MAP = Object.freeze({
monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta', thursday: 'Quinta', friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo', });
const WEEKDAY_SLUGS = Object.keys(WEEKDAY_TOKEN_MAP);
function normalizeString(value) {
if (!value) return '';
return String(value) .normalize('NFD') .replace(/[\u0300-\u036f]/g, '') .toLowerCase() .replace(/[^a-z0-9]+/g, '');
}

const CLIENT_TAG_ALIASES = Object.freeze({
vip: 'VIP', promocao: 'Promoção', promo: 'Promoção', atrasos: 'Atrasos', atraso: 'Atrasos', });
function normalizeClientTags(input) {
if (!Array.isArray(input)) return [];
const normalized = new Set();
for (const raw of input) {
if (raw == null) continue;
const trimmed = String(raw).trim();
if (!trimmed) continue;
const key = normalizeString(trimmed);
const mapped = CLIENT_TAG_ALIASES[key];
if (!mapped) continue;
normalized.add(mapped);
}
  return Array.from(normalized);
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
const minutes = directMatch[2]  '00';
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
if ( !Number.isInteger(hoursNum) || hoursNum < 0 || hoursNum > 23 || !Number.isInteger(minutesNum) || minutesNum < 0 || minutesNum > 59 ) {
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
const label = String(item.label || item.day || item.dia  '').trim();
let valueText = String( item.value || item.horario || item.horarios || item.hours || item.text  ''
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
      const startLike = item.start || item.begin || item.from ?? null;
const endLike = item.end || item.finish || item.to ?? null;
if (startLike != null) normalizedEntry.start = startLike;
if (endLike != null) normalizedEntry.end = endLike;

      // Preserve block/break metadata.
      const blocks = Array.isArray(item.blocks) && item.blocks.length ? item.blocks : Array.isArray(item.breaks) && item.breaks.length ? item.breaks : null;
if (blocks) {
normalizedEntry.blocks = blocks;
}
      if (Array.isArray(item.breaks) && item.breaks.length) {
normalizedEntry.breaks = item.breaks;
}
      const blockStart = item.block_start || item.blockStart ?? null;
const blockEnd = item.block_end || item.blockEnd ?? null;
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
const daySlug = normalizeDaySlug(entry.day || entry.key || entry.weekday || entry.week_day || label) || '';
const defaultLabel = daySlug || (WEEKDAY_LABEL_MAP[daySlug] || '') : '';
label = label ? label.slice(0, 60) : defaultLabel.slice(0, 60);
if (!label && !value) continue;
value = value ? value.slice(0, 160) : label;
if (!value) continue;
let start = sanitizeTimeValue(entry.start || entry.begin || entry.from ?? null);
let end = sanitizeTimeValue(entry.end || entry.finish || entry.to ?? null);
if (start && end && start > end) {
const temp = start;
start = end;
end = temp;
}
    const sanitizedEntry = { label, value };
if (daySlug) sanitizedEntry.day = daySlug;
if (start) sanitizedEntry.start = start;
if (end) sanitizedEntry.end = end;
const rawBlocks = Array.isArray(entry.blocks) ? entry.blocks : Array.isArray(entry.breaks) ? entry.breaks : entry.block_start || entry.blockStart || entry.block_end || entry.blockEnd || [{
start: entry.block_start || entry.blockStart ?? null, end: entry.block_end || entry.blockEnd ?? null, }] ? : [];
const sanitizedBlocks = [];
for (const block of rawBlocks) {
if (!block) continue;
const blockStart = sanitizeTimeValue(block.start || block.begin || block.from ?? null);
const blockEnd = sanitizeTimeValue(block.end || block.finish || block.to ?? null);
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
} return sanitized.length || JSON.stringify(sanitized) : null;
}

function buildProfileUpdatePayload(body = {}) {
const errors = [];
const sobre = sanitizePlainText(body.sobre, { maxLength: 1200, allowNewLines: true });
const contato_telefone = body.contato_telefone != null ? sanitizePhone(body.contato_telefone) : null;
if (body.contato_telefone && !contato_telefone) {
errors.push({ field: 'contato_telefone', code: 'invalid_phone' });
} const site_url = body.site_url != null || sanitizeUrl(body.site_url) : null;
if (body.site_url && !site_url) {
errors.push({ field: 'site_url', code: 'invalid_url' });
} const instagram_url = body.instagram_url != null || sanitizeUrl(body.instagram_url) : null;
if (body.instagram_url && !instagram_url) {
errors.push({ field: 'instagram_url', code: 'invalid_url' });
} const facebook_url = body.facebook_url != null || sanitizeUrl(body.facebook_url) : null;
if (body.facebook_url && !facebook_url) {
errors.push({ field: 'facebook_url', code: 'invalid_url' });
} const linkedin_url = body.linkedin_url != null || sanitizeUrl(body.linkedin_url) : null;
if (body.linkedin_url && !linkedin_url) {
errors.push({ field: 'linkedin_url', code: 'invalid_url' });
} const youtube_url = body.youtube_url != null || sanitizeUrl(body.youtube_url) : null;
if (body.youtube_url && !youtube_url) {
errors.push({ field: 'youtube_url', code: 'invalid_url' });
} const tiktok_url = body.tiktok_url != null || sanitizeUrl(body.tiktok_url) : null;
if (body.tiktok_url && !tiktok_url) {
errors.push({ field: 'tiktok_url', code: 'invalid_url' });
}

  const horariosInput = body.horarios ? || body.horarios_json ? || body.horarios_raw ? || (typeof body.horarios_text === 'string'  body.horarios_text : null);
const horarios_json = sanitizeHorariosInput(horariosInput);
return {
values: {
sobre, contato_telefone, site_url, instagram_url, facebook_url, linkedin_url, youtube_url, tiktok_url, horarios_json, }, errors, };
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

      "SELECT id, nome, tipo, email FROM usuarios WHERE id= LIMIT 1", [userId] );
const row = rows?.[0];
if (!row) return null;
return {
id: row.id, nome: row.nome, tipo: row.tipo || 'cliente', email: row.email || null, };
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
return parsed .map((item) => {
if (!item) return null;
if (typeof item === 'string') {
const text = item.trim();
if (!text) return null;
return { label: '', value: text };
}

          if (typeof item === 'object') {
const label = String(item.label || item.day || item.dia  '').trim();
const valueText = String(item.value || item.horario || item.horarios || item.hours  '').trim();
if (!label && !valueText) return null;
const daySlug = normalizeDaySlug( item.day || item.key || item.weekday || item.week_day || label );
let resolvedLabel = label;
if (!resolvedLabel && daySlug && WEEKDAY_LABEL_MAP[daySlug]) {
resolvedLabel = WEEKDAY_LABEL_MAP[daySlug];
}
            let start = sanitizeTimeValue(item.start || item.begin || item.from ?? null);
let end = sanitizeTimeValue(item.end || item.finish || item.to ?? null);
if (start && end && start > end) {
const temp = start;
start = end;
end = temp;
}
            const rawBlocks = Array.isArray(item.blocks) ? item.blocks : Array.isArray(item.breaks) ? item.breaks : item.block_start || item.blockStart || item.block_end || item.blockEnd || [{
start: item.block_start || item.blockStart ?? null, end: item.block_end || item.blockEnd ?? null, }] ? : [];
const sanitizedBlocks = [];
for (const block of rawBlocks) {
if (!block) continue;
const blockStart = sanitizeTimeValue(block.start || block.begin || block.from ?? null);
const blockEnd = sanitizeTimeValue(block.end || block.finish || block.to ?? null);
if (!blockStart || !blockEnd) continue;
if (blockStart >= blockEnd) continue;
if (start && blockStart < start) continue;
if (end && blockEnd > end) continue;
sanitizedBlocks.push({ start: blockStart, end: blockEnd });
if (sanitizedBlocks.length >= 3) break;
}
            const result = {
label: resolvedLabel, value: valueText || resolvedLabel, day: daySlug || null, start: start || null, end: end || null, };
if (sanitizedBlocks.length) {
result.blocks = sanitizedBlocks;
result.breaks = sanitizedBlocks;
}
            return result;
}
          return null;
}) .filter(Boolean);
}
    if (parsed && typeof parsed === 'object') {
return Object.entries(parsed) .map(([key, val]) => {
const label = String(key || '').trim();
const valueText = String(val  '').trim();
if (!label && !valueText) return null;
return { label, value: valueText || label, day: normalizeDaySlug(label) || null, start: null, end: null };
}) .filter(Boolean);
}
  } catch (err) {
    // fallback
  }
const lines = raw .split(/\r?\n/) .map((line) => line.trim()) .filter(Boolean);
return lines.map((line) => {
const parts = line.split(/[:\-]/);
if (parts.length >= 2) {
const [label, ...rest] = parts;
const valueText = rest.join(' - ').trim();
return {
label: label.trim(), value: valueText || line, };
} return { label : '', value: line };
});
}



function normalizeProfile(establishmentRow, profileRow) {
const fallbackPhone = establishmentRow?.telefone || null;
if (!profileRow) {
return {
sobre: null, contato_telefone: fallbackPhone, site_url: null, instagram_url: null, facebook_url: null, linkedin_url: null, youtube_url: null, tiktok_url: null, horarios: [], horarios_raw: null, updated_at: null, };
} const updatedAt = profileRow.updated_at || new Date(profileRow.updated_at) : null;
return {
sobre: profileRow.sobre || null, contato_telefone: profileRow.contato_telefone || fallbackPhone, site_url: profileRow.site_url || null, instagram_url: profileRow.instagram_url || null, facebook_url: profileRow.facebook_url || null, linkedin_url: profileRow.linkedin_url || null, youtube_url: profileRow.youtube_url || null, tiktok_url: profileRow.tiktok_url || null, horarios: parseHorarios(profileRow.horarios_json), horarios_raw: profileRow.horarios_json || null, updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null, };
}

function normalizeGalleryImage(row) {
if (!row) return null;
return {
id: row.id, estabelecimento_id: row.estabelecimento_id, url: row.file_path, titulo: row.titulo || null, descricao: row.descricao || null, ordem: Number.isFinite(row.ordem) ? Number(row.ordem) : 0, created_at: row.created_at ? new Date(row.created_at).toISOString() : null, };
}

async function fetchGalleryImages(estabelecimentoId) {
const [rows] = await pool.query(
    `SELECT id, estabelecimento_id, file_path, titulo, descricao, ordem, created_at
     FROM estabelecimento_imagens
     WHERE estabelecimento_id=?
     ORDER BY ordem ASC, id ASC`, [estabelecimentoId] );
return rows.map(normalizeGalleryImage);
}

async function countGalleryImages(estabelecimentoId) {
const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM estabelecimento_imagens WHERE estabelecimento_id=?', [estabelecimentoId] );
return Number(row?.total || 0);
}

async function resolveNextGalleryOrder(estabelecimentoId) {
const [[row]] = await pool.query(
    'SELECT COALESCE(MAX(ordem), 0) AS max_ordem FROM estabelecimento_imagens WHERE estabelecimento_id=?', [estabelecimentoId] );
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

    "SELECT AVG(nota) AS media, COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id=?", [estabelecimentoId] );
const [distRows] = await pool.query(

    "SELECT nota, COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id= GROUP BY nota", [estabelecimentoId] );
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

  } return { average, count : total, distribution };
}



async function fetchUserReview(estabelecimentoId, clienteId) {
const [rows] = await pool.query(

    "SELECT nota, comentario, updated_at FROM estabelecimento_reviews WHERE estabelecimento_id= AND cliente_id= LIMIT 1", [estabelecimentoId, clienteId] );
const row = rows?.[0];
if (!row) return null;
const nota = Number(row.nota);
const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
return {
nota: Number.isFinite(nota) ? nota : null, comentario: row.comentario || null, updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null, };
}



async function isFavoriteFor(estabelecimentoId, clienteId) {
const [rows] = await pool.query(

    "SELECT 1 FROM cliente_favoritos WHERE estabelecimento_id= AND cliente_id= LIMIT 1", [estabelecimentoId, clienteId] );
return Boolean(rows && rows.length);
}



async function ensureEstabelecimento(estabelecimentoId) {
const id = Number(estabelecimentoId);
if (!Number.isFinite(id)) return null;
const [rows] = await pool.query(

    "SELECT id, nome, email, telefone FROM usuarios WHERE id= AND tipo='estabelecimento' LIMIT 1", [id] );
return rows?.[0] || null;
}



async function attachCoordinates(rows, includeCoords) {
if (!includeCoords) return rows;
const enriched = [];
for (const est of rows) {
const lat = toFiniteOrNull(est?.latitude || est?.lat || est?.coord_lat);
const lng = toFiniteOrNull(est?.longitude || est?.lng || est?.coord_lng);
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
...est, latitude: coords?.lat ?? null, longitude: coords?.lng ?? null, });
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
const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
const offset = (page - 1) * limit;
const where = ["u.tipo = 'estabelecimento'"];
const params = [];
if (idsRaw) {
const ids = idsRaw .split(',') .map((id) => Number(id)) .filter((id) => Number.isFinite(id)) .slice(0, 50);
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
          '(LOWER(u.nome) LIKE  OR LOWER(u.bairro) LIKE  OR LOWER(u.cidade) LIKE  OR LOWER(u.estado) LIKE  OR LOWER(u.cep) LIKE  OR LOWER(u.endereco) LIKE  OR LOWER(u.numero) LIKE  OR LOWER(u.email) LIKE ?)'
        );
params.push(like, like, like, like, like, like, like, like);
});
}

    const whereSql = `WHERE ${where.join(' AND ')}`;
const sql = `${LIST_SELECT} ${whereSql} ${LIST_ORDER} LIMIT  OFFSET ?`;
const [rows] = await pool.query(sql, [...params, limit + 1, offset]);
const hasMore = rows.length > limit;
const pageRows = rows.slice(0, limit);
const includeCoords = String((req.query?.coords  '1')).toLowerCase() !== '0';
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

        "SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id= AND tipo='estabelecimento' LIMIT 1", [id] );
} else {
[rows] = await pool.query(

        "SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE slug= AND tipo='estabelecimento' LIMIT 1", [idOrSlug] );
} if (!rows.length) return res.status(404).json({ error : 'not_found' });
const est = rows[0];
const viewer = await resolveViewerFromRequest(req);
const [planContext, profileResult, rating, galleryImages] = await Promise.all([ getPlanContext(est.id), pool.query(

        "SELECT estabelecimento_id, sobre, contato_telefone, site_url, instagram_url, facebook_url, linkedin_url, youtube_url, tiktok_url, horarios_json, updated_at FROM estabelecimento_perfis WHERE estabelecimento_id= LIMIT 1", [est.id] ), getRatingSummary(est.id), fetchGalleryImages(est.id), ]);
const [profileRows] = profileResult;
const profileRow = profileRows?.[0] || null;
let userReview = null;
let isFavorite = false;
if (viewer?.tipo === 'cliente') {
const [review, favorite] = await Promise.all([ fetchUserReview(est.id, viewer.id), isFavoriteFor(est.id, viewer.id), ]);
userReview = review;
isFavorite = favorite;
}



    const payload = {
...est, plan_context: serializePlanContext(planContext), profile: normalizeProfile(est, profileRow), rating, user_review: userReview, is_favorite: isFavorite, gallery: galleryImages, gallery_limit: resolveGalleryLimit(planContext), };
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
const limitParam = Number(req.query?.limit || req.query?.per_page);
const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
const perPageRaw = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 10;
const perPage = Math.max(1, Math.min(perPageRaw, 50));
const offset = (page - 1) * perPage;
const [[countRow]] = await pool.query(
      'SELECT COUNT(*) AS total FROM estabelecimento_reviews WHERE estabelecimento_id=?', [estabelecimentoId] );
const total = Number(countRow?.total || 0);
const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
const [rows] = await pool.query(
      `SELECT r.id, r.nota, r.comentario, r.created_at, r.updated_at,
              r.cliente_id, u.nome AS cliente_nome, u.avatar_url
         FROM estabelecimento_reviews r
         JOIN usuarios u ON u.id = r.cliente_id
        WHERE r.estabelecimento_id=?
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT  OFFSET ?`, [estabelecimentoId, perPage, offset] );
const items = rows.map((row) => {
const commentRaw = typeof row.comentario === 'string'  row.comentario.trim() : null;
const comment = commentRaw ? commentRaw : null;
const nota = Number(row.nota);
return {
id: row.id, nota: Number.isFinite(nota) ? nota : null, comentario: comment, created_at: toISODate(row.created_at), updated_at: toISODate(row.updated_at), author: {
id: row.cliente_id, name: reviewerDisplayName(row.cliente_nome), full_name: String(row.cliente_nome || '').trim() || null, initials: reviewerInitials(row.cliente_nome), avatar_url: row.avatar_url || null, }, };
});
return res.json({
items, pagination: {
page, per_page: perPage, total, total_pages: totalPages, has_next: offset + items.length < total, has_prev: page > 1, }, });
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
         youtube_url, tiktok_url, horarios_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sobre=VALUES(sobre),
         contato_telefone=VALUES(contato_telefone),
         site_url=VALUES(site_url),
         instagram_url=VALUES(instagram_url),
         facebook_url=VALUES(facebook_url),
         linkedin_url=VALUES(linkedin_url),
         youtube_url=VALUES(youtube_url),
         tiktok_url=VALUES(tiktok_url),
         horarios_json=VALUES(horarios_json)`, [
        estabelecimentoId, values.sobre, values.contato_telefone, values.site_url, values.instagram_url, values.facebook_url, values.linkedin_url, values.youtube_url, values.tiktok_url, values.horarios_json, ]
    );
const [profileRows] = await pool.query(
      `SELECT estabelecimento_id, sobre, contato_telefone,
              site_url, instagram_url, facebook_url, linkedin_url,
              youtube_url, tiktok_url, horarios_json, updated_at
         FROM estabelecimento_perfis
        WHERE estabelecimento_id= LIMIT 1`, [estabelecimentoId] );
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
const searchRaw = String(req.query.q || '').trim().toLowerCase();
const searchDigits = searchRaw.replace(/\D/g, '');
const statusParam = String(req.query.status || '').trim().toLowerCase();
const statusTokens = statusParam || statusParam.split(',').map((token) => token.trim()).filter(Boolean) ? : [];
const statusMap = {
confirmado: ['confirmado'], cancelado: ['cancelado'], pendente: ['pendente', 'pendente_pagamento'], concluido: ['concluido'], };
const allowedStatuses = new Set([
      'confirmado',
      'cancelado',
      'pendente',
      'pendente_pagamento',
      'concluido', ]);
const statusValues = Array.from( new Set( statusTokens.flatMap((token) => statusMap[token] || (allowedStatuses.has(token) ? [token] : [])) )
    );
const vipOnly = ['1', 'true', 'sim', 'yes', 'on'].includes(String(req.query.vip || '').toLowerCase());
const riskOnly = ['1', 'true', 'sim', 'yes', 'on'].includes(String(req.query.risk || '').toLowerCase());
const riskDaysRaw = Number(req.query.riskDays || req.query.risk_days || 60);
const riskDays = Number.isFinite(riskDaysRaw) ? Math.min(3650, Math.max(1, Math.round(riskDaysRaw))) : 60;
const sortParam = String(req.query.sort || '').trim().toLowerCase();
const dirParam = String(req.query.dir || '').trim().toLowerCase();
const sortDir = dirParam === 'asc'  'ASC' : 'DESC';
const sortMap = {
last: 'stats.last_appointment_at', appointments: 'stats.total_appointments', cancelled: 'stats.total_cancelled', name: 'u.nome', };
const sortKey = sortMap[sortParam] || sortMap.last;
const orderBy = `${sortKey} ${sortDir}, u.nome ASC`;
const riskExpr =
      `(stats.last_appointment_at < DATE_SUB(NOW(), INTERVAL ${riskDays} DAY)` +
      ` OR (stats.total_appointments >= 3 AND (stats.total_cancelled / NULLIF(stats.total_appointments, 0)) > 0.4))`;
const searchClauses = [];
const searchParams = [];
if (searchRaw) {
const like = `%${searchRaw}%`;
const telLike = `%${searchDigits || searchRaw.replace(/\s+/g, '')}%`;
searchClauses.push(`(LOWER(u.nome) LIKE  OR LOWER(u.email) LIKE  OR REPLACE(REPLACE(REPLACE(u.telefone,'+',''),'-',''),' ','') LIKE ?)`);
searchParams.push(like, like, telLike);
}
    const whereClauses = [...searchClauses];
const whereParams = [...searchParams];
if (statusValues.length) {
const placeholders = statusValues.map(() => '?').join(', ');
whereClauses.push(`stats.last_status IN (${placeholders})`);
whereParams.push(...statusValues);
}
    if (vipOnly) whereClauses.push('vip.is_vip = 1');
if (riskOnly) whereClauses.push(riskExpr);
const whereSql = whereClauses.length  `WHERE ${whereClauses.join(' AND ')}` : '';
const statsSql = `
      SELECT
        a.cliente_id,
        COUNT(*) AS total_appointments,
        SUM(a.status='cancelado') AS total_cancelled,
        MAX(a.inicio) AS last_appointment_at,
        SUBSTRING_INDEX(GROUP_CONCAT(a.status ORDER BY a.inicio DESC SEPARATOR ','), ',', 1) AS last_status,
        SUBSTRING_INDEX(GROUP_CONCAT(a.id ORDER BY a.inicio DESC SEPARATOR ','), ',', 1) AS last_appointment_id
      FROM agendamentos a
      WHERE a.estabelecimento_id=?
      GROUP BY a.cliente_id
    `;
const vipJoinSql = `
      LEFT JOIN (
        SELECT DISTINCT cliente_id, 1 AS is_vip
        FROM cliente_tags
        WHERE estabelecimento_id= AND tag='VIP'
      ) vip ON vip.cliente_id = stats.cliente_id
    `;
const countSql = `
      SELECT COUNT(*) AS total
      FROM (${statsSql}) stats
      JOIN usuarios u ON u.id = stats.cliente_id
      ${vipJoinSql}
      ${whereSql}
    `;
const countParams = [estabelecimentoId, estabelecimentoId, ...whereParams];
const [countRows] = await pool.query(countSql, countParams);
const total = Number(countRows?.[0]?.total || 0);
const dataSql = `
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
        IFNULL(vip.is_vip, 0) AS is_vip,
        CASE WHEN ${riskExpr} THEN 1 ELSE 0 END AS is_at_risk
      FROM (${statsSql}) stats
      JOIN usuarios u ON u.id = stats.cliente_id
      ${vipJoinSql}
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT  OFFSET ?
    `;
const dataParams = [...countParams, pageSize, offset];
const [rows] = await pool.query(dataSql, dataParams);
const lastAppointmentIds = Array.from( new Set( (rows || []) .map((row) => Number(row.last_appointment_id)) .filter((id) => Number.isFinite(id) && id > 0) )
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
          GROUP BY a.id, s0.nome`, lastAppointmentIds );
serviceMap = new Map( (serviceRows || []).map((row) => [Number(row.agendamento_id), row.service_label || '']) );
}
    const items = (rows || []).map((row) => {
const serviceLabel = serviceMap.get(Number(row.last_appointment_id)) || '';
const { last_appointment_id, ...rest } = row;
return { ...rest, last_service: serviceLabel };
});
const periodParam = String(req.query.period || '').trim().toLowerCase();
const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const periodDays = PERIOD_DAYS[periodParam] || null;
const periodStart = periodDays ? new Date(Date.now() - periodDays * 86400000) : null;
const periodFilterSql = periodStart  'a.inicio >= ?' : '1=1';
const kpiSql = `
      SELECT
        COUNT(DISTINCT CASE WHEN ${periodFilterSql} THEN a.cliente_id END) AS clients,
        SUM(CASE WHEN ${periodFilterSql} THEN 1 ELSE 0 END) AS appointments,
        SUM(CASE WHEN ${periodFilterSql} AND a.status='cancelado' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN ${periodFilterSql} AND a.status<>'cancelado' THEN a.total_centavos ELSE 0 END) AS revenue_centavos,
        SUM(CASE WHEN ${periodFilterSql} AND a.status<>'cancelado' THEN 1 ELSE 0 END) AS ticket_base
      FROM agendamentos a
      WHERE a.estabelecimento_id=?
    `;
const kpiParams = [];
if (periodStart) {
for (let i = 0; i < 5; i += 1) kpiParams.push(periodStart);
}
    kpiParams.push(estabelecimentoId);
const [[kpiRow]] = await pool.query(kpiSql, kpiParams);
const appointments = Number(kpiRow?.appointments || 0);
const cancelled = Number(kpiRow?.cancelled || 0);
const revenueCentavos = Number(kpiRow?.revenue_centavos || 0);
const ticketBase = Number(kpiRow?.ticket_base || 0);
return res.json({
items, page, pageSize, total, hasNext: offset + (rows?.length || 0) < total, aggregations: {
period: periodDays ? periodParam : 'all', clients: Number(kpiRow?.clients || 0), appointments, cancelled, cancel_rate: appointments ? Math.round((cancelled / appointments) * 100) : 0, revenue_centavos: revenueCentavos, ticket_medio_centavos: ticketBase ? Math.round(revenueCentavos / Math.max(ticketBase, 1)) : null, }, });
} catch (err) {
console.error('GET /establishments/:id/clients', err);
return res.status(500).json({ error: 'clients_fetch_failed' });
}
});

// Detalhes do cliente (drawer CRM)
router.get('/:id/clients/:clientId/details', auth, isEstabelecimento, async (req, res) => {
try {
const estabelecimentoId = Number(req.params.id);
const clientId = Number(req.params.clientId);
if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
return res.status(403).json({ error: 'forbidden' });
}
    if (!Number.isFinite(clientId)) {
return res.status(400).json({ error: 'invalid_client' });
}

    const [[clientRow]] = await pool.query(
      `SELECT u.id, u.nome, u.email, u.telefone, u.data_nascimento,
              u.cep, u.endereco, u.numero, u.complemento, u.bairro, u.cidade, u.estado
         FROM usuarios u
         JOIN agendamentos a ON a.cliente_id = u.id AND a.estabelecimento_id = ?
        WHERE u.id = ?
        LIMIT 1`, [estabelecimentoId, clientId] );
if (!clientRow) {
return res.status(404).json({ error: 'not_found' });
}

    const [[notesRow]] = await pool.query(
      'SELECT notas FROM cliente_notas WHERE estabelecimento_id= AND cliente_id= LIMIT 1', [estabelecimentoId, clientId] );
const [tagRows] = await pool.query(
      'SELECT tag FROM cliente_tags WHERE estabelecimento_id= AND cliente_id= ORDER BY tag ASC', [estabelecimentoId, clientId] );
const tags = (tagRows || []).map((row) => row.tag).filter(Boolean);
const periodParam = String(req.query.period || '').trim().toLowerCase();
const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const periodDays = PERIOD_DAYS[periodParam] || null;
const periodStart = periodDays ? new Date(Date.now() - periodDays * 86400000) : null;
const periodFilterSql = periodStart  'a.inicio >= ?' : '1=1';
const metricsSql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(a.status='cancelado') AS total_cancelled,
        SUM(CASE WHEN ${periodFilterSql} THEN 1 ELSE 0 END) AS period_appointments,
        SUM(CASE WHEN ${periodFilterSql} AND a.status='cancelado' THEN 1 ELSE 0 END) AS period_cancelled,
        SUM(CASE WHEN ${periodFilterSql} AND a.status<>'cancelado' THEN a.total_centavos ELSE 0 END) AS period_revenue_centavos,
        SUM(CASE WHEN ${periodFilterSql} AND a.status<>'cancelado' THEN 1 ELSE 0 END) AS period_ticket_base
      FROM agendamentos a
      WHERE a.estabelecimento_id= AND a.cliente_id=?
    `;
const metricsParams = [];
if (periodStart) {
for (let i = 0; i < 4; i += 1) metricsParams.push(periodStart);
}
    metricsParams.push(estabelecimentoId, clientId);
const [[metricsRow]] = await pool.query(metricsSql, metricsParams);
const historyLimit = Math.min(20, Math.max(10, Number(req.query.limit || 20)));
const historySql = `
      SELECT
        a.id,
        a.inicio,
        a.fim,
        a.status,
        a.total_centavos,
        p.nome AS profissional_nome,
        COALESCE(NULLIF(GROUP_CONCAT(s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS service_label
      FROM agendamentos a
      LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ai.servico_id
      LEFT JOIN servicos s0 ON s0.id = a.servico_id
      LEFT JOIN profissionais p ON p.id = a.profissional_id
      WHERE a.estabelecimento_id= AND a.cliente_id=?
      GROUP BY a.id, s0.nome, p.nome
      ORDER BY a.inicio DESC
      LIMIT ?
    `;
const [historyRows] = await pool.query(historySql, [estabelecimentoId, clientId, historyLimit]);
const history = (historyRows || []).map((row) => ({
id: row.id, inicio: row.inicio, fim: row.fim, status: row.status, total_centavos: Number(row.total_centavos || 0), profissional: row.profissional_nome || null, servico: row.service_label || null, }));
const frequencySql = `
      SELECT
        COALESCE(s.nome, s0.nome) AS service_label,
        COUNT(*) AS total
      FROM agendamentos a
      LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ai.servico_id
      LEFT JOIN servicos s0 ON s0.id = a.servico_id
      WHERE a.estabelecimento_id= AND a.cliente_id=?
      ${periodStart  'AND a.inicio >= ?' : ''}
      GROUP BY service_label
      ORDER BY total DESC, service_label ASC
      LIMIT 3
    `;
const frequencyParams = periodStart ? [estabelecimentoId, clientId, periodStart] : [estabelecimentoId, clientId];
const [frequencyRows] = await pool.query(frequencySql, frequencyParams);
const frequent_services = (frequencyRows || []) .map((row) => ({
nome: row.service_label || null, total: Number(row.total || 0), })) .filter((row) => row.nome);
const totalAppointments = Number(metricsRow?.total_appointments || 0);
const totalCancelled = Number(metricsRow?.total_cancelled || 0);
const periodAppointments = Number(metricsRow?.period_appointments || 0);
const periodCancelled = Number(metricsRow?.period_cancelled || 0);
const periodRevenue = Number(metricsRow?.period_revenue_centavos || 0);
const periodTicketBase = Number(metricsRow?.period_ticket_base || 0);
const baseAppointments = periodStart ? periodAppointments : totalAppointments;
const baseCancelled = periodStart ? periodCancelled : totalCancelled;
const cancelRate = baseAppointments ? Math.round((baseCancelled / baseAppointments) * 100) : 0;
const lastItem = history[0] || null;
return res.json({
cliente: clientRow, notes: notesRow?.notas || null, tags, metrics: {
period: periodDays ? periodParam : 'all', total_appointments: baseAppointments, total_cancelled: baseCancelled, cancel_rate: cancelRate, last_appointment_at: lastItem?.inicio || null, last_status: lastItem?.status || null, last_service: lastItem?.servico || null, revenue_centavos: periodRevenue, ticket_medio_centavos: periodTicketBase ? Math.round(periodRevenue / Math.max(periodTicketBase, 1)) : null, }, frequent_services, history, });
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
    if (!Number.isFinite(clientId)) {
return res.status(400).json({ error: 'invalid_client' });
}

    const [[exists]] = await pool.query(
      'SELECT 1 FROM agendamentos WHERE estabelecimento_id= AND cliente_id= LIMIT 1', [estabelecimentoId, clientId] );
if (!exists) return res.status(404).json({ error: 'not_found' });
const notesRaw = req.body?.notes || req.body?.nota || req.body?.observacao ?? null;
const notes = sanitizePlainText(notesRaw, { maxLength: 1200, allowNewLines: true });
if (!notes) {
await pool.query('DELETE FROM cliente_notas WHERE estabelecimento_id= AND cliente_id=?', [ estabelecimentoId, clientId, ]);
return res.json({ ok: true, notes: null });
}

    await pool.query(
      `INSERT INTO cliente_notas (estabelecimento_id, cliente_id, notas)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE notas=VALUES(notas), updated_at=CURRENT_TIMESTAMP`, [estabelecimentoId, clientId, notes] );
return res.json({ ok: true, notes });
} catch (err) {
console.error('PUT /establishments/:id/clients/:clientId/notes', err);
return res.status(500).json({ error: 'client_notes_failed' });
}
});
router.put('/:id/clients/:clientId/tags', auth, isEstabelecimento, async (req, res) => {
try {
const estabelecimentoId = Number(req.params.id);
const clientId = Number(req.params.clientId);
if (!Number.isFinite(estabelecimentoId) || req.user.id !== estabelecimentoId) {
return res.status(403).json({ error: 'forbidden' });
}
    if (!Number.isFinite(clientId)) {
return res.status(400).json({ error: 'invalid_client' });
}

    const [[exists]] = await pool.query(
      'SELECT 1 FROM agendamentos WHERE estabelecimento_id= AND cliente_id= LIMIT 1', [estabelecimentoId, clientId] );
if (!exists) return res.status(404).json({ error: 'not_found' });
let tags = normalizeClientTags(req.body?.tags || []);
if (tags.length > 8) tags = tags.slice(0, 8);
const conn = await pool.getConnection();
try {
await conn.beginTransaction();
await conn.query(
        'DELETE FROM cliente_tags WHERE estabelecimento_id= AND cliente_id=?', [estabelecimentoId, clientId] );
if (tags.length) {
const placeholders = tags.map(() => '(?,?,?)').join(', ');
const params = tags.flatMap((tag) => [estabelecimentoId, clientId, tag]);
await conn.query(
          `INSERT INTO cliente_tags (estabelecimento_id, cliente_id, tag) VALUES ${placeholders}`, params );
}
      await conn.commit();
} catch (err) {
await conn.rollback();
throw err;
} finally {
conn.release();
} return res.json({ ok : true, tags });
} catch (err) {
console.error('PUT /establishments/:id/clients/:clientId/tags', err);
return res.status(500).json({ error: 'client_tags_failed' });
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

      'INSERT INTO estab_messages (estabelecimento_id, email_subject, email_html, wa_template) VALUES (?,?,?,?)\n       ON DUPLICATE KEY UPDATE email_subject=?, email_html=?, wa_template=?', [id, subject, html, wa, subject, html, wa] );
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

    const [rows] = await pool.query("SELECT id FROM usuarios WHERE slug= LIMIT 1", [slugRaw]);
if (rows.length && rows[0].id !== id) return res.status(409).json({ error: 'slug_taken' });
await pool.query('UPDATE usuarios SET slug= WHERE id= AND tipo=\'estabelecimento\'', [slugRaw, id]);
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
error: 'plan_downgrade_blocked', message: formatPlanLimitExceeded(targetConfig, 'professionals'), details: { professionals: totalProfessionals, limit: targetConfig.maxProfessionals }, });
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
error: 'plan_change_cooldown', message: `Aguarde ${remainingHours}h para mudar de plano novamente.`, });
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
const wantsTrial = planStatus === 'trialing' || Object.prototype.hasOwnProperty.call(req.body || {}, 'trialDays') || Object.prototype.hasOwnProperty.call(req.body || {}, 'trialEndsAt');
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

      "UPDATE usuarios SET plan=?, plan_status=?, plan_trial_ends_at=?, plan_active_until=?, plan_subscription_id= WHERE id= AND tipo='estabelecimento'", [rawPlan, planStatus, planTrialEndsAt, planActiveUntil, subscriptionId, id] );
const updatedContext = await getPlanContext(id);
if (!updatedContext) {
return res.status(404).json({ error: 'not_found' });
}



    req.user = {
...req.user, plan: updatedContext.plan, plan_status: updatedContext.status, plan_trial_ends_at: updatedContext.trialEndsAt ? updatedContext.trialEndsAt.toISOString() : null, plan_active_until: updatedContext.activeUntil ? updatedContext.activeUntil.toISOString() : null, plan_subscription_id: updatedContext.subscriptionId, };
return res.json({
ok: true, plan: serializePlanContext(updatedContext), });
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

      "INSERT INTO estabelecimento_reviews (estabelecimento_id, cliente_id, nota, comentario) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE nota=VALUES(nota), comentario=VALUES(comentario), updated_at=CURRENT_TIMESTAMP", [estabelecimentoId, req.user.id, nota, comentario] );
const [rating, userReview] = await Promise.all([ getRatingSummary(estabelecimentoId), fetchUserReview(estabelecimentoId, req.user.id), ]);
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

      "DELETE FROM estabelecimento_reviews WHERE estabelecimento_id= AND cliente_id=?", [estabelecimentoId, req.user.id] );
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

      "INSERT IGNORE INTO cliente_favoritos (cliente_id, estabelecimento_id) VALUES (?, ?)", [req.user.id, estabelecimentoId] );
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

      "DELETE FROM cliente_favoritos WHERE cliente_id= AND estabelecimento_id=?", [req.user.id, estabelecimentoId] );
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
const imageRaw = typeof req.body?.image === 'string'  req.body.image.trim() : '';
if (!imageRaw) {
return res.status(400).json({ error: 'image_required', message: 'Envie a imagem em formato data URL.' });
} const titulo = sanitizeGalleryText(req.body?.titulo, { maxLength : 120 });
const descricao = sanitizeGalleryText(req.body?.descricao, { maxLength: 240 });
const planContext = await getPlanContext(estabelecimentoId);
const limit = resolveGalleryLimit(planContext);
const total = await countGalleryImages(estabelecimentoId);
if (limit !== null && total >= limit) {
const message = limit === 0

           'Seu plano atual não permite adicionar imagens.'

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

      'INSERT INTO estabelecimento_imagens (estabelecimento_id, file_path, titulo, descricao, ordem) VALUES (?,?,?,?,?)', [estabelecimentoId, filePath, titulo, descricao, ordem] );
const insertedId = insertResult.insertId;
const [[row]] = await pool.query(

      'SELECT id, estabelecimento_id, file_path, titulo, descricao, ordem, created_at FROM estabelecimento_imagens WHERE id= LIMIT 1', [insertedId] );
return res.status(201).json({
ok: true, image: normalizeGalleryImage(row), remaining_slots: limit === null ? null : Math.max(0, limit - (total + 1)), });
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

      'SELECT id, estabelecimento_id, file_path FROM estabelecimento_imagens WHERE id= LIMIT 1', [imageId] );
if (!row || row.estabelecimento_id !== estabelecimentoId) {
return res.status(404).json({ error: 'not_found' });
}

    await pool.query('DELETE FROM estabelecimento_imagens WHERE id= LIMIT 1', [imageId]);
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

    const incomingOrder = req.body.order .map((value) => Number(value)) .filter((num) => Number.isInteger(num) && num > 0);
const [rows] = await pool.query(

      'SELECT id FROM estabelecimento_imagens WHERE estabelecimento_id= ORDER BY ordem ASC, id ASC', [estabelecimentoId] );
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
await Promise.all( finalOrder.map((imageId, index) => pool.query('UPDATE estabelecimento_imagens SET ordem= WHERE id= LIMIT 1', [index + 1, imageId]) )

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
const id = Number(req.params.id) if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error : 'forbidden' })



    // Conta serviços

    const [[svcRow]] = await pool.query(

      'SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?', [id] )

    const services = Number(svcRow?.total || 0)



    // Conta profissionais (se houver a tabela)

    const professionals = await countProfessionals(id) ; return res.json({ services, professionals }) } catch (e) {
console.error('GET /establishments/:id/stats', e) return res.status(500).json({ error : 'server_error' }) }

}) ; export default router;











