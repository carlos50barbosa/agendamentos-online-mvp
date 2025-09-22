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
    })();
  }, [isEstab, user?.id]);

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
      alert('Teste gratuito do plano Pro ativado por 14 dias!');
    } catch (err) {
      console.error('startTrial failed', err);
      alert('Nao foi possivel iniciar o teste gratuito agora.');
    }
  }, [isEstab, user?.id]);

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
    setNotifStatus('Preferencias salvas.');
    setTimeout(() => setNotifStatus(''), 2000);
  };

  const sections = useMemo(() => {
    const list = [];

    list.push({
      id: 'profile',
      title: 'Perfil e Seguranca',
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
                  <span>Numero</span>
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
              {profileSaving ? <span className="spinner" /> : 'Salvar alteracoes'}
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
              <div className="small muted">Status atual: {planInfo.status.toUpperCase()}</div>
            )}
            {planInfo.status === 'delinquent' && (
              <div className="notice notice--error" role="alert">
                <strong>Pagamento em atraso.</strong> Regularize a assinatura para liberar os recursos.
              </div>
            )}
            {planInfo.plan === 'starter' ? (
              <>
                {planInfo.trialEnd && daysLeft > 0 ? (
                  <div className="box box--highlight">
                    <strong>Teste gratis ativo</strong>
                    <div className="small muted">Termina em {fmtDate(planInfo.trialEnd)} - {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} restantes</div>
                  </div>
                ) : (
                  <div className="box" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                    <strong>Voce esta no plano Starter</strong>
                    <div className="small muted">Ative 14 dias gratis do Pro para desbloquear WhatsApp e relatorios.</div>
                  </div>
                )}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  {!planInfo.trialEnd && (
                    <button className="btn btn--outline" type="button" onClick={startTrial} disabled={planInfo.status === "delinquent"}>Ativar 14 dias gratis</button>
                  )}
                  <Link className="btn btn--primary" to="/planos">Conhecer planos</Link>
                </div>
              </>
            ) : (
              <>
                <div className="box box--highlight">
                  <strong>{planInfo.plan === 'pro' ? 'Plano Pro ativo' : 'Plano Premium ativo'}</strong>
                  <div className="small muted">Obrigado por apoiar o Agendamentos Online.</div>
                </div>
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn" type="button" onClick={() => alert('Em breve: central de cobranca')}>
                    Gerenciar cobranca
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
        title: 'Link publico e mensagens',
        content: (
          <div className="grid" style={{ gap: 8 }}>
            <label className="label">
              <span>Slug do estabelecimento (apenas letras, numeros e hifens)</span>
              <input className="input" placeholder="ex: studio-bela" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <div className="small muted" style={{ userSelect: 'text' }}>
                {publicLink ? `Link publico: ${publicLink}` : 'Link publico sera exibido aqui'}
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  if (!publicLink) return;
                  try { navigator.clipboard.writeText(publicLink); } catch {}
                }}
              >
                Copiar link publico
              </button>
            </div>
            <label className="label">
              <span>Assunto do email de confirmacao</span>
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
      title: 'Notificacoes',
      content: (
        <div className="grid" style={{ gap: 10 }}>
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={prefs.notificationsEmail}
              onChange={() => handleTogglePref('notificationsEmail')}
            />
            <span>
              <strong>Receber emails de confirmacao</strong>
              <small>Envia emails de confirmacao e atualizacoes de agendamentos.</small>
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
          <p className="muted">Tire duvidas, veja perguntas frequentes e formas de contato.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
          </div>
        </>
      ),
    });

    return list;
  }, [
    isEstab,      planInfo.plan,
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
  ]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configuracoes</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferencias.</p>
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

