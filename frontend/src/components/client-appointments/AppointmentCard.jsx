import React from 'react';
import StatusBadge from './StatusBadge.jsx';
import Button from './Button.jsx';

export default function AppointmentCard({
  appointment,
  onCancel,
  onDetails,
  onPayDeposit,
  payLoading = false,
  className = '',
}) {
  return (
    <article
      className={`tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-4 tw-shadow-sm ${className}`.trim()}
    >
      <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
        <div className="tw-min-w-0 tw-flex-1">
          <h3 className="tw-m-0 tw-text-sm tw-font-semibold tw-text-slate-900 tw-break-words">{appointment.serviceLabel}</h3>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-slate-500 tw-break-words">{appointment.establishmentLabel}</p>
        </div>
        <StatusBadge status={appointment.effectiveStatus} className="tw-max-w-full tw-shrink-0" />
      </header>

      <p className="tw-m-0 tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-text-slate-700">
        <span className="tw-inline-flex tw-h-5 tw-w-5 tw-items-center tw-justify-center tw-rounded-full tw-bg-slate-100 tw-text-slate-600" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="tw-h-3.5 tw-w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3.5" y="5.5" width="17" height="15" rx="3" />
            <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" />
          </svg>
        </span>
        <span className="tw-inline-flex tw-h-5 tw-w-5 tw-items-center tw-justify-center tw-rounded-full tw-bg-slate-100 tw-text-slate-600" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="tw-h-3.5 tw-w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5v5l3 1.8" />
          </svg>
        </span>
        {appointment.whenLabel}
      </p>

      <div className="tw-mt-4 tw-grid tw-grid-cols-1 tw-gap-2 sm:tw-grid-cols-2">
        <Button
          variant="secondaryOutline"
          className="tw-w-full tw-min-w-0 tw-whitespace-normal tw-rounded-lg tw-px-3 tw-py-1.5"
          onClick={() => onDetails?.(appointment)}
          aria-label={`Ver detalhes de ${appointment.serviceLabel}`}
        >
          Detalhes
        </Button>

        {appointment.canCancel && (
          <Button
            variant="dangerOutline"
            className="tw-w-full tw-min-w-0 tw-whitespace-normal tw-rounded-lg tw-px-3 tw-py-1.5"
            onClick={() => onCancel?.(appointment)}
            aria-label={`Cancelar agendamento de ${appointment.serviceLabel}`}
          >
            Cancelar
          </Button>
        )}

        {appointment.canPayDeposit && (
          <Button
            variant="warning"
            className="tw-w-full tw-min-w-0 tw-whitespace-normal tw-rounded-lg tw-px-3 tw-py-1.5"
            onClick={() => onPayDeposit?.(appointment)}
            disabled={payLoading}
            aria-label={`Pagar sinal de ${appointment.serviceLabel}`}
          >
            {payLoading ? 'Carregando...' : 'Pagar sinal'}
          </Button>
        )}
      </div>
    </article>
  );
}
