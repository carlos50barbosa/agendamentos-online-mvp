import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconKey,
  IconLock,
  IconShield,
  IconSpark,
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
          <div className="login-preview__grid">
            <aside className="login-preview__aside" aria-label="Informações da redefinição">
              <div className="auth-portal__brand">
                <LogoAO size={40} className="login-preview__logo-mark" />
                <div className="auth-portal__brand-copy">
                  <div className="auth-portal__brand-title">Agendamentos Online</div>
                  <div className="auth-portal__brand-subtitle">Nova senha com o mesmo padrao premium</div>
                </div>
              </div>

              <span className="auth-portal__aside-badge">Redefinicao protegida</span>

              <div>
                <h2 className="auth-portal__aside-title">Finalize a recuperação com uma senha nova e segura.</h2>
                <p className="auth-portal__aside-copy">
                  Defina uma senha forte para voltar ao login com continuidade. O fluxo foi desenhado para ser simples e legivel em qualquer tela.
                </p>
              </div>

              <ul className="auth-portal__list">
                <li className="auth-portal__list-item">
                  <IconShield className="auth-portal__list-icon" />
                  <span>Link de redefinição validado antes do envio da nova senha.</span>
                </li>
                <li className="auth-portal__list-item">
                  <IconKey className="auth-portal__list-icon" />
                  <span>Senha nova pronta para o próximo acesso com o perfil correto.</span>
                </li>
                <li className="auth-portal__list-item">
                  <IconSpark className="auth-portal__list-icon" />
                  <span>Experiência consistente com login, cadastro e recuperação.</span>
                </li>
              </ul>

              <div className="auth-portal__aside-footer">
                Escolha uma senha exclusiva e com no mínimo 6 caracteres para reforçar a segurança do acesso.
              </div>
            </aside>

            <div className="login-preview__panel">
              <span className="auth-portal__panel-badge">Defina uma nova senha</span>

              <header className="login-preview__header">
                <h1>Defina uma nova senha</h1>
                <p>Crie uma senha segura para voltar ao login com confianca.</p>
              </header>

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
