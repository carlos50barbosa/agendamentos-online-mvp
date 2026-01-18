// src/pages/Relatorios.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import { IconDownload, IconChart } from '../components/Icons.jsx';

const CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

const PERCENT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});

const DETAIL_DATE = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const STATUS_FILTERS = [
  { value: 'confirmado', label: 'Confirmados' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'concluido', label: 'Concluidos' },
  { value: 'cancelado', label: 'Cancelados' },
];

const DEFAULT_RANGE = '30d';
const RANGE_OPTIONS = [
  { value: '7d', label: 'Ultimos 7 dias' },
  { value: '30d', label: 'Ultimos 30 dias' },
  { value: '90d', label: 'Ultimos 90 dias' },
  { value: 'custom', label: 'Intervalo personalizado' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function centsToCurrency(cents) {
  return CURRENCY.format((Number(cents) || 0) / 100);
}

function formatPercent(value) {
  if (!value) return PERCENT.format(0);
  return PERCENT.format(value);
}

function formatShortDate(dateString) {
  if (!dateString) return '';
  const parsed = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return SHORT_DATE.format(parsed);
}

function formatDetailedDate(dateString) {
  if (!dateString) return '';
  const parsed = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return DETAIL_DATE.format(parsed);
}

function ensureDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildPdfHtml({ rangeLabel, metrics, miniMetrics, dailyRows, serviceRows }) {
  const metricCards = metrics.map((metric) => `
    <div class="kpi">
      <span>${metric.label}</span>
      <strong>${metric.value}</strong>
      ${metric.hint ? `<small>${metric.hint}</small>` : ''}
    </div>
  `).join('');

  const miniCards = miniMetrics.map((metric) => `
    <div class="kpi kpi--mini">
      <span>${metric.label}</span>
      <strong>${metric.value}</strong>
    </div>
  `).join('');

  const dailyLines = dailyRows.map((row) => `
    <tr>
      <td>${formatDetailedDate(row.date)}</td>
      <td>${row.confirmados}</td>
      <td>${row.cancelados}</td>
      <td>${row.concluidos}</td>
      <td>${row.no_show}</td>
      <td>${centsToCurrency(row.receita_dia)}</td>
    </tr>
  `).join('');

  const serviceLines = serviceRows.map((row) => `
    <tr>
      <td>${row.nome}</td>
      <td>${row.total}</td>
      <td>${row.confirmados}</td>
      <td>${row.cancelados}</td>
      <td>${row.concluidos}</td>
      <td>${centsToCurrency(row.receita)}</td>
      <td>${centsToCurrency(row.ticket_medio)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Relatorios</title>
      <style>
        body { font-family: Arial, sans-serif; color:#0f172a; margin:24px; }
        h1 { font-size:20px; margin:0 0 6px; }
        .muted { color:#64748b; font-size:12px; margin-bottom:16px; }
        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:16px; }
        .kpi { border:1px solid #e2e8f0; border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:6px; }
        .kpi span { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; }
        .kpi strong { font-size:18px; }
        .kpi small { font-size:11px; color:#64748b; }
        table { width:100%; border-collapse:collapse; margin-bottom:18px; }
        th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:12px; }
        th { background:#f8fafc; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; }
        .section-title { font-size:14px; margin:16px 0 8px; }
      </style>
    </head>
    <body>
      <h1>Relatorios do estabelecimento</h1>
      ${rangeLabel ? `<div class="muted">${rangeLabel}</div>` : ''}
      <div class="grid">${metricCards}</div>
      <div class="grid">${miniCards}</div>
      <div class="section-title">Resumo diario</div>
      <table>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Confirmados</th>
            <th>Cancelados</th>
            <th>Concluidos</th>
            <th>No-show</th>
            <th>Receita</th>
          </tr>
        </thead>
        <tbody>
          ${dailyLines || '<tr><td colspan="6">Sem dados no periodo.</td></tr>'}
        </tbody>
      </table>
      <div class="section-title">Servicos com mais agendamentos</div>
      <table>
        <thead>
          <tr>
            <th>Servico</th>
            <th>Total</th>
            <th>Confirmados</th>
            <th>Cancelados</th>
            <th>Concluidos</th>
            <th>Receita</th>
            <th>Ticket medio</th>
          </tr>
        </thead>
        <tbody>
          ${serviceLines || '<tr><td colspan="7">Sem dados no periodo.</td></tr>'}
        </tbody>
      </table>
    </body>
  </html>`;
}

export default function Relatorios() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';

  const [range, setRange] = useState(DEFAULT_RANGE);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [statusFilters, setStatusFilters] = useState([]);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [profissionalFilter, setProfissionalFilter] = useState('all');
  const [origemFilter, setOrigemFilter] = useState('all');

  const [serviceOptions, setServiceOptions] = useState([]);
  const [profissionalOptions, setProfissionalOptions] = useState([]);

  const [data, setData] = useState(null);
  const [funilData, setFunilData] = useState([]);
  const [profissionaisData, setProfissionaisData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingPro, setLoadingPro] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [proError, setProError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tableTab, setTableTab] = useState('daily');

  const isCustom = range === 'custom';
  const allowAdvanced = !!data?.plan?.allow_advanced;
  const rangeOptions = allowAdvanced ? RANGE_OPTIONS : RANGE_OPTIONS.filter((opt) => opt.value !== 'custom');
  const showCustomRangeInputs = allowAdvanced && isCustom;

  useEffect(() => {
    if (!isEstab) return undefined;
    let active = true;
    Api.servicosList()
      .then((rows) => {
        if (active) setServiceOptions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setServiceOptions([]);
      });
    Api.profissionaisList()
      .then((rows) => {
        if (active) setProfissionalOptions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setProfissionalOptions([]);
      });
    return () => { active = false; };
  }, [isEstab]);

  useEffect(() => {
    if (!showCustomRangeInputs) return;
    if (customStart && customEnd) return;
    const end = new Date();
    const start = new Date(end.getTime() - 29 * DAY_MS);
    setCustomStart((prev) => prev || ensureDateString(start));
    setCustomEnd((prev) => prev || ensureDateString(end));
  }, [showCustomRangeInputs, customStart, customEnd]);

  useEffect(() => {
    if (allowAdvanced) return;
    if (statusFilters.length) setStatusFilters([]);
    if (serviceFilter !== 'all') setServiceFilter('all');
    if (profissionalFilter !== 'all') setProfissionalFilter('all');
    if (origemFilter !== 'all') setOrigemFilter('all');
    if (customStart) setCustomStart('');
    if (customEnd) setCustomEnd('');
    if (range === 'custom') setRange(DEFAULT_RANGE);
  }, [allowAdvanced, statusFilters, serviceFilter, profissionalFilter, origemFilter, customStart, customEnd, range]);

  useEffect(() => {
    if (!allowAdvanced && tableTab === 'profissionais') {
      setTableTab('daily');
    }
  }, [allowAdvanced, tableTab]);

  const filterError = useMemo(() => {
    if (!showCustomRangeInputs) return '';
    if (!customStart || !customEnd) return 'Informe data inicial e final para gerar o relatorio.';
    if (customStart > customEnd) return 'A data inicial nao pode ser maior que a data final.';
    return '';
  }, [showCustomRangeInputs, customStart, customEnd]);

  const currentParams = useMemo(() => {
    const base = allowAdvanced && isCustom
      ? { start: customStart, end: customEnd }
      : { range };
    if (allowAdvanced && statusFilters.length) base.status = statusFilters.join(',');
    if (allowAdvanced && serviceFilter !== 'all') base.serviceId = serviceFilter;
    if (allowAdvanced && profissionalFilter !== 'all') base.profissionalId = profissionalFilter;
    if (allowAdvanced && origemFilter !== 'all') base.origem = origemFilter;
    return base;
  }, [
    allowAdvanced,
    isCustom,
    customStart,
    customEnd,
    range,
    statusFilters,
    serviceFilter,
    profissionalFilter,
    origemFilter,
  ]);

  useEffect(() => {
    if (!isEstab) return undefined;
    if (showCustomRangeInputs && filterError) {
      setError(filterError);
      setData(null);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');

    Api.relatoriosOverview(currentParams)
      .then((resp) => {
        if (!active) return;
        setData(resp || null);
      })
      .catch((err) => {
        if (!active) return;
        const message = err?.message || 'Nao foi possivel carregar os relatorios.';
        setError(message);
        setData(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => { active = false; };
  }, [isEstab, showCustomRangeInputs, filterError, currentParams, refreshKey]);

  useEffect(() => {
    if (!isEstab || !allowAdvanced) {
      setFunilData([]);
      setProfissionaisData([]);
      setLoadingPro(false);
      setProError('');
      return undefined;
    }
    if (showCustomRangeInputs && filterError) return undefined;

    let active = true;
    setLoadingPro(true);
    setProError('');

    Promise.all([
      Api.relatoriosFunil(currentParams),
      Api.relatoriosProfissionais(currentParams),
    ])
      .then(([funilResp, profResp]) => {
        if (!active) return;
        setFunilData(Array.isArray(funilResp?.canais) ? funilResp.canais : []);
        setProfissionaisData(Array.isArray(profResp?.profissionais) ? profResp.profissionais : []);
      })
      .catch((err) => {
        if (!active) return;
        const message = err?.message || 'Nao foi possivel carregar os relatorios Pro.';
        setProError(message);
        setFunilData([]);
        setProfissionaisData([]);
      })
      .finally(() => {
        if (!active) return;
        setLoadingPro(false);
      });

    return () => { active = false; };
  }, [isEstab, allowAdvanced, showCustomRangeInputs, filterError, currentParams]);

  const totals = data?.totals;
  const rates = data?.rates;
  const revenue = data?.revenue;

  const metrics = useMemo(() => {
    if (!totals || !revenue) return [];
    const totalAgendamentos = Number(totals.agendados_total || 0);
    const confirmados = Number(totals.confirmados_total || 0);
    const cancelados = Number(totals.cancelados_total || 0);
    const concluidos = Number(totals.concluidos_total || 0);

    const confirmShare = totalAgendamentos ? confirmados / totalAgendamentos : 0;
    const cancelShare = totalAgendamentos ? cancelados / totalAgendamentos : 0;
    const realizationRate = confirmados ? concluidos / Math.max(confirmados, 1) : 0;

    return [
      {
        key: 'total',
        label: 'Agendamentos',
        value: totalAgendamentos,
        hint: totalAgendamentos ? `${formatPercent(confirmShare)} confirmados` : null,
      },
      {
        key: 'concluidos',
        label: 'Concluidos',
        value: concluidos,
        hint: confirmados ? `${formatPercent(realizationRate)} dos confirmados` : null,
      },
      {
        key: 'cancelados',
        label: 'Cancelados',
        value: cancelados,
        hint: cancelados ? `${formatPercent(cancelShare)} do total` : null,
      },
      {
        key: 'receitaConcluida',
        label: 'Receita concluida',
        value: centsToCurrency(revenue.concluida),
        hint: revenue.perdida ? `Perdida: ${centsToCurrency(revenue.perdida)}` : null,
      },
      {
        key: 'receitaPrevista',
        label: 'Receita prevista',
        value: centsToCurrency(revenue.prevista),
        hint: null,
      },
      {
        key: 'ticketMedio',
        label: 'Ticket medio',
        value: centsToCurrency(revenue.ticket_medio),
        hint: null,
      },
    ];
  }, [totals, revenue]);

  const miniMetrics = useMemo(() => {
    if (!totals || !rates || !revenue) return [];
    return [
      {
        key: 'taxaConfirmacao',
        label: 'Taxa de confirmacao',
        value: formatPercent(rates.taxa_confirmacao || 0),
      },
      {
        key: 'taxaComparecimento',
        label: 'Taxa de comparecimento',
        value: formatPercent(rates.taxa_comparecimento || 0),
      },
      {
        key: 'receitaPerdida',
        label: 'Receita perdida',
        value: centsToCurrency(revenue.perdida || 0),
      },
      {
        key: 'noShow',
        label: 'No-show',
        value: Number(totals.no_show_total || 0),
      },
    ];
  }, [totals, rates, revenue]);

  const dailyData = data?.series_daily || [];

  const displayDaily = useMemo(() => {
    if (!dailyData.length) return [];
    if (dailyData.length <= 30) return dailyData;
    return dailyData.slice(dailyData.length - 30);
  }, [dailyData]);

  const maxVolume = useMemo(() => {
    if (!displayDaily.length) return 0;
    return displayDaily.reduce((acc, item) => {
      const total = Number(item.confirmados || 0) + Number(item.cancelados || 0);
      return Math.max(acc, total);
    }, 0);
  }, [displayDaily]);

  const services = data?.top_services || [];

  const daysOfWeek = useMemo(() => {
    const map = new Map((data?.top_days_of_week || []).map((row) => [Number(row.dow), row]));
    return WEEKDAY_LABELS.map((label, idx) => {
      const row = map.get(idx) || {};
      return {
        dow: idx,
        label,
        total: Number(row.total || 0),
        receita: Number(row.receita || 0),
      };
    });
  }, [data]);

  const leadTime = useMemo(() => (
    Array.isArray(data?.lead_time) ? data.lead_time : []
  ), [data]);

  const funnelTotals = useMemo(() => {
    if (!funilData.length) return null;
    return funilData.reduce((acc, item) => ({
      agendados: acc.agendados + Number(item.agendados || 0),
      confirmados: acc.confirmados + Number(item.confirmados || 0),
      concluidos: acc.concluidos + Number(item.concluidos || 0),
    }), { agendados: 0, confirmados: 0, concluidos: 0 });
  }, [funilData]);

  const selectedService = useMemo(
    () => serviceOptions.find((svc) => String(svc.id) === String(serviceFilter)),
    [serviceOptions, serviceFilter]
  );

  const originsOptions = useMemo(() => {
    if (!Array.isArray(data?.origins)) return [];
    return data.origins.map((row) => ({
      value: row.origem,
      label: row.origem === 'desconhecido' ? 'Desconhecido' : row.origem,
    }));
  }, [data]);

  const handleDownload = async () => {
    if (!data || !allowAdvanced) {
      setError('Exportacao disponivel a partir do plano Pro.');
      return;
    }
    if (showCustomRangeInputs && filterError) {
      setError(filterError);
      return;
    }

    try {
      setExporting(true);
      const { blob, filename } = await Api.downloadRelatorio(currentParams);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err?.message || 'Falha ao exportar CSV.';
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = () => {
    if (!data || !allowAdvanced) {
      setError('Exportacao disponivel a partir do plano Pro.');
      return;
    }
    const rangeLabel = renderRangeSummary(true);
    const payload = {
      rangeLabel,
      metrics,
      miniMetrics,
      dailyRows: dailyData.slice(-14),
      serviceRows: services,
    };
    const win = window.open('', '_blank');
    if (!win) {
      setError('Permita popups para gerar o PDF.');
      return;
    }
    win.document.write(buildPdfHtml(payload));
    win.document.close();
    win.focus();
    win.print();
  };

  const renderRangeSummary = (returnText = false) => {
    if (!data?.range) return returnText ? '' : null;
    const { start_local: startLocal, end_local: endLocal, start, end, days } = data.range;
    const startLabel = startLocal ? formatDetailedDate(startLocal) : new Date(start).toLocaleDateString('pt-BR');
    const endLabel = endLocal ? formatDetailedDate(endLocal) : new Date(end).toLocaleDateString('pt-BR');
    const parts = [
      `Periodo analisado: ${startLabel} - ${endLabel} (${days} dias)`,
    ];
    if (statusFilters.length) {
      const statusLabels = STATUS_FILTERS
        .filter((opt) => statusFilters.includes(opt.value))
        .map((opt) => opt.label);
      if (statusLabels.length) parts.push(statusLabels.join(', '));
    }
    if (selectedService) {
      parts.push(`Servico: ${selectedService.nome || selectedService.title || selectedService.name}`);
    }
    if (profissionalFilter !== 'all') {
      const prof = profissionalOptions.find((p) => String(p.id) === String(profissionalFilter));
      if (prof) parts.push(`Profissional: ${prof.nome}`);
    }
    if (origemFilter !== 'all') {
      const originLabel = originsOptions.find((opt) => opt.value === origemFilter)?.label || origemFilter;
      parts.push(`Origem: ${originLabel}`);
    }
    const text = parts.join(' | ');
    return returnText ? text : (
      <div className="report-summary muted">
        {text}
      </div>
    );
  };

  const toggleStatus = (value) => {
    setStatusFilters((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  };

  if (!isEstab) {
    return (
      <div className="report-page">
        <div className="card report-card">
          <h2 className="report-heading">Relatorios</h2>
          <div className="box error report-alert">
            Relatorios disponiveis apenas para estabelecimentos.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-page">
      <div className="card report-card">
        <div className="report-header">
          <div className="report-title">
            <IconChart aria-hidden className="report-title__icon" />
            <h2 className="report-heading">Relatorios do estabelecimento</h2>
          </div>
          <div className="report-filters">
            <select
              className="input"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              disabled={loading}
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {showCustomRangeInputs && (
              <>
                <input
                  type="date"
                  className="input"
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={(event) => setCustomStart(event.target.value)}
                  disabled={loading}
                />
                <span className="report-filters__separator muted">ate</span>
                <input
                  type="date"
                  className="input"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  disabled={loading}
                />
              </>
            )}
            <button
              type="button"
              className="btn btn--outline btn--sm report-refresh"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              Atualizar
            </button>
          </div>
        </div>

        {renderRangeSummary()}

        {error && !loading && (
          <div className="box error report-alert">
            {error}
          </div>
        )}
        {!allowAdvanced && (
          <div className="box info report-alert">
            Filtros personalizados, funil e exportacao estao disponiveis a partir do plano Pro.
          </div>
        )}

        <div className={`report-advanced ${allowAdvanced ? '' : 'is-locked'}`}>
          <div className="report-advanced__header">
            <span className="report-advanced__title">Filtros avancados</span>
            {!allowAdvanced && <span className="badge badge--pro">Pro</span>}
          </div>
          <div className="report-advanced__filters">
            <div className="report-advanced__group">
              <span className="report-advanced__label">Status</span>
              <div className="report-advanced__chips">
                {STATUS_FILTERS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`report-chip ${statusFilters.includes(opt.value) ? 'is-active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={statusFilters.includes(opt.value)}
                      onChange={() => toggleStatus(opt.value)}
                      disabled={!allowAdvanced || loading}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="report-advanced__group">
              <span className="report-advanced__label">Servico</span>
              <select
                className="input"
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                disabled={!allowAdvanced || loading || !serviceOptions.length}
              >
                <option value="all">Todos os servicos</option>
                {serviceOptions.map((svc) => (
                  <option key={svc.id} value={svc.id}>
                    {svc.nome || svc.title || svc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="report-advanced__group">
              <span className="report-advanced__label">Profissional</span>
              <select
                className="input"
                value={profissionalFilter}
                onChange={(event) => setProfissionalFilter(event.target.value)}
                disabled={!allowAdvanced || loading || !profissionalOptions.length}
              >
                <option value="all">Todos os profissionais</option>
                {profissionalOptions.map((prof) => (
                  <option key={prof.id} value={prof.id}>
                    {prof.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="report-advanced__group">
              <span className="report-advanced__label">Origem</span>
              <select
                className="input"
                value={origemFilter}
                onChange={(event) => setOrigemFilter(event.target.value)}
                disabled={!allowAdvanced || loading}
              >
                <option value="all">Todas as origens</option>
                {originsOptions.map((origin) => (
                  <option key={origin.value} value={origin.value}>
                    {origin.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!allowAdvanced && (
            <div className="report-advanced__cta">
              Desbloqueie filtros por profissional, origem e status avancado no plano Pro.
              <a className="btn btn--outline btn--sm" href="/planos">Ver planos</a>
            </div>
          )}
        </div>

        {loading ? (
          <div className="day-skeleton report-skeleton">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="shimmer report-skeleton__item" />
            ))}
          </div>
        ) : (
          <>
            <div className="report-metrics">
              {metrics.length ? (
                metrics.map((metric) => (
                  <div key={metric.key} className="report-metric">
                    <span className="report-metric__label">{metric.label}</span>
                    <strong className="report-metric__value">{metric.value}</strong>
                    {metric.hint && (
                      <span className="report-metric__hint">{metric.hint}</span>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty report-empty">Nenhum dado disponivel para o periodo selecionado.</div>
              )}
            </div>

            {!!miniMetrics.length && (
              <div className="report-metrics report-metrics--mini">
                {miniMetrics.map((metric) => (
                  <div key={metric.key} className="report-metric report-metric--mini">
                    <span className="report-metric__label">{metric.label}</span>
                    <strong className="report-metric__value">{metric.value}</strong>
                  </div>
                ))}
              </div>
            )}

            <section className="report-section">
              <div className="report-section__header">
                <h3>Volume diario</h3>
                <div className="report-actions">
                  {allowAdvanced && (
                    <>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={handleDownload}
                        disabled={!dailyData.length || exporting}
                      >
                        <IconDownload className="btn__icon" aria-hidden />
                        Exportar CSV
                      </button>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={handleExportPdf}
                        disabled={!dailyData.length}
                      >
                        Exportar PDF
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!displayDaily.length ? (
                <div className="empty">Nenhum agendamento no periodo selecionado.</div>
              ) : (
                <>
                  <div className="report-chart" role="img" aria-label="Comparativo diario de confirmados e cancelados">
                    <div className="report-chart__grid">
                      {displayDaily.map((item) => {
                        const total = Number(item.confirmados || 0) + Number(item.cancelados || 0);
                        const confirmedHeight = !maxVolume ? 0 : (Number(item.confirmados || 0) / maxVolume) * 100;
                        const cancelledHeight = !maxVolume ? 0 : (Number(item.cancelados || 0) / maxVolume) * 100;
                        return (
                          <div key={item.date} className="report-chart__item">
                            <div className="report-chart__stack" title={`${formatDetailedDate(item.date)} | ${item.confirmados} confirmados | ${item.cancelados} cancelados`}>
                              <div
                                className="report-chart__bar report-chart__bar--confirmados"
                                style={{ height: `${Math.min(confirmedHeight, 100)}%` }}
                              />
                              <div
                                className="report-chart__bar report-chart__bar--cancelados"
                                style={{ height: `${Math.min(cancelledHeight, 100)}%` }}
                              />
                            </div>
                            <span className="report-chart__label">{formatShortDate(item.date)}</span>
                            <span className="report-chart__value">{total}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="report-legend">
                      <span className="report-dot report-dot--confirmados" /> Confirmados
                      <span className="report-dot report-dot--cancelados" /> Cancelados
                    </div>
                  </div>

                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Dia</th>
                          <th>Confirmados</th>
                          <th>Cancelados</th>
                          <th>Concluidos</th>
                          <th>No-show</th>
                          <th>Receita (BRL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyData.slice(-14).reverse().map((item) => (
                          <tr key={item.date}>
                            <td>{formatDetailedDate(item.date)}</td>
                            <td>{item.confirmados}</td>
                            <td>{item.cancelados}</td>
                            <td>{item.concluidos}</td>
                            <td>{item.no_show}</td>
                            <td>{centsToCurrency(item.receita_dia)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="report-section">
              <div className="report-section__header">
                <h3>Insights do periodo</h3>
              </div>
              <div className="report-grid">
                <div className="report-panel">
                  <div className="report-panel__header">
                    <h4>Funil</h4>
                    {!allowAdvanced && <span className="badge badge--pro">Pro</span>}
                  </div>
                  {allowAdvanced ? (
                    !funnelTotals ? (
                      <div className="empty">Sem dados para o funil.</div>
                    ) : (
                      <div className="report-funnel">
                        {[
                          { key: 'agendados', label: 'Agendados', value: funnelTotals.agendados },
                          { key: 'confirmados', label: 'Confirmados', value: funnelTotals.confirmados },
                          { key: 'concluidos', label: 'Concluidos', value: funnelTotals.concluidos },
                        ].map((step) => {
                          const maxValue = Math.max(funnelTotals.agendados, 1);
                          const width = `${Math.round((step.value / maxValue) * 100)}%`;
                          return (
                            <div key={step.key} className="report-funnel__step">
                              <span>{step.label}</span>
                              <div className="report-funnel__bar">
                                <span style={{ width }} />
                              </div>
                              <strong>{step.value}</strong>
                            </div>
                          );
                        })}
                        <div className="report-funnel__rates">
                          <span>Confirmacao: {formatPercent(funnelTotals.confirmados / Math.max(funnelTotals.agendados, 1))}</span>
                          <span>Conclusao: {formatPercent(funnelTotals.concluidos / Math.max(funnelTotals.confirmados, 1))}</span>
                        </div>
                        {funilData.length > 0 && (
                          <div className="report-funnel__list">
                            {funilData.map((row) => (
                              <div key={row.origem} className="report-funnel__list-item">
                                <span>{row.origem}</span>
                                <span>{row.agendados} / {row.confirmados} / {row.concluidos}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="report-lock">
                      Disponivel no plano Pro.
                    </div>
                  )}
                </div>

                <div className="report-panel">
                  <div className="report-panel__header">
                    <h4>Dias da semana</h4>
                  </div>
                  {!daysOfWeek.length ? (
                    <div className="empty">Sem dados para o periodo.</div>
                  ) : (
                    <div className="report-chart report-chart--compact">
                      <div className="report-chart__grid">
                        {daysOfWeek.map((item) => {
                          const max = Math.max(...daysOfWeek.map((d) => d.total), 1);
                          const height = (item.total / max) * 100;
                          return (
                            <div key={item.dow} className="report-chart__item">
                              <div className="report-chart__stack" title={`${item.label} | ${item.total} agendamentos`}>
                                <div
                                  className="report-chart__bar report-chart__bar--neutral"
                                  style={{ height: `${Math.min(height, 100)}%` }}
                                />
                              </div>
                              <span className="report-chart__label">{item.label}</span>
                              <span className="report-chart__value">{item.total}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="report-panel">
                  <div className="report-panel__header">
                    <h4>Antecedencia</h4>
                  </div>
                  {!leadTime.length ? (
                    <div className="empty">Sem dados para o periodo.</div>
                  ) : (
                    <div className="report-chart report-chart--compact">
                      <div className="report-chart__grid">
                        {leadTime.map((item) => {
                          const max = Math.max(...leadTime.map((d) => d.total), 1);
                          const height = (Number(item.total || 0) / max) * 100;
                          return (
                            <div key={item.key || item.label} className="report-chart__item">
                              <div className="report-chart__stack" title={`${item.label} | ${item.total} agendamentos`}>
                                <div
                                  className="report-chart__bar report-chart__bar--soft"
                                  style={{ height: `${Math.min(height, 100)}%` }}
                                />
                              </div>
                              <span className="report-chart__label">{item.label}</span>
                              <span className="report-chart__value">{item.total}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {loadingPro && allowAdvanced && (
                <div className="report-inline muted">Atualizando insights Pro...</div>
              )}
              {proError && allowAdvanced && (
                <div className="box error report-alert">{proError}</div>
              )}
            </section>

            <section className="report-section">
              <div className="report-section__header">
                <h3>Detalhamento</h3>
                <div className="report-tabs">
                  <button
                    type="button"
                    className={`report-tab ${tableTab === 'daily' ? 'is-active' : ''}`}
                    onClick={() => setTableTab('daily')}
                  >
                    Por dia
                  </button>
                  <button
                    type="button"
                    className={`report-tab ${tableTab === 'services' ? 'is-active' : ''}`}
                    onClick={() => setTableTab('services')}
                  >
                    Por servico
                  </button>
                  {allowAdvanced && (
                    <button
                      type="button"
                      className={`report-tab ${tableTab === 'profissionais' ? 'is-active' : ''}`}
                      onClick={() => setTableTab('profissionais')}
                    >
                      Por profissional
                    </button>
                  )}
                </div>
              </div>

              {tableTab === 'daily' && (
                !dailyData.length ? (
                  <div className="empty">Nenhum agendamento no periodo selecionado.</div>
                ) : (
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Dia</th>
                          <th>Confirmados</th>
                          <th>Cancelados</th>
                          <th>Concluidos</th>
                          <th>No-show</th>
                          <th>Receita (BRL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyData.slice().reverse().map((item) => (
                          <tr key={item.date}>
                            <td>{formatDetailedDate(item.date)}</td>
                            <td>{item.confirmados}</td>
                            <td>{item.cancelados}</td>
                            <td>{item.concluidos}</td>
                            <td>{item.no_show}</td>
                            <td>{centsToCurrency(item.receita_dia)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {tableTab === 'services' && (
                !services.length ? (
                  <div className="empty">Nenhum servico movimentou agendamentos no periodo.</div>
                ) : (
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Servico</th>
                          <th>Total</th>
                          <th>Confirmados</th>
                          <th>Cancelados</th>
                          <th>Concluidos</th>
                          <th>Receita</th>
                          <th>Ticket medio</th>
                          <th>% Cancelamento</th>
                          <th>% Conclusao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {services.map((item) => {
                          const cancelRate = item.total ? Number(item.cancelados || 0) / Math.max(item.total, 1) : 0;
                          const concluidoRate = item.total ? Number(item.concluidos || 0) / Math.max(item.total, 1) : 0;
                          return (
                            <tr key={item.servico_id}>
                              <td>{item.nome}</td>
                              <td>{item.total}</td>
                              <td>{item.confirmados}</td>
                              <td>{item.cancelados}</td>
                              <td>{item.concluidos}</td>
                              <td>{centsToCurrency(item.receita)}</td>
                              <td>{centsToCurrency(item.ticket_medio)}</td>
                              <td>{formatPercent(cancelRate)}</td>
                              <td>{formatPercent(concluidoRate)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {tableTab === 'profissionais' && (
                !allowAdvanced ? (
                  <div className="report-lock">Disponivel no plano Pro.</div>
                ) : (
                  !profissionaisData.length ? (
                    <div className="empty">Nenhum profissional com agendamentos no periodo.</div>
                  ) : (
                    <div className="report-table-wrapper">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Profissional</th>
                            <th>Total</th>
                            <th>Concluidos</th>
                            <th>Cancelados</th>
                            <th>No-show</th>
                            <th>Receita</th>
                            <th>Ticket medio</th>
                            <th>Ocupacao (min)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profissionaisData.map((item) => (
                            <tr key={item.profissional_id}>
                              <td>{item.profissional}</td>
                              <td>{item.total}</td>
                              <td>{item.concluidos}</td>
                              <td>{item.cancelados}</td>
                              <td>{item.no_show}</td>
                              <td>{centsToCurrency(item.receita_concluida)}</td>
                              <td>{centsToCurrency(item.ticket_medio)}</td>
                              <td>{item.ocupacao_estimativa}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
