import React from 'react';

const PENDING_PAYMENT_STATUSES = new Set([
  'pendente_pagamento',
  'aguardando_pagamento',
  'aguardando pagamento',
  'pending_payment',
  'awaiting_payment',
]);

const STATUS_META = {
  confirmado: {
    label: 'Confirmado',
    className: 'tw-bg-emerald-50 tw-text-emerald-700 tw-ring-1 tw-ring-inset tw-ring-emerald-200',
  },
  concluido: {
    label: 'Concluído',
    className: 'tw-bg-sky-50 tw-text-sky-700 tw-ring-1 tw-ring-inset tw-ring-sky-200',
  },
  cancelado: {
    label: 'Cancelado',
    className: 'tw-bg-rose-50 tw-text-rose-700 tw-ring-1 tw-ring-inset tw-ring-rose-200',
  },
  pendente: {
    label: 'Pendente',
    className: 'tw-bg-amber-50 tw-text-amber-800 tw-ring-1 tw-ring-inset tw-ring-amber-200',
  },
  pendente_pagamento: {
    label: 'Aguardando pagamento',
    className: 'tw-bg-amber-50 tw-text-amber-800 tw-ring-1 tw-ring-inset tw-ring-amber-200',
  },
};

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

export function getStatusMeta(status, options) {
  const normalized = normalizeAppointmentStatus(status, options);
  return STATUS_META[normalized] || STATUS_META.pendente;
}

export default function StatusBadge({ status, isPast = false, className = '' }) {
  const normalized = normalizeAppointmentStatus(status, { isPast });
  const meta = STATUS_META[normalized] || STATUS_META.pendente;

  return (
    <span
      className={`tw-inline-flex tw-items-center tw-rounded-full tw-px-3 tw-py-1 tw-text-xs tw-font-medium ${meta.className} ${className}`}
    >
      {meta.label}
    </span>
  );
}
