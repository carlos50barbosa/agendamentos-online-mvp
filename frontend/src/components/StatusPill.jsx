// src/components/StatusPill.jsx
// -----------------------------------------------------------------------------
// FONTE ÚNICA de renderização de status do agendamento (cor + label + ícone).
// Consome o mapa central de theme.js. Reutilizado em cards, tabelas e wizard.
// -----------------------------------------------------------------------------
import React from 'react';
import { Clock, CheckCircle2, CheckCheck, XCircle, UserX } from 'lucide-react';
import { getStatusMeta, normalizeStatus } from '../config/theme.js';

const ICONS = {
  clock: Clock,
  'check-circle': CheckCircle2,
  'check-check': CheckCheck,
  'x-circle': XCircle,
  'user-x': UserX,
};

const SIZES = {
  sm: { padding: '2px 8px', fontSize: 12, icon: 14, gap: 4 },
  md: { padding: '4px 10px', fontSize: 13, icon: 16, gap: 6 },
  lg: { padding: '6px 14px', fontSize: 14, icon: 18, gap: 6 },
};

export default function StatusPill({
  status,
  isPast = false,
  size = 'md',
  showIcon = true,
  className = '',
  style,
}) {
  const meta = getStatusMeta(status, { isPast });
  const Icon = ICONS[meta.icon] || Clock;
  const s = SIZES[size] || SIZES.md;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: s.gap,
        padding: s.padding,
        borderRadius: 9999,
        fontSize: s.fontSize,
        fontWeight: 600,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        background: meta.bg,
        color: meta.fg,
        boxShadow: `inset 0 0 0 1px ${meta.ring}`,
        ...style,
      }}
    >
      {showIcon && <Icon size={s.icon} strokeWidth={2.2} aria-hidden="true" />}
      <span>{meta.label}</span>
    </span>
  );
}

export { normalizeStatus, getStatusMeta };
