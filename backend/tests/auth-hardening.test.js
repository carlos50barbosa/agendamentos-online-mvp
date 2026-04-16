import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

import authRouter from '../src/routes/auth.js';
import { pool } from '../src/lib/db.js';
import { config } from '../src/lib/config.js';
import { resetRateLimitStore } from '../src/lib/request_rate_limit.js';
import { classifySuspiciousRequest, maskIpForLog, normalizeRequestId } from '../src/lib/route_access.js';

function createAuthApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = normalizeRequestId(req.headers['x-request-id']) || 'test-request-id';
    res.set('X-Request-Id', req.requestId);
    next();
  });
  app.use('/auth', authRouter);
  app.use('/api/auth', authRouter);
  return app;
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

function withPoolQueryMock(mock) {
  const original = pool.query;
  pool.query = mock;
  return () => {
    pool.query = original;
  };
}

test('login rate limit is shared across /auth and /api/auth aliases', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const previous = { ...config.security.rateLimit.auth.login };
  config.security.rateLimit.auth.login.windowMs = 60000;
  config.security.rateLimit.auth.login.max = 2;
  config.security.rateLimit.auth.login.accountWindowMs = 60000;
  config.security.rateLimit.auth.login.accountMax = 2;
  resetRateLimitStore();

  const restorePool = withPoolQueryMock(async () => [[]]);
  const { server, baseUrl } = await startServer(createAuthApp());
  try {
    const payload = { email: 'scan@example.com', senha: '123456' };
    const first = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 401);

    const second = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 401);

    const third = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('x-ratelimit-limit'), '2');
    assert.equal(third.headers.get('x-request-id'), 'test-request-id');
  } finally {
    await stopServer(server);
    restorePool();
    config.security.rateLimit.auth.login.windowMs = previous.windowMs;
    config.security.rateLimit.auth.login.max = previous.max;
    config.security.rateLimit.auth.login.accountWindowMs = previous.accountWindowMs;
    config.security.rateLimit.auth.login.accountMax = previous.accountMax;
    resetRateLimitStore();
  }
});

test('forgot password keeps neutral response and rate limits repeated requests', async () => {
  const previous = { ...config.security.rateLimit.auth.forgot };
  config.security.rateLimit.auth.forgot.windowMs = 60000;
  config.security.rateLimit.auth.forgot.max = 2;
  config.security.rateLimit.auth.forgot.accountWindowMs = 60000;
  config.security.rateLimit.auth.forgot.accountMax = 2;
  resetRateLimitStore();

  const restorePool = withPoolQueryMock(async () => [[]]);
  const { server, baseUrl } = await startServer(createAuthApp());
  try {
    const payload = { email: 'missing@example.com' };
    const first = await fetch(`${baseUrl}/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });

    const second = await fetch(`${baseUrl}/api/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 200);

    const third = await fetch(`${baseUrl}/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(third.status, 429);
  } finally {
    await stopServer(server);
    restorePool();
    config.security.rateLimit.auth.forgot.windowMs = previous.windowMs;
    config.security.rateLimit.auth.forgot.max = previous.max;
    config.security.rateLimit.auth.forgot.accountWindowMs = previous.accountWindowMs;
    config.security.rateLimit.auth.forgot.accountMax = previous.accountMax;
    resetRateLimitStore();
  }
});

test('reset password rate limits repeated invalid attempts by IP', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const previous = { ...config.security.rateLimit.auth.reset };
  config.security.rateLimit.auth.reset.windowMs = 60000;
  config.security.rateLimit.auth.reset.max = 2;
  resetRateLimitStore();

  const restorePool = withPoolQueryMock(async () => {
    throw new Error('pool.query should not run for invalid token');
  });
  const { server, baseUrl } = await startServer(createAuthApp());
  try {
    const payload = { token: 'invalid-token', senha: '123456' };
    const first = await fetch(`${baseUrl}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 400);

    const second = await fetch(`${baseUrl}/api/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 400);

    const third = await fetch(`${baseUrl}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(third.status, 429);
  } finally {
    await stopServer(server);
    restorePool();
    config.security.rateLimit.auth.reset.windowMs = previous.windowMs;
    config.security.rateLimit.auth.reset.max = previous.max;
    resetRateLimitStore();
  }
});

test('route access helpers mask IPs and classify suspicious scan paths', () => {
  assert.equal(maskIpForLog('203.0.113.42'), '203.0.113.0');
  assert.match(maskIpForLog('2001:db8:abcd:0012::1'), /^2001:db8:abcd:\*/);

  const reasons = classifySuspiciousRequest({
    method: 'GET',
    originalUrl: '/api/raster/search/?band=1)%20AND%20CAST((SELECT%20version())%20AS%20INT)--',
  });
  assert.ok(reasons.includes('suspicious_path'));
  assert.ok(reasons.includes('suspicious_query'));
});
