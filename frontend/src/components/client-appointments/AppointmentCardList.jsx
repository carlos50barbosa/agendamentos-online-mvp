import React from 'react';
import AppointmentCard from './AppointmentCard.jsx';

export default function AppointmentCardList({
  appointments,
  onCancel,
  onDetails,
  onPayDeposit,
  payLoadingId = null,
}) {
  return (
    <div className="md:tw-hidden tw-overflow-hidden tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-shadow-sm">
      {appointments.map((appointment, index) => (
        <div
          key={appointment.id}
          className={index === 0 ? '' : 'tw-border-t tw-border-slate-200'}
        >
          <AppointmentCard
            appointment={appointment}
            onCancel={onCancel}
            onDetails={onDetails}
            onPayDeposit={onPayDeposit}
            payLoading={payLoadingId === appointment.id}
            className="tw-rounded-none tw-border-0 tw-bg-transparent tw-shadow-none"
          />
        </div>
      ))}
    </div>
  );
}
