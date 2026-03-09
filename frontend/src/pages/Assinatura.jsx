import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';

const PLAN_META = {
  starter: {
    label: 'Starter',
    priceCents: 1490,
    annualPriceCents: 14900,
    description: 'Base essencial para comecar a operar com agendamentos ilimitados no sistema.',
  },
  pro: {
    label: 'Pro',
    priceCents: 2990,
    annualPriceCents: 29900,
    description: 'Melhor custo-beneficio para equipe em crescimento e operacao com WhatsApp.',
  },
  premium: {
    label: 'Premium',
    priceCents: 9990,
    annualPriceCents: 99900,
    description: 'Estrutura premium para alto volume, mais equipe e operacao avancada.',
  },
};

const BILLING_CYCLE_LABELS = {
  mensal: 'Mensal',
  anual: 'Anual',
};

const PIX_POLL_INTERVAL_MS = 2000;
const PIX_POLL_MAX_ATTEMPTS = 60;

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function formatCurrencyFromCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return (Number(value) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatDateLong(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizePlanKey(value) {
  const key = String(value || '').toLowerCase();
  return PLAN_META[key] ? key : 'starter';
}

function normalizeStatusKey(value) {
  return String(value || '').toLowerCase().trim();
}

function getStatusLabel(value) {
  const key = normalizeStatusKey(value);
  const map = {
    trialing: 'Teste gratuito',
    active: 'Ativo',
    authorized: 'Ativo',
    pending: 'Pagamento pendente',
    paused: 'Pausado',
    past_due: 'Em atraso',
    delinquent: 'Em atraso',
    canceled: 'Cancelado',
    cancelled: 'Cancelado',
    expired: 'Expirado',
    due_soon: 'Vence em breve',
    overdue: 'Em atraso',
    blocked: 'Bloqueado',
  };
  return map[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Indefinido');
}

function getStatusTone(value) {
  const key = normalizeStatusKey(value);
  if (['active', 'authorized'].includes(key)) return 'success';
  if (['trialing', 'due_soon'].includes(key)) return 'info';
  if (['pending', 'paused', 'past_due', 'overdue'].includes(key)) return 'warning';
  if (['delinquent', 'blocked', 'expired', 'canceled', 'cancelled'].includes(key)) return 'danger';
  return 'neutral';
}

function getLimitLabel(limit) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 'Ilimitado';
  return limit.toLocaleString('pt-BR');
}

function getUsageTone(total, limit) {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 'ok';
  const ratio = Number(total || 0) / limit;
  if (ratio >= 1) return 'critical';
  if (ratio >= 0.85) return 'warning';
  return 'ok';
}

function getPixCode(data) {
  return data?.qr_code || data?.copia_e_cola || '';
}

function getPixPaymentId(data) {
  return data?.payment_id || data?.paymentId || data?.gateway_preference_id || null;
}

function getPixStatusMeta(statusValue, confirmed) {
  const raw = confirmed ? 'approved' : String(statusValue || '').toLowerCase();
  if (raw.includes('approved') || raw.includes('paid') || raw.includes('confirmed')) {
    return { tone: 'success', label: 'Pagamento confirmado', icon: 'OK' };
  }
  if (raw.includes('pending') || raw.includes('in_process') || raw.includes('authorized')) {
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

function clearIntentStorage() {
  try {
    localStorage.removeItem('intent_kind');
    localStorage.removeItem('intent_plano');
    localStorage.removeItem('intent_plano_ciclo');
  } catch {}
}

function UsageCard({ label, value, hint, tone = 'ok' }) {
  return (
    <div className={`subscription-page__usage-card subscription-page__usage-card--${tone}`}>
      <span className="subscription-page__usage-label">{label}</span>
      <strong>{value}</strong>
      <span className="muted">{hint}</span>
    </div>
  );
}

function HistoryRow({ item }) {
  const statusTone = getStatusTone(item?.status);
  const statusLabel = getStatusLabel(item?.status);
  const planLabel = PLAN_META[normalizePlanKey(item?.plan)]?.label || String(item?.plan || 'Plano');
  const cycleLabel = BILLING_CYCLE_LABELS[String(item?.billing_cycle || '').toLowerCase()] || 'Ciclo nao informado';
  return (
    <li className="subscription-page__history-item">
      <div>
        <strong>{planLabel}</strong>
        <span className="muted">{cycleLabel}</span>
      </div>
      <div>
        <span className={`subscription-page__status-chip subscription-page__status-chip--${statusTone}`}>
          {statusLabel}
        </span>
        <span className="muted">{formatDateTime(item?.created_at || item?.updated_at || item?.current_period_end)}</span>
      </div>
    </li>
  );
}

export default function Assinatura() {
  const user = useMemo(() => getUser(), []);
  const navigate = useNavigate();
  const location = useLocation();
  const isEstablishment = user?.tipo === 'estabelecimento';
  const establishmentId = user?.id || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ type: '', message: '' });
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [billingStatus, setBillingStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [selectedCycle, setSelectedCycle] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [pixModal, setPixModal] = useState({ open: false, data: null });
  const [pixConfirmed, setPixConfirmed] = useState(false);
  const [pixNotice, setPixNotice] = useState('');
  const [pixCopyNotice, setPixCopyNotice] = useState('');

  const pixIntervalRef = useRef(null);
  const pixAttemptsRef = useRef(0);
  const pixBusyRef = useRef(false);
  const intentHandledRef = useRef('');

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

  const refreshData = useCallback(async ({ silent = false } = {}) => {
    if (!isEstablishment || !establishmentId) return null;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const [subscriptionResponse, billingResponse, statsResponse] = await Promise.all([
        Api.billingSubscription(),
        Api.billingStatus(),
        Api.getEstablishmentStats(establishmentId).catch(() => null),
      ]);

      setSubscriptionData(subscriptionResponse || null);
      setBillingStatus(billingResponse || null);
      setStats(statsResponse || null);

      const preferredCycle =
        subscriptionResponse?.subscription?.billing_cycle ||
        billingResponse?.subscription?.billingCycle ||
        subscriptionResponse?.plan?.billing_cycle ||
        'mensal';
      setSelectedCycle((current) => current || preferredCycle || 'mensal');

      try {
        const plan = subscriptionResponse?.plan?.plan || billingResponse?.plan || 'starter';
        const status = subscriptionResponse?.plan?.status || billingResponse?.plan_status || 'trialing';
        const trialEnd = subscriptionResponse?.plan?.trial?.ends_at || billingResponse?.trial?.endsAt || null;
        localStorage.setItem('plan_current', plan);
        localStorage.setItem('plan_status', status);
        if (trialEnd) localStorage.setItem('trial_end', trialEnd);
        else localStorage.removeItem('trial_end');
      } catch {}

      return { subscriptionResponse, billingResponse, statsResponse };
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Nao foi possivel carregar a assinatura agora.'));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [establishmentId, isEstablishment]);

  useEffect(() => {
    void refreshData();
    return () => {
      clearPixPolling();
    };
  }, [clearPixPolling, refreshData]);

  const planContext = subscriptionData?.plan || null;
  const planKey = normalizePlanKey(planContext?.plan || billingStatus?.plan || 'starter');
  const planMeta = PLAN_META[planKey] || PLAN_META.starter;
  const planStatusKey = normalizeStatusKey(
    subscriptionData?.subscription?.status || billingStatus?.subscription?.status || planContext?.status,
  );
  const planStatusLabel = getStatusLabel(planStatusKey);
  const planStatusTone = getStatusTone(planStatusKey);
  const currentCycle =
    String(
      subscriptionData?.subscription?.billing_cycle ||
      billingStatus?.subscription?.billingCycle ||
      planContext?.billing_cycle ||
      'mensal',
    ).toLowerCase() || 'mensal';
  const activeUntil =
    subscriptionData?.subscription?.current_period_end ||
    billingStatus?.subscription?.currentPeriodEnd ||
    planContext?.active_until ||
    null;
  const trialInfo = billingStatus?.trial || {};
  const trialEndsAt = trialInfo?.endsAt || planContext?.trial?.ends_at || null;
  const trialDaysLeft =
    typeof planContext?.trial?.days_left === 'number'
      ? planContext.trial.days_left
      : trialEndsAt
        ? Math.max(0, Math.floor((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
        : null;
  const trialAvailable = planKey === 'starter' && !trialInfo?.wasUsed;
  const renewalInfo = billingStatus?.billing || {};
  const renewalRequired = Boolean(renewalInfo.renewalRequired);
  const openRenewalPayment = renewalInfo.hasOpenPayment ? renewalInfo.openPayment || null : null;
  const currentPlanPriceCents = currentCycle === 'anual' ? planMeta.annualPriceCents : planMeta.priceCents;
  const checkoutCycle = selectedCycle || currentCycle || 'mensal';
  const selectedPlanPriceCents = checkoutCycle === 'anual' ? planMeta.annualPriceCents : planMeta.priceCents;

  const appointmentUsage = useMemo(() => {
    const data = planContext?.usage?.appointments || {};
    return {
      total: Number(data.total ?? 0) || 0,
      limit:
        typeof data.limit === 'number'
          ? data.limit
          : typeof planContext?.limits?.maxMonthlyAppointments === 'number'
            ? planContext.limits.maxMonthlyAppointments
            : null,
      month: data.month || null,
    };
  }, [planContext]);

  const professionalsUsage = useMemo(() => {
    const data = planContext?.usage?.professionals || subscriptionData?.professional_limit || {};
    return {
      total: Number(data.total ?? stats?.professionals ?? 0) || 0,
      limit:
        typeof data.limit === 'number'
          ? data.limit
          : typeof planContext?.limits?.maxProfessionals === 'number'
            ? planContext.limits.maxProfessionals
            : null,
    };
  }, [planContext, stats?.professionals, subscriptionData?.professional_limit]);

  const servicesUsage = useMemo(() => ({
    total: Number(stats?.services ?? 0) || 0,
    limit:
      typeof planContext?.limits?.maxServices === 'number'
        ? planContext.limits.maxServices
        : null,
  }), [planContext, stats?.services]);

  const whatsappUsage = useMemo(() => {
    const data = planContext?.usage?.whatsapp || null;
    return {
      included: Number(data?.included_limit ?? planContext?.limits?.whatsappIncludedMessages ?? 0) || 0,
      totalBalance: Number(data?.total_balance ?? 0) || 0,
      extraBalance: Number(data?.extra_balance ?? 0) || 0,
      monthLabel: data?.month_label || null,
    };
  }, [planContext]);

  const history = useMemo(() => {
    const list = Array.isArray(subscriptionData?.history) ? subscriptionData.history : [];
    return list.slice(0, 6);
  }, [subscriptionData?.history]);

  const nextDueLabel = renewalRequired
    ? formatDateLong(billingStatus?.due_at || activeUntil)
    : activeUntil
      ? formatDateLong(activeUntil)
      : '-';

  const pixPaymentId = useMemo(() => getPixPaymentId(pixModal.data), [pixModal.data]);
  const pixCode = useMemo(() => getPixCode(pixModal.data), [pixModal.data]);
  const pixStatus = useMemo(
    () => getPixStatusMeta(pixModal.data?.status, pixConfirmed),
    [pixConfirmed, pixModal.data?.status],
  );
  const isRenewalPix = pixModal.data?.kind === 'renewal';
  const isCheckoutPix = pixModal.data?.kind === 'checkout';

  const openPixModal = useCallback((data) => {
    clearPixPolling();
    setPixConfirmed(false);
    setPixNotice('');
    setPixCopyNotice('');
    setPixModal({ open: true, data });
  }, [clearPixPolling]);

  const handleStartTrial = useCallback(async () => {
    if (!establishmentId || trialLoading) return false;
    setTrialLoading(true);
    setNotice({ type: '', message: '' });
    try {
      await Api.updateEstablishmentPlan(establishmentId, {
        plan: 'pro',
        status: 'trialing',
        trialDays: 7,
      });
      await refreshData({ silent: true });
      setNotice({ type: 'success', message: 'Teste gratuito do plano Pro ativado por 7 dias.' });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Nao foi possivel iniciar o teste gratuito agora.'),
      });
      return false;
    } finally {
      setTrialLoading(false);
    }
  }, [establishmentId, refreshData, trialLoading]);

  const handleStartCheckout = useCallback(async (targetPlan, billingCycle = 'mensal') => {
    if (!establishmentId || checkoutLoading) return false;
    setCheckoutLoading(true);
    setNotice({ type: '', message: '' });
    try {
      const response = await Api.billingPixCheckout({ plan: targetPlan, billing_cycle: billingCycle });
      if (response?.pix && (response.pix.qr_code || response.pix.ticket_url || response.pix.qr_code_base64)) {
        openPixModal({
          ...response.pix,
          init_point: response.init_point,
          kind: 'checkout',
          plan: targetPlan,
          billing_cycle: billingCycle,
          status: response?.pix?.status || 'pending',
        });
      } else if (response?.init_point) {
        window.location.assign(response.init_point);
        return true;
      }
      await refreshData({ silent: true });
      setNotice({
        type: 'info',
        message: 'PIX gerado com sucesso. Pague e acompanhe a confirmacao pelo seu banco.',
      });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Falha ao gerar cobranca PIX.'),
      });
      return false;
    } finally {
      setCheckoutLoading(false);
    }
  }, [checkoutLoading, establishmentId, openPixModal, refreshData]);

  const handleOpenPendingRenewal = useCallback(() => {
    if (!openRenewalPayment) return;
    openPixModal({ ...openRenewalPayment, kind: 'renewal' });
  }, [openPixModal, openRenewalPayment]);

  const handleGenerateRenewalPix = useCallback(async () => {
    if (!establishmentId || renewalLoading) return false;
    setRenewalLoading(true);
    setNotice({ type: '', message: '' });
    try {
      const response = await Api.billingRenewalPix();
      await refreshData({ silent: true });
      const payment = response?.renewal?.openPayment || null;
      if (payment) {
        openPixModal({ ...payment, kind: 'renewal' });
      }
      setNotice({
        type: 'info',
        message: 'PIX de renovacao gerado. Assim que o pagamento confirmar, a assinatura sera atualizada automaticamente.',
      });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Falha ao gerar PIX de renovacao.'),
      });
      return false;
    } finally {
      setRenewalLoading(false);
    }
  }, [establishmentId, openPixModal, refreshData, renewalLoading]);

  const refreshRenewalPixStatus = useCallback(async ({ silent = true } = {}) => {
    if (!isRenewalPix || !pixPaymentId || pixBusyRef.current) return null;
    pixBusyRef.current = true;
    pixAttemptsRef.current += 1;
    try {
      const response = await Api.billingRenewalPixStatus(pixPaymentId);
      if (response?.openPayment) {
        setPixModal((current) => (
          current?.data ? { ...current, data: { ...current.data, ...response.openPayment } } : current
        ));
      }
      if (response?.paid) {
        clearPixPolling();
        setPixConfirmed(true);
        setPixNotice('Pagamento confirmado! Renovamos o plano automaticamente.');
        setPixModal((current) => (
          current?.data ? { ...current, data: { ...current.data, status: 'approved' } } : current
        ));
        await refreshData({ silent: true });
      } else if (pixAttemptsRef.current >= PIX_POLL_MAX_ATTEMPTS) {
        clearPixPolling();
        setPixNotice('Ainda nao confirmou. Se voce ja pagou, aguarde alguns instantes e clique em Atualizar.');
      }
      return response;
    } catch (requestError) {
      if (!silent) {
        setPixNotice(getErrorMessage(requestError, 'Nao foi possivel atualizar o status agora.'));
      }
      return null;
    } finally {
      pixBusyRef.current = false;
    }
  }, [clearPixPolling, isRenewalPix, pixPaymentId, refreshData]);

  useEffect(() => {
    if (!pixModal.open || !isRenewalPix || !pixPaymentId) {
      clearPixPolling();
      return undefined;
    }
    clearPixPolling();
    setPixConfirmed(false);
    setPixNotice('');
    setPixCopyNotice('');
    void refreshRenewalPixStatus({ silent: true });
    const intervalId = window.setInterval(() => {
      void refreshRenewalPixStatus({ silent: true });
    }, PIX_POLL_INTERVAL_MS);
    pixIntervalRef.current = intervalId;
    return () => {
      clearInterval(intervalId);
      if (pixIntervalRef.current === intervalId) pixIntervalRef.current = null;
    };
  }, [clearPixPolling, isRenewalPix, pixModal.open, pixPaymentId, refreshRenewalPixStatus]);

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

  useEffect(() => {
    if (!isEstablishment || loading) return;

    const searchParams = new URLSearchParams(location.search || '');
    const action = String(searchParams.get('action') || '').toLowerCase();
    const checkoutStatus = String(searchParams.get('checkout') || '').toLowerCase();

    let intentKind = '';
    let intentPlan = '';
    let intentCycle = 'mensal';
    try {
      intentKind = String(localStorage.getItem('intent_kind') || '').toLowerCase();
      intentPlan = String(localStorage.getItem('intent_plano') || '').toLowerCase();
      intentCycle = String(localStorage.getItem('intent_plano_ciclo') || 'mensal').toLowerCase() || 'mensal';
    } catch {}

    if (!action && !checkoutStatus && !intentKind && !intentPlan) return;
    const intentToken = `${location.search}|${intentKind}|${intentPlan}|${intentCycle}`;
    if (intentHandledRef.current === intentToken) return;
    intentHandledRef.current = intentToken;

    const cleanedSearch = new URLSearchParams(searchParams);
    cleanedSearch.delete('action');
    cleanedSearch.delete('checkout');
    const cleanedUrl = `${location.pathname}${cleanedSearch.toString() ? `?${cleanedSearch.toString()}` : ''}`;

    void (async () => {
      try {
        if (checkoutStatus) {
          if (checkoutStatus === 'sucesso') {
            setNotice({ type: 'success', message: 'Pagamento confirmado. A assinatura sera atualizada automaticamente.' });
          } else if (checkoutStatus === 'pendente') {
            setNotice({ type: 'warn', message: 'Pagamento pendente de confirmacao.' });
          } else if (checkoutStatus === 'erro') {
            setNotice({ type: 'error', message: 'O PIX foi cancelado ou expirou antes da confirmacao.' });
          }
        }

        if (action === 'gerar_pix') {
          if (openRenewalPayment) {
            handleOpenPendingRenewal();
          } else if (renewalRequired) {
            await handleGenerateRenewalPix();
          } else {
            await handleStartCheckout(planKey, checkoutCycle);
          }
        } else if (intentKind === 'renewal') {
          if (openRenewalPayment) handleOpenPendingRenewal();
          else await handleGenerateRenewalPix();
        } else if (intentKind === 'trial') {
          if (trialAvailable) {
            await handleStartTrial();
          } else {
            setNotice({ type: 'info', message: 'Teste gratis indisponivel para a situacao atual da conta.' });
          }
        } else if (intentPlan) {
            await handleStartCheckout(intentPlan, intentCycle || checkoutCycle);
        }
      } finally {
        clearIntentStorage();
        intentHandledRef.current = '';
        navigate(cleanedUrl, { replace: true });
      }
    })();
  }, [
    currentCycle,
    handleGenerateRenewalPix,
    handleOpenPendingRenewal,
    handleStartCheckout,
    handleStartTrial,
    isEstablishment,
    loading,
    location.pathname,
    location.search,
    navigate,
    openRenewalPayment,
    planKey,
    renewalRequired,
    checkoutCycle,
    trialAvailable,
  ]);

  if (!isEstablishment) {
    return <p className="muted">Disponivel apenas para contas de estabelecimento.</p>;
  }

  return (
    <div className="grid config-page settings-module-page subscription-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero subscription-page__hero">
        <div className="settings-module-hero__copy subscription-page__hero-copy">
          <span className="settings-module-hero__eyebrow">Gestao da assinatura</span>
          <h2>Plano e assinatura</h2>
          <p className="muted">
            Acompanhe o plano atual, limites operacionais, status da cobranca e os proximos passos da sua conta.
          </p>
        </div>
        <div className="settings-module-hero__meta subscription-page__hero-meta">
          <div className="settings-module-hero__pill">{planMeta.label} - {BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}</div>
          <div className={`subscription-page__status-chip subscription-page__status-chip--${planStatusTone}`}>
            {planStatusLabel}
          </div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configuracoes
          </Link>
        </div>
      </section>

      {loading ? (
        <section className="settings-module-card subscription-page__loading">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Carregando dados da assinatura...</span>
          </div>
        </section>
      ) : null}

      {!loading && error ? <div className="notice notice--error">{error}</div> : null}
      {!loading && notice.message ? (
        <div className={notice.type ? `notice notice--${notice.type}` : 'notice'}>{notice.message}</div>
      ) : null}

      <div className="subscription-page__summary-grid">
        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Plano atual</span>
          <h3>{planMeta.label}</h3>
          <p className="muted">{planMeta.description}</p>
          <div className="subscription-page__summary-value">{formatCurrencyFromCents(currentPlanPriceCents)}</div>
          <span className="muted">{BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}</span>
        </div>

        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Proximo marco</span>
          <h3>{nextDueLabel}</h3>
          <p className="muted">
            {renewalRequired
              ? 'Regularize a renovacao para manter o acesso sem interrupcoes.'
              : activeUntil
                ? 'Ciclo atual registrado no backend de cobranca.'
                : 'Sem vencimento confirmado no momento.'}
          </p>
        </div>

        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Teste gratis</span>
          <h3>
            {trialDaysLeft != null && planStatusKey === 'trialing'
              ? `${trialDaysLeft} ${trialDaysLeft === 1 ? 'dia' : 'dias'}`
              : trialAvailable
                ? 'Disponivel'
                : 'Encerrado'}
          </h3>
          <p className="muted">
            {planStatusKey === 'trialing' && trialEndsAt
              ? `Valido ate ${formatDateLong(trialEndsAt)}.`
              : trialAvailable
                ? 'Ative 7 dias do plano Pro sem cartao.'
                : 'O periodo de teste ja foi consumido nesta conta.'}
          </p>
        </div>

        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Referencia para novo PIX</span>
          <h3>{formatCurrencyFromCents(selectedPlanPriceCents)}</h3>
          <p className="muted">Ciclo selecionado: {BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}.</p>
        </div>
      </div>

      <div className="subscription-page__content-grid">
        <section className="settings-module-card subscription-page__primary-card">
          <div className="subscription-page__section-head">
            <div>
              <h3>Resumo operacional</h3>
              <p className="muted">Limites do plano e uso atual da operacao do estabelecimento.</p>
            </div>
            <Link className="btn btn--ghost btn--sm" to="/planos#planos">
              Comparar planos
            </Link>
          </div>

          <div className="subscription-page__usage-grid">
            <UsageCard
              label="Profissionais"
              value={`${professionalsUsage.total.toLocaleString('pt-BR')} / ${getLimitLabel(professionalsUsage.limit)}`}
              hint="Equipe ativa cadastrada no sistema"
              tone={getUsageTone(professionalsUsage.total, professionalsUsage.limit)}
            />
            <UsageCard
              label="Servicos"
              value={`${servicesUsage.total.toLocaleString('pt-BR')} / ${getLimitLabel(servicesUsage.limit)}`}
              hint="Cadastros disponiveis para venda"
              tone={getUsageTone(servicesUsage.total, servicesUsage.limit)}
            />
            <UsageCard
              label="WhatsApp incluso"
              value={whatsappUsage.included ? `${whatsappUsage.included.toLocaleString('pt-BR')} msgs` : 'Sem franquia'}
              hint={whatsappUsage.monthLabel || 'Limite mensal do plano'}
              tone={whatsappUsage.included > 0 ? 'ok' : 'warning'}
            />
            <UsageCard
              label="Saldo WhatsApp"
              value={whatsappUsage.totalBalance.toLocaleString('pt-BR')}
              hint={`Extras: ${whatsappUsage.extraBalance.toLocaleString('pt-BR')}`}
              tone={whatsappUsage.totalBalance > 0 ? 'ok' : 'warning'}
            />
          </div>

          <div className="subscription-page__usage-grid subscription-page__usage-grid--secondary">
            <UsageCard
              label="Agendamentos do mes"
              value={appointmentUsage.limit == null
                ? appointmentUsage.total.toLocaleString('pt-BR')
                : `${appointmentUsage.total.toLocaleString('pt-BR')} / ${getLimitLabel(appointmentUsage.limit)}`}
              hint={appointmentUsage.month || 'Mes atual'}
              tone={getUsageTone(appointmentUsage.total, appointmentUsage.limit)}
            />
            <UsageCard
              label="Relatorios"
              value={planContext?.limits?.allowAdvancedReports ? 'Avancados' : 'Basicos'}
              hint={planContext?.limits?.allowAdvancedReports ? 'Indicadores em tempo real liberados.' : 'Atualize para recursos avancados.'}
              tone={planContext?.limits?.allowAdvancedReports ? 'ok' : 'warning'}
            />
          </div>
        </section>

        <aside className="settings-module-card subscription-page__aside-card">
          <div className="subscription-page__section-head subscription-page__section-head--compact">
            <div>
              <h3>Acoes</h3>
              <p className="muted">Renovacao, trial e checkout via PIX.</p>
            </div>
          </div>

          <label className="label subscription-page__cycle-field">
            <span>Ciclo para novo PIX</span>
            <select className="input" value={checkoutCycle} onChange={(event) => setSelectedCycle(event.target.value)}>
              <option value="mensal">Mensal</option>
              <option value="anual">Anual</option>
            </select>
          </label>

          <div className="subscription-page__action-stack">
            {trialAvailable ? (
              <button type="button" className="btn btn--outline btn--outline-brand" onClick={() => void handleStartTrial()} disabled={trialLoading}>
                {trialLoading ? <span className="spinner" /> : 'Ativar 7 dias gratis do Pro'}
              </button>
            ) : null}

            {openRenewalPayment ? (
              <button type="button" className="btn btn--primary" onClick={handleOpenPendingRenewal}>
                Ver PIX pendente
              </button>
            ) : null}

            {!openRenewalPayment && renewalRequired ? (
              <button type="button" className="btn btn--primary" onClick={() => void handleGenerateRenewalPix()} disabled={renewalLoading}>
                {renewalLoading ? <span className="spinner" /> : 'Gerar PIX de renovacao'}
              </button>
            ) : null}

            <button
              type="button"
              className="btn btn--outline"
              onClick={() => void handleStartCheckout(planKey, checkoutCycle)}
              disabled={checkoutLoading}
            >
              {checkoutLoading ? <span className="spinner" /> : `Gerar PIX do ${planMeta.label}`}
            </button>

            <Link className="btn btn--ghost" to="/planos#planos">
              Ver comparativo completo
            </Link>
          </div>

          <div className="subscription-page__callout">
            <strong>Situacao atual</strong>
            <p className="muted">
              {renewalRequired
                ? 'Existe necessidade de renovacao. O pagamento por PIX libera a assinatura automaticamente apos a confirmacao.'
                : planStatusKey === 'trialing'
                  ? 'Sua conta esta em periodo de teste. Voce pode contratar antes do fim ou aguardar ate a data limite.'
                  : 'A assinatura atual esta registrada e os limites abaixo refletem o plano aplicado hoje.'}
            </p>
          </div>
        </aside>
      </div>

      <section className="settings-module-card subscription-page__history-card">
        <div className="subscription-page__section-head">
          <div>
            <h3>Historico recente da assinatura</h3>
            <p className="muted">Ultimos eventos de assinatura retornados pela API atual.</p>
          </div>
          <div className={`subscription-page__status-chip subscription-page__status-chip--${getStatusTone(billingStatus?.state)}`}>
            {getStatusLabel(billingStatus?.state)}
          </div>
        </div>
        {history.length ? (
          <ul className="subscription-page__history-list">
            {history.map((item) => (
              <HistoryRow key={item?.id || `${item?.plan}-${item?.created_at || item?.updated_at || 'row'}`} item={item} />
            ))}
          </ul>
        ) : (
          <div className="subscription-page__empty">Nenhum evento recente de assinatura para exibir.</div>
        )}
      </section>

      {pixModal.open ? (
        <Modal
          title="Pagamento via PIX"
          onClose={closePixModal}
          actions={[
            pixModal.data?.ticket_url ? (
              <a key="open" className="btn btn--primary" href={pixModal.data.ticket_url} target="_blank" rel="noreferrer">
                Abrir no app do banco
              </a>
            ) : null,
            <button key="close" type="button" className="btn btn--outline" onClick={closePixModal}>
              Fechar
            </button>,
          ].filter(Boolean)}
        >
          <div className="pix-checkout">
            {pixStatus.label ? (
              <div className={`pix-checkout__status${pixStatus.tone ? ` pix-checkout__status--${pixStatus.tone}` : ''}`} role="status" aria-live="polite">
                <div className="pix-checkout__status-main">
                  <span className="pix-checkout__status-icon" aria-hidden="true">{pixStatus.icon}</span>
                  <span>{pixStatus.label}</span>
                </div>
                {pixModal.data?.status ? (
                  <span className="pix-checkout__status-code">Status: {String(pixModal.data.status || '').toUpperCase()}</span>
                ) : null}
              </div>
            ) : null}

            {isRenewalPix ? (
              <div className={`box pix-checkout__topup-status${pixConfirmed ? ' is-success' : ' is-pending'}`} role="status" aria-live="polite">
                {pixConfirmed ? (
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <span className="pix-checkout__topup-icon" aria-hidden="true">OK</span>
                    <strong>Pagamento confirmado</strong>
                  </div>
                ) : (
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <span className="spinner" aria-hidden="true" />
                    <span>Aguardando confirmacao do pagamento...</span>
                  </div>
                )}
                {pixNotice ? <p className="muted" style={{ margin: 0 }}>{pixNotice}</p> : null}
                {!pixConfirmed ? (
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn--sm btn--outline" onClick={() => void refreshRenewalPixStatus({ silent: false })} disabled={!pixPaymentId}>
                      Atualizar agora
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {typeof pixModal.data?.amount_cents === 'number' ? (
              <div className="pix-checkout__amount">
                Valor a pagar: {formatCurrencyFromCents(pixModal.data.amount_cents)}
              </div>
            ) : null}

            {pixModal.data?.qr_code_base64 ? (
              <img src={`data:image/png;base64,${pixModal.data.qr_code_base64}`} alt="QR Code PIX" className="pix-checkout__qr" />
            ) : (
              <p className="muted pix-checkout__hint">Abra o link acima para visualizar o QR Code.</p>
            )}

            {pixCode ? (
              <div className="pix-checkout__code">
                <label htmlFor="subscription-pix-code">Chave copia e cola</label>
                <textarea id="subscription-pix-code" readOnly value={pixCode} rows={3} className="input" />
                <div className="pix-checkout__code-actions">
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void copyPixCode()}>
                    Copiar chave
                  </button>
                </div>
                {pixCopyNotice ? <span className="muted">{pixCopyNotice}</span> : null}
              </div>
            ) : null}

            {pixModal.data?.expires_at ? (
              <p className="muted pix-checkout__expires">
                Expira em {formatDateTime(pixModal.data.expires_at)}
              </p>
            ) : null}

            <p className="muted pix-checkout__note">
              {pixConfirmed
                ? isRenewalPix
                  ? 'Pagamento confirmado. Renovamos o plano automaticamente.'
                  : 'Pagamento confirmado. Atualizamos a assinatura automaticamente.'
                : isRenewalPix
                  ? 'Pague pelo app do seu banco e aguarde a confirmacao automatica. Renovacao liberada apos a aprovacao.'
                  : isCheckoutPix
                    ? 'Pague pelo app do seu banco e aguarde a confirmacao automatica. O novo plano sera liberado apos a aprovacao.'
                    : 'Pague pelo app do seu banco e aguarde a confirmacao automatica.'}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
