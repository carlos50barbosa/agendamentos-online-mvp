// src/pages/Login.jsx
import React from 'react';
import { Link } from 'react-router-dom';

export default function Login() {
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Entrar</h2>
        <p className="muted" style={{ marginTop: 0 }}>Escolha como deseja fazer login:</p>

        <div className="row-wrap">
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
      </div>
    </div>
  );
}

