import { EST_TZ_OFFSET_MIN, minutesOfDayInTZ, weekDayIndexInTZ } from './datetime_tz.js';
const DAY_MINUTES = 24 * 60;
export const DEFAULT_ABRE = '07:00';
export const DEFAULT_FECHA = '22:00';
const DAY_SLUG_TO_INDEX = Object.freeze({
sunday: 0, sundayfeira: 0, sun: 0, domingo: 0, domingofeira: 0, dom: 0, monday: 1, mondayfeira: 1, mon: 1, segunda: 1, segundafeira: 1, seg: 1, tuesday: 2, tuesdayfeira: 2, tue: 2, terca: 2, tercafeira: 2, ter: 2, wednesday: 3, wednesdayfeira: 3, wed: 3, quarta: 3, quartafeira: 3, qua: 3, thursday: 4, thursdayfeira: 4, thu: 4, quinta: 4, quintafeira: 4, qui: 4, friday: 5, fridayfeira: 5, fri: 5, sexta: 5, sextafeira: 5, sex: 5, saturday: 6, saturdayfeira: 6, sat: 6, sabado: 6, sabadofeira: 6, sab: 6, });
const normalizeDayKey = (value) => {
if (!value && value !== 0) return '';
return String(value) .normalize('NFD') .replace(/[\u0300-\u036f]/g, '') .toLowerCase() .replace(/[^a-z]/g, '');
};
const resolveDayIndex = (item) => {
if (!item || typeof item !== 'object') return null;
const candidates = [ item.day, item.key, item.weekday, item.week_day, item.dia, item.label, ];
if (item.value) {
candidates.push(item.value);
const firstChunk = String(item.value).split(/[\s,;-]+/)[0];
candidates.push(firstChunk);
}

  for (const candidate of candidates) {
const normalized = normalizeDayKey(candidate);
if (!normalized) continue;
if (Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, normalized)) {
return DAY_SLUG_TO_INDEX[normalized];
}
  }
return null;
};
const ensureTimeValue = (value) => {
if (!value && value !== 0) return null;
const text = String(value).trim();
if (!text) return null;
const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
const digits = text.replace(/\D/g, '');
if (!digits) return null;
if (digits.length <= 2) {
const hours = Number(digits);
if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
return `${String(hours).padStart(2, '0')}:00`;
}
  const hoursDigits = digits.slice(0, -2);
const minutesDigits = digits.slice(-2);
const hoursNum = Number(hoursDigits);
const minutesNum = Number(minutesDigits);
if ( !Number.isInteger(hoursNum) || hoursNum < 0 || hoursNum > 23 || !Number.isInteger(minutesNum) || minutesNum < 0 || minutesNum > 59 ) {
return null;
}
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
};
export const toMin = (time) => {
if (!time && time !== 0) return null;
const text = String(time);
if (!text) return null;
const parts = text.split(':');
if (parts.length !== 2) return null;
const hours = Number(parts[0]);
const minutes = Number(parts[1]);
if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
return hours * 60 + minutes;
};
export const fmtMin = (min) => {
if (!Number.isFinite(min)) return null;
const safe = ((min % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
const hours = Math.floor(safe / 60);
const minutes = safe % 60;
return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};
const isClosedValue = (value) => {
const valueText = String(value || '').toLowerCase();
return ( valueText.includes('fechado') || valueText.includes('sem atendimento') || valueText.includes('nao atende') );
};
const isBreakWithinWindow = (blockStart, blockEnd, startMinutes, endMinutes, overnight) => {
if (!overnight) {
return blockStart >= startMinutes && blockEnd <= endMinutes;
}
  const inLate = blockStart >= startMinutes && blockEnd <= DAY_MINUTES;
const inEarly = blockStart >= 0 && blockEnd <= endMinutes;
return inLate || inEarly;
};
export const buildWorkingRules = (horariosJson) => {
if (!horariosJson) return null;
let entries;
try {
entries = JSON.parse(horariosJson);
} catch {
return null;
}
  if (!Array.isArray(entries) || !entries.length) return null;
const rules = Array.from({ length: 7 }, () => ({
enabled: false, startMinutes: null, endMinutes: null, breaks: [], }));
let recognized = false;
entries.forEach((item) => {
if (!item || typeof item !== 'object') return;
const idx = resolveDayIndex(item);
if (idx == null) return;
if (rules[idx].processed) return;
if (isClosedValue(item.value)) {
rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
recognized = true;
return;
}

    const start = ensureTimeValue(item.start || item.begin || item.from ?? null);
const end = ensureTimeValue(item.end || item.finish || item.to ?? null);
if (!start || !end) {
rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
recognized = true;
return;
}
    const startMinutes = toMin(start);
const endMinutes = toMin(end);
if ( startMinutes == null || endMinutes == null || startMinutes === endMinutes ) {
rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
recognized = true;
return;
}
    const overnight = startMinutes > endMinutes;
const rawBlocks = Array.isArray(item.blocks) ? item.blocks : Array.isArray(item.breaks) ? item.breaks : [];
const breaks = [];
rawBlocks.forEach((block) => {
if (!block) return;
const blockStart = ensureTimeValue(block.start || block.begin || block.from ?? null);
const blockEnd = ensureTimeValue(block.end || block.finish || block.to ?? null);
const blockStartMinutes = toMin(blockStart);
const blockEndMinutes = toMin(blockEnd);
if ( blockStartMinutes == null || blockEndMinutes == null || blockStartMinutes >= blockEndMinutes ) {
return;
}
      if (!isBreakWithinWindow(blockStartMinutes, blockEndMinutes, startMinutes, endMinutes, overnight)) {
return;
}
      breaks.push([blockStartMinutes, blockEndMinutes]);
});
rules[idx] = {
enabled: true, startMinutes, endMinutes, breaks, processed: true, };
recognized = true;
});
if (!recognized) return null;
return rules.map((rule) => {
if (!rule.processed) {
return { enabled: false, startMinutes: null, endMinutes: null, breaks: [] };
}
    const { processed, ...rest } = rule;
return rest;
});
};
export const resolveExpedienteForDay = (workingRules, dayIndex) => {
if (!Array.isArray(workingRules)) {
const startMinutes = toMin(DEFAULT_ABRE);
const endMinutes = toMin(DEFAULT_FECHA);
return {
abre: DEFAULT_ABRE, fecha: DEFAULT_FECHA, startMinutes, endMinutes, breaks: [], closed: false, source: 'fallback', };
} const rule = dayIndex != null || workingRules[dayIndex] : null;
if (!rule || rule.enabled === false) {
return {
abre: null, fecha: null, startMinutes: null, endMinutes: null, breaks: [], closed: true, source: 'profile', };
}
  return {
abre: fmtMin(rule.startMinutes), fecha: fmtMin(rule.endMinutes), startMinutes: rule.startMinutes, endMinutes: rule.endMinutes, breaks: Array.isArray(rule.breaks) ? rule.breaks : [], closed: false, source: 'profile', };
};
export const getExpediente = async ({ db, estabelecimentoId, dateUtc }) => {
let horariosJson = null;
if (db && estabelecimentoId) {
try {
const [[profile]] = await db.query(
        'SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id= LIMIT 1', [estabelecimentoId] );
horariosJson = profile?.horarios_json || null;
} catch {}
}
  const workingRules = buildWorkingRules(horariosJson);
const dayIndex = weekDayIndexInTZ(dateUtc, EST_TZ_OFFSET_MIN);
return resolveExpedienteForDay(workingRules, dayIndex);
};
export const getLocalRangeMinutes = (startUtc, endUtc) => {
const startMin = minutesOfDayInTZ(startUtc, EST_TZ_OFFSET_MIN);
const endMin = minutesOfDayInTZ(endUtc, EST_TZ_OFFSET_MIN);
const startDay = weekDayIndexInTZ(startUtc, EST_TZ_OFFSET_MIN);
const endDay = weekDayIndexInTZ(endUtc, EST_TZ_OFFSET_MIN);
const spansDays = startDay != null && endDay != null && startDay !== endDay;
return { startMin, endMin, spansDays };
};
const hasBreakOverlap = (startMinAdj, endMinAdj, breaks, startMinutes, overnight) => Array.isArray(breaks) && || breaks.some(([breakStart, breakEnd]) => {
if (!Number.isFinite(breakStart) || !Number.isFinite(breakEnd)) return false;
let bs = breakStart;
let be = breakEnd;
if (overnight && bs < startMinutes) {
bs += DAY_MINUTES;
be += DAY_MINUTES;
}
    return startMinAdj < be && endMinAdj > bs;
});
export const assertDentroExpediente = ({ startMin, endMin, abre, fecha, spansDays = false, breaks = [] }) => {
if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
const abreMin = toMin(abre);
const fechaMin = toMin(fecha);
if (!Number.isFinite(abreMin) || !Number.isFinite(fechaMin)) return false;
if (abreMin === fechaMin) return false;
const crossesMidnight = spansDays || endMin < startMin;
if (abreMin < fechaMin) {
if (crossesMidnight) return false;
if (startMin < abreMin || endMin > fechaMin) return false;
if (hasBreakOverlap(startMin, endMin, breaks, abreMin, false)) return false;
return true;
} const startMinAdj = startMin < abreMin || startMin + DAY_MINUTES : startMin;
let endMinAdj = endMin + (crossesMidnight ? DAY_MINUTES : 0);
if (endMinAdj < startMinAdj) {
endMinAdj += DAY_MINUTES;
}
  const closeMinAdj = fechaMin + DAY_MINUTES;
if (startMinAdj < abreMin || endMinAdj > closeMinAdj) return false;
if (hasBreakOverlap(startMinAdj, endMinAdj, breaks, abreMin, true)) return false;
return true;
};
export const formatExpedienteMessage = (expediente) => {
if (expediente?.abre && expediente?.fecha) {
return `Horário fora do expediente (${expediente.abre}-${expediente.fecha}).`;
}
  if (expediente?.closed) {
return 'Horário fora do expediente (fechado).';
}
  return 'Horário fora do expediente.';
};



