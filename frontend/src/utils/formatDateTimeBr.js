const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});

const DATE_FORMAT_WITH_YEAR = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getDayDiff(target, now) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const compare = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((compare - base) / 86400000);
}

export function formatDateBr(value, { includeYear = false, showRelative = true, now = new Date() } = {}) {
  const date = parseDate(value);
  if (!date) return '--';

  if (showRelative) {
    const diff = getDayDiff(date, now);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
  }

  return includeYear ? DATE_FORMAT_WITH_YEAR.format(date) : DATE_FORMAT.format(date);
}

export function formatTimeBr(value) {
  const date = parseDate(value);
  if (!date) return '--:--';
  return TIME_FORMAT.format(date);
}

export function formatDateTimeBr(
  value,
  { includeYear = false, showRelative = true, now = new Date() } = {}
) {
  const date = parseDate(value);
  if (!date) return '--';
  const dateLabel = formatDateBr(date, { includeYear, showRelative, now });
  const timeLabel = formatTimeBr(date);
  return `${dateLabel} às ${timeLabel}`;
}

export function isPastDateTime(value, now = Date.now()) {
  const date = parseDate(value);
  if (!date) return false;
  return date.getTime() < now;
}
