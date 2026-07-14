import assert from 'node:assert/strict';
import test from 'node:test';

import { getClientIp, getClientIpInfo, hasTrustedProxy, normalizeIpCandidate } from '../src/lib/client_ip.js';
import {
  getRequestAccessLogContext,
  logBlockedRouteAccess,
  maskIpForLog,
  resetSecurityEventCounters,
} from '../src/lib/route_access.js';

function reqWithTrustProxy(trustProxy, overrides = {}) {
  return {
    headers: {},
    ip: '10.0.0.10',
    ips: [],
    socket: { remoteAddress: '10.0.0.10' },
    app: {
      get(name) {
        return name === 'trust proxy' ? trustProxy : undefined;
      },
    },
    ...overrides,
  };
}

test('getClientIp ignores forwarded headers when trust proxy is disabled', () => {
  const req = reqWithTrustProxy(false, {
    headers: {
      'x-forwarded-for': '203.0.113.10',
      'x-real-ip': '203.0.113.11',
      'cf-connecting-ip': '203.0.113.12',
    },
  });

  const info = getClientIpInfo(req);
  assert.equal(info.ip, '10.0.0.10');
  assert.equal(info.source, 'req.ip');
  assert.equal(info.trusted_proxy, false);
});

test('getClientIp prioritizes trusted proxy headers when trust proxy is enabled', () => {
  const req = reqWithTrustProxy(1, {
    headers: {
      'x-forwarded-for': '198.51.100.20, 10.0.0.1',
      'x-real-ip': '198.51.100.21',
      'cf-connecting-ip': '198.51.100.22',
    },
    ip: '198.51.100.20',
    ips: ['198.51.100.20', '10.0.0.1'],
  });

  const info = getClientIpInfo(req);
  assert.equal(info.ip, '198.51.100.22');
  assert.equal(info.source, 'header:cf-connecting-ip');
  assert.deepEqual(info.req_ips, ['198.51.100.20', '10.0.0.1']);
});

test('getClientIp falls back to Express req.ip before raw x-forwarded-for', () => {
  const req = reqWithTrustProxy(1, {
    headers: {
      'x-forwarded-for': '198.51.100.30, 10.0.0.1',
    },
    ip: '198.51.100.31',
  });

  const info = getClientIpInfo(req);
  assert.equal(getClientIp(req), '198.51.100.31');
  assert.equal(info.source, 'req.ip');
});

test('IP utilities normalize mapped IPv4 and preserve masked log output', () => {
  assert.equal(normalizeIpCandidate('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIpCandidate('127.0.0.1:12345'), '127.0.0.1');
  assert.equal(maskIpForLog('17.22.237.42'), '17.22.237.0');
});

test('access log context exposes diagnostics without trusting spoofed headers', () => {
  const req = reqWithTrustProxy(false, {
    method: 'GET',
    originalUrl: '/health?x=1',
    requestId: 'req-1',
    headers: {
      'x-forwarded-for': '203.0.113.50',
      'user-agent': 'unit-test',
    },
  });

  const context = getRequestAccessLogContext(req);
  assert.equal(context.ip, '10.0.0.10');
  assert.equal(context.ip_masked, '10.0.0.0');
  assert.equal(context.x_forwarded_for, '203.0.113.50');
  assert.equal(context.user_agent, 'unit-test');
  assert.equal(hasTrustedProxy(req), false);
});

test('security logs omit full IP diagnostics in production unless explicitly enabled', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousLogFullIp = process.env.LOG_FULL_IP;
  const originalWarn = console.warn;
  const calls = [];
  process.env.NODE_ENV = 'production';
  process.env.LOG_FULL_IP = 'false';
  console.warn = (...args) => calls.push(args);

  try {
    logBlockedRouteAccess('client-ip-test', reqWithTrustProxy(false, {
      method: 'GET',
      originalUrl: '/blocked',
      headers: { 'x-forwarded-for': '203.0.113.60' },
    }));
  } finally {
    console.warn = originalWarn;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousLogFullIp === undefined) delete process.env.LOG_FULL_IP;
    else process.env.LOG_FULL_IP = previousLogFullIp;
    resetSecurityEventCounters();
  }

  assert.equal(calls.length, 1);
  const payload = calls[0][1];
  assert.equal(payload.ip, '10.0.0.0');
  assert.equal('req_ip' in payload, false);
  assert.equal('x_forwarded_for' in payload, false);
});

// --- IP no log de segurança: NODE_ENV ausente NÃO pode expor -------------------------------------
//
// Regressão de um bug que estava VIVO em produção. A VPS não seta NODE_ENV (os logs saem com
// `"env":"unknown"`), e `shouldExposeFullIpDiagnostics` tinha um `!nodeEnv ||`: "ambiente
// desconhecido -> pode expor". Ou seja, a redação estava desligada exatamente onde ela existe para
// atuar. O log de segurança (login falho, rate limit, requisição suspeita) gravava o IP COMPLETO de
// cada visitante no disco — enquanto o log de acesso comum, ao lado, anonimizava certinho.
//
// O que enganava: o campo `ip` SEMPRE veio mascarado (191.52.219.0). Quem vazava eram os campos de
// diagnóstico — req_ip, x_real_ip, x_forwarded_for, socket_remote_address —, e ninguém olha para
// eles.
//
// A mesma função em index.js (#shouldLogFullIpDiagnostics) já tinha sido corrigida, com comentário
// explicando o porquê. O gêmeo daqui ficou para trás. É o tipo de bug que volta: por isso o teste.

const IP_REAL = '191.52.219.77';

function reqDeVisitante() {
  return {
    method: 'POST',
    originalUrl: '/api/auth/login',
    path: '/api/auth/login',
    headers: {
      'x-real-ip': IP_REAL,
      'x-forwarded-for': IP_REAL,
      'user-agent': 'curl/8',
    },
    ip: IP_REAL,
    ips: [IP_REAL],
    socket: { remoteAddress: IP_REAL },
  };
}

/** Roda logSecurityEvent com um NODE_ENV específico e devolve o que foi para o log, em texto. */
async function logComEnv(nodeEnv) {
  const anterior = process.env.NODE_ENV;
  const anteriorFull = process.env.LOG_FULL_IP;
  delete process.env.LOG_FULL_IP;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;

  const { logSecurityEvent } = await import('../src/lib/route_access.js');
  let capturado = '';
  const originais = { warn: console.warn, error: console.error };
  console.warn = (_msg, obj) => { capturado = JSON.stringify(obj ?? {}); };
  console.error = console.warn;
  try {
    resetSecurityEventCounters();
    logSecurityEvent('auth:login_failed', reqDeVisitante());
  } finally {
    console.warn = originais.warn;
    console.error = originais.error;
    if (anterior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = anterior;
    if (anteriorFull === undefined) delete process.env.LOG_FULL_IP; else process.env.LOG_FULL_IP = anteriorFull;
  }
  return capturado;
}

test('NODE_ENV ausente (o caso da produção): o log de segurança NÃO leva o IP completo', async () => {
  const log = await logComEnv(undefined);
  assert.ok(!log.includes(IP_REAL), `o IP completo vazou para o log de segurança: ${log}`);
  assert.ok(log.includes(maskIpForLog(IP_REAL)), 'o IP mascarado deveria continuar lá — sem ele não dá para investigar nada');
});

test('NODE_ENV=production: idem', async () => {
  const log = await logComEnv('production');
  assert.ok(!log.includes(IP_REAL), `o IP completo vazou para o log de segurança: ${log}`);
});

test('em desenvolvimento o IP completo aparece — quem depura precisa dele', async () => {
  const log = await logComEnv('development');
  assert.ok(log.includes(IP_REAL), 'em dev a exposição é deliberada; sem ela não se investiga um bloqueio local');
});
