import React from 'react';
import StatusBadge from './StatusBadge.jsx';
import Button from './Button.jsx';

export default function AppointmentTable({
  appointments,
  onCancel,
  onDetails,
  onPayDeposit,
  payLoadingId = null,
}) {
  return (
    <div className="tw-hidden tw-overflow-hidden tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-shadow-sm md:tw-block">
      <table className="tw-min-w-full tw-border-separate tw-border-spacing-0">
        <thead className="tw-bg-slate-50">
          <tr>
            <th className="tw-border-b tw-border-slate-200 tw-px-4 tw-py-3 tw-text-left tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-600">
              Serviço
            </th>
            <th className="tw-border-b tw-border-slate-200 tw-px-4 tw-py-3 tw-text-left tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-600">
              Data/Hora
            </th>
            <th className="tw-border-b tw-border-slate-200 tw-px-4 tw-py-3 tw-text-left tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-600">
              Status
            </th>
            <th className="tw-border-b tw-border-slate-200 tw-px-4 tw-py-3 tw-text-right tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-600">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((appointment, index) => (
            <tr
              key={appointment.id}
              className={`${index % 2 === 1 ? 'tw-bg-slate-50/40' : 'tw-bg-white'} hover:tw-bg-slate-50`}
            >
              <td className="tw-border-b tw-border-slate-100 tw-px-4 tw-py-4">
                <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-slate-900">{appointment.serviceLabel}</p>
                <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-slate-500">{appointment.establishmentLabel}</p>
              </td>
              <td className="tw-border-b tw-border-slate-100 tw-px-4 tw-py-4 tw-text-sm tw-text-slate-700">
                <span className="tw-inline-flex tw-items-center tw-gap-2">
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
                </span>
              </td>
              <td className="tw-border-b tw-border-slate-100 tw-px-4 tw-py-4">
                <StatusBadge status={appointment.effectiveStatus} />
              </td>
              <td className="tw-border-b tw-border-slate-100 tw-px-4 tw-py-4">
                <div className="tw-flex tw-justify-end tw-gap-2">
                  <Button
                    variant="secondaryOutline"
                    className="tw-rounded-lg tw-px-3 tw-py-1.5"
                    onClick={() => onDetails?.(appointment)}
                    aria-label={`Ver detalhes de ${appointment.serviceLabel}`}
                  >
                    Detalhes
                  </Button>

                  {appointment.canCancel && (
                    <Button
                      variant="dangerOutline"
                      className="tw-rounded-lg tw-px-3 tw-py-1.5"
                      onClick={() => onCancel?.(appointment)}
                      aria-label={`Cancelar agendamento de ${appointment.serviceLabel}`}
                    >
                      Cancelar
                    </Button>
                  )}

                  {appointment.canPayDeposit && (
                    <Button
                      variant="warning"
                      className="tw-rounded-lg tw-px-3 tw-py-1.5"
                      onClick={() => onPayDeposit?.(appointment)}
                      disabled={payLoadingId === appointment.id}
                      aria-label={`Pagar sinal de ${appointment.serviceLabel}`}
                    >
                      {payLoadingId === appointment.id ? 'Carregando...' : 'Pagar sinal'}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
