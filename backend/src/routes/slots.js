// src/routes/slots.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM, weekDayIndexInTZ } from '../lib/datetime_tz.js';
import { buildWorkingRules, resolveExpedienteForDay } from '../lib/expediente.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

// ===== Configuracao padrao de funcionamento =====
const INTERVAL_MIN = 30;  // intervalo de 30min
const APPOINTMENT_BUFFER_MIN = (() => {
  const raw = process.env.AGENDAMENTO_BUFFER_MIN ?? process.env.APPOINTMENT_BUFFER_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;

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
      const dayIndex = weekDayIndexInTZ(dayStartUtc, EST_TZ_OFFSET_MIN) ?? localDay.weekday;
      const expediente = resolveExpedienteForDay(workingRules, dayIndex);
      const prevDayIndex = (dayIndex + 6) % 7;
      const prevExpediente = resolveExpedienteForDay(workingRules, prevDayIndex);
      const intervals = [];

      if (
        !prevExpediente.closed &&
        Number.isFinite(prevExpediente.startMinutes) &&
        Number.isFinite(prevExpediente.endMinutes) &&
        prevExpediente.startMinutes > prevExpediente.endMinutes &&
        prevExpediente.endMinutes > 0
      ) {
        const prevBreaks = Array.isArray(prevExpediente.breaks) ? prevExpediente.breaks : [];
        const earlyBreaks = prevBreaks.filter(
          ([startMin, endMin]) =>
            Number.isFinite(startMin) &&
            Number.isFinite(endMin) &&
            startMin < prevExpediente.startMinutes
        );
        intervals.push({
          start: 0,
          end: prevExpediente.endMinutes,
          closeLimit: prevExpediente.endMinutes,
          breaks: earlyBreaks,
        });
      }

      if (!expediente.closed && Number.isFinite(expediente.startMinutes) && Number.isFinite(expediente.endMinutes)) {
        if (expediente.startMinutes < expediente.endMinutes) {
          intervals.push({
            start: expediente.startMinutes,
            end: expediente.endMinutes,
            closeLimit: expediente.endMinutes,
            breaks: Array.isArray(expediente.breaks) ? expediente.breaks : [],
          });
        } else if (expediente.startMinutes > expediente.endMinutes) {
          const dayBreaks = Array.isArray(expediente.breaks) ? expediente.breaks : [];
          const lateBreaks = [];
          dayBreaks.forEach(([startMin, endMin]) => {
            if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return;
            if (startMin >= expediente.startMinutes) {
              lateBreaks.push([startMin, endMin]);
              return;
            }
            lateBreaks.push([startMin + DAY_MINUTES, endMin + DAY_MINUTES]);
          });
          intervals.push({
            start: expediente.startMinutes,
            end: DAY_MINUTES,
            closeLimit: DAY_MINUTES + expediente.endMinutes,
            breaks: lateBreaks,
          });
        }
      }

      for (const interval of intervals) {
        if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start >= interval.end) {
          continue;
        }
        const closeLimit = Number.isFinite(interval.closeLimit) ? interval.closeLimit : interval.end;
        for (let minute = interval.start; minute < interval.end; minute += INTERVAL_MIN) {
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
          const slotEndWindow = minute + effectiveDuration;

          const ultrapassaFim = slotEndWindow > closeLimit;
          const ocupado = !ultrapassaFim && agIntervals.some(([start, end]) => start < eMs && end > sMs);
          const bloqueadoDb = !ultrapassaFim && blqIntervals.some(([start, end]) => start < eMs && end > sMs);
          const bloqueadoHorario = Array.isArray(interval.breaks) &&
            interval.breaks.some(([startMin, endMin]) => minute < endMin && slotEndWindow > startMin);
          const bloqueado = ultrapassaFim || bloqueadoDb || bloqueadoHorario;

          const label = ocupado ? 'agendado' : (bloqueado ? 'bloqueado' : 'disponivel');
          const status = ocupado ? 'booked' : (bloqueado ? 'unavailable' : 'free');

          slots.push({
            datetime: slotStartUtc.toISOString(), // ISO-8601 em UTC equivalente ao hor rio local
            label,
            status
          });
        }
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



