// backend/src/lib/logger.js
// Logger estruturado: uma linha de JSON por evento (NDJSON), escrita no stdout/stderr que o PM2
// já captura. Sem dependência nova e sem transporte próprio — o que muda é o FORMATO: em vez do
// objeto multi-linha que o console.log inspeciona, cada evento vira um registro plano, com
// timestamp e nível, que dá para consultar com `jq` e ingerir em qualquer coletor.
//
// Uso: log.info('http_request', { status: 200, ... }) / log.warn(...) / log.error(...)

const SERVICE = String(process.env.LOG_SERVICE || 'agendamento-api').trim();
const ENV = String(process.env.NODE_ENV || 'unknown').trim().toLowerCase();

// Horário dos logs: Brasília por padrão (LOG_TZ=UTC volta ao anterior).
//
// O carimbo continua ISO 8601, mas com o deslocamento explícito em vez de "Z":
//   2026-07-12T19:32:08.661-03:00   (e não 2026-07-12T22:32:08.661Z)
// Assim a hora é a que você lê no relógio E o registro segue ordenável e parseável por jq,
// Loki, Datadog etc. Um "19:32:08" solto, sem fuso, seria ambíguo — e ambiguidade num log de
// auditoria é o pior dos mundos.
const LOG_TZ = String(process.env.LOG_TZ || 'America/Sao_Paulo').trim();

// Intl.DateTimeFormat é caro de construir; isto roda a cada linha de log, então instancia uma vez.
const TS_PARTS = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: LOG_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return null; // fuso inválido: cai no ISO/UTC
  }
})();

function formatTimestamp(date = new Date()) {
  if (!TS_PARTS) return date.toISOString();
  try {
    const p = {};
    for (const { type, value } of TS_PARTS.formatToParts(date)) p[type] = value;
    const hour = p.hour === '24' ? '00' : p.hour; // en-CA pode devolver 24 à meia-noite
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    // Offset real do fuso naquele instante (não hardcode -03:00: o Brasil já teve horário de
    // verão e datas antigas ou uma volta dele quebrariam um valor fixo).
    const asUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(hour), Number(p.minute), Number(p.second), date.getMilliseconds()
    );
    const offsetMin = Math.round((asUtc - date.getTime()) / 60000);
    const sign = offsetMin < 0 ? '-' : '+';
    const abs = Math.abs(offsetMin);
    const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

    return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}.${ms}${offset}`;
  } catch {
    return date.toISOString();
  }
}

// Chaves que nunca podem ir para o disco, em qualquer profundidade. Auditoria registra QUE a senha
// mudou, jamais o valor. A lista é casada por substring no nome da chave, minúsculo.
const REDACT_KEY_PATTERNS = [
  'senha', 'password', 'passwd', 'secret', 'token', 'authorization', 'cookie',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'card', 'cvv', 'cvc',
  'card_number', 'security_code', 'private_key', 'client_secret',
];

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_STRING = 2000;

function shouldRedact(key) {
  const k = String(key).toLowerCase();
  return REDACT_KEY_PATTERNS.some((pattern) => k.includes(pattern));
}

// Serializa com redaction e limite de profundidade. Nunca lança: um log que quebra a request é
// pior do que um log incompleto.
export function sanitizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[max_depth]';

  const type = typeof value;
  if (type === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeForLog(item, depth + 1));
  }

  if (type === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (shouldRedact(key)) {
        out[key] = REDACTED;
        continue;
      }
      const clean = sanitizeForLog(val, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return undefined;
}

/**
 * Mesmo instante, no formato que o MySQL aceita em coluna DATETIME: 'YYYY-MM-DD HH:MM:SS.mmm'.
 * Ancorado em LOG_TZ, e não no fuso do processo Node nem no do servidor MySQL — é o que mantém a
 * trilha de auditoria e o access log no mesmo relógio em qualquer máquina.
 */
export function sqlTimestamp(date = new Date()) {
  const iso = formatTimestamp(date);          // 2026-07-12T19:46:28.404-03:00
  return iso.slice(0, 23).replace('T', ' ');  // 2026-07-12 19:46:28.404
}

function emit(level, event, fields = {}) {
  let line;
  try {
    line = JSON.stringify({
      ts: formatTimestamp(),
      level,
      event,
      service: SERVICE,
      env: ENV,
      ...sanitizeForLog(fields),
    });
  } catch (err) {
    // Ciclo, getter que lança, etc. Degrada em vez de derrubar quem chamou.
    line = JSON.stringify({
      ts: formatTimestamp(),
      level: 'error',
      event: 'log_serialize_failed',
      service: SERVICE,
      env: ENV,
      original_event: String(event),
      reason: err?.message || String(err),
    });
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};

export default log;
