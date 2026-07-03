// src/pages/BookingNovo.jsx
// Demonstração (Fase 1) do fluxo público do cliente final (BookingWizard),
// do serviço ao PixCheckout, com dados mock. A Fase 2 injeta o Asaas em onConfirm.
import React from 'react';
import BookingWizard from '../components/booking/BookingWizard.jsx';
import {
  MOCK_SERVICES,
  MOCK_PROFESSIONALS,
  buildMockSlots,
  mockCreatePixCharge,
} from '../mock/agendaMock.js';

export default function BookingNovo() {
  return (
    <div style={{ background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      <BookingWizard
        establishmentName="Barbearia do Rafael"
        services={MOCK_SERVICES}
        professionals={MOCK_PROFESSIONALS}
        buildSlots={(date, opts) => buildMockSlots(date, opts)}
        onConfirm={mockCreatePixCharge}
      />
    </div>
  );
}
