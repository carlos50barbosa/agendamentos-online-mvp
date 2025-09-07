// src/pages/EstabelecimentosList.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';

export default function EstabelecimentosList() {
  const user = getUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await Api.listEstablishments();
        if (!mounted) return;
        setItems(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!mounted) return;
        setError('Não foi possível carregar os estabelecimentos.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Estabelecimentos</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {user?.tipo === 'estabelecimento'
            ? 'Somente clientes podem criar agendamentos.'
            : 'Escolha um estabelecimento para agendar.'}
        </p>

        {loading && <div className="empty">Carregando…</div>}
        {!loading && error && <div className="empty error">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="empty">Nenhum estabelecimento encontrado.</div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="row-wrap">
            {items.map((est) => (
              <Link
                key={est.id}
                className="mini-card"
                style={{ minWidth: 260 }}
                to={`/novo?estabelecimento=${encodeURIComponent(est.id)}`}
                aria-label={`Agendar em ${est.nome || est.name || `Estabelecimento #${est.id}`}`}
              >
                <div className="mini-card__title">{est.nome || est.name || `Estabelecimento #${est.id}`}</div>
                {(est.email || est.contato) && (
                  <div className="mini-card__meta">
                    <span>{est.email || est.contato}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
