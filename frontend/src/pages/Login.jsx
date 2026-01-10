// src/pages/Login.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Api } from '../utils/api';
import { clearPlanCache, saveToken, saveUser } from '../utils/auth';
import LogoAO from '../components/LogoAO.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const [tipo, setTipo] = useState('');
  const [lastProfile, setLastProfile] = useState('');
  const [showChooser, setShowChooser] = useState(true);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [sessionMsg, setSessionMsg] = useState('');

  const nextParam = useMemo(
    () => new URLSearchParams(loc.search).get('next') || '',
    [loc.search]
  );
  const tipoParam = useMemo(
    () => new URLSearchParams(loc.search).get('tipo') || '',
    [loc.search]
  );
  const storedNext = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      return sessionStorage.getItem('next_after_login') || '';
    } catch {
      return '';
    }
  }, [loc.key]);
  const nextTarget = useMemo(() => {
    const fallback = tipo === 'ESTABELECIMENTO' ? '/estab' : '/cliente';
    return nextParam || storedNext || fallback;
  }, [nextParam, storedNext, tipo]);
  const cadastroTarget = useMemo(() => {
    if (tipo === 'ESTABELECIMENTO') return '/cadastro?tipo=estabelecimento';
    if (tipo === 'CLIENTE') return '/cadastro?tipo=cliente';
    return '/cadastro';
  }, [tipo]);

  useEffect(() => {
    try {
      const msg = localStorage.getItem('session_message');
      if (msg) {
        setSessionMsg(msg);
        localStorage.removeItem('session_message');
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('ao:last_profile');
      if (stored === 'cliente' || stored === 'estabelecimento') {
        setLastProfile(stored);
        if (!tipoParam) setShowChooser(false);
      }
    } catch {}
  }, [tipoParam]);
  useEffect(() => {
    const normalized = String(tipoParam || '').toLowerCase();
    if (!normalized) return;
    if (normalized === 'cliente') {
      setTipo('CLIENTE');
      setShowChooser(false);
      setLastProfile('cliente');
      try { localStorage.setItem('ao:last_profile', 'cliente'); } catch {}
      return;
    }
    if (['estab', 'estabelecimento', 'empresa', 'business'].includes(normalized)) {
      setTipo('ESTABELECIMENTO');
      setShowChooser(false);
      setLastProfile('estabelecimento');
      try { localStorage.setItem('ao:last_profile', 'estabelecimento'); } catch {}
    }
  }, [tipoParam]);

  const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').toLowerCase());
  const emailInvalid = Boolean(email) && !isValidEmail(email);
  const senhaInvalid = Boolean(senha) && senha.length < 6;
  const canSubmit = useMemo(() => {
    if (!email || !senha) return false;
    if (!isValidEmail(email)) return false;
    if (senha.length < 6) return false;
    return true;
  }, [email, senha]);
  const lastProfileValue = useMemo(() => {
    if (lastProfile === 'estabelecimento') return 'ESTABELECIMENTO';
    if (lastProfile === 'cliente') return 'CLIENTE';
    return '';
  }, [lastProfile]);
  const lastProfileLabel = useMemo(() => {
    if (!lastProfileValue) return '';
    return lastProfileValue === 'ESTABELECIMENTO' ? 'Estabelecimento' : 'Cliente';
  }, [lastProfileValue]);

  const buildLoginSearch = (value) => {
    const params = new URLSearchParams(loc.search);
    if (value) params.set('tipo', value === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente');
    else params.delete('tipo');
    const nextValue = params.get('next') || nextParam || storedNext;
    if (nextValue) params.set('next', nextValue);
    else params.delete('next');
    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  };

  const handleTipoSelect = (value) => {
    if (!value) return;
    setTipo(value);
    setErrorMsg('');
    setSuccessMsg('');
    setShowChooser(false);
    const stored = value === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente';
    setLastProfile(stored);
    try { localStorage.setItem('ao:last_profile', stored); } catch {}
    nav(buildLoginSearch(value), { replace: true });
  };

  const handleTipoReset = () => {
    setTipo('');
    setErrorMsg('');
    setSuccessMsg('');
    setShowChooser(true);
    nav(buildLoginSearch(''), { replace: true });
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!tipo) {
      setErrorMsg('Selecione um perfil para continuar.');
      return;
    }
    if (!canSubmit || loading) return;

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { token, user } = await Api.login(email.trim(), senha);
      const expected = tipo === 'CLIENTE' ? 'cliente' : 'estabelecimento';
      if (user?.tipo !== expected) throw new Error('tipo_incorreto');
      clearPlanCache();
      saveToken(token);
      saveUser(user);
      try { sessionStorage.removeItem('next_after_login'); } catch {}
      nav(`/loading?type=login&next=${encodeURIComponent(nextTarget)}`);
    } catch (err) {
      const msg =
        err?.message === 'tipo_incorreto'
          ? (tipo === 'CLIENTE'
            ? 'Este acesso e para clientes. Use a opção de estabelecimento.'
            : 'Este acesso e para estabelecimentos. Use a opção de cliente.')
          : (err?.data?.message || err?.message || 'Não foi possível entrar. Verifique seus dados.');
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  const hasTipo = Boolean(tipo);
  const Tab = ({ value, title, hint }) => {
    const active = tipo === value;
    return (
      <button
        type="button"
        onClick={() => handleTipoSelect(value)}
        className={`login-preview__tab${active ? ' is-active' : ''}`}
        role="tab"
        aria-selected={active}
        tabIndex={active || !hasTipo ? 0 : -1}
      >
        <div className="login-preview__tab-title">{title}</div>
        <div className="login-preview__tab-hint">{hint}</div>
      </button>
    );
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
                  <div className="login-preview__brand-subtitle">Acesso seguro a sua conta</div>
                </div>
              </div>

              <div className="login-preview__aside-card">
                <h2>Mais praticidade no dia a dia</h2>
                <p>
                  Entre para acompanhar seus agendamentos ou administrar sua agenda com rapidez.
                </p>

                <ul>
                  <li>Login por perfil (Cliente/Estabelecimento)</li>
                  <li>Interface rápida e responsiva</li>
                  <li>Validação e feedback em tempo real</li>
                </ul>

                <div className="login-preview__aside-tip">
                  Dica: use "Lembrar de mim" em dispositivos pessoais.
                </div>
              </div>
            </aside>

            <div className="login-preview__panel">
              <header className="login-preview__header">
                <h1>Como você quer entrar?</h1>
                <p>Escolha o perfil e acesse sua conta.</p>
              </header>

              {tipo ? (
                <button type="button" className="login-preview__swap" onClick={handleTipoReset}>
                  Trocar perfil
                </button>
              ) : null}
              {!showChooser && lastProfileValue && !tipo ? (
                <div className="login-preview__continue">
                  <button
                    type="button"
                    className="login-preview__continue-card"
                    onClick={() => handleTipoSelect(lastProfileValue)}
                    aria-label={`Continuar como ${lastProfileLabel}`}
                  >
                    <div className="login-preview__continue-title">Continuar como {lastProfileLabel}</div>
                    <div className="login-preview__continue-hint">Usar o ultimo perfil selecionado.</div>
                  </button>
                  <button
                    type="button"
                    className="login-preview__continue-link"
                    onClick={handleTipoReset}
                  >
                    Trocar perfil
                  </button>
                </div>
              ) : null}
              {showChooser || !lastProfileValue ? (
                <div className="login-preview__tabs" role="tablist" aria-label="Escolher perfil">
                  <Tab value="CLIENTE" title="Cliente" hint="Acesse seus agendamentos e historico" />
                  <Tab value="ESTABELECIMENTO" title="Estabelecimento" hint="Gerencie agenda, servicos e clientes" />
                </div>
              ) : null}
              {!tipo && (showChooser || !lastProfileValue) ? (
                <div className="login-preview__hint">Selecione um perfil para continuar.</div>
              ) : null}

              {sessionMsg ? (
                <div className="login-preview__alert login-preview__alert--info" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Aviso</div>
                    <div className="login-preview__alert-text">{sessionMsg}</div>
                  </div>
                </div>
              ) : null}

              {errorMsg ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Ops!</div>
                    <div className="login-preview__alert-text">{errorMsg}</div>
                  </div>
                </div>
              ) : null}

              {successMsg ? (
                <div className="login-preview__alert login-preview__alert--success" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Tudo certo</div>
                    <div className="login-preview__alert-text">{successMsg}</div>
                  </div>
                </div>
              ) : null}

              {tipo ? (
                <form className="login-preview__form" onSubmit={handleSubmit}>
                  <div className="login-preview__field">
                    <label className="login-preview__label" htmlFor="login-email">E-mail</label>
                    <input
                      id="login-email"
                      className="login-preview__input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="voce@exemplo.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setErrorMsg('');
                        setSuccessMsg('');
                      }}
                      aria-invalid={email ? !isValidEmail(email) : false}
                    />
                    <div className={`login-preview__hint${emailInvalid ? ' is-error' : ''}`}>
                      {emailInvalid ? 'Digite um e-mail valido.' : 'Use o e-mail cadastrado.'}
                    </div>
                  </div>

                  <div className="login-preview__field">
                    <label className="login-preview__label" htmlFor="login-pass">Senha</label>
                    <div className="login-preview__pass-row">
                      <input
                        id="login-pass"
                        className="login-preview__input"
                        type={showPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="********"
                        value={senha}
                        onChange={(e) => {
                          setSenha(e.target.value);
                          setErrorMsg('');
                          setSuccessMsg('');
                        }}
                        aria-invalid={senha ? senha.length < 6 : false}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((s) => !s)}
                        className="login-preview__toggle"
                        aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {showPass ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                    <div className={`login-preview__hint${senhaInvalid ? ' is-error' : ''}`}>
                      {senhaInvalid
                        ? 'A senha deve ter pelo menos 6 caracteres.'
                        : 'Não compartilhe sua senha com ninguem.'}
                    </div>
                  </div>

                  <div className="login-preview__row">
                    <label className="login-preview__remember">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <span>Lembrar de mim</span>
                    </label>
                    <Link to="/recuperar-senha" className="login-preview__link">
                      Esqueci minha senha
                    </Link>
                  </div>

                  <button
                    className={`login-preview__submit${canSubmit && !loading ? ' is-ready' : ''}`}
                    type="submit"
                    disabled={!canSubmit || loading}
                  >
                    {loading ? (
                      <span className="login-preview__submit-content">
                        <span className="login-preview__spinner" aria-hidden="true" />
                        Entrando...
                      </span>
                    ) : (
                      <>Entrar como {tipo === 'CLIENTE' ? 'Cliente' : 'Estabelecimento'}</>
                    )}
                  </button>

                  <div className="login-preview__divider">
                    <span />
                    <div>ou</div>
                    <span />
                  </div>

                  <div className="login-preview__actions">
                    <Link to={cadastroTarget} className="login-preview__ghost">
                      Criar conta
                    </Link>
                    <Link to="/" className="login-preview__ghost">
                      Voltar ao site
                    </Link>
                  </div>

                  <div className="login-preview__note">
                    Ao entrar, você concorda com os termos e políticas da plataforma.
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
