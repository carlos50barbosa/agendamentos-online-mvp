// src/pages/Configuracoes.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser, saveUser } from '../utils/auth';
import { Api } from '../utils/api';
import { IconChevronRight } from '../components/Icons.jsx';
import { mergePreferences, readPreferences, writePreferences, broadcastPreferences } from '../utils/preferences';

const formatPhoneLabel = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
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
  const [openSections, setOpenSections] = useState({ profile: true });

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
  });
  const [passwordForm, setPasswordForm] = useState({ atual: '', nova: '', confirmar: '' });
  const [profileStatus, setProfileStatus] = useState({ type: '', message: '' });
  const [profileSaving, setProfileSaving] = useState(false);

  const cepLookupRef = useRef('');

  const [prefs, setPrefs] = useState(() => mergePreferences(readPreferences()));
  const [notifStatus, setNotifStatus] = useState('');
  const notifTimerRef = useRef(null);
  // Billing state
  const [billing, setBilling] = useState({ subscription: null, history: [] });
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const checkoutIntentRef = useRef(false);

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
    });
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

  const handleCheckout = useCallback(async (targetPlan) => {
    if (!isEstab) return;
    setCheckoutError('');
    setCheckoutLoading(true);
    checkoutIntentRef.current = true;
    try {
      const payload = { plan: targetPlan };
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
      setCheckoutError(err?.data?.message || err?.message || 'Falha ao gerar link de pagamento.');
    } finally {
      setCheckoutLoading(false);
      checkoutIntentRef.current = false;
      try { localStorage.removeItem('intent_plano'); } catch {}
    }
  }, [fetchBilling, isEstab]);

  useEffect(() => {
    if (!isEstab) return;
    let storedPlan = null;
    try {
      storedPlan = localStorage.getItem('intent_plano');
    } catch {}
    if (storedPlan && !checkoutIntentRef.current) {
      checkoutIntentRef.current = true;
      handleCheckout(storedPlan);
    }
  }, [handleCheckout, isEstab]);
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
      const response = await Api.updateEstablishmentPlan(user.id, { plan: 'pro', status: 'trialing', trialDays: 14 });
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
      alert('Teste gratuito do plano Pro ativado por 14 dias!');
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
      const response = await Api.updateProfile(payload);
      if (response?.user) {
        saveUser(response.user);
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
    const statusLabel = statusLabelMap[planInfo.status] || (planInfo.status ? planInfo.status.toUpperCase() : '');
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
      title: 'Perfil e SeguranÃ§a',
      content: (
        <form onSubmit={handleSaveProfile} className="grid" style={{ gap: 10 }}>
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
              {profileSaving ? <span className="spinner" /> : 'Salvar alteraÃ§Ãµes'}
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
                {planInfo.status === 'active' && planInfo.activeUntil ? ` ? pr?xima cobran?a em ${fmtDate(planInfo.activeUntil)}` : ''}
              </div>
            )}
            {billing.subscription?.status && (
              <div className="small muted">
                Assinatura Mercado Pago: {subscriptionStatusLabel}
                {amountLabel ? ` ? ${amountLabel}/m?s` : ''}
                {nextChargeLabel ? ` ? pr?ximo d?bito em ${nextChargeLabel}` : ''}
              </div>
            )}
            {billingLoading && (
              <div className="small muted">Atualizando informa??es de cobran?a...</div>
            )}
            {planInfo.status === 'delinquent' && (
              <div className="notice notice--error" role="alert">
                <strong>Pagamento em atraso.</strong> Regularize a assinatura para liberar os recursos.
              </div>
            )}
            {planInfo.status === 'pending' && (
              <div className="notice notice--warn" role="alert">
                <strong>Pagamento pendente.</strong> Finalize o checkout para concluir a contrata??o.
              </div>
            )}
            {checkoutError && (
              <div className="notice notice--error" role="alert">{checkoutError}</div>
            )}
            {planInfo.plan === 'starter' ? (
              <>
                {planInfo.trialEnd && daysLeft > 0 ? (
                  <div className="box box--highlight">
                    <strong>Teste gr?tis ativo</strong>
                    <div className="small muted">Termina em {fmtDate(planInfo.trialEnd)} - {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} restantes</div>
                  </div>
                ) : (
                  <div className="box" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                    <strong>Voc? est? no plano Starter</strong>
                    <div className="small muted">Ative 14 dias gr?tis do Pro para desbloquear WhatsApp e relat?rios.</div>
                  </div>
                )}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {!planInfo.trialEnd && (
                    <button
                      className="btn btn--outline"
                      type="button"
                      onClick={startTrial}
                      disabled={planInfo.status === 'delinquent' || checkoutLoading}
                    >
                      {checkoutLoading ? <span className="spinner" /> : 'Ativar 14 dias gr?tis'}
                    </button>
                  )}
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => handleCheckout('pro')}
                    disabled={checkoutLoading}
                  >
                    {checkoutLoading ? <span className="spinner" /> : 'Contratar plano Pro'}
                  </button>
                  <Link className="btn btn--outline" to="/planos">Conhecer planos</Link>
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
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => handleCheckout(planInfo.plan)}
                    disabled={checkoutLoading}
                  >
                    {checkoutLoading ? <span className="spinner" /> : planInfo.status === 'pending' ? 'Finalizar pagamento' : 'Gerar link de pagamento'}
                  </button>
                  <Link className="btn btn--outline" to="/planos">Alterar plano</Link>
                </div>
              </>
            )}
          </>
        ),
      });
      list.push({
        id: 'public-link',
        title: 'Link pÃºblico e mensagens',
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
                Copiar link pÃºblico
              </button>
            </div>
            <label className="label">
              <span>Assunto do email de confirmaÃ§Ã£o</span>
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
      title: 'NotificaÃ§Ãµes',
      content: (
        <div className="grid" style={{ gap: 10 }}>
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={prefs.notificationsEmail}
              onChange={() => handleTogglePref('notificationsEmail')}
            />
            <span>
              <strong>Receber emails de confirmaÃ§Ã£o</strong>
              <small>Envia emails de confirmaÃ§Ã£o e atualizacoes de agendamentos.</small>
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
              <small>Utiliza o numero cadastrado para enviar lembretes automatizados.</small>
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
          <p className="muted">Tire dÃºvidas, veja perguntas frequentes e formas de contato.</p>
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
    prefs,
    notifStatus,
    billing,
    billingLoading,
    checkoutLoading,
    checkoutError,
    startTrial,
    handleCheckout,
  ]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configuracoes</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferÃªncias.</p>
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
    </div>
  );
}






