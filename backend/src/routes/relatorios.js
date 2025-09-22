import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth as authRequired, isEstabelecimento } from '../middleware/auth.js';
import { resolvePlanConfig, isDelinquentStatus } from '../lib/plans.js';

const router = Router();

const RANGE_PRESETS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

const STATUS_FILTERS = new Set(['confirmado', 'cancelado']);
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(date) {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function normalizeParamDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseServiceIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => Number(String(part).trim()))
    .filter((num) => Number.isInteger(num) && num > 0);
}

function fillDaily(rows, startDate, endDate) {
  const map = new Map();
  for (const row of rows) {
    const raw = row.dia;
    const key = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
    map.set(key, {
      confirmados: Number(row.confirmados || 0),
      cancelados: Number(row.cancelados || 0),
      receitaCentavos: Number(row.receita_centavos || 0),
    });
  }

  const out = [];
  const start = startOfDay(startDate).getTime();
  const end = endOfDay(endDate).getTime();
  for (let ts = start; ts <= end; ts += DAY_MS) {
    const current = new Date(ts);
    const key = current.toISOString().slice(0, 10);
    const value = map.get(key) || { confirmados: 0, cancelados: 0, receitaCentavos: 0 };
    out.push({
      date: key,
      confirmados: value.confirmados,
      cancelados: value.cancelados,
      receita_centavos: value.receitaCentavos,
    });
  }
  return out;
}

function buildCsv(headers, rows) {
  const escape = (value) => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map((h) => escape(h.label)).join(',');
  const lines = rows.map((row) => headers.map((h) => escape(row[h.key])).join(','));
  return [headerLine, ...lines].join('\n');
}

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/\s+/g, '-')
    .replace(/[^0-9A-Za-z_\-]/g, '')
    .toLowerCase();
}

router.get('/estabelecimento', authRequired, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    const now = new Date();

    const [accountRows] = await pool.query("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1", [estId]);
    const account = accountRows?.[0] || {};
    const plan = account.plan || 'starter';
    const planStatus = account.plan_status || 'trialing';
    const planConfig = resolvePlanConfig(plan);
    const planTrialEndsAtIso = account.plan_trial_ends_at ? new Date(account.plan_trial_ends_at).toISOString() : null;
    const planActiveUntilIso = account.plan_active_until ? new Date(account.plan_active_until).toISOString() : null;
    const delinquent = isDelinquentStatus(planStatus);
    if (delinquent) {
      return res.status(402).json({ error: 'plan_delinquent', message: 'Sua assinatura esta em atraso. Regularize o pagamento para acessar os relatorios.' });
    }
    const allowAdvancedFilters = !!planConfig.allowAdvancedReports;

    let { range = '30d', start, end } = req.query || {};

    if (!allowAdvancedFilters) {
      range = '30d';
      start = undefined;
      end = undefined;
    }

    const customStart = allowAdvancedFilters ? normalizeParamDate(start) : null;
    const customEnd = allowAdvancedFilters ? normalizeParamDate(end) : null;

    const endDate = customEnd ? endOfDay(customEnd) : endOfDay(now);

    let startDate;
    if (customStart) {
      startDate = startOfDay(customStart);
    } else {
      const days = RANGE_PRESETS[String(range)] || 30;
      startDate = startOfDay(new Date(endDate.getTime() - (days - 1) * DAY_MS));
    }

    if (startDate.getTime() > endDate.getTime()) {
      return res.status(400).json({
        error: 'invalid_range',
        message: 'Data inicial maior que a data final.',
      });
    }

    const statusParam = allowAdvancedFilters ? String(req.query.status || '').toLowerCase() : '';
    const statusFilter = allowAdvancedFilters && STATUS_FILTERS.has(statusParam) ? statusParam : null;

    const serviceParam = allowAdvancedFilters ? (req.query.serviceId || req.query.service || req.query.servicoId || req.query.serviceIds) : null;
    const serviceIds = allowAdvancedFilters ? parseServiceIds(serviceParam) : [];

    const filters = ['a.estabelecimento_id = ?', 'a.inicio BETWEEN ? AND ?'];
    const baseParams = [estId, formatDateTime(startDate), formatDateTime(endDate)];

    if (statusFilter) {
      filters.push('a.status = ?');
      baseParams.push(statusFilter);
    }

    let servicePlaceholders = '';
    if (serviceIds.length) {
      servicePlaceholders = serviceIds.map(() => '?').join(', ');
      filters.push(`a.servico_id IN (${servicePlaceholders})`);
      baseParams.push(...serviceIds);
    }

    const whereClause = filters.join(' AND ');

    const totalsParams = [...baseParams];
    const [totalsRows] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN a.status='confirmado' THEN 1 ELSE 0 END) AS confirmados,
         SUM(CASE WHEN a.status='cancelado' THEN 1 ELSE 0 END) AS cancelados,
         SUM(CASE WHEN a.status='confirmado' AND a.fim < NOW() THEN 1 ELSE 0 END) AS concluidos,
         SUM(CASE WHEN a.status='confirmado' AND a.inicio >= NOW() THEN 1 ELSE 0 END) AS futuros,
         COALESCE(SUM(CASE WHEN a.status='confirmado' THEN s.preco_centavos ELSE 0 END), 0) AS receita_confirmada,
         COALESCE(SUM(CASE WHEN a.status='confirmado' AND a.fim < NOW() THEN s.preco_centavos ELSE 0 END), 0) AS receita_concluida,
         COALESCE(SUM(CASE WHEN a.status='confirmado' AND a.inicio >= NOW() THEN s.preco_centavos ELSE 0 END), 0) AS receita_futura,
         COALESCE(SUM(CASE WHEN a.status='cancelado' THEN s.preco_centavos ELSE 0 END), 0) AS receita_perdida
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE ${whereClause}`,
      totalsParams
    );

    const dailyParams = [...baseParams];
    const [dailyRows] = await pool.query(
      `SELECT
         DATE(a.inicio) AS dia,
         SUM(CASE WHEN a.status='confirmado' THEN 1 ELSE 0 END) AS confirmados,
         SUM(CASE WHEN a.status='cancelado' THEN 1 ELSE 0 END) AS cancelados,
         COALESCE(SUM(CASE WHEN a.status='confirmado' THEN s.preco_centavos ELSE 0 END), 0) AS receita_centavos
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE ${whereClause}
       GROUP BY dia
       ORDER BY dia`,
      dailyParams
    );

    const servicesParams = [...baseParams];
    const orderClause = ' ORDER BY confirmados DESC, receita_centavos DESC, s.nome ASC';
    const limitClause = serviceIds.length ? '' : ' LIMIT 10';
    const [servicesRows] = await pool.query(
      `SELECT
         s.id,
         s.nome,
         COUNT(*) AS total,
         SUM(CASE WHEN a.status='confirmado' THEN 1 ELSE 0 END) AS confirmados,
         SUM(CASE WHEN a.status='cancelado' THEN 1 ELSE 0 END) AS cancelados,
         COALESCE(SUM(CASE WHEN a.status='confirmado' THEN s.preco_centavos ELSE 0 END), 0) AS receita_centavos
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE ${whereClause}
       GROUP BY s.id, s.nome${orderClause}${limitClause}`,
      servicesParams
    );

    const totalsRow = totalsRows?.[0] || {};

    const totals = {
      total: Number(totalsRow.total || 0),
      confirmados: Number(totalsRow.confirmados || 0),
      cancelados: Number(totalsRow.cancelados || 0),
      concluidos: Number(totalsRow.concluidos || 0),
      futuros: Number(totalsRow.futuros || 0),
      receitaConfirmadaCentavos: Number(totalsRow.receita_confirmada || 0),
      receitaConcluidaCentavos: Number(totalsRow.receita_concluida || 0),
      receitaFuturaCentavos: Number(totalsRow.receita_futura || 0),
      receitaPerdidaCentavos: Number(totalsRow.receita_perdida || 0),
    };

    totals.ticketMedioCentavos = totals.confirmados
      ? Math.round(totals.receitaConfirmadaCentavos / totals.confirmados)
      : 0;
    totals.ticketRealizadoCentavos = totals.concluidos
      ? Math.round(totals.receitaConcluidaCentavos / Math.max(totals.concluidos, 1))
      : 0;
    totals.cancelRate = totals.total ? totals.cancelados / totals.total : 0;
    totals.realizationRate = totals.confirmados
      ? totals.concluidos / Math.max(totals.confirmados, 1)
      : 0;

    const daily = fillDaily(dailyRows || [], startDate, endDate);

    const services = (servicesRows || []).map((row) => {
      const confirmados = Number(row.confirmados || 0);
      const receita = Number(row.receita_centavos || 0);
      return {
        id: row.id,
        nome: row.nome,
        total: Number(row.total || 0),
        confirmados,
        cancelados: Number(row.cancelados || 0),
        receita_centavos: receita,
        ticket_medio_centavos: confirmados ? Math.round(receita / Math.max(confirmados, 1)) : 0,
      };
    });

    const rangeTag = `${startDate.toISOString().slice(0, 10)}_a_${endDate.toISOString().slice(0, 10)}`;
    const downloadType = String(req.query.download || '').toLowerCase();

    if (!allowAdvancedFilters && downloadType) {
      return res.status(403).json({ error: 'plan_restricted', message: 'Relatorios avancados disponiveis a partir do plano Pro.' });
    }

    if (downloadType === 'daily') {
      const csv = buildCsv(
        [
          { key: 'date', label: 'Data' },
          { key: 'confirmados', label: 'Confirmados' },
          { key: 'cancelados', label: 'Cancelados' },
          { key: 'receita_centavos', label: 'Receita (centavos)' },
          { key: 'receita_reais', label: 'Receita (BRL)' },
        ],
        daily.map((item) => ({
          date: item.date,
          confirmados: item.confirmados,
          cancelados: item.cancelados,
          receita_centavos: item.receita_centavos,
          receita_reais: (Number(item.receita_centavos || 0) / 100).toFixed(2),
        }))
      );
      const filename = sanitizeSegment(`relatorio-diario-${rangeTag}-${statusFilter || 'all'}${serviceIds.length ? `-serv${serviceIds.join('.')}` : ''}`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send('\ufeff' + csv + '\n');
    }

    if (downloadType === 'services') {
      const csv = buildCsv(
        [
          { key: 'nome', label: 'Servico' },
          { key: 'total', label: 'Total' },
          { key: 'confirmados', label: 'Confirmados' },
          { key: 'cancelados', label: 'Cancelados' },
          { key: 'receita_centavos', label: 'Receita (centavos)' },
          { key: 'receita_reais', label: 'Receita (BRL)' },
          { key: 'ticket_medio_reais', label: 'Ticket medio (BRL)' },
        ],
        services.map((item) => ({
          nome: item.nome,
          total: item.total,
          confirmados: item.confirmados,
          cancelados: item.cancelados,
          receita_centavos: item.receita_centavos,
          receita_reais: (Number(item.receita_centavos || 0) / 100).toFixed(2),
          ticket_medio_reais: (Number(item.ticket_medio_centavos || 0) / 100).toFixed(2),
        }))
      );
      const filename = sanitizeSegment(`relatorio-servicos-${rangeTag}-${statusFilter || 'all'}${serviceIds.length ? `-serv${serviceIds.join('.')}` : ''}`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send('\ufeff' + csv + '\n');
    }

    res.json({
      plan: {
        code: plan,
        status: planStatus,
        trial_ends_at: planTrialEndsAtIso,
        active_until: planActiveUntilIso,
        allow_advanced: allowAdvancedFilters,
      },
      range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days: Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1,
      },
      filters: {
        status: statusFilter || 'all',
        serviceIds,
      },
      generated_at: now.toISOString(),
      totals,
      daily,
      services,
    });
  } catch (err) {
    console.error('[relatorios] erro', err);
    res.status(500).json({ error: 'internal_error', message: 'Falha ao gerar relatorio.' });
  }
});

export default router;



