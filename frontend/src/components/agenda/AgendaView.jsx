// src/components/agenda/AgendaView.jsx
// Orquestra a visão de agenda.
//  - Mobile: lista/agenda por seções (manhã/tarde/noite) — NUNCA grade mensal.
//  - Desktop: react-big-calendar (dia/semana) + painel lateral de detalhes.
import React, { useEffect, useMemo, useState } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { CalendarDays, Plus, MessageCircle } from 'lucide-react';
import DayChips from './DayChips.jsx';
import AppointmentCard from './AppointmentCard.jsx';
import StatusPill from '../StatusPill.jsx';
import {
  buildWeekDays,
  groupByPeriod,
  isSameDay,
  toDate,
  fullDateLabel,
  hourLabel,
  durationLabel,
} from '../../utils/agendaDates.js';
import { iconSizes } from '../../config/theme.js';
import { waLink, waMessage, site } from '../../config/site.js';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { 'pt-BR': ptBR },
});

const CALENDAR_MESSAGES = {
  week: 'Semana',
  day: 'Dia',
  today: 'Hoje',
  previous: 'Anterior',
  next: 'Próximo',
  noEventsInRange: 'Sem agendamentos neste período.',
};

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

function endOf(appt) {
  const end = toDate(appt.fim);
  if (end) return end;
  const start = toDate(appt.inicio);
  return start ? addMinutes(start, appt.durationMin || 30) : new Date();
}

export default function AgendaView({
  appointments = [],
  selectedDate,
  onSelectDate,
  onNewAppointment,
  onSelectAppointment,
  headerRight = null,
}) {
  const isDesktop = useIsDesktop();
  const days = useMemo(() => buildWeekDays(selectedDate || new Date()), [selectedDate]);
  const [selectedAppt, setSelectedAppt] = useState(null);

  const dayAppointments = useMemo(
    () =>
      appointments
        .filter((a) => isSameDay(a.inicio, selectedDate))
        .sort((a, b) => (toDate(a.inicio)?.getTime() || 0) - (toDate(b.inicio)?.getTime() || 0)),
    [appointments, selectedDate],
  );

  const groups = useMemo(
    () => groupByPeriod(dayAppointments, (a) => a.inicio).filter((g) => g.items.length),
    [dayAppointments],
  );

  const events = useMemo(
    () =>
      appointments
        .map((a) => {
          const start = toDate(a.inicio);
          if (!start) return null;
          return {
            id: a.id,
            title: `${hourLabel(a.inicio)} · ${a.clientName || 'Cliente'}`,
            start,
            end: endOf(a),
            resource: a,
          };
        })
        .filter(Boolean),
    [appointments],
  );

  const handleSelectAppt = (appt) => {
    setSelectedAppt(appt);
    onSelectAppointment?.(appt);
  };

  const NewButton = (
    <button
      type="button"
      onClick={() => onNewAppointment?.()}
      className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-xl tw-px-4 tw-font-semibold tw-text-white"
      style={{ minHeight: 44, background: 'var(--brand)' }}
    >
      <Plus size={iconSizes.inline} strokeWidth={2.4} aria-hidden="true" />
      Novo agendamento
    </button>
  );

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {/* Cabeçalho: data atual + slot à direita (avatar/ações) */}
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-3">
        <div className="tw-flex tw-items-center tw-gap-2" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
          <CalendarDays size={iconSizes.nav} strokeWidth={2} aria-hidden="true" />
          <div>
            <p className="tw-m-0 tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>
              Agenda
            </p>
            <h2 className="tw-m-0 tw-text-base tw-font-bold tw-capitalize sm:tw-text-lg">
              {fullDateLabel(selectedDate || new Date())}
            </h2>
          </div>
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <div className="tw-hidden lg:tw-block">{NewButton}</div>
          {headerRight}
        </div>
      </header>

      {isDesktop ? (
        /* ---------- Desktop: calendário + painel de detalhes ---------- */
        <div className="tw-grid tw-gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
          <div
            className="tw-rounded-2xl tw-p-3"
            style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', height: 640 }}
          >
            <BigCalendar
              localizer={localizer}
              culture="pt-BR"
              events={events}
              startAccessor="start"
              endAccessor="end"
              defaultView={Views.WEEK}
              views={[Views.WEEK, Views.DAY]}
              messages={CALENDAR_MESSAGES}
              date={toDate(selectedDate) || new Date()}
              onNavigate={(d) => onSelectDate?.(d)}
              onSelectEvent={(ev) => handleSelectAppt(ev.resource)}
              style={{ height: '100%' }}
            />
          </div>
          <AppointmentDetails appointment={selectedAppt} />
        </div>
      ) : (
        /* ---------- Mobile: chips de dia + seções por período ---------- */
        <>
          <DayChips days={days} selectedDate={selectedDate} onSelect={onSelectDate} />

          {groups.length === 0 ? (
            <div
              className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-rounded-2xl tw-p-8 tw-text-center"
              style={{ background: 'var(--surface-soft, #FBFBFE)', border: '1px dashed var(--brand-border, #E7E5F5)' }}
            >
              <CalendarDays size={32} strokeWidth={1.6} aria-hidden="true" style={{ color: 'var(--brand-200, #D7D4F7)' }} />
              <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                Nenhum agendamento para este dia.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="tw-flex tw-flex-col tw-gap-2">
                <h3 className="tw-m-0 tw-text-xs tw-font-bold tw-uppercase tw-tracking-wide" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  {group.label}
                </h3>
                {group.items.map((appt) => (
                  <AppointmentCard key={appt.id} appointment={appt} onClick={handleSelectAppt} />
                ))}
              </section>
            ))
          )}

          <div className="tw-mt-2">{NewButton}</div>
        </>
      )}
    </div>
  );
}

function AppointmentDetails({ appointment }) {
  if (!appointment) {
    return (
      <aside
        className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-2 tw-rounded-2xl tw-p-6 tw-text-center"
        style={{ background: 'var(--surface-soft, #FBFBFE)', border: '1px solid var(--brand-border, #E7E5F5)' }}
      >
        <CalendarDays size={32} strokeWidth={1.6} aria-hidden="true" style={{ color: 'var(--brand-200, #D7D4F7)' }} />
        <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
          Selecione um agendamento no calendário para ver os detalhes.
        </p>
      </aside>
    );
  }

  const waHref = appointment.phone
    ? waLink(appointment.phone, waMessage(site.whatsapp.defaultMessage, { estabelecimento: appointment.clientName || '' }))
    : null;

  return (
    <aside
      className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4"
      style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
    >
      <div className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
        <span className="tw-text-2xl tw-font-extrabold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
          {hourLabel(appointment.inicio)}
        </span>
        <StatusPill status={appointment.status} size="md" />
      </div>
      <p className="tw-m-0 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
        {durationLabel({ inicio: appointment.inicio, fim: appointment.fim, minutes: appointment.durationMin })}
      </p>
      <div>
        <h3 className="tw-m-0 tw-text-base tw-font-bold" style={{ color: 'var(--ink, #1E1B4B)' }}>
          {appointment.clientName || 'Cliente'}
        </h3>
        <p className="tw-m-0 tw-mt-1 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
          {appointment.serviceName || 'Serviço'}
          {appointment.professionalName ? ` · ${appointment.professionalName}` : ''}
        </p>
      </div>
      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="tw-inline-flex tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-font-semibold tw-text-white"
          style={{ minHeight: 44, background: 'var(--wa-green, #25D366)' }}
        >
          <MessageCircle size={iconSizes.inline} strokeWidth={2} aria-hidden="true" />
          WhatsApp
        </a>
      )}
    </aside>
  );
}
