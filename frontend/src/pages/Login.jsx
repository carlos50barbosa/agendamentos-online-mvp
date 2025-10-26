// src/pages/Login.jsx
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconLogout } from '../components/Icons.jsx';
import LogoAO from '../components/LogoAO.jsx';

export default function Login() {
  const [sessionMsg, setSessionMsg] = useState('');
  const loc = useLocation();
  const searchParams = React.useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const next = searchParams.get('next') || '';
  useEffect(() => {
    try{
      const msg = localStorage.getItem('session_message');
      if (msg) {
        setSessionMsg(msg);
        localStorage.removeItem('session_message');
      }
    }catch{}
  },[]);
  return (
    <div className="auth">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-illus" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div className="auth-hero">
            <LogoAO size={48} />
            <div>
              <h2>Entrar</h2>
              <small>Escolha como deseja acessar sua conta</small>
            </div>
          </div>
          {sessionMsg && (
            <div className="box" role="alert" aria-live="polite" style={{ marginTop: 10, borderColor: 'var(--success-border)', color: 'var(--success-text)', background: 'var(--success-bg)' }}>
              {sessionMsg}
            </div>
          )}
          <div className="login-options">
            <Link
              className="login-option"
              to={`/login-cliente${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              <span className="login-option__label">Para Clientes</span>
              <span className="login-option__action">
                <IconLogout className="login-option__icon" aria-hidden />
                <span>Login</span>
              </span>
            </Link>
            <Link
              className="login-option"
              to={`/login-estabelecimento${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              <span className="login-option__label">Para Empresas</span>
              <span className="login-option__action">
                <IconLogout className="login-option__icon" aria-hidden />
                <span>Login</span>
              </span>
            </Link>
          </div>
          <div className="divider"><span>ou</span></div>
          <div className="auth-alt" style={{ marginTop: 6 }}>
            Novo por aqui? <Link to="/cadastro">Crie uma conta</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
