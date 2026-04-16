import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import { isMercadoPagoCardTokenRefreshRequired } from '../utils/mercadoPagoCard.js';

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
    description: 'Melhor custo-benefício para equipe em crescimento e operação com WhatsApp.',
  },
  premium: {
    label: 'Premium',
    priceCents: 9990,
    annualPriceCents: 99900,
    description: 'Estrutura premium para alto volume, mais equipe e operação avançada.',
  },
};

const BILLING_CYCLE_LABELS = {
  mensal: 'Mensal',
  anual: 'Anual',
};

const PAYMENT_METHOD_LABELS = {
  credit_card: 'Cartão',
  pix: 'PIX',
};

const FINANCIAL_EVENT_LABELS = {
  subscription_created: 'Assinatura criada',
  payment_approved: 'Pagamento aprovado',
  payment_failed: 'Pagamento falhou',
  payment_recovery_attempt: 'Tentativa de regularizacao',
  payment_recovered: 'Pagamento recuperado',
  payment_pending: 'Pagamento pendente',
  pix_generated: 'PIX gerado',
  pix_paid: 'PIX pago',
  pix_expired: 'PIX expirado',
  subscription_renewed: 'Assinatura renovada',
  subscription_canceled: 'Assinatura cancelada',
  subscription_blocked: 'Assinatura bloqueada',
  payment_method_changed: 'Forma de pagamento alterada',
  subscription_updated: 'Assinatura atualizada',
  subscription_state_corrected: 'Estado sincronizado',
};

const PIX_POLL_INTERVAL_MS = 2000;
const PIX_POLL_MAX_ATTEMPTS = 60;
let mercadoPagoSdkPromise = null;

function generateIdempotencyKey() {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch {}
  return `subscription-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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
    pending: 'Pagamento pendente',
    pending_payment: 'Aguardando cartão',
    pending_pix: 'PIX pendente',
    past_due: 'Cartão recusado',
    unpaid: 'Inadimplente',
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
  if (['active'].includes(key)) return 'success';
  if (['trialing', 'due_soon'].includes(key)) return 'info';
  if (['pending_payment', 'pending_pix', 'past_due', 'overdue', 'pending'].includes(key)) return 'warning';
  if (['unpaid', 'blocked', 'expired', 'canceled', 'cancelled'].includes(key)) return 'danger';
  return 'neutral';
}

function getPaymentMethodLabel(value) {
  const key = String(value || '').toLowerCase();
  return PAYMENT_METHOD_LABELS[key] || (key ? key : 'Não definido');
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
    return { tone: 'error', label: 'Pagamento não confirmado', icon: '!' };
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

async function loadMercadoPagoSdk() {
  if (typeof window === 'undefined') throw new Error('browser_unavailable');
  if (window.MercadoPago) return window.MercadoPago;
  if (mercadoPagoSdkPromise) return mercadoPagoSdkPromise;

  mercadoPagoSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mercadopago-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.MercadoPago), { once: true });
      existing.addEventListener('error', () => reject(new Error('sdk_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.dataset.mercadopagoSdk = 'true';
    script.onload = () => resolve(window.MercadoPago);
    script.onerror = () => reject(new Error('sdk_load_failed'));
    document.head.appendChild(script);
  });

  return mercadoPagoSdkPromise;
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
  const cycleLabel = BILLING_CYCLE_LABELS[String(item?.billing_cycle || '').toLowerCase()] || 'Ciclo não informado';
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

function FinancialEventRow({ item }) {
  const eventLabel = FINANCIAL_EVENT_LABELS[item?.event_type] || String(item?.event_type || 'Evento');
  const statusLabel = getStatusLabel(item?.status);
  const statusTone = getStatusTone(item?.status);
  const planLabel = PLAN_META[normalizePlanKey(item?.plan)]?.label || String(item?.plan || 'Plano');
  const paymentMethodLabel = getPaymentMethodLabel(item?.payment_method);
  return (
    <li className="subscription-page__history-item">
      <div>
        <strong>{eventLabel}</strong>
        <span className="muted">{planLabel} • {paymentMethodLabel}</span>
      </div>
      <div>
        <span className={`subscription-page__status-chip subscription-page__status-chip--${statusTone}`}>
          {statusLabel}
        </span>
        <span className="muted">{formatDateTime(item?.created_at)}</span>
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
  const [cardState, setCardState] = useState({ ready: false, loading: false, submitting: false, error: '' });
  const [cardRecoveryReady, setCardRecoveryReady] = useState(false);
  const [cardFormResetKey, setCardFormResetKey] = useState(0);
  const [pixModal, setPixModal] = useState({ open: false, data: null });
  const [pixConfirmed, setPixConfirmed] = useState(false);
  const [pixNotice, setPixNotice] = useState('');
  const [pixCopyNotice, setPixCopyNotice] = useState('');

  const cardFormRef = useRef(null);
  const cardSubmittingRef = useRef(false);
  const cardSubmitIntentRef = useRef('save');
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

  const resetCardFormForNewToken = useCallback(() => {
    try {
      cardFormRef.current?.unmount?.();
    } catch {}
    cardFormRef.current = null;
    cardSubmittingRef.current = false;
    setCardFormResetKey((current) => current + 1);
    setCardState((current) => ({
      ...current,
      ready: false,
      loading: true,
      submitting: false,
    }));
  }, []);

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
      setError(getErrorMessage(requestError, 'Não foi possível carregar a assinatura agora.'));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [establishmentId, isEstablishment]);

  useEffect(() => {
    void refreshData();
    return () => {
      clearPixPolling();
      try {
        cardFormRef.current?.unmount?.();
      } catch {}
      cardFormRef.current = null;
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
  const currentPaymentMethod =
    subscriptionData?.subscription?.payment_method ||
    billingStatus?.subscription?.paymentMethod ||
    'pix';
  const accessMode = String(billingStatus?.access?.mode || '').toLowerCase() || 'full';
  const coreFeaturesAllowed = billingStatus?.access?.core_features_allowed !== false;
  const cardGatewayPublicKey = billingStatus?.payment_methods?.public_key || null;
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
  const paymentMethodLabel = getPaymentMethodLabel(currentPaymentMethod);
  const hasDelinquentStatus = ['past_due', 'unpaid', 'expired'].includes(planStatusKey);
  const cardAction = useMemo(() => {
    if (currentPaymentMethod === 'credit_card' && (hasDelinquentStatus || planStatusKey === 'pending_payment')) {
      return {
        mode: 'update',
        label: hasDelinquentStatus ? 'Salvar cartão para regularizar' : 'Atualizar cartão',
      };
    }
    if (currentPaymentMethod === 'credit_card') {
      return { mode: 'update', label: 'Trocar cartão' };
    }
    return {
      mode: 'subscribe',
      label: hasDelinquentStatus ? 'Salvar cartão para reativar' : 'Assinar com cartão',
    };
  }, [currentPaymentMethod, hasDelinquentStatus, planStatusKey]);

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

  const financialEvents = useMemo(() => {
    const list = Array.isArray(subscriptionData?.events) ? subscriptionData.events : [];
    return list.slice(0, 10);
  }, [subscriptionData?.events]);

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

  useEffect(() => {
    if (!hasDelinquentStatus) {
      setCardRecoveryReady(false);
    }
  }, [hasDelinquentStatus]);

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
        message: getErrorMessage(requestError, 'Não foi possível iniciar o teste gratuito agora.'),
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
        message: 'PIX gerado com sucesso. Pague e acompanhe a confirmação pelo seu banco.',
      });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Falha ao gerar cobrança PIX.'),
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
        message: 'PIX de renovação gerado. Assim que o pagamento confirmar, a assinatura será atualizada automaticamente.',
      });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Falha ao gerar PIX de renovação.'),
      });
      return false;
    } finally {
      setRenewalLoading(false);
    }
  }, [establishmentId, openPixModal, refreshData, renewalLoading]);

  const handleSubmitCard = useCallback(async (cardFormData) => {
    if (!establishmentId || cardSubmittingRef.current) return false;
    const submitIntent = cardSubmitIntentRef.current === 'recover' ? 'recover' : 'save';
    cardSubmitIntentRef.current = 'save';
    cardSubmittingRef.current = true;
    setCardState((current) => ({ ...current, submitting: true, error: '' }));
    setNotice({ type: '', message: '' });

    try {
      const payload = {
        plan: planKey,
        billing_cycle: checkoutCycle,
        card_token: cardFormData?.token,
        payer_email: cardFormData?.cardholderEmail || user?.email || '',
        payment_method_id: cardFormData?.paymentMethodId || null,
        issuer_id: cardFormData?.issuerId || null,
        identification_type: cardFormData?.identificationType || null,
        identification_number: cardFormData?.identificationNumber || null,
      };

      if (!payload.card_token) {
        throw new Error('Não foi possível tokenizar o cartão.');
      }

      if (submitIntent === 'recover') {
        const idempotencyKey = generateIdempotencyKey();
        const response = await Api.billingCardRecover(payload, { idempotencyKey });
        await refreshData({ silent: true });
        if (response?.paid) {
          setCardRecoveryReady(false);
          setNotice({
            type: 'success',
            message: 'Pagamento aprovado. A assinatura foi reativada e a renovação automática segue no cartão.',
          });
          return true;
        }
        resetCardFormForNewToken();
        setCardRecoveryReady(true);
        const message = response?.message || 'A cobrança pendente não foi aprovada. Gere um PIX ou tente outro cartão.';
        setCardState((current) => ({ ...current, error: message }));
        setNotice({ type: 'error', message });
        return false;
      }

      let response;
      if (cardAction.mode === 'update') {
        response = await Api.billingCardUpdate(payload);
      } else {
        response = await Api.billingCardSubscribe(payload);
      }

      await refreshData({ silent: true });
      if (response?.recovery_required) {
        setCardRecoveryReady(true);
        setNotice({
          type: 'warning',
          message: 'Cartão cadastrado com sucesso. Falta quitar a pendência para reativar o plano.',
        });
      } else {
        setCardRecoveryReady(false);
        setNotice({
          type: 'success',
          message: cardAction.mode === 'update'
            ? 'Cartão atualizado. Vamos sincronizar a cobrança recorrente automaticamente.'
            : 'Assinatura enviada no cartão. A renovação automática passa a ser o fluxo principal.',
        });
      }
      return true;
    } catch (requestError) {
      const message = getErrorMessage(requestError, 'Falha ao processar o cartão agora.');
      if (isMercadoPagoCardTokenRefreshRequired(requestError)) {
        resetCardFormForNewToken();
      }
      setCardState((current) => ({ ...current, error: message }));
      if (submitIntent === 'recover') {
        setCardRecoveryReady(true);
      }
      setNotice({ type: 'error', message });
      return false;
    } finally {
      cardSubmittingRef.current = false;
      setCardState((current) => ({ ...current, submitting: false }));
    }
  }, [cardAction.mode, checkoutCycle, establishmentId, planKey, refreshData, resetCardFormForNewToken, user?.email]);

  const handleRecoverNowWithCard = useCallback(() => {
    const form = document.getElementById('subscription-card-form');
    if (!form) return;
    cardSubmitIntentRef.current = 'recover';
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, []);

  useEffect(() => {
    if (!isEstablishment || !cardGatewayPublicKey) {
      setCardState((current) => ({ ...current, ready: false, error: '' }));
      return undefined;
    }
    let cancelled = false;

    const mountCardForm = async () => {
      setCardState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const MercadoPagoCtor = await loadMercadoPagoSdk();
        if (cancelled) return;

        try {
          cardFormRef.current?.unmount?.();
        } catch {}

        const mp = new MercadoPagoCtor(cardGatewayPublicKey, { locale: 'pt-BR' });
        const amount = (selectedPlanPriceCents / 100).toFixed(2);
        const cardForm = mp.cardForm({
          amount,
          iframe: true,
          form: {
            id: 'subscription-card-form',
            cardNumber: { id: 'subscription-card-number', placeholder: 'Número do cartão' },
            expirationDate: { id: 'subscription-card-expiration', placeholder: 'MM/AA' },
            securityCode: { id: 'subscription-card-security-code', placeholder: 'CVV' },
            cardholderName: { id: 'subscription-cardholder-name', placeholder: 'Titular do cartão' },
            issuer: { id: 'subscription-card-issuer', placeholder: 'Banco emissor' },
            installments: { id: 'subscription-card-installments', placeholder: 'Parcelas' },
            identificationType: { id: 'subscription-card-id-type', placeholder: 'Documento' },
            identificationNumber: { id: 'subscription-card-id-number', placeholder: 'Número do documento' },
            cardholderEmail: { id: 'subscription-card-email', placeholder: 'E-mail' },
          },
          callbacks: {
            onFormMounted: (error) => {
              if (cancelled) return;
              if (error) {
                setCardState((current) => ({
                  ...current,
                  ready: false,
                  loading: false,
                  error: 'Não foi possível montar o formulário do cartão.',
                }));
                return;
              }
              setCardState((current) => ({ ...current, ready: true, loading: false, error: '' }));
            },
            onSubmit: async (event) => {
              event.preventDefault();
              const data = cardForm.getCardFormData();
              await handleSubmitCard(data);
            },
          },
        });

        cardFormRef.current = cardForm;
      } catch (sdkError) {
        if (cancelled) return;
        setCardState((current) => ({
          ...current,
          ready: false,
          loading: false,
          error: 'Não foi possível carregar o SDK de cartão do gateway.',
        }));
      }
    };

    void mountCardForm();

    return () => {
      cancelled = true;
      try {
        cardFormRef.current?.unmount?.();
      } catch {}
      cardFormRef.current = null;
    };
  }, [cardFormResetKey, cardGatewayPublicKey, handleSubmitCard, isEstablishment, selectedPlanPriceCents]);

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
        setPixNotice('Ainda não confirmou. Se você já pagou, aguarde alguns instantes e clique em Atualizar.');
      }
      return response;
    } catch (requestError) {
      if (!silent) {
        setPixNotice(getErrorMessage(requestError, 'Não foi possível atualizar o status agora.'));
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
      setPixCopyNotice(ok ? 'Chave PIX copiada.' : 'Não foi possível copiar agora.');
      return ok;
    } catch {
      setPixCopyNotice('Não foi possível copiar agora.');
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
            setNotice({ type: 'success', message: 'Pagamento confirmado. A assinatura será atualizada automaticamente.' });
          } else if (checkoutStatus === 'pendente') {
            setNotice({ type: 'warn', message: 'Pagamento pendente de confirmação.' });
          } else if (checkoutStatus === 'erro') {
            setNotice({ type: 'error', message: 'O PIX foi cancelado ou expirou antes da confirmação.' });
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
            setNotice({ type: 'info', message: 'Teste grátis indisponível para a situação atual da conta.' });
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
    return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;
  }

  return (
    <div className="grid config-page settings-module-page subscription-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero subscription-page__hero">
        <div className="settings-module-hero__copy subscription-page__hero-copy">
          <span className="settings-module-hero__eyebrow">Gestão da assinatura</span>
          <h2>Plano e assinatura</h2>
          <p className="muted">
            Acompanhe o plano atual, limites operacionais, status da cobrança e os próximos passos da sua conta.
          </p>
        </div>
        <div className="settings-module-hero__meta subscription-page__hero-meta">
          <div className="settings-module-hero__pill">{planMeta.label} - {BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}</div>
          <div className={`subscription-page__status-chip subscription-page__status-chip--${planStatusTone}`}>
            {planStatusLabel}
          </div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configurações
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
      {!loading && accessMode !== 'full' ? (
        <div className={`notice notice--${coreFeaturesAllowed ? 'warn' : 'error'}`}>
          {coreFeaturesAllowed
            ? 'Existe uma cobrança pendente. Regularize cartão ou PIX para evitar bloqueio.'
            : 'As funcionalidades principais estão bloqueadas até a regularização. Login, assinatura, PIX e histórico financeiro continuam liberados.'}
        </div>
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
          <span className="subscription-page__eyebrow">Próximo marco</span>
          <h3>{nextDueLabel}</h3>
          <p className="muted">
            {planStatusKey === 'past_due'
              ? 'Cartão falhou. Regularize dentro da tolerância para evitar bloqueio.'
              : renewalRequired
                ? 'Existe renovação manual ou cobrança pendente para resolver.'
                : activeUntil
                  ? 'Ciclo atual registrado no backend de cobrança.'
                  : 'Sem vencimento confirmado no momento.'}
          </p>
        </div>

        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Teste grátis</span>
          <h3>
            {trialDaysLeft != null && planStatusKey === 'trialing'
              ? `${trialDaysLeft} ${trialDaysLeft === 1 ? 'dia' : 'dias'}`
              : trialAvailable
                ? 'Disponível'
                : 'Encerrado'}
          </h3>
          <p className="muted">
            {planStatusKey === 'trialing' && trialEndsAt
              ? `Válido até ${formatDateLong(trialEndsAt)}.`
              : trialAvailable
                ? 'Ative 7 dias do plano Pro sem cartão.'
                : 'O período de teste já foi consumido nesta conta.'}
          </p>
        </div>

        <div className="settings-module-card subscription-page__summary-card">
          <span className="subscription-page__eyebrow">Forma principal</span>
          <h3>{paymentMethodLabel}</h3>
          <p className="muted">
            {currentPaymentMethod === 'credit_card'
              ? 'Renovação automática habilitada no cartão.'
              : `PIX manual ativo. Referência atual: ${formatCurrencyFromCents(selectedPlanPriceCents)}.`}
          </p>
        </div>
      </div>

      <div className="subscription-page__content-grid">
        <section className="settings-module-card subscription-page__primary-card">
          <div className="subscription-page__section-head">
            <div>
              <h3>Resumo operacional</h3>
              <p className="muted">Limites do plano e uso atual da operação do estabelecimento.</p>
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
              label="Serviços"
              value={`${servicesUsage.total.toLocaleString('pt-BR')} / ${getLimitLabel(servicesUsage.limit)}`}
              hint="Cadastros disponíveis para venda"
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
              label="Agendamentos do mês"
              value={appointmentUsage.limit == null
                ? appointmentUsage.total.toLocaleString('pt-BR')
                : `${appointmentUsage.total.toLocaleString('pt-BR')} / ${getLimitLabel(appointmentUsage.limit)}`}
              hint={appointmentUsage.month || 'Mês atual'}
              tone={getUsageTone(appointmentUsage.total, appointmentUsage.limit)}
            />
            <UsageCard
              label="Relatórios"
              value={planContext?.limits?.allowAdvancedReports ? 'Avançados' : 'Básicos'}
              hint={planContext?.limits?.allowAdvancedReports ? 'Indicadores em tempo real liberados.' : 'Atualize para recursos avançados.'}
              tone={planContext?.limits?.allowAdvancedReports ? 'ok' : 'warning'}
            />
          </div>
        </section>

        <aside className="settings-module-card subscription-page__aside-card">
          <div className="subscription-page__section-head subscription-page__section-head--compact">
            <div>
              <h3>PIX manual</h3>
              <p className="muted">Use PIX para primeira assinatura, renovação, reativação ou contingência.</p>
            </div>
          </div>

          <label className="label subscription-page__cycle-field">
            <span>Ciclo para PIX</span>
            <select className="input" value={checkoutCycle} onChange={(event) => setSelectedCycle(event.target.value)}>
              <option value="mensal">Mensal</option>
              <option value="anual">Anual</option>
            </select>
          </label>

          <div className="subscription-page__action-stack">
            {trialAvailable ? (
              <button type="button" className="btn btn--outline btn--outline-brand" onClick={() => void handleStartTrial()} disabled={trialLoading}>
                {trialLoading ? <span className="spinner" /> : 'Ativar 7 dias grátis do Pro'}
              </button>
            ) : null}

            <Link className="btn btn--ghost" to="/planos#planos">
              Ver comparativo completo
            </Link>
          </div>

          <div className="subscription-page__callout">
            <strong>Regra do PIX</strong>
            <p className="muted">
              PIX não renova sozinho. Se a cobrança vencer sem pagamento, a assinatura não continua automaticamente e o acesso principal pode ser bloqueado.
            </p>
          </div>
        </aside>
      </div>

      <section className="settings-module-card subscription-page__payments-card">
        <div className="subscription-page__section-head">
          <div>
            <h3>Forma de pagamento</h3>
            <p className="muted">Cartão de crédito é o método principal com renovação automática. PIX continua como alternativa manual.</p>
          </div>
          <div className={`subscription-page__status-chip subscription-page__status-chip--${currentPaymentMethod === 'credit_card' ? 'success' : 'warning'}`}>
            {paymentMethodLabel}
          </div>
        </div>

        <div className="subscription-page__payment-grid">
          <div className="subscription-page__payment-panel subscription-page__payment-panel--recommended">
            <span className="subscription-page__payment-tag">Recomendado</span>
            <h4>Cartão de crédito</h4>
            <p className="muted">Renovação automática, sem interrupções enquanto as cobranças forem aprovadas.</p>
            <form id="subscription-card-form" className="subscription-page__card-form">
              <div id="subscription-card-number" className="input subscription-page__card-frame" />
              <div className="subscription-page__card-inline">
                <div id="subscription-card-expiration" className="input subscription-page__card-frame" />
                <div id="subscription-card-security-code" className="input subscription-page__card-frame" />
              </div>
              <input id="subscription-cardholder-name" className="input" placeholder="Titular do cartão" />
              <div className="subscription-page__card-inline">
                <select id="subscription-card-issuer" className="input" defaultValue="" />
                <select id="subscription-card-installments" className="input" defaultValue="" />
              </div>
              <div className="subscription-page__card-inline">
                <select id="subscription-card-id-type" className="input" defaultValue="" />
                <input id="subscription-card-id-number" className="input" placeholder="Número do documento" />
              </div>
              <input id="subscription-card-email" className="input" type="email" placeholder="E-mail" defaultValue={user?.email || ''} />
              <button
                id="subscription-card-submit"
                type="submit"
                className="btn btn--primary"
                onClick={() => { cardSubmitIntentRef.current = 'save'; }}
                disabled={cardState.loading || cardState.submitting || !cardGatewayPublicKey}
              >
                {cardState.submitting
                  ? <span className="spinner" />
                  : cardAction.label}
              </button>
            </form>
            {cardState.loading ? <span className="muted">Carregando formulário seguro do gateway...</span> : null}
            {cardState.error ? <span className="muted" style={{ color: '#b91c1c' }}>{cardState.error}</span> : null}
            {cardRecoveryReady && hasDelinquentStatus ? (
              <div className="subscription-page__callout">
                <strong>Cartão cadastrado com sucesso. Falta quitar a pendência para reativar o plano.</strong>
                <p className="muted">
                  O cadastro do cartão não libera o acesso sozinho. Quite a cobrança pendente agora ou gere um PIX manual.
                </p>
                <div className="subscription-page__payment-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleRecoverNowWithCard}
                    disabled={cardState.loading || cardState.submitting || !cardGatewayPublicKey}
                  >
                    {cardState.submitting ? <span className="spinner" /> : 'Pagar agora com cartão'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={() => {
                      if (openRenewalPayment) {
                        handleOpenPendingRenewal();
                        return;
                      }
                      void handleGenerateRenewalPix();
                    }}
                    disabled={renewalLoading}
                  >
                    {renewalLoading ? <span className="spinner" /> : 'Gerar PIX'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="subscription-page__payment-panel">
            <span className="subscription-page__payment-tag subscription-page__payment-tag--manual">Manual</span>
            <h4>PIX</h4>
            <p className="muted">Gere um PIX para contratar, renovar, reativar ou cobrir falha do cartão. Se não pagar, a renovação não acontece sozinha.</p>
            <div className="subscription-page__payment-actions">
              {openRenewalPayment ? (
                <button type="button" className="btn btn--outline" onClick={handleOpenPendingRenewal}>
                  Ver PIX pendente
                </button>
              ) : null}
              {!openRenewalPayment && renewalRequired ? (
                <button type="button" className="btn btn--outline" onClick={() => void handleGenerateRenewalPix()} disabled={renewalLoading}>
                  {renewalLoading ? <span className="spinner" /> : 'Gerar PIX de renovação'}
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
            </div>
          </div>
        </div>
      </section>

      <section className="settings-module-card subscription-page__history-card">
        <div className="subscription-page__section-head">
          <div>
            <h3>Histórico financeiro</h3>
            <p className="muted">Eventos recentes de assinatura, cobrança, PIX e regularização.</p>
          </div>
          <div className={`subscription-page__status-chip subscription-page__status-chip--${getStatusTone(billingStatus?.state)}`}>
            {getStatusLabel(billingStatus?.state)}
          </div>
        </div>
        {financialEvents.length ? (
          <ul className="subscription-page__history-list">
            {financialEvents.map((item) => (
              <FinancialEventRow key={item?.id || `${item?.event_type}-${item?.created_at || 'row'}`} item={item} />
            ))}
          </ul>
        ) : (
          <div className="subscription-page__empty">Nenhum evento financeiro recente para exibir.</div>
        )}
        {history.length ? (
          <>
            <div className="subscription-page__section-head subscription-page__section-head--compact">
              <div>
                <h3>Histórico de assinaturas</h3>
                <p className="muted">Últimos ciclos e mudanças registrados localmente.</p>
              </div>
            </div>
            <ul className="subscription-page__history-list">
              {history.map((item) => (
                <HistoryRow key={item?.id || `${item?.plan}-${item?.created_at || item?.updated_at || 'row'}`} item={item} />
              ))}
            </ul>
          </>
        ) : null}
        {!history.length && !financialEvents.length ? (
          <div className="subscription-page__empty">Nenhuma movimentação recente para exibir.</div>
        ) : null}
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
                    <span>Aguardando confirmação do pagamento...</span>
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
                  ? 'Pague pelo app do seu banco e aguarde a confirmação automática. Renovação liberada após a aprovação.'
                  : isCheckoutPix
                    ? 'Pague pelo app do seu banco e aguarde a confirmação automática. O novo plano será liberado após a aprovação.'
                    : 'Pague pelo app do seu banco e aguarde a confirmação automática.'}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
