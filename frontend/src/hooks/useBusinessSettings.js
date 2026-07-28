import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth';
import { getWhatsAppConnectFeatureState, isWhatsAppConnectEnabled } from '../utils/features.js';

const DEFAULT_PLAN_INFO = Object.freeze({
  plan: 'starter',
  status: 'trialing',
  trialEnd: null,
  trialDaysLeft: null,
  allowAdvanced: false,
  activeUntil: null,
});

const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function getMercadoPagoConnectErrorMessage(error) {
  if (error?.data?.error !== 'mp_config_missing') {
    return getErrorMessage(error, 'Não foi possível iniciar a conexão.');
  }

  const missing = Array.isArray(error?.data?.missing)
    ? error.data.missing.filter((item) => Boolean(item))
    : [];
  const suggestedRedirect = String(error?.data?.example_redirect_uri || '').trim();
  const parts = ['Configuração do Mercado Pago incompleta no backend.'];

  if (missing.length) {
    parts.push(`Faltam: ${missing.join(', ')}.`);
  }
  if (missing.includes('MP_REDIRECT_URI') && suggestedRedirect) {
    parts.push(`Use ${suggestedRedirect} como callback no app do Mercado Pago e no backend.`);
  }

  return parts.join(' ');
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

const DEFAULT_WHATSAPP_MANUAL_FORM = Object.freeze({
  business_account_id: '',
  waba_id: '',
  phone_number_id: '',
  access_token: '',
  descriptive_name: '',
});

function createWhatsappManualForm(account = null) {
  return {
    ...DEFAULT_WHATSAPP_MANUAL_FORM,
    business_account_id: account?.business_account_id || '',
    waba_id: account?.waba_id || '',
    phone_number_id: account?.phone_number_id || '',
    descriptive_name: account?.descriptive_name || '',
  };
}

function createWhatsappState(account = null) {
  const feature = getWhatsAppConnectFeatureState();
  return {
    loading: false,
    validationLoading: false,
    saveLoading: false,
    disconnectLoading: false,
    featureEnabled: feature.featureEnabled,
    mode: feature.mode,
    message: feature.message,
    account,
    error: '',
    notice: '',
    editing: !account,
    validated: false,
    preview: null,
    form: createWhatsappManualForm(account),
  };
}

export function useBusinessSettings(options = {}) {
  const { loadWhatsApp = false, loadMercadoPago = false, loadDeposit = false } = options;

  const user = useMemo(() => getUser(), []);
  const isEstablishment = user?.tipo === 'estabelecimento';
  const establishmentId = user?.id || null;
  const whatsappConnectEnabled = useMemo(() => isWhatsAppConnectEnabled(), []);

  const [planInfo, setPlanInfo] = useState(DEFAULT_PLAN_INFO);
  const [billing, setBilling] = useState({
    loading: false,
    error: '',
    wallet: null,
    subscription: null,
  });
  const [whatsapp, setWhatsapp] = useState(() => createWhatsappState(null));
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
    provider: 'mercadopago',
    walletId: '',
    walletVerified: false,
    // 'subconta' = a plataforma abriu a conta Asaas pelo dono; 'manual' = ele colou o Wallet
    // ID da conta que já tinha; null = ainda não há carteira.
    walletSource: null,
    noticeType: '',
    noticeMessage: '',
  });
  // Onboarding da subconta Asaas: rascunho vindo do cadastro + o que falta preencher.
  const [subaccount, setSubaccount] = useState({
    loading: false,
    creating: false,
    loaded: false,
    form: null,
    missing: [],
    termsVersion: '',
    accepted: false,
    noticeType: '',
    noticeMessage: '',
  });
  const [helpOpen, setHelpOpen] = useState(false);
  // A compra de pacotes (openWhatsappTopup, checkout PIX e polling de status) foi retirada em
  // 26/07/2026: os Tech Provider Terms da Meta proíbem cobrar pelo uso da plataforma dela. O
  // caminho que CREDITA um pagamento segue no backend, dormente.


  const refreshWhatsAppBilling = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadWhatsApp) return null;

    setBilling((current) => ({ ...current, loading: true, error: '' }));

    try {
      const [subscriptionData, walletData] = await Promise.all([
        Api.billingSubscription().catch((error) => {
          console.warn('billingSubscription failed', error);
          return null;
        }),
        Api.billingWhatsAppWallet().catch((error) => {
          console.warn('billingWhatsAppWallet failed', error);
          return null;
        }),
      ]);

      if (subscriptionData?.plan) {
        setPlanInfo((current) => buildPlanInfo(subscriptionData.plan, current));
      }

      const wallet = walletData?.wallet || subscriptionData?.plan?.usage?.whatsapp || null;

      setBilling({
        loading: false,
        error: '',
        wallet,
        subscription: subscriptionData?.subscription || null,
      });

      return { wallet };
    } catch (error) {
      setBilling((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, 'Falha ao carregar os créditos do WhatsApp.'),
      }));
      return null;
    }
  }, [establishmentId, isEstablishment, loadWhatsApp]);

  const refreshWhatsAppConnection = useCallback(async () => {
    if (!isEstablishment || !establishmentId || !loadWhatsApp) return null;
    if (!whatsappConnectEnabled) {
      const feature = getWhatsAppConnectFeatureState();
      setWhatsapp((current) => ({
        ...current,
        featureEnabled: feature.featureEnabled,
        mode: feature.mode,
        message: feature.message,
        loading: false,
        account: null,
        error: '',
        notice: '',
        editing: false,
        validated: false,
        preview: null,
        form: createWhatsappManualForm(null),
      }));
      return {
        ok: true,
        connected: false,
        status: 'coming_soon',
        account: null,
        feature_enabled: false,
        mode: feature.mode,
        message: feature.message,
      };
    }

    setWhatsapp((current) => ({ ...current, loading: true, error: '' }));

    try {
      const response = await Api.waAccount();
      const nextAccount = response?.account || response || null;
      setWhatsapp((current) => ({
        ...current,
        loading: false,
        account: nextAccount,
        editing: current.editing && current.account ? current.editing : !nextAccount,
        form: current.editing ? current.form : createWhatsappManualForm(nextAccount),
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
  }, [establishmentId, isEstablishment, loadWhatsApp, whatsappConnectEnabled]);

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
        provider: response?.provider || 'mercadopago',
        walletId: depositConfig.wallet_id || '',
        walletVerified: Boolean(depositConfig.wallet_verified),
        walletSource: depositConfig.wallet_source || null,
      }));
      return response;
    } catch (error) {
      setDeposit((current) => ({
        ...current,
        loading: false,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Não foi possível carregar o sinal.'),
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

  }, [
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
    if (!whatsappConnectEnabled) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('wa') || url.searchParams.has('reason')) {
        url.searchParams.delete('wa');
        url.searchParams.delete('reason');
        window.history.replaceState({}, '', url.toString());
      }
      return;
    }

    const url = new URL(window.location.href);
    const waStatus = String(url.searchParams.get('wa') || '').toLowerCase();
    const waReason = String(url.searchParams.get('reason') || '').toLowerCase();
    const mpStatus = String(url.searchParams.get('mp') || '').toLowerCase();
    let changed = false;

    if (waStatus) {
      const waErrorByReason = {
        manual_connection_required: 'O fluxo automático foi aposentado. Use a conexão manual assistida abaixo.',
        legacy_oauth_deprecated: 'O fluxo antigo foi aposentado. Use a conexão manual assistida abaixo.',
      };
      const waMessageMap = {
        connected: { notice: 'WhatsApp conectado com sucesso.' },
        disconnected: { notice: 'WhatsApp desconectado.' },
        error: { error: waErrorByReason[waReason] || 'Não foi possível concluir a conexão do WhatsApp.' },
        phone_in_use: { error: 'Esse número já está conectado a outro estabelecimento.' },
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
        error: { error: 'Não foi possível concluir a conexão do Mercado Pago.' },
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
  }, [whatsappConnectEnabled]);

  const whatsappConnected = useMemo(() => {
    const account = whatsapp.account || null;
    return account?.connected === true || account?.status === 'connected';
  }, [whatsapp.account]);

  const mercadoPagoConnected = useMemo(() => {
    const account = mercadoPago.account || null;
    return account?.connected === true || account?.status === 'connected';
  }, [mercadoPago.account]);

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
          ? `Assinatura ativa até ${formatLongDate(planInfo.activeUntil)}`
          : includedLimit > 0
            ? 'Incluído no plano'
            : '',
      includedUsageLabel: `Usadas ${used.toLocaleString('pt-BR')} de ${includedLimit.toLocaleString('pt-BR')}`,
      remainingLabel: includedBalance >= 0 ? `Restam ${Math.max(includedBalance, 0).toLocaleString('pt-BR')}` : '',
      planSummaryItems: [
        includedLimit
          ? `WhatsApp: ${includedLimit.toLocaleString('pt-BR')} mensagens/mês incluídas no plano.`
          : 'WhatsApp com franquia mensal indisponível no momento.',
        'Max. 5 mensagens por agendamento.',
        planInfo.allowAdvanced ? 'Relatórios avançados ativos.' : 'Relatórios básicos ativos.',
      ],
    };
  }, [billing.wallet, planInfo.activeUntil, planInfo.allowAdvanced]);

  const beginWhatsAppManualConnect = useCallback(() => {
    if (!isEstablishment || !whatsappConnectEnabled) return;
    setWhatsapp((current) => ({
      ...current,
      editing: true,
      validated: false,
      preview: null,
      error: '',
      notice: '',
      form: createWhatsappManualForm(current.account),
    }));
  }, [isEstablishment, whatsappConnectEnabled]);

  const updateWhatsAppManualField = useCallback((field, value) => {
    if (!isEstablishment || !whatsappConnectEnabled) return;
    setWhatsapp((current) => ({
      ...current,
      editing: true,
      validated: false,
      preview: null,
      error: '',
      notice: '',
      form: {
        ...current.form,
        [field]: value,
      },
    }));
  }, [isEstablishment, whatsappConnectEnabled]);

  const cancelWhatsAppManualEdit = useCallback(() => {
    if (!isEstablishment || !whatsappConnectEnabled) return;
    setWhatsapp((current) => ({
      ...current,
      editing: !current.account,
      validated: false,
      preview: null,
      error: '',
      notice: '',
      form: createWhatsappManualForm(current.account),
    }));
  }, [isEstablishment, whatsappConnectEnabled]);

  const validateWhatsAppManualConnection = useCallback(async () => {
    if (!isEstablishment || !whatsappConnectEnabled) return null;
    setWhatsapp((current) => ({
      ...current,
      validationLoading: true,
      validated: false,
      preview: null,
      error: '',
      notice: '',
    }));
    try {
      const response = await Api.waManualValidate(whatsapp.form);
      setWhatsapp((current) => ({
        ...current,
        validationLoading: false,
        validated: true,
        preview: response?.preview || null,
        notice: 'Dados validados com sucesso na Meta. Revise o resumo e salve a conexão.',
      }));
      return response;
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        validationLoading: false,
        validated: false,
        preview: null,
        error: getErrorMessage(error, 'Não foi possível validar os dados do WhatsApp na Meta.'),
      }));
      return null;
    }
  }, [isEstablishment, whatsapp.form, whatsappConnectEnabled]);

  const saveWhatsAppManualConnection = useCallback(async () => {
    if (!isEstablishment || !whatsappConnectEnabled) return null;
    if (!whatsapp.validated) {
      setWhatsapp((current) => ({
        ...current,
        error: 'Valide a conexão antes de salvar.',
      }));
      return null;
    }
    setWhatsapp((current) => ({
      ...current,
      saveLoading: true,
      error: '',
      notice: '',
    }));
    try {
      const response = await Api.waManualConnect(whatsapp.form);
      const nextAccount = response?.account || null;
      setWhatsapp((current) => ({
        ...current,
        saveLoading: false,
        account: nextAccount,
        editing: false,
        validated: false,
        preview: null,
        form: createWhatsappManualForm(nextAccount),
        notice: 'WhatsApp conectado com sucesso.',
      }));
      return response;
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        saveLoading: false,
        error: getErrorMessage(error, 'Não foi possível salvar a conexão manual do WhatsApp.'),
      }));
      return null;
    }
  }, [isEstablishment, whatsapp.form, whatsapp.validated, whatsappConnectEnabled]);

  const disconnectWhatsApp = useCallback(async () => {
    if (!isEstablishment || !whatsappConnectEnabled) return;
    setWhatsapp((current) => ({
      ...current,
      disconnectLoading: true,
      error: '',
      notice: '',
    }));
    try {
      const response = await Api.waAccountDisconnect();
      setWhatsapp((current) => ({
        ...current,
        disconnectLoading: false,
        account: response?.account || null,
        editing: !(response?.account),
        validated: false,
        preview: null,
        form: createWhatsappManualForm(response?.account || null),
        notice: 'WhatsApp desconectado.',
      }));
    } catch (error) {
      setWhatsapp((current) => ({
        ...current,
        disconnectLoading: false,
        error: getErrorMessage(error, 'Não foi possível desconectar o WhatsApp.'),
      }));
    }
  }, [isEstablishment, whatsappConnectEnabled]);

  const startMercadoPagoConnect = useCallback(async () => {
    if (!isEstablishment) return;
    if (!deposit.allowed) {
      setMercadoPago((current) => ({
        ...current,
        error: 'Recurso disponível apenas para planos Pro e Premium.',
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
      if (!response?.url) throw new Error('URL de conexão indisponível.');
      window.location.assign(response.url);
    } catch (error) {
      setMercadoPago((current) => ({
        ...current,
        connectLoading: false,
        error: getMercadoPagoConnectErrorMessage(error),
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
        error: getErrorMessage(error, 'Não foi possível desconectar o Mercado Pago.'),
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

  const setDepositWalletId = useCallback((value) => {
    setDeposit((current) => ({
      ...current,
      walletId: String(value || '').trim(),
      noticeType: '',
      noticeMessage: '',
    }));
  }, []);

  const saveDepositSettings = useCallback(async () => {
    if (!isEstablishment) return false;

    const enabled = Boolean(deposit.enabled);
    const isAsaas = deposit.provider === 'asaas';
    const walletId = String(deposit.walletId || '').trim();
    const WALLET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let percent = null;

    if (walletId && !WALLET_RE.test(walletId)) {
      setDeposit((current) => ({
        ...current,
        noticeType: 'error',
        noticeMessage: 'Wallet ID inválido. Copie o identificador exato da sua conta Asaas.',
      }));
      return false;
    }

    if (enabled) {
      if (isAsaas && !walletId) {
        setDeposit((current) => ({
          ...current,
          noticeType: 'error',
          noticeMessage: 'Cadastre seu Wallet ID do Asaas para habilitar o sinal.',
        }));
        return false;
      }
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
        walletId: walletId || null,
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
        provider: response?.provider || current.provider,
        walletId: config.wallet_id || '',
        walletVerified: Boolean(config.wallet_verified),
        walletSource: config.wallet_source || null,
        noticeType: 'success',
        noticeMessage: 'Configuração atualizada com sucesso.',
      }));
      return true;
    } catch (error) {
      setDeposit((current) => ({
        ...current,
        saving: false,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Não foi possível salvar o sinal.'),
      }));
      return false;
    }
  }, [deposit.enabled, deposit.percent, deposit.provider, deposit.walletId, isEstablishment]);

  /**
   * Carrega o rascunho da subconta a partir do cadastro do estabelecimento. O objetivo é pedir
   * SÓ o que falta: repetir dados que ele já preencheu seria reintroduzir o atrito que esta
   * tela existe para remover.
   */
  const refreshSubaccount = useCallback(async () => {
    if (!isEstablishment) return null;
    setSubaccount((current) => ({ ...current, loading: true, noticeType: '', noticeMessage: '' }));
    try {
      const response = await Api.getAsaasSubaccount();
      setSubaccount((current) => ({
        ...current,
        loading: false,
        loaded: true,
        // Só monta o formulário na 1ª carga: recarregar em cima do que ele está digitando
        // apagaria o que acabou de preencher.
        form: current.form || { ...(response?.draft || {}) },
        missing: Array.isArray(response?.missing) ? response.missing : [],
        termsVersion: response?.termsVersion || '',
      }));
      return response;
    } catch (error) {
      setSubaccount((current) => ({
        ...current,
        loading: false,
        loaded: true,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Não foi possível carregar seus dados.'),
      }));
      return null;
    }
  }, [isEstablishment]);

  const setSubaccountField = useCallback((field, value) => {
    setSubaccount((current) => ({
      ...current,
      form: { ...(current.form || {}), [field]: value },
      noticeType: '',
      noticeMessage: '',
    }));
  }, []);

  const setSubaccountAccepted = useCallback((value) => {
    setSubaccount((current) => ({
      ...current,
      accepted: Boolean(value),
      noticeType: '',
      noticeMessage: '',
    }));
  }, []);

  const createSubaccount = useCallback(async () => {
    if (!isEstablishment) return false;
    if (!subaccount.accepted) {
      setSubaccount((current) => ({
        ...current,
        noticeType: 'error',
        noticeMessage: 'Marque a autorização para abrirmos a conta em seu nome.',
      }));
      return false;
    }

    setSubaccount((current) => ({ ...current, creating: true, noticeType: '', noticeMessage: '' }));
    try {
      const response = await Api.createAsaasSubaccount({
        aceite: true,
        termsVersion: subaccount.termsVersion || undefined,
        dados: subaccount.form || {},
      });
      const config = response?.deposit || {};
      setDeposit((current) => ({
        ...current,
        walletId: config.wallet_id || response?.walletId || '',
        walletVerified: Boolean(config.wallet_verified),
        walletSource: config.wallet_source || 'subconta',
      }));
      setSubaccount((current) => ({
        ...current,
        creating: false,
        missing: [],
        noticeType: 'success',
        noticeMessage: 'Conta criada. O Asaas enviou o acesso para o seu e-mail.',
      }));
      return true;
    } catch (error) {
      setSubaccount((current) => ({
        ...current,
        creating: false,
        noticeType: 'error',
        noticeMessage: getErrorMessage(error, 'Não foi possível criar a conta de recebimento.'),
      }));
      return false;
    }
  }, [isEstablishment, subaccount.accepted, subaccount.form, subaccount.termsVersion]);


  return {
    user,
    isEstablishment,
    establishmentId,
    whatsappConnectEnabled,
    planInfo,
    billing,
    whatsapp,
    whatsappConnected,
    mercadoPago,
    mercadoPagoConnected,
    deposit,
    helpOpen,
    setHelpOpen,
    walletSummary,
    refreshWhatsAppBilling,
    refreshWhatsAppConnection,
    refreshMercadoPagoConnection,
    refreshDepositSettings,
    beginWhatsAppManualConnect,
    updateWhatsAppManualField,
    validateWhatsAppManualConnection,
    saveWhatsAppManualConnection,
    cancelWhatsAppManualEdit,
    startWhatsAppConnect: beginWhatsAppManualConnect,
    disconnectWhatsApp,
    startMercadoPagoConnect,
    disconnectMercadoPago,
    setDepositEnabled,
    setDepositPercent,
    setDepositWalletId,
    saveDepositSettings,
    subaccount,
    refreshSubaccount,
    setSubaccountField,
    setSubaccountAccepted,
    createSubaccount,
    formatLongDate,
  };
}

export default useBusinessSettings;
