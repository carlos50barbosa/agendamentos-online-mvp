import { pool } from './db.js';
import { config } from './config.js';
import { getRequestAccessLogContext, logSecurityEvent } from './route_access.js';

const DEFAULT_MYSQL_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MYSQL_PRUNE_BATCH_SIZE = 500;
const DEFAULT_MYSQL_PRUNE_MAX_BATCHES_PER_RUN = 5;
const REDIS_RATE_LIMIT_CONSUME_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  ttl = tonumber(ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { current, ttl }
`;

function normalizeIdentifier(value) {
  const normalized = String(value ?? '').trim();
  return normalized || 'unknown';
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : fallback;
}

function normalizeMySqlPruneStrategy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['interval', 'interval+write_fallback', 'write_fallback', 'off'].includes(normalized)) {
    return normalized;
  }
  return 'interval';
}

function normalizeSqlIdentifier(identifier, fallback = 'rate_limit_counters') {
  const normalized = String(identifier ?? '').trim();
  if (!normalized) return fallback;
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) return fallback;
  return normalized;
}

function createRateLimitStoreError(code, message, details = {}) {
  const err = new Error(message || code);
  err.code = code;
  err.details = details;
  return err;
}

function buildRateLimitResult({ count, limit, resetAt, now }) {
  const retryAfterSec = Math.max(Math.ceil((resetAt - now) / 1000), 1);
  const limited = count > limit;
  return {
    limited,
    remaining: limited ? 0 : Math.max(limit - count, 0),
    limit,
    resetAt,
    retryAfterSec,
    count,
  };
}

function normalizeRateLimitInput({ bucketKey, windowMs, max, now }) {
  const normalizedWindowMs = Number(windowMs);
  const normalizedMax = Number(max);
  const normalizedNow = Number(now ?? Date.now());

  if (!Number.isFinite(normalizedWindowMs) || normalizedWindowMs <= 0) {
    return {
      bypass: true,
      result: { limited: false, remaining: Number.isFinite(normalizedMax) ? normalizedMax : null },
    };
  }
  if (!Number.isFinite(normalizedMax) || normalizedMax <= 0) {
    return {
      bypass: true,
      result: { limited: false, remaining: null },
    };
  }

  return {
    bypass: false,
    bucketKey: normalizeIdentifier(bucketKey),
    windowMs: normalizedWindowMs,
    max: normalizedMax,
    now: Number.isFinite(normalizedNow) ? normalizedNow : Date.now(),
  };
}

async function inspectMySqlRateLimitTable({ dbPool, tableName }) {
  const normalizedTableName = normalizeSqlIdentifier(tableName);
  const [tables] = await dbPool.query(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1`,
    [normalizedTableName]
  );
  if (!tables?.length) {
    throw createRateLimitStoreError(
      'rate_limit_mysql_table_missing',
      `rate_limit_mysql_table_missing:${normalizedTableName}`,
      {
        tableName: normalizedTableName,
        migration: 'backend/sql/2026-03-26-add-rate-limit-counters.sql',
      }
    );
  }

  const [columns] = await dbPool.query(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [normalizedTableName]
  );
  const columnNames = new Set(
    (columns || []).map((row) => String(row?.column_name || '').trim().toLowerCase()).filter(Boolean)
  );
  for (const requiredColumn of ['bucket_key', 'hit_count', 'reset_at']) {
    if (!columnNames.has(requiredColumn)) {
      throw createRateLimitStoreError(
        'rate_limit_mysql_table_invalid',
        `rate_limit_mysql_table_invalid:${normalizedTableName}:missing_${requiredColumn}`,
        {
          tableName: normalizedTableName,
          missingColumn: requiredColumn,
        }
      );
    }
  }

  const [indexes] = await dbPool.query(
    `SELECT INDEX_NAME AS index_name, COLUMN_NAME AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [normalizedTableName]
  );
  const normalizedIndexes = (indexes || []).map((row) => ({
    indexName: String(row?.index_name || '').trim().toLowerCase(),
    columnName: String(row?.column_name || '').trim().toLowerCase(),
  }));
  const hasPrimaryBucketKey = normalizedIndexes.some((row) => row.indexName === 'primary' && row.columnName === 'bucket_key');
  if (!hasPrimaryBucketKey) {
    throw createRateLimitStoreError(
      'rate_limit_mysql_table_invalid',
      `rate_limit_mysql_table_invalid:${normalizedTableName}:missing_primary_bucket_key`,
      {
        tableName: normalizedTableName,
        missingIndex: 'PRIMARY(bucket_key)',
      }
    );
  }

  const hasResetAtIndex = normalizedIndexes.some((row) => row.columnName === 'reset_at');
  return {
    tableName: normalizedTableName,
    hasResetAtIndex,
  };
}

async function evaluateRedisScript(client, script, keys, args) {
  if (!client || typeof client.eval !== 'function') {
    throw createRateLimitStoreError(
      'rate_limit_redis_client_missing',
      'rate_limit_redis_client_missing'
    );
  }

  try {
    return await client.eval(script, { keys, arguments: args });
  } catch (objectStyleErr) {
    try {
      return await client.eval(script, keys.length, ...keys, ...args);
    } catch {
      throw objectStyleErr;
    }
  }
}

function normalizeRedisReplyValue(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

export function buildRateLimitClientKey(req, fallback = 'unknown') {
  const context = getRequestAccessLogContext(req);
  const rawIp = String(context.ip || fallback).split(',')[0];
  return normalizeIdentifier(rawIp);
}

export async function pruneMySqlRateLimitStore({
  dbPool = pool,
  tableName = 'rate_limit_counters',
  now = Date.now(),
  batchSize = DEFAULT_MYSQL_PRUNE_BATCH_SIZE,
} = {}) {
  const normalizedTableName = normalizeSqlIdentifier(tableName);
  const normalizedBatchSize = normalizePositiveInteger(batchSize, DEFAULT_MYSQL_PRUNE_BATCH_SIZE);
  const sqlTableName = `\`${normalizedTableName}\``;
  const [result] = await dbPool.query(
    `DELETE FROM ${sqlTableName}
      WHERE reset_at <= ?
      ORDER BY reset_at
      LIMIT ${normalizedBatchSize}`,
    [new Date(now)]
  );
  return {
    tableName: normalizedTableName,
    batchSize: normalizedBatchSize,
    deletedCount: Number(result?.affectedRows || 0),
  };
}

export function createMemoryRateLimitStore() {
  const buckets = new Map();

  function pruneExpiredBuckets(now) {
    for (const [key, entry] of buckets.entries()) {
      if (!entry || entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return {
    driver: 'memory',
    shared: false,
    async init() {},
    async consume(input) {
      const normalized = normalizeRateLimitInput(input);
      if (normalized.bypass) return normalized.result;

      pruneExpiredBuckets(normalized.now);

      const existing = buckets.get(normalized.bucketKey);
      if (!existing || existing.resetAt <= normalized.now) {
        const entry = { count: 1, resetAt: normalized.now + normalized.windowMs };
        buckets.set(normalized.bucketKey, entry);
        return buildRateLimitResult({
          count: entry.count,
          limit: normalized.max,
          resetAt: entry.resetAt,
          now: normalized.now,
        });
      }

      existing.count += 1;
      return buildRateLimitResult({
        count: existing.count,
        limit: normalized.max,
        resetAt: existing.resetAt,
        now: normalized.now,
      });
    },
    reset() {
      buckets.clear();
    },
  };
}

export function createMySqlRateLimitStore({
  dbPool = pool,
  tableName = 'rate_limit_counters',
  pruneIntervalMs = DEFAULT_MYSQL_PRUNE_INTERVAL_MS,
  pruneBatchSize = DEFAULT_MYSQL_PRUNE_BATCH_SIZE,
  pruneStrategy = 'interval',
  logger = console,
} = {}) {
  const normalizedTableName = normalizeSqlIdentifier(tableName);
  const normalizedPruneIntervalMs = normalizePositiveInteger(pruneIntervalMs, DEFAULT_MYSQL_PRUNE_INTERVAL_MS);
  const normalizedPruneBatchSize = normalizePositiveInteger(pruneBatchSize, DEFAULT_MYSQL_PRUNE_BATCH_SIZE);
  const normalizedPruneStrategy = normalizeMySqlPruneStrategy(pruneStrategy);
  const shouldPruneOnConsume =
    normalizedPruneStrategy === 'write_fallback' ||
    normalizedPruneStrategy === 'interval+write_fallback';
  const sqlTableName = `\`${normalizedTableName}\``;
  let lastPruneAt = 0;

  async function maybePruneExpired(now) {
    if (!shouldPruneOnConsume) return;
    if (now - lastPruneAt < normalizedPruneIntervalMs) return;
    lastPruneAt = now;
    try {
      await pruneMySqlRateLimitStore({
        dbPool,
        tableName: normalizedTableName,
        now,
        batchSize: normalizedPruneBatchSize,
      });
    } catch (err) {
      logger.warn?.('[security][rate-limit] mysql prune failed', {
        table_name: normalizedTableName,
        prune_strategy: normalizedPruneStrategy,
        reason: err?.message || String(err),
      });
    }
  }

  return {
    driver: 'mysql',
    shared: true,
    async init() {
      const inspection = await inspectMySqlRateLimitTable({ dbPool, tableName: normalizedTableName });
      if (!inspection.hasResetAtIndex) {
        logger.warn?.('[security][rate-limit] mysql table missing reset_at index; prune queries may degrade', {
          table_name: normalizedTableName,
          recommended_index: `idx_${normalizedTableName}_reset_at(reset_at)`,
        });
      }
    },
    async consume(input) {
      const normalized = normalizeRateLimitInput(input);
      if (normalized.bypass) return normalized.result;

      await maybePruneExpired(normalized.now);

      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
          `SELECT hit_count, reset_at
             FROM ${sqlTableName}
            WHERE bucket_key=?
            LIMIT 1
            FOR UPDATE`,
          [normalized.bucketKey]
        );

        const existing = rows?.[0] || null;
        let count = 1;
        let resetAt = normalized.now + normalized.windowMs;
        if (!existing) {
          await conn.query(
            `INSERT INTO ${sqlTableName} (bucket_key, hit_count, reset_at)
             VALUES (?, ?, ?)`,
            [normalized.bucketKey, 1, new Date(resetAt)]
          );
        } else {
          const existingResetAt = new Date(existing.reset_at).getTime();
          if (!Number.isFinite(existingResetAt) || existingResetAt <= normalized.now) {
            await conn.query(
              `UPDATE ${sqlTableName}
                  SET hit_count=?, reset_at=?
                WHERE bucket_key=?`,
              [1, new Date(resetAt), normalized.bucketKey]
            );
          } else {
            count = Number(existing.hit_count || 0) + 1;
            resetAt = existingResetAt;
            await conn.query(
              `UPDATE ${sqlTableName}
                  SET hit_count=?
                WHERE bucket_key=?`,
              [count, normalized.bucketKey]
            );
          }
        }

        await conn.commit();
        return buildRateLimitResult({
          count,
          limit: normalized.max,
          resetAt,
          now: normalized.now,
        });
      } catch (err) {
        try {
          await conn.rollback();
        } catch {}
        throw err;
      } finally {
        conn.release();
      }
    },
    async reset() {
      await dbPool.query(`DELETE FROM ${sqlTableName}`);
    },
  };
}

export function createRedisRateLimitStore({
  client,
  keyPrefix = 'rate-limit:',
} = {}) {
  const normalizedKeyPrefix = String(keyPrefix ?? '').trim() || 'rate-limit:';

  return {
    driver: 'redis',
    shared: true,
    async init() {
      if (!client) {
        throw createRateLimitStoreError(
          'rate_limit_redis_client_missing',
          'rate_limit_redis_client_missing'
        );
      }
      const redisStatus = String(client.status || '').trim().toLowerCase();
      if (
        typeof client.connect === 'function' &&
        client.isOpen !== true &&
        redisStatus !== 'ready'
      ) {
        await client.connect();
      }
    },
    async consume(input) {
      const normalized = normalizeRateLimitInput(input);
      if (normalized.bypass) return normalized.result;

      const redisKey = `${normalizedKeyPrefix}${normalized.bucketKey}`;
      const reply = await evaluateRedisScript(
        client,
        REDIS_RATE_LIMIT_CONSUME_LUA,
        [redisKey],
        [String(normalized.windowMs)]
      );
      const count = normalizeRedisReplyValue(reply?.[0], 1);
      const ttlMs = Math.max(
        normalizeRedisReplyValue(reply?.[1], normalized.windowMs),
        1
      );
      return buildRateLimitResult({
        count,
        limit: normalized.max,
        resetAt: normalized.now + ttlMs,
        now: normalized.now,
      });
    },
    async reset() {
      if (typeof client?.keys !== 'function' || typeof client?.del !== 'function') return;
      const keys = await client.keys(`${normalizedKeyPrefix}*`);
      if (Array.isArray(keys) && keys.length) {
        await client.del(...keys);
      }
    },
  };
}

let activeRateLimitStore = createMemoryRateLimitStore();
let activeRateLimitStoreInfo = {
  driver: 'memory',
  shared: false,
  initialized: false,
  configuredDriver: 'memory',
  fallbackDriver: 'memory',
  fallbackFrom: null,
  fallbackReason: null,
  tableName: null,
  keyPrefix: null,
  pruneIntervalMs: null,
  pruneBatchSize: null,
  pruneStrategy: null,
};
let activeRateLimitMaintenance = {
  enabled: false,
  driver: null,
  strategy: null,
  intervalMs: null,
  batchSize: null,
  maxBatchesPerRun: null,
  stop: null,
};

function setActiveRateLimitStore(store, info = {}) {
  activeRateLimitStore = store;
  activeRateLimitStoreInfo = {
    driver: store?.driver || info.driver || 'memory',
    shared: Boolean(store?.shared),
    initialized: true,
    configuredDriver: info.configuredDriver || store?.driver || 'memory',
    fallbackDriver: info.fallbackDriver || 'memory',
    fallbackFrom: info.fallbackFrom || null,
    fallbackReason: info.fallbackReason || null,
    tableName: info.tableName || null,
    keyPrefix: info.keyPrefix || null,
    pruneIntervalMs: info.pruneIntervalMs || null,
    pruneBatchSize: info.pruneBatchSize || null,
    pruneStrategy: info.pruneStrategy || null,
  };
  return { ...activeRateLimitStoreInfo };
}

export function getRateLimitStoreInfo() {
  return { ...activeRateLimitStoreInfo };
}

function setActiveRateLimitMaintenance(state = {}) {
  activeRateLimitMaintenance = {
    enabled: Boolean(state.enabled),
    driver: state.driver || null,
    strategy: state.strategy || null,
    intervalMs: state.intervalMs || null,
    batchSize: state.batchSize || null,
    maxBatchesPerRun: state.maxBatchesPerRun || null,
    stop: typeof state.stop === 'function' ? state.stop : null,
  };
  return getRateLimitMaintenanceInfo();
}

export function getRateLimitMaintenanceInfo() {
  return {
    enabled: activeRateLimitMaintenance.enabled,
    driver: activeRateLimitMaintenance.driver,
    strategy: activeRateLimitMaintenance.strategy,
    intervalMs: activeRateLimitMaintenance.intervalMs,
    batchSize: activeRateLimitMaintenance.batchSize,
    maxBatchesPerRun: activeRateLimitMaintenance.maxBatchesPerRun,
  };
}

export function stopRateLimitStoreMaintenance() {
  if (typeof activeRateLimitMaintenance.stop === 'function') {
    activeRateLimitMaintenance.stop();
  }
  return setActiveRateLimitMaintenance();
}

export function startRateLimitStoreMaintenance({
  cfg = config,
  dbPool = pool,
  logger = console,
} = {}) {
  stopRateLimitStoreMaintenance();

  const storeConfig = cfg.security?.rateLimit?.store || {};
  const driver = normalizeIdentifier(storeConfig.driver || 'memory').toLowerCase();
  const pruneStrategy = normalizeMySqlPruneStrategy(storeConfig.mysqlPruneStrategy);
  const intervalMs = normalizePositiveInteger(
    storeConfig.mysqlPruneIntervalMs,
    DEFAULT_MYSQL_PRUNE_INTERVAL_MS
  );
  const batchSize = normalizePositiveInteger(
    storeConfig.mysqlPruneBatchSize,
    DEFAULT_MYSQL_PRUNE_BATCH_SIZE
  );
  const maxBatchesPerRun = normalizePositiveInteger(
    storeConfig.mysqlPruneMaxBatchesPerRun,
    DEFAULT_MYSQL_PRUNE_MAX_BATCHES_PER_RUN
  );

  if (driver !== 'mysql' || pruneStrategy === 'off' || pruneStrategy === 'write_fallback') {
    return setActiveRateLimitMaintenance({
      enabled: false,
      driver,
      strategy: pruneStrategy,
      intervalMs,
      batchSize,
      maxBatchesPerRun,
    });
  }

  let running = false;
  const runPruneCycle = async () => {
    if (running) return;
    running = true;
    try {
      let totalDeleted = 0;
      let batches = 0;
      while (batches < maxBatchesPerRun) {
        const result = await pruneMySqlRateLimitStore({
          dbPool,
          tableName: storeConfig.mysqlTable,
          batchSize,
        });
        batches += 1;
        totalDeleted += result.deletedCount;
        if (result.deletedCount < batchSize) {
          break;
        }
      }
      if (totalDeleted > 0) {
        logger.info?.('[security][rate-limit] mysql prune run', {
          table_name: normalizeSqlIdentifier(storeConfig.mysqlTable),
          prune_strategy: pruneStrategy,
          batches,
          deleted_count: totalDeleted,
          batch_size: batchSize,
        });
      }
    } catch (err) {
      logger.warn?.('[security][rate-limit] mysql prune cycle failed', {
        table_name: normalizeSqlIdentifier(storeConfig.mysqlTable),
        prune_strategy: pruneStrategy,
        reason: err?.message || String(err),
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    runPruneCycle().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return setActiveRateLimitMaintenance({
    enabled: true,
    driver,
    strategy: pruneStrategy,
    intervalMs,
    batchSize,
    maxBatchesPerRun,
    stop: () => clearInterval(timer),
  });
}

export async function initializeRateLimitStore({
  cfg = config,
  dbPool = pool,
  logger = console,
  redisClientFactory = null,
} = {}) {
  const storeConfig = cfg.security?.rateLimit?.store || {};
  const driver = normalizeIdentifier(storeConfig.driver || 'memory').toLowerCase();
  const fallbackDriver = normalizeIdentifier(storeConfig.fallbackDriver || 'memory').toLowerCase();

  if (driver === 'memory') {
    return setActiveRateLimitStore(createMemoryRateLimitStore(), {
      configuredDriver: driver,
      fallbackDriver,
    });
  }

  try {
    if (driver === 'mysql') {
      const mysqlStore = createMySqlRateLimitStore({
        dbPool,
        tableName: storeConfig.mysqlTable,
        pruneIntervalMs: storeConfig.mysqlPruneIntervalMs,
        pruneBatchSize: storeConfig.mysqlPruneBatchSize,
        pruneStrategy: storeConfig.mysqlPruneStrategy,
        logger,
      });
      await mysqlStore.init();
      return setActiveRateLimitStore(mysqlStore, {
        configuredDriver: driver,
        fallbackDriver,
        tableName: normalizeSqlIdentifier(storeConfig.mysqlTable),
        pruneIntervalMs: normalizePositiveInteger(
          storeConfig.mysqlPruneIntervalMs,
          DEFAULT_MYSQL_PRUNE_INTERVAL_MS
        ),
        pruneBatchSize: normalizePositiveInteger(
          storeConfig.mysqlPruneBatchSize,
          DEFAULT_MYSQL_PRUNE_BATCH_SIZE
        ),
        pruneStrategy: normalizeMySqlPruneStrategy(storeConfig.mysqlPruneStrategy),
      });
    }

    if (driver === 'redis') {
      if (typeof redisClientFactory !== 'function') {
        throw createRateLimitStoreError(
          'rate_limit_redis_client_missing',
          'rate_limit_redis_client_missing',
          { redisUrl: storeConfig.redisUrl || null }
        );
      }
      const redisClient = await redisClientFactory({
        url: storeConfig.redisUrl || null,
        keyPrefix: storeConfig.redisKeyPrefix || 'rate-limit:',
      });
      const redisStore = createRedisRateLimitStore({
        client: redisClient,
        keyPrefix: storeConfig.redisKeyPrefix,
      });
      await redisStore.init();
      return setActiveRateLimitStore(redisStore, {
        configuredDriver: driver,
        fallbackDriver,
        keyPrefix: String(storeConfig.redisKeyPrefix || 'rate-limit:'),
      });
    }

    throw createRateLimitStoreError(
      'unsupported_rate_limit_store',
      `unsupported_rate_limit_store:${driver}`,
      { driver }
    );
  } catch (err) {
    if (fallbackDriver === 'memory') {
      logger.warn?.('[security][rate-limit] store unavailable; falling back to memory', {
        driver,
        fallback_driver: fallbackDriver,
        reason: err?.code || err?.message || String(err),
        details: err?.details || null,
      });
      return setActiveRateLimitStore(createMemoryRateLimitStore(), {
        configuredDriver: driver,
        fallbackDriver,
        fallbackFrom: driver,
        fallbackReason: err?.code || err?.message || String(err),
      });
    }
    throw err;
  }
}

export async function consumeRateLimit(input) {
  const result = await activeRateLimitStore.consume(input);
  if (result && typeof result === 'object' && !('storeDriver' in result)) {
    result.storeDriver = activeRateLimitStoreInfo.driver;
  }
  return result;
}

export function setRateLimitHeaders(res, result) {
  if (!res || !result) return;
  if (result.limit != null) res.set('X-RateLimit-Limit', String(result.limit));
  if (result.remaining != null) res.set('X-RateLimit-Remaining', String(result.remaining));
  if (result.resetAt != null) res.set('X-RateLimit-Reset', String(result.resetAt));
  if (result.limited && result.retryAfterSec != null) res.set('Retry-After', String(result.retryAfterSec));
}

export function createRateLimitMiddleware({
  routeKey,
  max,
  windowMs,
  keyResolver = (req) => buildRateLimitClientKey(req),
  responseStatus = 429,
  responseBody = { error: 'rate_limited' },
} = {}) {
  return (req, res, next) => {
    Promise.resolve().then(async () => {
      const resolvedWindowMs = typeof windowMs === 'function' ? windowMs(req) : windowMs;
      const resolvedMax = typeof max === 'function' ? max(req) : max;
      const result = await consumeRateLimit({
        bucketKey: keyResolver(req),
        windowMs: resolvedWindowMs,
        max: resolvedMax,
      });
      setRateLimitHeaders(res, result);
      if (!result.limited) return next();

      logSecurityEvent(`${routeKey}:rate-limit`, req, {
        limit: result.limit,
        retry_after_sec: result.retryAfterSec,
        window_ms: resolvedWindowMs,
        store_driver: getRateLimitStoreInfo().driver,
      });
      return res.status(responseStatus).json(responseBody);
    }).catch(next);
  };
}

export async function observeAbuseFlood({
  routeKey,
  req,
  bucketKey,
  windowMs,
  threshold,
  details = {},
  level = 'warn',
} = {}) {
  const normalizedThreshold = Number(threshold);
  if (!Number.isFinite(normalizedThreshold) || normalizedThreshold <= 0) {
    return { limited: false };
  }

  const result = await consumeRateLimit({
    bucketKey,
    windowMs,
    max: normalizedThreshold,
  });
  if (result.limited && (result.count === normalizedThreshold + 1 || result.count % normalizedThreshold === 1)) {
    logSecurityEvent(`${routeKey}:flood`, req, {
      ...details,
      threshold: normalizedThreshold,
      count: result.count,
      window_ms: windowMs,
      store_driver: getRateLimitStoreInfo().driver,
    }, { level });
  }
  return result;
}

export function resetRateLimitStore() {
  return activeRateLimitStore?.reset?.();
}
