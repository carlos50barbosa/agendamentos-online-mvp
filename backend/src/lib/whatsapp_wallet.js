// backend/src/lib/whatsapp_wallet.js
import { pool } from './db.js';
import { getPlanContext, resolvePlanConfig, isDelinquentStatus } from './plans.js';

export const WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT = 5;

export const WHATSAPP_TOPUP_PACKAGES = [
  { messages: 100, priceCents: 990 },
  { messages: 200, priceCents: 1690 },
  { messages: 300, priceCents: 2490 },
  { messages: 500, priceCents: 3990 },
  { messages: 1000, priceCents: 7990 },
  { messages: 2500, priceCents: 19990 },
];

const WALLET_RETRY_ERRNOS = new Set([1213, 1205]);
const WALLET_RETRY_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

function shouldRetryWalletSnapshotError(err) {
  if (!err) return false;
  if (WALLET_RETRY_ERRNOS.has(err.errno) || WALLET_RETRY_CODES.has(err.code)) return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('deadlock') || message.includes('lock wait timeout');
}

function getWalletRetryDelay(attempt) {
  const base = 75;
  const exponential = Math.min(1200, base * Math.pow(2, attempt - 1));
  const jitter = Math.round(Math.random() * base);
  return exponential + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logWalletRetry(opName, estId, attempt, delayMs, err) {
  console.warn('[whatsapp_wallet] retry', {
    op: opName,
    estabelecimentoId: estId,
    attempt,
    delayMs,
    errno: err?.errno,
    code: err?.code,
  });
}

async function safeRollback(conn) {
  try {
    await conn.rollback();
  } catch {}
}

async function withWalletTransaction(estId, operation, { opName = 'wallet', maxAttempts = 3 } = {}) {
  // Retry lock-related errors by rolling back and opening a fresh transaction per attempt.
  const conn = await pool.getConnection();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await conn.beginTransaction();
      try {
        const result = await operation(conn);
        await conn.commit();
        return result;
      } catch (err) {
        await safeRollback(conn);
        if (attempt >= maxAttempts || !shouldRetryWalletSnapshotError(err)) {
          throw err;
        }
        const delayMs = getWalletRetryDelay(attempt);
        logWalletRetry(opName, estId, attempt, delayMs, err);
        await sleep(delayMs);
      }
    }
  } finally {
    conn.release();
  }
  return null;
}

const toInt = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

function ensureDate(input) {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

export function computeMonthCycle(dateInput = new Date()) {
  const base = ensureDate(dateInput);
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const label = start.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: 'unserializable_metadata' });
  }
}

function resolveIncludedLimit(planContext) {
  const plan = planContext?.plan || 'starter';
  const status = planContext?.status || 'trialing';
  const cfg = planContext?.config || resolvePlanConfig(plan);

  if (isDelinquentStatus(status)) return 0;
  if (cfg?.allowWhatsApp === false) return 0;

  const included = toInt(cfg?.whatsappIncludedMessages, 0);
  return Math.max(0, included);
}

function normalizeTopupPackage(pack) {
  if (!pack) return null;
  const messages = toInt(pack.messages ?? pack.wa_messages ?? pack.waMessages, 0);
  const priceCents = toInt(pack.priceCents ?? pack.price_cents ?? pack.price ?? 0, 0);
  if (!messages || priceCents < 0) return null;
  return {
    id: pack.id != null ? toInt(pack.id, null) : null,
    code: pack.code || null,
    name: pack.name || null,
    messages,
    priceCents,
  };
}

function findTopup(messages, availablePacks = null) {
  const m = toInt(messages, 0);
  const candidates = Array.isArray(availablePacks) && availablePacks.length
    ? availablePacks
    : WHATSAPP_TOPUP_PACKAGES;
  return candidates.map(normalizeTopupPackage).find((p) => p?.messages === m) || null;
}

export function resolveTopupPackage(messages, { availablePacks = null } = {}) {
  return findTopup(messages, availablePacks);
}

export { normalizeTopupPackage };

async function ensureWalletExists(conn, estabelecimentoId, cycle, includedLimit) {
  await conn.query(
    `INSERT IGNORE INTO whatsapp_wallets
      (estabelecimento_id, cycle_start, cycle_end, included_limit, included_balance, extra_balance)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [estabelecimentoId, cycle.start, cycle.end, includedLimit, includedLimit]
  );
}

async function ensureWalletCycleAndPlan(conn, estabelecimentoId, cycle, includedLimit, { lock = true } = {}) {
  // The lock flag lets snapshot paths skip FOR UPDATE while credit/debit still serialize wallet updates first.
  const lockClause = lock ? '\n     FOR UPDATE' : '';
  const [[row]] = await conn.query(
    `SELECT estabelecimento_id, cycle_start, cycle_end, included_limit, included_balance, extra_balance
     FROM whatsapp_wallets
     WHERE estabelecimento_id=?
     LIMIT 1${lockClause}`,
    [estabelecimentoId]
  );
  if (!row) return null;

  const currentStart = row.cycle_start ? new Date(row.cycle_start) : null;
  const currentEnd = row.cycle_end ? new Date(row.cycle_end) : null;
  const needsCycleReset =
    !currentStart ||
    !currentEnd ||
    Number.isNaN(currentStart.getTime()) ||
    Number.isNaN(currentEnd.getTime()) ||
    currentStart.getTime() !== cycle.start.getTime() ||
    currentEnd.getTime() !== cycle.end.getTime();

  if (needsCycleReset) {
    await conn.query(
      `UPDATE whatsapp_wallets
       SET cycle_start=?, cycle_end=?, included_limit=?, included_balance=?, updated_at=CURRENT_TIMESTAMP
       WHERE estabelecimento_id=?
       LIMIT 1`,
      [cycle.start, cycle.end, includedLimit, includedLimit, estabelecimentoId]
    );
    await conn.query(
      `INSERT IGNORE INTO whatsapp_wallet_transactions
        (estabelecimento_id, kind, delta, included_delta, extra_delta, cycle_start, cycle_end, metadata)
       VALUES (?, 'cycle_reset', ?, ?, 0, ?, ?, ?)`,
      [
        estabelecimentoId,
        includedLimit,
        includedLimit,
        cycle.start,
        cycle.end,
        safeJson({ included_limit: includedLimit, cycle: { start: cycle.start, end: cycle.end } }),
      ]
    );

    return {
      estabelecimento_id: row.estabelecimento_id,
      cycle_start: cycle.start,
      cycle_end: cycle.end,
      included_limit: includedLimit,
      included_balance: includedLimit,
      extra_balance: row.extra_balance,
    };
  }

  const currentLimit = toInt(row.included_limit, 0);
  const currentBalance = toInt(row.included_balance, 0);

  if (currentLimit !== includedLimit) {
    const used = Math.max(currentLimit - currentBalance, 0);
    const nextBalance = Math.max(includedLimit - used, 0);
    await conn.query(
      `UPDATE whatsapp_wallets
       SET included_limit=?, included_balance=?, updated_at=CURRENT_TIMESTAMP
       WHERE estabelecimento_id=?
       LIMIT 1`,
      [includedLimit, nextBalance, estabelecimentoId]
    );
    return {
      estabelecimento_id: row.estabelecimento_id,
      cycle_start: row.cycle_start,
      cycle_end: row.cycle_end,
      included_limit: includedLimit,
      included_balance: nextBalance,
      extra_balance: row.extra_balance,
    };
  }

  return {
    estabelecimento_id: row.estabelecimento_id,
    cycle_start: row.cycle_start,
    cycle_end: row.cycle_end,
    included_limit: currentLimit,
    included_balance: currentBalance,
    extra_balance: toInt(row.extra_balance, 0),
  };
}

export async function getWhatsAppWalletSnapshot(estabelecimentoId, { now = new Date(), planContext = null } = {}) {
  const estId = toInt(estabelecimentoId, 0);
  if (!estId) return null;
  const ctx = planContext || (await getPlanContext(estId));
  const includedLimit = resolveIncludedLimit(ctx);
  const cycle = computeMonthCycle(now);

  const wallet = await withWalletTransaction(
    estId,
    async (conn) => {
      await ensureWalletExists(conn, estId, cycle, includedLimit);
      return ensureWalletCycleAndPlan(conn, estId, cycle, includedLimit, { lock: false });
    },
    { opName: 'snapshot' }
  );

  if (!wallet) return null;
  const includedBalance = toInt(wallet.included_balance, 0);
  const extraBalance = toInt(wallet.extra_balance, 0);
  const includedLimitOut = toInt(wallet.included_limit, 0);
  return {
    estabelecimento_id: estId,
    month_label: cycle.label,
    cycle_start: wallet.cycle_start ? new Date(wallet.cycle_start).toISOString() : null,
    cycle_end: wallet.cycle_end ? new Date(wallet.cycle_end).toISOString() : null,
    included_limit: includedLimitOut,
    included_balance: includedBalance,
    extra_balance: extraBalance,
    total_balance: includedBalance + extraBalance,
    plan: ctx?.plan || 'starter',
    plan_status: ctx?.status || null,
  };
}

export async function recordWhatsAppBlocked({
  estabelecimentoId,
  agendamentoId = null,
  reason,
  metadata,
}) {
  const estId = toInt(estabelecimentoId, 0);
  if (!estId) return { ok: false, error: 'missing_estabelecimento' };
  await pool.query(
    `INSERT INTO whatsapp_wallet_transactions
      (estabelecimento_id, kind, delta, included_delta, extra_delta, agendamento_id, reason, metadata)
     VALUES (?, 'blocked', 0, 0, 0, ?, ?, ?)`,
    [estId, agendamentoId != null ? toInt(agendamentoId, 0) || null : null, String(reason || ''), safeJson(metadata)]
  );
  return { ok: true };
}

export async function creditWhatsAppTopup({
  estabelecimentoId,
  messages,
  paymentId,
  subscriptionId = null,
  metadata,
  pack = null,
}) {
  const estId = toInt(estabelecimentoId, 0);
  const normalizedPack = normalizeTopupPackage(pack) || resolveTopupPackage(messages);
  const pkg = normalizedPack || null;
  if (!estId) return { ok: false, error: 'missing_estabelecimento' };
  if (!pkg) return { ok: false, error: 'invalid_package' };
  if (!paymentId) return { ok: false, error: 'missing_payment_id' };
  const reason = metadata?.reason || 'pix_pack';

  const ctx = await getPlanContext(estId);
  const includedLimit = resolveIncludedLimit(ctx);
  const cycle = computeMonthCycle(new Date());

  const result = await withWalletTransaction(
    estId,
    async (conn) => {
      // Touch the wallet row first so we hold its lock before recording ledger entries.
      await ensureWalletExists(conn, estId, cycle, includedLimit);
      await ensureWalletCycleAndPlan(conn, estId, cycle, includedLimit);

      const [ins] = await conn.query(
        `INSERT IGNORE INTO whatsapp_wallet_transactions
          (estabelecimento_id, kind, delta, included_delta, extra_delta, subscription_id, payment_id, reason, metadata)
         VALUES (?, 'topup_credit', ?, 0, ?, ?, ?, ?, ?)`,
        [
          estId,
          pkg.messages,
          pkg.messages,
          subscriptionId != null ? toInt(subscriptionId, 0) || null : null,
          String(paymentId),
          reason,
          safeJson({
            ...(metadata || {}),
          pack_code: pkg.code || metadata?.pack_code || null,
          pack_id: pkg.id ?? metadata?.pack_id ?? null,
          pack_name: (pkg.name || metadata?.pack_name) ?? null,
            messages: pkg.messages,
            price_cents: pkg.priceCents,
          }),
        ]
      );

      if (!ins.affectedRows) {
        return { idempotent: true };
      }

      await conn.query(
        `UPDATE whatsapp_wallets
         SET extra_balance=extra_balance+?, updated_at=CURRENT_TIMESTAMP
         WHERE estabelecimento_id=?
         LIMIT 1`,
        [pkg.messages, estId]
      );

      return { idempotent: false };
    },
    { opName: 'topup_credit' }
  );

  if (result?.idempotent) {
    return { ok: true, idempotent: true };
  }

  const wallet = await getWhatsAppWalletSnapshot(estId, { planContext: ctx });
  return { ok: true, wallet };
}

export async function debitWhatsAppMessage({
  estabelecimentoId,
  agendamentoId = null,
  providerMessageId,
  metadata,
}) {
  const estId = toInt(estabelecimentoId, 0);
  if (!estId) return { ok: false, error: 'missing_estabelecimento' };
  if (!providerMessageId) return { ok: false, error: 'missing_provider_message_id' };

  const ctx = await getPlanContext(estId);
  const includedLimit = resolveIncludedLimit(ctx);
  const cycle = computeMonthCycle(new Date());

  const result = await withWalletTransaction(
    estId,
    async (conn) => {
      // Lock the wallet row before inserting the debit ledger to enforce a predictable lock ordering.
      await ensureWalletExists(conn, estId, cycle, includedLimit);
      const wallet = await ensureWalletCycleAndPlan(conn, estId, cycle, includedLimit);
      if (!wallet) {
        return { error: 'wallet_not_found' };
      }

      const includedBalance = toInt(wallet.included_balance, 0);
      const extraBalance = toInt(wallet.extra_balance, 0);
      const bucket = includedBalance > 0 ? 'included' : extraBalance > 0 ? 'extra' : null;
      if (!bucket) {
        return { error: 'insufficient_balance' };
      }

      const includedDelta = bucket === 'included' ? -1 : 0;
      const extraDelta = bucket === 'extra' ? -1 : 0;

      const [ins] = await conn.query(
        `INSERT IGNORE INTO whatsapp_wallet_transactions
          (estabelecimento_id, kind, delta, included_delta, extra_delta, agendamento_id, provider_message_id, metadata)
         VALUES (?, 'debit', -1, ?, ?, ?, ?, ?)`,
        [
          estId,
          includedDelta,
          extraDelta,
          agendamentoId != null ? toInt(agendamentoId, 0) || null : null,
          String(providerMessageId),
          safeJson(metadata),
        ]
      );

      if (!ins.affectedRows) {
        return { idempotent: true };
      }

      if (bucket === 'included') {
        await conn.query(
          `UPDATE whatsapp_wallets
           SET included_balance=GREATEST(included_balance-1, 0), updated_at=CURRENT_TIMESTAMP
           WHERE estabelecimento_id=?
           LIMIT 1`,
          [estId]
        );
      } else {
        await conn.query(
          `UPDATE whatsapp_wallets
           SET extra_balance=GREATEST(extra_balance-1, 0), updated_at=CURRENT_TIMESTAMP
           WHERE estabelecimento_id=?
           LIMIT 1`,
          [estId]
        );
      }

      return { bucket };
    },
    { opName: 'debit' }
  );

  if (result?.error) {
    return { ok: false, error: result.error };
  }

  if (result?.idempotent) {
    return { ok: true, idempotent: true };
  }

  return { ok: true, bucket: result?.bucket || null };
}

export async function listWhatsAppTopups(estabelecimentoId, { limit = 5 } = {}) {
  const estId = toInt(estabelecimentoId, 0);
  if (!estId) return [];
  const max = Math.max(1, toInt(limit, 5));
  const [rows] = await pool.query(
    `SELECT id, delta, included_delta, extra_delta, payment_id, metadata, created_at
     FROM whatsapp_wallet_transactions
     WHERE estabelecimento_id=? AND kind='topup_credit'
     ORDER BY id DESC
     LIMIT ?`,
    [estId, max]
  );
  return (rows || []).map((row) => {
    let parsed = null;
    if (row?.metadata) {
      try { parsed = JSON.parse(row.metadata); } catch { parsed = null; }
    }
    return {
      id: row.id,
      delta: toInt(row.delta, 0),
      included_delta: toInt(row.included_delta, 0),
      extra_delta: toInt(row.extra_delta, 0),
      payment_id: row.payment_id ? String(row.payment_id) : null,
      metadata: parsed,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  });
}
