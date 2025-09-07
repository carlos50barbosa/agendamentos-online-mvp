// src/pages/Login.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
          <div className="auth-hero">
            <div className="brand__logo" aria-hidden>AO</div>
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
              <div className="row" style={{ marginTop: 8 }}>
                <Link className="btn btn--primary btn--sm" to="/login-cliente">Login Cliente</Link>
              </div>
            </div>
            <div className="mini-card" style={{ minWidth: 260 }}>
              <div className="mini-card__title">Estabelecimento</div>
              <div className="mini-card__meta"><span>Acesse como estabelecimento</span></div>
              <div className="row" style={{ marginTop: 8 }}>
                <Link className="btn btn--primary btn--sm" to="/login-estabelecimento">Login Estabelecimento</Link>
              </div>
            </div>
          </div>
          <div className="auth-alt" style={{ marginTop: 10 }}>
            Novo por aqui? <Link to="/cadastro">Crie uma conta</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
