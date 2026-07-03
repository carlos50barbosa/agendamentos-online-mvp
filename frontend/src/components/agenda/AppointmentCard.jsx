// src/components/agenda/AppointmentCard.jsx
// Card de agendamento do painel do negócio: horário em DESTAQUE + duração,
// cliente, serviço, StatusPill e ação rápida de WhatsApp.
import React from 'react';
import { MessageCircle, User, Scissors } from 'lucide-react';
import StatusPill from '../StatusPill.jsx';
import { hourLabel, durationLabel } from '../../utils/agendaDates.js';
import { iconSizes } from '../../config/theme.js';
import { waLink, waMessage, site } from '../../config/site.js';

export default function AppointmentCard({ appointment, onClick, className = '' }) {
  const {
    inicio,
    fim,
    durationMin,
    clientName,
    serviceName,
    professionalName,
    status,
    phone,
  } = appointment || {};

  const time = hourLabel(inicio);
  const dur = durationLabel({ inicio, fim, minutes: durationMin });
  const waHref = phone
    ? waLink(phone, waMessage(site.whatsapp.defaultMessage, { estabelecimento: clientName || '' }))
    : null;

  const clickable = typeof onClick === 'function';

  return (
    <article
      onClick={clickable ? () => onClick(appointment) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(appointment) : undefined}
      className={`tw-flex tw-items-stretch tw-gap-3 tw-rounded-2xl tw-p-3 sm:tw-p-4 ${className}`}
      style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--brand-border, #E7E5F5)',
        boxShadow: 'var(--shadow-soft, 0 4px 16px -8px rgba(30,27,75,.16))',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* Coluna do horário — sempre em destaque */}
      <div
        className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-rounded-xl tw-px-3 tw-py-2"
        style={{ background: 'var(--brand-100, #EEEDFC)', minWidth: 72 }}
      >
        <span className="tw-text-xl tw-font-extrabold tw-leading-none" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
          {time}
        </span>
        {dur && (
          <span className="tw-mt-1 tw-text-[11px] tw-font-medium" style={{ color: 'var(--brand)' }}>
            {dur}
          </span>
        )}
      </div>

      {/* Corpo — cliente, serviço, status */}
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-flex tw-items-center tw-gap-1.5" style={{ color: 'var(--ink, #1E1B4B)' }}>
          <User size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }} />
          <h3 className="tw-m-0 tw-truncate tw-text-sm tw-font-semibold">{clientName || 'Cliente'}</h3>
        </div>
        <div className="tw-mt-1 tw-flex tw-items-center tw-gap-1.5" style={{ color: 'var(--muted-ink, #6B7280)' }}>
          <Scissors size={14} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
          <p className="tw-m-0 tw-truncate tw-text-xs">
            {serviceName || 'Serviço'}
            {professionalName ? ` · ${professionalName}` : ''}
          </p>
        </div>
        <div className="tw-mt-2">
          <StatusPill status={status} size="sm" />
        </div>
      </div>

      {/* Ação rápida de WhatsApp */}
      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Falar com ${clientName || 'cliente'} no WhatsApp`}
          className="tw-flex tw-items-center tw-justify-center tw-self-center tw-rounded-xl"
          style={{ minWidth: 44, minHeight: 44, background: 'var(--wa-green, #25D366)', color: '#fff' }}
        >
          <MessageCircle size={iconSizes.nav} strokeWidth={2} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}
