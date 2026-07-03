import React from 'react';
import StatusPill from '../StatusPill.jsx';

// -----------------------------------------------------------------------------
// StatusBadge é agora um ADAPTADOR fino sobre o StatusPill (fonte única do
// visual em theme.js). O normalizador abaixo é mantido com as CHAVES LEGADAS
// porque ClientAppointmentsPage depende delas na lógica de negócio
// (ex.: effectiveStatus === 'pendente_pagamento' libera "Pagar sinal").
// Não altere estas chaves sem migrar aquela página.
// -----------------------------------------------------------------------------

const PENDING_PAYMENT_STATUSES = new Set([
  'pendente_pagamento',
  'aguardando_pagamento',
  'aguardando pagamento',
  'pending_payment',
  'awaiting_payment',
]);

export function normalizeAppointmentStatus(rawStatus, { isPast = false } = {}) {
  const status = String(rawStatus || '')
    .trim()
    .toLowerCase();

  if (!status) return isPast ? 'concluido' : 'pendente';
  if (PENDING_PAYMENT_STATUSES.has(status)) return 'pendente_pagamento';
  if (status.includes('cancel')) return 'cancelado';
  if (status.includes('conclu')) return 'concluido';
  if (status.includes('confirm')) return isPast ? 'concluido' : 'confirmado';
  if (status.includes('pend') || status.includes('aguard')) return 'pendente';

  return status;
}

// Mantido por compatibilidade de import; o visual real vem do StatusPill/theme.
export function getStatusMeta(status, options) {
  return { normalized: normalizeAppointmentStatus(status, options) };
}

export default function StatusBadge({ status, isPast = false, className = '' }) {
  return <StatusPill status={status} isPast={isPast} size="sm" className={className} />;
}
