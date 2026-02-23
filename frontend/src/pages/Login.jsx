// src/pages/Login.jsx

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Api } from '../utils/api';

import { clearPlanCache, saveToken, saveUser } from '../utils/auth';




const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;



export default function Login() {

  const nav = useNavigate();

  const loc = useLocation();

  const [tipo, setTipo] = useState('');

  const [lastProfile, setLastProfile] = useState('');


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


      }

    } catch {}

  }, [tipoParam]);

  useEffect(() => {

    const normalized = String(tipoParam || '').toLowerCase();

    if (!normalized) return;

    if (normalized === 'cliente') {

      setTipo('CLIENTE');

      setLastProfile('cliente');

      try { localStorage.setItem('ao:last_profile', 'cliente'); } catch {}

      return;

    }

    if (['estab', 'estabelecimento', 'empresa', 'business'].includes(normalized)) {

      setTipo('ESTABELECIMENTO');

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

  const hasRedirectTarget = Boolean(nextParam || storedNext);

  const redirectHint = useMemo(() => {

    const raw = nextParam || storedNext || '';

    if (!raw) return '';

    let value = String(raw || '');

    try {

      if (/^https?:\/\//i.test(value)) {

        const parsed = new URL(value);

        value = `${parsed.pathname || '/'}${parsed.search || ''}`;

      }

    } catch {}

    return value.length > 46 ? `${value.slice(0, 43)}...` : value;

  }, [nextParam, storedNext]);



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


    const stored = value === 'ESTABELECIMENTO' ? 'estabelecimento' : 'cliente';

    setLastProfile(stored);

    try { localStorage.setItem('ao:last_profile', stored); } catch {}

    nav(buildLoginSearch(value), { replace: true });

  };



  const handleTipoReset = () => {

    setTipo('');

    setErrorMsg('');

    setSuccessMsg('');

    setCapsLockOn(false);


    nav(buildLoginSearch(''), { replace: true });

  };



  async function handleSubmit(e) {

    e.preventDefault();

    if (!tipo) {

      setErrorMsg('Selecione um perfil para continuar.');

      return;

    }

    if (loading) return;

    if (!email || !isValidEmail(email)) {

      setErrorMsg('Informe um e-mail valido para continuar.');

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

      try { sessionStorage.removeItem('next_after_login'); } catch {}

      nav(`/loading?type=login&next=${encodeURIComponent(nextTarget)}`);

    } catch (err) {

      const msg =

        err?.message === 'tipo_incorreto'
          ? (tipo === 'CLIENTE'
              ? 'Este acesso e para clientes. Use a opcao de estabelecimento.'
              : 'Este acesso e para estabelecimentos. Use a opcao de cliente.')
          : (err?.data?.message || err?.message || 'Nao foi possivel entrar. Verifique seus dados.');

      setErrorMsg(msg);

    } finally {

      setLoading(false);

    }

  }



  const hasTipo = Boolean(tipo);

  useEffect(() => {

    if (!tipo) return;

    const id = setTimeout(() => {

      emailRef.current?.focus();

    }, 0);

    return () => clearTimeout(id);

  }, [tipo]);

  const ProfileGlyph = ({ isCliente = false }) => (
    isCliente ? (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h16" />
        <path d="M6 20V7l6-3 6 3v13" />
        <path d="M9 10h2M13 10h2M9 14h2M13 14h2" />
      </svg>
    )
  );

  const Tab = ({ value, title, hint }) => {

    const active = tipo === value;

    const isCliente = value === 'CLIENTE';

    return (

      <button

        type="button"

        onClick={() => handleTipoSelect(value)}

        className={`login-preview__tab login-preview__tab--${isCliente ? 'cliente' : 'estab'}${active ? ' is-active' : ''}`}

        role="tab"

        aria-selected={active}

        tabIndex={active || !hasTipo ? 0 : -1}

      >

        <span className="login-preview__tab-icon" aria-hidden="true">
          <ProfileGlyph isCliente={isCliente} />

        </span>

        <span className="login-preview__tab-body">

          <span className="login-preview__tab-title">{title}</span>

          {hint ? <span className="login-preview__tab-hint">{hint}</span> : null}
        </span>

      </button>

    );

  };



  return (

    <div className="login-preview">


      <main className="login-preview__main">

        <section className="login-preview__card">

          <div className="login-preview__grid">

            <div className="login-preview__panel">

              <header className="login-preview__header">

                <h1>{tipo ? 'Entrar' : 'Escolha o perfil'}</h1>

                <p>{tipo ? 'E-mail e senha.' : 'Cliente ou Estabelecimento.'}</p>

              </header>

              {tipo ? (

                <div
                  className={`login-preview__selected-simple login-preview__selected-simple--${tipo === 'ESTABELECIMENTO' ? 'estab' : 'cliente'}`}
                  role="status"
                >
                  <div className="login-preview__selected-simple-label">
                    Perfil: <strong>{tipo === 'ESTABELECIMENTO' ? 'Estabelecimento' : 'Cliente'}</strong>
                  </div>
                  <button type="button" className="login-preview__selected-simple-change" onClick={handleTipoReset}>
                    Trocar
                  </button>
                </div>

              ) : null}

              {!tipo && lastProfileValue ? (

                <div className="login-preview__continue">

                  <button

                    type="button"

                    className="login-preview__continue-card"

                    onClick={() => handleTipoSelect(lastProfileValue)}

                    aria-label={`Continuar como ${lastProfileLabel}`}

                  >

                    <div className="login-preview__continue-title">
                      Continuar:{' '}
                      <span
                        className={`login-preview__continue-highlight login-preview__continue-highlight--${lastProfileValue === 'ESTABELECIMENTO' ? 'estab' : 'cliente'}`}
                      >
                        {lastProfileLabel}
                      </span>
                    </div>

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

              {!tipo ? (

                <div className="login-preview__tabs" role="tablist" aria-label="Escolher perfil">

                  <Tab value="CLIENTE" title="Cliente" />

                  <Tab value="ESTABELECIMENTO" title="Estabelecimento" />

                </div>

              ) : null}

              {!tipo ? (
                <div className="login-preview__actions">
                  <Link to={cadastroTarget} className="login-preview__ghost">
                    Criar conta
                  </Link>
                </div>
              ) : null}

              {hasRedirectTarget ? (
                <div className="login-preview__redirect" role="status" aria-live="polite">
                  Redirecionamento: <strong>{redirectHint}</strong>.
                </div>
              ) : null}



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



              {tipo ? (

                <form className="login-preview__form" onSubmit={handleSubmit}>

                  <div className={`login-preview__field${emailInvalid ? ' is-error' : ''}`}>

                    <label className="login-preview__label" htmlFor="login-email">E-mail</label>

                    <input

                      id="login-email"

                      className={`login-preview__input${emailInvalid ? ' is-error' : ''}`}

                      type="email"

                      inputMode="email"

                      autoComplete="email"

                      placeholder="voce@exemplo.com"

                      ref={emailRef}

                      value={email}

                      onChange={(e) => {

                        setEmail(e.target.value);

                        setErrorMsg('');

                        setSuccessMsg('');

                      }}

                      aria-invalid={email ? !isValidEmail(email) : false}

                    />

                    {emailInvalid ? (
                      <div className="login-preview__hint is-error">E-mail invalido.</div>
                    ) : null}

                  </div>



                  <div className={`login-preview__field${senhaInvalid ? ' is-error' : ''}`}>

                    <label className="login-preview__label" htmlFor="login-pass">Senha</label>

                    <div className="login-preview__pass-row">

                      <input

                        id="login-pass"

                        className={`login-preview__input${senhaInvalid ? ' is-error' : ''}`}

                        type={showPass ? 'text' : 'password'}

                        autoComplete="current-password"

                        placeholder="********"

                        ref={passRef}

                        value={senha}

                        onChange={(e) => {

                          setSenha(e.target.value);

                          setErrorMsg('');

                          setSuccessMsg('');

                        }}

                        onKeyUp={(e) => {
                          if (typeof e.getModifierState === 'function') {
                            setCapsLockOn(Boolean(e.getModifierState('CapsLock')));
                          }
                        }}

                        onBlur={() => setCapsLockOn(false)}

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

                    {capsLockOn || senhaInvalid ? (
                      <div className={`login-preview__hint${senhaInvalid ? ' is-error' : ' is-warn'}`}>
                        {capsLockOn ? 'Caps Lock ativo.' : 'Minimo de 6 caracteres.'}
                      </div>
                    ) : null}

                  </div>



                  <div className="login-preview__row">

                    <label className="login-preview__remember">

                      <input

                        type="checkbox"

                        checked={remember}

                        onChange={(e) => setRemember(e.target.checked)}

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

                      <>Entrar</>

                    )}

                  </button>



                  <div className="login-preview__actions">

                    <Link to={cadastroTarget} className="login-preview__ghost">

                      Criar conta

                    </Link>

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


