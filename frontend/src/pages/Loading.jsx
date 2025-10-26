// src/pages/Loading.jsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import LogoAO from '../components/LogoAO.jsx';

function useQuery() {
  const { search } = useLocation();
  return React.useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
}

export default function Loading() {
  const nav = useNavigate();
  const q = useQuery();
  const next = q.next || '/';
  const type = q.type || 'load';

  useEffect(() => {
    const timeout = setTimeout(() => nav(next, { replace: true }), 700);
    return () => clearTimeout(timeout);
  }, [nav, next]);

  const msg = type === 'login' ? 'Entrando...' : type === 'logout' ? 'Saindo...' : 'Carregando...';

  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'grid', placeItems: 'center', gap: 16 }}>
        <LogoAO size={56} />
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="spinner" aria-hidden />
          <span className="muted" aria-live="polite">{msg}</span>
        </div>
      </div>
    </div>
  );
}
