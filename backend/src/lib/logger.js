// backend/src/lib/logger.js
// Logger estruturado: uma linha de JSON por evento (NDJSON), escrita no stdout/stderr que o PM2
// já captura. Sem dependência nova e sem transporte próprio — o que muda é o FORMATO: em vez do
// objeto multi-linha que o console.log inspeciona, cada evento vira um registro plano, com
// timestamp e nível, que dá para consultar com `jq` e ingerir em qualquer coletor.
//
// Uso: log.info('http_request', { status: 200, ... }) / log.warn(...) / log.error(...)

const SERVICE = String(process.env.LOG_SERVICE || 'agendamento-api').trim();
const ENV = String(process.env.NODE_ENV || 'unknown').trim().toLowerCase();

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

function emit(level, event, fields = {}) {
  let line;
  try {
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      service: SERVICE,
      env: ENV,
      ...sanitizeForLog(fields),
    });
  } catch (err) {
    // Ciclo, getter que lança, etc. Degrada em vez de derrubar quem chamou.
    line = JSON.stringify({
      ts: new Date().toISOString(),
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
