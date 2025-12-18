// src/pages/Login.jsx
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconChevronRight, IconUser, IconWrench } from '../components/Icons.jsx';
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
          <div className="login-options login-options--cards">
            <Link
              className="login-option login-option--client"
              to={`/login-cliente${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              <div className="login-option__top">
                <span className="login-option__avatar" aria-hidden>
                  <IconUser className="login-option__icon" />
                </span>
                <div className="login-option__copy">
                  <span className="login-option__eyebrow">Sou Cliente</span>
                  <div className="login-option__title">Agendar um serviço</div>
                  <p className="login-option__desc">Marque horários e receba confirmações.</p>
                </div>
                <span className="login-option__cta">
                  <span>Entrar</span>
                  <IconChevronRight aria-hidden className="login-option__icon" />
                </span>
              </div>
              <div className="login-option__tags" aria-hidden>
                <span className="login-option__tag">Agendar</span>
                <span className="login-option__tag">Lembretes</span>
                <span className="login-option__tag">Confirmações</span>
              </div>
            </Link>
            <Link
              className="login-option login-option--business"
              to={`/login-estabelecimento${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              <div className="login-option__top">
                <span className="login-option__avatar" aria-hidden>
                  <IconWrench className="login-option__icon" />
                </span>
                <div className="login-option__copy">
                  <span className="login-option__eyebrow">Sou Estabelecimento</span>
                  <div className="login-option__title">Gerenciar minha agenda</div>
                  <p className="login-option__desc">Confirme clientes e organize a equipe.</p>
                </div>
                <span className="login-option__cta">
                  <span>Entrar</span>
                  <IconChevronRight aria-hidden className="login-option__icon" />
                </span>
              </div>
              <div className="login-option__tags" aria-hidden>
                <span className="login-option__tag">Agenda online</span>
                <span className="login-option__tag">Equipe</span>
                <span className="login-option__tag">Relatórios</span>
              </div>
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
