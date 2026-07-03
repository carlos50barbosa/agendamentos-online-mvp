// src/utils/agendaDates.js
// Helpers de data para a agenda (date-fns + locale pt-BR).
import {
  format,
  addDays,
  startOfWeek,
  startOfDay,
  isSameDay as dfnsIsSameDay,
  getHours,
  differenceInMinutes,
  parseISO,
  isValid,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { site } from '../config/site.js';

const FMT = { locale: ptBR };

/** Converte string ISO / Date / número em Date válido (ou null). */
export function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isValid(d) ? d : null;
  }
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseISO(`${s}T00:00:00`) : parseISO(s);
  if (isValid(d)) return d;
  const fallback = new Date(s);
  return isValid(fallback) ? fallback : null;
}

export function isSameDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  return Boolean(da && db && dfnsIsSameDay(da, db));
}

/** Semana (7 dias) a partir da segunda-feira que contém `anchor`. */
export function buildWeekDays(anchor = new Date(), { weekStartsOn = 1 } = {}) {
  const base = startOfWeek(toDate(anchor) || new Date(), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
}

/** N dias consecutivos a partir de `anchor` (inclusive). */
export function buildDayRange(anchor = new Date(), count = 14) {
  const base = startOfDay(toDate(anchor) || new Date());
  return Array.from({ length: count }, (_, i) => addDays(base, i));
}

export function weekdayShort(date) {
  const d = toDate(date);
  return d ? format(d, 'EEE', FMT).replace('.', '') : '';
}

export function dayNumber(date) {
  const d = toDate(date);
  return d ? format(d, 'd', FMT) : '';
}

export function monthShort(date) {
  const d = toDate(date);
  return d ? format(d, 'MMM', FMT).replace('.', '') : '';
}

export function fullDateLabel(date) {
  const d = toDate(date);
  return d ? format(d, "EEEE, d 'de' MMMM", FMT) : '';
}

export function hourLabel(date) {
  const d = toDate(date);
  return d ? format(d, 'HH:mm', FMT) : '';
}

/** Duração legível a partir de inicio/fim (ou minutos). */
export function durationLabel({ inicio, fim, minutes } = {}) {
  let mins = minutes;
  if (mins == null) {
    const a = toDate(inicio);
    const b = toDate(fim);
    if (a && b) mins = Math.max(0, differenceInMinutes(b, a));
  }
  if (mins == null || Number.isNaN(mins)) return '';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Chave do período (manha/tarde/noite) para uma data/hora. */
export function periodOf(date) {
  const d = toDate(date);
  const hour = d ? getHours(d) : 0;
  const found = site.dayPeriods.find((p) => hour >= p.startHour && hour < p.endHour);
  return (found || site.dayPeriods[0]).key;
}

/** Agrupa itens (com getter de data) pelos períodos definidos em site.js. */
export function groupByPeriod(items, getDate) {
  const groups = site.dayPeriods.map((p) => ({ ...p, items: [] }));
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const item of items || []) {
    const key = periodOf(getDate(item));
    (byKey[key] || groups[0]).items.push(item);
  }
  return groups;
}
