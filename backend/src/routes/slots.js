// src/routes/slots.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM, weekDayIndexInTZ } from '../lib/datetime_tz.js';
import { buildWorkingRules, resolveExpedienteForDay } from '../lib/expediente.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { ensureSubscriptionOperationalAccess } from '../middleware/billing.js';
import { activeAppointmentStatusWhere, normalizeServiceSlotCapacity } from '../lib/service_capacity.js';

const router = Router();

// ===== Configuracao padrao de funcionamento =====
const INTERVAL_MIN = 30;  // intervalo de 30min
const APPOINTMENT_BUFFER_MIN = (() => {
  const raw = process.env.AGENDAMENTO_BUFFER_MIN ?? process.env.APPOINTMENT_BUFFER_MIN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
})();
// Antecedência mínima para agendar: slots que começam <= agora + esta folga são
// marcados como indisponíveis (nunca "free"). Default 0 = filtra só o passado.
// Mantido consistente com a checagem past_datetime do POST /public/agendamentos.
const MIN_LEAD_MIN = (() => {
  const raw = process.env.AGENDAMENTO_MIN_LEAD_MIN ?? process.env.SLOT_MIN_LEAD_MIN;
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

const extractProfessionalId = (query) => {
  const raw =
    query?.profissional_id ??
    query?.profissionalId ??
    query?.professional_id ??
    query?.professionalId ??
    null;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
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
    const professionalId = extractProfessionalId(req.query);
    if (Number.isNaN(professionalId)) {
      return res.status(400).json({ error: 'profissional_invalido' });
    }
    let durationMinutes = null;
    let selectedServiceCapacity = 1;
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
        `SELECT id, duracao_min, capacidade_por_horario
           FROM servicos
          WHERE id IN (${placeholders})
            AND estabelecimento_id=?
            AND ativo=1`,
        [...serviceIds, establishmentId]
      );
      const map = new Map(rows.map((row) => [Number(row.id), row]));
      const missing = serviceIds.filter((id) => !map.has(Number(id)));
      if (missing.length) {
        return res.status(400).json({ error: 'servico_invalido' });
      }
      const total = serviceIds.reduce((sum, id) => sum + Number(map.get(Number(id))?.duracao_min || 0), 0);
      if (!Number.isFinite(total) || total <= 0) {
        return res.status(400).json({ error: 'duracao_invalida' });
      }
      durationMinutes = total;
      if (serviceIds.length === 1) {
        selectedServiceCapacity = normalizeServiceSlotCapacity(map.get(Number(serviceIds[0]))?.capacidade_por_horario);
      }
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
    let appointmentsSql = `
      SELECT servico_id, profissional_id, inicio, fim
        FROM agendamentos
       WHERE estabelecimento_id = ?
         AND ${activeAppointmentStatusWhere()}
         AND inicio < ?
         AND fim > ?
      `;
    const appointmentsParams = [establishmentId, rangeEndUtcExclusive, rangeStartUtc];
    if (professionalId != null) {
      appointmentsSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
      appointmentsParams.push(professionalId);
    }
    const [ags] = await pool.query(appointmentsSql, appointmentsParams);

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
    const agIntervals = (ags || [])
      .map((row) => ({
        start: new Date(row.inicio).getTime(),
        end: new Date(row.fim).getTime(),
        serviceId: Number(row.servico_id || 0),
        professionalId: row.profissional_id == null ? null : Number(row.profissional_id),
      }))
      .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end));
    const blqIntervals = toIntervals(blq);
    const capacityAwareService = serviceIds.length === 1 ? Number(serviceIds[0]) : null;

    // Monta grade da semana em passos de 30min
    const nowMs = Date.now();
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
          const overlappingAppointments = !ultrapassaFim
            ? agIntervals.filter((appt) => appt.start < eMs && appt.end > sMs)
            : [];
          let vagasRestantes = capacityAwareService ? selectedServiceCapacity : 1;
          let ocupado = false;
          if (capacityAwareService) {
            const sameSlotStart = (startMs) => Math.abs(Number(startMs) - sMs) < 60_000;
            const compatibleAppointments = overlappingAppointments.filter((appt) => (
              appt.serviceId === capacityAwareService &&
              sameSlotStart(appt.start) &&
              (
                professionalId != null
                  ? appt.professionalId === professionalId
                  : true
              )
            ));
            const hasBlockingAppointment = compatibleAppointments.length !== overlappingAppointments.length;
            vagasRestantes = Math.max(0, selectedServiceCapacity - compatibleAppointments.length);
            ocupado = hasBlockingAppointment || compatibleAppointments.length >= selectedServiceCapacity;
          } else {
            ocupado = overlappingAppointments.length > 0;
            vagasRestantes = ocupado ? 0 : 1;
          }
          const bloqueadoDb = !ultrapassaFim && blqIntervals.some(([start, end]) => start < eMs && end > sMs);
          const bloqueadoHorario = Array.isArray(interval.breaks) &&
            interval.breaks.some(([startMin, endMin]) => minute < endMin && slotEndWindow > startMin);
          const bloqueado = ultrapassaFim || bloqueadoDb || bloqueadoHorario;
          // Horário já passado (ou dentro da antecedência mínima) nunca fica "free".
          const isPast = sMs <= nowMs + MIN_LEAD_MIN * 60_000;

          const label = ocupado ? 'agendado' : ((bloqueado || isPast) ? 'bloqueado' : 'disponivel');
          const status = ocupado ? 'booked' : ((bloqueado || isPast) ? 'unavailable' : 'free');

          slots.push({
            datetime: slotStartUtc.toISOString(), // ISO-8601 em UTC equivalente ao hor rio local
            label,
            status,
            capacidade: capacityAwareService ? selectedServiceCapacity : 1,
            vagas_restantes: status === 'free' ? vagasRestantes : 0
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
router.post('/toggle', auth, isEstabelecimento, ensureSubscriptionOperationalAccess({
  message: 'Regularize a assinatura para ajustar a agenda.',
}), async (req, res) => {
  const { slotDatetime } = req.body;
  if (!slotDatetime) return res.status(400).json({ error: 'missing_slot' });

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



