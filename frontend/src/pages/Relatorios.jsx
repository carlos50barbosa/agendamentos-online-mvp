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

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'confirmado', label: 'Somente confirmados' },
  { value: 'cancelado', label: 'Somente cancelados' },
];

const DEFAULT_RANGE = '30d';
const RANGE_OPTIONS = [
  { value: '30d', label: 'Ultimos 30 dias' },
  { value: '90d', label: 'Ultimos 90 dias' },
  { value: '180d', label: 'Ultimos 6 meses' },
  { value: '365d', label: 'Ultimos 12 meses' },
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

function ensureDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export default function Relatorios() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';

  const [range, setRange] = useState(DEFAULT_RANGE);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [serviceOptions, setServiceOptions] = useState([]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const isCustom = range === 'custom';

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
    return () => { active = false; };
  }, [isEstab]);

  useEffect(() => {
    if (!isCustom) return;
    if (customStart && customEnd) return;
    const end = new Date();
    const start = new Date(end.getTime() - 29 * DAY_MS);
    setCustomStart((prev) => prev || ensureDateString(start));
    setCustomEnd((prev) => prev || ensureDateString(end));
  }, [isCustom, customStart, customEnd]);

  const filterError = useMemo(() => {
    if (!isCustom) return '';
    if (!customStart || !customEnd) return 'Informe data inicial e final para gerar o relatorio.';
    if (customStart > customEnd) return 'A data inicial nao pode ser maior que a data final.';
    return '';
  }, [isCustom, customStart, customEnd]);

  const currentParams = useMemo(() => {
    const base = isCustom ? { start: customStart, end: customEnd } : { range };
    if (statusFilter !== 'all') base.status = statusFilter;
    if (serviceFilter !== 'all') base.serviceId = serviceFilter;
    return base;
  }, [isCustom, customStart, customEnd, range, statusFilter, serviceFilter]);

  useEffect(() => {
    if (!isEstab) return undefined;
    if (isCustom && filterError) {
      setError(filterError);
      setData(null);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');

    Api.relatoriosEstabelecimento(currentParams)
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
  }, [isEstab, isCustom, filterError, currentParams, refreshKey]);

  const totals = data?.totals;

  const metrics = useMemo(() => {
    if (!totals) return [];
    const totalAgendamentos = Number(totals.total || 0);
    const confirmados = Number(totals.confirmados || 0);
    const cancelados = Number(totals.cancelados || 0);
    const concluidos = Number(totals.concluidos || 0);

    const confirmShare = totalAgendamentos ? confirmados / totalAgendamentos : 0;
    const cancelShare = totals.cancelRate || (totalAgendamentos ? cancelados / totalAgendamentos : 0);
    const realizationRate = totals.realizationRate || (confirmados ? concluidos / Math.max(confirmados, 1) : 0);

    return [
      {
        key: 'total',
        label: 'Agendamentos',
        value: totalAgendamentos,
        hint: totalAgendamentos ? `${formatPercent(confirmShare)} confirmados` : null,
      },
      {
        key: 'concluidos',
        label: 'Concluídos',
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
        key: 'receitaRealizada',
        label: 'Receita concluída',
        value: centsToCurrency(totals.receitaConcluidaCentavos),
        hint: totals.receitaPerdidaCentavos
          ? `Perdida: ${centsToCurrency(totals.receitaPerdidaCentavos)}`
          : null,
      },
      {
        key: 'receitaPrevista',
        label: 'Receita prevista',
        value: centsToCurrency(totals.receitaConfirmadaCentavos),
        hint: totals.receitaFuturaCentavos
          ? `Futuro: ${centsToCurrency(totals.receitaFuturaCentavos)}`
          : null,
      },
      {
        key: 'ticketMedio',
        label: 'Ticket médio',
        value: centsToCurrency(totals.ticketMedioCentavos),
        hint: totals.ticketRealizadoCentavos
          ? `Concluído: ${centsToCurrency(totals.ticketRealizadoCentavos)}`
          : null,
      },
    ];
  }, [totals]);

  const dailyData = data?.daily || [];

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

  const services = data?.services || [];
  const selectedService = useMemo(
    () => serviceOptions.find((svc) => String(svc.id) === String(serviceFilter)),
    [serviceOptions, serviceFilter]
  );

  const currentParamsForDownload = useMemo(() => ({ ...currentParams }), [currentParams]);

  const handleDownload = async (type) => {
    if (!data) return;
    if (isCustom && filterError) {
      setError(filterError);
      return;
    }

    try {
      setExporting(true);
      const { blob, filename } = await Api.downloadRelatorio(type, currentParamsForDownload);
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

  const renderRangeSummary = () => {
    if (!data?.range) return null;
    const { start: startISO, end: endISO, days } = data.range;
    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('pt-BR');
    const parts = [
      `Período analisado: ${formatter.format(startDate)} - ${formatter.format(endDate)} (${days} dias)`,
    ];
    if (statusFilter !== 'all') {
      const statusLabel = STATUS_OPTIONS.find((opt) => opt.value === statusFilter)?.label || statusFilter;
      parts.push(statusLabel);
    }
    if (selectedService) {
      parts.push(`Servico: ${selectedService.nome || selectedService.title || selectedService.name}`);
    }
    return (
      <div className="report-summary muted">
        {parts.join(' | ')}
      </div>
    );
  };




  if (!isEstab) {
    return (
      <div className="report-page">
        <div className="card report-card">
          <h2 className="report-heading">Relatórios</h2>
          <div className="box error report-alert">
            Relatórios disponíveis apenas para estabelecimentos.
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
            <h2 className="report-heading">Relatórios do estabelecimento</h2>
          </div>
          <div className="report-filters">
            <select
              className="input"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              disabled={loading}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isCustom && (
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
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              disabled={loading}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={serviceFilter}
              onChange={(event) => setServiceFilter(event.target.value)}
              disabled={loading || !serviceOptions.length}
            >
              <option value="all">Todos os serviços</option>
              {serviceOptions.map((svc) => (
                <option key={svc.id} value={svc.id}>
                  {svc.nome || svc.title || svc.name}
                </option>
              ))}
            </select>
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
                <div className="empty report-empty">Nenhum dado disponível para o período selecionado.</div>
              )}
            </div>

            <section className="report-section">
              <div className="report-section__header">
                <h3>Volume diário</h3>
                <div className="report-actions">
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => handleDownload('daily')}
                    disabled={!dailyData.length || exporting}
                  >
                    <IconDownload className="btn__icon" aria-hidden />
                    Exportar CSV
                  </button>
                </div>
              </div>

              {!displayDaily.length ? (
                <div className="empty">Nenhum agendamento no período selecionado.</div>
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
                          <th>Receita (BRL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyData.slice(-14).reverse().map((item) => (
                          <tr key={item.date}>
                            <td>{formatDetailedDate(item.date)}</td>
                            <td>{item.confirmados}</td>
                            <td>{item.cancelados}</td>
                            <td>{centsToCurrency(item.receita_centavos)}</td>
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
                <h3>Serviços com mais agendamentos</h3>
                <div className="report-actions">
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => handleDownload('services')}
                    disabled={!services.length || exporting}
                  >
                    <IconDownload className="btn__icon" aria-hidden />
                    Exportar CSV
                  </button>
                </div>
              </div>

              {!services.length ? (
                <div className="empty">Nenhum serviço movimentou agendamentos no período.</div>
              ) : (
                <div className="report-table-wrapper">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Serviço</th>
                        <th>Total</th>
                        <th>Confirmados</th>
                        <th>Cancelados</th>
                        <th>Receita</th>
                        <th>Ticket médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((item) => (
                        <tr key={item.id}>
                          <td>{item.nome}</td>
                          <td>{item.total}</td>
                          <td>{item.confirmados}</td>
                          <td>{item.cancelados}</td>
                          <td>{centsToCurrency(item.receita_centavos)}</td>
                          <td>{centsToCurrency(item.ticket_medio_centavos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );

}
