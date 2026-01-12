// src/routes/slots.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM, weekDayIndexInTZ } from '../lib/datetime_tz.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

// ===== Configuracao padrao de funcionamento =====
const OPEN_HOUR = 7;      // 07:00
const CLOSE_HOUR = 22;    // ate 22:00 (ultimo slot termina as 22:00)
const INTERVAL_MIN = 30;  // intervalo de 30min
const DEFAULT_START_MIN = OPEN_HOUR * 60;
const DEFAULT_END_MIN = CLOSE_HOUR * 60;
const APPOINTMENT_BUFFER_MIN = (() => {
  const raw = process.env.AGENDAMENTO_BUFFER_MIN ?? process.env.APPOINTMENT_BUFFER_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
const DAY_MS = 24 * 60 * 60 * 1000;

// Helpers
const parseLocalYmd = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(check.getTime()) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const addDaysLocal = (year, month, day, offset) => {
  const d = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
};

const normalizeServiceIds = (value) => {
  const ids = [];
  const pushId = (entry) => {
    const num = Number(entry);
    if (Number.isFinite(num) && num > 0) ids.push(num);
  };
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'object') {
        pushId(entry.id ?? entry.servico_id ?? entry.service_id ?? entry.servicoId ?? entry.serviceId);
      } else {
        pushId(entry);
      }
    });
  } else if (value !== undefined && value !== null && String(value).trim() !== '') {
    String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(pushId);
  }
  const seen = new Set();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const extractServiceIds = (query) => {
  if (!query || typeof query !== 'object') return [];
  const rawList =
    query.servico_ids ??
    query.servicos ??
    query.service_ids ??
    query.services ??
    query.serviceIds ??
    query.servicoIds ??
    null;
  const parsed = normalizeServiceIds(rawList);
  if (parsed.length) return parsed;
  if (query.servico_id != null) {
    return normalizeServiceIds([query.servico_id]);
  }
  return [];
};

const DAY_SLUG_TO_INDEX = Object.freeze({
  sunday: 0,
  sundayfeira: 0,
  sun: 0,
  domingo: 0,
  domingofeira: 0,
  dom: 0,
  monday: 1,
  mondayfeira: 1,
  mon: 1,
  segunda: 1,
  segundafeira: 1,
  seg: 1,
  tuesday: 2,
  tuesdayfeira: 2,
  tue: 2,
  terca: 2,
  tercafeira: 2,
  ter: 2,
  wednesday: 3,
  wednesdayfeira: 3,
  wed: 3,
  quarta: 3,
  quartafeira: 3,
  qua: 3,
  thursday: 4,
  thursdayfeira: 4,
  thu: 4,
  quinta: 4,
  quintafeira: 4,
  qui: 4,
  friday: 5,
  fridayfeira: 5,
  fri: 5,
  sexta: 5,
  sextafeira: 5,
  sex: 5,
  saturday: 6,
  saturdayfeira: 6,
  sat: 6,
  sabado: 6,
  sabadofeira: 6,
  sab: 6,
});

const normalizeDayKey = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
};

const resolveDayIndex = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.day,
    item.key,
    item.weekday,
    item.week_day,
    item.dia,
    item.label,
  ];
  if (item.value) {
    candidates.push(item.value);
    const firstChunk = String(item.value).split(/[\s,;-]+/)[0];
    candidates.push(firstChunk);
  }

  for (const candidate of candidates) {
    const normalized = normalizeDayKey(candidate);
    if (!normalized) continue;
    if (Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, normalized)) {
      return DAY_SLUG_TO_INDEX[normalized];
    }
  }
  return null;
};

const ensureTimeValue = (value) => {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;
  const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 2) {
    const hours = Number(digits);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
    return `${String(hours).padStart(2, '0')}:00`;
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
};

const toMinutes = (time) => {
  if (!time) return null;
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
};

const buildWorkingRules = (horariosJson) => {
  if (!horariosJson) return null;
  let entries;
  try {
    entries = JSON.parse(horariosJson);
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || !entries.length) return null;
  const rules = Array.from({ length: 7 }, () => ({
    enabled: false,
    startMinutes: null,
    endMinutes: null,
    breaks: [],
  }));
  let recognized = false;

  entries.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const idx = resolveDayIndex(item);
    if (idx == null) return;
    if (rules[idx].processed) return;

    const valueText = String(item.value ?? '').toLowerCase();
    if (
      valueText.includes('fechado') ||
      valueText.includes('sem atendimento') ||
      valueText.includes('nao atende')
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? null);
    const end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? null);
    if (!start || !end) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);
    if (
      startMinutes == null ||
      endMinutes == null ||
      startMinutes >= endMinutes
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const rawBlocks = Array.isArray(item.blocks)
      ? item.blocks
      : Array.isArray(item.breaks)
      ? item.breaks
      : [];

    const breaks = [];
    rawBlocks.forEach((block) => {
      if (!block) return;
      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? null);
      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? null);
      const blockStartMinutes = toMinutes(blockStart);
      const blockEndMinutes = toMinutes(blockEnd);
      if (
        blockStartMinutes == null ||
        blockEndMinutes == null ||
        blockStartMinutes >= blockEndMinutes ||
        blockStartMinutes < startMinutes ||
        blockEndMinutes > endMinutes
      ) {
        return;
      }
      breaks.push([blockStartMinutes, blockEndMinutes]);
    });

    rules[idx] = {
      enabled: true,
      startMinutes,
      endMinutes,
      breaks,
      processed: true,
    };
    recognized = true;
  });

  if (!recognized) return null;
  return rules.map((rule) => {
    if (!rule.processed) {
      return { enabled: false, startMinutes: null, endMinutes: null, breaks: [] };
    }
    const { processed, ...rest } = rule;
    return rest;
  });
};

/**
 * GET /slots?establishmentId=ID&weekStart=YYYY-MM-DD
 * Retorna { slots: [{ datetime, label, status }] }
 * - Busca agendamentos confirmados (agendamentos.status='confirmado')
 * - Busca bloqueios na tabela "bloqueios"
 */
router.get('/', async (req, res) => {
  const { establishmentId, weekStart } = req.query;
  if (!establishmentId || !weekStart) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    const weekStartLocal = parseLocalYmd(weekStart);
    if (!weekStartLocal) {
      return res.status(400).json({ error: 'invalid_week_start' });
    }

    const serviceIds = extractServiceIds(req.query);
    let durationMinutes = null;
    const durationRaw =
      req.query.duracao_total ??
      req.query.duracaoTotal ??
      req.query.duration_min ??
      req.query.duration ??
      null;
    if (!serviceIds.length && durationRaw !== null && durationRaw !== undefined && String(durationRaw).trim() !== '') {
      const parsed = Number(durationRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'duracao_invalida' });
      }
      durationMinutes = parsed;
    }

    if (serviceIds.length) {
      const placeholders = serviceIds.map(() => '?').join(', ');
      const [rows] = await pool.query(
        `SELECT id, duracao_min
           FROM servicos
          WHERE id IN (${placeholders})
            AND estabelecimento_id=?
            AND ativo=1`,
        [...serviceIds, establishmentId]
      );
      const map = new Map(rows.map((row) => [Number(row.id), Number(row.duracao_min || 0)]));
      const missing = serviceIds.filter((id) => !map.has(Number(id)));
      if (missing.length) {
        return res.status(400).json({ error: 'servico_invalido' });
      }
      const total = serviceIds.reduce((sum, id) => sum + (map.get(Number(id)) || 0), 0);
      if (!Number.isFinite(total) || total <= 0) {
        return res.status(400).json({ error: 'duracao_invalida' });
      }
      durationMinutes = total;
    }

    if (durationMinutes == null) {
      durationMinutes = INTERVAL_MIN;
    }
    // durationMinutes é sempre sem buffer; o buffer entra apenas no cálculo final.
    const effectiveDuration = Math.max(1, Math.round(durationMinutes + APPOINTMENT_BUFFER_MIN));

    // Semana local (UTC-3) convertida para instantes UTC
    const rangeStartUtc = makeUtcFromLocalYMDHM(
      weekStartLocal.year,
      weekStartLocal.month,
      weekStartLocal.day,
      0,
      0,
      EST_TZ_OFFSET_MIN
    );
    const rangeEndUtcExclusive = new Date(rangeStartUtc.getTime() + 7 * DAY_MS);

    // Carrega agendamentos confirmados e bloqueios no periodo
    const [ags] = await pool.query(
      `
      SELECT inicio, fim
        FROM agendamentos
       WHERE estabelecimento_id = ?
         AND status IN ('confirmado','pendente')
         AND (status <> 'pendente' OR public_confirm_expires_at IS NULL OR public_confirm_expires_at >= NOW())
         AND inicio < ?
         AND fim > ?
      `,
      [establishmentId, rangeEndUtcExclusive, rangeStartUtc]
    );

    const [blq] = await pool.query(
      `
      SELECT inicio, fim
        FROM bloqueios
       WHERE estabelecimento_id = ?
         AND inicio < ?
         AND fim > ?
      `,
      [establishmentId, rangeEndUtcExclusive, rangeStartUtc]
    );

    const [profileRows] = await pool.query(
      `SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id = ? LIMIT 1`,
      [establishmentId]
    );
    const horariosJson = profileRows?.[0]?.horarios_json || null;
    const workingRules = buildWorkingRules(horariosJson);

    const toIntervals = (rows) =>
      (rows || [])
        .map((row) => [new Date(row.inicio).getTime(), new Date(row.fim).getTime()])
        .filter(([startMs, endMs]) => Number.isFinite(startMs) && Number.isFinite(endMs));
    const agIntervals = toIntervals(ags);
    const blqIntervals = toIntervals(blq);

    // Monta grade da semana em passos de 30min
    const slots = [];
    for (let d = 0; d < 7; d++) {
      const localDay = addDaysLocal(weekStartLocal.year, weekStartLocal.month, weekStartLocal.day, d);
      const dayStartUtc = makeUtcFromLocalYMDHM(
        localDay.year,
        localDay.month,
        localDay.day,
        0,
        0,
        EST_TZ_OFFSET_MIN
      );
      const weekDayIndex = weekDayIndexInTZ(dayStartUtc, EST_TZ_OFFSET_MIN);
      const rule = workingRules ? workingRules[weekDayIndex ?? localDay.weekday] : null;
      if (rule && rule.enabled === false) {
        continue;
      }
      const dayStartMinutes = rule && rule.enabled ? rule.startMinutes : DEFAULT_START_MIN;
      const dayEndMinutes = rule && rule.enabled ? rule.endMinutes : DEFAULT_END_MIN;
      const dayBreaks = rule && rule.enabled ? rule.breaks : [];

      for (let minute = dayStartMinutes; minute < dayEndMinutes; minute += INTERVAL_MIN) {
        const hour = Math.floor(minute / 60);
        const minuteOfHour = minute % 60;
        const slotStartUtc = makeUtcFromLocalYMDHM(
          localDay.year,
          localDay.month,
          localDay.day,
          hour,
          minuteOfHour,
          EST_TZ_OFFSET_MIN
        );
        const sMs = slotStartUtc.getTime();
        const eMs = sMs + effectiveDuration * 60_000;
        const slotEndMinutes = minute + effectiveDuration;

        const ultrapassaFim = slotEndMinutes > dayEndMinutes;
        const ocupado = !ultrapassaFim && agIntervals.some(([start, end]) => start < eMs && end > sMs);
        const bloqueadoDb = !ultrapassaFim && blqIntervals.some(([start, end]) => start < eMs && end > sMs);
        const bloqueadoHorario = dayBreaks.some(([startMin, endMin]) => minute < endMin && slotEndMinutes > startMin);
        const bloqueado = ultrapassaFim || bloqueadoDb || bloqueadoHorario;

        const label = ocupado ? 'agendado' : (bloqueado ? 'bloqueado' : 'disponivel');
        const status = ocupado ? 'booked' : (bloqueado ? 'unavailable' : 'free');

        slots.push({
          datetime: slotStartUtc.toISOString(), // ISO-8601 em UTC equivalente ao horário local
          label,
          status
        });
      }
    }

    res.json({ slots });
  } catch (e) {
    console.error('GET /slots error:', e);
    res.status(500).json({ error: 'slots_fetch_failed' });
  }
});

/**
 * POST /slots/toggle
 * body: { slotDatetime }
 * — Bloqueia ou libera um intervalo de 30 min do estabelecimento logado
 */
router.post('/toggle', auth, isEstabelecimento, async (req, res) => {
  const { slotDatetime } = req.body;
  if (!slotDatetime) return res.status(400).json({ error: 'missing_slot' });

  const planContext = await getPlanContext(req.user.id);
  if (planContext && isDelinquentStatus(planContext.status)) {
    return res.status(403).json({
      error: 'plan_delinquent',
      message: 'Sua assinatura esta em atraso. Ajustes de agenda estao temporariamente bloqueados.'
    });
  }

  try {
    const s = new Date(slotDatetime);
    const e = new Date(s.getTime() + INTERVAL_MIN * 60000);

    // Ja existe bloqueio exato para esse intervalo?
    const [rows] = await pool.query(
      `SELECT id
         FROM bloqueios
        WHERE estabelecimento_id = ?
          AND inicio = ?
          AND fim = ?`,
      [req.user.id, s, e]
    );

    if (rows.length) {
      await pool.query(`DELETE FROM bloqueios WHERE id = ?`, [rows[0].id]);
      return res.json({ ok: true, action: 'liberado' });
    } else {
      // Antes de bloquear, voce pode checar se ja ha agendamento nesse horario
      // e impedir o bloqueio; por ora, so criamos o bloqueio.
      await pool.query(
        `INSERT INTO bloqueios (estabelecimento_id, inicio, fim) VALUES (?,?,?)`,
        [req.user.id, s, e]
      );
      return res.json({ ok: true, action: 'bloqueado' });
    }
  } catch (e) {
    console.error('POST /slots/toggle error:', e);
    res.status(500).json({ error: 'toggle_failed' });
  }
});

export default router;



