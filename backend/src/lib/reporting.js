const DAY_MS = 24 * 60 * 60 * 1000;

export const LEAD_TIME_BUCKETS = [
  { key: '0-1d', label: '0-1d', minDays: 0, maxDays: 1, order: 1 },
  { key: '2-3d', label: '2-3d', minDays: 2, maxDays: 3, order: 2 },
  { key: '4-7d', label: '4-7d', minDays: 4, maxDays: 7, order: 3 },
  { key: '8-14d', label: '8-14d', minDays: 8, maxDays: 14, order: 4 },
  { key: '15+d', label: '15+d', minDays: 15, maxDays: null, order: 5 },
];

const pad2 = (value) => String(value).padStart(2, '0');

export function parseLocalDate(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatLocalDate(date) {
  if (!date) return '';
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function shiftLocalDate(date, deltaDays) {
  if (!date || !Number.isFinite(deltaDays)) return null;
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const next = new Date(base + deltaDays * DAY_MS);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function buildLocalDateSeries(startLocal, endLocal) {
  if (!startLocal || !endLocal) return [];
  const startMs = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endMs = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  if (startMs > endMs) return [];
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += DAY_MS) {
    const current = new Date(ts);
    out.push(`${current.getUTCFullYear()}-${pad2(current.getUTCMonth() + 1)}-${pad2(current.getUTCDate())}`);
  }
  return out;
}

export function fillDailySeries(rows, startLocal, endLocal) {
  const series = buildLocalDateSeries(startLocal, endLocal);
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = row.dia || row.date || row.data;
    if (!key) return;
    map.set(String(key), row);
  });

  return series.map((date) => {
    const row = map.get(date) || {};
    return {
      date,
      confirmados: Number(row.confirmados || 0),
      cancelados: Number(row.cancelados || 0),
      concluidos: Number(row.concluidos || 0),
      no_show: Number(row.no_show || 0),
      receita_dia: Number(row.receita_centavos || row.receita_dia || 0),
    };
  });
}

export function normalizeLeadTimeRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = row.bucket || row.key || row.label;
    if (!key) return;
    map.set(String(key), row);
  });

  return LEAD_TIME_BUCKETS.map((bucket) => {
    const row = map.get(bucket.key) || {};
    return {
      ...bucket,
      total: Number(row.total || 0),
      receita_centavos: Number(row.receita_centavos || 0),
    };
  });
}
