import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  IconArrowUpRight,
  IconMail,
  IconPhone,
} from '../components/AuthIcons.jsx';
import LogoAO from '../components/LogoAO.jsx';
import { Api } from '../utils/api';

const WHATSAPP_SUPPORT_URL =
  'https://wa.me/5511915155349?text=Ol%C3%A1%20Time%20Agendamentos%20Online!%20Esqueci%20meu%20e-mail%20de%20login%20e%20preciso%20recuperar%20o%20acesso.';

export default function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit(event) {
    event.preventDefault();
    setErr('');
    setLoading(true);

    try {
      await Api.requestPasswordReset(String(email).trim());
      setSent(true);
    } catch (error) {
      if (error?.status === 404) {
        setSent(true);
      } else {
        setErr(error?.message || 'Não foi possível enviar o e-mail agora.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-preview auth-portal auth-portal--recover">
      <div className="login-preview__bg" aria-hidden="true" />
      <div className="login-preview__pattern" aria-hidden="true" />

      <main className="login-preview__main">
        <section className="login-preview__card">
          <div className="ao-login">
            <div className="ao-login__hero">
              <span className="ao-login__glow" aria-hidden="true" />
              <span className="ao-login__logo"><LogoAO size={44} /></span>
              <p className="ao-login__brand">Agendamentos Online</p>
              <h1 className="ao-login__hi">Recuperar <span>acesso</span></h1>
              <p className="ao-login__tag">Enviamos um link seguro para redefinir sua senha.</p>
            </div>

            <div className="ao-login__sheet">
              <span className="ao-login__handle" aria-hidden="true" />

              {sent ? (
                <div className="login-preview__alert login-preview__alert--success" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Solicitação enviada</div>
                    <div className="login-preview__alert-text">
                      Se existir uma conta para <strong>{email}</strong>, você receberá um e-mail com instruções.
                    </div>
                  </div>
                </div>
              ) : null}

              {err ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Não foi possível concluir</div>
                    <div className="login-preview__alert-text">{err}</div>
                  </div>
                </div>
              ) : null}

              {!sent ? (
                <form onSubmit={submit} className="login-preview__form">
                  <div className="login-preview__field">
                    <label className="login-preview__label" htmlFor="recover-email">E-mail</label>
                    <div className="auth-portal__field-shell">
                      <IconMail className="auth-portal__field-icon" />
                      <input
                        id="recover-email"
                        className="login-preview__input auth-portal__input-control"
                        type="email"
                        placeholder="voce@exemplo.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        required
                      />
                    </div>
                    <div className="login-preview__hint">Use o mesmo e-mail do login.</div>
                  </div>

                  <button className={`login-preview__submit${email && !loading ? ' is-ready' : ''}`} disabled={!email || loading}>
                    {loading ? (
                      <span className="login-preview__submit-content">
                        <span className="login-preview__spinner" aria-hidden="true" />
                        Enviando...
                      </span>
                    ) : (
                      'Enviar link'
                    )}
                  </button>

                  <div className="auth-portal__support-links">
                    <Link to="/ajuda" className="auth-portal__support-link">
                      <IconArrowUpRight />
                      <span>Falar com o suporte</span>
                    </Link>
                    <a href={WHATSAPP_SUPPORT_URL} target="_blank" rel="noreferrer" className="auth-portal__support-link">
                      <IconPhone />
                      <span>Suporte no WhatsApp</span>
                    </a>
                  </div>
                </form>
              ) : null}

              <div className="login-preview__actions">
                <Link to="/login" className="login-preview__ghost">
                  Voltar ao login
                </Link>
                <Link to="/" className="login-preview__ghost">
                  Voltar ao site
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
