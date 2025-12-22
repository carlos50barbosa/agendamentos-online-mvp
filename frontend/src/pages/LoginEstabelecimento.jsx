import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function LoginEstabelecimento() {
  const nav = useNavigate();
  const loc = useLocation();
  const nextParam = useMemo(
    () => new URLSearchParams(loc.search).get('next') || '',
    [loc.search]
  );

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tipo', 'estabelecimento');
    if (nextParam) params.set('next', nextParam);
    nav(`/login?${params.toString()}`, { replace: true });
  }, [nav, nextParam]);

  return null;
}
