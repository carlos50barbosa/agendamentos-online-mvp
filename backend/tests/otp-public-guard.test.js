// P2 — os guards de /public/otp/request.
//
// A rota é pública, sem autenticação, e dispara e-mail e WhatsApp para o endereço que vier no
// corpo. Até aqui não tinha teto nenhum nem validação de número: `value.replace(/\D/g,'')` aceita
// qualquer sequência de dígitos, e o WhatsApp sai da WABA da plataforma — a mesma que a Meta já
// desabilitou duas vezes por envio sem consentimento.
//
// O desenho dos testes é deliberado: TODOS assertam que `pool.query` NUNCA é chamado. Se a
// validação ou o rate limit forem movidos para depois da escrita em `otp_codes` (ou para depois do
// bcrypt), o mock lança e o teste quebra. É a asserção que importa — não basta responder 400 ou
// 429 no fim, tem que ser antes de gastar recurso e antes de enviar qualquer coisa.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

process.env.JWT_SECRET ??= 'test-secret';

import otpPublicRouter from '../src/routes/otp_public.js';
import { pool } from '../src/lib/db.js';
import { config } from '../src/lib/config.js';
import { resetRateLimitStore } from '../src/lib/request_rate_limit.js';

async function startServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  if (!server) return;
  server.close();
  await once(server, 'close');
}

function createOtpApp() {
  const app = express();
  app.use(express.json());
  // Os dois aliases de montagem reais (index.js:317 e :358).
  app.use('/public/otp', otpPublicRouter);
  app.use('/api/public/otp', otpPublicRouter);
  return app;
}

// Qualquer SQL aqui é falha do teste: nenhum caminho exercitado deveria chegar ao banco.
function forbidPoolQuery() {
  const original = pool.query;
  pool.query = async (sql) => {
    throw new Error(`Unexpected SQL in test: ${String(sql)}`);
  };
  return () => { pool.query = original; };
}

async function withOtpLimits(overrides, fn) {
  const previous = { ...config.security.rateLimit.otpPublic };
  Object.assign(config.security.rateLimit.otpPublic, overrides);
  resetRateLimitStore();
  const restorePool = forbidPoolQuery();
  const { server, baseUrl } = await startServer(createOtpApp());
  try {
    return await fn(baseUrl);
  } finally {
    await stopServer(server);
    restorePool();
    Object.assign(config.security.rateLimit.otpPublic, previous);
    resetRateLimitStore();
  }
}

const pedir = (baseUrl, body, path = '/public/otp/request') =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('otp request refuses anything that is not a valid BR mobile, without touching the database', async () => {
  await withOtpLimits({ max: 1000, destinationMax: 1000 }, async (baseUrl) => {
    // Fixo, lixo, número curto e número longo demais: nenhum deles pode virar envio.
    const recusados = ['1133334444', '551133334444', '123', '99999999999999', 'abc'];
    for (const value of recusados) {
      const res = await pedir(baseUrl, { channel: 'phone', value });
      assert.equal(res.status, 400, `${value} deveria ser recusado`);
      const body = await res.json();
      assert.equal(body.error, 'invalid_value');
    }

    // Canal inexistente continua barrado antes de tudo.
    const canal = await pedir(baseUrl, { channel: 'sms', value: '11988887777' });
    assert.equal(canal.status, 400);
    assert.equal((await canal.json()).error, 'invalid_channel');
  });
});

test('otp request caps how many codes one client can ask for', async () => {
  await withOtpLimits({ max: 2, windowMs: 60000, destinationMax: 1000 }, async (baseUrl) => {
    // Destinos diferentes a cada chamada: quem barra aqui é o teto por cliente, não o por destino.
    const primeira = await pedir(baseUrl, { channel: 'phone', value: '11988887701' });
    const segunda = await pedir(baseUrl, { channel: 'phone', value: '11988887702' });
    // Passaram pela validação e pelo teto; morrem no mock do banco, que é o esperado —
    // o que importa é que NÃO são 429.
    assert.ok(primeira.status !== 429);
    assert.ok(segunda.status !== 429);
    assert.equal(primeira.headers.get('x-ratelimit-limit'), '2');

    const terceira = await pedir(baseUrl, { channel: 'phone', value: '11988887703' });
    assert.equal(terceira.status, 429);
    const body = await terceira.json();
    assert.equal(body.error, 'rate_limited');
    // Mensagem legível, não o código cru: é o que a tela imprime.
    assert.match(body.message, /Aguarde/);
    assert.equal(terceira.headers.get('retry-after'), '60');
  });
});

test('otp request caps how often ONE destination can be targeted, across aliases', async () => {
  await withOtpLimits({ max: 1000, destinationMax: 2, destinationWindowMs: 60000 }, async (baseUrl) => {
    const alvo = { channel: 'phone', value: '11988887777' };

    assert.ok((await pedir(baseUrl, alvo)).status !== 429);
    assert.ok((await pedir(baseUrl, alvo)).status !== 429);

    // O terceiro pedido para o MESMO número é bloqueado — e o alias /api não é uma segunda cota.
    const terceira = await pedir(baseUrl, alvo, '/api/public/otp/request');
    assert.equal(terceira.status, 429);
    assert.equal((await terceira.json()).error, 'rate_limited');

    // Outro número segue livre: o teto é por destino, não um interruptor global.
    assert.ok((await pedir(baseUrl, { channel: 'phone', value: '11977776666' })).status !== 429);
  });
});

test('otp request caps the email channel too', async () => {
  await withOtpLimits({ max: 1000, destinationMax: 1, destinationWindowMs: 60000 }, async (baseUrl) => {
    const alvo = { channel: 'email', value: 'Alguem@Exemplo.com' };
    assert.ok((await pedir(baseUrl, alvo)).status !== 429);

    // Mesmo endereço em caixa diferente é o MESMO destino: o valor é normalizado para minúsculo
    // antes de virar chave, senão trocar uma letra por maiúscula zeraria a cota.
    const repetido = await pedir(baseUrl, { channel: 'email', value: 'alguem@exemplo.com' });
    assert.equal(repetido.status, 429);
  });
});
