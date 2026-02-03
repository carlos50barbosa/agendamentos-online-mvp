import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Api } from '../utils/api';
import LogoAO from '../components/LogoAO.jsx';

const WHATSAPP_SUPPORT_URL =
  'https://wa.me/5511915155349?text=Ol%C3%A1%20Time%20Agendamentos%20Online!%20Esqueci%20meu%20e-mail%20de%20login%20e%20preciso%20recuperar%20o%20acesso.';

export default function RecuperarSenha(){
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e){
    e.preventDefault();
    setErr('');
    setLoading(true);
    try{
      await Api.requestPasswordReset(String(email).trim());
      setSent(true);
    }catch(e){
      // Mesmo que o backend não exista ainda, ofereça resposta neutra
      // para evitar enumeração de emails
      if (e?.status === 404) {
        // Backend ainda não implementado; simula sucesso
        setSent(true);
      } else {
        setErr(e?.message || 'Não foi possível enviar o email agora.');
      }
    }finally{
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-illus" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div className="auth-hero">
            <LogoAO size={48} />
            <div>
              <h2 style={{ margin: 0 }}>Recuperar senha</h2>
              <small>Enviaremos um link para redefinir</small>
            </div>
          </div>

          {sent ? (
            <div className="box" role="status" style={{ marginTop: 10, borderColor: 'var(--success-border)', color: 'var(--success-text)', background: 'var(--success-bg)' }}>
              Se existir uma conta para <strong>{email}</strong>, você receberá um email com instruções.
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                <input
                  className="input"
                  type="email"
                  placeholder="Seu email"
                  value={email}
                  onChange={e=>setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <button className="btn btn--primary" disabled={!email || loading}>
                  {loading ? <span className="spinner" /> : 'Enviar link'}
                </button>
              </form>
              <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.35 }}>
                Esqueceu qual e-mail usou <Link to="/ajuda">Fale com o suporte</Link> ou{' '}
                <a href={WHATSAPP_SUPPORT_URL} target="_blank" rel="noreferrer">
                  chame no WhatsApp
                </a>
                .
              </div>
            </>
          )}

          {err && (
            <div className="box" role="alert" aria-live="polite" style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}>
              Erro: {err}
            </div>
          )}

          <div className="divider"><span>ou</span></div>
          <div className="auth-alt">
            Lembrou a senha <Link to="/login">Voltar ao login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

