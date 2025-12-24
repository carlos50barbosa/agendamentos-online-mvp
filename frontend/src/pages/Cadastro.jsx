
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LogoAO from '../components/LogoAO.jsx';
import { Api } from '../utils/api';
import { saveToken, saveUser } from '../utils/auth';
import { LEGAL_METADATA } from '../utils/legal.js';

const formatBRPhone = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const normalizeToE164BR = (value = '') => {
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

export default function Cadastro() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    tipo: '',
    telefone: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
  });
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [cepStatus, setCepStatus] = useState({ loading: false, error: '' });
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const legalMeta = useMemo(() => LEGAL_METADATA, []);

  const phoneDigits = (form.telefone || '').replace(/\D/g, '');
  const cepDigits = form.cep.replace(/\D/g, '');
  const isEstab = form.tipo === 'estabelecimento';

  const emailReady = useMemo(() => {
    const email = form.email.trim();
    const confirm = confirmEmail.trim();
    if (!email || !confirm) return false;
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) return false;
    return email.toLowerCase() === confirm.toLowerCase();
  }, [form.email, confirmEmail]);
  const senhaScore = useMemo(() => {
    const s = form.senha || '';
    let pts = 0;
    if (s.length >= 8) pts++;
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) pts++;
    if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) pts++;
    return pts;
  }, [form.senha]);
  const senhaLabel = ['Fraca', 'Razoável', 'Boa', 'Forte'][senhaScore];

  const senhaOk = form.senha.length >= 8 && /[^A-Za-z0-9]/.test(form.senha);
  const matchOk = form.senha && confirm && form.senha === confirm;
  const nomeOk = form.nome.trim().length >= 2;

  const phoneOk = useMemo(() => {
    if (!phoneDigits) return false;
    if (phoneDigits.startsWith('55')) return phoneDigits.length === 12 || phoneDigits.length === 13;
    return phoneDigits.length === 10 || phoneDigits.length === 11;
  }, [phoneDigits]);

  const addressOk = useMemo(() => {
    if (!isEstab) return true;
    return (
      cepDigits.length === 8 &&
      form.endereco.trim() &&
      form.numero.trim() &&
      form.bairro.trim() &&
      form.cidade.trim() &&
      /^[A-Za-z]{2}$/.test(form.estado.trim())
    );
  }, [isEstab, cepDigits.length, form.endereco, form.numero, form.bairro, form.cidade, form.estado]);

  const disabled =
    loading ||
    !nomeOk ||
    !emailReady ||
    !senhaOk ||
    !matchOk ||
    !phoneOk ||
    !form.tipo ||
    !addressOk ||
    !acceptPolicies;

  useEffect(() => {
    const digits = cepDigits;
    if (digits.length !== 8) {
      setCepStatus({ loading: false, error: '' });
      return;
    }

    let active = true;
    setCepStatus({ loading: true, error: '' });

    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (!data || data.erro) {
        setCepStatus({ loading: false, error: 'Nao foi possivel buscar o CEP.' });
          return;
        }
        setForm((prev) => ({
          ...prev,
          cep: formatCep(digits),
          endereco: data.logradouro || prev.endereco,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          estado: (data.uf || prev.estado || '').toUpperCase(),
        }));
        setCepStatus({ loading: false, error: '' });
      })
      .catch(() => {
        if (!active) return;
        setCepStatus({ loading: false, error: 'Nao foi possivel buscar o CEP.' });
      });

    return () => {
      active = false;
    };
  }, [cepDigits]);

  const updateField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setErr('');
    setSuccessMsg('');
    if (disabled) return;
    setLoading(true);
    try {
      const telefoneNorm = normalizeToE164BR(form.telefone.trim());
      const acceptanceTimestamp = new Date().toISOString();
      const payload = {
        nome: form.nome.trim(),
        email: form.email.trim(),
        senha: form.senha,
        tipo: form.tipo,
        telefone: telefoneNorm,
        cep: cepDigits || undefined,
        endereco: form.endereco.trim() || undefined,
        numero: form.numero.trim() || undefined,
        complemento: form.complemento.trim() || undefined,
        bairro: form.bairro.trim() || undefined,
        cidade: form.cidade.trim() || undefined,
        estado: form.estado.trim().toUpperCase() || undefined,
        termsVersion: legalMeta.terms?.version,
        privacyVersion: legalMeta.privacy?.version,
        termsAcceptedAt: acceptanceTimestamp,
        privacyAcceptedAt: acceptanceTimestamp,
        dataProcessingConsent: true,
      };
      const { token, user } = await Api.register(payload);
      saveToken(token);
      saveUser(user);
      setSuccessMsg('Cadastro realizado com sucesso! Redirecionando...');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      setTimeout(() => nav(user?.tipo === 'cliente' ? '/cliente' : '/estab'), 1200);
    } catch (e) {
      const message = e?.message || '';
      const friendly =
        message === 'email_exists'
          ? 'Este e-mail ja esta cadastrado.'
          : message === 'telefone_obrigatorio'
          ? 'Informe um telefone valido com DDD.'
          : message.includes('endereco')
          ? 'Verifique os campos de endereco.'
          : 'Falha ao criar conta. Tente novamente.';
      setErr(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-preview">
      <div className="login-preview__bg" aria-hidden="true" />
      <div className="login-preview__pattern" aria-hidden="true" />
      <div className="login-preview__orb login-preview__orb--violet" aria-hidden="true" />
      <div className="login-preview__orb login-preview__orb--green" aria-hidden="true" />

      <main className="login-preview__main">
        <section className="login-preview__card">
          <div className="login-preview__grid">
            <aside className="login-preview__aside">
              <div className="login-preview__brand">
                <LogoAO size={44} className="login-preview__logo-mark" />
                <div>
                  <div className="login-preview__brand-title">Agendamentos Online</div>
                  <div className="login-preview__brand-subtitle">Crie sua conta em poucos passos</div>
                </div>
              </div>

              <div className="login-preview__aside-card">
                <h2>Cadastro rápido</h2>
                <p>
                  Crie sua conta para agendar e acompanhar seus horários ou gerenciar sua agenda.
                </p>
                <ul>
                  <li>Escolha o perfil ideal</li>
                  <li>Confirme e-mail e WhatsApp</li>
                  <li>Dados protegidos pela plataforma</li>
                </ul>
                <div className="login-preview__aside-tip">Leva menos de 2 minutos para concluir.</div>
              </div>
            </aside>

            <div className="login-preview__panel">
              <div className="login-preview__mobile-brand">
                <LogoAO size={36} className="login-preview__logo-mark" />
                <span>Agendamentos Online</span>
              </div>

              <header className="login-preview__header">
                <h1>Criar conta</h1>
                <p>Escolha o perfil e preencha os dados abaixo.</p>
              </header>

              {successMsg ? (
                <div className="login-preview__alert login-preview__alert--success" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Conta criada</div>
                    <div className="login-preview__alert-text">{successMsg}</div>
                  </div>
                </div>
              ) : null}

              {err ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Erro no cadastro</div>
                    <div className="login-preview__alert-text">{err}</div>
                  </div>
                </div>
              ) : null}

              <form id="cadastro-form" onSubmit={submit} className="login-preview__form">
                <div className="signup-chooser">
                  <div className="signup-chooser__label">Como deseja usar?</div>
                  <div className="signup-chooser__hint">
                    Cliente agenda serviços. Estabelecimento recebe e organiza agendamentos.
                  </div>
                  <div className="login-preview__tabs signup-chooser__tabs" role="tablist" aria-label="Tipo de conta">
                    <button
                      type="button"
                      className={`login-preview__tab${form.tipo === 'cliente' ? ' is-active' : ''}`}
                      role="tab"
                      aria-selected={form.tipo === 'cliente'}
                      tabIndex={form.tipo === 'cliente' ? 0 : -1}
                      onClick={() => {
                        updateField('tipo', 'cliente');
                        try {
                          const target = document.getElementById('cadastro-nome') || document.getElementById('cadastro-form');
                          if (target) {
                            const rect = target.getBoundingClientRect();
                            const y = rect.top + window.scrollY - 80;
                            window.scrollTo({ top: y, behavior: 'smooth' });
                            setTimeout(() => target.focus?.(), 300);
                          }
                        } catch {}
                      }}
                    >
                      <div className="login-preview__tab-title">Sou Cliente</div>
                      <div className="login-preview__tab-hint">Acesse seus agendamentos e histórico</div>
                    </button>
                    <button
                      type="button"
                      className={`login-preview__tab${form.tipo === 'estabelecimento' ? ' is-active' : ''}`}
                      role="tab"
                      aria-selected={form.tipo === 'estabelecimento'}
                      tabIndex={form.tipo === 'estabelecimento' ? 0 : -1}
                      onClick={() => {
                        updateField('tipo', 'estabelecimento');
                        try {
                          const target = document.getElementById('cadastro-nome') || document.getElementById('cadastro-form');
                          if (target) {
                            const rect = target.getBoundingClientRect();
                            const y = rect.top + window.scrollY - 80;
                            window.scrollTo({ top: y, behavior: 'smooth' });
                            setTimeout(() => target.focus?.(), 300);
                          }
                        } catch {}
                      }}
                    >
                      <div className="login-preview__tab-title">Sou Estabelecimento</div>
                      <div className="login-preview__tab-hint">Gerencie agenda, serviços e clientes</div>
                    </button>
                  </div>
                  {!form.tipo && (
                    <div className="login-preview__hint is-error">Selecione uma opção para continuar.</div>
                  )}
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-nome">Nome</label>
                  <input
                    className="login-preview__input"
                    id="cadastro-nome"
                    placeholder="Seu nome | Estabelecimento"
                    value={form.nome}
                    onChange={(e) => updateField('nome', e.target.value)}
                    required
                  />
                  {form.nome && !nomeOk ? (
                    <div className="login-preview__hint is-error">Informe um nome válido.</div>
                  ) : null}
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-email">E-mail</label>
                  <input
                    className="login-preview__input"
                    id="cadastro-email"
                    type="email"
                    placeholder="voce@exemplo.com"
                    value={form.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    autoComplete="email"
                    onPaste={(e) => e.preventDefault()}
                    required
                  />
                  <div className={`login-preview__hint${form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? ' is-error' : ''}`}>
                    {form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
                      ? 'Informe um e-mail válido.'
                      : 'Use um e-mail válido para acesso.'}
                  </div>
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-email-confirm">Confirmar e-mail</label>
                  <input
                    className="login-preview__input"
                    id="cadastro-email-confirm"
                    type="email"
                    placeholder="Repita seu e-mail"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    autoComplete="off"
                    onPaste={(e) => e.preventDefault()}
                    required
                  />
                  {!!confirmEmail && form.email && form.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase() ? (
                    <div className="login-preview__hint is-error">O e-mail precisa ser igual ao campo anterior.</div>
                  ) : (
                    <div className="login-preview__hint">Repita o mesmo e-mail.</div>
                  )}
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-telefone">Telefone WhatsApp</label>
                  <input
                    className="login-preview__input"
                    id="cadastro-telefone"
                    type="tel"
                    inputMode="tel"
                    placeholder="WhatsApp com DDD (11) 99999-9999"
                    value={formatBRPhone(form.telefone)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
                      updateField('telefone', digits);
                    }}
                    autoComplete="tel"
                    required
                  />
                  <div className={`login-preview__hint${!phoneOk && phoneDigits ? ' is-error' : ''}`}>
                    {!phoneOk && phoneDigits
                      ? 'Digite todos os dígitos (DDD + número). Ex.: (11) 99999-9999'
                      : 'Usado para confirmar o agendamento.'}
                  </div>
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-senha">Senha</label>
                  <div className="login-preview__pass-row">
                    <input
                      className="login-preview__input"
                      id="cadastro-senha"
                      type={showPass ? 'text' : 'password'}
                      placeholder="********"
                      value={form.senha}
                      onChange={(e) => updateField('senha', e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="login-preview__toggle"
                      onClick={() => setShowPass((v) => !v)}
                      aria-pressed={showPass}
                    >
                      {showPass ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                  {form.senha ? (
                    <div className={`login-preview__hint strength strength--${senhaLabel?.toLowerCase() || 'fraca'}`}>
                      Forca: {senhaLabel}
                    </div>
                  ) : (
                    <div className="login-preview__hint">Use no minimo 8 caracteres e 1 especial.</div>
                  )}
                  {form.senha && !senhaOk ? (
                    <div className="login-preview__hint is-error">Use pelo menos 8 caracteres e 1 especial.</div>
                  ) : null}
                </div>

                <div className="login-preview__field">
                  <label className="login-preview__label" htmlFor="cadastro-confirmar-senha">Confirmar senha</label>
                  <div className="login-preview__pass-row">
                    <input
                      className="login-preview__input"
                      id="cadastro-confirmar-senha"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repita a senha"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="login-preview__toggle"
                      onClick={() => setShowConfirm((v) => !v)}
                      aria-pressed={showConfirm}
                    >
                      {showConfirm ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                  {!!confirm && !matchOk ? (
                    <div className="login-preview__hint is-error">As senhas não coincidem.</div>
                  ) : null}
                </div>

                {isEstab && (
                  <div className="login-preview__field-group">
                    <div className="login-preview__field">
                      <label className="login-preview__label" htmlFor="cadastro-cep">CEP</label>
                      <input
                        className="login-preview__input"
                        id="cadastro-cep"
                        placeholder="00000-000"
                        value={form.cep}
                        onChange={(e) => updateField('cep', formatCep(e.target.value))}
                        required
                        inputMode="numeric"
                      />
                      {cepStatus.error ? (
                        <div className="login-preview__hint is-error">{cepStatus.error}</div>
                      ) : null}
                    </div>
                    <div className="login-preview__field">
                      <label className="login-preview__label" htmlFor="cadastro-endereco">Endereço</label>
                      <input
                        className="login-preview__input"
                        id="cadastro-endereco"
                        value={form.endereco}
                        onChange={(e) => updateField('endereco', e.target.value)}
                        required
                      />
                    </div>
                    <div className="login-preview__field-row">
                      <div className="login-preview__field">
                        <label className="login-preview__label" htmlFor="cadastro-numero">Número</label>
                        <input
                          className="login-preview__input"
                          id="cadastro-numero"
                          value={form.numero}
                          onChange={(e) => updateField('numero', e.target.value)}
                          required
                        />
                      </div>
                      <div className="login-preview__field">
                        <label className="login-preview__label" htmlFor="cadastro-complemento">Complemento</label>
                        <input
                          className="login-preview__input"
                          id="cadastro-complemento"
                          value={form.complemento}
                          onChange={(e) => updateField('complemento', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="login-preview__field">
                      <label className="login-preview__label" htmlFor="cadastro-bairro">Bairro</label>
                      <input
                        className="login-preview__input"
                        id="cadastro-bairro"
                        value={form.bairro}
                        onChange={(e) => updateField('bairro', e.target.value)}
                        required
                      />
                    </div>
                    <div className="login-preview__field-row">
                      <div className="login-preview__field">
                        <label className="login-preview__label" htmlFor="cadastro-cidade">Cidade</label>
                        <input
                          className="login-preview__input"
                          id="cadastro-cidade"
                          value={form.cidade}
                          onChange={(e) => updateField('cidade', e.target.value)}
                          required
                        />
                      </div>
                      <div className="login-preview__field login-preview__field--compact">
                        <label className="login-preview__label" htmlFor="cadastro-estado">Estado</label>
                        <input
                          className="login-preview__input"
                          id="cadastro-estado"
                          value={form.estado}
                          onChange={(e) => updateField('estado', e.target.value.toUpperCase().slice(0, 2))}
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                <label className="terms-check">
                  <input
                    type="checkbox"
                    checked={acceptPolicies}
                    onChange={(e) => setAcceptPolicies(e.target.checked)}
                    required
                  />
                  <span>
                    Li e concordo com os <Link to="/termos" target="_blank" rel="noreferrer">Termos de Uso</Link> e com a{' '}
                    <Link to="/politica-privacidade" target="_blank" rel="noreferrer">Política de Privacidade</Link>.
                  </span>
                </label>
                <div className="auth-legal__version">
                  Versões vigentes: Termos {legalMeta.terms?.version} - Política {legalMeta.privacy?.version}
                </div>

                <button type="submit" className={`login-preview__submit${!disabled ? ' is-ready' : ''}`} disabled={disabled}>
                  {loading ? (
                    <span className="login-preview__submit-content">
                      <span className="login-preview__spinner" aria-hidden="true" />
                      Criando...
                    </span>
                  ) : (
                    'Criar conta'
                  )}
                </button>

                <div className="login-preview__actions">
                  <Link to="/login" className="login-preview__ghost">
                    Já tenho conta
                  </Link>
                  <Link to="/" className="login-preview__ghost">
                    Voltar ao site
                  </Link>
                </div>

                <div className="login-preview__note">
                  Ao criar a conta, você concorda com os termos e políticas da plataforma.
                </div>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
