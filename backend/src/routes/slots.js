// src/routes/slots.js
import { Router } from 'express';
import { pool, withTransactionRetry } from '../lib/db.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM, weekDayIndexInTZ } from '../lib/datetime_tz.js';
import { buildWorkingRules, resolveExpedienteForDay } from '../lib/expediente.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { ensureSubscriptionOperationalAccess } from '../middleware/billing.js';
import { activeAppointmentStatusWhere, normalizeServiceSlotCapacity } from '../lib/service_capacity.js';
import { normalizeBlockInput } from '../lib/bloqueios.js';
import { isDentroDaJanela, resolveJanela, serializeJanela } from '../lib/janela_agendamento.js';

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
// Teto da janela de listagem de bloqueios (~6 meses). A agenda do painel pede no máximo um
// mês por vez; o teto existe só para um `from`/`to` digitado errado não varrer anos de tabela.
const MAX_BLOCK_LIST_DAYS = 186;
// Mesma frase do POST /toggle: ajustar a agenda é operação de plano ativo.
const BLOCK_SUBSCRIPTION_GUARD = { message: 'Regularize a assinatura para ajustar a agenda.' };

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

// Domingo da semana local corrente. A agenda do painel abre sempre na semana atual, e
// domingo é o início de semana da plataforma inteira (DateHelpers.weekStartISO no frontend).
// A convenção mudou de segunda para domingo junto com a janela de agendamento: a janela
// libera a leva de uma vez num dia fixo, e com a grade em outra convenção essa leva cairia
// partida entre duas páginas da grade.
const currentLocalWeekStart = () => {
  const local = new Date(Date.now() + EST_TZ_OFFSET_MIN * 60_000);
  const backToSunday = local.getUTCDay(); // getUTCDay: 0=domingo
  return addDaysLocal(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), -backToSunday);
};

// Instantes vão para o cliente em ISO-8601 UTC, o mesmo formato do GET /slots.
const serializeBloqueio = (row) => ({
  id: Number(row.id),
  inicio: new Date(row.inicio).toISOString(),
  fim: new Date(row.fim).toISOString(),
  profissional_id: row.profissional_id == null ? null : Number(row.profissional_id),
  profissional_nome: row.profissional_nome ?? null,
  motivo: row.motivo ?? null,
  dia_inteiro: Boolean(row.dia_inteiro),
});

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
      SELECT inicio, fim, profissional_id
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

    // Ate onde no futuro este estabelecimento aceita agendamento. Modo 'livre' (o default de
    // todo mundo) devolve limiteUtc null e nada abaixo muda. Ver lib/janela_agendamento.js.
    const janela = await resolveJanela(pool, establishmentId);

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
    // REGRA CENTRAL de escopo aplicada à grade: bloqueio sem profissional fecha o slot para
    // todo mundo; bloqueio de um profissional só derruba a grade DELE. Na visão "qualquer
    // profissional" (request sem profissional_id) somente os bloqueios do estabelecimento
    // inteiro valem — senão a ausência de uma manicure fecharia a agenda do salão todo.
    const blockAppliesToRequest = (row) => {
      const blockProfessionalId = row?.profissional_id == null ? null : Number(row.profissional_id);
      return blockProfessionalId == null || blockProfessionalId === professionalId;
    };
    const blqIntervals = toIntervals((blq || []).filter(blockAppliesToRequest));
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
          // Além do horizonte que o estabelecimento aceita (modo 'livre' => sempre false).
          const foraDaJanela = !isDentroDaJanela(sMs, janela);

          // `foraDaJanela` tem precedência sobre `ocupado`, e só ele: a semana fechada
          // precisa renderizar uniforme, e marcar "agendado" lá entregaria a agenda do
          // estabelecimento para quem nem pode marcar naquela faixa ainda. Para o resto a
          // ordem histórica se mantém — ocupado ganha de bloqueado/passado.
          let label;
          let status;
          if (foraDaJanela) {
            label = 'bloqueado';
            status = 'unavailable';
          } else if (ocupado) {
            label = 'agendado';
            status = 'booked';
          } else if (bloqueado || isPast) {
            label = 'bloqueado';
            status = 'unavailable';
          } else {
            label = 'disponivel';
            status = 'free';
          }

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

    // `janela` vai junto para o front conseguir dizer QUANDO abre e travar a seta de avançar
    // semana. Sem isso a grade toda cinza depois do limite parece defeito do sistema.
    res.json({ slots, janela: serializeJanela(janela) });
  } catch (e) {
    console.error('GET /slots error:', e);
    res.status(500).json({ error: 'slots_fetch_failed' });
  }
});

/**
 * GET /slots/bloqueios?from=YYYY-MM-DD&to=YYYY-MM-DD
 * from/to são datas LOCAIS (UTC-3); a janela é [from 00:00, to+1d 00:00).
 * Sem parâmetros, devolve a semana atual.
 * -> { bloqueios: [{ id, inicio, fim, profissional_id, profissional_nome, motivo, dia_inteiro }] }
 */
router.get(
  '/bloqueios',
  auth,
  isEstabelecimento,
  ensureSubscriptionOperationalAccess(BLOCK_SUBSCRIPTION_GUARD),
  async (req, res) => {
    try {
      const rawFrom = String(req.query?.from ?? '').trim();
      const rawTo = String(req.query?.to ?? '').trim();

      const fromLocal = rawFrom ? parseLocalYmd(rawFrom) : currentLocalWeekStart();
      if (!fromLocal) return res.status(400).json({ error: 'inicio_invalido' });
      // `to` ausente = 7 dias a partir de `from` (com os dois ausentes, a semana corrente).
      const toLocal = rawTo
        ? parseLocalYmd(rawTo)
        : addDaysLocal(fromLocal.year, fromLocal.month, fromLocal.day, 6);
      if (!toLocal) return res.status(400).json({ error: 'fim_invalido' });

      const rangeStartUtc = makeUtcFromLocalYMDHM(
        fromLocal.year,
        fromLocal.month,
        fromLocal.day,
        0,
        0,
        EST_TZ_OFFSET_MIN
      );
      // Fim exclusivo: 00:00 do dia seguinte a `to`, senão o próprio dia `to` ficaria de fora.
      const afterTo = addDaysLocal(toLocal.year, toLocal.month, toLocal.day, 1);
      const rangeEndUtcExclusive = makeUtcFromLocalYMDHM(
        afterTo.year,
        afterTo.month,
        afterTo.day,
        0,
        0,
        EST_TZ_OFFSET_MIN
      );

      if (rangeEndUtcExclusive.getTime() <= rangeStartUtc.getTime()) {
        return res.status(400).json({ error: 'intervalo_invalido' });
      }
      if (rangeEndUtcExclusive.getTime() - rangeStartUtc.getTime() > MAX_BLOCK_LIST_DAYS * DAY_MS) {
        return res.status(400).json({ error: 'intervalo_muito_longo' });
      }

      // Sobreposição, não "começa dentro": bloqueio de dia inteiro que atravessa a janela
      // precisa aparecer também nas semanas do meio.
      const [rows] = await pool.query(
        `SELECT b.id, b.inicio, b.fim, b.profissional_id, b.motivo, b.dia_inteiro,
                p.nome AS profissional_nome
           FROM bloqueios b
           LEFT JOIN profissionais p ON p.id = b.profissional_id
          WHERE b.estabelecimento_id = ?
            AND b.inicio < ?
            AND b.fim > ?
          ORDER BY b.inicio ASC, b.id ASC`,
        [req.user.id, rangeEndUtcExclusive, rangeStartUtc]
      );

      res.json({ bloqueios: rows.map(serializeBloqueio) });
    } catch (e) {
      console.error('GET /slots/bloqueios error:', e);
      res.status(500).json({ error: 'bloqueios_fetch_failed' });
    }
  }
);

/**
 * POST /slots/bloqueios
 * body: { inicio, fim, profissional_id?, motivo?, dia_inteiro?, force? }
 * -> 201 { bloqueio }
 * -> 409 { error: 'conflito_agendamentos', agendamentos: [...] } quando já há cliente marcado
 *        no intervalo e `force` não veio.
 */
router.post(
  '/bloqueios',
  auth,
  isEstabelecimento,
  ensureSubscriptionOperationalAccess(BLOCK_SUBSCRIPTION_GUARD),
  async (req, res) => {
    const estabelecimentoId = req.user.id;
    const normalized = normalizeBlockInput(req.body || {});
    if (!normalized.ok) return res.status(400).json({ error: normalized.error });

    const { inicioDate, fimDate, profissionalId, motivo, diaInteiro } = normalized;
    const force = Boolean(req.body?.force);

    try {
      let profissionalNome = null;
      if (profissionalId != null) {
        const [[profRow]] = await pool.query(
          'SELECT id, nome FROM profissionais WHERE id=? AND estabelecimento_id=?',
          [profissionalId, estabelecimentoId]
        );
        if (!profRow) return res.status(400).json({ error: 'profissional_invalido' });
        profissionalNome = profRow.nome;
      }

      const outcome = await withTransactionRetry(async (conn) => {
        // GRAVA PRIMEIRO, confere depois. Parece ao contrário, e é de propósito.
        //
        // Esta transação e a de criar agendamento correm em direções opostas sobre as mesmas
        // duas tabelas, e a ordem "lê bloqueios, lê agendamentos" NÃO evita deadlock: as duas
        // leituras acham faixa vazia e tiram gap lock, e gap locks são MUTUAMENTE COMPATÍVEIS
        // — ninguém espera ninguém. O ciclo só fecha no fim, quando cada uma tenta inserir na
        // tabela que a outra gap-lockou (insert-intention x gap), e aí o InnoDB mata uma das
        // duas com 500 na cara de quem estava agendando.
        //
        // Com o INSERT na frente, o lock que decide a corrida deixa de ser um gap lock e passa
        // a ser o lock de REGISTRO da linha recém-inserida — esse é exclusivo. Quem perde a
        // corrida para na PRIMEIRA aquisição de lock, sem segurar nada, então não há ciclo:
        //   - se o bloqueio entrou antes, o booking trava no seu `SELECT bloqueios FOR UPDATE`
        //     (que é a primeira coisa que ele faz) e, ao destravar, enxerga o bloqueio;
        //   - se o booking veio antes, este INSERT espera, e o guard abaixo enxerga o
        //     agendamento já commitado e devolve 409.
        // Em ambos, um dos dois vê o outro — que é a propriedade que importa.
        const [result] = await conn.query(
          `INSERT INTO bloqueios (estabelecimento_id, profissional_id, inicio, fim, motivo, dia_inteiro)
           VALUES (?,?,?,?,?,?)`,
          [estabelecimentoId, profissionalId, inicioDate, fimDate, motivo, diaInteiro ? 1 : 0]
        );

        // Guard contra bloqueio fantasma: antes disto dava para bloquear por cima de um
        // agendamento confirmado e o bloqueio simplesmente sumia da grade (o rótulo 'agendado'
        // ganha do 'bloqueado'). Aqui o dono é avisado e decide.
        // REGRA CENTRAL: bloqueio de um profissional só conflita com agendamentos DELE.
        // O FOR UPDATE é obrigatório mesmo sendo só leitura: é ele que faz esta transação
        // ESPERAR por um booking ainda não commitado, em vez de ler "não tem nada" e commitar
        // um bloqueio por cima. A faixa varrida é ampla (o índice é por `inicio`, então o
        // range vai do começo da agenda do estabelecimento até `fim`); aceitável porque esta
        // transação é só INSERT + SELECT + COMMIT, sem chamada externa no meio.
        let conflictSql = `SELECT a.id, a.inicio, a.fim, a.profissional_id, u.nome AS cliente_nome
             FROM agendamentos a
             JOIN usuarios u ON u.id = a.cliente_id
            WHERE a.estabelecimento_id=?
              AND ${activeAppointmentStatusWhere('a')}
              AND a.inicio < ?
              AND a.fim > ?`;
        const conflictParams = [estabelecimentoId, fimDate, inicioDate];
        if (profissionalId != null) {
          conflictSql += ' AND a.profissional_id=?';
          conflictParams.push(profissionalId);
        }
        conflictSql += ' ORDER BY a.inicio ASC FOR UPDATE';

        const [conflitos] = await conn.query(conflictSql, conflictParams);

        if (conflitos.length && !force) {
          // ROLLBACK desfaz o INSERT acima: sem `force` não pode sobrar bloqueio nenhum.
          return {
            commit: false,
            value: {
              status: 409,
              body: {
                error: 'conflito_agendamentos',
                agendamentos: conflitos.map((row) => ({
                  id: Number(row.id),
                  inicio: new Date(row.inicio).toISOString(),
                  fim: new Date(row.fim).toISOString(),
                  cliente_nome: row.cliente_nome ?? null,
                  profissional_id: row.profissional_id == null ? null : Number(row.profissional_id),
                })),
              },
            },
          };
        }

        // Com `force`, os agendamentos existentes NÃO são cancelados — quem resolve com o
        // cliente é o dono; cancelar por conta própria seria pior que o problema.
        return {
          commit: true,
          value: {
            status: 201,
            body: {
              bloqueio: serializeBloqueio({
                id: result.insertId,
                inicio: inicioDate,
                fim: fimDate,
                profissional_id: profissionalId,
                profissional_nome: profissionalNome,
                motivo,
                dia_inteiro: diaInteiro,
              }),
            },
          },
        };
      }, { opName: 'slots/bloqueios' });

      res.status(outcome.status).json(outcome.body);
    } catch (e) {
      console.error('POST /slots/bloqueios error:', e);
      res.status(500).json({ error: 'bloqueio_create_failed' });
    }
  }
);

/**
 * DELETE /slots/bloqueios/:id
 * 404 tanto para inexistente quanto para bloqueio de outro estabelecimento — o dono não
 * precisa saber que o id existe em outra agenda.
 */
router.delete(
  '/bloqueios/:id',
  auth,
  isEstabelecimento,
  ensureSubscriptionOperationalAccess(BLOCK_SUBSCRIPTION_GUARD),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'nao_encontrado' });

    try {
      const [result] = await pool.query(
        'DELETE FROM bloqueios WHERE id=? AND estabelecimento_id=?',
        [id, req.user.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'nao_encontrado' });
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE /slots/bloqueios error:', e);
      res.status(500).json({ error: 'bloqueio_delete_failed' });
    }
  }
);

/**
 * POST /slots/toggle
 * body: { slotDatetime }
 * — Bloqueia ou libera um intervalo de 30 min do estabelecimento logado.
 * Rota legada (o painel novo usa POST/DELETE /slots/bloqueios); mantida com o mesmo shape
 * de resposta { ok, action } para não quebrar cliente antigo.
 */
router.post('/toggle', auth, isEstabelecimento, ensureSubscriptionOperationalAccess(
  BLOCK_SUBSCRIPTION_GUARD
), async (req, res) => {
  const { slotDatetime } = req.body;
  if (!slotDatetime) return res.status(400).json({ error: 'missing_slot' });

  const inicioRaw = new Date(slotDatetime);
  const normalized = normalizeBlockInput({
    inicio: slotDatetime,
    fim: new Date(inicioRaw.getTime() + INTERVAL_MIN * 60000),
  });
  if (!normalized.ok) return res.status(400).json({ error: normalized.error });
  const { inicioDate, fimDate } = normalized;

  try {
    // Casa por intervalo EXATO e só entre bloqueios do estabelecimento inteiro: o toggle não
    // pode remover um bloqueio de profissional criado pelo painel novo.
    const [rows] = await pool.query(
      `SELECT id
         FROM bloqueios
        WHERE estabelecimento_id = ?
          AND profissional_id IS NULL
          AND inicio = ?
          AND fim = ?`,
      [req.user.id, inicioDate, fimDate]
    );

    if (rows.length) {
      await pool.query(`DELETE FROM bloqueios WHERE id = ?`, [rows[0].id]);
      return res.json({ ok: true, action: 'liberado' });
    }

    // Sem guard de agendamento aqui: é a rota legada, de janela fixa. Quem precisa do aviso
    // de conflito usa POST /slots/bloqueios.
    await pool.query(
      `INSERT INTO bloqueios (estabelecimento_id, inicio, fim) VALUES (?,?,?)`,
      [req.user.id, inicioDate, fimDate]
    );
    return res.json({ ok: true, action: 'bloqueado' });
  } catch (e) {
    console.error('POST /slots/toggle error:', e);
    res.status(500).json({ error: 'toggle_failed' });
  }
});

export default router;



