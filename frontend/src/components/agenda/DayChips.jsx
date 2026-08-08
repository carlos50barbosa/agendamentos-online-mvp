// src/components/agenda/DayChips.jsx
// Seletor horizontal de dias (chips grandes ≥44px, dia atual destacado).
import React, { useRef, useEffect } from 'react';
import { weekdayShort, dayNumber, monthShort, fullDateLabel, isSameDay, toDate } from '../../utils/agendaDates.js';

// Separador de mês. Os chips mostram só dia da semana e número ("seg 15"), o que basta para
// duas semanas — mas com a janela de agendamento longa a lista passa de 90 dias e "15" deixa
// de dizer de qual mês é. O separador entra sempre que o mês vira, ancorando o bloco seguinte.
// O ano só aparece quando NÃO é o corrente: numa janela de 365 dias a lista atravessa o
// réveillon, e "jan 05" sem ano seria ambíguo justamente onde mais importa.
function MonthDivider({ date, primeiro }) {
  const anoAtual = new Date().getFullYear();
  const rotulo = date.getFullYear() === anoAtual
    ? monthShort(date)
    : `${monthShort(date)}/${String(date.getFullYear()).slice(-2)}`;
  return (
    <div
      aria-hidden="true"
      className="tw-flex tw-shrink-0 tw-items-center"
      style={{
        minHeight: 64,
        paddingLeft: primeiro ? 0 : 8,
        marginLeft: primeiro ? 0 : 4,
        borderLeft: primeiro ? 'none' : '1px solid var(--brand-border, #E7E5F5)',
      }}
    >
      <span
        className="tw-text-[11px] tw-font-bold tw-uppercase tw-tracking-wide"
        style={{ color: 'var(--muted-ink, #6B7280)' }}
      >
        {rotulo}
      </span>
    </div>
  );
}

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
      {days.map((day, idx) => {
        const d = toDate(day);
        const selected = isSameDay(d, selectedDate);
        const isToday = isSameDay(d, today);
        const anterior = idx > 0 ? toDate(days[idx - 1]) : null;
        const viraMes = !anterior
          || anterior.getMonth() !== d.getMonth()
          || anterior.getFullYear() !== d.getFullYear();
        const chip = (
          <button
            key={d ? d.toISOString() : Math.random()}
            ref={selected ? activeRef : null}
            type="button"
            role="tab"
            aria-selected={selected}
            // O rótulo visível é só "seg 15"; quem usa leitor de tela ouviria o mesmo dia
            // repetido a cada mês da lista sem saber distinguir. A data por extenso resolve.
            aria-label={fullDateLabel(d)}
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

        if (!viraMes) return chip;
        return (
          <React.Fragment key={`mes-${d.getFullYear()}-${d.getMonth()}`}>
            <MonthDivider date={d} primeiro={idx === 0} />
            {chip}
          </React.Fragment>
        );
      })}
    </div>
  );
}
