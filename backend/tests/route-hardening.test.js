import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import test, { after } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

import paymentsRouter from '../src/routes/payments.js';
import billingRouter from '../src/routes/billing.js';
import notifyRouter from '../src/routes/notify.js';
import waTenantWebhookRouter from '../src/routes/waWebhook.js';
import whatsappWebhookRouter from '../src/routes/whatsapp_webhook.js';
import { mountWebhooks } from '../src/routes/webhooks.js';
import { pool } from '../src/lib/db.js';
import { config, getOperationalHardeningWarnings } from '../src/lib/config.js';
import {
  getRateLimitMaintenanceInfo,
  getRateLimitStoreInfo,
  initializeRateLimitStore,
  pruneMySqlRateLimitStore,
  resetRateLimitStore,
  startRateLimitStoreMaintenance,
  stopRateLimitStoreMaintenance,
} from '../src/lib/request_rate_limit.js';
import { verifyWhatsAppWebhookSignature } from '../src/lib/wa_webhook_signature.js';
import { buildPublicDepositToken, verifyPublicDepositToken } from '../src/lib/public_deposit_token.js';
import { canAccessPaymentStatus, serializePaymentStatusResponse } from '../src/lib/payment_status_access.js';
import { resolveRouteTokenAccess } from '../src/lib/route_access.js';
import { decideNotifyAccess, resolveNotifyTokenAccess } from '../src/routes/notify.js';

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function startServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function createPaymentsApp() {
  const app = express();
  app.use(express.json());
  app.use('/payments', paymentsRouter);
  app.use('/api/payments', paymentsRouter);
  return app;
}

function createBillingApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', billingRouter);
  app.use('/api/billing', billingRouter);
  return app;
}

function createNotifyApp() {
  const app = express();
  app.use(express.json());
  app.use('/notify', notifyRouter);
  app.use('/api/notify', notifyRouter);
  return app;
}

function createWhatsAppWebhookApp() {
  const app = express();
  const paths = [
    '/wa/webhook',
    '/api/wa/webhook',
    '/webhooks/whatsapp',
    '/api/webhooks/whatsapp',
  ];
  app.use(paths, express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }));
  app.use('/wa/webhook', waTenantWebhookRouter);
  app.use('/webhooks/whatsapp', whatsappWebhookRouter);
  app.use('/api/wa/webhook', waTenantWebhookRouter);
  app.use('/api/webhooks/whatsapp', whatsappWebhookRouter);
  return app;
}

function createUserRow(id, tipo) {
  return {
    id,
    nome: `User ${id}`,
    email: `user${id}@example.com`,
    telefone: '',
    data_nascimento: null,
    cpf_cnpj: null,
    cep: null,
    endereco: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    estado: null,
    avatar_url: null,
    tipo,
    notify_email_estab: tipo === 'estabelecimento' ? 1 : 0,
    notify_whatsapp_estab: tipo === 'estabelecimento' ? 1 : 0,
    plan: 'starter',
    plan_status: 'active',
    plan_trial_ends_at: null,
    plan_active_until: null,
    plan_subscription_id: null,
  };
}

function createPaymentRow(overrides = {}) {
  return {
    id: overrides.id ?? 101,
    agendamento_id: overrides.agendamento_id ?? 501,
    estabelecimento_id: overrides.estabelecimento_id ?? 11,
    cliente_id: overrides.cliente_id ?? 21,
    amount_centavos: overrides.amount_centavos ?? 1500,
    status: overrides.status ?? 'pending',
    expires_at: overrides.expires_at ?? '2030-01-01T00:00:00.000Z',
    paid_at: overrides.paid_at ?? null,
    provider_payment_id: overrides.provider_payment_id ?? null,
    provider_reference: overrides.provider_reference ?? null,
    updated_at: overrides.updated_at ?? '2030-01-01T00:00:00.000Z',
  };
}

function installPoolQueryMock({ paymentsById = new Map(), usersById = new Map(), sqlLog = [] } = {}) {
  const original = pool.query;
  pool.query = async (sql, params = []) => {
    const statement = String(sql);
    sqlLog.push({ statement, params });
    if (statement.includes('FROM appointment_payments')) {
      const paymentId = Number(params[0]);
      const row = paymentsById.get(paymentId) || null;
      return [row ? [row] : []];
    }
    if (statement.includes('FROM usuarios')) {
      const userId = Number(params[0]);
      const row = usersById.get(userId) || null;
      return [row ? [row] : []];
    }
    throw new Error(`Unexpected SQL in test: ${statement}`);
  };
  return () => {
    pool.query = original;
  };
}

function createJwtToken(userId, secret, options = {}) {
  return jwt.sign({ id: userId }, secret, options);
}

function createMercadoPagoSignature({ id, requestId, ts, secret }) {
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const digest = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${digest}`;
}

test('resolveNotifyTokenAccess ignores Authorization bearer fallback and honors explicit notify/admin headers', () => {
  const env = {
    NOTIFY_ROUTE_TOKEN: 'notify-secret',
    ADMIN_TOKEN: 'admin-secret',
  };

  const conflictingHeaders = resolveNotifyTokenAccess({
    headers: {
      'x-notify-token': 'wrong-secret',
      'x-admin-token': 'admin-secret',
      authorization: 'Bearer admin-secret',
    },
  }, env);
  assert.equal(conflictingHeaders.ok, true);
  assert.equal(conflictingHeaders.source, 'header:x-admin-token');

  const bearerOnly = resolveNotifyTokenAccess({
    headers: {
      authorization: 'Bearer admin-secret',
    },
  }, env);
  assert.equal(bearerOnly.ok, false);
  assert.equal(bearerOnly.reason, 'missing_token');
});

test('decideNotifyAccess only allows establishment JWTs or explicit route tokens', () => {
  assert.deepEqual(
    decideNotifyAccess({
      tokenAccess: { ok: true, source: 'header:x-notify-token' },
      authResult: { user: null, error: null },
    }),
    { ok: true, source: 'header:x-notify-token', user: null }
  );

  assert.deepEqual(
    decideNotifyAccess({
      tokenAccess: { ok: false, reason: 'missing_token' },
      authResult: { user: { id: 21, tipo: 'cliente' }, error: null },
    }),
    { ok: false, status: 403, error: 'forbidden' }
  );

  assert.deepEqual(
    decideNotifyAccess({
      tokenAccess: { ok: false, reason: 'missing_token' },
      authResult: { user: { id: 11, tipo: 'estabelecimento' }, error: null },
    }),
    { ok: true, source: 'jwt_estabelecimento', user: { id: 11, tipo: 'estabelecimento' } }
  );

  assert.deepEqual(
    decideNotifyAccess({
      tokenAccess: { ok: false, reason: 'token_mismatch' },
      authResult: { user: null, error: { code: 'token_invalid' } },
    }),
    { ok: false, status: 403, error: 'token_invalid' }
  );

  assert.deepEqual(
    decideNotifyAccess({
      tokenAccess: { ok: false, reason: 'token_mismatch' },
      authResult: { user: null, error: { code: 'token_expired' } },
    }),
    { ok: false, status: 401, error: 'token_expired' }
  );
});

test('notify routes apply rate limiting across api and non-api aliases before auth succeeds', async () => {
  const previous = { ...config.security.rateLimit.notify };
  config.security.rateLimit.notify.max = 2;
  config.security.rateLimit.notify.windowMs = 60000;
  resetRateLimitStore();

  const app = createNotifyApp();
  const { server, baseUrl } = await startServer(app);
  try {
    const first = await fetch(`${baseUrl}/notify/whatsapp/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511999999999', text: 'a' }),
    });
    assert.equal(first.status, 403);
    assert.equal(first.headers.get('x-ratelimit-limit'), '2');

    const second = await fetch(`${baseUrl}/api/notify/whatsapp/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511999999999', text: 'b' }),
    });
    assert.equal(second.status, 403);

    const third = await fetch(`${baseUrl}/notify/whatsapp/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511999999999', text: 'c' }),
    });
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '60');
  } finally {
    await stopServer(server);
    config.security.rateLimit.notify.max = previous.max;
    config.security.rateLimit.notify.windowMs = previous.windowMs;
    resetRateLimitStore();
  }
});

test('getOperationalHardeningWarnings escalates permissive webhook settings explicitly in production', () => {
  const warnings = getOperationalHardeningWarnings({
    NODE_ENV: 'production',
    WA_APP_SECRET: '',
    WA_WEBHOOK_ALLOW_UNSIGNED: 'true',
  }, {
    billing: {
      mercadopago: { allowUnsigned: true },
    },
  });

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    [
      'wa_app_secret_missing',
      'wa_allow_unsigned_enabled',
      'mercadopago_allow_unsigned_enabled',
    ]
  );
  assert.ok(warnings.every((warning) => warning.severity === 'error'));
});

test('getOperationalHardeningWarnings flags redis bootstrap gaps and expired legacy payment token sunsets', () => {
  const warnings = getOperationalHardeningWarnings({
    NODE_ENV: 'production',
  }, {
    security: {
      rateLimit: {
        store: {
          driver: 'redis',
          redisUrl: null,
        },
      },
      payments: {
        legacyQueryToken: {
          sunsetAt: '2020-01-01T00:00:00.000Z',
        },
      },
    },
    billing: {
      mercadopago: { allowUnsigned: false },
    },
  });

  const warningCodes = warnings.map((warning) => warning.code);
  assert.ok(warningCodes.includes('rate_limit_redis_url_missing'));
  assert.ok(warningCodes.includes('payments_legacy_query_token_sunset_elapsed'));
});

test('getOperationalHardeningWarnings flags mysql write-path prune and disabled legacy payment query fallback', () => {
  const warnings = getOperationalHardeningWarnings({
    NODE_ENV: 'production',
  }, {
    security: {
      rateLimit: {
        store: {
          driver: 'mysql',
          mysqlPruneStrategy: 'write_fallback',
        },
      },
      payments: {
        legacyQueryToken: {
          enabled: false,
          sunsetAt: null,
        },
      },
    },
    billing: {
      mercadopago: { allowUnsigned: false },
    },
  });

  const warningCodes = warnings.map((warning) => warning.code);
  assert.ok(warningCodes.includes('rate_limit_mysql_write_prune_enabled'));
  assert.ok(warningCodes.includes('payments_legacy_query_token_disabled'));
});

test('pruneMySqlRateLimitStore deletes expired rows in bounded batches ordered by reset_at', async () => {
  const calls = [];
  const result = await pruneMySqlRateLimitStore({
    dbPool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [{ affectedRows: 7 }];
      },
    },
    tableName: 'rate_limit_counters',
    now: 1710000000000,
    batchSize: 25,
  });

  assert.equal(result.deletedCount, 7);
  assert.equal(result.batchSize, 25);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ORDER BY reset_at/i);
  assert.match(calls[0].sql, /LIMIT 25/i);
  assert.equal(calls[0].params.length, 1);
});

test('startRateLimitStoreMaintenance schedules bounded mysql prune cycles outside the write path', async () => {
  const calls = [];
  const loggerCalls = [];
  const info = startRateLimitStoreMaintenance({
    cfg: {
      security: {
        rateLimit: {
          store: {
            driver: 'mysql',
            mysqlTable: 'rate_limit_counters',
            mysqlPruneStrategy: 'interval',
            mysqlPruneIntervalMs: 10,
            mysqlPruneBatchSize: 2,
            mysqlPruneMaxBatchesPerRun: 2,
          },
        },
      },
    },
    dbPool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [{ affectedRows: calls.length === 1 ? 2 : 0 }];
      },
    },
    logger: {
      info: (...args) => loggerCalls.push(args),
      warn: (...args) => loggerCalls.push(args),
    },
  });

  try {
    assert.equal(info.enabled, true);
    assert.equal(info.strategy, 'interval');
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.ok(calls.length >= 2);
    assert.equal(getRateLimitMaintenanceInfo().enabled, true);
    assert.ok(loggerCalls.length >= 1);
  } finally {
    stopRateLimitStoreMaintenance();
  }
  assert.equal(getRateLimitMaintenanceInfo().enabled, false);
});

test('initializeRateLimitStore falls back to memory when mysql migration/table is missing', async () => {
  const messages = [];
  const info = await initializeRateLimitStore({
    cfg: {
      security: {
        rateLimit: {
          store: {
            driver: 'mysql',
            fallbackDriver: 'memory',
            mysqlTable: 'rate_limit_counters',
          },
        },
      },
    },
    dbPool: {
      query: async (sql) => {
        if (String(sql).includes('information_schema.tables')) {
          return [[]];
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      },
    },
    logger: {
      warn: (...args) => messages.push(args),
    },
  });

  assert.equal(info.driver, 'memory');
  assert.equal(info.fallbackFrom, 'mysql');
  assert.equal(info.fallbackReason, 'rate_limit_mysql_table_missing');
  assert.equal(getRateLimitStoreInfo().driver, 'memory');
  assert.equal(messages.length, 1);

  await initializeRateLimitStore({ cfg: config, dbPool: pool, logger: console });
  resetRateLimitStore();
});

test('initializeRateLimitStore falls back to memory when redis store lacks a bootstrap client', async () => {
  const messages = [];
  const info = await initializeRateLimitStore({
    cfg: {
      security: {
        rateLimit: {
          store: {
            driver: 'redis',
            fallbackDriver: 'memory',
            redisUrl: 'redis://127.0.0.1:6379',
            redisKeyPrefix: 'rate-limit:',
          },
        },
      },
    },
    logger: {
      warn: (...args) => messages.push(args),
    },
  });

  assert.equal(info.driver, 'memory');
  assert.equal(info.fallbackFrom, 'redis');
  assert.equal(info.fallbackReason, 'rate_limit_redis_client_missing');
  assert.equal(messages.length, 1);

  await initializeRateLimitStore({ cfg: config, dbPool: pool, logger: console });
  resetRateLimitStore();
});

test('verifyWhatsAppWebhookSignature accepts a valid Meta signature', () => {
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: '1' }] }));
  const secret = 'meta-secret';
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const result = verifyWhatsAppWebhookSignature({
    headers: { 'x-hub-signature-256': `sha256=${digest}` },
    rawBody,
  }, { WA_APP_SECRET: secret });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'ok');
});

test('verifyWhatsAppWebhookSignature blocks invalid, altered, or missing Meta signatures and supports permissive fallback flags', () => {
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: '1' }] }));
  const secret = 'meta-secret';
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');

  const invalid = verifyWhatsAppWebhookSignature({
    headers: { 'x-hub-signature-256': 'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    rawBody,
  }, { WA_APP_SECRET: secret });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid_signature');

  const altered = verifyWhatsAppWebhookSignature({
    headers: { 'x-hub-signature-256': `sha256=${digest}` },
    rawBody: Buffer.from(JSON.stringify({ entry: [{ id: '2' }] })),
  }, { WA_APP_SECRET: secret });
  assert.equal(altered.ok, false);
  assert.equal(altered.reason, 'invalid_signature');

  const missingSignature = verifyWhatsAppWebhookSignature({
    headers: {},
    rawBody,
  }, { WA_APP_SECRET: secret });
  assert.equal(missingSignature.ok, false);
  assert.equal(missingSignature.reason, 'missing_signature');

  const missingSecret = verifyWhatsAppWebhookSignature({
    headers: {},
    rawBody,
  }, {});
  assert.equal(missingSecret.ok, true);
  assert.equal(missingSecret.skipped, 'missing_secret');

  const allowUnsigned = verifyWhatsAppWebhookSignature({
    headers: {},
    rawBody,
  }, { WA_APP_SECRET: secret, WA_WEBHOOK_ALLOW_UNSIGNED: 'true' });
  assert.equal(allowUnsigned.ok, true);
  assert.equal(allowUnsigned.skipped, 'allow_unsigned');
});

test('official WhatsApp webhook enforces signatures on both api and non-api aliases while keeping GET verification active', async () => {
  await withEnv({
    WA_APP_SECRET: 'meta-secret',
    WA_WEBHOOK_ALLOW_UNSIGNED: 'false',
    WA_VERIFY_TOKEN: 'verify-me',
  }, async () => {
    const app = createWhatsAppWebhookApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const challenge = await fetch(`${baseUrl}/wa/webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=verify-me`);
      assert.equal(challenge.status, 200);
      assert.equal(await challenge.text(), 'abc123');

      const validPayload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
      const validSignature = createHmac('sha256', 'meta-secret').update(validPayload).digest('hex');
      const valid = await fetch(`${baseUrl}/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${validSignature}`,
        },
        body: validPayload,
      });
      assert.equal(valid.status, 200);

      const altered = await fetch(`${baseUrl}/api/wa/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${validSignature}`,
        },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'changed' }] }),
      });
      assert.equal(altered.status, 403);

      const missing = await fetch(`${baseUrl}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: validPayload,
      });
      assert.equal(missing.status, 403);
    } finally {
      await stopServer(server);
    }
  });
});

test('official WhatsApp webhook keeps permissive compatibility only when secret is absent or unsigned mode is enabled', async () => {
  const app = createWhatsAppWebhookApp();
  const { server, baseUrl } = await startServer(app);
  try {
    await withEnv({
      WA_APP_SECRET: undefined,
      WA_WEBHOOK_ALLOW_UNSIGNED: 'false',
    }, async () => {
      const response = await fetch(`${baseUrl}/wa/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      });
      assert.equal(response.status, 200);
    });

    await withEnv({
      WA_APP_SECRET: 'meta-secret',
      WA_WEBHOOK_ALLOW_UNSIGNED: 'true',
    }, async () => {
      const response = await fetch(`${baseUrl}/api/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      });
      assert.equal(response.status, 200);
    });
  } finally {
    await stopServer(server);
  }
});

test('buildPublicDepositToken and verifyPublicDepositToken round-trip the scoped public deposit payload', () => {
  const env = { JWT_SECRET: 'jwt-secret', PUBLIC_DEPOSIT_TOKEN_DAYS: '15' };
  const token = buildPublicDepositToken({
    agendamentoId: 11,
    clienteId: 22,
    estabelecimentoId: 33,
    paymentId: 44,
  }, env);

  assert.ok(token);
  const verification = verifyPublicDepositToken(token, env);
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.agendamento_id, 11);
  assert.equal(verification.payload.cliente_id, 22);
  assert.equal(verification.payload.estabelecimento_id, 33);
  assert.equal(verification.payload.payment_id, 44);
});

test('canAccessPaymentStatus authorizes matching owner identities and payment-scoped public tokens without leaking private fields', () => {
  const payment = createPaymentRow({
    id: 7,
    agendamento_id: 55,
    estabelecimento_id: 22,
    cliente_id: 99,
  });

  assert.equal(
    canAccessPaymentStatus({ payment, user: { id: 22, tipo: 'estabelecimento' } }).ok,
    true
  );
  assert.equal(
    canAccessPaymentStatus({ payment, user: { id: 99, tipo: 'cliente' } }).ok,
    true
  );
  assert.deepEqual(
    canAccessPaymentStatus({
      payment,
      depositPayload: { agendamento_id: 55, estabelecimento_id: 22, cliente_id: 99, payment_id: 7 },
    }),
    { ok: true, mode: 'public_deposit_token' }
  );
  assert.equal(
    canAccessPaymentStatus({
      payment,
      user: { id: 500, tipo: 'cliente' },
      depositPayload: { agendamento_id: 55, estabelecimento_id: 22, cliente_id: 99, payment_id: 7 },
    }).ok,
    true
  );
  assert.equal(
    canAccessPaymentStatus({
      payment,
      depositPayload: { agendamento_id: 55, estabelecimento_id: 22, cliente_id: 99, payment_id: 8 },
    }).ok,
    false
  );
  assert.equal(
    canAccessPaymentStatus({
      payment,
      depositPayload: { agendamento_id: 55, estabelecimento_id: 22, cliente_id: 99 },
    }).ok,
    true
  );

  const publicResponse = serializePaymentStatusResponse(payment, { includePrivate: false });
  assert.equal('agendamento_id' in publicResponse, false);
  assert.equal('amount_centavos' in publicResponse, false);

  const privateResponse = serializePaymentStatusResponse(payment, { includePrivate: true });
  assert.equal(privateResponse.agendamento_id, 55);
  assert.equal(privateResponse.amount_centavos, 1500);
});

test('payment status route enforces owner-or-token access, preserves public redaction, and protects both api aliases', async () => {
  await withEnv({ JWT_SECRET: 'jwt-secret' }, async () => {
    const payment = createPaymentRow({ id: 101, agendamento_id: 501, estabelecimento_id: 11, cliente_id: 21 });
    const otherPayment = createPaymentRow({ id: 102, agendamento_id: 502, estabelecimento_id: 12, cliente_id: 22 });
    const paymentsById = new Map([
      [101, payment],
      [102, otherPayment],
    ]);
    const usersById = new Map([
      [11, createUserRow(11, 'estabelecimento')],
      [12, createUserRow(12, 'estabelecimento')],
      [21, createUserRow(21, 'cliente')],
      [22, createUserRow(22, 'cliente')],
      [77, createUserRow(77, 'cliente')],
    ]);
    const restorePoolQuery = installPoolQueryMock({ paymentsById, usersById });
    const app = createPaymentsApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const validPublicToken = buildPublicDepositToken({
        agendamentoId: 501,
        clienteId: 21,
        estabelecimentoId: 11,
        paymentId: 101,
      }, process.env);
      const otherPaymentToken = buildPublicDepositToken({
        agendamentoId: 501,
        clienteId: 21,
        estabelecimentoId: 11,
        paymentId: 102,
      }, process.env);
      const ownerClientJwt = createJwtToken(21, process.env.JWT_SECRET);
      const strangerClientJwt = createJwtToken(22, process.env.JWT_SECRET);
      const ownerEstJwt = createJwtToken(11, process.env.JWT_SECRET);
      const strangerEstJwt = createJwtToken(12, process.env.JWT_SECRET);
      const unrelatedClientJwt = createJwtToken(77, process.env.JWT_SECRET);

      const anonymous = await fetch(`${baseUrl}/payments/101/status`);
      assert.equal(anonymous.status, 404);

      const invalidToken = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { 'x-deposit-token': 'not-a-jwt' },
      });
      assert.equal(invalidToken.status, 404);

      const mismatchedToken = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { 'x-deposit-token': otherPaymentToken },
      });
      assert.equal(mismatchedToken.status, 404);

      const validPublic = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { 'x-deposit-token': validPublicToken },
      });
      assert.equal(validPublic.status, 200);
      const validPublicJson = await validPublic.json();
      assert.equal(validPublicJson.id, 101);
      assert.equal('agendamento_id' in validPublicJson, false);
      assert.equal('amount_centavos' in validPublicJson, false);

      const ownerClient = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { Authorization: `Bearer ${ownerClientJwt}` },
      });
      assert.equal(ownerClient.status, 200);
      const ownerClientJson = await ownerClient.json();
      assert.equal(ownerClientJson.agendamento_id, 501);
      assert.equal(ownerClientJson.amount_centavos, 1500);

      const strangerClient = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { Authorization: `Bearer ${strangerClientJwt}` },
      });
      assert.equal(strangerClient.status, 404);

      const ownerEst = await fetch(`${baseUrl}/api/payments/101/status`, {
        headers: { Authorization: `Bearer ${ownerEstJwt}` },
      });
      assert.equal(ownerEst.status, 200);
      const ownerEstJson = await ownerEst.json();
      assert.equal(ownerEstJson.agendamento_id, 501);
      assert.equal(ownerEstJson.amount_centavos, 1500);

      const strangerEst = await fetch(`${baseUrl}/api/payments/101/status`, {
        headers: { Authorization: `Bearer ${strangerEstJwt}` },
      });
      assert.equal(strangerEst.status, 404);

      const unrelatedAuthenticatedPublic = await fetch(`${baseUrl}/payments/101/status`, {
        headers: {
          Authorization: `Bearer ${unrelatedClientJwt}`,
          'x-deposit-token': validPublicToken,
        },
      });
      assert.equal(unrelatedAuthenticatedPublic.status, 200);
      const unrelatedAuthenticatedPublicJson = await unrelatedAuthenticatedPublic.json();
      assert.equal('agendamento_id' in unrelatedAuthenticatedPublicJson, false);
      assert.equal('amount_centavos' in unrelatedAuthenticatedPublicJson, false);
    } finally {
      await stopServer(server);
      restorePoolQuery();
    }
  });
});

test('payment status route rate limits public polling and marks legacy query token usage as deprecated', async () => {
  await withEnv({ JWT_SECRET: 'jwt-secret' }, async () => {
    const previous = { ...config.security.rateLimit.paymentStatusPublic };
    const previousLegacyQueryTokenConfig = { ...config.security.payments.legacyQueryToken };
    config.security.rateLimit.paymentStatusPublic.max = 2;
    config.security.rateLimit.paymentStatusPublic.windowMs = 60000;
    config.security.payments.legacyQueryToken.sunsetAt = '2026-12-31T00:00:00.000Z';
    config.security.payments.legacyQueryToken.deprecationUrl = 'https://example.com/deprecations/payments-query-token';
    resetRateLimitStore();

    const payment = createPaymentRow({ id: 101, agendamento_id: 501, estabelecimento_id: 11, cliente_id: 21 });
    const paymentsById = new Map([[101, payment]]);
    const usersById = new Map([
      [21, createUserRow(21, 'cliente')],
    ]);
    const restorePoolQuery = installPoolQueryMock({ paymentsById, usersById });
    const app = createPaymentsApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const validPublicToken = buildPublicDepositToken({
        agendamentoId: 501,
        clienteId: 21,
        estabelecimentoId: 11,
        paymentId: 101,
      }, process.env);
      const ownerClientJwt = createJwtToken(21, process.env.JWT_SECRET);

      const first = await fetch(`${baseUrl}/payments/101/status?token=${encodeURIComponent(validPublicToken)}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('deprecation'), 'true');
      assert.equal(first.headers.get('x-legacy-token-fallback'), 'query-param');
      assert.equal(first.headers.get('x-legacy-token-phase'), 'sunset_scheduled');
      assert.equal(first.headers.get('x-deprecated-replacement'), 'X-Deposit-Token');
      assert.equal(first.headers.get('sunset'), 'Thu, 31 Dec 2026 00:00:00 GMT');
      assert.ok(String(first.headers.get('link') || '').includes('rel="deprecation"'));

      const second = await fetch(`${baseUrl}/payments/101/status?token=${encodeURIComponent(validPublicToken)}`);
      assert.equal(second.status, 200);

      const third = await fetch(`${baseUrl}/payments/101/status?token=${encodeURIComponent(validPublicToken)}`);
      assert.equal(third.status, 429);
      assert.equal(third.headers.get('x-ratelimit-limit'), '2');

      const authenticated = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { Authorization: `Bearer ${ownerClientJwt}` },
      });
      assert.equal(authenticated.status, 200);
      assert.equal(authenticated.headers.get('deprecation'), null);
    } finally {
      await stopServer(server);
      restorePoolQuery();
      config.security.rateLimit.paymentStatusPublic.max = previous.max;
      config.security.rateLimit.paymentStatusPublic.windowMs = previous.windowMs;
      config.security.payments.legacyQueryToken.sunsetAt = previousLegacyQueryTokenConfig.sunsetAt ?? null;
      config.security.payments.legacyQueryToken.deprecationUrl = previousLegacyQueryTokenConfig.deprecationUrl ?? null;
      resetRateLimitStore();
    }
  });
});

test('payment status route can disable legacy query token fallback without breaking header token access', async () => {
  await withEnv({ JWT_SECRET: 'jwt-secret' }, async () => {
    const previousLegacyQueryTokenConfig = { ...config.security.payments.legacyQueryToken };
    config.security.payments.legacyQueryToken.enabled = false;
    config.security.payments.legacyQueryToken.sunsetAt = '2026-12-31T00:00:00.000Z';
    config.security.payments.legacyQueryToken.deprecationUrl = 'https://example.com/deprecations/payments-query-token';

    const payment = createPaymentRow({ id: 101, agendamento_id: 501, estabelecimento_id: 11, cliente_id: 21 });
    const paymentsById = new Map([[101, payment]]);
    const usersById = new Map([
      [21, createUserRow(21, 'cliente')],
    ]);
    const restorePoolQuery = installPoolQueryMock({ paymentsById, usersById });
    const app = createPaymentsApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const validPublicToken = buildPublicDepositToken({
        agendamentoId: 501,
        clienteId: 21,
        estabelecimentoId: 11,
        paymentId: 101,
      }, process.env);
      const ownerClientJwt = createJwtToken(21, process.env.JWT_SECRET);

      const legacyQuery = await fetch(`${baseUrl}/payments/101/status?token=${encodeURIComponent(validPublicToken)}`);
      assert.equal(legacyQuery.status, 404);
      assert.equal(legacyQuery.headers.get('deprecation'), null);

      const headerAccess = await fetch(`${baseUrl}/payments/101/status`, {
        headers: { 'x-deposit-token': validPublicToken },
      });
      assert.equal(headerAccess.status, 200);

      const authenticatedOwner = await fetch(`${baseUrl}/payments/101/status?token=${encodeURIComponent(validPublicToken)}`, {
        headers: { Authorization: `Bearer ${ownerClientJwt}` },
      });
      assert.equal(authenticatedOwner.status, 200);
      assert.equal(authenticatedOwner.headers.get('deprecation'), null);
    } finally {
      await stopServer(server);
      restorePoolQuery();
      config.security.payments.legacyQueryToken.enabled = previousLegacyQueryTokenConfig.enabled;
      config.security.payments.legacyQueryToken.sunsetAt = previousLegacyQueryTokenConfig.sunsetAt ?? null;
      config.security.payments.legacyQueryToken.deprecationUrl = previousLegacyQueryTokenConfig.deprecationUrl ?? null;
    }
  });
});

test('payment status route rejects invalid JWTs before payment lookup to avoid ID enumeration leaks', async () => {
  await withEnv({ JWT_SECRET: 'jwt-secret' }, async () => {
    const sqlLog = [];
    const restorePoolQuery = installPoolQueryMock({ sqlLog });
    const app = createPaymentsApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const headers = { Authorization: 'Bearer definitely-not-a-jwt' };
      const existing = await fetch(`${baseUrl}/payments/101/status`, { headers });
      const missing = await fetch(`${baseUrl}/payments/999/status`, { headers });

      assert.equal(existing.status, 403);
      assert.equal(missing.status, 403);
      assert.equal(sqlLog.length, 0);
    } finally {
      await stopServer(server);
      restorePoolQuery();
    }
  });
});

test('billing webhook health route is gated on both api aliases and does not accept bearer fallback tokens', async () => {
  await withEnv({
    BILLING_WEBHOOK_HEALTH_TOKEN: 'billing-health-secret',
    ADMIN_TOKEN: 'admin-secret',
  }, async () => {
    const app = createBillingApp();
    const { server, baseUrl } = await startServer(app);
    try {
      const anonymous = await fetch(`${baseUrl}/billing/webhook/health`);
      assert.equal(anonymous.status, 404);

      const invalid = await fetch(`${baseUrl}/api/billing/webhook/health`, {
        headers: { 'x-billing-health-token': 'wrong' },
      });
      assert.equal(invalid.status, 404);

      const headAnonymous = await fetch(`${baseUrl}/billing/webhook/health`, { method: 'HEAD' });
      assert.equal(headAnonymous.status, 404);

      const postAnonymous = await fetch(`${baseUrl}/billing/webhook/health`, { method: 'POST' });
      assert.equal(postAnonymous.status, 404);

      const bearerFallback = await fetch(`${baseUrl}/billing/webhook/health`, {
        headers: { Authorization: 'Bearer billing-health-secret' },
      });
      assert.equal(bearerFallback.status, 404);

      const tokenAccess = await fetch(`${baseUrl}/billing/webhook/health`, {
        headers: { 'x-billing-health-token': 'billing-health-secret' },
      });
      assert.equal(tokenAccess.status, 200);

      const adminAccess = await fetch(`${baseUrl}/api/billing/webhook/health`, {
        headers: { 'x-admin-token': 'admin-secret' },
      });
      assert.equal(adminAccess.status, 200);
    } finally {
      await stopServer(server);
    }
  });
});

test('legacy Mercado Pago alias ignores unsigned abuse, accepts valid signed callbacks, and gates GET probes', async () => {
  await withEnv({
    BILLING_WEBHOOK_HEALTH_TOKEN: 'billing-health-secret',
    ADMIN_TOKEN: 'admin-secret',
    MERCADOPAGO_WEBHOOK_SECRET: 'mp-secret',
  }, async () => {
    const app = express();
    mountWebhooks(app, true);
    const { server, baseUrl } = await startServer(app);
    try {
      const noSignature = await fetch(`${baseUrl}/webhook/mercadopago?type=payment&id=pay_1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(noSignature.status, 200);
      assert.equal(await noSignature.text(), 'IGNORED');

      const invalidSignature = await fetch(`${baseUrl}/api/webhook/mercadopago?type=payment&id=pay_1`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-invalid',
          'x-signature': 'ts=1710000000,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        body: JSON.stringify({}),
      });
      assert.equal(invalidSignature.status, 200);
      assert.equal(await invalidSignature.text(), 'IGNORED');

      const ts = '1710000000';
      const requestId = 'req-valid';
      const signature = createMercadoPagoSignature({
        id: 'pay_1',
        requestId,
        ts,
        secret: 'mp-secret',
      });
      const validSignature = await fetch(`${baseUrl}/webhook/mercadopago?type=payment&id=pay_1`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
          'x-signature': signature,
        },
        body: JSON.stringify({}),
      });
      assert.equal(validSignature.status, 200);
      assert.equal(await validSignature.text(), 'OK');

      const getAnonymous = await fetch(`${baseUrl}/webhook/mercadopago`);
      assert.equal(getAnonymous.status, 404);

      const getBearerFallback = await fetch(`${baseUrl}/api/webhook/mercadopago`, {
        headers: { Authorization: 'Bearer billing-health-secret' },
      });
      assert.equal(getBearerFallback.status, 404);

      const getAuthorized = await fetch(`${baseUrl}/api/webhook/mercadopago`, {
        headers: { 'x-billing-health-token': 'billing-health-secret' },
      });
      assert.equal(getAuthorized.status, 200);
      assert.equal(await getAuthorized.text(), 'OK');
    } finally {
      await stopServer(server);
    }
  });
});

test('resolveRouteTokenAccess still accepts configured custom tokens from explicit headers', () => {
  const req = {
    headers: {
      'x-notify-token': 'notify-secret',
    },
  };
  const result = resolveRouteTokenAccess(req, {
    env: { NOTIFY_ROUTE_TOKEN: 'notify-secret', ADMIN_TOKEN: 'admin-secret' },
    envNames: ['NOTIFY_ROUTE_TOKEN', 'ADMIN_TOKEN'],
    headerNames: ['x-notify-token', 'x-admin-token'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'header:x-notify-token');
});

// Sem isto o processo NUNCA encerra: initializeRateLimitStore() acima abre conexoes no
// pool do MySQL (e agenda a manutencao), e handles abertos seguram o event loop. O teste
// passava e o runner matava o arquivo por timeout — motivo real de `node --test tests/`
// nunca ter rodado de ponta a ponta, e de a suite completa nunca ter virado gate de CI.
after(async () => {
  stopRateLimitStoreMaintenance();
  resetRateLimitStore();
  await pool.end();
});
