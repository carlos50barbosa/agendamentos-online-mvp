// src/routes/slots.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

// ===== Configuracao padrao de funcionamento =====
const OPEN_HOUR = 7;      // 07:00
const CLOSE_HOUR = 22;    // ate 22:00 (ultimo slot termina as 22:00)
const INTERVAL_MIN = 30;  // intervalo de 30min
const DEFAULT_START_MIN = OPEN_HOUR * 60;
const DEFAULT_END_MIN = CLOSE_HOUR * 60;

// Helpers
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const toISO = (d) => new Date(d).toISOString();

const DAY_SLUG_TO_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});

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
    const slugRaw = item.day ?? item.key ?? item.weekday ?? item.week_day ?? '';
    const slug = typeof slugRaw === 'string' ? slugRaw.toLowerCase().trim() : '';
    const idx = DAY_SLUG_TO_INDEX[slug];
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
    // Define o range da semana [weekStart .. weekStart+6]
    const start = new Date(`${weekStart}T00:00:00`);
    const end = addDays(start, 6);

    // Carrega agendamentos confirmados e bloqueios no periodo
    const [ags] = await pool.query(
      `
      SELECT inicio, fim
        FROM agendamentos
       WHERE estabelecimento_id = ?
         AND status = 'confirmado'
         AND DATE(inicio) BETWEEN DATE(?) AND DATE(?)
      `,
      [establishmentId, start, end]
    );

    const [blq] = await pool.query(
      `
      SELECT inicio, fim
        FROM bloqueios
       WHERE estabelecimento_id = ?
         AND DATE(inicio) BETWEEN DATE(?) AND DATE(?)
      `,
      [establishmentId, start, end]
    );

    const [profileRows] = await pool.query(
      `SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id = ? LIMIT 1`,
      [establishmentId]
    );
    const horariosJson = profileRows?.[0]?.horarios_json || null;
    const workingRules = buildWorkingRules(horariosJson);

    // Monta grade da semana em passos de 30min
    const slots = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      const weekDayIndex = day.getDay();
      const rule = workingRules ? workingRules[weekDayIndex] : null;
      if (rule && rule.enabled === false) {
        continue;
      }
      const dayStartMinutes = rule && rule.enabled ? rule.startMinutes : DEFAULT_START_MIN;
      const dayEndMinutes = rule && rule.enabled ? rule.endMinutes : DEFAULT_END_MIN;
      const dayBreaks = rule && rule.enabled ? rule.breaks : [];

      for (let minute = dayStartMinutes; minute < dayEndMinutes; minute += INTERVAL_MIN) {
        const hour = Math.floor(minute / 60);
        const minuteOfHour = minute % 60;
        const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minuteOfHour, 0);
        const e = new Date(s.getTime() + INTERVAL_MIN * 60000);

        const ocupado = ags.some(a => new Date(a.inicio) < e && new Date(a.fim) > s);
        const bloqueadoDb = blq.some(b => new Date(b.inicio) < e && new Date(b.fim) > s);
        const bloqueadoHorario = dayBreaks.some(([startMin, endMin]) => minute >= startMin && minute < endMin);
        const bloqueado = bloqueadoDb || bloqueadoHorario;

        const label = ocupado ? 'agendado' : (bloqueado ? 'bloqueado' : 'disponivel');
        const status = ocupado ? 'booked' : (bloqueado ? 'unavailable' : 'free');

        slots.push({
          datetime: toISO(s), // ISO-8601 (evita ambiguidade de timezone no front)
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



