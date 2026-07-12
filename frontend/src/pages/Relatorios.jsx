// src/pages/Relatorios.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import { IconDownload, IconChart } from '../components/Icons.jsx';
import { DailyTrendChart, CategoryBarChart, Sparkline } from '../components/reports/charts.jsx';
import { buildDelta, buildRateDelta, formatPercent } from '../utils/metrics.js';

const CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
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
  { value: 'concluido', label: 'Concluídos' },
  { value: 'cancelado', label: 'Cancelados' },
];

const DEFAULT_RANGE = '30d';
const RANGE_OPTIONS = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'custom', label: 'Intervalo personalizado' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const TABLE_TABS = ['daily', 'services', 'profissionais'];
const DEFAULT_TAB = 'daily';
const PRINT_FRAME_ID = 'report-print-frame';

// Estado da tela lido da URL, para dar refresh, voltar e compartilhar sem perder o recorte.
function readFilters(searchParams) {
  const range = searchParams.get('range');
  const status = (searchParams.get('status') || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => STATUS_FILTERS.some((opt) => opt.value === value));
  const aba = searchParams.get('aba');

  return {
    range: RANGE_OPTIONS.some((opt) => opt.value === range) ? range : DEFAULT_RANGE,
    customStart: searchParams.get('inicio') || '',
    customEnd: searchParams.get('fim') || '',
    statusFilters: status,
    serviceFilter: searchParams.get('servico') || 'all',
    profissionalFilter: searchParams.get('profissional') || 'all',
    origemFilter: searchParams.get('origem') || 'all',
    tableTab: TABLE_TABS.includes(aba) ? aba : DEFAULT_TAB,
  };
}

// "4830" não diz nada para quem lê; "80h 30min" diz.
function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}min`;
}

function centsToCurrency(cents) {
  return CURRENCY.format((Number(cents) || 0) / 100);
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
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  // Componentes locais: toISOString() devolveria o dia seguinte a partir das 21h em UTC-3.
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
}

// Delta vs. período anterior. Sem base de comparação (período anterior zerado) não existe
// percentual honesto a mostrar — devolve null e o card sai sem o selo.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPdfHtml({
  establishment,
  generatedAt,
  rangeLabel,
  metrics,
  miniMetrics,
  dailyRows,
  serviceRows,
  insights,
}) {
  const metricCards = metrics.map((metric) => {
    const legenda = [metric.delta?.text, metric.hint].filter(Boolean).join(' · ');
    return `
    <div class="kpi">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
      ${legenda ? `<small>${escapeHtml(legenda)}</small>` : ''}
    </div>
  `;
  }).join('');

  const insightLines = (insights || [])
    .map((item) => `<li>${escapeHtml(item.text)}</li>`)
    .join('');

  const miniCards = miniMetrics.map((metric) => `
    <div class="kpi kpi--mini">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
    </div>
  `).join('');

  const dailyLines = dailyRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDetailedDate(row.date))}</td>
      <td>${row.confirmados}</td>
      <td>${row.cancelados}</td>
      <td>${row.concluidos}</td>
      <td>${row.no_show}</td>
      <td>${escapeHtml(centsToCurrency(row.receita_prevista))}</td>
      <td>${escapeHtml(centsToCurrency(row.receita_concluida))}</td>
    </tr>
  `).join('');

  const serviceLines = serviceRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.nome)}</td>
      <td>${row.total}</td>
      <td>${row.confirmados}</td>
      <td>${row.cancelados}</td>
      <td>${row.concluidos}</td>
      <td>${escapeHtml(centsToCurrency(row.receita_prevista))}</td>
      <td>${escapeHtml(centsToCurrency(row.receita_concluida))}</td>
      <td>${escapeHtml(centsToCurrency(row.ticket_medio))}</td>
    </tr>
  `).join('');

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Relatórios</title>
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
        .insights { margin:0 0 16px; padding-left:18px; }
        .insights li { font-size:12px; margin-bottom:4px; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(establishment || 'Relatórios do estabelecimento')}</h1>
      ${rangeLabel ? `<div class="muted">${escapeHtml(rangeLabel)}</div>` : ''}
      ${generatedAt ? `<div class="muted">Gerado em ${escapeHtml(generatedAt)}</div>` : ''}
      ${insightLines ? `<div class="section-title">Destaques</div><ul class="insights">${insightLines}</ul>` : ''}
      <div class="grid">${metricCards}</div>
      <div class="grid">${miniCards}</div>
      <div class="section-title">Resumo diário</div>
      <table>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Confirmados</th>
            <th>Cancelados</th>
            <th>Concluídos</th>
            <th>No-show</th>
            <th>Receita prevista</th>
            <th>Receita realizada</th>
          </tr>
        </thead>
        <tbody>
          ${dailyLines || '<tr><td colspan="7">Sem dados no período.</td></tr>'}
        </tbody>
      </table>
      <div class="section-title">Serviços com mais agendamentos</div>
      <table>
        <thead>
          <tr>
            <th>Serviço</th>
            <th>Total</th>
            <th>Confirmados</th>
            <th>Cancelados</th>
            <th>Concluídos</th>
            <th>Receita prevista</th>
            <th>Receita realizada</th>
            <th>Ticket médio</th>
          </tr>
        </thead>
        <tbody>
          ${serviceLines || '<tr><td colspan="8">Sem dados no período.</td></tr>'}
        </tbody>
      </table>
    </body>
  </html>`;
}

export default function Relatorios() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';

  const [searchParams, setSearchParams] = useSearchParams();
  const [initialFilters] = useState(() => readFilters(searchParams));

  const [range, setRange] = useState(initialFilters.range);
  const [customStart, setCustomStart] = useState(initialFilters.customStart);
  const [customEnd, setCustomEnd] = useState(initialFilters.customEnd);
  const [statusFilters, setStatusFilters] = useState(initialFilters.statusFilters);
  const [serviceFilter, setServiceFilter] = useState(initialFilters.serviceFilter);
  const [profissionalFilter, setProfissionalFilter] = useState(initialFilters.profissionalFilter);
  const [origemFilter, setOrigemFilter] = useState(initialFilters.origemFilter);

  const [serviceOptions, setServiceOptions] = useState([]);
  const [profissionalOptions, setProfissionalOptions] = useState([]);

  const [data, setData] = useState(null);
  // null enquanto o plano ainda não é conhecido. Guardado à parte de `data` porque um erro de
  // rede zera `data`, e rebaixar um usuário Pro nesse momento apagaria os filtros dele.
  const [planAllowAdvanced, setPlanAllowAdvanced] = useState(null);
  const [funilData, setFunilData] = useState([]);
  const [profissionaisData, setProfissionaisData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingPro, setLoadingPro] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [proError, setProError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [tableTab, setTableTab] = useState(initialFilters.tableTab);

  const isCustom = range === 'custom';
  const planKnown = planAllowAdvanced !== null;
  const allowAdvanced = planAllowAdvanced === true;
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
    // Só limpa quando sabemos que o plano não permite: enquanto o plano é desconhecido
    // (primeiro load ou erro de rede) os filtros ficam como estão.
    if (!planKnown || allowAdvanced) return;
    if (statusFilters.length) setStatusFilters([]);
    if (serviceFilter !== 'all') setServiceFilter('all');
    if (profissionalFilter !== 'all') setProfissionalFilter('all');
    if (origemFilter !== 'all') setOrigemFilter('all');
    if (customStart) setCustomStart('');
    if (customEnd) setCustomEnd('');
    if (range === 'custom') setRange(DEFAULT_RANGE);
  }, [planKnown, allowAdvanced, statusFilters, serviceFilter, profissionalFilter, origemFilter, customStart, customEnd, range]);

  useEffect(() => {
    if (!allowAdvanced && tableTab === 'profissionais') {
      setTableTab(DEFAULT_TAB);
    }
  }, [allowAdvanced, tableTab]);

  // Espelha o recorte na URL (só o que sai do padrão, para o link não virar sopa de letrinhas).
  useEffect(() => {
    const next = new URLSearchParams();
    if (range !== DEFAULT_RANGE) next.set('range', range);
    if (range === 'custom') {
      if (customStart) next.set('inicio', customStart);
      if (customEnd) next.set('fim', customEnd);
    }
    if (statusFilters.length) next.set('status', statusFilters.join(','));
    if (serviceFilter !== 'all') next.set('servico', serviceFilter);
    if (profissionalFilter !== 'all') next.set('profissional', profissionalFilter);
    if (origemFilter !== 'all') next.set('origem', origemFilter);
    if (tableTab !== DEFAULT_TAB) next.set('aba', tableTab);

    // replace: mexer num filtro não deve empilhar entrada no histórico do navegador.
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    range,
    customStart,
    customEnd,
    statusFilters,
    serviceFilter,
    profissionalFilter,
    origemFilter,
    tableTab,
    searchParams,
    setSearchParams,
  ]);

  const filterError = useMemo(() => {
    if (!showCustomRangeInputs) return '';
    if (!customStart || !customEnd) return 'Informe data inicial e final para gerar o relatório.';
    if (customStart > customEnd) return 'A data inicial não pode ser maior que a data final.';
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

  // Chave por conteúdo. `currentParams` depende de `allowAdvanced`: quando o plano chega e ele
  // vira true, o objeto é recriado com o mesmo conteúdo — e a identidade nova sozinha refazia
  // a busca, disparando duas consultas idênticas a cada carga de um usuário Pro.
  const currentParamsKey = useMemo(() => JSON.stringify(currentParams), [currentParams]);

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
        if (resp?.plan) setPlanAllowAdvanced(!!resp.plan.allow_advanced);
      })
      .catch((err) => {
        if (!active) return;
        const message = err?.message || 'Não foi possível carregar os relatórios.';
        setError(message);
        setData(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEstab, showCustomRangeInputs, filterError, currentParamsKey, refreshKey]);

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
        const message = err?.message || 'Não foi possível carregar os relatórios Pro.';
        setProError(message);
        setFunilData([]);
        setProfissionaisData([]);
      })
      .finally(() => {
        if (!active) return;
        setLoadingPro(false);
      });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEstab, allowAdvanced, showCustomRangeInputs, filterError, currentParamsKey, refreshKey]);

  const totals = data?.totals;
  const rates = data?.rates;
  const revenue = data?.revenue;
  const customerMix = data?.customer_mix;
  const previousTotals = data?.previous?.totals;
  const previousRevenue = data?.previous?.revenue;

  const insights = useMemo(
    () => (Array.isArray(data?.insights) ? data.insights : []),
    [data]
  );

  const previousRates = data?.previous?.rates;

  // O painel lidera com UM número: o dinheiro que efetivamente entrou.
  const hero = useMemo(() => {
    if (!totals || !revenue) return null;
    return {
      key: 'receitaRealizada',
      label: 'Receita realizada',
      value: centsToCurrency(revenue.concluida),
      hint: `${Number(totals.concluidos_total || 0)} atendimentos concluídos`,
      delta: buildDelta(revenue.concluida, previousRevenue?.concluida, { format: centsToCurrency }),
    };
  }, [totals, revenue, previousRevenue]);

  const tiles = useMemo(() => {
    if (!totals || !revenue || !rates) return [];
    const totalAgendamentos = Number(totals.agendados_total || 0);
    const confirmados = Number(totals.confirmados_total || 0);
    const concluidos = Number(totals.concluidos_total || 0);
    const noShow = Number(totals.no_show_total || 0);
    const jaAconteceram = concluidos + noShow;
    const confirmShare = totalAgendamentos ? confirmados / totalAgendamentos : 0;

    return [
      {
        key: 'total',
        label: 'Agendamentos',
        value: totalAgendamentos,
        hint: totalAgendamentos ? `${formatPercent(confirmShare)} confirmados` : null,
        delta: buildDelta(totalAgendamentos, previousTotals?.agendados_total),
      },
      {
        key: 'comparecimento',
        label: 'Comparecimento',
        value: formatPercent(rates.taxa_comparecimento || 0),
        hint: jaAconteceram ? `${concluidos} de ${jaAconteceram} já realizados` : 'Nada realizado ainda',
        delta: buildRateDelta(rates.taxa_comparecimento, previousRates?.taxa_comparecimento),
      },
      {
        key: 'ticketMedio',
        label: 'Ticket médio',
        value: centsToCurrency(revenue.ticket_medio),
        hint: concluidos ? 'Por atendimento concluído' : 'Sem atendimentos concluídos',
        delta: buildDelta(revenue.ticket_medio, previousRevenue?.ticket_medio, { format: centsToCurrency }),
      },
      {
        key: 'receitaPerdida',
        label: 'Receita perdida',
        value: centsToCurrency(revenue.perdida),
        hint: 'Cancelamentos e faltas',
        delta: buildDelta(revenue.perdida, previousRevenue?.perdida, {
          higherIsBetter: false,
          format: centsToCurrency,
        }),
      },
    ];
  }, [totals, revenue, rates, previousTotals, previousRevenue, previousRates]);

  // O resto continua acessível, mas não disputa atenção com o herói.
  const facts = useMemo(() => {
    if (!totals || !rates || !revenue) return [];
    return [
      { key: 'confirmados', label: 'Confirmados', value: Number(totals.confirmados_total || 0) },
      { key: 'concluidos', label: 'Concluídos', value: Number(totals.concluidos_total || 0) },
      { key: 'cancelados', label: 'Cancelados', value: Number(totals.cancelados_total || 0) },
      { key: 'pendentes', label: 'Pendentes', value: Number(totals.pendentes_total || 0) },
      { key: 'aguardandoSinal', label: 'Aguardando sinal', value: Number(totals.aguardando_sinal_total || 0) },
      { key: 'noShow', label: 'No-show', value: Number(totals.no_show_total || 0) },
      { key: 'receitaPrevista', label: 'Receita prevista', value: centsToCurrency(revenue.prevista) },
      { key: 'taxaConfirmacao', label: 'Taxa de confirmação', value: formatPercent(rates.taxa_confirmacao || 0) },
      { key: 'taxaCancelamento', label: 'Taxa de cancelamento', value: formatPercent(rates.taxa_cancelamento || 0) },
      { key: 'clientesNovos', label: 'Clientes novos', value: Number(customerMix?.new_clients || 0) },
      { key: 'clientesRecorrentes', label: 'Clientes recorrentes', value: Number(customerMix?.recurring_clients || 0) },
    ];
  }, [totals, rates, revenue, customerMix]);

  const dailyData = data?.series_daily || [];

  // A linha cabe no card inteiro: não há mais recorte dos "últimos 30 de 90 dias".
  const heroSpark = useMemo(
    () => dailyData.map((item) => Number(item.receita_concluida || 0)),
    [dailyData]
  );

  const services = data?.top_services || [];

  const daysOfWeek = useMemo(() => {
    const map = new Map((data?.top_days_of_week || []).map((row) => [Number(row.dow), row]));
    return WEEKDAY_LABELS.map((label, idx) => {
      const row = map.get(idx) || {};
      return {
        dow: idx,
        label,
        total: Number(row.total || 0),
        receita: Number(row.receita_concluida || 0),
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
      setError('Exportação disponível a partir do plano Pro.');
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
      setError('Exportação disponível a partir do plano Pro.');
      return;
    }

    const html = buildPdfHtml({
      establishment: user?.nome || '',
      generatedAt: new Date().toLocaleString('pt-BR'),
      rangeLabel: renderRangeSummary(true),
      // O PDF herda a mesma hierarquia da tela: o herói vem primeiro.
      metrics: hero ? [hero, ...tiles] : tiles,
      miniMetrics: facts,
      insights,
      // O PDF é para arquivar: leva o período inteiro, não uma amostra dos últimos 14 dias.
      dailyRows: dailyData,
      serviceRows: services,
    });

    // Um iframe imprime sem depender de permissão de popup (o window.open era bloqueado e
    // o usuário só via "permita popups"). Um iframe pendurado de uma exportação anterior é
    // removido antes, então nunca acumula mais de um.
    document.getElementById(PRINT_FRAME_ID)?.remove();
    const frame = document.createElement('iframe');
    frame.id = PRINT_FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = html;
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return;
      win.onafterprint = () => frame.remove();
      win.focus();
      win.print();
    };
    document.body.appendChild(frame);
  };

  const renderRangeSummary = (returnText = false) => {
    if (!data?.range) return returnText ? '' : null;
    const { start_local: startLocal, end_local: endLocal, start, end, days } = data.range;
    const startLabel = startLocal ? formatDetailedDate(startLocal) : new Date(start).toLocaleDateString('pt-BR');
    const endLabel = endLocal ? formatDetailedDate(endLocal) : new Date(end).toLocaleDateString('pt-BR');
    const parts = [
      `Período analisado: ${startLabel} - ${endLabel} (${days} dias)`,
    ];
    // Diz contra o que os deltas dos KPIs estão comparando.
    const prevRange = data.previous?.range;
    if (prevRange?.start_local && prevRange?.end_local) {
      parts.push(`Comparado com ${formatDetailedDate(prevRange.start_local)} - ${formatDetailedDate(prevRange.end_local)}`);
    }
    if (statusFilters.length) {
      const statusLabels = STATUS_FILTERS
        .filter((opt) => statusFilters.includes(opt.value))
        .map((opt) => opt.label);
      if (statusLabels.length) parts.push(statusLabels.join(', '));
    }
    if (selectedService) {
      parts.push(`Serviço: ${selectedService.nome || selectedService.title || selectedService.name}`);
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
                <span className="report-filters__separator muted">até</span>
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
            {allowAdvanced && (
              <>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={handleDownload}
                  disabled={!dailyData.length || loading || exporting}
                >
                  <IconDownload className="btn__icon" aria-hidden />
                  {exporting ? 'Exportando...' : 'Exportar CSV'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={handleExportPdf}
                  disabled={!dailyData.length || loading}
                >
                  Exportar PDF
                </button>
              </>
            )}
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
            Filtros personalizados, funil e exportação estão disponíveis a partir do plano Pro.
          </div>
        )}

        <div className={`report-advanced ${allowAdvanced ? '' : 'is-locked'}`}>
          <div className="report-advanced__header">
            <span className="report-advanced__title">Filtros avançados</span>
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
              <span className="report-advanced__label">Serviço</span>
              <select
                className="input"
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                disabled={!allowAdvanced || loading || !serviceOptions.length}
              >
                <option value="all">Todos os serviços</option>
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
              Desbloqueie filtros por profissional, origem e status avançado no plano Pro.
              <a className="btn btn--outline btn--sm" href="/planos">Ver planos</a>
            </div>
          )}
        </div>

        {loading && !data ? (
          <div className="day-skeleton report-skeleton">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="shimmer report-skeleton__item" />
            ))}
          </div>
        ) : (
          // Em recarga, o render anterior só esmaece — sem trocar a tela por skeleton.
          <div className={`report-body ${loading ? 'is-stale' : ''}`}>
            {!!insights.length && (
              <section className="report-insights" aria-label="Destaques do período">
                {insights.map((item) => (
                  <p key={item.id} className={`report-insight report-insight--${item.tone}`}>
                    {item.text}
                  </p>
                ))}
              </section>
            )}

            {!hero ? (
              <div className="empty report-empty">Nenhum dado disponível para o período selecionado.</div>
            ) : (
              <>
                <div className="report-headline">
                  <div className="report-hero">
                    <span className="report-hero__label">{hero.label}</span>
                    <div className="report-hero__figure">
                      <strong className="report-hero__value">{hero.value}</strong>
                      <Sparkline values={heroSpark} />
                    </div>
                    <div className="report-hero__foot">
                      {hero.delta && (
                        <span
                          className={`report-metric__delta is-${hero.delta.tone}`}
                          title={hero.delta.title}
                        >
                          {hero.delta.text}
                        </span>
                      )}
                      <span>{hero.hint}</span>
                    </div>
                  </div>

                  <div className="report-tiles">
                    {tiles.map((tile) => (
                      <div key={tile.key} className="report-metric">
                        <span className="report-metric__label">{tile.label}</span>
                        <div className="report-metric__value-row">
                          <strong className="report-metric__value">{tile.value}</strong>
                          {tile.delta && (
                            <span
                              className={`report-metric__delta is-${tile.delta.tone}`}
                              title={tile.delta.title}
                            >
                              {tile.delta.text}
                            </span>
                          )}
                        </div>
                        {tile.hint && <span className="report-metric__hint">{tile.hint}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <dl className="report-facts">
                  {facts.map((fact) => (
                    <div key={fact.key} className="report-fact">
                      <dt className="report-fact__label">{fact.label}</dt>
                      <dd className="report-fact__value">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <section className="report-section">
              <div className="report-section__header">
                <h3>Volume diário</h3>
              </div>

              {!dailyData.length ? (
                <div className="empty">Nenhum agendamento no período selecionado.</div>
              ) : (
                <DailyTrendChart
                  points={dailyData}
                  formatShort={formatShortDate}
                  formatLong={formatDetailedDate}
                />
              )}
            </section>

            <section className="report-section">
              <div className="report-section__header">
                <h3>Insights do período</h3>
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
                          { key: 'concluidos', label: 'Concluídos', value: funnelTotals.concluidos },
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
                          <span>Confirmação: {formatPercent(funnelTotals.confirmados / Math.max(funnelTotals.agendados, 1))}</span>
                          <span>Conclusão: {formatPercent(funnelTotals.concluidos / Math.max(funnelTotals.confirmados, 1))}</span>
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
                      Disponível no plano Pro.
                    </div>
                  )}
                </div>

                <div className="report-panel">
                  <div className="report-panel__header">
                    <h4>Dias da semana</h4>
                  </div>
                  {!daysOfWeek.length ? (
                    <div className="empty">Sem dados para o período.</div>
                  ) : (
                    <CategoryBarChart
                      items={daysOfWeek.map((item) => ({
                        key: item.dow,
                        label: item.label,
                        value: item.total,
                        receita: item.receita,
                      }))}
                      describe={(item) => (
                        `${item.label}: ${item.value} agendamentos, ${centsToCurrency(item.receita)} realizados`
                      )}
                    />
                  )}
                </div>

                <div className="report-panel">
                  <div className="report-panel__header">
                    <h4>Antecedência</h4>
                  </div>
                  {!leadTime.length ? (
                    <div className="empty">Sem dados para o período.</div>
                  ) : (
                    <CategoryBarChart
                      items={leadTime.map((item) => ({
                        key: item.key || item.label,
                        label: item.label,
                        value: Number(item.total || 0),
                      }))}
                      describe={(item) => `${item.label}: ${item.value} agendamentos`}
                    />
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
                <div className="report-tabs" role="tablist" aria-label="Detalhamento">
                  {[
                    { id: 'daily', label: 'Por dia' },
                    { id: 'services', label: 'Por serviço' },
                    ...(allowAdvanced ? [{ id: 'profissionais', label: 'Por profissional' }] : []),
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`report-tab-${tab.id}`}
                      aria-selected={tableTab === tab.id}
                      aria-controls={`report-panel-${tab.id}`}
                      className={`report-tab ${tableTab === tab.id ? 'is-active' : ''}`}
                      onClick={() => setTableTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {tableTab === 'daily' && (
                <div role="tabpanel" id="report-panel-daily" aria-labelledby="report-tab-daily">
                  {!dailyData.length ? (
                    <div className="empty">Nenhum agendamento no período selecionado.</div>
                  ) : (
                    <div className="report-table-wrapper">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Dia</th>
                            <th>Confirmados</th>
                            <th>Cancelados</th>
                            <th>Concluídos</th>
                            <th>No-show</th>
                            <th>Receita prevista</th>
                            <th>Receita realizada</th>
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
                              <td>{centsToCurrency(item.receita_prevista)}</td>
                              <td>{centsToCurrency(item.receita_concluida)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tableTab === 'services' && (
                <div role="tabpanel" id="report-panel-services" aria-labelledby="report-tab-services">
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
                            <th>Concluídos</th>
                            <th>Receita prevista</th>
                            <th>Receita realizada</th>
                            <th>Ticket médio</th>
                            <th>% Cancelamento</th>
                            <th>% Conclusão</th>
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
                                <td>{centsToCurrency(item.receita_prevista)}</td>
                                <td>{centsToCurrency(item.receita_concluida)}</td>
                                <td>{centsToCurrency(item.ticket_medio)}</td>
                                <td>{formatPercent(cancelRate)}</td>
                                <td>{formatPercent(concluidoRate)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tableTab === 'profissionais' && (
                <div role="tabpanel" id="report-panel-profissionais" aria-labelledby="report-tab-profissionais">
                  {!allowAdvanced ? (
                    <div className="report-lock">Disponível no plano Pro.</div>
                  ) : !profissionaisData.length ? (
                    <div className="empty">Nenhum profissional com agendamentos no período.</div>
                  ) : (
                    <div className="report-table-wrapper">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Profissional</th>
                            <th>Total</th>
                            <th>Concluídos</th>
                            <th>Cancelados</th>
                            <th>No-show</th>
                            <th>Receita realizada</th>
                            <th>Ticket médio</th>
                            <th>Ocupação</th>
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
                              <td>{formatMinutes(item.ocupacao_estimativa)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
