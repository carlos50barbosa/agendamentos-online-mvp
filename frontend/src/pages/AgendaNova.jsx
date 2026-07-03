// src/pages/AgendaNova.jsx
// Demonstração (Fase 1) do painel do negócio com a agenda como elemento central.
// Mobile: lista por seções (manhã/tarde/noite). Desktop: calendário + detalhes.
// Usa dados mock; a integração com o backend fica para a migração gradual.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgendaView from '../components/agenda/AgendaView.jsx';
import BottomNav from '../components/agenda/BottomNav.jsx';
import { buildMockAppointments } from '../mock/agendaMock.js';

export default function AgendaNova() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const appointments = useMemo(() => buildMockAppointments(new Date()), []);

  return (
    <div style={{ background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      <div
        className="tw-mx-auto tw-w-full tw-max-w-6xl tw-p-4"
        style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      >
        <AgendaView
          appointments={appointments}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onNewAppointment={() => navigate('/agendar')}
        />
      </div>
      <BottomNav />
    </div>
  );
}
