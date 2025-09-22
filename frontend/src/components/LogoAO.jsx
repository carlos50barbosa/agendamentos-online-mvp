// src/components/LogoAO.jsx
import React from 'react';

export default function LogoAO({ size = 28, className = 'brand__logo', title = 'Agendamentos Online' }){
  return (
    <span className={className} style={{ width: size, height: size }} aria-label={title} role="img">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* fundo branco com borda roxa */}
        <rect x="2" y="2" width="60" height="60" rx="10" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2" />
        {/* faixas sutis em roxo para dar "tonalidades" */}
        <path d="M0 8 L64 0 L64 14 L0 28 Z" fill="var(--brand)" opacity=".06" />
        <path d="M0 40 L64 30 L64 46 L0 58 Z" fill="var(--brand)" opacity=".05" />
        {/* marca AO centralizada */}
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontFamily="'Poppins', ui-sans-serif, system-ui" fontWeight="700" fontSize="28" fill="var(--brand)" letterSpacing=".5">
          AO
        </text>
      </svg>
    </span>
  );
}

