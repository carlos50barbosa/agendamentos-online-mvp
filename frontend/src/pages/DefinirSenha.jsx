import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLock,
} from '../components/AuthIcons.jsx';
import LogoAO from '../components/LogoAO.jsx';
import { Api } from '../utils/api';

export default function DefinirSenha() {
  const location = useLocation();
  const nav = useNavigate();

  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search]);

  const [senha, setSenha] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const valid = Boolean(token) && senha.length >= 6 && senha === confirm && !loading;
  const confirmMismatch = Boolean(confirm) && senha !== confirm;

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;

    setErr('');
    setLoading(true);

    try {
      await Api.resetPassword(token, senha);
      try {
        localStorage.setItem('session_message', 'Senha redefinida com sucesso. Faca login.');
      } catch {}
      nav('/login', { replace: true });
    } catch (error) {
      setErr(error?.message || 'Não foi possível redefinir sua senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-preview auth-portal auth-portal--reset">
      <div className="login-preview__bg" aria-hidden="true" />
      <div className="login-preview__pattern" aria-hidden="true" />

      <main className="login-preview__main">
        <section className="login-preview__card">
          <div className="ao-login">
            <div className="ao-login__hero">
              <span className="ao-login__glow" aria-hidden="true" />
              <span className="ao-login__logo"><LogoAO size={44} /></span>
              <p className="ao-login__brand">Agendamentos Online</p>
              <h1 className="ao-login__hi">Nova <span>senha</span></h1>
              <p className="ao-login__tag">Crie uma senha segura para voltar ao login.</p>
            </div>

            <div className="ao-login__sheet">
              <span className="ao-login__handle" aria-hidden="true" />

              {!token ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Link invalido</div>
                    <div className="login-preview__alert-text">
                      Solicite um novo link em <Link to="/recuperar-senha">Recuperar senha</Link>.
                    </div>
                  </div>
                </div>
              ) : null}

              {err ? (
                <div className="login-preview__alert login-preview__alert--error" role="alert">
                  <span className="login-preview__alert-dot" aria-hidden="true" />
                  <div>
                    <div className="login-preview__alert-title">Não foi possível salvar</div>
                    <div className="login-preview__alert-text">{err}</div>
                  </div>
                </div>
              ) : null}

              {token ? (
                <form onSubmit={submit} className="login-preview__form">
                  <div className="login-preview__field">
                    <label className="login-preview__label" htmlFor="reset-password">Nova senha</label>
                    <div className="login-preview__pass-row">
                      <div className={`auth-portal__field-shell${senha && senha.length < 6 ? ' is-error' : ''}`}>
                        <IconLock className="auth-portal__field-icon" />
                        <input
                          id="reset-password"
                          className="login-preview__input auth-portal__input-control"
                          type={show ? 'text' : 'password'}
                          placeholder="********"
                          value={senha}
                          onChange={(event) => setSenha(event.target.value)}
                          autoComplete="new-password"
                          minLength={6}
                          required
                        />
                      </div>

                      <button
                        type="button"
                        className="login-preview__toggle"
                        onClick={() => setShow((value) => !value)}
                        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {show ? <IconEyeOff /> : <IconEye />}
                        <span className="auth-portal__toggle-label">{show ? 'Ocultar' : 'Mostrar'}</span>
                      </button>
                    </div>
                    <div className={`login-preview__hint${senha && senha.length < 6 ? ' is-error' : ''}`}>
                      {senha && senha.length < 6 ? 'Use pelo menos 6 caracteres.' : 'Combine comprimento e memorabilidade.'}
                    </div>
                  </div>

                  <div className="login-preview__field">
                    <label className="login-preview__label" htmlFor="reset-password-confirm">Confirmar senha</label>
                    <div className="login-preview__pass-row">
                      <div className={`auth-portal__field-shell${confirmMismatch ? ' is-error' : ''}`}>
                        <IconLock className="auth-portal__field-icon" />
                        <input
                          id="reset-password-confirm"
                          className="login-preview__input auth-portal__input-control"
                          type={showConfirm ? 'text' : 'password'}
                          placeholder="Repita a nova senha"
                          value={confirm}
                          onChange={(event) => setConfirm(event.target.value)}
                          autoComplete="new-password"
                          minLength={6}
                          required
                        />
                      </div>

                      <button
                        type="button"
                        className="login-preview__toggle"
                        onClick={() => setShowConfirm((value) => !value)}
                        aria-label={showConfirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                      >
                        {showConfirm ? <IconEyeOff /> : <IconEye />}
                        <span className="auth-portal__toggle-label">{showConfirm ? 'Ocultar' : 'Mostrar'}</span>
                      </button>
                    </div>
                    {confirmMismatch ? (
                      <div className="login-preview__hint is-error">As senhas precisam ser iguais.</div>
                    ) : (
                      <div className="login-preview__hint">Repita a senha para confirmar.</div>
                    )}
                  </div>

                  <button className={`login-preview__submit${valid ? ' is-ready' : ''}`} disabled={!valid}>
                    {loading ? (
                      <span className="login-preview__submit-content">
                        <span className="login-preview__spinner" aria-hidden="true" />
                        Salvando...
                      </span>
                    ) : (
                      'Salvar senha'
                    )}
                  </button>
                </form>
              ) : null}

              <div className="login-preview__actions">
                <Link to="/login" className="login-preview__ghost">
                  Voltar ao login
                </Link>
                <Link to="/recuperar-senha" className="login-preview__ghost">
                  Solicitar novo link
                </Link>
              </div>

              <div className="auth-portal__support-links auth-portal__support-links--inline">
                <span className="auth-portal__support-link is-static">
                  <IconCheck />
                  <span>Fluxo de redefinição concluído no mesmo shell visual do login.</span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
