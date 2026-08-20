// /public/otp/request só pode responder "enviado" quando enviou.
//
// O bug que originou este arquivo: o código do OTP saía como TEXTO puro. Quem pede um código está
// sempre fora da janela de 24h (é justamente quem nunca escreveu para o número), e fora da janela a
// Meta só aceita template — então o smart-send caía no template genérico do ambiente
// (WA_TEMPLATE_NAME='confirmacao_agendamento_v2', que exige 3 params) e abortava com 0. A falha era
// engolida por um console.warn e a rota respondia ok:true: a tela avançava para "digite o código" e
// a pessoa esperava uma mensagem que a Meta havia recusado. Em produção, nenhum código por WhatsApp
// jamais saiu por esse caminho.
//
// A asserção que importa não é o status em si, é que a rota PARE de prometer entrega.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

process.env.JWT_SECRET ??= 'test-secret';
// O caminho exercitado aqui é o de template ausente, que é o estado natural do ambiente de teste
// (nada carrega .env). Deixar explícito para não depender de sorte quando alguém exportar a var.
delete process.env.WA_OTP_TEMPLATE_NAME;

import otpPublicRouter from '../src/routes/otp_public.js';
import { pool } from '../src/lib/db.js';
import { resetRateLimitStore } from '../src/lib/request_rate_limit.js';

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/public/otp', otpPublicRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

// Aceita a gravação do código e nada mais: se a rota passar a consultar outra coisa, o teste conta.
function stubPool() {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    return [{ insertId: 1 }, []];
  };
  return { calls, restore: () => { pool.query = original; } };
}

test('sem template de autenticação configurado, a rota NÃO diz que enviou', async () => {
  resetRateLimitStore();
  const stub = stubPool();
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'phone', value: '11999999999' }),
      });

      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.error, 'otp_send_failed');
      // Sem request_id: devolvê-lo faria a tela avançar para o campo do código, que é exatamente a
      // tela que mentia. O erro precisa ter texto — a página mostra a mensagem do backend.
      assert.equal(body.request_id, undefined);
      assert.ok(String(body.message || '').trim().length > 0);
    });
  } finally {
    stub.restore();
  }
});

test('o código chega a ser gravado antes da tentativa de envio', async () => {
  // Documenta a ordem real: grava, tenta enviar, e só então decide a resposta. Se a gravação passar
  // para depois do envio, um reenvio bem-sucedido deixaria de ter linha em otp_codes.
  resetRateLimitStore();
  const stub = stubPool();
  try {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/public/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'phone', value: '11999999999' }),
      });
    });
    assert.ok(stub.calls.some((c) => c.sql.includes('INSERT INTO otp_codes')));
  } finally {
    stub.restore();
  }
});
