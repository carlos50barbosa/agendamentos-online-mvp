import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth';

const DEFAULT_PLAN_INFO = Object.freeze({
  plan: 'starter',
  status: 'trialing',
  trialEnd: null,
  trialDaysLeft: null,
  allowAdvanced: false,
  activeUntil: null,
});

const DEFAULT_WA_PACKAGES = Object.freeze([
  { key: '100', messages: 100, price_cents: 990 },
  { key: '200', messages: 200, price_cents: 1690 },
  { key: '300', messages: 300, price_cents: 2490 },
  { key: '500', messages: 500, price_cents: 3990 },
  { key: '1000', messages: 1000, price_cents: 7990 },
  { key: '2500', messages: 2500, price_cents: 19990 },
]);

const HISTORY_PREVIEW_SIZE = 5;
const HISTORY_PAGE_SIZE = 20;
const PIX_POLL_INTERVAL_MS = 2000;
const PIX_POLL_MAX_ATTEMPTS = 60;
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function formatCurrencyFromCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return (Number(value) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatLongDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatHistoryDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildPlanInfo(planData, current = DEFAULT_PLAN_INFO) {
  if (!planData) return current;
  return {
    plan: String(planData.plan || current.plan || 'starter').toLowerCase(),
    status: String(planData.status || current.status || 'trialing').toLowerCase(),
    trialEnd: planData?.trial?.ends_at || current.trialEnd,
    trialDaysLeft:
      typeof planData?.trial?.days_left === 'number'
        ? planData.trial.days_left
        : current.trialDaysLeft,
    allowAdvanced: Boolean(planData?.limits?.allowAdvancedReports),
    activeUntil: planData?.active_until || current.activeUntil,
  };
}

function getWhatsappPackagePriceCents(item) {
  if (typeof item?.price_cents === 'number') return item.price_cents;
  if (typeof item?.priceCents === 'number') return item.priceCents;
  if (typeof item?.price === 'number') return item.price;
  return null;
}

function getWhatsappPackageMessages(item) {
  const value = item?.wa_messages ?? item?.waMessages ?? item?.messages ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function getWhatsappPackageKey(item) {
  return String(item?.id ?? item?.code ?? item?.messages ?? '');
}

function normalizeWhatsappPackage(item) {
  const messages = getWhatsappPackageMessages(item);
  if (!messages) return null;
  const price_cents = getWhatsappPackagePriceCents(item);
  return {
    ...item,
    key: getWhatsappPackageKey(item) || String(messages),
    messages,
    price_cents,
  };
}

function normalizeTopupStatus(item) {
  const raw = String(item?.status || item?.payment_status || item?.state || '').toLowerCase();
  if (!raw) return { key: '', label: '', tone: '' };
  if (raw.includes('pend')) return { key: 'pending', label: 'Pendente', tone: 'pending' };
  if (raw.includes('paid') || raw.includes('approved') || raw.includes('conf') || raw.includes('ok')) {
    return { key: 'paid', label: 'Confirmado', tone: 'success' };
  }
  if (raw.includes('fail') || raw.includes('refused') || raw.includes('cancel')) {
    return { key: 'failed', label: 'Falhou', tone: 'error' };
  }
  return {
    key: raw,
    label: raw.charAt(0).toUpperCase() + raw.slice(1),
    tone: 'neutral',
  };
}

function normalizeTopupHistory(item, index) {
  const rawDate = item?.created_at ?? item?.createdAt ?? item?.date ?? item?.created ?? null;
  const date = rawDate ? new Date(rawDate) : null;
  const hasValidDate = date && Number.isFinite(date.getTime());
  const messages = Number(item?.messages ?? item?.extra_delta ?? 0) || 0;
  const price_cents = typeof item?.price_cents === 'number' ? item.price_cents : null;
  const status = normalizeTopupStatus(item);
  const key = item?.id || item?.payment_id || item?.paymentId || `${rawDate || 'history'}-${messages || index}-${index}`;

  return {
    item,
    key: String(key),
    date: hasValidDate ? date : null,
    createdLabel: formatHistoryDate(hasValidDate ? date : rawDate),
    priceLabel: formatCurrencyFromCents(price_cents),
    messagesLabel: messages,
    statusKey: status.key,
    statusLabel: status.label,
    statusTone: status.tone,
  };
}

function getPaymentId(data) {
  return data?.payment_id || data?.paymentId || data?.gateway_preference_id || null;
}

function getPixCode(data) {
  return data?.qr_code || data?.copia_e_cola || '';
}

function getPixStatusMeta(statusValue, confirmed) {
  const raw = confirmed ? 'approved' : String(statusValue || '').toLowerCase();
  if (raw.includes('approved') || raw.includes('paid') || raw.includes('confirmed')) {
    return { tone: 'success', label: 'Pagamento confirmado', icon: 'OK' };
  }
  if (raw.includes('pending') || raw.includes('in_process') || raw.includes('inprocess') || raw.includes('authorized')) {
    return { tone: 'pending', label: 'Pagamento pendente', icon: '...' };
  }
  if (raw.includes('rejected') || raw.includes('cancel') || raw.includes('fail')) {
    return { tone: 'error', label: 'Pagamento nao confirmado', icon: '!' };
  }
  return raw
    ? { tone: 'neutral', label: 'Status em processamento', icon: 'o' }
    : { tone: '', label: '', icon: 'o' };
}

async function copyText(value) {
  if (!value) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export function useBusinessSettings(options = {}) {
  const { loadWhatsApp = false, loadMercadoPago = false, loadDeposit = false } = options;

  const user = useMemo(() => getUser(), []);
  const isEstablishment = user?.tipo === 'estabelecimento';
  const establishmentId = user?.id || null;

  const [planInfo, setPlanInfo] = useState(DEFAULT_PLAN_INFO);
  const [billing, setBilling] = useState({
    loading: false,
    error: '',
    wallet: null,
    packages: [],
    history: [],
    subscription: null,
  });
  const [whatsapp, setWhatsapp] = useState({
    loading: false,
    connectLoading: false,
    disconnectLoading: false,
    account: null,
    error: '',
    notice: '',
  });
  const [mercadoPago, setMercadoPago] = useState({
    loading: false,
    connectLoading: false,
    disconnectLoading: false,
    account: null,
    error: '',
    notice: '',
  });
  const [deposit, setDeposit] = useState({
    allowed: false,
    loading: false,
    saving: false,
    enabled: false,
    percent: '',
    holdMinutes: DEFAULT_DEPOSIT_HOLD_MINUTES,
    noticeType: '',
    noticeMessage: '',
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRange, setHistoryRange] = useState('all');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [topupLoadingKey, setTopupLoadingKey] = useState('');
  const [topupError, setTopupError] = useState('');
  const [pixModal, setPixModal] = useState({ open: false, data: null });
  const [pixConfirmed, setPixConfirmed] = useState(false);
  const [pixNotice, setPixNotice] = useState('');
  const [pixCopyNotice, setPixCopyNotice] = useState('');

  const pixIntervalRef = useRef(null);
  const pixAttemptsRef = useRef(0);
  const pixBusyRef = useRef(false);

  const clearPixPolling = useCallback(() => {
    if (pixIntervalRef.current) {
      clearInterval(pixIntervalRef.current);
      pixIntervalRef.current = null;
    }
    pixAttemptsRef.current = 0;
    pixBusyRef.current = false;
  }, []);

  const closePixModal = useCallback(() => {
    clearPixPolling();
    setPixConfirmed(false);
    setPixNotice('');
    setPixCopyNotice('');
    setPixModal({ open: false, data: null });
  }, [clearPixPolling]);

  const refreshWhatsAppBilling = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadWhatsApp) return null;

    setBilling((current) => ({ ...current, loading: true, error: '' }));

    try {
      const [subscriptionData, walletData, packsData] = await Promise.all([
        Api.billingSubscription().catch((error) => {
          console.warn('billingSubscription failed', error);
          return null;
        }),
        Api.billingWhatsAppWallet().catch((error) => {
          console.warn('billingWhatsAppWallet failed', error);
          return null;
        }),
        Api.billingWhatsAppPacks().catch((error) => {
          console.warn('billingWhatsAppPacks failed', error);
          return null;
        }),
      ]);

      if (subscriptionData?.plan) {
        setPlanInfo((current) => buildPlanInfo(subscriptionData.plan, current));
      }

      const wallet = walletData?.wallet || subscriptionData?.plan?.usage?.whatsapp || null;
      const packages =
        (Array.isArray(packsData?.packs) && packsData.packs.length ? packsData.packs : null) ||
        (Array.isArray(walletData?.packages) && walletData.packages.length ? walletData.packages : null) ||
        (Array.isArray(subscriptionData?.whatsapp_packages) && subscriptionData.whatsapp_packages.length
          ? subscriptionData.whatsapp_packages
          : []);
      const history = Array.isArray(walletData?.history) ? walletData.history : [];

      setBilling({
        loading: false,
        error: '',
        wallet,
        packages,
        history,
        subscription: subscriptionData?.subscription || null,
      });

      return { wallet, packages, history };
    } catch (error) {
      setBilling((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, 'Falha ao carregar os creditos do WhatsApp.'),
      }));
      return null;
    }
  }, [establishmentId, isEstablishment, loadWhatsApp]);

  const refreshWhatsAppConnection = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadWhatsApp) return null;

    setWhatsapp((current) => ({ ...current, loading: true, error: '' }));

    try {
      const response = await Api.waConnectStatus();
      setWhatsapp((current) => ({
        ...current,
        loading: false,
        account: response?.account || response || null,
      }));
      return response;
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, 'Falha ao carregar o status do WhatsApp.'),
      }));
      return null;
    }
  }, [establishmentId, isEstablishment, loadWhatsApp]);

  const refreshMercadoPagoConnection = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadMercadoPago) return null;

    setMercadoPago((current) => ({ ...current, loading: true, error: '' }));

    try {
      const response = await Api.mpConnectStatus();
      setMercadoPago((current) => ({
        ...current,
        loading: false,
        account: response || null,
      }));
      return response;
    } catch (error) {
      setMercadoPago((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, 'Falha ao carregar o status do Mercado Pago.'),
      }));
      return null;
    }
  }, [establishmentId, isEstablishment, loadMercadoPago]);

  const refreshDepositSettings = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadDeposit) return null;

    setDeposit((current) => ({
      ...current,
      loading: true,
      noticeType: '',
      noticeMessage: '',
    }));

    try {
      const response = await Api.getEstablishmentSettings();
      const depositConfig = response?.deposit || {};

      setDeposit((current) => ({
        ...current,
        loading: false,
        allowed: Boolean(response?.features?.deposit),
        enabled: Boolean(depositConfig.enabled),
        percent: depositConfig.percent != null ? String(depositConfig.percent) : '',
        holdMinutes: Number(depositConfig.hold_minutes) || DEFAULT_DEPOSIT_HOLD_MINUTES,
      }));
      return response;
    } catch (error) {
      setDeposit((current) => ({
        ...current,
        loading: false,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Nao foi possivel carregar o sinal.'),
      }));
      return null;
    }
  }, [establishmentId, isEstablishment, loadDeposit]);

  useEffect(() => {
    if (!isEstablishment) return undefined;

    if (loadWhatsApp) {
      refreshWhatsAppBilling();
      refreshWhatsAppConnection();
    }
    if (loadMercadoPago) {
      refreshMercadoPagoConnection();
    }
    if (loadDeposit) {
      refreshDepositSettings();
    }

    return () => {
      clearPixPolling();
    };
  }, [
    clearPixPolling,
    isEstablishment,
    loadDeposit,
    loadMercadoPago,
    loadWhatsApp,
    refreshDepositSettings,
    refreshMercadoPagoConnection,
    refreshWhatsAppBilling,
    refreshWhatsAppConnection,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const waStatus = String(url.searchParams.get('wa') || '').toLowerCase();
    const waReason = String(url.searchParams.get('reason') || '').toLowerCase();
    const mpStatus = String(url.searchParams.get('mp') || '').toLowerCase();
    let changed = false;

    if (waStatus) {
      const waErrorByReason = {
        missing_phone_number: 'O Meta autorizou o app, mas nao encontrou um numero de telefone na conta selecionada.',
        state_expired: 'A conexao expirou antes da confirmacao. Tente novamente e conclua o fluxo em ate 1 hora.',
        state_invalid_signature: 'Nao foi possivel validar a conexao do WhatsApp. Inicie o processo novamente pelo painel.',
        state_invalid: 'Nao foi possivel validar a conexao do WhatsApp. Inicie o processo novamente pelo painel.',
        state_secret_missing: 'A configuracao interna do OAuth do WhatsApp esta incompleta.',
        missing_code_or_state: 'O retorno do Meta veio incompleto. Inicie a conexao novamente.',
        wa_config_missing: 'A configuracao do WhatsApp Business esta incompleta no backend.',
        oauth_exchange_failed: 'O Meta autorizou o app, mas falhou ao concluir a conexao. Tente novamente.',
      };
      const waMessageMap = {
        connected: { notice: 'WhatsApp conectado com sucesso.' },
        disconnected: { notice: 'WhatsApp desconectado.' },
        error: { error: waErrorByReason[waReason] || 'Nao foi possivel concluir a conexao do WhatsApp.' },
        phone_in_use: { error: 'Esse numero ja esta conectado a outro estabelecimento.' },
      };
      const waPayload = waMessageMap[waStatus];
      if (waPayload?.notice || waPayload?.error) {
        setWhatsapp((current) => ({
          ...current,
          notice: waPayload.notice || '',
          error: waPayload.error || '',
        }));
      }
      url.searchParams.delete('wa');
      url.searchParams.delete('reason');
      changed = true;
    }

    if (mpStatus) {
      const mpMessageMap = {
        connected: { notice: 'Mercado Pago conectado com sucesso.' },
        disconnected: { notice: 'Mercado Pago desconectado.' },
        error: { error: 'Nao foi possivel concluir a conexao do Mercado Pago.' },
      };
      const mpPayload = mpMessageMap[mpStatus];
      if (mpPayload?.notice || mpPayload?.error) {
        setMercadoPago((current) => ({
          ...current,
          notice: mpPayload.notice || '',
          error: mpPayload.error || '',
        }));
      }
      url.searchParams.delete('mp');
      changed = true;
    }

    if (changed) {
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const whatsappConnected = useMemo(() => {
    const account = whatsapp.account || null;
    return account?.connected === true || account?.status === 'connected';
  }, [whatsapp.account]);

  const mercadoPagoConnected = useMemo(() => {
    const account = mercadoPago.account || null;
    return account?.connected === true || account?.status === 'connected';
  }, [mercadoPago.account]);

  const packages = useMemo(() => {
    const list = Array.isArray(billing.packages)
      ? billing.packages.map(normalizeWhatsappPackage).filter(Boolean)
      : [];
    return list.length ? list : DEFAULT_WA_PACKAGES;
  }, [billing.packages]);

  const recommendedPackageKey = useMemo(() => {
    let currentBest = null;
    let currentCostPerMessage = Number.POSITIVE_INFINITY;

    packages.forEach((item) => {
      const price = getWhatsappPackagePriceCents(item);
      const messages = getWhatsappPackageMessages(item);
      if (!price || !messages) return;
      const costPerMessage = Number(price) / 100 / messages;
      if (costPerMessage < currentCostPerMessage) {
        currentCostPerMessage = costPerMessage;
        currentBest = item.key;
      }
    });

    if (currentBest) return currentBest;
    return packages.length ? packages[packages.length - 1].key : null;
  }, [packages]);

  const topupHistory = useMemo(() => {
    const list = Array.isArray(billing.history) ? billing.history : [];
    const normalized = list.map((item, index) => normalizeTopupHistory(item, index));
    return normalized.some((item) => item.date)
      ? [...normalized].sort((left, right) => {
          if (!left.date && !right.date) return 0;
          if (left.date && right.date) return right.date.getTime() - left.date.getTime();
          return left.date ? -1 : 1;
        })
      : normalized;
  }, [billing.history]);

  const hasHistoryDates = useMemo(() => topupHistory.some((item) => item.date), [topupHistory]);
  const hasHistoryStatuses = useMemo(() => topupHistory.some((item) => item.statusKey), [topupHistory]);

  const filteredTopupHistory = useMemo(() => {
    let list = topupHistory;

    if (hasHistoryDates && historyRange !== 'all') {
      const now = Date.now();
      let minDate = null;
      if (historyRange === '30') minDate = now - 30 * 24 * 60 * 60 * 1000;
      if (historyRange === '90') minDate = now - 90 * 24 * 60 * 60 * 1000;
      if (historyRange === 'year') minDate = new Date(new Date().getFullYear(), 0, 1).getTime();
      if (minDate != null) {
        list = list.filter((item) => item.date && item.date.getTime() >= minDate);
      }
    }

    if (hasHistoryStatuses && historyStatus !== 'all') {
      list = list.filter((item) => item.statusKey === historyStatus);
    }

    return list;
  }, [hasHistoryDates, hasHistoryStatuses, historyRange, historyStatus, topupHistory]);

  const recentTopupHistory = useMemo(() => topupHistory.slice(0, HISTORY_PREVIEW_SIZE), [topupHistory]);
  const visibleTopupHistory = useMemo(
    () => filteredTopupHistory.slice(0, historyPage * HISTORY_PAGE_SIZE),
    [filteredTopupHistory, historyPage],
  );
  const hasMoreHistory = visibleTopupHistory.length < filteredTopupHistory.length;

  useEffect(() => {
    setHistoryLoadingMore(false);
    setHistoryPage(1);
  }, [historyRange, historyStatus, topupHistory]);

  useEffect(() => {
    if (!historyExpanded) {
      setHistoryLoadingMore(false);
      setHistoryPage(1);
    }
  }, [historyExpanded]);

  const loadMoreHistory = useCallback(() => {
    if (!hasMoreHistory || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    window.setTimeout(() => {
      setHistoryPage((current) => current + 1);
      setHistoryLoadingMore(false);
    }, 350);
  }, [hasMoreHistory, historyLoadingMore]);

  const walletSummary = useMemo(() => {
    const wallet = billing.wallet || null;
    const includedLimit = Number(wallet?.included_limit ?? 0) || 0;
    const includedBalance = Number(wallet?.included_balance ?? 0) || 0;
    const used = includedLimit > 0 ? Math.max(includedLimit - includedBalance, 0) : 0;
    const usagePercent = includedLimit > 0 ? Math.min(100, (used / includedLimit) * 100) : 0;
    const extraBalance = Number(wallet?.extra_balance ?? 0) || 0;
    const totalBalance = Number(wallet?.total_balance ?? 0) || 0;

    return {
      available: Boolean(wallet),
      monthLabel:
        wallet?.month_label ||
        new Date().toLocaleString('pt-BR', {
          month: 'long',
          year: 'numeric',
        }),
      includedLimit,
      includedBalance,
      used,
      usagePercent,
      extraBalance,
      totalBalance,
      appointmentsEstimate: totalBalance > 0 ? totalBalance / 5 : 0,
      planBadge:
        planInfo.activeUntil
          ? `Assinatura ativa ate ${formatLongDate(planInfo.activeUntil)}`
          : includedLimit > 0
            ? 'Incluido no plano'
            : '',
      includedUsageLabel: `Usadas ${used.toLocaleString('pt-BR')} de ${includedLimit.toLocaleString('pt-BR')}`,
      remainingLabel: includedBalance >= 0 ? `Restam ${Math.max(includedBalance, 0).toLocaleString('pt-BR')}` : '',
      planSummaryItems: [
        includedLimit
          ? `WhatsApp: ${includedLimit.toLocaleString('pt-BR')} msgs/mes incluidos no plano.`
          : 'WhatsApp com franquia mensal indisponivel no momento.',
        'Max. 5 mensagens por agendamento.',
        planInfo.allowAdvanced ? 'Relatorios avancados ativos.' : 'Relatorios basicos ativos.',
      ],
    };
  }, [billing.wallet, planInfo.activeUntil, planInfo.allowAdvanced]);

  const startWhatsAppConnect = useCallback(async () => {
    if (!isEstablishment) return;
    setWhatsapp((current) => ({
      ...current,
      connectLoading: true,
      error: '',
      notice: '',
    }));
    try {
      const response = await Api.waConnectStart();
      if (!response?.url) throw new Error('URL de conexao indisponivel.');
      window.location.assign(response.url);
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        connectLoading: false,
        error: getErrorMessage(error, 'Nao foi possivel iniciar a conexao.'),
      }));
    }
  }, [isEstablishment]);

  const disconnectWhatsApp = useCallback(async () => {
    if (!isEstablishment) return;
    setWhatsapp((current) => ({
      ...current,
      disconnectLoading: true,
      error: '',
      notice: '',
    }));
    try {
      await Api.waConnectDisconnect();
      await refreshWhatsAppConnection();
      setWhatsapp((current) => ({
        ...current,
        disconnectLoading: false,
        notice: 'WhatsApp desconectado.',
      }));
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        disconnectLoading: false,
        error: getErrorMessage(error, 'Nao foi possivel desconectar o WhatsApp.'),
      }));
    }
  }, [isEstablishment, refreshWhatsAppConnection]);

  const startMercadoPagoConnect = useCallback(async () => {
    if (!isEstablishment) return;
    if (!deposit.allowed) {
      setMercadoPago((current) => ({
        ...current,
        error: 'Recurso disponivel apenas para planos Pro e Premium.',
        notice: '',
      }));
      return;
    }
    setMercadoPago((current) => ({
      ...current,
      connectLoading: true,
      error: '',
      notice: '',
    }));
    try {
      const response = await Api.mpConnectStart();
      if (!response?.url) throw new Error('URL de conexao indisponivel.');
      window.location.assign(response.url);
    } catch (error) {
      setMercadoPago((current) => ({
        ...current,
        connectLoading: false,
        error: getErrorMessage(error, 'Nao foi possivel iniciar a conexao.'),
      }));
    }
  }, [deposit.allowed, isEstablishment]);

  const disconnectMercadoPago = useCallback(async () => {
    if (!isEstablishment) return;
    setMercadoPago((current) => ({
      ...current,
      disconnectLoading: true,
      error: '',
      notice: '',
    }));
    try {
      await Api.mpConnectDisconnect();
      await refreshMercadoPagoConnection();
      setMercadoPago((current) => ({
        ...current,
        disconnectLoading: false,
        notice: 'Mercado Pago desconectado.',
      }));
    } catch (error) {
      setMercadoPago((current) => ({
        ...current,
        disconnectLoading: false,
        error: getErrorMessage(error, 'Nao foi possivel desconectar o Mercado Pago.'),
      }));
    }
  }, [isEstablishment, refreshMercadoPagoConnection]);

  const setDepositEnabled = useCallback((value) => {
    setDeposit((current) => ({
      ...current,
      enabled: Boolean(value),
      noticeType: '',
      noticeMessage: '',
    }));
  }, []);

  const setDepositPercent = useCallback((value) => {
    const numeric = String(value || '').replace(/\D/g, '').slice(0, 3);
    setDeposit((current) => ({
      ...current,
      percent: numeric,
      noticeType: '',
      noticeMessage: '',
    }));
  }, []);

  const saveDepositSettings = useCallback(async () => {
    if (!isEstablishment) return false;

    const enabled = Boolean(deposit.enabled);
    let percent = null;

    if (enabled) {
      const numeric = Number(String(deposit.percent || '').trim());
      if (!Number.isFinite(numeric)) {
        setDeposit((current) => ({
          ...current,
          noticeType: 'error',
          noticeMessage: 'Informe o percentual do sinal.',
        }));
        return false;
      }
      if (numeric < 5 || numeric > 90) {
        setDeposit((current) => ({
          ...current,
          noticeType: 'error',
          noticeMessage: 'Percentual deve ficar entre 5 e 90.',
        }));
        return false;
      }
      percent = Math.round(numeric);
    }

    setDeposit((current) => ({
      ...current,
      saving: true,
      noticeType: '',
      noticeMessage: '',
    }));

    try {
      const response = await Api.updateEstablishmentDepositSettings({
        enabled,
        percent,
      });
      const config = response?.deposit || {};
      setDeposit((current) => ({
        ...current,
        saving: false,
        allowed:
          typeof response?.features?.deposit === 'boolean'
            ? response.features.deposit
            : current.allowed,
        enabled: Boolean(config.enabled),
        percent: config.percent != null ? String(config.percent) : '',
        holdMinutes: Number(config.hold_minutes) || DEFAULT_DEPOSIT_HOLD_MINUTES,
        noticeType: 'success',
        noticeMessage: 'Configuracao atualizada com sucesso.',
      }));
      return true;
    } catch (error) {
      setDeposit((current) => ({
        ...current,
        saving: false,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Nao foi possivel salvar o sinal.'),
      }));
      return false;
    }
  }, [deposit.enabled, deposit.percent, isEstablishment]);

  const openWhatsappTopup = useCallback(async (pack) => {
    if (!isEstablishment || !loadWhatsApp) return false;

    const normalizedPack = normalizeWhatsappPackage(pack);
    const requestPayload = {};
    const packKey = normalizedPack?.key || '';

    if (normalizedPack?.id != null) requestPayload.pack_id = normalizedPack.id;
    if (normalizedPack?.code) requestPayload.pack_code = normalizedPack.code;
    if (normalizedPack?.messages) requestPayload.messages = normalizedPack.messages;

    if (!requestPayload.messages && !requestPayload.pack_id && !requestPayload.pack_code) {
      setTopupError('Selecione um pacote de mensagens.');
      return false;
    }

    setTopupLoadingKey(packKey);
    setTopupError('');

    try {
      const response = await Api.billingWhatsAppPix(requestPayload);
      const paymentId = response?.pix?.payment_id || response?.subscription?.gateway_preference_id || null;
      const responsePack = normalizeWhatsappPackage(response?.pack || response?.package || normalizedPack);

      if (response?.pix && (response.pix.qr_code || response.pix.ticket_url || response.pix.qr_code_base64)) {
        clearPixPolling();
        setPixConfirmed(false);
        setPixNotice('');
        setPixCopyNotice('');
        setPixModal({
          open: true,
          data: {
            ...response.pix,
            payment_id: paymentId,
            kind: 'whatsapp_topup',
            pack: responsePack,
            status: response?.pix?.status || 'pending',
          },
        });
      } else if (response?.init_point) {
        window.location.assign(response.init_point);
        return true;
      }

      await refreshWhatsAppBilling();
      return true;
    } catch (error) {
      setTopupError(getErrorMessage(error, 'Falha ao gerar a cobranca PIX do pacote.'));
      return false;
    } finally {
      setTopupLoadingKey('');
    }
  }, [clearPixPolling, isEstablishment, loadWhatsApp, refreshWhatsAppBilling]);

  const pixPaymentId = useMemo(() => getPaymentId(pixModal.data), [pixModal.data]);
  const pixCode = useMemo(() => getPixCode(pixModal.data), [pixModal.data]);
  const pixStatus = useMemo(() => getPixStatusMeta(pixModal.data?.status, pixConfirmed), [pixConfirmed, pixModal.data?.status]);

  const refreshPixStatus = useCallback(async ({ silent = true } = {}) => {
    if (!pixModal.open || pixModal.data?.kind !== 'whatsapp_topup' || !pixPaymentId || pixBusyRef.current) {
      return null;
    }

    pixBusyRef.current = true;
    pixAttemptsRef.current += 1;

    try {
      const response = await Api.billingWhatsAppPixStatus(pixPaymentId);
      if (response?.credited) {
        clearPixPolling();
        setPixConfirmed(true);
        setPixNotice('Pagamento confirmado! Saldo atualizado automaticamente.');
        setPixModal((current) => (
          current?.data
            ? {
                ...current,
                data: {
                  ...current.data,
                  status: 'approved',
                },
              }
            : current
        ));
        await refreshWhatsAppBilling();
      } else if (pixAttemptsRef.current >= PIX_POLL_MAX_ATTEMPTS) {
        clearPixPolling();
        setPixNotice('Ainda nao confirmou. Se voce ja pagou, aguarde alguns instantes e clique em Atualizar.');
      }
      return response;
    } catch (error) {
      if (!silent) {
        setPixNotice(getErrorMessage(error, 'Nao foi possivel atualizar o status agora.'));
      }
      return null;
    } finally {
      pixBusyRef.current = false;
    }
  }, [clearPixPolling, pixModal.data, pixModal.open, pixPaymentId, refreshWhatsAppBilling]);

  useEffect(() => {
    if (!pixModal.open || pixModal.data?.kind !== 'whatsapp_topup' || !pixPaymentId) {
      clearPixPolling();
      return undefined;
    }

    clearPixPolling();
    setPixConfirmed(false);
    setPixNotice('');
    setPixCopyNotice('');
    refreshPixStatus({ silent: true });

    const intervalId = window.setInterval(() => {
      refreshPixStatus({ silent: true });
    }, PIX_POLL_INTERVAL_MS);
    pixIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      if (pixIntervalRef.current === intervalId) {
        pixIntervalRef.current = null;
      }
    };
  }, [clearPixPolling, pixModal.data, pixModal.open, pixPaymentId, refreshPixStatus]);

  const copyPixCode = useCallback(async () => {
    if (!pixCode) return false;
    try {
      const ok = await copyText(pixCode);
      setPixCopyNotice(ok ? 'Chave PIX copiada.' : 'Nao foi possivel copiar agora.');
      return ok;
    } catch {
      setPixCopyNotice('Nao foi possivel copiar agora.');
      return false;
    }
  }, [pixCode]);

  return {
    user,
    isEstablishment,
    establishmentId,
    planInfo,
    billing,
    whatsapp,
    whatsappConnected,
    mercadoPago,
    mercadoPagoConnected,
    deposit,
    helpOpen,
    setHelpOpen,
    historyExpanded,
    setHistoryExpanded,
    historyRange,
    setHistoryRange,
    historyStatus,
    setHistoryStatus,
    historyLoadingMore,
    loadMoreHistory,
    hasHistoryDates,
    hasHistoryStatuses,
    hasMoreHistory,
    packages,
    recommendedPackageKey,
    recentTopupHistory,
    filteredTopupHistory,
    visibleTopupHistory,
    walletSummary,
    topupLoadingKey,
    topupError,
    pixModal,
    pixConfirmed,
    pixNotice,
    pixCopyNotice,
    pixPaymentId,
    pixCode,
    pixStatus,
    refreshWhatsAppBilling,
    refreshWhatsAppConnection,
    refreshMercadoPagoConnection,
    refreshDepositSettings,
    startWhatsAppConnect,
    disconnectWhatsApp,
    startMercadoPagoConnect,
    disconnectMercadoPago,
    setDepositEnabled,
    setDepositPercent,
    saveDepositSettings,
    openWhatsappTopup,
    closePixModal,
    refreshPixStatus,
    copyPixCode,
    formatCurrencyFromCents,
    formatLongDate,
  };
}

export default useBusinessSettings;
