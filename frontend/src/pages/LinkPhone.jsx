import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Api } from '../utils/api';

export default function LinkPhone(){
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const token = sp.get('token') || '';
  const [status, setStatus] = useState('Carregando...');

  useEffect(() => {
    (async () => {
      try {
        if (!token) { setStatus('Token ausente.'); return; }
        await Api.linkPhone(token);
        setStatus('Telefone vinculado com sucesso.');
        setTimeout(() => nav('/', { replace: true }), 1500);
      } catch (e) {
        setStatus('Falha ao vincular telefone. Faça login e tente novamente.');
      }
    })();
  }, [token]);

  return (
    <div className="container" style={{ padding: 24 }}>
      <h2>Vincular WhatsApp</h2>
      <p>{status}</p>
    </div>
  );
}

