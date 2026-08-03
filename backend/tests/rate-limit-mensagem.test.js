// O 429 tem que falar português.
//
// O corpo era `{ error: 'rate_limited' }`. O api.js do front monta a mensagem do erro com
// `data.message || data.error` e a tela imprime direto — entao a pessoa lia a string
// `rate_limited` em vermelho, sem tradução, sem prazo e sem saída.
//
// Em 02/08/2026 uma dona de salão vinda de anúncio pago levou esse texto no login e tentou entrar
// 29 vezes em 10 minutos. Ela ainda não tinha conta, e a tela não dizia nem isso nem "espere".
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRateLimitBody,
  createRateLimitMiddleware,
  describeRetryAfter,
  resetRateLimitStore,
} from '../src/lib/request_rate_limit.js';

test('a espera e' + ' dita em minutos inteiros, arredondando para cima', () => {
  // 361s foi o valor real do log dela: 6m01s. Dizer "6 minutos" faria a proxima tentativa falhar.
  assert.equal(describeRetryAfter(361), '7 minutos');
  assert.equal(describeRetryAfter(60), '1 minuto');
  assert.equal(describeRetryAfter(61), '2 minutos');
  assert.equal(describeRetryAfter(59), 'menos de 1 minuto');
  assert.equal(describeRetryAfter(1), 'menos de 1 minuto');
});

test('valor ausente ou absurdo nao vira "NaN minutos" na cara do usuario', () => {
  for (const entrada of [null, undefined, 0, -5, 'abc', NaN, Infinity]) {
    const texto = describeRetryAfter(entrada);
    assert.equal(texto, 'alguns instantes', `entrada ${JSON.stringify(String(entrada))}`);
    assert.ok(!/NaN|undefined|null/.test(texto));
  }
});

test('o corpo do 429 carrega mensagem legivel, codigo e prazo', () => {
  const body = buildRateLimitBody({ retryAfterSec: 361 });
  assert.equal(body.error, 'rate_limited', 'o codigo continua, para quem trata por codigo');
  assert.equal(body.message, 'Muitas tentativas seguidas. Aguarde 7 minutos e tente novamente.');
  assert.equal(body.retry_after_sec, 361, 'o prazo cru serve para contagem regressiva na tela');
});

test('o que a tela de login mostraria', () => {
  // A expressao real do Login.jsx: err?.data?.message || err?.message.
  const data = buildRateLimitBody({ retryAfterSec: 120 });
  const naTela = data?.message || 'rate_limited';
  assert.match(naTela, /^Muitas tentativas/);
  assert.ok(!naTela.includes('rate_limited'), 'a pessoa nunca deve ver o codigo cru');
});

test('extras entram no corpo sem apagar a mensagem', () => {
  const body = buildRateLimitBody({ retryAfterSec: 30 }, { request_id: 'abc-123' });
  assert.equal(body.request_id, 'abc-123');
  assert.match(body.message, /menos de 1 minuto/);
});

test('o middleware generico responde com o corpo legivel quando ninguem passa o seu', async () => {
  await resetRateLimitStore();
  const middleware = createRateLimitMiddleware({ routeKey: 'teste', max: 1, windowMs: 60000 });

  const req = { method: 'GET', originalUrl: '/teste', headers: {}, ip: '203.0.113.7', socket: {} };
  const chamar = () => new Promise((resolve) => {
    const res = {
      set() { return res; },
      status(code) { res.statusCode = code; return res; },
      json(payload) { resolve({ status: res.statusCode, payload }); return res; },
    };
    middleware(req, res, () => resolve({ status: 200, payload: null }));
  });

  assert.equal((await chamar()).status, 200, 'a primeira passa');
  const bloqueada = await chamar();
  assert.equal(bloqueada.status, 429);
  assert.equal(bloqueada.payload.error, 'rate_limited');
  assert.match(bloqueada.payload.message, /^Muitas tentativas seguidas\./);
  await resetRateLimitStore();
});

test('corpo proprio continua mandando no seu — billing.js depende disso', async () => {
  await resetRateLimitStore();
  const meuCorpo = { error: 'meu_erro', message: 'texto do chamador' };
  const middleware = createRateLimitMiddleware({
    routeKey: 'teste2', max: 1, windowMs: 60000, responseBody: meuCorpo,
  });

  const req = { method: 'GET', originalUrl: '/teste2', headers: {}, ip: '203.0.113.9', socket: {} };
  const chamar = () => new Promise((resolve) => {
    const res = {
      set() { return res; },
      status(code) { res.statusCode = code; return res; },
      json(payload) { resolve({ status: res.statusCode, payload }); return res; },
    };
    middleware(req, res, () => resolve({ status: 200, payload: null }));
  });

  await chamar();
  const bloqueada = await chamar();
  assert.deepEqual(bloqueada.payload, meuCorpo);
  await resetRateLimitStore();
});
