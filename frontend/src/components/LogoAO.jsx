// src/components/LogoAO.jsx
import React from 'react';

// Marca do produto (índigo): badge com calendário + check.
// Cores vêm das CSS vars da marca (theme.js); os fallbacks são o índigo novo.
export default function LogoAO({ size = 28, className = 'brand__logo', title = 'Agendamentos Online' }) {
  return (
    <span {...(className ? { className } : {})} style={{ width: size, height: size }} aria-label={title} role="img">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="aoGradient" x1="12%" y1="10%" x2="88%" y2="90%">
            <stop offset="0%" stopColor="var(--brand, #5049E5)" />
            <stop offset="100%" stopColor="var(--brand-deep, #1E1B4B)" />
          </linearGradient>
          <linearGradient id="aoShine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* Badge arredondado com leve brilho */}
        <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#aoGradient)" />
        <path d="M12 22C14 14 22 10 32 10s18 4 20 12" fill="url(#aoShine)" />

        {/* Ícone de calendário */}
        <g transform="translate(16 18)">
          <rect x="2" y="6" width="28" height="26" rx="7" fill="var(--surface, #ffffff)" />
          <path d="M6 14h20" stroke="rgba(30, 27, 75, 0.14)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="4" r="2" fill="var(--brand-light, #7669ED)" />
          <circle cx="23" cy="4" r="2" fill="var(--brand-light, #7669ED)" />

          {/* Check */}
          <path
            d="M10 23l5.5 5.5L27 17"
            fill="none"
            stroke="var(--brand, #5049E5)"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  );
}
