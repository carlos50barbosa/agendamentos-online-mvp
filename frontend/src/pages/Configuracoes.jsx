// src/pages/Configuracoes.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser, saveUser, saveToken } from '../utils/auth';
import { Api, resolveAssetUrl } from '../utils/api';
import { IconChevronRight } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import { mergePreferences, readPreferences, writePreferences, broadcastPreferences } from '../utils/preferences';

const formatPhoneLabel = (value = '') => {
  let digits = value.replace(/\D/g, '');

  if (!digits) return '';

  if (digits.length > 11 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const normalizePhone = (value = '') => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const formatCep = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

export default function Configuracoes() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';

  const [planInfo, setPlanInfo] = useState({
    plan: 'starter',
    status: 'trialing',
    trialEnd: null,
    trialDaysLeft: null,
    trialWarn: false,
    allowAdvanced: false,
    activeUntil: null,
  });
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState({ email_subject: '', email_html: '', wa_template: '' });
  const [savingMessages, setSavingMessages] = useState(false);
  const [openSections, setOpenSections] = useState({});

  const [profileForm, setProfileForm] = useState({
    nome: '',
    email: '',
    telefone: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    avatar_url: '',
  });
  const [passwordForm, setPasswordForm] = useState({ atual: '', nova: '', confirmar: '' });
  const [profileStatus, setProfileStatus] = useState({ type: '', message: '' });
  const [profileSaving, setProfileSaving] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState(() => resolveAssetUrl(user?.avatar_url || ''));
  const [avatarData, setAvatarData] = useState('');
  const [avatarRemove, setAvatarRemove] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef(null);

  const cepLookupRef = useRef('');

  const [prefs, setPrefs] = useState(() => mergePreferences(readPreferences()));
  const [notifStatus, setNotifStatus] = useState('');
  const notifTimerRef = useRef(null);
  // Billing state
  const [billing, setBilling] = useState({ subscription: null, history: [] });
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState('');
  const [recurringNotice, setRecurringNotice] = useState('');
  const checkoutIntentRef = useRef(false);
  // Mensagens pós-checkout (retorno do Mercado Pago)
  const [checkoutNotice, setCheckoutNotice] = useState({ kind: '', message: '', syncing: false });
  // Contagem simples para pré-validação de downgrade (serviços)
  const [serviceCount, setServiceCount] = useState(null);
  const [professionalCount, setProfessionalCount] = useState(null);
  const [changePlanTarget, setChangePlanTarget] = useState(null);
  const [changePlanPassword, setChangePlanPassword] = useState('');
  const [changePlanError, setChangePlanError] = useState('');
  const [changePlanSubmitting, setChangePlanSubmitting] = useState(false);
  // PIX fallback cycle selector
  const [pixCycle, setPixCycle] = useState('mensal');

  // Util: mapeia códigos do MP para mensagens amigáveis
  const mapStatusDetailMessage = useCallback((code) => {
    const c = String(code || '').toLowerCase();
    const generic = 'O pagamento não foi concluído. Tente novamente em seu dispositivo habitual, faça login no Mercado Pago, use outro cartão ou ative por PIX.';
    if (!c) return generic;
    if (c.includes('high_risk')) return 'Pagamento recusado por segurança. Use o dispositivo/rede que você costuma comprar, faça login no Mercado Pago ou tente outro cartão. Alternativa: ative por PIX.';
    if (c.includes('issuer') || c.includes('call_for_authorize') || c.includes('other_reason')) return 'O banco emissor recusou a transação. Tente outro cartão ou contate seu banco. Alternativa: ative por PIX.';
    if (c.includes('insufficient')) return 'Sem limite/saldo disponível no cartão. Tente outro cartão. Alternativa: ative por PIX.';
    if (c.includes('bad_filled')) return 'Dados do cartão inválidos. Revise número, validade e código (CVV).';
    if (c.includes('blacklist')) return 'Pagamento bloqueado pelo Mercado Pago. Utilize outro cartão/conta ou ative por PIX.';
    return generic;
  }, []);

  const inferMpStatusDetailFromError = useCallback((err) => {
    // tenta extrair um status_detail da mensagem/cause do backend
    try {
      const raw = (err?.data?.message || err?.message || '') + ' ' + JSON.stringify(err?.data || {});
      const m = raw.match(/cc_rejected_[a-z_]+|bad_filled_[a-z_]+|issuer|insufficient_amount|call_for_authorize|blacklist/gi);
      return m && m[0] ? String(m[0]).toLowerCase() : '';
    } catch { return ''; }
  }, []);

  // Elegibilidade a teste grátis: somente Starter, sem trial em andamento e sem histórico de plano pago
  const hasPaidHistory = useMemo(() => {
    try {
      if (!Array.isArray(billing?.history)) return false;
      return billing.history.some((h) => {
        const planPaid = h?.plan === 'pro' || h?.plan === 'premium';
        const status = String(h?.status || '').toLowerCase();
        const consideredAsContracted = ['active', 'authorized', 'paused', 'past_due', 'canceled', 'expired'].includes(status);
        return planPaid && consideredAsContracted;
      });
    } catch { return false; }
  }, [billing?.history]);
  const trialEligible = useMemo(() => {
    const isStarter = planInfo.plan === 'starter';
    const noTrialRunning = !planInfo.trialEnd;
    return isStarter && noTrialRunning && !hasPaidHistory;
  }, [planInfo.plan, planInfo.trialEnd, hasPaidHistory]);
  const hasActiveSubscription = useMemo(() => {
    const statusPlan = String(planInfo.status || '').toLowerCase();
    const statusSub = String(billing?.subscription?.status || '').toLowerCase();
    return statusPlan === 'active' || statusSub === 'active';
  }, [planInfo.status, billing?.subscription?.status]);
  const needsRecurringSetup = useMemo(() => {
    const statusPlan = String(planInfo.status || '').toLowerCase();
    const hasGatewaySub = !!(billing?.subscription?.gateway_subscription_id);
    return statusPlan === 'active' && !hasGatewaySub; // ativo por PIX (sem preapproval)
  }, [planInfo.status, billing?.subscription?.gateway_subscription_id]);
  const hasGatewayRecurring = useMemo(() => !!(billing?.subscription?.gateway_subscription_id), [billing?.subscription?.gateway_subscription_id]);
  const subStatus = useMemo(() => String(billing?.subscription?.status || '').toLowerCase(), [billing?.subscription?.status]);

  // Assinatura ativa (evita acionar checkout padrão e resultar em 409 "already_active")

  // Metadados dos planos (espelha backend)
  const PLAN_META = {
    starter: { label: 'Starter', maxServices: 10, maxProfessionals: 2 },
    pro: { label: 'Pro', maxServices: 100, maxProfessionals: 10 },
    premium: { label: 'Premium', maxServices: null, maxProfessionals: null },
  };
  const planLabel = (p) => PLAN_META[p]?.label || p?.toUpperCase() || '';
  const exceedsServices = (target) => {
    const limit = PLAN_META[target]?.maxServices;
    if (limit == null) return false;
    if (serviceCount == null) return false;
    return serviceCount > limit;
  };
  const exceedsProfessionals = (target) => {
    const limit = PLAN_META[target]?.maxProfessionals;
    if (limit == null) return false;
    if (professionalCount == null) return false;
    return professionalCount > limit;
  };

  useEffect(() => {
    try {
      const plan = localStorage.getItem('plan_current') || 'starter';
      const status = localStorage.getItem('plan_status') || 'trialing';
      const trialEnd = localStorage.getItem('trial_end');
      const daysLeft = trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400000)) : null;
      setPlanInfo((prev) => ({
        ...prev,
        plan,
        status,
        trialEnd,
        trialDaysLeft: daysLeft,
        trialWarn: daysLeft != null ? daysLeft <= 3 : prev.trialWarn,
      }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileForm({
      nome: user.nome || '',
      email: user.email || '',
      telefone: formatPhoneLabel(user.telefone || ''),
      cep: formatCep(user.cep || ''),
      endereco: user.endereco || '',
      numero: user.numero || '',
      complemento: user.complemento || '',
      bairro: user.bairro || '',
      cidade: user.cidade || '',
      estado: (user.estado || '').toUpperCase(),
      avatar_url: user.avatar_url || '',
    });
    setAvatarPreview(resolveAssetUrl(user.avatar_url || ''));
    setAvatarData('');
    setAvatarRemove(false);
    setAvatarError('');
  }, [user?.id]);

  useEffect(() => {
    if (!isEstab) {
      cepLookupRef.current = '';
      return;
    }
    const digits = profileForm.cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      cepLookupRef.current = '';
      return;
    }
    if (cepLookupRef.current === digits) return;
    cepLookupRef.current = digits;
    let active = true;
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((res) => res.json())
      .then((data) => {
        if (!active || !data || data.erro) return;
        setProfileForm((prev) => ({
          ...prev,
          cep: formatCep(digits),
          endereco: data.logradouro || prev.endereco,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          estado: (data.uf || prev.estado || '').toUpperCase(),
        }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isEstab, profileForm.cep]);


  const fetchBilling = useCallback(async () => {
    if (!isEstab || !user?.id) return null;
    try {
      setBillingLoading(true);
      const data = await Api.billingSubscription();
      if (data?.plan) {
        setPlanInfo((prev) => {
          const nextStatus = data.plan.status || prev.status;
          const nextPlan = nextStatus === 'active' ? (data.plan.plan || prev.plan) : prev.plan;
          const next = {
            ...prev,
            plan: nextPlan,
            status: nextStatus,
            trialEnd: data.plan.trial?.ends_at || prev.trialEnd,
            trialDaysLeft: typeof data.plan.trial?.days_left === 'number' ? data.plan.trial.days_left : prev.trialDaysLeft,
            trialWarn: !!data.plan.trial?.warn,
            allowAdvanced: !!data.plan.limits?.allowAdvancedReports,
            activeUntil: data.plan.active_until || prev.activeUntil,
          };
          try {
            localStorage.setItem('plan_current', next.plan);
            localStorage.setItem('plan_status', next.status);
            if (next.trialEnd) localStorage.setItem('trial_end', next.trialEnd);
            else localStorage.removeItem('trial_end');
          } catch {}
          return next;
        });
      }
      setBilling({
        subscription: data?.subscription || null,
        history: Array.isArray(data?.history) ? data.history : [],
      });
      return data;
    } catch (err) {
      console.error('billingSubscription failed', err);
      throw err;
    } finally {
      setBillingLoading(false);
    }
  }, [isEstab, user?.id]);

  useEffect(() => {
    (async () => {
      if (!isEstab || !user?.id) return;
      // Se voltamos do checkout com preapproval_id, sincroniza estado antes de carregar
      try {
        const url = new URL(window.location.href);
        const preId = url.searchParams.get('preapproval_id');
        if (preId) {
          await Api.billingSync(preId);
        }
        // Banner pós-retorno: checkout=sucesso|erro|pendente
        const chk = (url.searchParams.get('checkout') || '').toLowerCase();
        if (chk === 'sucesso') {
          setCheckoutNotice({ kind: 'info', message: 'Pagamento aprovado. Sincronizando sua assinatura...', syncing: true });
          // Poll curto para refletir ativação
          const tryPoll = async () => {
            let activated = false;
            for (let i = 0; i < 6; i++) {
              try {
                const data = await Api.billingSubscription();
                const planStatus = String(data?.plan?.status || '').toLowerCase();
                const subStatus = String(data?.subscription?.status || '').toLowerCase();
                if (planStatus === 'active' || subStatus === 'active' || subStatus === 'authorized') {
                  activated = true;
                  break;
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 1500));
            }
            if (activated) setCheckoutNotice({ kind: 'success', message: 'Assinatura atualizada com sucesso!', syncing: false });
            else setCheckoutNotice({ kind: 'warn', message: 'Estamos processando sua assinatura. Ela deve atualizar em instantes.', syncing: false });
          };
          try { await tryPoll(); } catch {}
          // Limpa o parâmetro da URL após tratar
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        } else if (chk === 'erro') {
          setCheckoutNotice({
            kind: 'error',
            message: 'O pagamento não foi concluído. Tente novamente no seu dispositivo habitual, faça login no Mercado Pago, use outro cartão ou ative por PIX.',
            syncing: false,
          });
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        } else if (chk === 'pendente') {
          setCheckoutNotice({ kind: 'warn', message: 'Pagamento pendente de confirmação.', syncing: false });
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        }
      } catch {}
      try {
        const est = await Api.getEstablishment(user.id);
        setSlug(est?.slug || '');
        const ctx = est?.plan_context;
        if (ctx) {
          setPlanInfo((prev) => ({
            ...prev,
            plan: ctx.plan || 'starter',
            status: ctx.status || 'trialing',
            trialEnd: ctx.trial?.ends_at || null,
            trialDaysLeft: typeof ctx.trial?.days_left === 'number' ? ctx.trial.days_left : prev.trialDaysLeft,
            trialWarn: !!ctx.trial?.warn,
            allowAdvanced: !!ctx.limits?.allowAdvancedReports,
            allowWhatsapp: !!(ctx.features?.allow_whatsapp ?? ctx.limits?.allowWhatsApp),
            activeUntil: ctx.active_until || null,
          }));
          try {
            localStorage.setItem('plan_current', ctx.plan || 'starter');
            localStorage.setItem('plan_status', ctx.status || 'trialing');
            if (ctx.trial?.ends_at) localStorage.setItem('trial_end', ctx.trial.ends_at);
            else localStorage.removeItem('trial_end');
          } catch {}
        }
      } catch {}
      // Carrega contagem de serviços/profissionais para pré-validar downgrades
      try {
        const stats = await Api.getEstablishmentStats(user.id);
        setServiceCount(typeof stats?.services === 'number' ? stats.services : 0);
        setProfessionalCount(typeof stats?.professionals === 'number' ? stats.professionals : 0);
      } catch {}
      try {
        const tmpl = await Api.getEstablishmentMessages(user.id);
        setMsg({
          email_subject: tmpl?.email_subject || '',
          email_html: tmpl?.email_html || '',
          wa_template: tmpl?.wa_template || '',
        });
      } catch {}
      try {
        await fetchBilling();
      } catch {}
    })();
  }, [isEstab, user?.id, fetchBilling]);

  const handleCheckout = useCallback(async (targetPlan, targetCycle = 'mensal') => {
    if (!isEstab) return;
    setCheckoutError('');
    setCheckoutLoading(true);
    checkoutIntentRef.current = true;
    try {
      const payload = { plan: targetPlan, billing_cycle: targetCycle };
      const data = await Api.billingCreateCheckout(payload);
      if (data?.subscription) {
        setBilling((prev) => ({ ...prev, subscription: data.subscription }));
      }
      try {
        await fetchBilling();
      } catch {}
      if (typeof window !== 'undefined' && data?.init_point) {
        window.location.href = data.init_point;
      }
    } catch (err) {
      console.error('billing checkout failed', err);
      // Mensagem amigável quando já existe assinatura ativa
      if (err?.status === 409 && err?.data?.error === 'already_active') {
        try {
          const iso = err?.data?.plan?.active_until || err?.data?.plan?.trial?.ends_at || null;
          const msg = iso
            ? `Sua assinatura já está ativa até ${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`
            : 'Sua assinatura já está ativa no momento.';
          setCheckoutError(msg);
          await fetchBilling();
        } catch {
          setCheckoutError(err?.data?.message || 'Sua assinatura já está ativa.');
        }
      } else {
        const code = inferMpStatusDetailFromError(err);
        const friendly = mapStatusDetailMessage(code);
        setCheckoutError(friendly);
      }
    } finally {
      setCheckoutLoading(false);
      checkoutIntentRef.current = false;
      try {
        localStorage.removeItem('intent_plano');
        localStorage.removeItem('intent_plano_ciclo');
      } catch {}
    }
  }, [fetchBilling, isEstab]);

  const executePlanChange = useCallback(async (targetPlan) => {
    setCheckoutError('');
    setCheckoutLoading(true);
    let success = false;
    try {
      const data = await Api.billingChangeCheckout(targetPlan);
      if (data?.init_point) {
        window.location.href = data.init_point;
        success = true;
        return success;
      }
      await fetchBilling();
      success = true;
    } catch (err) {
      if (err?.status === 409 && (err?.data?.error === 'plan_downgrade_blocked' || err?.data?.error === 'same_plan')) {
        setCheckoutError(err?.data?.message || 'Não foi possível alterar o plano.');
      } else {
        const code = inferMpStatusDetailFromError(err);
        const friendly = mapStatusDetailMessage(code);
        setCheckoutError(friendly);
      }
    } finally {
      setCheckoutLoading(false);
    }
    return success;
  }, [fetchBilling]);

  const handleChangePlan = useCallback((targetPlan) => {
    setChangePlanTarget(targetPlan);
    setChangePlanPassword('');
    setChangePlanError('');
  }, []);

  const handleCheckoutPix = useCallback(async (plan = 'pro', cycle = 'mensal') => {
    if (!isEstab || !user?.id) return false;
    setCheckoutError('');
    setCheckoutLoading(true);
    let success = false;
    try {
      const data = await Api.billingPixCheckout({ plan, billing_cycle: cycle });
      if (data?.init_point) {
        window.location.href = data.init_point;
        success = true;
        return success;
      }
      await fetchBilling();
      success = true;
    } catch (err) {
      setCheckoutError(err?.data?.message || err?.message || 'Falha ao gerar cobrança PIX.');
    } finally {
      setCheckoutLoading(false);
    }
    return success;
  }, [fetchBilling, isEstab, user?.id]);

  const closeChangePlanModal = useCallback(() => {
    if (changePlanSubmitting) return;
    setChangePlanTarget(null);
    setChangePlanPassword('');
    setChangePlanError('');
  }, [changePlanSubmitting]);

  const confirmChangePlan = useCallback(async () => {
    if (!changePlanTarget) return;
    if (!user?.email) {
      setChangePlanError('Sessão expirada. Faça login novamente.');
      return;
    }
    if (!changePlanPassword) {
      setChangePlanError('Informe sua senha para confirmar.');
      return;
    }
    setChangePlanError('');
    setChangePlanSubmitting(true);
    try {
      const loginRes = await Api.login(user.email, changePlanPassword);
      if (!loginRes?.token) {
        setChangePlanError('Não foi possível validar sua senha.');
        return;
      }
      saveToken(loginRes.token);
      if (loginRes.user) saveUser(loginRes.user);

      const ok = await executePlanChange(changePlanTarget);
      if (ok) {
        setChangePlanTarget(null);
        setChangePlanPassword('');
      }
    } catch (err) {
      if (err?.status === 401 || err?.data?.error === 'invalid_credentials') {
        setChangePlanError('Senha incorreta. Tente novamente.');
      } else {
        setChangePlanError(err?.data?.message || err?.message || 'Falha ao validar senha.');
      }
    } finally {
      setChangePlanSubmitting(false);
    }
  }, [changePlanTarget, changePlanPassword, executePlanChange, user?.email]);

  useEffect(() => {
    if (!isEstab) return;
    let storedPlan = null;
    let storedCycle = 'mensal';
    try { storedPlan = localStorage.getItem('intent_plano'); } catch {}
    try {
      const rawCycle = localStorage.getItem('intent_plano_ciclo');
      if (rawCycle) storedCycle = rawCycle;
    } catch {}
    if (storedPlan && !checkoutIntentRef.current) {
      checkoutIntentRef.current = true;
      (async () => {
        try {
          // Se há assinatura ativa e o plano desejado difere do atual, usar rota de change
          if (planInfo.status === 'active' && storedPlan !== planInfo.plan) {
            const data = await Api.billingChangeCheckout(storedPlan, storedCycle);
            if (data?.init_point) window.location.href = data.init_point;
          } else {
            await handleCheckout(storedPlan, storedCycle);
          }
        } finally {
          try {
            localStorage.removeItem('intent_plano');
            localStorage.removeItem('intent_plano_ciclo');
          } catch {}
          checkoutIntentRef.current = false;
        }
      })();
    }
  }, [handleCheckout, isEstab, planInfo.status, planInfo.plan]);
  const daysLeft = useMemo(() => {
    if (planInfo.trialDaysLeft != null) return planInfo.trialDaysLeft;
    if (!planInfo.trialEnd) return 0;
    const diff = new Date(planInfo.trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [planInfo.trialDaysLeft, planInfo.trialEnd]);

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

  const publicLink = useMemo(() => {
    if (!user || typeof window === 'undefined') return '';
    return slug ? `${window.location.origin}/book/${slug}` : `${window.location.origin}/book/${user.id}`;
  }, [slug, user?.id]);

  const startTrial = useCallback(async () => {
    if (!isEstab || !user?.id) return;
    try {
      const response = await Api.updateEstablishmentPlan(user.id, { plan: 'pro', status: 'trialing', trialDays: 7 });
      const ctx = response?.plan;
      if (ctx) {
        setPlanInfo((prev) => ({
          ...prev,
          plan: ctx.plan || 'starter',
          status: ctx.status || 'trialing',
          trialEnd: ctx.trial?.ends_at || null,
          trialDaysLeft: typeof ctx.trial?.days_left === 'number' ? ctx.trial.days_left : prev.trialDaysLeft,
          trialWarn: !!ctx.trial?.warn,
          allowAdvanced: !!ctx.limits?.allowAdvancedReports,
          activeUntil: ctx.active_until || null,
        }));
        try {
          localStorage.setItem('plan_current', ctx.plan || 'starter');
          localStorage.setItem('plan_status', ctx.status || 'trialing');
          if (ctx.trial?.ends_at) localStorage.setItem('trial_end', ctx.trial.ends_at);
          else localStorage.removeItem('trial_end');
        } catch {}
      }
      await fetchBilling();
      alert('Teste gratuito do plano Pro ativado por 7 dias!');
    } catch (err) {
      console.error('startTrial failed', err);
      alert('Nao foi possivel iniciar o teste gratuito agora.');
    }
  }, [isEstab, user?.id, fetchBilling]);

  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleProfileChange = (key, value) => {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAvatarFile = useCallback((event) => {
    const input = event?.target || null;
    const file = input?.files?.[0];
    if (!file) return;
    setAvatarError('');
    const type = (file.type || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp)$/.test(type)) {
      setAvatarError('Selecione uma imagem PNG, JPG ou WEBP.');
      if (input) input.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('A imagem deve ter no máximo 2MB.');
      if (input) input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setAvatarPreview(result);
        setAvatarData(result);
        setAvatarRemove(false);
        setProfileForm((prev) => ({ ...prev, avatar_url: '' }));
      } else {
        setAvatarError('Falha ao processar a imagem.');
      }
    };
    reader.onerror = () => {
      setAvatarError('Falha ao processar a imagem.');
    };
    reader.onloadend = () => {
      if (input) input.value = '';
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAvatarPick = useCallback(() => {
    setAvatarError('');
    const input = avatarInputRef.current;
    if (input) input.click();
  }, []);

  const handleAvatarRemove = useCallback(() => {
    setAvatarPreview('');
    setAvatarData('');
    setAvatarRemove(true);
    setAvatarError('');
    setProfileForm((prev) => ({ ...prev, avatar_url: '' }));
    const input = avatarInputRef.current;
    if (input) input.value = '';
  }, []);

  const handlePasswordChange = (key, value) => {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setProfileStatus({ type: '', message: '' });

    if (!passwordForm.atual) {
      setProfileStatus({ type: 'error', message: 'Informe a senha atual para salvar as alteracoes.' });
      return;
    }
    if (passwordForm.nova && passwordForm.nova !== passwordForm.confirmar) {
      setProfileStatus({ type: 'error', message: 'A nova senha e a confirmacao nao coincidem.' });
      return;
    }

    const telefoneNorm = normalizePhone(profileForm.telefone);
    const cepDigits = profileForm.cep.replace(/\D/g, '');

    try {
      setProfileSaving(true);
      const payload = {
        nome: profileForm.nome.trim(),
        email: profileForm.email.trim(),
        telefone: telefoneNorm,
        senhaAtual: passwordForm.atual,
        senhaNova: passwordForm.nova || undefined,
        cep: cepDigits || undefined,
        endereco: profileForm.endereco.trim() || undefined,
        numero: profileForm.numero.trim() || undefined,
        complemento: profileForm.complemento.trim() || undefined,
        bairro: profileForm.bairro.trim() || undefined,
        cidade: profileForm.cidade.trim() || undefined,
        estado: profileForm.estado.trim().toUpperCase() || undefined,
      };
      if (avatarData) {
        payload.avatar = avatarData;
      } else if (avatarRemove && !avatarData) {
        payload.avatarRemove = true;
      }
      const response = await Api.updateProfile(payload);
      if (response?.user) {
        const updatedUser = response.user;
        saveUser(updatedUser);
        setProfileForm((prev) => ({ ...prev, avatar_url: updatedUser.avatar_url || '' }));
        setAvatarPreview(resolveAssetUrl(updatedUser.avatar_url || ''));
        setAvatarData('');
        setAvatarRemove(false);
        setAvatarError('');
      }
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
      handlePasswordChange('atual', '');
      handlePasswordChange('nova', '');
      handlePasswordChange('confirmar', '');
      setProfileStatus({ type: 'success', message: 'Perfil atualizado com sucesso.' });
      if (response?.emailConfirmation?.pending) {
        setProfileStatus({
          type: 'success',
          message: 'Perfil atualizado. Confirme o novo email com o codigo enviado.',
        });
      }
    } catch (e) {
      const msg = e?.message || 'Falha ao atualizar perfil.';
      setProfileStatus({ type: 'error', message: msg });
      if (typeof msg === 'string' && msg.toLowerCase().includes('imagem')) {
        setAvatarError(msg);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const handleTogglePref = (key) => {
    const next = mergePreferences({ ...prefs, [key]: !prefs[key] });
    setPrefs(next);
    writePreferences(next);
    broadcastPreferences(next);
    setNotifStatus('PreferÃªncias salvas.');
    setTimeout(() => setNotifStatus(''), 2000);
  };

  const sections = useMemo(() => {
    const list = [];

    const statusLabelMap = {
      trialing: 'Teste gratuito',
      active: 'Ativo',
      delinquent: 'Pagamento em atraso',
      pending: 'Pagamento pendente',
      canceled: 'Cancelado',
      expired: 'Expirado',
    };
    // Se a assinatura do MP estiver ativa/autorizada, tratamos como ativo para exibição
    const subStatusRaw = String(billing.subscription?.status || '').toLowerCase();
    const subscriptionIsActive = subStatusRaw === 'active' || subStatusRaw === 'authorized';
    const effectivePlanStatus = subscriptionIsActive ? 'active' : (planInfo.status || '');
    const statusLabel = statusLabelMap[effectivePlanStatus] || (effectivePlanStatus ? effectivePlanStatus.toUpperCase() : '');
    const subscriptionStatusLabel = billing.subscription?.status
      ? statusLabelMap[billing.subscription.status] || billing.subscription.status.toUpperCase()
      : null;
    const nextChargeLabel = billing.subscription?.current_period_end ? fmtDate(billing.subscription.current_period_end) : null;
    const amountLabel =
      typeof billing.subscription?.amount_cents === 'number'
        ? (billing.subscription.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : null;

    list.push({
      id: 'profile',
      title: 'Perfil e Segurança',
      content: (
        <form onSubmit={handleSaveProfile} className="grid" style={{ gap: 10 }}>
          <div className="profile-avatar">
            <div className="profile-avatar__preview" aria-live="polite">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Foto do perfil" />
              ) : (
                <span>Sem foto</span>
              )}
            </div>
            <div className="profile-avatar__controls">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarFile}
                style={{ display: 'none' }}
              />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--outline btn--sm" onClick={handleAvatarPick}>Selecionar foto</button>
                {avatarPreview && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={handleAvatarRemove}>Remover</button>
                )}
              </div>
              {avatarError ? (
                <span className="profile-avatar__error">{avatarError}</span>
              ) : (
                <span className="profile-avatar__hint">PNG, JPG ou WEBP ate 2MB.</span>
              )}
            </div>
          </div>
          <label className="label">
            <span>Nome</span>
            <input className="input" value={profileForm.nome} onChange={(e) => handleProfileChange('nome', e.target.value)} required />
          </label>
          <label className="label">
            <span>Email</span>
            <input className="input" type="email" value={profileForm.email} onChange={(e) => handleProfileChange('email', e.target.value)} required />
          </label>
          <label className="label">
            <span>Telefone (WhatsApp)</span>
            <input
              className="input"
              value={formatPhoneLabel(profileForm.telefone)}
              onChange={(e) => handleProfileChange('telefone', e.target.value)}
              inputMode="tel"
              required
            />
          </label>
          {isEstab && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '1 1 160px' }}>
                  <span>CEP</span>
                  <input
                    className="input"
                    value={profileForm.cep}
                    onChange={(e) => handleProfileChange('cep', formatCep(e.target.value))}
                    required
                    inputMode="numeric"
                  />
                </label>
                <label className="label" style={{ flex: '1 1 240px' }}>
                  <span>Endereco</span>
                  <input className="input" value={profileForm.endereco} onChange={(e) => handleProfileChange('endereco', e.target.value)} required />
                </label>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '0 1 120px' }}>
                  <span>NÃºmero</span>
                  <input className="input" value={profileForm.numero} onChange={(e) => handleProfileChange('numero', e.target.value)} required />
                </label>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Complemento</span>
                  <input className="input" value={profileForm.complemento} onChange={(e) => handleProfileChange('complemento', e.target.value)} />
                </label>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Bairro</span>
                  <input className="input" value={profileForm.bairro} onChange={(e) => handleProfileChange('bairro', e.target.value)} required />
                </label>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Cidade</span>
                  <input className="input" value={profileForm.cidade} onChange={(e) => handleProfileChange('cidade', e.target.value)} required />
                </label>
                <label className="label" style={{ width: 80 }}>
                  <span>Estado</span>
                  <input className="input" value={profileForm.estado} onChange={(e) => handleProfileChange('estado', e.target.value.toUpperCase().slice(0, 2))} required />
                </label>
              </div>
            </>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Senha atual</span>
              <input className="input" type="password" value={passwordForm.atual} onChange={(e) => handlePasswordChange('atual', e.target.value)} required />
            </label>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Nova senha (opcional)</span>
              <input className="input" type="password" value={passwordForm.nova} onChange={(e) => handlePasswordChange('nova', e.target.value)} />
            </label>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Confirmar nova senha</span>
              <input className="input" type="password" value={passwordForm.confirmar} onChange={(e) => handlePasswordChange('confirmar', e.target.value)} />
            </label>
          </div>
          {profileStatus.message && (
            <div className={`notice notice--${profileStatus.type}`} role="alert">{profileStatus.message}</div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="submit" className="btn btn--primary" disabled={profileSaving}>
              {profileSaving ? <span className="spinner" /> : 'Salvar alterações'}
            </button>
          </div>
        </form>
      ),
    });

    if (isEstab) {
      list.push({
        id: 'plan',
        title: 'Plano do Estabelecimento',
        content: (
          <>
            <div className="row spread" style={{ alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Plano do Estabelecimento</h3>
              <div className={`badge ${planInfo.plan === 'premium' ? 'badge--premium' : planInfo.plan === 'pro' ? 'badge--pro' : ''}`}>
                {planInfo.plan.toUpperCase()}
              </div>
            </div>
            {planInfo.status && (
              <div className="small muted">
                Status atual: {statusLabel}
                {planInfo.status === 'active' && planInfo.activeUntil ? ` - próxima cobrança em ${fmtDate(planInfo.activeUntil)}` : ''}
              </div>
            )}
            {billing.subscription?.status && (
              <div className="small muted">
                Assinatura Mercado Pago: {subscriptionStatusLabel}
                {amountLabel ? ` ? ${amountLabel}/mês` : ''}
                {nextChargeLabel ? ` ? próximo débito em ${nextChargeLabel}` : ''}
              </div>
            )}
            {billingLoading && (
              <div className="small muted">Atualizando informações de cobrança...</div>
            )}
            {planInfo.status === 'delinquent' && (
              <div className="notice notice--error" role="alert">
                <strong>Pagamento em atraso.</strong> Regularize a assinatura para liberar os recursos.
              </div>
            )}
            {effectivePlanStatus === 'pending' && (
              <div className="notice notice--warn" role="alert">
                <strong>Pagamento pendente.</strong> Finalize o checkout para concluir a contratação.
              </div>
            )}
            {checkoutNotice.message && (
              <div className={`notice notice--${checkoutNotice.kind || 'info'}`} role="status">
                {checkoutNotice.syncing ? (<><span className="spinner" /> {checkoutNotice.message}</>) : checkoutNotice.message}
              </div>
            )}
            {checkoutError && (
              <div className="notice notice--error" role="alert">{checkoutError}</div>
            )}
                {planInfo.plan === 'starter' ? (
                  <>
                {planInfo.trialEnd && daysLeft > 0 ? (
                  <div className="box box--highlight">
                    <strong>Teste grátis ativo</strong>
                    <div className="small muted">Termina em {fmtDate(planInfo.trialEnd)} - {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} restantes</div>
                  </div>
                ) : (
                  <div className="box" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                    <strong>Você está no plano Starter</strong>
                    {hasPaidHistory ? (
                      <div className="small muted">Teste grátis indisponível: já houve uma assinatura contratada nesta conta.</div>
                    ) : trialEligible ? (
                      <div className="small muted">Ative 7 dias grátis do Pro para desbloquear campanhas no WhatsApp e relatórios avançados.</div>
                    ) : null}
                  </div>
                )}
                {/* Resumo de recursos do plano atual */}
                <div className="small muted" style={{ marginTop: 8 }}>
                  <div><strong>Recursos do plano:</strong></div>
                  <div>WhatsApp: lembretes{planInfo.plan !== 'starter' ? ' + campanhas' : ''}</div>
                  <div>Relatórios: {planInfo.allowAdvanced ? 'avançados' : 'básicos'}</div>
                  <div style={{ marginTop: 6 }}>
                    <strong>Como funciona a contratação:</strong> você será redirecionado ao Mercado Pago para confirmar a assinatura.
                    Cobrança recorrente mensal, sem fidelidade. Upgrades liberam recursos na hora; o valor muda no próximo ciclo.
                  </div>
                </div>
                {hasActiveSubscription && (
                  <div className="notice notice--info" role="status" style={{ marginTop: 8 }}>
                    Sua assinatura já está ativa{planInfo.activeUntil ? ` até ${fmtDate(planInfo.activeUntil)}` : ''}.
                    {needsRecurringSetup ? ' Configure a recorrência no cartão para as próximas cobranças.' : ' Para migrar de plano, use o botão abaixo.'}
                  </div>
               )}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {!planInfo.trialEnd && trialEligible && (
                    <button
                      className="btn btn--brand-outline btn--sm"
                      type="button"
                      onClick={startTrial}
                      disabled={planInfo.status === 'delinquent' || checkoutLoading}
                    >
                      {checkoutLoading ? <span className="spinner" /> : 'Ativar 7 dias grátis'}
                    </button>
                  )}
                  <button
                    className="btn btn--primary btn--sm"
                    type="button"
                    onClick={() => {
                      if (hasActiveSubscription) {
                        handleChangePlan('pro');
                      } else {
                        handleCheckout('pro');
                      }
                    }}
                    disabled={checkoutLoading}
                  >
                    {checkoutLoading
                      ? <span className="spinner" />
                      : (hasActiveSubscription ? 'Alterar para plano Pro' : 'Contratar plano Pro')}
                  </button>
                  {needsRecurringSetup && (
                    <button
                      className="btn btn--brand-outline btn--sm"
                      type="button"
                      onClick={async () => {
                        try {
                          setCheckoutLoading(true);
                          const data = await Api.billingRecurringSetup();
                          if (data?.init_point) window.location.href = data.init_point;
                        } catch (err) {
                          setCheckoutError(err?.data?.message || err?.message || 'Falha ao configurar recorrência.');
                        } finally {
                          setCheckoutLoading(false);
                        }
                      }}
                      disabled={checkoutLoading}
                      title="Configurar cobrança recorrente no cartão para os próximos ciclos"
                    >
                      {checkoutLoading ? <span className="spinner" /> : 'Configurar recorrência no cartão'}
                    </button>
                  )}
                  {hasGatewayRecurring && (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {subStatus !== 'paused' && (
                        <button
                          className="btn btn--outline btn--sm"
                          type="button"
                          onClick={async () => {
                            setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                            try { await Api.billingRecurringPause(); setRecurringNotice('Recorrência pausada.'); await fetchBilling(); }
                            catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao pausar recorrência.'); }
                            finally { setRecurringLoading(false); }
                          }}
                          disabled={recurringLoading}
                          title="Pausar cobranças recorrentes"
                        >
                          {recurringLoading ? <span className="spinner" /> : 'Pausar recorrência'}
                        </button>
                      )}
                      {subStatus === 'paused' && (
                        <button
                          className="btn btn--outline btn--sm"
                          type="button"
                          onClick={async () => {
                            setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                            try { await Api.billingRecurringResume(); setRecurringNotice('Recorrência retomada.'); await fetchBilling(); }
                            catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao retomar recorrência.'); }
                            finally { setRecurringLoading(false); }
                          }}
                          disabled={recurringLoading}
                          title="Retomar cobranças recorrentes"
                        >
                          {recurringLoading ? <span className="spinner" /> : 'Retomar recorrência'}
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={async () => {
                          if (!confirm('Cancelar a recorrência? Você continuará ativo até o fim do ciclo atual.')) return;
                          setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                          try { await Api.billingRecurringCancel(); setRecurringNotice('Recorrência cancelada.'); await fetchBilling(); }
                          catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao cancelar recorrência.'); }
                          finally { setRecurringLoading(false); }
                        }}
                        disabled={recurringLoading}
                        title="Cancelar a recorrência (não renova na próxima data)"
                      >
                        {recurringLoading ? <span className="spinner" /> : 'Cancelar recorrência'}
                      </button>
                    </div>
                  )}
                  {(recurringError || recurringNotice) && (
                    <div className={`notice notice--${recurringError ? 'error' : 'info'}`} role="status" style={{ marginTop: 6 }}>
                      {recurringError || recurringNotice}
                    </div>
                  )}
                  {/* PIX fallback em seção separada */}
                  {!hasActiveSubscription && (
                    <div className="box" style={{ width: '100%' }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <strong>Ativar por PIX (primeiro ciclo)</strong>
                        <label className="label" style={{ margin: 0 }}>
                          <span style={{ fontSize: 12 }}>Ciclo</span>
                          <select
                            className="input input--sm"
                            value={pixCycle}
                            onChange={(e) => setPixCycle(e.target.value)}
                            style={{ minWidth: 120 }}
                          >
                            <option value="mensal">Mensal</option>
                            <option value="anual">Anual</option>
                          </select>
                        </label>
                      </div>
                      <div className="btn-row" style={{ marginTop: 8 }}>
                        <button
                          className="btn btn--chip btn--sm"
                          type="button"
                          onClick={() => handleCheckoutPix('starter', pixCycle)}
                          disabled={checkoutLoading}
                          title="Alternativa por PIX para o primeiro ciclo (Starter)"
                        >
                          {checkoutLoading ? <span className="spinner" /> : 'Ativar por PIX (Starter)'}
                        </button>
                        <button
                          className="btn btn--chip btn--sm"
                          type="button"
                          onClick={() => handleCheckoutPix('pro', pixCycle)}
                          disabled={checkoutLoading}
                          title="Alternativa por PIX para o primeiro ciclo (Pro)"
                        >
                          {checkoutLoading ? <span className="spinner" /> : 'Ativar por PIX (Pro)'}
                        </button>
                        <button
                          className="btn btn--chip btn--sm"
                          type="button"
                          onClick={() => handleCheckoutPix('premium', pixCycle)}
                          disabled={checkoutLoading}
                          title="Alternativa por PIX para o primeiro ciclo (Premium)"
                        >
                          {checkoutLoading ? <span className="spinner" /> : 'Ativar por PIX (Premium)'}
                        </button>
                      </div>
                      <div className="small muted" style={{ marginTop: 6 }}>
                        O PIX ativa o plano por 1 ciclo. Depois, use “Configurar recorrência no cartão” para automatizar as próximas cobranças.
                      </div>
                    </div>
                  )}
                  <Link className="btn btn--brand-outline btn--sm" to="/planos">Conhecer planos</Link>
                </div>
              </>
            ) : (
              <>
                <div className="box box--highlight">
                  <strong>{planInfo.plan === 'pro' ? 'Plano Pro' : 'Plano Premium'} {planInfo.status === 'active' ? 'ativo' : 'contratado'}</strong>
                  <div className="small muted">
                    {planInfo.status === 'active' ? 'Obrigado por apoiar o Agendamentos Online.' : 'Assim que o pagamento for confirmado, os recursos ser?o liberados.'}
                  </div>
                </div>
                {/* Resumo de recursos do plano atual */}
                <div className="small muted" style={{ marginTop: 8 }}>
                  <div><strong>Recursos do plano:</strong></div>
                  <div>WhatsApp: lembretes + campanhas</div>
                  <div>Relatórios: {planInfo.allowAdvanced ? 'avançados' : 'básicos'}</div>
                </div>
                {/* Controles de recorrência (cartão) para planos Pro/Premium */}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {needsRecurringSetup && (
                    <button
                      className="btn btn--brand-outline btn--sm"
                      type="button"
                      onClick={async () => {
                        try {
                          setCheckoutLoading(true);
                          const data = await Api.billingRecurringSetup();
                          if (data?.init_point) window.location.href = data.init_point;
                        } catch (err) {
                          setCheckoutError(err?.data?.message || err?.message || 'Falha ao configurar recorrência.');
                        } finally {
                          setCheckoutLoading(false);
                        }
                      }}
                      disabled={checkoutLoading}
                      title="Configurar cobrança recorrente no cartão para os próximos ciclos"
                    >
                      {checkoutLoading ? <span className="spinner" /> : 'Configurar recorrência no cartão'}
                    </button>
                  )}
                  {hasGatewayRecurring && (
                    <>
                      {subStatus !== 'paused' && (
                        <button
                          className="btn btn--outline btn--sm"
                          type="button"
                          onClick={async () => {
                            setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                            try { await Api.billingRecurringPause(); setRecurringNotice('Recorrência pausada.'); await fetchBilling(); }
                            catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao pausar recorrência.'); }
                            finally { setRecurringLoading(false); }
                          }}
                          disabled={recurringLoading}
                          title="Pausar cobranças recorrentes"
                        >
                          {recurringLoading ? <span className="spinner" /> : 'Pausar recorrência'}
                        </button>
                      )}
                      {subStatus === 'paused' && (
                        <button
                          className="btn btn--outline btn--sm"
                          type="button"
                          onClick={async () => {
                            setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                            try { await Api.billingRecurringResume(); setRecurringNotice('Recorrência retomada.'); await fetchBilling(); }
                            catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao retomar recorrência.'); }
                            finally { setRecurringLoading(false); }
                          }}
                          disabled={recurringLoading}
                          title="Retomar cobranças recorrentes"
                        >
                          {recurringLoading ? <span className="spinner" /> : 'Retomar recorrência'}
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={async () => {
                          if (!confirm('Cancelar a recorrência? Você continuará ativo até o fim do ciclo atual.')) return;
                          setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                          try { await Api.billingRecurringCancel(); setRecurringNotice('Recorrência cancelada.'); await fetchBilling(); }
                          catch (e) { setRecurringError(e?.data?.message || e?.message || 'Falha ao cancelar recorrência.'); }
                          finally { setRecurringLoading(false); }
                        }}
                        disabled={recurringLoading}
                        title="Cancelar a recorrência (não renova na próxima data)"
                      >
                        {recurringLoading ? <span className="spinner" /> : 'Cancelar recorrência'}
                      </button>
                    </>
                  )}
                </div>
                {(recurringError || recurringNotice) && (
                  <div className={`notice notice--${recurringError ? 'error' : 'info'}`} role="status" style={{ marginTop: 6 }}>
                    {recurringError || recurringNotice}
                  </div>
                )}
                <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <div className="small muted">Alterar plano:</div>
                    {(['starter','pro','premium'].filter(p => p !== planInfo.plan)).map((p) => (
                      <button
                        key={p}
                        className="btn btn--outline"
                        type="button"
                        disabled={checkoutLoading || exceedsServices(p) || exceedsProfessionals(p)}
                        title={
                          exceedsServices(p)
                            ? `Reduza seus serviços para até ${PLAN_META[p].maxServices} antes de ir para ${planLabel(p)}.`
                            : exceedsProfessionals(p)
                            ? `Reduza seus profissionais para até ${PLAN_META[p].maxProfessionals} antes de ir para ${planLabel(p)}.`
                            : ''
                        }
                        onClick={() => handleChangePlan(p)}
                      >
                        {`Ir para ${planLabel(p)}`}
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {planInfo.status !== 'active' && (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => handleCheckout(planInfo.plan)}
                      disabled={checkoutLoading}
                    >
                      {checkoutLoading ? <span className="spinner" /> : planInfo.status === 'pending' ? 'Finalizar pagamento' : 'Gerar link de pagamento'}
                    </button>
                  )}
                  <Link className="btn btn--outline" to="/planos">Alterar plano</Link>
                  </div>
                </div>
                {/* Aviso de política de cobrança em upgrades/downgrades */}
                <div className="notice notice--warn" role="status">
                  Upgrades liberam recursos imediatamente; a cobrança do novo valor ocorre no próximo ciclo. Downgrades passam a valer no ciclo seguinte, desde que os limites do plano sejam atendidos. Testes gratuitos têm duração de 7 dias.
                </div>
                {/* Resumo dos limites por plano */}
                <div className="small muted" style={{ marginTop: 8 }}>
                  <div>Seus serviços: {serviceCount == null ? '...' : serviceCount} · Profissionais: {professionalCount == null ? '...' : professionalCount}</div>
                  <div>
                    Limites:
                    {' '}Starter (serviços: {PLAN_META.starter.maxServices}, profissionais: {PLAN_META.starter.maxProfessionals});
                    {' '}Pro (serviços: {PLAN_META.pro.maxServices}, profissionais: {PLAN_META.pro.maxProfessionals});
                    {' '}Premium (sem limites)
                  </div>
                </div>
              </>
            )}
          </>
        ),
      });
      list.push({
        id: 'public-link',
        title: 'Link público e mensagens',
        content: (
          <div className="grid" style={{ gap: 8 }}>
            <label className="label">
              <span>Slug do estabelecimento (apenas letras, nÃºmeros e hifens)</span>
              <input className="input" placeholder="ex: studio-bela" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <div className="small muted" style={{ userSelect: 'text' }}>
                {publicLink ? `Link pÃºblico: ${publicLink}` : 'Link publico sera exibido aqui'}
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  if (!publicLink) return;
                  try { navigator.clipboard.writeText(publicLink); } catch {}
                }}
              >
                Copiar link público
              </button>
            </div>
            <label className="label">
              <span>Assunto do email de confirmação</span>
              <input className="input" value={msg.email_subject} onChange={(e) => setMsg((m) => ({ ...m, email_subject: e.target.value }))} />
            </label>
            <label className="label">
              <span>HTML do email</span>
              <textarea className="input" rows={6} value={msg.email_html} onChange={(e) => setMsg((m) => ({ ...m, email_html: e.target.value }))} />
            </label>
            <label className="label">
              <span>Mensagem WhatsApp</span>
              <textarea className="input" rows={3} value={msg.wa_template} onChange={(e) => setMsg((m) => ({ ...m, wa_template: e.target.value }))} />
            </label>
            <div className="small muted">Placeholders: {'{{cliente_nome}}'}, {'{{servico_nome}}'}, {'{{data_hora}}'}, {'{{estabelecimento_nome}}'}</div>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn--outline"
                disabled={savingMessages}
                onClick={async () => {
                  try {
                    setSavingMessages(true);
                    if (slug) await Api.updateEstablishmentSlug(user.id, slug);
                    await Api.updateEstablishmentMessages(user.id, msg);
                    alert('Salvo com sucesso');
                  } catch (e) {
                    alert('Falha ao salvar');
                  } finally {
                    setSavingMessages(false);
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        ),
      });
    }

    list.push({
      id: 'notifications',
      title: 'Notificações',
      content: (
        <div className="grid" style={{ gap: 10 }}>
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={prefs.notificationsEmail}
              onChange={() => handleTogglePref('notificationsEmail')}
            />
            <span>
              <strong>Receber emails de confirmação</strong>
              <small>Envia emails de confirmação e atualizações de agendamentos.</small>
            </span>
          </label>
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={prefs.notificationsWhatsapp}
              onChange={() => handleTogglePref('notificationsWhatsapp')}
            />
            <span>
              <strong>Receber lembretes pelo WhatsApp</strong>
              <small>Utiliza o número cadastrado para enviar lembretes automatizados.</small>
            </span>
          </label>
          {notifStatus && <small className="muted">{notifStatus}</small>}
        </div>
      ),
    });

    list.push({
      id: 'support',
      title: 'Ajuda',
      content: (
        <>
          <p className="muted">Tire dúvidas, veja perguntas frequentes e formas de contato.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
          </div>
        </>
      ),
    });

    return list;
  }, [
    isEstab,
    planInfo.plan,
    planInfo.status,
    planInfo.trialEnd,
    planInfo.trialDaysLeft,
    planInfo.trialWarn,
    planInfo.allowAdvanced,
    planInfo.activeUntil,
    daysLeft,
    fmtDate,
    publicLink,
    slug,
    msg,
    savingMessages,
    user?.id,
    profileForm,
    passwordForm,
    profileSaving,
    profileStatus,
    avatarPreview,
    avatarError,
    prefs,
    notifStatus,
    billing,
    billingLoading,
    checkoutLoading,
    checkoutError,
    startTrial,
    handleCheckout,
    handleChangePlan,
    hasPaidHistory,
    trialEligible,
    hasActiveSubscription,
  ]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configuracoes</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferências.</p>
      </div>

      {sections.map(({ id, title, content }) => {
        const isOpen = !!openSections[id];
        return (
          <div key={id} className="card config-section">
            <button
              type="button"
              className={`config-section__toggle${isOpen ? ' is-open' : ''}`}
              onClick={() => toggleSection(id)}
              aria-expanded={isOpen}
            >
              <span>{title}</span>
              <IconChevronRight className="config-section__icon" aria-hidden="true" />
            </button>
            {isOpen && <div className="config-section__content">{content}</div>}
          </div>
        );
      })}
      {changePlanTarget && (
        <Modal
          title={`Confirmar alteração para ${planLabel(changePlanTarget)}`}
          onClose={closeChangePlanModal}
          actions={[
            <button
              key="cancel"
              type="button"
              className="btn btn--outline"
              onClick={closeChangePlanModal}
              disabled={changePlanSubmitting}
            >
              Cancelar
            </button>,
            <button
              key="confirm"
              type="button"
              className="btn btn--primary"
              onClick={confirmChangePlan}
              disabled={changePlanSubmitting}
            >
              {changePlanSubmitting ? <span className="spinner" /> : 'Confirmar alteração'}
            </button>,
          ]}
        >
          <p className="muted">
            Informe sua senha para seguir com a mudança para <strong>{planLabel(changePlanTarget)}</strong>.
            Upgrades liberam recursos imediatamente e a cobrança do novo valor acontece no próximo ciclo. Downgrades passam a valer no ciclo seguinte, desde que os limites sejam atendidos.
          </p>
          <label className="label" style={{ marginTop: 12 }}>
            <span>Senha</span>
            <input
              className="input"
              type="password"
              value={changePlanPassword}
              onChange={(e) => setChangePlanPassword(e.target.value)}
              autoFocus
              disabled={changePlanSubmitting}
            />
          </label>
          {changePlanError && (
            <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}>
              {changePlanError}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}






