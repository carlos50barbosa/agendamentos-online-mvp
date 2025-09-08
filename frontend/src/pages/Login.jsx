// src/pages/Login.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconUser, IconHome } from '../components/Icons.jsx';
import LogoAO from '../components/LogoAO.jsx';

export default function Login() {
  const [sessionMsg, setSessionMsg] = useState('');
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
            <div className="box" role="alert" aria-live="polite" style={{ marginTop: 10, borderColor: '#14532d', color: '#065f46', background: '#ecfdf5' }}>
              {sessionMsg}
            </div>
          )}
          <div className="row-wrap" style={{ marginTop: 10 }}>
            <div className="mini-card" style={{ minWidth: 260 }}>
              <div className="mini-card__title">Cliente</div>
              <div className="mini-card__meta"><span>Acesse sua conta de cliente</span></div>
              <div className="row" style={{ marginTop: 8, width: '100%' }}>
                <Link className="btn btn--primary btn--lg btn--block" to="/login-cliente">
                  <IconUser className="btn__icon" aria-hidden />
                  Entrar como Cliente
                </Link>
              </div>
            </div>
            <div className="mini-card" style={{ minWidth: 260 }}>
              <div className="mini-card__title">Estabelecimento</div>
              <div className="mini-card__meta"><span>Acesse como estabelecimento</span></div>
              <div className="row" style={{ marginTop: 8, width: '100%' }}>
                <Link className="btn btn--primary btn--lg btn--block" to="/login-estabelecimento">
                  <IconHome className="btn__icon" aria-hidden />
                  Entrar como Estabelecimento
                </Link>
              </div>
            </div>
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
