// src/components/agenda/SlotPicker.jsx
// Componente-chave do fluxo de marcação: chips de horário grandes (≥44px),
// agrupados por período (manhã/tarde/noite); ocupados aparecem desabilitados.
import React from 'react';
import { Sunrise, Sun, Moon } from 'lucide-react';
import { groupByPeriod, hourLabel, toDate } from '../../utils/agendaDates.js';
import { iconSizes } from '../../config/theme.js';

const PERIOD_ICON = { manha: Sunrise, tarde: Sun, noite: Moon };

function isSameSlot(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  return Boolean(da && db && da.getTime() === db.getTime());
}

export default function SlotPicker({ slots = [], value, onSelect, emptyLabel = 'Nenhum horário disponível para este dia.', className = '' }) {
  const groups = groupByPeriod(slots, (s) => s.datetime).filter((g) => g.items.length > 0);

  if (!groups.length) {
    return (
      <p className={`tw-m-0 tw-rounded-2xl tw-p-6 tw-text-center tw-text-sm ${className}`} style={{ background: 'var(--surface-soft, #FBFBFE)', color: 'var(--muted-ink, #6B7280)' }}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className={`tw-flex tw-flex-col tw-gap-5 ${className}`}>
      {groups.map((group) => {
        const Icon = PERIOD_ICON[group.key] || Sun;
        return (
          <section key={group.key}>
            <header className="tw-mb-2 tw-flex tw-items-center tw-gap-2" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
              <Icon size={iconSizes.inline} strokeWidth={2} aria-hidden="true" />
              <h3 className="tw-m-0 tw-text-sm tw-font-semibold">{group.label}</h3>
            </header>
            <div
              className="tw-grid tw-gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}
            >
              {group.items.map((slot, i) => {
                const disabled = slot.available === false || slot.disabled === true;
                const selected = value != null && isSameSlot(slot.datetime, value);
                return (
                  <button
                    key={`${group.key}-${i}`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => !disabled && onSelect?.(slot)}
                    className="tw-flex tw-items-center tw-justify-center tw-rounded-xl tw-text-sm tw-font-semibold tw-transition"
                    style={{
                      minHeight: 44,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      border: selected ? '1px solid transparent' : '1px solid var(--brand-border, #E7E5F5)',
                      background: disabled
                        ? 'var(--surface-soft, #F3F3F8)'
                        : selected
                          ? 'var(--brand)'
                          : 'var(--surface, #fff)',
                      color: disabled
                        ? '#B4B1C4'
                        : selected
                          ? '#fff'
                          : 'var(--ink, #1E1B4B)',
                      textDecoration: disabled ? 'line-through' : 'none',
                      opacity: disabled ? 0.75 : 1,
                    }}
                  >
                    {slot.label || hourLabel(slot.datetime)}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
