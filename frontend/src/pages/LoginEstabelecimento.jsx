import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function LoginEstabelecimento() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(loc.search);
    params.set('tipo', 'estabelecimento');
    nav(`/login?${params.toString()}`, { replace: true });
  }, [loc.search, nav]);

  return null;
}
