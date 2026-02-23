import React from 'react';
import { IconPlus } from '../Icons.jsx';
import Button from './Button.jsx';

export default function EmptyState({
  title = 'Você ainda não tem agendamentos',
  description = 'Quando você agendar um horário, ele aparecerá aqui com todos os status e ações.',
  ctaLabel = 'Agendar agora',
  onCta,
}) {
  return (
    <div className="tw-rounded-2xl tw-border tw-border-dashed tw-border-slate-200 tw-bg-white tw-px-6 tw-py-10 tw-text-center tw-shadow-sm">
      <div className="tw-mx-auto tw-flex tw-h-14 tw-w-14 tw-items-center tw-justify-center tw-rounded-full tw-bg-indigo-50 tw-text-indigo-600">
        <svg viewBox="0 0 24 24" className="tw-h-7 tw-w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3.5" y="5.5" width="17" height="15" rx="3" />
          <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" />
        </svg>
      </div>
      <h3 className="tw-mt-4 tw-text-lg tw-font-semibold tw-text-slate-900">{title}</h3>
      <p className="tw-mx-auto tw-mt-2 tw-max-w-md tw-text-sm tw-leading-relaxed tw-text-slate-600">{description}</p>
      <Button variant="primary" className="tw-mt-6" onClick={onCta}>
        <IconPlus className="tw-h-4 tw-w-4" aria-hidden="true" />
        {ctaLabel}
      </Button>
    </div>
  );
}
