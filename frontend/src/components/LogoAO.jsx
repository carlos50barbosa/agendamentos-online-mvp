// src/components/LogoAO.jsx
import React from 'react';

export default function LogoAO({ size = 28, className = 'brand__logo', title = 'Agendamentos Online' }) {
  return (
    <span className={className} style={{ width: size, height: size }} aria-label={title} role="img">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="aoGradient" x1="12%" y1="10%" x2="88%" y2="90%">
            <stop offset="0%" stopColor="var(--primary-500, #4f46e5)" />
            <stop offset="100%" stopColor="var(--primary-600, #4338ca)" />
          </linearGradient>
          <linearGradient id="aoShine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* Fundo em degradê com leve brilho */}
        <circle cx="32" cy="32" r="28" fill="url(#aoGradient)" />
        <path d="M10 26C12 18 20 12 32 12s20 6 22 14" fill="url(#aoShine)" />

        {/* Ícone de calendário */}
        <g transform="translate(16 18)">
          <rect
            x="2"
            y="6"
            width="28"
            height="28"
            rx="8"
            fill="var(--surface, #ffffff)"
            stroke="rgba(15, 23, 42, 0.08)"
            strokeWidth="1"
          />
          <path
            d="M6 14h20"
            stroke="rgba(15, 23, 42, 0.08)"
            strokeWidth="1"
            strokeLinecap="round"
          />
          <circle cx="8" cy="6" r="1.8" fill="var(--primary-500, #4f46e5)" />
          <circle cx="24" cy="6" r="1.8" fill="var(--primary-400, #6366f1)" />

          {/* Marca AO estilizada */}
          <path
            d="M10 24l6 6 12-12"
            fill="none"
            stroke="var(--primary-500, #4f46e5)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Detalhe pulsante */}
        <circle cx="46" cy="18" r="4" fill="var(--primary-200, #c7d2fe)" />
        <circle cx="46" cy="18" r="2.4" fill="var(--primary-500, #4f46e5)" />
      </svg>
    </span>
  );
}
