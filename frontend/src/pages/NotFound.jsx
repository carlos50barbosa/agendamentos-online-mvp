// src/pages/NotFound.jsx
// Página 404. Usada em duas situações:
//  - rota desconhecida (catch-all '*' no App.jsx);
//  - link curto (/<slug>) que não corresponde a nenhum estabelecimento (BookingPublic).
// Antes disso, URLs desconhecidas renderizavam a área de conteúdo em branco.
import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <section className="card" style={{ maxWidth: 520, width: '100%', padding: 32, textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-.02em',
            color: 'var(--brand, #5049E5)',
          }}
        >
          404
        </div>

        <h2 style={{ margin: '14px 0 6px' }}>Página não encontrada</h2>

        <p className="muted" style={{ marginTop: 0 }}>
          O endereço que você abriu não existe. Se você chegou aqui por um link de agendamento, o
          estabelecimento pode ter alterado o link da página.
        </p>

        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <Link className="btn btn--primary" to="/">Ir para o início</Link>
          <Link className="btn btn--outline" to="/novo">Encontrar um estabelecimento</Link>
        </div>
      </section>
    </div>
  );
}
