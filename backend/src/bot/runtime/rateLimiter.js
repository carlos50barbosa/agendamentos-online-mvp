const DEFAULT_MAX = Number(process.env.WA_BOT_RATE_LIMIT_MAX || 20);
const DEFAULT_WINDOW_MS = Number(process.env.WA_BOT_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);

const memory = new Map();

function normalizeMax(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX;
  return Math.trunc(n);
}

function normalizeWindow(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_MS;
  return Math.trunc(n);
}

function nowMs(now = Date.now()) {
  const n = Number(now);
  return Number.isFinite(n) ? n : Date.now();
}

function cleanupOld(entries, cutoff) {
  let idx = 0;
  while (idx < entries.length && entries[idx] < cutoff) idx += 1;
  if (idx > 0) entries.splice(0, idx);
}

function checkRateLimit({ tenantId, fromPhone, now = Date.now(), max = DEFAULT_MAX, windowMs = DEFAULT_WINDOW_MS }) {
  const tenant = Number(tenantId);
  const phone = String(fromPhone || '').trim();
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) {
    return { allowed: true, count: 0, remaining: normalizeMax(max), retryAfterSec: 0 };
  }
  const safeMax = normalizeMax(max);
  const safeWindow = normalizeWindow(windowMs);
  const key = `${tenant}:${phone}`;
  const ts = nowMs(now);
  const cutoff = ts - safeWindow;
  const entries = memory.get(key) || [];
  cleanupOld(entries, cutoff);
  entries.push(ts);
  memory.set(key, entries);
  const count = entries.length;
  const allowed = count <= safeMax;
  const retryAfterSec = allowed
    ? 0
    : Math.max(1, Math.ceil(((entries[0] + safeWindow) - ts) / 1000));
  const remaining = Math.max(0, safeMax - count);

  if (memory.size > 20_000) {
    for (const [entryKey, list] of memory.entries()) {
      cleanupOld(list, cutoff);
      if (!list.length) memory.delete(entryKey);
    }
  }

  return { allowed, count, remaining, retryAfterSec };
}

function resetRateLimitMemory() {
  memory.clear();
}

export { checkRateLimit, resetRateLimitMemory };
