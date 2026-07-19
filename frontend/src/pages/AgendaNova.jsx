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
      {/* Sem paddingBottom próprio: o .app-main já compensa a barra inferior
          via --mobile-nav-h. Esta tela compensava sozinha porque a variável
          estava zerada no mobile; agora que ela vale a altura real, manter os
          88px daqui somaria duas vezes e abriria um vão no fim da lista. */}
      <div className="tw-mx-auto tw-w-full tw-max-w-6xl tw-p-4">
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
