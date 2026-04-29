import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  IconArrowUpRight,
  IconKey,
  IconMail,
  IconPhone,
  IconShield,
  IconSpark,
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
          <div className="login-preview__grid">
            <aside className="login-preview__aside" aria-label="Informações sobre recuperação">
              <div className="auth-portal__brand">
                <LogoAO size={40} className="login-preview__logo-mark" />
                <div className="auth-portal__brand-copy">
                  <div className="auth-portal__brand-title">Agendamentos Online</div>
                  <div className="auth-portal__brand-subtitle">Recuperacao de acesso com clareza</div>
                </div>
              </div>

              <span className="auth-portal__aside-badge">Recuperacao segura</span>

              <div>
                <h2 className="auth-portal__aside-title">Recupere sua conta sem perder o contexto do próximo acesso.</h2>
                <p className="auth-portal__aside-copy">
                  Informe o e-mail usado na plataforma. Se houver uma conta vinculada, enviaremos um link para redefinir a senha com segurança.
                </p>
              </div>

              <ul className="auth-portal__list">
                <li className="auth-portal__list-item">
                  <IconShield className="auth-portal__list-icon" />
                  <span>Resposta neutra para não expor a existência de contas.</span>
                </li>
                <li className="auth-portal__list-item">
                  <IconKey className="auth-portal__list-icon" />
                  <span>Fluxo alinhado com login e redefinição de senha.</span>
                </li>
                <li className="auth-portal__list-item">
                  <IconSpark className="auth-portal__list-icon" />
                  <span>Experiencia consistente em desktop e mobile.</span>
                </li>
              </ul>

              <div className="auth-portal__aside-footer">
                Se você não lembrar o e-mail usado, o suporte pode ajudar a retomar o acesso com mais contexto.
              </div>
            </aside>

            <div className="login-preview__panel">
              <span className="auth-portal__panel-badge">Recupere seu acesso</span>

              <header className="login-preview__header">
                <h1>Recupere seu acesso</h1>
                <p>Enviaremos um link para redefinir sua senha de forma segura.</p>
              </header>

              {sent ? (
                <div className="login-preview__alert login-preview__alert--success" role="status">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Solicitacao enviada</div>
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
