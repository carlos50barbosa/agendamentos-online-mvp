// src/pages/Relatorios.jsx
import React from 'react';
import { getUser } from '../utils/auth';

export default function Relatorios(){
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Relatórios</h2>
        {!isEstab ? (
          <div className="box error" style={{ marginTop: 8 }}>
            Relatórios disponíveis apenas para estabelecimentos.
          </div>
        ) : (
          <p className="muted">Em breve: ocupação, faturamento, no-shows e exportações.</p>
        )}
      </div>
    </div>
  );
}

