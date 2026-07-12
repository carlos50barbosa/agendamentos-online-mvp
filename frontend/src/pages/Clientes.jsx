

// frontend/src/pages/Clientes.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import { IconSearch } from '../components/Icons.jsx';
import Drawer from '../components/Drawer.jsx';
import WhatsAppQueue from '../components/clientes/WhatsAppQueue.jsx';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useMediaQuery from '../hooks/useMediaQuery';
import { useClientesCrm } from '../hooks/useClientesCrm';
import { buildDelta, buildRateDelta } from '../utils/metrics.js';

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE_ONLY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME_ONLY = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
// Com 0 casas, R$ 55,50 virava "R$ 56" — e não batia com /relatorios.
const CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PERIOD_OPTIONS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'Tudo' },
];

const STATUS_OPTIONS = [
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'pendente', label: 'Pendente' },
];

const TAG_OPTIONS = ['VIP', 'Promoção', 'Atrasos'];

const DORMANT_OPTIONS = [
  { value: 'all', label: 'Sem retorno' },
  { value: '15', label: '15+ dias' },
  { value: '30', label: '30+ dias' },
  { value: '45', label: '45+ dias' },
  { value: '60', label: '60+ dias' },
  { value: '90', label: '90+ dias' },
];

// Estes chips SÃO o filtro de relacionamento. Antes havia três controles para a mesma
// coisa — o chip "VIP", este segmento e um select "Relacionamento" —, cada um com um efeito
// colateral diferente. Ficou um só, e ele mostra quantos há em cada segmento.
const QUICK_SEGMENTS = [
  { value: 'all', label: 'Todos' },
  { value: 'novo', label: 'Novos' },
  { value: 'recorrente', label: 'Recorrentes' },
  { value: 'vip', label: 'VIP' },
  { value: 'sumido', label: 'Sumidos' },
  { value: 'inativo', label: 'Inativos' },
];
const SEGMENT_VALUES = QUICK_SEGMENTS.map((segment) => segment.value);

const SORT_KEYS = ['name', 'last', 'booked', 'appointments', 'cancelled', 'revenue', 'ticket', 'dormant'];
const PAGE_SIZES = [10, 25, 50];
const DEFAULT_PERIOD = '30d';
const DEFAULT_SORT = { key: 'last', dir: 'desc' };

// Estado da tela lido da URL: dá para recarregar, voltar e mandar o link do recorte
// ("os 87 sumidos") para outra pessoa sem perder nada.
function readFilters(searchParams) {
  const get = (key) => searchParams.get(key) || '';
  const periodo = get('period');
  const segmento = get('segmento');
  const semRetorno = get('semRetorno');
  const ordenar = get('ordenar');
  const porPagina = Number(get('porPagina'));
  const pagina = Number(get('pagina'));

  return {
    period: PERIOD_OPTIONS.some((opt) => opt.value === periodo) ? periodo : DEFAULT_PERIOD,
    searchText: get('q'),
    statusFilters: get('status')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => STATUS_OPTIONS.some((opt) => opt.value === value)),
    riskOnly: get('risco') === '1',
    birthdayOnly: get('aniversario') === '1',
    relationshipFilter: SEGMENT_VALUES.includes(segmento) ? segmento : 'all',
    serviceFilter: get('servico') || 'all',
    professionalFilter: get('profissional') || 'all',
    originFilter: get('origem') || 'all',
    dormantDaysFilter: DORMANT_OPTIONS.some((opt) => opt.value === semRetorno) ? semRetorno : 'all',
    sort: {
      key: SORT_KEYS.includes(ordenar) ? ordenar : DEFAULT_SORT.key,
      dir: get('dir') === 'asc' ? 'asc' : 'desc',
    },
    pageSize: PAGE_SIZES.includes(porPagina) ? porPagina : 10,
    page: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
  };
}

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return DATE_TIME.format(dt);
}

function formatDateOnly(value) {
  if (!value) return '-';
  const text = String(value).trim();
  if (!text) return '-';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dt = new Date(year, month - 1, day);
    if (!Number.isNaN(dt.getTime())) return DATE_ONLY.format(dt);
  }
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return String(value);
  return DATE_ONLY.format(dt);
}

function formatTimeOnly(value) {
  if (!value) return '--:--';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return TIME_ONLY.format(dt);
}

function formatPhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '—';
  return CURRENCY.format(numeric / 100);
}

function formatAddress(item) {
  if (!item) return '-';
  const line1 = [item.endereco, item.numero].filter(Boolean).join(', ');
  const line2 = [item.bairro, item.cidade, item.estado].filter(Boolean).join(' - ');
  const complement = item.complemento ? String(item.complemento) : '';
  const cep = item.cep ? `CEP ${item.cep}` : '';
  const parts = [line1, complement, line2, cep].filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
}

const toDigits = (value) => String(value || '').replace(/\D/g, '');
const buildWhatsappLink = (name, phone, message) => {
  const digits = toDigits(phone);
  if (!digits) return null;
  const text = encodeURIComponent(message || `Olá ${name || ''}, tudo bem?`.trim());
  return `https://wa.me/${digits}?text=${text}`;
};

const statusBadge = (status) => {
  const norm = String(status || '').toLowerCase();
  if (norm.includes('cancel')) return { text: 'Cancelado', className: 'badge out' };
  if (norm.includes('confirm')) return { text: 'Confirmado', className: 'badge ok' };
  if (norm.includes('conclu')) return { text: 'Concluído', className: 'badge done' };
  if (norm.includes('pend')) return { text: 'Pendente', className: 'badge pending' };
  return { text: status || '-', className: 'badge' };
};

const relationshipBadge = (status) => {
  const norm = String(status || '').toLowerCase();
  if (norm === 'vip') return { text: 'VIP', className: 'crm-pill crm-pill--vip' };
  if (norm === 'inativo') return { text: 'Inativo', className: 'crm-pill crm-pill--muted' };
  if (norm === 'sumido') return { text: 'Sumido', className: 'crm-pill crm-pill--warn' };
  if (norm === 'recorrente') return { text: 'Recorrente', className: 'crm-pill crm-pill--soft' };
  return { text: 'Novo', className: 'crm-pill' };
};

const KpiCard = ({ label, value, helper, loading, placeholder, delta }) => (
  <div className="crm-kpi">
    <div className="crm-kpi__label">{label}</div>
    <div className="crm-kpi__value">
      {loading ? <div className="shimmer" style={{ width: '80%', height: 18 }} /> : (value ?? placeholder)}
      {!loading && delta && (
        <span className={`report-metric__delta is-${delta.tone}`} title={delta.title}>
          {delta.text}
        </span>
      )}
    </div>
    {helper && <div className="crm-kpi__sub">{helper}</div>}
  </div>
);

const SortButton = ({ active, direction, label, onClick }) => {
  const SortIcon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button type="button" className={`crm-sort${active ? ' is-active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <span className="crm-sort__icon" aria-hidden="true">
        <SortIcon size={14} strokeWidth={2.4} />
      </span>
    </button>
  );
};

export default function Clientes() {
  const user = getUser();
  const navigate = useNavigate();
  const isEstab = user?.tipo === 'estabelecimento';

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => readFilters(searchParams));
  const isCompact = useMediaQuery('(max-width: 840px)');

  const [period, setPeriod] = useState(initial.period);
  const [searchText, setSearchText] = useState(initial.searchText);
  const debouncedSearch = useDebouncedValue(searchText, 160);
  const [statusFilters, setStatusFilters] = useState(initial.statusFilters);
  const [riskOnly, setRiskOnly] = useState(initial.riskOnly);
  const [relationshipFilter, setRelationshipFilter] = useState(initial.relationshipFilter);
  const [serviceFilter, setServiceFilter] = useState(initial.serviceFilter);
  const [professionalFilter, setProfessionalFilter] = useState(initial.professionalFilter);
  const [originFilter, setOriginFilter] = useState(initial.originFilter);
  const [dormantDaysFilter, setDormantDaysFilter] = useState(initial.dormantDaysFilter);
  const [birthdayOnly, setBirthdayOnly] = useState(initial.birthdayOnly);
  const [sort, setSort] = useState(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [serviceOptions, setServiceOptions] = useState([]);
  const [professionalOptions, setProfessionalOptions] = useState([]);

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [queue, setQueue] = useState({ open: false, loading: false, error: '', items: [], truncated: false, limit: 0 });

  const listParams = useMemo(() => ({
    page,
    pageSize,
    q: debouncedSearch || undefined,
    period,
    status: statusFilters.length ? statusFilters.join(',') : undefined,
    risk: riskOnly ? 1 : undefined,
    birthday: birthdayOnly ? 'mes' : undefined,
    relationship: relationshipFilter !== 'all' ? relationshipFilter : undefined,
    serviceId: serviceFilter !== 'all' ? serviceFilter : undefined,
    profissionalId: professionalFilter !== 'all' ? professionalFilter : undefined,
    origem: originFilter !== 'all' ? originFilter : undefined,
    dormantDays: dormantDaysFilter !== 'all' ? dormantDaysFilter : undefined,
    sort: sort.key,
    dir: sort.dir,
  }), [
    page,
    pageSize,
    debouncedSearch,
    period,
    statusFilters,
    riskOnly,
    birthdayOnly,
    relationshipFilter,
    serviceFilter,
    professionalFilter,
    originFilter,
    dormantDaysFilter,
    sort,
  ]);

  // Espelha o recorte na URL (só o que sai do padrão) com replace: mexer num filtro não
  // deve empilhar entrada no histórico do navegador.
  useEffect(() => {
    const next = new URLSearchParams();
    if (period !== DEFAULT_PERIOD) next.set('period', period);
    if (searchText) next.set('q', searchText);
    if (statusFilters.length) next.set('status', statusFilters.join(','));
    if (riskOnly) next.set('risco', '1');
    if (birthdayOnly) next.set('aniversario', '1');
    if (relationshipFilter !== 'all') next.set('segmento', relationshipFilter);
    if (serviceFilter !== 'all') next.set('servico', serviceFilter);
    if (professionalFilter !== 'all') next.set('profissional', professionalFilter);
    if (originFilter !== 'all') next.set('origem', originFilter);
    if (dormantDaysFilter !== 'all') next.set('semRetorno', dormantDaysFilter);
    if (sort.key !== DEFAULT_SORT.key) next.set('ordenar', sort.key);
    if (sort.dir !== DEFAULT_SORT.dir) next.set('dir', sort.dir);
    if (pageSize !== 10) next.set('porPagina', String(pageSize));
    if (page !== 1) next.set('pagina', String(page));

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    period, searchText, statusFilters, riskOnly, birthdayOnly, relationshipFilter,
    serviceFilter, professionalFilter, originFilter, dormantDaysFilter,
    sort, pageSize, page, searchParams, setSearchParams,
  ]);

  // Exportação e fila agem sobre o RECORTE (sem paginação). Havendo seleção manual, ela
  // restringe dentro do filtro — nunca o contorna.
  const actionParams = useMemo(() => {
    const { page: _page, pageSize: _pageSize, ...rest } = listParams;
    return selectedIds.size ? { ...rest, ids: [...selectedIds].join(',') } : rest;
  }, [listParams, selectedIds]);

  const {
    items,
    total,
    hasNext,
    aggregations,
    segments,
    meta,
    loading,
    error,
    reload,
    updateItem,
  } = useClientesCrm({ establishmentId: user?.id, params: listParams, enabled: isEstab });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailActionError, setDetailActionError] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [tagsDraft, setTagsDraft] = useState([]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [detailReloadKey, setDetailReloadKey] = useState(0);

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
        if (active) setProfessionalOptions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setProfessionalOptions([]);
      });

    return () => {
      active = false;
    };
  }, [isEstab]);

  useEffect(() => {
    setPage(1);
    // Uma seleção feita sobre outro recorte não quer dizer nada — some junto com o filtro.
    setSelectedIds(new Set());
  }, [
    debouncedSearch,
    period,
    statusFilters.join('|'),
    riskOnly,
    birthdayOnly,
    relationshipFilter,
    serviceFilter,
    professionalFilter,
    originFilter,
    dormantDaysFilter,
    sort.key,
    sort.dir,
    pageSize,
  ]);

  useEffect(() => {
    if (!drawerOpen || !selectedClient || !user?.id) return undefined;
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    setDetailActionError('');
    Api.getEstablishmentClientDetails(user.id, selectedClient.id, { period })
      .then((data) => {
        if (!active) return;
        setDetailData(data || null);
      })
      .catch((err) => {
        if (!active) return;
        setDetailError(err?.message || 'Não foi possível carregar os detalhes.');
        setDetailData(null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [drawerOpen, selectedClient?.id, period, user?.id, detailReloadKey]);

  useEffect(() => {
    if (!detailData?.cliente?.id) return;
    setNotesDraft(detailData?.notes || '');
    setNotesDirty(false);
    setTagsDraft(Array.isArray(detailData?.tags) ? detailData.tags : []);
  }, [detailData?.cliente?.id]);

  const summary = useMemo(() => {
    const fallbackClients = items.length;
    const fallbackAppointments = items.reduce((acc, item) => acc + Number(item?.total_appointments || 0), 0);
    const fallbackCancelled = items.reduce((acc, item) => acc + Number(item?.total_cancelled || 0), 0);
    const fallbackCancelRate = fallbackAppointments
       ? Math.round((fallbackCancelled / fallbackAppointments) * 100)
      : 0;

    const clients = Number.isFinite(Number(aggregations?.clients))
       ? Number(aggregations?.clients)
      : fallbackClients;
    const appointments = Number.isFinite(Number(aggregations?.appointments))
       ? Number(aggregations?.appointments)
      : fallbackAppointments;
    const cancelled = Number.isFinite(Number(aggregations?.cancelled))
       ? Number(aggregations?.cancelled)
      : fallbackCancelled;
    const cancelRate = Number.isFinite(Number(aggregations?.cancel_rate))
       ? Number(aggregations?.cancel_rate)
      : fallbackCancelRate;

    const previous = aggregations?.previous || null;

    return {
      clients,
      // A lista agora é vitalícia; este é o recorte que antes era o único visível.
      activeClients: Number(aggregations?.active_clients || 0),
      appointments,
      cancelled,
      cancelRate,
      revenue: aggregations?.revenue_centavos,
      expectedRevenue: aggregations?.expected_revenue_centavos,
      ticket: aggregations?.ticket_medio_centavos,
      riskClients: Number(aggregations?.risk_clients || 0),
      // Sem período anterior (period=all) não há delta — e nenhum card ganha selo.
      deltas: previous ? {
        activeClients: buildDelta(Number(aggregations?.active_clients || 0), previous.active_clients),
        appointments: buildDelta(appointments, previous.appointments),
        cancelRate: buildRateDelta((cancelRate || 0) / 100, (previous.cancel_rate || 0) / 100, { higherIsBetter: false }),
        revenue: buildDelta(aggregations?.revenue_centavos, previous.revenue_centavos, { format: formatCurrency }),
        ticket: buildDelta(aggregations?.ticket_medio_centavos, previous.ticket_medio_centavos, { format: formatCurrency }),
      } : {},
    };
  }, [aggregations, items]);

  // Uma derivação por cliente — a tabela e os cards liam os mesmos campos e recalculavam
  // tudo em dois laços separados. A taxa de cancelamento vem pronta do backend (cancel_rate);
  // recalculá-la aqui era a terceira implementação da mesma conta.
  const rows = useMemo(() => items.map((item) => ({
    item,
    id: Number(item.id),
    badge: statusBadge(item?.last_status),
    relationship: relationshipBadge(item?.relationship_status),
    totalAppointments: Number(item?.total_appointments || 0),
    totalCancelled: Number(item?.total_cancelled || 0),
    cancelPct: Number(item?.cancel_rate || 0),
    waLink: buildWhatsappLink(item?.nome, item?.telefone),
  })), [items]);

  const originOptions = useMemo(() => (
    Array.isArray(meta?.origins) ? meta.origins : []
  ), [meta]);

  const handleToggleStatus = useCallback((value) => {
    setStatusFilters((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value);
      return [...prev, value];
    });
  }, []);

  const handleSortChange = useCallback((key) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  }, []);

  const handleOpenDetails = useCallback((item) => {
    setSelectedClient(item);
    setDrawerOpen(true);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setDrawerOpen(false);
    setSelectedClient(null);
    setDetailData(null);
    setDetailError('');
    setDetailActionError('');
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchText('');
    setStatusFilters([]);
    setRiskOnly(false);
    setBirthdayOnly(false);
    setRelationshipFilter('all');
    setServiceFilter('all');
    setProfessionalFilter('all');
    setOriginFilter('all');
    setDormantDaysFilter('all');
    setSort(DEFAULT_SORT);
    setPeriod(DEFAULT_PERIOD);
    setPageSize(10);
  }, []);

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const toggleAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const todosMarcados = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      pageIds.forEach((id) => (todosMarcados ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [pageIds]);

  const toggleOne = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExportCsv = useCallback(async () => {
    if (!user?.id) return;
    setExporting(true);
    setActionError('');
    try {
      const { blob, filename } = await Api.downloadClientesCsv(user.id, actionParams);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err?.message || 'Não foi possível exportar o CSV.');
    } finally {
      setExporting(false);
    }
  }, [actionParams, user?.id]);

  const handleOpenQueue = useCallback(async () => {
    if (!user?.id) return;
    setQueue({ open: true, loading: true, error: '', items: [], truncated: false, limit: 0 });
    try {
      const resp = await Api.getEstablishmentClientContacts(user.id, actionParams);
      setQueue({
        open: true,
        loading: false,
        error: '',
        items: Array.isArray(resp?.items) ? resp.items : [],
        truncated: Boolean(resp?.truncated),
        limit: Number(resp?.limit || 0),
      });
    } catch (err) {
      setQueue({
        open: true,
        loading: false,
        error: err?.message || 'Não foi possível carregar os contatos.',
        items: [],
        truncated: false,
        limit: 0,
      });
    }
  }, [actionParams, user?.id]);

  const handleSaveNotes = useCallback(async () => {
    if (!selectedClient || !user?.id) return;
    setSavingNotes(true);
    setDetailActionError('');
    try {
      const resp = await Api.updateEstablishmentClientNotes(user.id, selectedClient.id, notesDraft);
      setDetailData((prev) => (prev ? { ...prev, notes: resp?.notes ?? null } : prev));
      setNotesDirty(false);
    } catch (err) {
      setDetailActionError(err?.message || 'Não foi possível salvar as notas.');
    } finally {
      setSavingNotes(false);
    }
  }, [notesDraft, selectedClient, user?.id]);

  const handleSaveTags = useCallback(async () => {
    if (!selectedClient || !user?.id) return;
    setSavingTags(true);
    setDetailActionError('');
    try {
      const resp = await Api.updateEstablishmentClientTags(user.id, selectedClient.id, tagsDraft);
      const nextTags = Array.isArray(resp?.tags) ? resp.tags : tagsDraft;
      setDetailData((prev) => {
        if (!prev) return prev;
        const vipEnabled = nextTags.includes('VIP');
        return {
          ...prev,
          tags: nextTags,
          metrics: prev.metrics
            ? {
                ...prev.metrics,
                relationship_status: vipEnabled ? 'vip' : prev.metrics.relationship_status,
                relationship_label: vipEnabled ? 'VIP' : prev.metrics.relationship_label,
              }
            : prev.metrics,
        };
      });
      const vipEnabled = nextTags.includes('VIP');
      updateItem(selectedClient.id, {
        is_vip: vipEnabled ? 1 : 0,
        relationship_status: vipEnabled ? 'vip' : selectedClient?.relationship_status,
        relationship_label: vipEnabled ? 'VIP' : selectedClient?.relationship_label,
      });
    } catch (err) {
      setDetailActionError(err?.message || 'Não foi possível salvar as tags.');
    } finally {
      setSavingTags(false);
    }
  }, [selectedClient, tagsDraft, updateItem, user?.id]);

  const handleCreateAppointment = useCallback(() => {
    if (!selectedClient) return;
    navigate('/estab', {
      state: {
        prefillClient: {
          id: selectedClient.id,
          nome: selectedClient.nome,
          email: selectedClient.email,
          telefone: selectedClient.telefone,
          data_nascimento: selectedClient.data_nascimento,
        },
      },
    });
  }, [navigate, selectedClient]);

  const drawerPhone = detailData?.cliente?.telefone || selectedClient?.telefone || '';
  const drawerName = detailData?.cliente?.nome || selectedClient?.nome || 'Cliente';
  const lastVisit =
    detailData?.metrics?.last_visit_at ||
    detailData?.metrics?.last_appointment_at ||
    detailData?.history?.[0]?.inicio ||
    null;
  const detailRelationship = relationshipBadge(
    detailData?.metrics?.relationship_status || selectedClient?.relationship_status
  );

  const whatsappTemplates = useMemo(() => {
    const dateLabel = lastVisit ? formatDateOnly(lastVisit) : 'data';
    const timeLabel = lastVisit ? formatTimeOnly(lastVisit) : 'hora';
    return {
      reagendar: `Oi ${drawerName}! Quer reagendar um horário esta semana?`,
      confirmar: `Oi ${drawerName}! Confirmando seu horário em ${dateLabel} às ${timeLabel}.`,
      avaliacao: `Oi ${drawerName}! Como foi seu atendimento? Pode me dar uma avaliação?`,
    };
  }, [drawerName, lastVisit]);

  if (!isEstab) {
    return (
      <div className="card">
        <h2>Clientes</h2>
        <p>Disponível apenas para estabelecimentos.</p>
      </div>
    );
  }

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = total ? Math.min(page * pageSize, total) : 0;
  const periodLabel = period === 'all' ? 'geral' : `últimos ${period.replace('d', ' dias')}`;
  // Os números da linha são do período; a última visita e o gasto são vitalícios. O cabeçalho
  // precisa dizer qual régua está usando — antes escrevia "(total)" sobre a contagem do período.
  const periodShort = period === 'all' ? 'geral' : period;


  return (
    <div className="page clientes-crm">
      <div className="page__header">
        <div>
          <p className="eyebrow">CRM leve</p>
          <h1 className="page__title">Clientes</h1>
          <p className="page__subtitle">Veja quem já agendou com você e acompanhe o relacionamento.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Período dos KPIs">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`segmented__btn ${period === opt.value ? 'is-active' : ''}`}
              onClick={() => setPeriod(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="crm-kpis">
        <KpiCard
          label="Clientes"
          value={summary.clients}
          helper={`${summary.activeClients} com agendamento (${periodLabel})`}
          delta={summary.deltas.activeClients}
          loading={loading}
        />
        <KpiCard
          label="Agendamentos"
          value={summary.appointments}
          helper={periodLabel}
          delta={summary.deltas.appointments}
          loading={loading}
        />
        <KpiCard
          label="Cancelamentos"
          value={loading ? null : `${summary.cancelled} (${summary.cancelRate || 0}%)`}
          helper={periodLabel}
          delta={summary.deltas.cancelRate}
          loading={loading}
        />
        <KpiCard
          label="Receita realizada"
          value={summary.revenue != null ? formatCurrency(summary.revenue) : '—'}
          helper={
            summary.expectedRevenue != null
              ? `Prevista: ${formatCurrency(summary.expectedRevenue)}`
              : 'Atendimentos concluídos'
          }
          delta={summary.deltas.revenue}
          loading={loading}
          placeholder="—"
        />
        <KpiCard
          label="Ticket médio"
          value={summary.ticket != null ? formatCurrency(summary.ticket) : '—'}
          helper="Por atendimento concluído"
          delta={summary.deltas.ticket}
          loading={loading}
          placeholder="—"
        />
      </div>

      <div className="card crm-controls">
        <div className="crm-controls__row">
          <div className="crm-search">
            <IconSearch aria-hidden style={{ marginRight: 4 }} />
            <input
              type="search"
              placeholder="Buscar cliente (nome, e-mail ou telefone)"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setSearchText('')}
            disabled={!searchText}
          >
            Limpar
          </button>
          <div className="field" style={{ minWidth: 140 }}>
            <label className="label">
              <span>Itens por página</span>
              <select
                className="input"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="crm-controls__row">
          <div className="crm-filters">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip ${statusFilters.includes(opt.value) ? 'chip--active' : ''}`}
                onClick={() => handleToggleStatus(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            {/* "Em risco" (sumido OU cancelador crônico) não é um segmento: cruza com todos.
                Por isso continua sendo um alternador próprio, e não um chip de segmento. */}
            <button
              type="button"
              className={`chip ${riskOnly ? 'chip--active' : ''}`}
              onClick={() => setRiskOnly((prev) => !prev)}
            >
              Em risco{summary.riskClients ? ` (${summary.riskClients})` : ''}
            </button>
            <button
              type="button"
              className={`chip ${birthdayOnly ? 'chip--active' : ''}`}
              onClick={() => setBirthdayOnly((prev) => !prev)}
            >
              Aniversariantes do mês
            </button>
          </div>
        </div>

        <div className="crm-controls__row crm-bulk">
          <span className="crm-bulk__count">
            {selectedIds.size
              ? <><strong>{selectedIds.size}</strong> selecionado{selectedIds.size > 1 ? 's' : ''}</>
              : <>{total} cliente{total === 1 ? '' : 's'} no recorte</>}
          </span>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Limpar seleção
            </button>
          )}
          <div className="crm-actions">
            <button
              type="button"
              className="btn btn--sm"
              onClick={handleOpenQueue}
              disabled={loading || !total}
            >
              Fila de WhatsApp ({selectedIds.size || total})
            </button>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={handleExportCsv}
              disabled={exporting || loading || !total}
            >
              {exporting
                ? 'Exportando...'
                : selectedIds.size
                  ? `Exportar ${selectedIds.size} selecionados`
                  : 'Exportar CSV'}
            </button>
          </div>
        </div>

        {actionError && <div className="box error" style={{ marginTop: 8 }}>{actionError}</div>}
        <div className="crm-controls__row">
          <div className="crm-filters" role="group" aria-label="Segmento de relacionamento">
            {QUICK_SEGMENTS.map((segment) => (
              <button
                key={segment.value}
                type="button"
                aria-pressed={relationshipFilter === segment.value}
                className={`chip ${relationshipFilter === segment.value ? 'chip--active' : ''}`}
                onClick={() => setRelationshipFilter(segment.value)}
              >
                {segment.label}
                {/* A contagem ignora o próprio filtro de segmento — senão, olhando "Sumidos",
                    o chip "Novos" mostraria 0 e ninguém clicaria nele. */}
                <span className="chip__count">{segments?.[segment.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="crm-filter-grid">
          <label className="label crm-filter-field">
            <span>Serviço</span>
            <select className="input" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
              <option value="all">Todos</option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>{service.nome}</option>
              ))}
            </select>
          </label>
          <label className="label crm-filter-field">
            <span>Profissional</span>
            <select className="input" value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value)}>
              <option value="all">Todos</option>
              {professionalOptions.map((professional) => (
                <option key={professional.id} value={professional.id}>{professional.nome}</option>
              ))}
            </select>
          </label>
          <label className="label crm-filter-field">
            <span>Origem</span>
            <select className="input" value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}>
              <option value="all">Todas</option>
              {originOptions.map((origin) => (
                <option key={origin.origem} value={origin.origem}>
                  {origin.origem === 'desconhecido' ? 'Desconhecido' : origin.origem}
                </option>
              ))}
            </select>
          </label>
          <label className="label crm-filter-field">
            <span>Sem retorno</span>
            <select className="input" value={dormantDaysFilter} onChange={(event) => setDormantDaysFilter(event.target.value)}>
              {DORMANT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        {loading && items.length === 0 ? (
          <div className="crm-empty">
            <div className="shimmer" style={{ width: '60%', height: 18, margin: '0 auto 10px' }} />
            <div className="shimmer" style={{ width: '80%', height: 12, margin: '0 auto' }} />
          </div>
        ) : error ? (
          <div className="crm-empty">
            {error}
            <div style={{ marginTop: 10 }}>
              <button className="btn btn--sm" type="button" onClick={reload}>Tentar novamente</button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="crm-empty">
            Nenhum cliente encontrado.
            <div style={{ marginTop: 10 }}>
              <button className="btn btn--outline btn--sm" type="button" onClick={handleClearFilters}>
                Limpar filtros
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Uma lista por vez. Antes a tabela E os cards ficavam sempre no DOM, com o CSS
                escondendo um — cada linha era construída em dobro, e cada correção também. */}
            {isCompact ? (
            <div className="crm-cards">
              {rows.map(({ item, id, badge, relationship, totalAppointments, totalCancelled, cancelPct, waLink }) => (
                <div key={id} className="crm-card" onClick={() => handleOpenDetails(item)}>
                  <div className="crm-card__header">
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${item?.nome || 'cliente'}`}
                        checked={selectedIds.has(id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleOne(id)}
                        style={{ marginTop: 4 }}
                      />
                      <div>
                        <button
                          type="button"
                          className="crm-rowlink crm-card__name"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenDetails(item);
                          }}
                        >
                          {item?.nome || 'Cliente'}
                        </button>
                        <div className="crm-actions" style={{ marginTop: 6 }}>
                          <span className={relationship.className}>{item?.relationship_label || relationship.text}</span>
                          {item?.is_at_risk ? <span className="chip chip--active">Em risco</span> : null}
                        </div>
                      </div>
                    </div>
                    <span className={badge.className}>{badge.text}</span>
                  </div>
                  <div className="crm-card__meta">
                    <span>
                      Última visita: {item?.last_visit_at ? formatDateOnly(item.last_visit_at) : 'nunca'}
                    </span>
                    {item?.days_since_last_visit != null ? <span>{item.days_since_last_visit}d sem retorno</span> : null}
                    <span>Agendamentos ({periodShort}): {totalAppointments}</span>
                    <span>Cancel.: {`${totalCancelled} (${cancelPct}%)`}</span>
                    <span>Gasto: {formatCurrency(item?.total_spent_centavos)}</span>
                  </div>
                  {waLink && (
                    <div className="crm-card__actions">
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn--sm"
                        onClick={(event) => event.stopPropagation()}
                      >
                        WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
            ) : (
            <div className="crm-table-wrapper">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos desta página"
                        checked={allPageSelected}
                        // indeterminado quando só parte da página está marcada
                        ref={(node) => {
                          if (node) node.indeterminate = !allPageSelected && somePageSelected;
                        }}
                        onChange={toggleAllOnPage}
                      />
                    </th>
                    <th style={{ width: '20%' }}>
                      <SortButton
                        label="Nome"
                        active={sort.key === 'name'}
                        direction={sort.dir}
                        onClick={() => handleSortChange('name')}
                      />
                    </th>
                    <th style={{ width: '12%' }}>WhatsApp</th>
                    <th style={{ width: '16%' }}>
                      <SortButton
                        label="Última visita"
                        active={sort.key === 'last'}
                        direction={sort.dir}
                        onClick={() => handleSortChange('last')}
                      />
                    </th>
                    <th style={{ width: '10%' }}>
                      <SortButton
                        label={`Agendamentos (${periodShort})`}
                        active={sort.key === 'appointments'}
                        direction={sort.dir}
                        onClick={() => handleSortChange('appointments')}
                      />
                    </th>
                    <th style={{ width: '12%' }}>
                      <SortButton
                        label={`Cancelamentos (${periodShort})`}
                        active={sort.key === 'cancelled'}
                        direction={sort.dir}
                        onClick={() => handleSortChange('cancelled')}
                      />
                    </th>
                    <th style={{ width: '15%' }}>Último serviço</th>
                    <th style={{ width: '10%' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, id, badge, relationship, totalAppointments, totalCancelled, cancelPct, waLink }) => (
                      // Sem role="button"/tabIndex: era um "botão" ARIA com <a> e <button>
                      // dentro (aninhamento inválido) e só tratava Enter, não Espaço. O clique
                      // na linha fica como atalho de mouse; o nome é o controle de verdade.
                      <tr
                        key={id}
                        className="crm-row"
                        onClick={() => handleOpenDetails(item)}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${item?.nome || 'cliente'}`}
                            checked={selectedIds.has(id)}
                            onChange={() => toggleOne(id)}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <button
                              type="button"
                              className="crm-rowlink"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenDetails(item);
                              }}
                            >
                              {item?.nome || 'Cliente'}
                            </button>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <span className={relationship.className}>{item?.relationship_label || relationship.text}</span>
                              {item?.is_at_risk ? <span className="chip chip--active">Em risco</span> : null}
                              {item?.birthday?.is_birthday_month ? <span className="crm-pill crm-pill--soft">Aniversário</span> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          {waLink ? (
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--sm"
                              onClick={(event) => event.stopPropagation()}
                            >
                              WhatsApp
                            </a>
                          ) : (
                            <span className="muted">sem telefone</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span>
                              {item?.last_visit_at ? formatDateOnly(item.last_visit_at) : 'Nunca veio'}
                            </span>
                            <span className="muted">
                              {item?.days_since_last_visit != null
                                ? `${item.days_since_last_visit} dias sem retorno`
                                : '—'}
                            </span>
                          </div>
                        </td>
                        <td>{totalAppointments}</td>
                        <td>{`${totalCancelled} (${cancelPct}%)`}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span>{item?.last_service || '-'}</span>
                            <span className="muted">
                              {item?.preferred_professional?.nome
                                ? `Fav. ${item.preferred_professional.nome}`
                                : item?.avg_return_days
                                  ? `Retorno médio ${item.avg_return_days}d`
                                  : '—'}
                            </span>
                          </div>
                        </td>
                        <td>
                          {/* O status é do ÚLTIMO AGENDAMENTO, não da última visita: com a data
                              ao lado, "cancelou ontem mas não vem há 60 dias" fica legível. */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span className={badge.className}>{badge.text}</span>
                            {item?.last_appointment_at && (
                              <span className="muted">{formatDateOnly(item.last_appointment_at)}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            <div className="crm-pagination">
              <div className="crm-pagination__meta">
                {total ? `Mostrando ${from}–${to} de ${total}` : 'Sem resultados'}
              </div>
              <div className="crm-actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={loading || page === 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setPage((prev) => prev + 1)}
                  disabled={loading || !hasNext}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>


      <Drawer open={drawerOpen} title="Detalhes do cliente" onClose={handleCloseDetails}>
        {detailLoading ? (
          <div className="crm-drawer__section">
            <div className="shimmer" style={{ width: '60%', height: 18 }} />
            <div className="shimmer" style={{ width: '90%', height: 12 }} />
            <div className="shimmer" style={{ width: '80%', height: 12 }} />
          </div>
        ) : detailError ? (
          <div className="crm-drawer__section">
            <p className="muted">{detailError}</p>
            <button
              className="btn btn--sm"
              type="button"
              onClick={() => setDetailReloadKey((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : detailData ? (
          <div className="crm-drawer__section">
            <div className="crm-drawer__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{drawerName}</strong>
                <span className={detailRelationship.className}>
                  {detailData?.metrics?.relationship_label || detailRelationship.text}
                </span>
                {detailData?.metrics?.last_status && (
                  <span className={statusBadge(detailData.metrics.last_status).className}>
                    {statusBadge(detailData.metrics.last_status).text}
                  </span>
                )}
              </div>
              <div className="crm-drawer__meta">
                <span className="muted">Última visita: {lastVisit ? formatDateOnly(lastVisit) : '-'}</span>
                {detailData?.metrics?.cancel_rate != null && (
                  <span className="muted">Cancelamento: {detailData.metrics.cancel_rate}%</span>
                )}
                {detailData?.cliente?.birthday?.days_until_birthday != null && (
                  <span className="muted">
                    Aniversário em {detailData.cliente.birthday.days_until_birthday} dia(s)
                  </span>
                )}
              </div>
              <div className="crm-actions" style={{ marginTop: 6 }}>
                <button className="btn btn--sm" type="button" onClick={handleCreateAppointment}>
                  Criar novo agendamento
                </button>
                {drawerPhone ? (
                  <a
                    className="btn btn--sm btn--outline"
                    href={buildWhatsappLink(drawerName, drawerPhone)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enviar WhatsApp
                  </a>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>Sem telefone</span>
                )}
              </div>
            </div>

            <div className="crm-drawer__grid" style={{ marginTop: 16 }}>
              <div className="crm-drawer__section">
                <strong>Dados do cliente</strong>
                <div>{detailData?.cliente?.email || '-'}</div>
                <div>{formatPhone(detailData?.cliente?.telefone) || '-'}</div>
                <div>{formatAddress(detailData?.cliente)}</div>
                <div>Nascimento: {formatDateOnly(detailData?.cliente?.data_nascimento)}</div>
              </div>
              <div className="crm-drawer__section">
                <strong>{`Métricas (${periodLabel})`}</strong>
                <div>Agendamentos: {detailData?.metrics?.total_appointments ?? 0}</div>
                <div>Cancelamentos: {detailData?.metrics?.total_cancelled ?? 0}</div>
                <div>Receita realizada: {detailData?.metrics?.revenue_centavos != null ? formatCurrency(detailData.metrics.revenue_centavos) : '—'}</div>
                <div>Receita prevista: {detailData?.metrics?.expected_revenue_centavos != null ? formatCurrency(detailData.metrics.expected_revenue_centavos) : '—'}</div>
                <div>Ticket médio: {detailData?.metrics?.ticket_medio_centavos != null ? formatCurrency(detailData.metrics.ticket_medio_centavos) : '—'}</div>
              </div>
            </div>

            <div className="crm-drawer__section crm-drawer__section--metrics" style={{ marginTop: 16 }}>
              <strong>Relacionamento</strong>
              <div className="crm-drawer__meta">
                <span className={detailRelationship.className}>
                  {detailData?.metrics?.relationship_label || detailRelationship.text}
                </span>
                <span>Total gasto: {detailData?.metrics?.total_spent_centavos != null ? formatCurrency(detailData.metrics.total_spent_centavos) : '-'}</span>
                <span>Retorno médio: {detailData?.metrics?.avg_return_days ? `${detailData.metrics.avg_return_days} dias` : '-'}</span>
                <span>Dias sem retorno: {detailData?.metrics?.days_since_last_visit ?? '-'}</span>
                <span>Serviço preferido: {detailData?.metrics?.preferred_service?.nome || '-'}</span>
                <span>Profissional favorito: {detailData?.metrics?.preferred_professional?.nome || '-'}</span>
              </div>
            </div>

            <div className="crm-drawer__section" style={{ marginTop: 16 }}>
              <strong>Serviços mais frequentes</strong>
              {detailData?.frequent_services?.length ? (
                <div className="crm-drawer__meta">
                  {detailData.frequent_services.map((svc) => (
                    <span key={svc.nome} className="chip">
                      {svc.nome} · {svc.total}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted">Sem serviços recorrentes.</span>
              )}
            </div>

            <div className="crm-drawer__section" style={{ marginTop: 16 }}>
              <strong>Tags</strong>
              <div className="crm-drawer__tags">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`chip ${tagsDraft.includes(tag) ? 'chip--active' : ''}`}
                    onClick={() => {
                      setTagsDraft((prev) => (
                        prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
                      ));
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="crm-actions" style={{ marginTop: 8 }}>
                <button
                  className="btn btn--sm"
                  type="button"
                  onClick={handleSaveTags}
                  disabled={savingTags}
                >
                  {savingTags ? 'Salvando...' : 'Salvar tags'}
                </button>
              </div>
            </div>

            <div className="crm-drawer__section" style={{ marginTop: 16 }}>
              <strong>Notas</strong>
              <textarea
                className="input"
                rows={4}
                value={notesDraft}
                onChange={(event) => {
                  setNotesDraft(event.target.value);
                  setNotesDirty(true);
                }}
                placeholder="Observações internas sobre o cliente"
              />
              <div className="crm-actions" style={{ marginTop: 8 }}>
                <button
                  className="btn btn--sm"
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={savingNotes || !notesDirty}
                >
                  {savingNotes ? 'Salvando...' : 'Salvar notas'}
                </button>
              </div>
            </div>

            <div className="crm-drawer__section" style={{ marginTop: 16 }}>
              <strong>Enviar WhatsApp rápido</strong>
              <div className="crm-actions">
                {buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.reagendar) && (
                  <a
                    className="btn btn--sm btn--outline"
                    href={buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.reagendar)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Reagendar
                  </a>
                )}
                {buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.confirmar) && (
                  <a
                    className="btn btn--sm btn--outline"
                    href={buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.confirmar)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Confirmar
                  </a>
                )}
                {buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.avaliacao) && (
                  <a
                    className="btn btn--sm btn--outline"
                    href={buildWhatsappLink(drawerName, drawerPhone, whatsappTemplates.avaliacao)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Avaliação
                  </a>
                )}
              </div>
            </div>

            <div className="crm-drawer__section" style={{ marginTop: 16 }}>
              <strong>Histórico de agendamentos</strong>
              <div className="crm-drawer__history">
                {detailData?.history?.length ? (
                  detailData.history.map((item) => (
                    <div key={item.id} className="crm-drawer__history-item">
                      <div className="crm-drawer__history-top">
                        <span>{formatDateTime(item.inicio)}</span>
                        <span>{statusBadge(item.status).text}</span>
                      </div>
                      <div className="crm-drawer__history-title">{item.servico || 'Serviço'}</div>
                      <div className="crm-drawer__meta">
                        {item.profissional && <span>{item.profissional}</span>}
                        <span>{formatCurrency(item.total_centavos)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="muted">Sem histórico recente.</span>
                )}
              </div>
            </div>

            {detailActionError && (
              <div className="box error" style={{ marginTop: 12 }}>
                {detailActionError}
              </div>
            )}
          </div>
        ) : (
          <span className="muted">Selecione um cliente para ver detalhes.</span>
        )}
      </Drawer>

      <WhatsAppQueue
        open={queue.open}
        contacts={queue.items}
        loading={queue.loading}
        error={queue.error}
        truncated={queue.truncated}
        limit={queue.limit}
        onClose={() => setQueue((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}



