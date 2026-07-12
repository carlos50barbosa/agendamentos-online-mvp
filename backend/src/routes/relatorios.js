import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth as authRequired, isEstabelecimento } from '../middleware/auth.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } from '../lib/datetime_tz.js';
import {
  csvLine,
  formatCsvBoolean,
  formatCsvMoney,
  sanitizeFilenameSegment,
  startCsvResponse,
} from '../lib/csv.js';
import {
  parseLocalDate,
  formatLocalDate,
  shiftLocalDate,
  fillDailySeries,
  normalizeLeadTimeRows,
  buildServiceItemJoin,
  buildCustomerMixQuery,
  summarizeTotals,
  buildInsights,
} from '../lib/reporting.js';

const router = Router();

const RANGE_PRESETS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const DEFAULT_RANGE = '30d';
const VALID_STATUSES = new Set(['confirmado', 'pendente', 'cancelado', 'concluido']);
const TZ_OFFSET_MIN = EST_TZ_OFFSET_MIN;

const STATUS_CONFIRMED_SQL = "a.status IN ('confirmado','concluido')";
const STATUS_PLANNED_SQL = "a.status IN ('confirmado','pendente','concluido')";
// a.inicio/a.fim são gravados em UTC (ver EST_TZ_OFFSET_MIN); NOW() seguiria o fuso do MySQL.
const STATUS_CONCLUDED_SQL = "(a.status='concluido' OR (a.status='confirmado' AND a.fim < UTC_TIMESTAMP()))";
const STATUS_CANCELED_SQL = "a.status='cancelado'";
const STATUS_PENDING_SQL = "a.status='pendente'";
const STATUS_AWAITING_DEPOSIT_SQL = "a.status='pendente_pagamento'";
const NO_SHOW_SQL = 'COALESCE(a.no_show,0)=1';
const NOT_NO_SHOW_SQL = 'COALESCE(a.no_show,0)=0';

const pad2 = (value) => String(value).padStart(2, '0');

function formatDateTimeUtc(date) {
  if (!(date instanceof Date)) return null;
  if (Number.isNaN(date.getTime())) return null;
  return [
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`,
  ].join(' ');
}

function parseServiceIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => Number(String(part).trim()))
    .filter((num) => Number.isInteger(num) && num > 0);
}

function parseStatusFilters(raw) {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  parts.forEach((part) => {
    const value = String(part || '').trim().toLowerCase();
    if (!value || !VALID_STATUSES.has(value) || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function buildStatusFilterClause(statuses) {
  if (!statuses.length) return null;
  const set = new Set(statuses);
  const clauses = [];
  if (set.has('confirmado')) clauses.push("a.status='confirmado'");
  if (set.has('pendente')) clauses.push(STATUS_PENDING_SQL);
  if (set.has('cancelado')) clauses.push(STATUS_CANCELED_SQL);
  if (set.has('concluido')) clauses.push(STATUS_CONCLUDED_SQL);
  if (!clauses.length) return null;
  return `(${clauses.join(' OR ')})`;
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return raw.slice(0, 32);
}

function getLocalToday(tzOffsetMin) {
  const now = new Date();
  const localMs = now.getTime() + tzOffsetMin * 60_000;
  const local = new Date(localMs);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
}

// Um dia local [00:00, 23:59:59.999] convertido para os limites UTC gravados em a.inicio.
function toUtcBounds(startLocal, endLocal, tzOffsetMin) {
  const startUtcDate = makeUtcFromLocalYMDHM(startLocal.year, startLocal.month, startLocal.day, 0, 0, tzOffsetMin);
  const endUtcDate = makeUtcFromLocalYMDHM(endLocal.year, endLocal.month, endLocal.day, 23, 59, tzOffsetMin);
  endUtcDate.setUTCSeconds(59, 999);
  return {
    startLocal,
    endLocal,
    startUtcDate,
    endUtcDate,
    startUtc: formatDateTimeUtc(startUtcDate),
    endUtc: formatDateTimeUtc(endUtcDate),
  };
}

function resolveRange({ start, end, range, allowCustom, tzOffsetMin }) {
  let startLocal = null;
  let endLocal = null;
  if (allowCustom && start && end) {
    startLocal = parseLocalDate(start);
    endLocal = parseLocalDate(end);
    if (!startLocal || !endLocal) {
      return { error: 'invalid_range', message: 'Datas inválidas no filtro.' };
    }
  } else if (allowCustom && (start || end)) {
    return { error: 'invalid_range', message: 'Informe data inicial e final.' };
  } else {
    const days = RANGE_PRESETS[String(range)] || RANGE_PRESETS[DEFAULT_RANGE];
    endLocal = getLocalToday(tzOffsetMin);
    startLocal = shiftLocalDate(endLocal, -(days - 1));
  }

  const current = toUtcBounds(startLocal, endLocal, tzOffsetMin);

  if (!current.startUtc || !current.endUtc) {
    return { error: 'invalid_range', message: 'Datas inválidas no filtro.' };
  }

  if (current.startUtcDate.getTime() > current.endUtcDate.getTime()) {
    return { error: 'invalid_range', message: 'Data inicial maior que a data final.' };
  }

  const days = Math.round((Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day) -
    Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day)) / (24 * 60 * 60 * 1000)) + 1;

  // Período anterior: mesma duração, imediatamente antes. É a régua dos deltas dos KPIs.
  const previous = {
    ...toUtcBounds(shiftLocalDate(startLocal, -days), shiftLocalDate(startLocal, -1), tzOffsetMin),
    days,
  };

  return { ...current, days, previous };
}

function buildBaseFilters({
  estId,
  startUtc,
  endUtc,
  statusClause,
  profissionalId,
  origem,
  serviceIds,
  useServiceExists,
}) {
  const filters = ['a.estabelecimento_id = ?', 'a.inicio BETWEEN ? AND ?'];
  const params = [estId, startUtc, endUtc];

  if (profissionalId) {
    filters.push('a.profissional_id = ?');
    params.push(profissionalId);
  }

  if (origem) {
    if (origem === 'desconhecido') {
      filters.push("(a.origem IS NULL OR a.origem='')");
    } else {
      filters.push('a.origem = ?');
      params.push(origem);
    }
  }

  if (statusClause) filters.push(statusClause);

  if (useServiceExists && serviceIds.length) {
    const placeholders = serviceIds.map(() => '?').join(', ');
    filters.push(
      `EXISTS (SELECT 1 FROM agendamento_itens ai_f WHERE ai_f.agendamento_id = a.id AND ai_f.servico_id IN (${placeholders}))`
    );
    params.push(...serviceIds);
  }

  return {
    whereClause: filters.join(' AND '),
    params,
  };
}

const CSV_STATUS_LABELS = {
  confirmado: 'Confirmado',
  pendente: 'Pendente',
  pendente_pagamento: 'Aguardando sinal',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
};

// Mesma consulta de totais para o período atual e para o anterior — os deltas só significam
// alguma coisa se as duas janelas forem medidas pela mesma régua.
function buildTotalsSql(itemJoinSql, whereClause) {
  return `
      SELECT
        COUNT(DISTINCT a.id) AS agendados_total,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONFIRMED_SQL} THEN a.id END) AS confirmados_total,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN a.id END) AS concluidos_total,
        COUNT(DISTINCT CASE WHEN ${STATUS_CANCELED_SQL} THEN a.id END) AS cancelados_total,
        COUNT(DISTINCT CASE WHEN ${STATUS_PENDING_SQL} THEN a.id END) AS pendentes_total,
        COUNT(DISTINCT CASE WHEN ${STATUS_AWAITING_DEPOSIT_SQL} THEN a.id END) AS aguardando_sinal_total,
        COUNT(DISTINCT CASE WHEN ${NO_SHOW_SQL} THEN a.id END) AS no_show_total,
        COALESCE(SUM(CASE WHEN ${STATUS_PLANNED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_prevista,
        COALESCE(SUM(CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_concluida,
        COALESCE(SUM(CASE WHEN ${STATUS_CANCELED_SQL} OR ${NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_perdida
      FROM agendamentos a
      ${itemJoinSql}
      WHERE ${whereClause}`;
}

function buildCsvHeaders() {
  return [
    { key: 'data', label: 'Data' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'servico', label: 'Serviço' },
    { key: 'profissional', label: 'Profissional' },
    { key: 'inicio', label: 'Início' },
    { key: 'fim', label: 'Fim' },
    { key: 'status', label: 'Status' },
    // no_show é gravado junto de status='concluido'; sem esta coluna o export não os separa.
    { key: 'no_show', label: 'No-show' },
    { key: 'valor', label: 'Valor (BRL)' },
    { key: 'origem', label: 'Origem' },
    { key: 'criado_em', label: 'Criado em' },
  ];
}

function formatCsvCell(row, key) {
  if (key === 'valor') return formatCsvMoney(row.valor_centavos);
  if (key === 'status') return CSV_STATUS_LABELS[row.status] || row.status;
  if (key === 'no_show') return formatCsvBoolean(Number(row.no_show || 0) === 1);
  return row[key];
}

async function resolveReportContext(req, { requireAdvanced = false } = {}) {
  const estId = req.user.id;
  const planContext = await getPlanContext(estId);
  if (!planContext) {
    return { error: { status: 404, body: { error: 'not_found', message: 'Estabelecimento não encontrado.' } } };
  }

  const planStatus = planContext.status || 'trialing';
  if (isDelinquentStatus(planStatus)) {
    return {
      error: {
        status: 402,
        body: { error: 'plan_delinquent', message: 'Sua assinatura está em atraso. Regularize o pagamento para acessar os relatórios.' },
      },
    };
  }

  const allowAdvanced = !!planContext.config?.allowAdvancedReports;
  if (requireAdvanced && !allowAdvanced) {
    return {
      error: {
        status: 403,
        body: { error: 'plan_restricted', message: 'Relatórios avançados disponíveis a partir do plano Pro.' },
      },
    };
  }

  const { start, end, range } = req.query || {};
  const rangeData = resolveRange({
    start,
    end,
    range,
    allowCustom: allowAdvanced,
    tzOffsetMin: TZ_OFFSET_MIN,
  });
  if (rangeData.error) {
    return { error: { status: 400, body: { error: rangeData.error, message: rangeData.message } } };
  }

  const statusFilters = allowAdvanced ? parseStatusFilters(req.query.status) : [];
  const statusClause = allowAdvanced ? buildStatusFilterClause(statusFilters) : null;

  const serviceParam = allowAdvanced
    ? (req.query.serviceId || req.query.service || req.query.servicoId || req.query.serviceIds || req.query.servico_ids)
    : null;
  const serviceIds = allowAdvanced ? parseServiceIds(serviceParam) : [];

  const profissionalIdRaw = allowAdvanced
    ? (req.query.profissionalId || req.query.profissional_id || req.query.profissional)
    : null;
  const profissionalId = profissionalIdRaw ? Number(profissionalIdRaw) : null;
  const profissionalFilter = Number.isFinite(profissionalId) && profissionalId > 0 ? profissionalId : null;

  const origem = allowAdvanced ? normalizeOrigin(req.query.origem || req.query.canal) : null;

  const planPayload = {
    code: planContext.plan,
    status: planStatus,
    trial_ends_at: planContext.trialEndsAt ? planContext.trialEndsAt.toISOString() : null,
    active_until: planContext.activeUntil ? planContext.activeUntil.toISOString() : null,
    allow_advanced: allowAdvanced,
  };

  return {
    estId,
    allowAdvanced,
    rangeData,
    filters: {
      statusFilters,
      statusClause,
      serviceIds,
      profissionalId: profissionalFilter,
      origem,
    },
    planPayload,
  };
}

async function handleOverview(req, res) {
  try {
    const context = await resolveReportContext(req);
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }

    const { estId, allowAdvanced, rangeData, filters, planPayload } = context;
    const { startLocal, endLocal, startUtc, endUtc, startUtcDate, endUtcDate, days, previous } = rangeData;
    const { statusClause, statusFilters, serviceIds, profissionalId, origem } = filters;

    const filtersFor = (windowStartUtc, windowEndUtc) => buildBaseFilters({
      estId,
      startUtc: windowStartUtc,
      endUtc: windowEndUtc,
      statusClause,
      profissionalId,
      origem,
      serviceIds,
      useServiceExists: true,
    });

    const baseFilters = filtersFor(startUtc, endUtc);
    // Restringe os itens aos serviços filtrados, para que a receita dos KPIs bata com a
    // da tabela "Por serviço" (ver buildServiceItemJoin).
    const itemJoin = buildServiceItemJoin(serviceIds);

    // Período anterior: mesmos filtros, janela deslocada.
    const previousFilters = filtersFor(previous.startUtc, previous.endUtc);

    const dailySql = `
      SELECT
        DATE_FORMAT(DATE_ADD(a.inicio, INTERVAL ? MINUTE), '%Y-%m-%d') AS dia,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONFIRMED_SQL} THEN a.id END) AS confirmados,
        COUNT(DISTINCT CASE WHEN ${STATUS_CANCELED_SQL} THEN a.id END) AS cancelados,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN a.id END) AS concluidos,
        COUNT(DISTINCT CASE WHEN ${NO_SHOW_SQL} THEN a.id END) AS no_show,
        COALESCE(SUM(CASE WHEN ${STATUS_PLANNED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_prevista,
        COALESCE(SUM(CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_concluida
      FROM agendamentos a
      ${itemJoin.sql}
      WHERE ${baseFilters.whereClause}
      GROUP BY dia
      ORDER BY dia`;

    // A tabela por serviço agrega no nível do item (uma linha por serviço), então o recorte
    // por serviço entra no WHERE em vez do EXISTS usado nas demais.
    const serviceFilters = buildBaseFilters({
      estId,
      startUtc,
      endUtc,
      statusClause,
      profissionalId,
      origem,
      serviceIds,
      useServiceExists: false,
    });
    const servicePlaceholders = serviceIds.length ? serviceIds.map(() => '?').join(', ') : '';
    const serviceWhere = serviceIds.length
      ? `${serviceFilters.whereClause} AND ai.servico_id IN (${servicePlaceholders})`
      : serviceFilters.whereClause;
    const serviceParams = serviceIds.length
      ? [...serviceFilters.params, ...serviceIds]
      : serviceFilters.params;

    const servicesSql = `
      SELECT
        s.id AS servico_id,
        s.nome,
        COUNT(DISTINCT a.id) AS total,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONFIRMED_SQL} THEN a.id END) AS confirmados,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN a.id END) AS concluidos,
        COUNT(DISTINCT CASE WHEN ${STATUS_CANCELED_SQL} THEN a.id END) AS cancelados,
        COALESCE(SUM(CASE WHEN ${STATUS_PLANNED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_prevista,
        COALESCE(SUM(CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_concluida
      FROM agendamentos a
      JOIN agendamento_itens ai ON ai.agendamento_id = a.id
      JOIN servicos s ON s.id = ai.servico_id
      WHERE ${serviceWhere}
      GROUP BY s.id, s.nome
      ORDER BY total DESC, receita_prevista DESC, s.nome ASC
      ${serviceIds.length ? '' : 'LIMIT 10'}`;

    const dowSql = `
      SELECT
        MOD(WEEKDAY(DATE_ADD(a.inicio, INTERVAL ? MINUTE)) + 1, 7) AS dow,
        COUNT(DISTINCT a.id) AS total,
        COALESCE(SUM(CASE WHEN ${STATUS_PLANNED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_prevista,
        COALESCE(SUM(CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_concluida
      FROM agendamentos a
      ${itemJoin.sql}
      WHERE ${baseFilters.whereClause}
      GROUP BY dow
      ORDER BY dow`;

    const leadSql = `
      SELECT
        CASE
          WHEN GREATEST(0, TIMESTAMPDIFF(DAY, a.criado_em, a.inicio)) <= 1 THEN '0-1d'
          WHEN GREATEST(0, TIMESTAMPDIFF(DAY, a.criado_em, a.inicio)) <= 3 THEN '2-3d'
          WHEN GREATEST(0, TIMESTAMPDIFF(DAY, a.criado_em, a.inicio)) <= 7 THEN '4-7d'
          WHEN GREATEST(0, TIMESTAMPDIFF(DAY, a.criado_em, a.inicio)) <= 14 THEN '8-14d'
          ELSE '15+d'
        END AS bucket,
        COUNT(DISTINCT a.id) AS total
      FROM agendamentos a
      WHERE ${baseFilters.whereClause}
      GROUP BY bucket`;

    const customerMixQuery = buildCustomerMixQuery({
      estId,
      startUtc,
      endUtc,
      whereClause: baseFilters.whereClause,
      whereParams: baseFilters.params,
    });

    // O select de origens ignora o filtro de origem — é ele que popula a própria lista de opções.
    const originsFilters = allowAdvanced
      ? buildBaseFilters({
        estId,
        startUtc,
        endUtc,
        statusClause,
        profissionalId,
        origem: null,
        serviceIds,
        useServiceExists: true,
      })
      : null;
    const originsSql = `
        SELECT
          COALESCE(NULLIF(a.origem,''), 'desconhecido') AS origem,
          COUNT(DISTINCT a.id) AS total
        FROM agendamentos a
        WHERE ${originsFilters?.whereClause || '1=0'}
        GROUP BY origem
        ORDER BY total DESC, origem ASC
        LIMIT 12`;

    // As agregações são independentes entre si: uma rodada em paralelo em vez de 8 idas ao banco.
    const [
      [[totalsRow]],
      [[previousRow]],
      [dailyRows],
      [servicesRows],
      [dowRows],
      [leadRows],
      [[customerMixRow]],
      [originsRows],
    ] = await Promise.all([
      pool.query(
        buildTotalsSql(itemJoin.sql, baseFilters.whereClause),
        [...itemJoin.params, ...baseFilters.params]
      ),
      pool.query(
        buildTotalsSql(itemJoin.sql, previousFilters.whereClause),
        [...itemJoin.params, ...previousFilters.params]
      ),
      pool.query(dailySql, [TZ_OFFSET_MIN, ...itemJoin.params, ...baseFilters.params]),
      pool.query(servicesSql, serviceParams),
      pool.query(dowSql, [TZ_OFFSET_MIN, ...itemJoin.params, ...baseFilters.params]),
      pool.query(leadSql, baseFilters.params),
      pool.query(customerMixQuery.sql, customerMixQuery.params),
      originsFilters ? pool.query(originsSql, originsFilters.params) : Promise.resolve([[]]),
    ]);

    const { totals, rates, revenue } = summarizeTotals(totalsRow);
    const previousSummary = summarizeTotals(previousRow);
    const seriesDaily = fillDailySeries(dailyRows || [], startLocal, endLocal);
    const leadTime = normalizeLeadTimeRows(leadRows || []);

    const topServices = (servicesRows || []).map((row) => {
      const concluidos = Number(row.concluidos || 0);
      const receitaConcluida = Number(row.receita_concluida || 0);
      return {
        servico_id: row.servico_id,
        nome: row.nome,
        total: Number(row.total || 0),
        confirmados: Number(row.confirmados || 0),
        concluidos,
        cancelados: Number(row.cancelados || 0),
        receita_prevista: Number(row.receita_prevista || 0),
        receita_concluida: receitaConcluida,
        ticket_medio: concluidos ? Math.round(receitaConcluida / concluidos) : 0,
      };
    });

    const topDaysOfWeek = (dowRows || []).map((row) => ({
      dow: Number(row.dow),
      total: Number(row.total || 0),
      receita_prevista: Number(row.receita_prevista || 0),
      receita_concluida: Number(row.receita_concluida || 0),
    }));

    const customerMixTotals = {
      new_clients: Number(customerMixRow?.new_clients || 0),
      recurring_clients: Number(customerMixRow?.recurring_clients || 0),
    };

    const origins = (originsRows || []).map((row) => ({
      origem: row.origem,
      total: Number(row.total || 0),
    }));

    const insights = buildInsights({
      totals,
      revenue,
      previous: { totals: previousSummary.totals, revenue: previousSummary.revenue },
      topDaysOfWeek,
      leadTime,
      topServices,
      customerMix: customerMixTotals,
      rangeDays: days,
    });

    const now = new Date();
    res.json({
      plan: planPayload,
      range: {
        start: startUtcDate.toISOString(),
        end: endUtcDate.toISOString(),
        start_local: formatLocalDate(startLocal),
        end_local: formatLocalDate(endLocal),
        days,
      },
      previous: {
        range: {
          start: previous.startUtcDate.toISOString(),
          end: previous.endUtcDate.toISOString(),
          start_local: formatLocalDate(previous.startLocal),
          end_local: formatLocalDate(previous.endLocal),
          days: previous.days,
        },
        totals: previousSummary.totals,
        rates: previousSummary.rates,
        revenue: previousSummary.revenue,
      },
      insights,
      filters: {
        status: statusFilters.length ? statusFilters : ['all'],
        serviceIds,
        profissionalId,
        origem: origem || 'all',
      },
      generated_at: now.toISOString(),
      totals,
      rates,
      revenue,
      series_daily: seriesDaily,
      top_services: topServices,
      top_days_of_week: topDaysOfWeek,
      lead_time: leadTime,
      customer_mix: customerMixTotals,
      origins,
    });
  } catch (err) {
    console.error('[relatorios][overview]', err);
    res.status(500).json({ error: 'internal_error', message: 'Falha ao gerar relatório.' });
  }
}

router.get('/estabelecimento/overview', authRequired, isEstabelecimento, handleOverview);
router.get('/estabelecimento', authRequired, isEstabelecimento, handleOverview);

router.get('/estabelecimento/profissionais', authRequired, isEstabelecimento, async (req, res) => {
  try {
    const context = await resolveReportContext(req, { requireAdvanced: true });
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }

    const { estId, rangeData, filters, planPayload } = context;
    const { startUtc, endUtc } = rangeData;
    const { statusClause, serviceIds, profissionalId, origem } = filters;

    const baseFilters = buildBaseFilters({
      estId,
      startUtc,
      endUtc,
      statusClause,
      profissionalId,
      origem,
      serviceIds,
      useServiceExists: true,
    });
    const itemJoin = buildServiceItemJoin(serviceIds);

    const profSql = `
      SELECT
        p.id AS profissional_id,
        p.nome AS profissional,
        COUNT(DISTINCT a.id) AS total,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN a.id END) AS concluidos,
        COUNT(DISTINCT CASE WHEN ${STATUS_CANCELED_SQL} THEN a.id END) AS cancelados,
        COUNT(DISTINCT CASE WHEN ${NO_SHOW_SQL} THEN a.id END) AS no_show,
        COALESCE(SUM(CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN ai.preco_snapshot ELSE 0 END), 0) AS receita_concluida,
        COALESCE(SUM(CASE WHEN ${STATUS_PLANNED_SQL} THEN ai.duracao_min ELSE 0 END), 0) AS duracao_min
      FROM profissionais p
      LEFT JOIN agendamentos a
        ON a.profissional_id = p.id
       AND ${baseFilters.whereClause}
      ${itemJoin.sql}
      WHERE p.estabelecimento_id = ?
      GROUP BY p.id, p.nome
      HAVING total > 0
      ORDER BY total DESC, receita_concluida DESC, p.nome ASC`;

    // Ordem dos '?': join de agendamentos, join de itens, WHERE.
    const params = [...baseFilters.params, ...itemJoin.params, estId];
    const [rows] = await pool.query(profSql, params);

    const profissionais = (rows || []).map((row) => {
      const concluidos = Number(row.concluidos || 0);
      const receita = Number(row.receita_concluida || 0);
      return {
        profissional_id: row.profissional_id,
        profissional: row.profissional,
        total: Number(row.total || 0),
        concluidos,
        cancelados: Number(row.cancelados || 0),
        no_show: Number(row.no_show || 0),
        receita_concluida: receita,
        ticket_medio: concluidos ? Math.round(receita / Math.max(concluidos, 1)) : 0,
        // Ocupacao estimada em minutos agendados no periodo
        ocupacao_estimativa: Number(row.duracao_min || 0),
      };
    });

    res.json({
      plan: planPayload,
      range: {
        start: rangeData.startUtcDate.toISOString(),
        end: rangeData.endUtcDate.toISOString(),
      },
      profissionais,
    });
  } catch (err) {
    console.error('[relatorios][profissionais]', err);
    res.status(500).json({ error: 'internal_error', message: 'Falha ao gerar relatório.' });
  }
});

router.get('/estabelecimento/funil', authRequired, isEstabelecimento, async (req, res) => {
  try {
    const context = await resolveReportContext(req, { requireAdvanced: true });
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }

    const { estId, rangeData, filters, planPayload } = context;
    const { startUtc, endUtc } = rangeData;
    const { statusClause, serviceIds, profissionalId, origem } = filters;

    const baseFilters = buildBaseFilters({
      estId,
      startUtc,
      endUtc,
      statusClause,
      profissionalId,
      origem,
      serviceIds,
      useServiceExists: true,
    });

    const funilSql = `
      SELECT
        COALESCE(NULLIF(a.origem,''), 'desconhecido') AS origem,
        COUNT(DISTINCT a.id) AS agendados,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONFIRMED_SQL} THEN a.id END) AS confirmados,
        COUNT(DISTINCT CASE WHEN ${STATUS_CONCLUDED_SQL} AND ${NOT_NO_SHOW_SQL} THEN a.id END) AS concluidos
      FROM agendamentos a
      WHERE ${baseFilters.whereClause}
      GROUP BY origem
      ORDER BY agendados DESC, origem ASC`;

    const [rows] = await pool.query(funilSql, baseFilters.params);
    const canais = (rows || []).map((row) => {
      const agendados = Number(row.agendados || 0);
      const confirmados = Number(row.confirmados || 0);
      const concluidos = Number(row.concluidos || 0);
      return {
        origem: row.origem,
        agendados,
        confirmados,
        concluidos,
        taxa_confirmacao: agendados ? confirmados / agendados : 0,
        taxa_conclusao: confirmados ? concluidos / Math.max(confirmados, 1) : 0,
      };
    });

    res.json({
      plan: planPayload,
      range: {
        start: rangeData.startUtcDate.toISOString(),
        end: rangeData.endUtcDate.toISOString(),
      },
      canais,
    });
  } catch (err) {
    console.error('[relatorios][funil]', err);
    res.status(500).json({ error: 'internal_error', message: 'Falha ao gerar relatório.' });
  }
});

router.get('/estabelecimento/export.csv', authRequired, isEstabelecimento, async (req, res) => {
  try {
    const context = await resolveReportContext(req, { requireAdvanced: true });
    if (context.error) {
      return res.status(context.error.status).json(context.error.body);
    }

    const { estId, rangeData, filters } = context;
    const { startLocal, endLocal, startUtc, endUtc } = rangeData;
    const { statusClause, serviceIds, profissionalId, origem } = filters;

    const baseFilters = buildBaseFilters({
      estId,
      startUtc,
      endUtc,
      statusClause,
      profissionalId,
      origem,
      serviceIds,
      useServiceExists: true,
    });

    const itemJoin = buildServiceItemJoin(serviceIds);
    const tzParams = [TZ_OFFSET_MIN, TZ_OFFSET_MIN, TZ_OFFSET_MIN, TZ_OFFSET_MIN];
    const exportSql = `
      SELECT
        DATE_FORMAT(DATE_ADD(a.inicio, INTERVAL ? MINUTE), '%Y-%m-%d') AS data,
        c.nome AS cliente,
        COALESCE(GROUP_CONCAT(DISTINCT s.nome ORDER BY ai.ordem SEPARATOR ' + '), '') AS servico,
        p.nome AS profissional,
        DATE_FORMAT(DATE_ADD(a.inicio, INTERVAL ? MINUTE), '%Y-%m-%d %H:%i') AS inicio,
        DATE_FORMAT(DATE_ADD(a.fim, INTERVAL ? MINUTE), '%Y-%m-%d %H:%i') AS fim,
        a.status,
        COALESCE(a.no_show, 0) AS no_show,
        COALESCE(SUM(ai.preco_snapshot), 0) AS valor_centavos,
        COALESCE(NULLIF(a.origem,''), 'desconhecido') AS origem,
        DATE_FORMAT(DATE_ADD(a.criado_em, INTERVAL ? MINUTE), '%Y-%m-%d %H:%i') AS criado_em
      FROM agendamentos a
      JOIN usuarios c ON c.id = a.cliente_id
      LEFT JOIN profissionais p ON p.id = a.profissional_id
      ${itemJoin.sql}
      LEFT JOIN servicos s ON s.id = ai.servico_id
      WHERE ${baseFilters.whereClause}
      GROUP BY a.id, c.nome, p.nome, a.inicio, a.fim, a.status, a.no_show, a.origem, a.criado_em
      ORDER BY a.inicio ASC`;
    // Ordem dos '?': SELECT (4x TZ), join de itens, WHERE.
    const exportParams = [...tzParams, ...itemJoin.params, ...baseFilters.params];

    const filenameBase = sanitizeFilenameSegment(
      `relatorio-${formatLocalDate(startLocal)}-a-${formatLocalDate(endLocal)}`
    );
    const filename = filenameBase ? `${filenameBase}.csv` : 'relatorio.csv';

    const headers = buildCsvHeaders();
    startCsvResponse(res, filename, headers.map((h) => h.label));

    const conn = await pool.getConnection();
    try {
      const query = conn.query(exportSql, exportParams);
      const stream = query.stream({ highWaterMark: 100 });

      await new Promise((resolve, reject) => {
        stream.on('data', (row) => {
          const linha = csvLine(headers.map((h) => formatCsvCell(row, h.key)));
          if (!res.write(linha)) {
            stream.pause();
            res.once('drain', () => stream.resume());
          }
        });

        stream.on('end', resolve);
        stream.on('error', reject);
        query.on('error', reject);
      });
      res.end();
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[relatorios][export]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Falha ao exportar relatório.' });
    }
  } finally {
    if (res.headersSent && !res.writableEnded) {
      res.end();
    }
  }
});

export default router;
