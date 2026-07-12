import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  IconBuilding,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconUser,
} from '../components/AuthIcons.jsx';
import LogoAO from '../components/LogoAO.jsx';
import { Api } from '../utils/api';
import { clearPlanCache, saveToken, saveUser } from '../utils/auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ProfileGlyph({ isCliente = false }) {
  return isCliente ? <IconUser /> : <IconBuilding />;
}

// Estabelecimento primeiro: é quem loga com mais frequência (o cliente agenda
// como visitante pelo link público, sem login).
const PROFILE_OPTIONS = [
  {
    value: 'ESTABELECIMENTO',
    title: 'Estabelecimento',
    description: 'Gerencie agenda, equipe, serviços e clientes.',
  },
  {
    value: 'CLIENTE',
    title: 'Cliente',
    description: 'Acompanhe seus agendamentos e histórico.',
  },
];

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();

  const [tipo, setTipo] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [sessionMsg, setSessionMsg] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);

  const emailRef = useRef(null);
  const passRef = useRef(null);

  const searchParams = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const nextParam = useMemo(() => searchParams.get('next') || searchParams.get('redirect') || '', [searchParams]);
  const tipoParam = useMemo(() => searchParams.get('tipo') || '', [searchParams]);

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
    const params = new URLSearchParams(loc.search);

    if (tipo === 'ESTABELECIMENTO') {
      params.set('tipo', 'estabelecimento');
    } else if (tipo === 'CLIENTE') {
      params.set('tipo', 'cliente');
    }

    const query = params.toString();
    return query ? `/cadastro?${query}` : '/cadastro';
  }, [loc.search, tipo]);

  useEffect(() => {
    try {
      const message = localStorage.getItem('session_message');
      if (message) {
        setSessionMsg(message);
        localStorage.removeItem('session_message');
      }
    } catch {}
  }, []);

  useEffect(() => {
    const normalized = String(tipoParam || '').toLowerCase();
    if (!normalized) return;

    if (normalized === 'cliente') {
      setTipo('CLIENTE');
      try {
        localStorage.setItem('ao:last_profile', 'cliente');
      } catch {}
      return;
    }

    if (['estab', 'estabelecimento', 'empresa', 'business'].includes(normalized)) {
      setTipo('ESTABELECIMENTO');
      try {
        localStorage.setItem('ao:last_profile', 'estabelecimento');
      } catch {}
    }
  }, [tipoParam]);

  // Perfil pré-selecionado: o último usado (a URL ?tipo= tem prioridade); senão,
  // Estabelecimento (perfil primário) — assim o formulário já aparece pronto.
  useEffect(() => {
    if (tipoParam) return;
    let last = '';
    try { last = localStorage.getItem('ao:last_profile') || ''; } catch {}
    setTipo(last === 'cliente' ? 'CLIENTE' : 'ESTABELECIMENTO');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').toLowerCase());
  const emailInvalid = Boolean(email) && !isValidEmail(email);
  const senhaInvalid = Boolean(senha) && senha.length < 6;

  const canSubmit = useMemo(() => {
    if (!email || !senha) return false;
    if (!isValidEmail(email)) return false;
    if (senha.length < 6) return false;
    return true;
  }, [email, senha]);

  const buildLoginSearch = (value) => {
    const params = new URLSearchParams(loc.search);

    if (value) params.set('tipo', value === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente');
    else params.delete('tipo');

    if (!params.get('next') && !params.get('redirect') && storedNext) {
      params.set('next', storedNext);
    }

    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  };

  const handleTipoSelect = (value) => {
    if (!value) return;

    setTipo(value);
    setErrorMsg('');
    setSuccessMsg('');

    const stored = value === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente';

    try {
      localStorage.setItem('ao:last_profile', stored);
    } catch {}

    nav(buildLoginSearch(value), { replace: true });
  };

  async function handleSubmit(event) {
    event.preventDefault();

    if (!tipo) {
      setErrorMsg('Selecione um perfil para continuar.');
      return;
    }

    if (loading) return;

    if (!email || !isValidEmail(email)) {
      setErrorMsg('Informe um e-mail válido para continuar.');
      emailRef.current?.focus();
      return;
    }

    if (!senha || senha.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      passRef.current?.focus();
      return;
    }

    if (!canSubmit) return;

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { token, user } = await Api.login(email.trim(), senha);
      const expected = tipo === 'CLIENTE' ? 'cliente' : 'estabelecimento';
      if (user?.tipo !== expected) throw new Error('tipo_incorreto');

      clearPlanCache();
      saveToken(token, { remember });
      saveUser(user, { remember });

      try {
        sessionStorage.removeItem('next_after_login');
      } catch {}

      const onboardingPending = user?.tipo === 'estabelecimento' && !user?.onboarding_concluido;
      const loginTarget = onboardingPending ? '/configuracao-inicial' : nextTarget;

      nav(`/loading?type=login&next=${encodeURIComponent(loginTarget)}`);
    } catch (err) {
      const message =
        err?.message === 'tipo_incorreto'
          ? (tipo === 'CLIENTE'
              ? 'Este acesso é para clientes. Use a opção de estabelecimento.'
              : 'Este acesso é para estabelecimentos. Use a opção de cliente.')
          : (err?.data?.message || err?.message || 'Não foi possível entrar. Verifique seus dados.');

      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }

  const hasTipo = Boolean(tipo);

  useEffect(() => {
    if (!tipo) return;
    const timeoutId = setTimeout(() => {
      emailRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [tipo]);

  return (
    <div
      className="login-preview auth-portal auth-portal--login"
    >
      <div className="login-preview__bg" aria-hidden="true" />
      <div className="login-preview__pattern" aria-hidden="true" />

      <main className="login-preview__main">
        <section className="login-preview__card">
          <div className="ao-login">
            <div className="ao-login__hero">
              <span className="ao-login__glow" aria-hidden="true" />
              <span className="ao-login__logo"><LogoAO size={44} /></span>
              <p className="ao-login__brand">Agendamentos Online</p>
              <h1 className="ao-login__hi">Bem-vindo <span>de volta</span></h1>
              <p className="ao-login__tag">Sua agenda, clientes e sinais num só lugar.</p>
            </div>

            <div className="ao-login__sheet">
              <span className="ao-login__handle" aria-hidden="true" />

              <div className="ao-login__seg" role="tablist" aria-label="Escolher tipo de acesso">
                {PROFILE_OPTIONS.map((option) => {
                  const active = tipo === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`ao-login__seg-opt${active ? ' is-active' : ''}`}
                      onClick={() => handleTipoSelect(option.value)}
                    >
                      <ProfileGlyph isCliente={option.value === 'CLIENTE'} />
                      {option.title}
                    </button>
                  );
                })}
              </div>

              {sessionMsg ? (
                <div className="login-preview__alert login-preview__alert--info" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-text">{sessionMsg}</div>
                  </div>
                </div>
              ) : null}

              {errorMsg ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-text">{errorMsg}</div>
                  </div>
                </div>
              ) : null}

              {successMsg ? (
                <div className="login-preview__alert login-preview__alert--success" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-text">{successMsg}</div>
                  </div>
                </div>
              ) : null}

              <form className="login-preview__form" onSubmit={handleSubmit}>
                  <div className={`login-preview__field${emailInvalid ? ' is-error' : ''}`}>
                    <label className="login-preview__label" htmlFor="login-email">E-mail</label>
                    <div className={`auth-portal__field-shell${emailInvalid ? ' is-error' : ''}`}>
                      <IconMail className="auth-portal__field-icon" />
                      <input
                        id="login-email"
                        className={`login-preview__input auth-portal__input-control${emailInvalid ? ' is-error' : ''}`}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="voce@exemplo.com"
                        ref={emailRef}
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          setErrorMsg('');
                          setSuccessMsg('');
                        }}
                        aria-invalid={email ? !isValidEmail(email) : false}
                      />
                    </div>
                    {emailInvalid ? <div className="login-preview__hint is-error">E-mail inválido.</div> : null}
                  </div>

                  <div className={`login-preview__field${senhaInvalid ? ' is-error' : ''}`}>
                    <label className="login-preview__label" htmlFor="login-pass">Senha</label>
                    <div className={`auth-portal__field-shell${senhaInvalid ? ' is-error' : ''}`}>
                      <IconLock className="auth-portal__field-icon" />
                      <input
                        id="login-pass"
                        className={`login-preview__input auth-portal__input-control${senhaInvalid ? ' is-error' : ''}`}
                        type={showPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="********"
                        ref={passRef}
                        value={senha}
                        onChange={(event) => {
                          setSenha(event.target.value);
                          setErrorMsg('');
                          setSuccessMsg('');
                        }}
                        onKeyUp={(event) => {
                          if (typeof event.getModifierState === 'function') {
                            setCapsLockOn(Boolean(event.getModifierState('CapsLock')));
                          }
                        }}
                        onBlur={() => setCapsLockOn(false)}
                        aria-invalid={senha ? senha.length < 6 : false}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((value) => !value)}
                        className="login-preview__toggle"
                        aria-pressed={showPass}
                        aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                        title={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {showPass ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>

                    {capsLockOn || senhaInvalid ? (
                      <div className={`login-preview__hint${senhaInvalid ? ' is-error' : ' is-warn'}`}>
                        {capsLockOn ? 'Caps Lock ativo.' : 'Mínimo de 6 caracteres.'}
                      </div>
                    ) : null}
                  </div>

                  <div className="login-preview__row">
                    <label className="login-preview__remember">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(event) => setRemember(event.target.checked)}
                      />
                      <span>Lembrar</span>
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
                      'Entrar'
                    )}
                  </button>

                  <p className="ao-login__secure">
                    <IconLock aria-hidden="true" />
                    Acesso seguro · seus dados protegidos
                  </p>

                  <div className="ao-login__divider">novo por aqui?</div>

                  <div className="login-preview__actions">
                    <Link
                      to={cadastroTarget}
                      className="login-preview__ghost"
                      aria-label={`Criar conta como ${tipo === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente'}`}
                    >
                      Criar conta
                    </Link>
                  </div>
                </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
