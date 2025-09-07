// src/pages/EstabelecimentosList.jsx
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';

export default function EstabelecimentosList() {
  const user = getUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Carrega q= da URL na primeira renderização e quando o histórico alterar
  useEffect(() => {
    const q = (searchParams.get('q') || '').trim();
    setQuery(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  const filtered = items.filter((est) => {
    const name = String(est?.nome || est?.name || '').toLowerCase();
    return !query || name.includes(query.trim().toLowerCase());
  });

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Estabelecimentos</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {user?.tipo === 'estabelecimento'
            ? 'Somente clientes podem criar agendamentos.'
            : 'Escolha um estabelecimento para agendar.'}
        </p>

        {/* Barra de busca */}
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="search"
            placeholder="Buscar estabelecimento…"
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              const sp = new URLSearchParams(searchParams);
              if (v && v.trim()) sp.set('q', v.trim());
              else sp.delete('q');
              setSearchParams(sp, { replace: true });
            }}
            style={{ minWidth: 240 }}
          />
        </div>

        {loading && <div className="empty">Carregando…</div>}
        {!loading && error && <div className="empty error">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="empty">Nenhum estabelecimento encontrado.</div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="row-wrap">
            {filtered.map((est) => {
              const sp = new URLSearchParams();
              sp.set('estabelecimento', String(est.id));
              const qv = (query || '').trim();
              if (qv) sp.set('q', qv);
              return (
                <Link
                  key={est.id}
                  className="mini-card"
                  style={{ minWidth: 260 }}
                  to={`/novo?${sp.toString()}`}
                  aria-label={`Agendar em ${est.nome || est.name || `Estabelecimento #${est.id}`}`}
                >
                  {/* Exibe somente o nome, como em /novo */}
                  <div className="mini-card__title">{est.nome || est.name || `Estabelecimento #${est.id}`}</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
