// src/pages/Login.jsx

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Api } from '../utils/api';

import { clearPlanCache, saveToken, saveUser } from '../utils/auth';
import styles from './LoginProfileChoice.module.css';




const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ESTAB_THEME_DEFAULTS = Object.freeze({
  accent: '#0f766e',
  accentStrong: '#164e63',
});

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(prefixed)) return '';
  if (prefixed.length === 4) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  return prefixed.toLowerCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

function mixColors(hexA, hexB, weight = 0.5) {
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  if (!colorA || !colorB) return normalizeHexColor(hexA) || normalizeHexColor(hexB) || '';

  const safeWeight = Math.max(0, Math.min(1, weight));
  const mixChannel = (channel) => Math.round((colorA[channel] * safeWeight) + (colorB[channel] * (1 - safeWeight)));

  const mixed = [mixChannel('r'), mixChannel('g'), mixChannel('b')]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return `#${mixed}`;
}



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

  const normalizedTipoParam = useMemo(() => {

    const normalized = String(tipoParam || '').toLowerCase();

    if (normalized === 'cliente') return 'cliente';

    if (['estab', 'estabelecimento', 'empresa', 'business'].includes(normalized)) {
      return 'estabelecimento';
    }

    return '';

  }, [tipoParam]);

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

  const effectiveTipo = useMemo(() => {

    if (tipo) return tipo;

    if (normalizedTipoParam === 'estabelecimento') return 'ESTABELECIMENTO';

    if (normalizedTipoParam === 'cliente') return 'CLIENTE';

    return '';

  }, [normalizedTipoParam, tipo]);

  const isEstablishmentContext = effectiveTipo === 'ESTABELECIMENTO';

  const establishmentThemeStyle = useMemo(() => {

    const params = new URLSearchParams(loc.search);
    const accent = normalizeHexColor(params.get('accent') || params.get('cor')) || ESTAB_THEME_DEFAULTS.accent;
    const accentStrong =
      normalizeHexColor(params.get('accentStrong') || params.get('corStrong')) ||
      mixColors(accent, ESTAB_THEME_DEFAULTS.accentStrong, 0.42);

    return {
      '--estab-accent': accent,
      '--estab-accent-strong': accentStrong,
      '--estab-accent-soft': toRgba(accent, 0.1),
      '--estab-accent-soft-strong': toRgba(accent, 0.18),
      '--estab-accent-border': toRgba(accent, 0.24),
      '--estab-accent-ring': toRgba(accent, 0.2),
      '--estab-accent-shadow': toRgba(accentStrong, 0.18),
      '--estab-surface-top': mixColors(accent, '#ffffff', 0.1),
      '--estab-surface-bottom': mixColors(accentStrong, '#ffffff', 0.06),
      '--estab-badge-bg': mixColors(accent, '#ffffff', 0.14),
      '--estab-badge-border': toRgba(accent, 0.18),
    };

  }, [loc.search]);

  const headerTitle =
    effectiveTipo === 'ESTABELECIMENTO'
      ? 'Painel do estabelecimento'
      : effectiveTipo
        ? 'Entrar'
        : 'Escolha o perfil';

  const headerDescription =
    effectiveTipo === 'ESTABELECIMENTO'
      ? 'Acesse agenda, equipe, servicos e clientes em um fluxo mais profissional.'
      : effectiveTipo === 'CLIENTE'
        ? 'Use seu e-mail e senha para continuar.'
        : 'Cliente ou Estabelecimento.';

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

        aria-label={`Selecionar perfil ${title}`}

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

    <div
      className={`login-preview ${styles.page}${isEstablishmentContext ? ` ${styles.pageEstab}` : ''}`}
      style={establishmentThemeStyle}
    >


      <main className="login-preview__main">

        <section className="login-preview__card">

          <div className="login-preview__grid">

            <div className="login-preview__panel">

              <header className="login-preview__header">

                {isEstablishmentContext ? (
                  <span className={styles.headerBadge}>Acesso profissional</span>
                ) : null}

                <h1>{headerTitle}</h1>

                <p>{headerDescription}</p>

              </header>

              {isEstablishmentContext ? (
                <section className={styles.estabHero} aria-label="Resumo do acesso profissional">
                  <div className={styles.estabHeroEyebrow}>Mais controle na rotina</div>
                  <div className={styles.estabHeroTitle}>Agenda, equipe e atendimento no mesmo lugar.</div>
                  <div className={styles.estabHeroList}>
                    <span className={styles.estabHeroItem}>Agenda centralizada</span>
                    <span className={styles.estabHeroItem}>Servicos e equipe</span>
                    <span className={styles.estabHeroItem}>Clientes recorrentes</span>
                  </div>
                </section>
              ) : null}

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

              {!tipo ? (

                <div className="login-preview__chooser">
                  {lastProfileValue ? (

                    <div className="login-preview__continue">

                      <button

                        type="button"

                        className="login-preview__continue-card"

                        onClick={() => handleTipoSelect(lastProfileValue)}

                        aria-label={`Continuar como ${lastProfileLabel}`}

                      >

                        <div className={styles.continueSummary}>
                          <span className={styles.continueLabel}>Continuar:</span>
                          <span
                            className={`login-preview__continue-highlight login-preview__continue-highlight--${lastProfileValue === 'ESTABELECIMENTO' ? 'estab' : 'cliente'} ${styles.continueValue}`}
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

                  <div className="login-preview__tabs" role="tablist" aria-label="Escolher perfil">

                    <Tab value="CLIENTE" title="Cliente" hint="Acompanhe seus agendamentos e historico." />

                    <Tab value="ESTABELECIMENTO" title="Estabelecimento" hint="Gerencie agenda, equipe e clientes." />

                  </div>

                  <div className="login-preview__actions">
                    <Link to={cadastroTarget} className="login-preview__ghost">
                      Criar conta
                    </Link>
                  </div>
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


