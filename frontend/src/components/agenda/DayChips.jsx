// src/components/agenda/DayChips.jsx
// Seletor horizontal de dias (chips grandes ≥44px, dia atual destacado).
import React, { useRef, useEffect } from 'react';
import { weekdayShort, dayNumber, isSameDay, toDate } from '../../utils/agendaDates.js';

export default function DayChips({ days = [], selectedDate, onSelect, className = '' }) {
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);
  const today = new Date();

  // Mantém o dia selecionado visível no scroll horizontal.
  useEffect(() => {
    if (activeRef.current && scrollerRef.current) {
      activeRef.current.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [selectedDate]);

  return (
    <div
      ref={scrollerRef}
      className={`tw-flex tw-gap-2 tw-overflow-x-auto tw-pb-1 ${className}`}
      style={{ scrollbarWidth: 'none' }}
      role="tablist"
      aria-label="Selecionar dia"
    >
      {days.map((day) => {
        const d = toDate(day);
        const selected = isSameDay(d, selectedDate);
        const isToday = isSameDay(d, today);
        return (
          <button
            key={d ? d.toISOString() : Math.random()}
            ref={selected ? activeRef : null}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect?.(d)}
            className="tw-flex tw-shrink-0 tw-flex-col tw-items-center tw-justify-center tw-gap-0.5 tw-rounded-xl tw-px-3 tw-transition"
            style={{
              minWidth: 56,
              minHeight: 64,
              border: selected ? '1px solid transparent' : '1px solid var(--brand-border, #E7E5F5)',
              background: selected ? 'var(--brand)' : 'var(--surface, #fff)',
              color: selected ? '#fff' : 'var(--ink, #1E1B4B)',
              boxShadow: selected ? 'var(--shadow-soft, 0 4px 16px -8px rgba(30,27,75,.16))' : 'none',
            }}
          >
            <span
              className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide"
              style={{ opacity: selected ? 0.9 : 0.6 }}
            >
              {weekdayShort(d)}
            </span>
            <span className="tw-text-lg tw-font-bold tw-leading-none">{dayNumber(d)}</span>
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: 9999,
                marginTop: 2,
                background: isToday ? (selected ? '#fff' : 'var(--brand)') : 'transparent',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
