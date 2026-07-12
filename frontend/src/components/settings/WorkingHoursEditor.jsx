// src/components/settings/WorkingHoursEditor.jsx
// Editor de horários de funcionamento por dia da semana. Controlado: o pai detém o array
// `days` e recebe `onChange`. Faz round-trip com o contrato do backend (parseHorarios /
// sanitizeHorariosInput): dias com slug `monday`..`sunday`, opcional bloco de pausa.
import React from 'react';

export const WEEKDAYS = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

function emptyDay(key, label) {
  return { key, label, enabled: false, start: '09:00', end: '18:00', hasBreak: false, breakStart: '12:00', breakEnd: '13:00' };
}

// Backend `horarios` (entradas com slug de dia) -> estado de 7 dias do editor.
export function daysFromHorarios(horarios) {
  const byDay = {};
  (Array.isArray(horarios) ? horarios : []).forEach((h) => {
    if (h && h.day) byDay[h.day] = h;
  });
  return WEEKDAYS.map(({ key, label }) => {
    const h = byDay[key];
    if (!h) return emptyDay(key, label);
    const block = Array.isArray(h.blocks) && h.blocks[0] ? h.blocks[0] : null;
    return {
      key,
      label,
      enabled: true,
      start: h.start || '09:00',
      end: h.end || '18:00',
      hasBreak: Boolean(block),
      breakStart: block?.start || '12:00',
      breakEnd: block?.end || '13:00',
    };
  });
}

// Estado do editor -> array `horarios` do backend (só dias abertos).
export function horariosFromDays(days) {
  return (days || [])
    .filter((d) => d.enabled)
    .map((d) => {
      const entry = { day: d.key, label: d.label, start: d.start, end: d.end, value: `${d.start} - ${d.end}` };
      if (d.hasBreak && d.breakStart && d.breakEnd) {
        entry.blocks = [{ start: d.breakStart, end: d.breakEnd }];
        entry.value = `${d.start} - ${d.breakStart}, ${d.breakEnd} - ${d.end}`;
      }
      return entry;
    });
}

// Validação por dia. Retorna { [dayKey]: mensagem }.
export function validateDays(days) {
  const errors = {};
  (days || []).forEach((d) => {
    if (!d.enabled) return;
    if (!d.start || !d.end) { errors[d.key] = 'Informe abertura e fechamento.'; return; }
    if (d.start >= d.end) { errors[d.key] = 'O fechamento deve ser depois da abertura.'; return; }
    if (d.hasBreak) {
      if (!d.breakStart || !d.breakEnd) { errors[d.key] = 'Informe o intervalo de pausa.'; return; }
      if (d.breakStart >= d.breakEnd) { errors[d.key] = 'Pausa: o fim deve ser depois do início.'; return; }
      if (d.breakStart < d.start || d.breakEnd > d.end) { errors[d.key] = 'A pausa deve ficar dentro do horário.'; return; }
    }
  });
  return errors;
}

const PRESETS = [
  { id: 'business', label: 'Comercial (Seg–Sex)' },
  { id: 'everyday', label: 'Todos os dias 9h–18h' },
  { id: 'noSunday', label: 'Fechar domingo' },
  { id: 'noBreak', label: 'Sem intervalo' },
];

export default function WorkingHoursEditor({ days, onChange, errors = {} }) {
  const patch = (key, partial) => onChange(days.map((d) => (d.key === key ? { ...d, ...partial } : d)));

  const applyPreset = (id) => {
    onChange(days.map((d) => {
      const isWeekday = d.key !== 'saturday' && d.key !== 'sunday';
      if (id === 'business') return { ...d, enabled: isWeekday, start: '09:00', end: '18:00' };
      if (id === 'everyday') return { ...d, enabled: true, start: '09:00', end: '18:00' };
      if (id === 'noSunday') return d.key === 'sunday' ? { ...d, enabled: false } : d;
      if (id === 'noBreak') return { ...d, hasBreak: false };
      return d;
    }));
  };

  const copyToOpen = (src) => {
    onChange(days.map((d) => (d.enabled
      ? { ...d, start: src.start, end: src.end, hasBreak: src.hasBreak, breakStart: src.breakStart, breakEnd: src.breakEnd }
      : d)));
  };

  const activeCount = days.filter((d) => d.enabled).length;

  return (
    <div className="set-hours">
      <div className="set-hours__presets" role="group" aria-label="Atalhos de horário">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="btn btn--outline btn--sm" onClick={() => applyPreset(p.id)}>{p.label}</button>
        ))}
      </div>
      <p className="set-hours__meta muted">{activeCount === 1 ? '1 dia aberto' : `${activeCount} dias abertos`}</p>
      <div className="set-hours__grid">
        {days.map((d, idx) => (
          <div key={d.key} className={`set-hours__row${d.enabled ? ' is-open' : ''}${errors[d.key] ? ' is-invalid' : ''}`}>
            <label className="set-hours__day">
              <input type="checkbox" checked={d.enabled} onChange={(e) => patch(d.key, { enabled: e.target.checked })} />
              <span>{d.label}</span>
              <em className={`set-hours__badge ${d.enabled ? 'open' : 'closed'}`}>{d.enabled ? 'Aberto' : 'Fechado'}</em>
            </label>
            {d.enabled && (
              <div className="set-hours__body">
                <div className="set-hours__times">
                  <input type="time" className="input" value={d.start} onChange={(e) => patch(d.key, { start: e.target.value })} aria-label={`Abertura ${d.label}`} />
                  <span className="set-hours__sep">às</span>
                  <input type="time" className="input" value={d.end} onChange={(e) => patch(d.key, { end: e.target.value })} aria-label={`Fechamento ${d.label}`} />
                </div>
                <label className="set-hours__break-toggle">
                  <input type="checkbox" checked={d.hasBreak} onChange={(e) => patch(d.key, { hasBreak: e.target.checked })} />
                  <span>Intervalo</span>
                </label>
                {d.hasBreak && (
                  <div className="set-hours__times">
                    <input type="time" className="input" value={d.breakStart} onChange={(e) => patch(d.key, { breakStart: e.target.value })} aria-label={`Início da pausa ${d.label}`} />
                    <span className="set-hours__sep">às</span>
                    <input type="time" className="input" value={d.breakEnd} onChange={(e) => patch(d.key, { breakEnd: e.target.value })} aria-label={`Fim da pausa ${d.label}`} />
                  </div>
                )}
                {idx === 0 && activeCount > 1 && (
                  <button type="button" className="set-hours__copy" onClick={() => copyToOpen(d)}>Aplicar a todos os dias abertos</button>
                )}
              </div>
            )}
            {errors[d.key] && <p className="set-hours__issue" role="alert">{errors[d.key]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
