import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import {
  getMercadoPagoCardErrorMessage,
  isMercadoPagoCardTokenRefreshRequired,
} from '../utils/mercadoPagoCard.js';
import { buildSubscriptionFinancialHistory } from '../utils/subscriptionFinancialHistory.js';

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

const FINANCIAL_EVENT_LABELS = {};

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

function getPaymentResultMessage(result, fallback) {
  return result?.payment_result?.user_message || result?.message || fallback;
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

function getPlanTier(value) {
  const key = normalizePlanKey(value);
  if (key === 'premium') return 2;
  if (key === 'pro') return 1;
  return 0;
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

function MappedFinancialEventRow({ item }) {
  return (
    <li className="subscription-page__history-item">
      <div>
        <span className="subscription-page__history-eyebrow">{item?.display_title || 'Evento financeiro'}</span>
        <strong>{item?.display_subtitle || 'Movimentacao financeira registrada.'}</strong>
        {item?.display_message ? <span className="muted">{item.display_message}</span> : null}
        <div className="subscription-page__history-meta">
          <span className="subscription-page__history-method">{item?.payment_method_label || 'Não definido'}</span>
          {item?.reference_value ? (
            <span className="muted">{item?.reference_label || 'Ref'}: {item.reference_value}</span>
          ) : null}
        </div>
      </div>
      <div>
        <span className={`subscription-page__status-chip subscription-page__status-chip--${item?.display_badge?.tone || 'neutral'}`}>
          {item?.display_badge?.label || 'Sem status'}
        </span>
        <span className="muted">{formatDateTime(item?.created_at)}</span>
      </div>
    </li>
  );
}

function FinancialOverviewCard({ eyebrow, title, statusLabel, statusTone = 'neutral', methodLabel, message, createdAt, referenceLabel, referenceValue }) {
  return (
    <div className="subscription-page__financial-card">
      <div className="subscription-page__financial-card-head">
        <span className="subscription-page__history-eyebrow">{eyebrow}</span>
        {statusLabel ? (
          <span className={`subscription-page__status-chip subscription-page__status-chip--${statusTone}`}>
            {statusLabel}
          </span>
        ) : null}
      </div>
      <strong>{title}</strong>
      {methodLabel ? <span className="muted">Meio: {methodLabel}</span> : null}
      {message ? <p className="muted">{message}</p> : null}
      <div className="subscription-page__history-meta">
        {createdAt ? <span className="muted">Data: {formatDateTime(createdAt)}</span> : null}
        {referenceValue ? (
          <span className="muted">{referenceLabel || 'Ref'}: {referenceValue}</span>
        ) : null}
      </div>
    </div>
  );
}

function CreditEntryRow({ item }) {
  const sourceLabel = PLAN_META[normalizePlanKey(item?.source_plan)]?.label || 'Plano anterior';
  const targetLabel = PLAN_META[normalizePlanKey(item?.target_plan)]?.label || 'Plano novo';
  const confirmationMethodLabel = PAYMENT_METHOD_LABELS[String(item?.payment_method || '').toLowerCase()] || null;
  const statusMap = {
    available: { label: 'Disponível', tone: 'success' },
    partially_reserved: { label: 'Parcialmente reservado', tone: 'info' },
    reserved: { label: 'Reservado', tone: 'info' },
    partially_consumed: { label: 'Parcialmente consumido', tone: 'warning' },
    consumed: { label: 'Consumido', tone: 'neutral' },
  };
  const statusMeta = statusMap[String(item?.status || '').toLowerCase()] || { label: 'Registrado', tone: 'neutral' };
  return (
    <li className="subscription-page__history-item">
      <div>
        <span className="subscription-page__history-eyebrow">{`Upgrade realizado: ${sourceLabel} -> ${targetLabel}`}</span>
        <strong>{`Crédito proporcional gerado: ${formatCurrencyFromCents(item?.generated_credit_cents)}`}</strong>
        <span className="muted">
          {`Disponível: ${formatCurrencyFromCents(item?.remaining_credit_cents)} • Consumido: ${formatCurrencyFromCents(item?.consumed_credit_cents)}`}
        </span>
        <span className="muted">
          {`Nominal: ${sourceLabel} ${formatCurrencyFromCents(item?.original_plan_amount_cents)} -> ${targetLabel} ${formatCurrencyFromCents(item?.target_plan_amount_cents)}`}
        </span>
        <span className="muted">
          {`Ciclo original: ${formatDateLong(item?.source_cycle_started_at)} até ${formatDateLong(item?.source_cycle_ends_at)}`}
        </span>
        {confirmationMethodLabel ? (
          <span className="muted">{`Confirmado via ${confirmationMethodLabel}`}</span>
        ) : null}
      </div>
      <div>
        <span className={`subscription-page__status-chip subscription-page__status-chip--${statusMeta.tone}`}>
          {statusMeta.label}
        </span>
        <span className="muted">{formatDateTime(item?.changed_at)}</span>
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
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedCycle, setSelectedCycle] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [billingProvider, setBillingProvider] = useState('mercadopago');
  const [providerReady, setProviderReady] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [cardState, setCardState] = useState({ ready: false, loading: false, submitting: false, error: '' });
  const [cardRecoveryReady, setCardRecoveryReady] = useState(false);
  const [cardRecoveryNeedsNewToken, setCardRecoveryNeedsNewToken] = useState(false);
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
  const paymentSectionRef = useRef(null);

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
    cardSubmitIntentRef.current = 'save';
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
        const plan =
          subscriptionResponse?.subscription?.plan ||
          billingResponse?.subscription?.plan ||
          subscriptionResponse?.plan?.plan ||
          billingResponse?.plan ||
          'starter';
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
  const planKey = normalizePlanKey(
    subscriptionData?.subscription?.plan ||
    billingStatus?.subscription?.plan ||
    planContext?.plan ||
    billingStatus?.plan ||
    'starter',
  );
  const planMeta = PLAN_META[planKey] || PLAN_META.starter;
  const planStatusKey = normalizeStatusKey(
    subscriptionData?.subscription?.status || billingStatus?.subscription?.status || planContext?.status,
  );
  const planStatusLabel = getStatusLabel(planStatusKey);
  const planStatusTone = getStatusTone(planStatusKey);
  const subscriptionStatusCardLabel = ['pending_payment', 'pending_pix', 'past_due', 'unpaid', 'expired'].includes(planStatusKey)
    ? 'Regularizacao pendente'
    : planStatusLabel;
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
  const canOfferProCheckout = !trialAvailable && getPlanTier(planKey) < getPlanTier('pro');
  const renewalInfo = billingStatus?.billing || {};
  const renewalRequired = Boolean(renewalInfo.renewalRequired);
  const openRenewalPayment = renewalInfo.hasOpenPayment ? renewalInfo.openPayment || null : null;
  const checkoutPlanKey = normalizePlanKey(selectedPlan || planKey);
  const checkoutPlanMeta = PLAN_META[checkoutPlanKey] || PLAN_META.starter;
  const currentPlanPriceCents = currentCycle === 'anual' ? planMeta.annualPriceCents : planMeta.priceCents;
  const checkoutCycle = selectedCycle || currentCycle || 'mensal';
  const selectedPlanPriceCents = checkoutCycle === 'anual' ? checkoutPlanMeta.annualPriceCents : checkoutPlanMeta.priceCents;
  // Economia do anual vs. pagar 12 meses no mensal.
  const annualSavingsCents = Math.max(
    0,
    (Number(checkoutPlanMeta.priceCents) || 0) * 12 - (Number(checkoutPlanMeta.annualPriceCents) || 0),
  );
  const hasCheckoutSelection = checkoutPlanKey !== planKey || checkoutCycle !== currentCycle;
  const paymentMethodLabel = getPaymentMethodLabel(currentPaymentMethod);
  const hasDelinquentStatus = ['past_due', 'unpaid', 'expired'].includes(planStatusKey);
  const cardAction = useMemo(() => {
    if (hasCheckoutSelection && !hasDelinquentStatus) {
      const planChanged = checkoutPlanKey !== planKey;
      return {
        mode: 'subscribe',
        label: planChanged
          ? (currentPaymentMethod === 'credit_card'
            ? `Migrar para ${checkoutPlanMeta.label} com cartão`
            : `Assinar ${checkoutPlanMeta.label} com cartão`)
          : `Assinar ${checkoutPlanMeta.label} ${BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'} no cartão`,
      };
    }
    if (currentPaymentMethod === 'credit_card' && (hasDelinquentStatus || planStatusKey === 'pending_payment')) {
      return {
        mode: 'update',
        label: hasDelinquentStatus ? 'Atualizar cartão da assinatura' : 'Atualizar cartão',
      };
    }
    if (currentPaymentMethod === 'credit_card') {
      return { mode: 'update', label: 'Trocar cartão' };
    }
    if (hasDelinquentStatus) {
      return { mode: 'subscribe', label: 'Atualizar cartão da assinatura' };
    }
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
  }, [checkoutCycle, checkoutPlanKey, checkoutPlanMeta.label, currentPaymentMethod, hasCheckoutSelection, hasDelinquentStatus, planKey, planStatusKey]);

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

  const rawFinancialEvents = useMemo(() => {
    const list = Array.isArray(subscriptionData?.events) ? subscriptionData.events : [];
    return list.slice(0, 20);
  }, [subscriptionData?.events]);
  const financialHistory = useMemo(() => (
    buildSubscriptionFinancialHistory(rawFinancialEvents, { subscriptionStatus: planStatusKey })
  ), [planStatusKey, rawFinancialEvents]);
  const financialEvents = financialHistory.timeline.slice(0, 10);
  const latestCardAttempt = financialHistory.latest_card_attempt;
  const openPixEvent = financialHistory.open_pix_event;
  const recoveryGuard = subscriptionData?.recovery_guard || null;
  const recoveryBlocked = hasDelinquentStatus && recoveryGuard?.can_run === false;
  const creditSummary = subscriptionData?.credits?.summary || {};
  const creditPreview = subscriptionData?.credits?.preview || null;
  const creditEntries = useMemo(() => {
    const list = Array.isArray(subscriptionData?.credits?.entries) ? subscriptionData.credits.entries : [];
    return list.slice(0, 6);
  }, [subscriptionData?.credits?.entries]);
  const availableCreditCents = Number(creditSummary?.remaining_credit_cents || 0) || 0;
  const reservedCreditCents = Number(creditSummary?.reserved_credit_cents || 0) || 0;
  const consumedCreditCents = Number(creditSummary?.consumed_credit_cents || 0) || 0;
  const hasCreditData = availableCreditCents > 0 || reservedCreditCents > 0 || creditEntries.length > 0;
  const creditPreviewMessage = useMemo(() => {
    if (!creditPreview) return 'Quando existir saldo de crédito, o abatimento aparecerá aqui automaticamente.';
    if (creditPreview.next_renewal_covered_fully) {
      const fullCycles = Number(creditPreview.scheduled_full_cycles || 0) || 0;
      if (fullCycles === 1) {
        return 'A próxima renovação está coberta pelo crédito. A próxima cobrança paga será recalculada automaticamente.';
      }
      return `As próximas ${fullCycles} renovações estão cobertas pelo crédito. A próxima cobrança paga será recalculada automaticamente.`;
    }
    if (Number(creditPreview.next_charge_credit_cents || 0) > 0) {
      return `Na próxima cobrança prevista, ${formatCurrencyFromCents(creditPreview.next_charge_credit_cents)} será abatido automaticamente.`;
    }
    return 'O saldo disponível será abatido automaticamente nas próximas cobranças.';
  }, [creditPreview]);

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
      setCardRecoveryNeedsNewToken(false);
      setCardRecoveryReady(false);
      return;
    }
    if (recoveryBlocked) {
      setCardRecoveryReady(false);
    }
  }, [hasDelinquentStatus, recoveryBlocked]);

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

  // Retorno do checkout hospedado do Asaas (?assinatura=sucesso): avisa e atualiza o status.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('assinatura') === 'sucesso') {
      setNotice({
        type: 'success',
        message: 'Pagamento recebido! Sua assinatura será ativada assim que o Asaas confirmar.',
      });
      refreshData({ silent: true });
      window.history.replaceState({}, '', '/assinatura');
    }
  }, [location.search, refreshData]);

  // Descobre o provider ativo (Asaas usa checkout hospedado, sem CardForm/PCI).
  useEffect(() => {
    let alive = true;
    Api.billingAsaasProvider()
      .then((r) => { if (alive && r?.billing_provider) setBillingProvider(r.billing_provider); })
      .catch(() => {})
      .finally(() => { if (alive) setProviderReady(true); });
    return () => { alive = false; };
  }, []);

  // Modal de CPF/CNPJ para assinar via Asaas (substitui o antigo window.prompt do navegador).
  const [cpfModal, setCpfModal] = useState({ open: false, plan: null, cycle: 'mensal', value: '', error: '' });
  const closeCpfModal = useCallback(
    () => setCpfModal({ open: false, plan: null, cycle: 'mensal', value: '', error: '' }),
    [],
  );

  // Parte de API do checkout Asaas (cria a assinatura e redireciona ao checkout hospedado),
  // isolada para ser reusada quando já há CPF no perfil OU depois que o modal coletar um.
  const startAsaasCheckout = useCallback(async (targetPlan, billingCycle, cpfCnpj) => {
    setCheckoutLoading(true);
    setNotice({ type: '', message: '' });
    try {
      const response = await Api.billingAsaasCheckoutSession({ plan: targetPlan, billing_cycle: billingCycle, cpf_cnpj: cpfCnpj });
      if (response?.init_point) {
        window.location.assign(response.init_point);
        return true;
      }
      await refreshData({ silent: true });
      setNotice({
        type: 'info',
        message: 'Assinatura criada. Aguarde alguns segundos e atualize para ver o link de pagamento.',
      });
      return true;
    } catch (requestError) {
      setNotice({
        type: 'error',
        message: getErrorMessage(requestError, 'Falha ao iniciar a assinatura no Asaas.'),
      });
      return false;
    } finally {
      setCheckoutLoading(false);
    }
  }, [refreshData]);

  // Assinatura via Asaas: usa o CPF/CNPJ do perfil; se faltar, abre o MODAL para coletar
  // (antes era window.prompt). O backend valida e salva no perfil.
  const handleAsaasCheckout = useCallback(async (targetPlan, billingCycle = 'mensal') => {
    if (!establishmentId || checkoutLoading) return false;
    const cpfCnpj = String(user?.cpf_cnpj || '').replace(/\D/g, '');
    if (![11, 14].includes(cpfCnpj.length)) {
      setCpfModal({ open: true, plan: targetPlan, cycle: billingCycle, value: '', error: '' });
      return false;
    }
    return startAsaasCheckout(targetPlan, billingCycle, cpfCnpj);
  }, [checkoutLoading, establishmentId, startAsaasCheckout, user?.cpf_cnpj]);

  // Confirmação do modal de CPF/CNPJ -> valida e segue o checkout com o número informado.
  const submitCpfModal = useCallback(async () => {
    const digits = String(cpfModal.value || '').replace(/\D/g, '');
    if (![11, 14].includes(digits.length)) {
      setCpfModal((m) => ({ ...m, error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido — somente números.' }));
      return;
    }
    const { plan, cycle } = cpfModal;
    closeCpfModal();
    await startAsaasCheckout(plan, cycle || 'mensal', digits);
  }, [cpfModal, closeCpfModal, startAsaasCheckout]);

  const handleStartCheckout = useCallback(async (targetPlan, billingCycle = 'mensal') => {
    if (!establishmentId || checkoutLoading) return false;
    if (billingProvider === 'asaas') return handleAsaasCheckout(targetPlan, billingCycle);
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
  }, [checkoutLoading, establishmentId, openPixModal, refreshData, billingProvider, handleAsaasCheckout]);

  const handleOpenPendingRenewal = useCallback(() => {
    if (!openRenewalPayment) return;
    openPixModal({ ...openRenewalPayment, kind: 'renewal' });
  }, [openPixModal, openRenewalPayment]);

  const handleGenerateRenewalPix = useCallback(async () => {
    if (!establishmentId || renewalLoading) return false;
    // Assinatura Asaas renova automaticamente — não há PIX de renovação manual (é rota MP).
    if (billingProvider === 'asaas') {
      setNotice({ type: 'info', message: 'Sua assinatura Asaas renova automaticamente — não é preciso gerar PIX de renovação.' });
      return false;
    }
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
  }, [billingProvider, establishmentId, openPixModal, refreshData, renewalLoading]);

  const handleSubmitCard = useCallback(async (cardFormData) => {
    if (!establishmentId || cardSubmittingRef.current) return false;
    // Asaas não captura cartão na interface: redireciona ao checkout hospedado.
    if (billingProvider === 'asaas') {
      const asaasPlan = cardAction.mode === 'update' ? planKey : checkoutPlanKey;
      const asaasCycle = cardAction.mode === 'update' ? currentCycle : checkoutCycle;
      return handleAsaasCheckout(asaasPlan, asaasCycle);
    }
    const submitIntent = cardSubmitIntentRef.current === 'recover' ? 'recover' : 'save';
    cardSubmitIntentRef.current = 'save';
    cardSubmittingRef.current = true;
    setCardState((current) => ({ ...current, submitting: true, error: '' }));
    setNotice({ type: '', message: '' });

    try {
      const cardTargetPlan = cardAction.mode === 'update' ? planKey : checkoutPlanKey;
      const cardTargetCycle = cardAction.mode === 'update' ? currentCycle : checkoutCycle;
      const payload = {
        plan: cardTargetPlan,
        billing_cycle: cardTargetCycle,
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
        if (response?.pending) {
          setCardRecoveryReady(false);
          setCardState((current) => ({ ...current, error: '' }));
          setNotice({
            type: 'warning',
            message: getPaymentResultMessage(
              response,
              'O pagamento está em análise pelo Mercado Pago. Aguarde a confirmação antes de tentar novamente.',
            ),
          });
          return false;
        }
        setCardRecoveryReady(response?.payment_result?.manual_retry_allowed !== false);
        const fallbackMessage = getPaymentResultMessage(
          response,
          'A cobrança pendente não foi aprovada. Gere um PIX ou tente outro cartão.',
        );
        const message = response?.message || 'A cobrança pendente não foi aprovada. Gere um PIX ou tente outro cartão.';
        setCardState((current) => ({ ...current, error: fallbackMessage }));
        setNotice({ type: 'error', message: fallbackMessage });
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
        const recoveryAllowed = response?.recovery_guard?.can_run !== false;
        setCardRecoveryReady(recoveryAllowed);
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
            : `Assinatura do plano ${PLAN_META[normalizePlanKey(cardTargetPlan)]?.label || 'selecionado'} enviada no cartão. A renovação automática passa a ser o fluxo principal.`,
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
        setCardRecoveryReady(requestError?.data?.recovery_guard?.can_run === true);
      }
      setNotice({ type: 'error', message });
      return false;
    } finally {
      cardSubmittingRef.current = false;
      setCardState((current) => ({ ...current, submitting: false }));
    }
  }, [cardAction.mode, checkoutCycle, checkoutPlanKey, currentCycle, establishmentId, planKey, refreshData, resetCardFormForNewToken, user?.email, billingProvider, handleAsaasCheckout]);

  const handleCardSubmitSecure = useCallback(async (cardFormData) => {
    if (!establishmentId || cardSubmittingRef.current) return false;
    // Asaas não captura cartão na interface: redireciona ao checkout hospedado.
    if (billingProvider === 'asaas') {
      const asaasPlan = cardAction.mode === 'update' ? planKey : checkoutPlanKey;
      const asaasCycle = cardAction.mode === 'update' ? currentCycle : checkoutCycle;
      return handleAsaasCheckout(asaasPlan, asaasCycle);
    }
    const submitIntent = cardSubmitIntentRef.current === 'recover' ? 'recover' : 'save';
    cardSubmitIntentRef.current = 'save';
    cardSubmittingRef.current = true;
    setCardState((current) => ({ ...current, submitting: true, error: '' }));
    setNotice({ type: '', message: '' });

    try {
      const cardTargetPlan = cardAction.mode === 'update' ? planKey : checkoutPlanKey;
      const cardTargetCycle = cardAction.mode === 'update' ? currentCycle : checkoutCycle;
      const payload = {
        plan: cardTargetPlan,
        billing_cycle: cardTargetCycle,
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
          setCardRecoveryNeedsNewToken(false);
          resetCardFormForNewToken();
          setNotice({
            type: 'success',
            message: 'Pagamento aprovado. A assinatura foi reativada e a renovação automática segue no cartão.',
          });
          return true;
        }

        resetCardFormForNewToken();

        if (response?.pending) {
          setCardRecoveryReady(false);
          setCardRecoveryNeedsNewToken(false);
          setCardState((current) => ({ ...current, error: '' }));
          setNotice({
            type: 'warning',
            message: getPaymentResultMessage(
              response,
              'O pagamento está em análise pelo Mercado Pago. Aguarde a confirmação antes de tentar novamente.',
            ),
          });
          return false;
        }

        const manualRetryAllowed = response?.payment_result?.manual_retry_allowed !== false;
        setCardRecoveryReady(manualRetryAllowed);
        setCardRecoveryNeedsNewToken(manualRetryAllowed);
        const message = getPaymentResultMessage(
          response,
          'Não foi possível concluir a cobrança agora. Tente novamente em instantes.',
        );
        setCardState((current) => ({ ...current, error: message }));
        setNotice({ type: 'error', message });
        return false;
      }

      const response = cardAction.mode === 'update'
        ? await Api.billingCardUpdate(payload)
        : await Api.billingCardSubscribe(payload);

      await refreshData({ silent: true });
      resetCardFormForNewToken();

      if (response?.recovery_required) {
        const recoveryAllowed = response?.recovery_guard?.can_run !== false;
        setCardRecoveryReady(recoveryAllowed);
        setCardRecoveryNeedsNewToken(true);
        setNotice({
          type: 'warning',
          message: recoveryAllowed
            ? 'Cartão da assinatura atualizado. Para cobrar a pendência agora, confirme novamente os dados do cartão para gerar um novo token de segurança.'
            : 'Cartão da assinatura atualizado. A pendência continua em aberto e será necessário confirmar novamente os dados do cartão quando a cobrança manual estiver disponível.',
        });
      } else {
        setCardRecoveryReady(false);
        setCardRecoveryNeedsNewToken(false);
        setNotice({
          type: 'success',
          message: cardAction.mode === 'update'
            ? 'Cartão atualizado. Vamos sincronizar a cobrança recorrente automaticamente.'
            : `Assinatura do plano ${PLAN_META[normalizePlanKey(cardTargetPlan)]?.label || 'selecionado'} enviada no cartão. A renovação automática passa a ser o fluxo principal.`,
        });
      }
      return true;
    } catch (requestError) {
      const requiresNewToken = isMercadoPagoCardTokenRefreshRequired(requestError);
      const message = getMercadoPagoCardErrorMessage(requestError, 'Falha ao processar o cartão agora.');

      if (requiresNewToken) {
        resetCardFormForNewToken();
        if (submitIntent === 'recover' || hasDelinquentStatus) {
          setCardRecoveryNeedsNewToken(true);
        }
      }

      setCardState((current) => ({ ...current, error: message }));
      if (submitIntent === 'recover' && requestError?.data?.recovery_guard) {
        setCardRecoveryReady(requestError?.data?.recovery_guard?.can_run === true);
      }
      setNotice({ type: 'error', message });
      return false;
    } finally {
      cardSubmittingRef.current = false;
      setCardState((current) => ({ ...current, submitting: false }));
    }
  }, [cardAction.mode, checkoutCycle, checkoutPlanKey, currentCycle, establishmentId, hasDelinquentStatus, planKey, refreshData, resetCardFormForNewToken, user?.email, billingProvider, handleAsaasCheckout]);

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
              await handleCardSubmitSecure(data);
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
  }, [cardFormResetKey, cardGatewayPublicKey, handleCardSubmitSecure, isEstablishment, selectedPlanPriceCents]);

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

  const openCardChoice = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      paymentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

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
            const targetPlan = PLAN_META[normalizePlanKey(intentPlan || 'pro')]?.label || 'Pro';
            setNotice({
              type: 'warn',
              message: `O teste grátis desta conta já foi usado. Escolha abaixo como deseja pagar o plano ${targetPlan}: cartão ou PIX.`,
            });
            setSelectedPlan(normalizePlanKey(intentPlan || 'pro'));
            setSelectedCycle(intentCycle || checkoutCycle);
            openCardChoice();
          }
        } else if (intentPlan) {
          const targetPlan = normalizePlanKey(intentPlan);
          setSelectedPlan(targetPlan);
          setSelectedCycle(intentCycle || checkoutCycle);
          setNotice({
            type: 'info',
            message: `Escolha como deseja pagar o plano ${PLAN_META[targetPlan]?.label || 'selecionado'}: cartão com renovação automática ou PIX manual.`,
          });
          openCardChoice();
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
    openCardChoice,
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
          <span className="settings-module-hero__eyebrow">Assinatura</span>
          <h2>Plano e assinatura</h2>
          <p className="muted">
            Pague ou renove seu plano em poucos cliques.
          </p>
        </div>
        <div className="settings-module-hero__meta subscription-page__hero-meta">
          <div className={`subscription-page__status-chip subscription-page__status-chip--${planStatusTone}`}>
            {planStatusLabel}
          </div>
        </div>
        {!loading ? (
          <div className="subscription-page__hero-status">
            <div className="subscription-page__summary-cell">
              <span className="subscription-page__eyebrow">Plano atual</span>
              <div className="subscription-page__summary-value">{formatCurrencyFromCents(currentPlanPriceCents)}</div>
              <span className="muted">{planMeta.label} · {BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}</span>
            </div>
            <div className="subscription-page__summary-cell">
              <span className="subscription-page__eyebrow">Vencimento</span>
              <div className="subscription-page__summary-value">{nextDueLabel}</div>
              <span className="muted">
                {planStatusKey === 'trialing' && trialEndsAt
                  ? `Teste grátis até ${formatDateLong(trialEndsAt)}.`
                  : activeUntil
                    ? 'Próxima cobrança do ciclo atual.'
                    : 'Sem vencimento confirmado.'}
              </span>
            </div>
          </div>
        ) : null}
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

      {!loading ? (
        <section ref={paymentSectionRef} className="settings-module-card subscription-page__payments-card subscription-page__pay-card">
          <div className="subscription-page__section-head">
            <div>
              <h3>Pagar assinatura</h3>
              <p className="muted">
                Escolha o ciclo e confirme. O pagamento (cartão ou PIX) é concluído na tela segura do Asaas.
              </p>
            </div>
          </div>

          <label className="label subscription-page__cycle-field">
            <span>Ciclo de cobrança</span>
            <select className="input" value={checkoutCycle} onChange={(event) => setSelectedCycle(event.target.value)}>
              <option value="mensal">Mensal — {formatCurrencyFromCents(checkoutPlanMeta.priceCents)}</option>
              <option value="anual">{`Anual — ${formatCurrencyFromCents(checkoutPlanMeta.annualPriceCents)}${annualSavingsCents > 0 ? ` (economia de ${formatCurrencyFromCents(annualSavingsCents)})` : ''}`}</option>
            </select>
          </label>

          <div className="subscription-page__callout">
            <strong>{checkoutPlanMeta.label} · {BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}</strong>
            <p className="muted">Total: {formatCurrencyFromCents(selectedPlanPriceCents)}</p>
          </div>

          <div className="subscription-page__action-stack">
            {trialAvailable ? (
              <button type="button" className="btn btn--outline btn--outline-brand" onClick={() => void handleStartTrial()} disabled={trialLoading}>
                {trialLoading ? <span className="spinner" /> : 'Ativar 7 dias grátis do Pro'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleStartCheckout(checkoutPlanKey, checkoutCycle)}
              disabled={checkoutLoading || !providerReady}
            >
              {checkoutLoading ? <span className="spinner" /> : `Assinar ${checkoutPlanMeta.label} ${BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}`}
            </button>
            <Link className="btn btn--ghost" to="/planos#planos">
              Comparar planos
            </Link>
          </div>

          <p className="muted">
            No cartão a renovação é automática; no PIX você paga a cada ciclo. Ambos são concluídos na tela segura do Asaas.
          </p>
        </section>
      ) : null}

      {hasCreditData ? (
        <details className="settings-module-card subscription-page__history-card subscription-page__details">
          <summary className="subscription-page__details-summary">
            <span>Crédito proporcional</span>
            <span className="subscription-page__status-chip subscription-page__status-chip--success">{formatCurrencyFromCents(availableCreditCents)}</span>
          </summary>
          <div className="subscription-page__financial-overview">
            <FinancialOverviewCard
              eyebrow="Saldo"
              title={`Crédito disponível: ${formatCurrencyFromCents(availableCreditCents)}`}
              statusLabel={reservedCreditCents > 0 ? 'Agendado' : 'Disponível'}
              statusTone={reservedCreditCents > 0 ? 'info' : 'success'}
              message={
                reservedCreditCents > 0
                  ? `${formatCurrencyFromCents(reservedCreditCents)} já estão reservados para abatimentos futuros.`
                  : 'Esse saldo será abatido automaticamente nas próximas cobranças elegíveis.'
              }
            />
            {creditPreview ? (
              <FinancialOverviewCard
                eyebrow="Próxima cobrança"
                title={creditPreview.next_renewal_covered_fully
                  ? 'A próxima renovação será coberta pelo crédito'
                  : `Próxima cobrança prevista: ${formatCurrencyFromCents(creditPreview.next_charge_amount_cents)}`}
                statusLabel={creditPreview.next_renewal_covered_fully ? 'Coberta' : 'Com abatimento'}
                statusTone={creditPreview.next_renewal_covered_fully ? 'success' : 'info'}
                message={creditPreviewMessage}
                createdAt={creditPreview.next_charge_at}
              />
            ) : null}
            {consumedCreditCents > 0 ? (
              <FinancialOverviewCard
                eyebrow="Histórico"
                title={`Crédito consumido: ${formatCurrencyFromCents(consumedCreditCents)}`}
                statusLabel="Auditavel"
                statusTone="neutral"
                message="Cada geração, reserva e consumo fica registrado no histórico financeiro da assinatura."
              />
            ) : null}
          </div>
          {creditEntries.length ? (
            <ul className="subscription-page__history-list">
              {creditEntries.map((item) => (
                <CreditEntryRow key={item?.id || `${item?.source_plan}-${item?.changed_at || 'credit'}`} item={item} />
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}

      <details className="settings-module-card subscription-page__details">
        <summary className="subscription-page__details-summary">Detalhes do plano e uso</summary>

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
        </details>

        {false ? (
        <aside className="settings-module-card subscription-page__aside-card">
          <div className="subscription-page__section-head subscription-page__section-head--compact">
            <div>
              <h3>PIX manual</h3>
              <p className="muted">Use PIX para primeira assinatura, renovação, reativação ou contingência.</p>
            </div>
          </div>

          {hasCheckoutSelection ? (
            <div className="subscription-page__callout">
              <strong>Plano selecionado: {checkoutPlanMeta.label}</strong>
              <p className="muted">
                Escolha como deseja concluir a contratação: cartão com renovação automática ou PIX manual no ciclo {BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}.
              </p>
            </div>
          ) : null}

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
            {hasCheckoutSelection && !hasDelinquentStatus ? (
              <button type="button" className="btn btn--outline" onClick={openCardChoice}>
                Pagar {checkoutPlanMeta.label} com cartão
              </button>
            ) : null}
            {canOfferProCheckout && !hasCheckoutSelection ? (
              <button type="button" className="btn btn--primary" onClick={() => {
                setSelectedPlan('pro');
                openCardChoice();
              }}>
                Escolher pagamento do Pro
              </button>
            ) : null}
            {hasCheckoutSelection ? (
              <button type="button" className="btn btn--primary" onClick={() => void handleStartCheckout(checkoutPlanKey, checkoutCycle)} disabled={checkoutLoading || !providerReady}>
                {checkoutLoading ? <span className="spinner" /> : (billingProvider === 'asaas' ? `Assinar ${checkoutPlanMeta.label}` : `Gerar PIX do ${checkoutPlanMeta.label}`)}
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
        ) : null}

      {false ? (
      <section className="settings-module-card subscription-page__payments-card">
        <div className="subscription-page__section-head">
          <div>
            <h3>Forma de pagamento</h3>
            <p className="muted">
              {hasCheckoutSelection
                ? `Plano selecionado: ${checkoutPlanMeta.label}. Escolha entre cartão com renovação automática ou PIX manual.`
                : 'Cartão de crédito é o método principal com renovação automática. PIX continua como alternativa manual.'}
            </p>
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
            {hasCheckoutSelection && !hasDelinquentStatus ? (
              <p className="muted">
                Contratação do plano {checkoutPlanMeta.label} ({BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}) com cobrança recorrente no cartão.
              </p>
            ) : null}
            {['past_due', 'unpaid', 'expired', 'pending_payment'].includes(planStatusKey) ? (
              <p className="muted">
                Regularização do plano {planMeta.label} ({BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}). Esse envio mantém o plano atual.
              </p>
            ) : null}
            {latestCardAttempt && planStatusKey !== 'active' && ['rejected', 'pending'].includes(String(latestCardAttempt.status_group || '').toLowerCase()) ? (
              <div className="subscription-page__callout">
                <strong>
                  {String(latestCardAttempt.status_group || '').toLowerCase() === 'pending'
                    ? 'Existe uma tentativa com cartão em análise.'
                    : 'A última tentativa com cartão não foi aprovada.'}
                </strong>
                <p className="muted">
                  {latestCardAttempt.display_message || 'Revise os dados do cartão ou tente outra forma de pagamento.'}
                </p>
              </div>
            ) : null}
            <form key={cardFormResetKey} id="subscription-card-form" className="subscription-page__card-form">
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
                disabled={cardState.loading || cardState.submitting || !cardState.ready || !cardGatewayPublicKey}
              >
                {cardState.submitting
                  ? <span className="spinner" />
                  : cardAction.label}
              </button>
            </form>
            {cardState.loading ? <span className="muted">Carregando formulário seguro do gateway...</span> : null}
            {cardState.error ? (
              <div className="subscription-page__callout subscription-page__callout--danger" role="alert">
                <strong>Não foi possível continuar com este cartão.</strong>
                <p className="muted">{cardState.error}</p>
              </div>
            ) : null}
            {cardRecoveryNeedsNewToken && hasDelinquentStatus ? (
              <p className="muted">
                Os dados do cartão precisam ser confirmados novamente para gerar um novo token de segurança antes da cobrança manual.
              </p>
            ) : null}
            {recoveryBlocked ? (
              <div className="subscription-page__callout">
                <strong>Regularização temporariamente indisponível no cartão.</strong>
                <p className="muted">
                  {recoveryGuard?.user_message || 'Já existe uma tentativa recente de cobrança em processamento ou recusada. Aguarde alguns minutos antes de tentar novamente.'}
                </p>
                <div className="subscription-page__payment-actions">
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
            {cardRecoveryReady && hasDelinquentStatus && !recoveryBlocked ? (
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
                    disabled={cardState.loading || cardState.submitting || !cardState.ready || !cardGatewayPublicKey}
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
                onClick={() => void handleStartCheckout(checkoutPlanKey, checkoutCycle)}
                disabled={checkoutLoading || !providerReady}
              >
                {checkoutLoading ? <span className="spinner" /> : (billingProvider === 'asaas' ? `Assinar ${checkoutPlanMeta.label}` : `Gerar PIX do ${checkoutPlanMeta.label}`)}
              </button>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      <details className="settings-module-card subscription-page__details">
        <summary className="subscription-page__details-summary">Histórico financeiro</summary>
        {financialHistory.has_open_pix_and_rejected_card ? (
          <div className="subscription-page__callout">
            <strong>Há um PIX em aberto aguardando pagamento.</strong>
            <p className="muted">A última tentativa com cartão de crédito não foi aprovada.</p>
          </div>
        ) : null}
        <div className="subscription-page__financial-overview">
          <FinancialOverviewCard
            eyebrow="Assinatura"
            title={financialHistory.summary?.title || 'Status da assinatura'}
            statusLabel={subscriptionStatusCardLabel}
            statusTone={planStatusTone}
            message={financialHistory.summary?.message || 'Acompanhe abaixo os eventos financeiros recentes.'}
          />
          {openPixEvent ? (
            <FinancialOverviewCard
              eyebrow="PIX em aberto"
              title={openPixEvent.display_subtitle || openPixEvent.display_title}
              statusLabel={openPixEvent.display_badge?.label}
              statusTone={openPixEvent.display_badge?.tone}
              methodLabel={openPixEvent.payment_method_label}
              message={openPixEvent.display_message}
              createdAt={openPixEvent.created_at}
              referenceLabel={openPixEvent.reference_label}
              referenceValue={openPixEvent.reference_value}
            />
          ) : null}
          {latestCardAttempt ? (
            <FinancialOverviewCard
              eyebrow="Última tentativa com cartão"
              title={latestCardAttempt.display_title}
              statusLabel={latestCardAttempt.display_badge?.label}
              statusTone={latestCardAttempt.display_badge?.tone}
              methodLabel={latestCardAttempt.payment_method_label}
              message={latestCardAttempt.display_message}
              createdAt={latestCardAttempt.created_at}
              referenceLabel={latestCardAttempt.reference_label}
              referenceValue={latestCardAttempt.reference_value}
            />
          ) : null}
        </div>
        {financialEvents.length ? (
          <ul className="subscription-page__history-list">
            {financialEvents.map((item) => (
              <MappedFinancialEventRow key={item?.id || `${item?.event_type}-${item?.created_at || 'row'}`} item={item} />
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
      </details>

      {false && pixModal.open ? (
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

      {cpfModal.open ? (
        <Modal
          title="Informe seu CPF ou CNPJ"
          onClose={closeCpfModal}
          actions={[
            <button key="cancel" type="button" className="btn btn--outline" onClick={closeCpfModal} disabled={checkoutLoading}>
              Cancelar
            </button>,
            <button key="ok" type="button" className="btn btn--primary" onClick={() => void submitCpfModal()} disabled={checkoutLoading}>
              {checkoutLoading ? <span className="spinner" /> : 'Continuar para o pagamento'}
            </button>,
          ]}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Para assinar, o Asaas precisa do CPF ou CNPJ do responsável pela cobrança. Guardamos no seu perfil para as próximas vezes.
          </p>
          <label className="label">
            <span>CPF ou CNPJ (somente números)</span>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={cpfModal.value}
              onChange={(event) => setCpfModal((m) => ({ ...m, value: event.target.value.replace(/\D/g, ''), error: '' }))}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCpfModal(); } }}
              placeholder="Somente números"
              maxLength={14}
            />
          </label>
          {cpfModal.error ? (
            <div className="notice notice--error" style={{ marginTop: 8 }}>{cpfModal.error}</div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
