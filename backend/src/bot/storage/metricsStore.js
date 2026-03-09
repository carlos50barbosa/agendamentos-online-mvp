import { pool } from '../../lib/db.js';

const METRIC_COLUMNS = [
  'inbound_count',
  'started_agendar',
  'completed_agendar',
  'started_remarcar',
  'completed_remarcar',
  'started_cancelar',
  'completed_cancelar',
  'conflicts_409',
  'handoff_opened',
  'outside_window_template_sent',
  'errors_count',
];

function dayKey(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`;
  return new Date().toISOString().slice(0, 10);
}

function sanitizeIncrements(increments = {}) {
  const clean = {};
  METRIC_COLUMNS.forEach((column) => {
    const n = Number(increments?.[column] || 0);
    clean[column] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  });
  return clean;
}

function hasPositive(increments = {}) {
  return METRIC_COLUMNS.some((column) => Number(increments?.[column] || 0) > 0);
}

async function incrementDailyMetrics({ tenantId, day, increments }) {
  const tenant = Number(tenantId);
  if (!Number.isFinite(tenant) || tenant <= 0) return { ok: false };
  const safe = sanitizeIncrements(increments);
  if (!hasPositive(safe)) return { ok: true, skipped: true };
  const dateKey = dayKey(day || new Date());
  const params = [
    tenant,
    dateKey,
    ...METRIC_COLUMNS.map((column) => safe[column]),
  ];
  try {
    await pool.query(
      `INSERT INTO wa_bot_metrics_daily
        (tenant_id, day, ${METRIC_COLUMNS.join(', ')}, updated_at)
       VALUES (?, ?, ${METRIC_COLUMNS.map(() => '?').join(', ')}, NOW())
       ON DUPLICATE KEY UPDATE
         ${METRIC_COLUMNS.map((column) => `${column}=${column}+VALUES(${column})`).join(', ')},
         updated_at=NOW()`,
      params
    );
    return { ok: true };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, tableMissing: true };
    }
    throw err;
  }
}

export { METRIC_COLUMNS, dayKey, sanitizeIncrements, incrementDailyMetrics };
