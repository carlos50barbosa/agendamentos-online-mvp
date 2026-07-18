import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
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
    pending_payment: 'Pagamento pendente',
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

  const intentHandledRef = useRef('');
  const paymentSectionRef = useRef(null);

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
  }, [refreshData]);

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
  // "Ativo para a UI". NAO usa plan_status: o backend SINCRONIZA usuarios.plan_status com a assinatura
  // EFETIVA, entao uma pendente orfa corrompe esse campo para 'pending_pix'. O que SOBREVIVE e o periodo
  // pago (planContext.active_until = plan_active_until). Regra: status ja 'active', OU ha periodo pago
  // VIGENTE e o status e apenas "pendente" (provavel orfa) — nunca past_due/expired/unpaid, que exigem
  // acao real. Ver o endpoint admin de reconciliacao, que conserta o dado de fato (efetiva volta a active).
  const userActiveUntilDate = planContext?.active_until ? new Date(planContext.active_until) : null;
  const hasFuturePaidPeriod = !!userActiveUntilDate && userActiveUntilDate.getTime() > Date.now();
  const softPendingStatus = ['pending_pix', 'pending_payment'].includes(planStatusKey);
  const userIsActive = planStatusKey === 'active' || (hasFuturePaidPeriod && softPendingStatus);
  // Status exibido: quando o dono esta ativo, confia nisso (nao mostra "PIX pendente" de uma orfa).
  const displayStatusKey = userIsActive ? 'active' : planStatusKey;
  const planStatusLabel = getStatusLabel(displayStatusKey);
  const planStatusTone = getStatusTone(displayStatusKey);
  const subscriptionStatusCardLabel = (!userIsActive
    && ['pending_payment', 'pending_pix', 'past_due', 'unpaid', 'expired'].includes(planStatusKey))
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
  const accessMode = String(billingStatus?.access?.mode || '').toLowerCase() || 'full';
  const coreFeaturesAllowed = billingStatus?.access?.core_features_allowed !== false;
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
      if (response?.plan_changed) {
        // Troca in-place: NAO ha checkout (a MESMA assinatura muda de valor). Sucesso + reflete o novo plano.
        await refreshData({ silent: true });
        setNotice({
          type: 'success',
          message: response.message || 'Plano alterado. O acesso já vale e a nova cobrança entra na próxima renovação.',
        });
        return true;
      }
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
      // "Ja ativo" e "troca de plano" nao sao erros de operacao — sao estado informativo. Mostrar em
      // vermelho sugeriria que algo falhou. Trata como aviso (info) e reflete o estado atual.
      const code = requestError?.data?.error;
      const informative = [
        'subscription_already_active',
        'plan_change_unsupported',
        'plan_downgrade_unsupported',
        'plan_change_annual_support',
        'plan_change_no_active_subscription',
      ].includes(code);
      setNotice({
        type: informative ? 'info' : 'error',
        message: getErrorMessage(requestError, 'Falha ao iniciar a assinatura no Asaas.'),
      });
      if (informative) refreshData({ silent: true });
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

  // Modal de confirmacao de TROCA de plano (so aparece quando ja ha assinatura ativa e o alvo difere).
  const [planChangeModal, setPlanChangeModal] = useState({ open: false, plan: null, cycle: 'mensal' });
  const closePlanChangeModal = useCallback(() => setPlanChangeModal({ open: false, plan: null, cycle: 'mensal' }), []);

  const handleStartCheckout = useCallback(async (targetPlan, billingCycle = 'mensal') => {
    // Assinatura ATIVA + alvo com outro plano OU outro ciclo = TROCA. Confirma antes: o acesso muda na
    // hora, mas a nova cobranca so entra na proxima renovacao — a confirmacao evita clique acidental.
    const isChange = userIsActive
      && (normalizePlanKey(targetPlan) !== planKey || (billingCycle || 'mensal') !== currentCycle);
    if (isChange) {
      setPlanChangeModal({ open: true, plan: normalizePlanKey(targetPlan), cycle: billingCycle || 'mensal' });
      return false;
    }
    return handleAsaasCheckout(targetPlan, billingCycle);
  }, [handleAsaasCheckout, userIsActive, planKey, currentCycle]);

  const confirmPlanChange = useCallback(async () => {
    const { plan, cycle } = planChangeModal;
    await handleAsaasCheckout(plan, cycle || 'mensal');
    setPlanChangeModal({ open: false, plan: null, cycle: 'mensal' });
  }, [planChangeModal, handleAsaasCheckout]);

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

        if (intentKind === 'trial') {
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
    checkoutCycle,
    handleStartTrial,
    isEstablishment,
    loading,
    location.pathname,
    location.search,
    navigate,
    openCardChoice,
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
      {!loading && !userIsActive && accessMode !== 'full' ? (
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
              <h3>{userIsActive ? 'Trocar de plano' : 'Pagar assinatura'}</h3>
              <p className="muted">
                {userIsActive
                  ? `Sua assinatura está ativa${userActiveUntilDate ? ` até ${formatDateLong(userActiveUntilDate)}` : ''}. Para mudar de plano ou ciclo, use as opções abaixo — você não precisa gerar um novo pagamento agora.`
                  : 'Escolha o ciclo e confirme. O pagamento (cartão ou PIX) é concluído na tela segura do Asaas.'}
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
            {!userIsActive && trialAvailable ? (
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
              {checkoutLoading
                ? <span className="spinner" />
                : `${userIsActive ? 'Trocar para' : 'Assinar'} ${checkoutPlanMeta.label} ${BILLING_CYCLE_LABELS[checkoutCycle] || 'Mensal'}`}
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

      {planChangeModal.open ? (() => {
        const targetMeta = PLAN_META[planChangeModal.plan] || PLAN_META.starter;
        const targetCycle = planChangeModal.cycle || 'mensal';
        const targetPriceCents = targetCycle === 'anual' ? targetMeta.annualPriceCents : targetMeta.priceCents;
        // Downgrade (descer de tier) nao e suportado por aqui. Assinatura ANUAL ativa: qualquer troca vai
        // pro suporte (o periodo pago nao expirado e grande demais p/ acesso gratis ou converter sem
        // proracao). Ambos espelham o 409 do backend, sem round-trip.
        const isDowngradeChange = getPlanTier(planChangeModal.plan) < getPlanTier(planKey);
        const annualLocked = currentCycle === 'anual';
        const mustUseSupport = isDowngradeChange || annualLocked;
        const renewalLabel = activeUntil ? new Date(activeUntil).toLocaleDateString('pt-BR') : null;
        return (
          <Modal
            title={mustUseSupport ? 'Troca via suporte' : 'Confirmar troca de plano'}
            onClose={closePlanChangeModal}
            actions={mustUseSupport ? [
              <button key="ok" type="button" className="btn btn--primary" onClick={closePlanChangeModal}>
                Entendi
              </button>,
            ] : [
              <button key="cancel" type="button" className="btn btn--outline" onClick={closePlanChangeModal} disabled={checkoutLoading}>
                Cancelar
              </button>,
              <button key="ok" type="button" className="btn btn--primary" onClick={() => void confirmPlanChange()} disabled={checkoutLoading}>
                {checkoutLoading ? <span className="spinner" /> : 'Confirmar troca'}
              </button>,
            ]}
          >
            {mustUseSupport ? (
              annualLocked ? (
                <p className="muted" style={{ marginTop: 0 }}>
                  Sua assinatura <strong>anual</strong> está ativa{renewalLabel ? ` até ${renewalLabel}` : ''}. Para trocar de
                  plano antes disso, fale com o suporte — ajustamos sem você perder o período já pago.
                </p>
              ) : (
                <p className="muted" style={{ marginTop: 0 }}>
                  Baixar do plano <strong>{planMeta.label}</strong> para <strong>{targetMeta.label}</strong> ainda não está
                  disponível por aqui. Fale com o suporte para ajustar sem perder o período já pago.
                </p>
              )
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Você vai trocar de <strong>{planMeta.label} · {BILLING_CYCLE_LABELS[currentCycle] || 'Mensal'}</strong> para{' '}
                  <strong>{targetMeta.label} · {BILLING_CYCLE_LABELS[targetCycle] || 'Mensal'}</strong>.
                </p>
                <ul className="muted" style={{ marginTop: 0, paddingLeft: 18 }}>
                  <li>O acesso ao novo plano vale imediatamente.</li>
                  <li>
                    A nova cobrança de {formatCurrencyFromCents(targetPriceCents)} entra na próxima renovação
                    {renewalLabel ? ` (${renewalLabel})` : ''}.
                  </li>
                  <li>Não há cobrança agora — o período já pago é mantido.</li>
                </ul>
              </>
            )}
          </Modal>
        );
      })() : null}
    </div>
  );
}
