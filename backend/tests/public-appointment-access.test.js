// Os dois caminhos de acesso do cliente SEM login aos próprios agendamentos.
//
// O fluxo público cria a conta do convidado com e-mail placeholder e senha aleatória: /cliente é
// porta trancada para ela. Estes testes protegem a fronteira que substitui o login:
//
//   1. token de LEITURA na URL  -> UM agendamento, o que a pessoa acabou de fazer.
//   2. otp_token (código)       -> a LISTA inteira daquele telefone/e-mail.
//
// A separação é o ponto. O telefone digitado no wizard nunca é verificado, então a credencial da
// URL prova apenas "alguém digitou este número". Se ela passasse a abrir a lista, bastaria agendar
// com o celular de um estranho para ler a agenda dele. Os testes de escopo abaixo existem para que
// um refactor não funda as duas coisas de novo.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

process.env.JWT_SECRET ??= 'test-secret';

import publicAgendamentosRouter from '../src/routes/agendamentos_public.js';
import { pool } from '../src/lib/db.js';
import { buildPublicAppointmentToken, verifyPublicAppointmentToken } from '../src/lib/public_appointment_token.js';
import { buildPublicDepositToken } from '../src/lib/public_deposit_token.js';
import jwt from 'jsonwebtoken';

const PHONE_DIGITS = '11999999999';
const PHONE_NORM = '5511999999999';

function otpToken({ ch = 'phone', v = PHONE_DIGITS } = {}) {
  return jwt.sign({ scope: 'otp', ch, v, rid: 'rid-test' }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/public/agendamentos', publicAgendamentosRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  if (!server) return;
  server.close();
  await once(server, 'close');
}

// Roteia por trecho de SQL. `null` como resposta = "nenhuma linha".
function stubPool(routes) {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    for (const [needle, rows] of routes) {
      if (text.includes(needle)) return [rows || [], []];
    }
    throw new Error(`SQL inesperado no teste: ${text.slice(0, 120)}`);
  };
  return { calls, restore: () => { pool.query = original; } };
}

// Nenhum caminho recusado pode chegar ao banco: negar depois de consultar já gastou o recurso que
// o guard existe para proteger.
function forbidPoolQuery() {
  const original = pool.query;
  pool.query = async (sql) => { throw new Error(`SQL inesperado: ${String(sql)}`); };
  return () => { pool.query = original; };
}

async function withServer(fn) {
  const { server, baseUrl } = await startServer();
  try {
    await fn(baseUrl);
  } finally {
    await stopServer(server);
  }
}

/* ───────────────────────── token de leitura: escopo ───────────────────────── */

test('token de leitura faz round-trip e carrega o agendamento', () => {
  const token = buildPublicAppointmentToken({ agendamentoId: 42, clienteId: 7, estabelecimentoId: 194 });
  const check = verifyPublicAppointmentToken(token);
  assert.equal(check.ok, true);
  assert.equal(check.payload.agendamento_id, 42);
  assert.equal(check.payload.scope, 'public_appointment');
});

test('token de SINAL não passa por token de leitura (escopos separados)', () => {
  const deposit = buildPublicDepositToken({
    agendamentoId: 42, clienteId: 7, estabelecimentoId: 194, paymentId: 9,
  });
  const check = verifyPublicAppointmentToken(deposit);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'invalid_scope');
});

/* ───────────────────────── GET /:id — um agendamento ───────────────────────── */

test('GET /:id aceita o token de leitura e não devolve deposit_token', async () => {
  const stub = stubPool([
    ['FROM agendamentos a', [{ id: 42, cliente_id: 7, estabelecimento_id: 194, status: 'confirmado', inicio: new Date(), fim: new Date() }]],
    ['FROM agendamento_itens ai', [{ agendamento_id: 42, servico_id: 10, ordem: 1, duracao_min: 30, preco_snapshot: 5000, servico_nome: 'Corte' }]],
  ]);
  try {
    await withServer(async (baseUrl) => {
      const token = buildPublicAppointmentToken({ agendamentoId: 42, clienteId: 7, estabelecimentoId: 194 });
      const res = await fetch(`${baseUrl}/public/agendamentos/42?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.id, 42);
      assert.equal(body.servico_nome, 'Corte');
      // Devolver o token de leitura neste campo faria o front mandá-lo ao /payments/status, que o
      // rejeita por escopo — o erro apareceria só no checkout de outra pessoa.
      assert.equal(body.deposit_token, null);
    });
  } finally {
    stub.restore();
  }
});

test('GET /:id recusa token de leitura de OUTRO agendamento', async () => {
  const restore = forbidPoolQuery();
  try {
    await withServer(async (baseUrl) => {
      const token = buildPublicAppointmentToken({ agendamentoId: 999, clienteId: 7, estabelecimentoId: 194 });
      const res = await fetch(`${baseUrl}/public/agendamentos/42?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 403);
    });
  } finally {
    restore();
  }
});

test('GET /:id sem token nenhum é 401', async () => {
  const restore = forbidPoolQuery();
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/agendamentos/42`);
      assert.equal(res.status, 401);
    });
  } finally {
    restore();
  }
});

/* ───────────────────────── GET /meus — a lista ───────────────────────── */

test('GET /meus sem otp_token é 401 e não consulta o banco', async () => {
  const restore = forbidPoolQuery();
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/agendamentos/meus`);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'otp_required');
    });
  } finally {
    restore();
  }
});

test('GET /meus recusa o token de LEITURA — a URL não abre a lista', async () => {
  const restore = forbidPoolQuery();
  try {
    await withServer(async (baseUrl) => {
      // O cenário que o desenho existe para impedir: quem tem só o link do agendamento (que prova
      // apenas ter digitado o número) tentando escalar para o histórico completo.
      const token = buildPublicAppointmentToken({ agendamentoId: 42, clienteId: 7, estabelecimentoId: 194 });
      const res = await fetch(`${baseUrl}/public/agendamentos/meus`, {
        headers: { 'X-Otp-Token': token },
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'otp_invalid');
    });
  } finally {
    restore();
  }
});

test('GET /meus com otp_token válido lista os agendamentos daquele telefone', async () => {
  const stub = stubPool([
    ['FROM usuarios WHERE telefone', [{ id: 212 }]],
    ['FROM agendamentos a', [
      { id: 10, cliente_id: 212, estabelecimento_id: 194, status: 'confirmado', inicio: new Date(), fim: new Date(), estabelecimento_nome: 'Studio X', loyalty_benefit_snapshot_json: null },
    ]],
    ['FROM agendamento_itens ai', [{ agendamento_id: 10, servico_id: 3, ordem: 1, duracao_min: 45, preco_snapshot: 8000, servico_nome: 'Unhas' }]],
  ]);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/agendamentos/meus`, {
        headers: { 'X-Otp-Token': otpToken() },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].estabelecimento_nome, 'Studio X');
      assert.equal(body.items[0].servico_nome, 'Unhas');
      // O JSON cru da fidelidade é detalhe interno; sai hidratado ou não sai.
      assert.equal('loyalty_benefit_snapshot_json' in body.items[0], false);
    });
    // O telefone do OTP chega em dígitos crus; o cadastro guarda normalizado. Se a busca deixar de
    // tentar as duas formas, a lista volta vazia justamente para quem acabou de agendar.
    const lookup = stub.calls.find((c) => c.sql.includes('FROM usuarios WHERE telefone'));
    assert.equal(lookup.params[0], PHONE_NORM);
  } finally {
    stub.restore();
  }
});

test('GET /meus devolve lista vazia quando o número não tem cadastro', async () => {
  // 404 aqui contaria a quem perguntou se aquele número existe na base. Código certo, agenda vazia.
  const stub = stubPool([['FROM usuarios WHERE telefone', []]]);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/agendamentos/meus`, {
        headers: { 'X-Otp-Token': otpToken() },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { items: [] });
    });
  } finally {
    stub.restore();
  }
});

test('GET /meus por e-mail resolve o cliente pelo endereço verificado', async () => {
  const stub = stubPool([
    ['FROM usuarios WHERE LOWER(email)', [{ id: 300 }]],
    ['FROM agendamentos a', []],
  ]);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/public/agendamentos/meus`, {
        headers: { 'X-Otp-Token': otpToken({ ch: 'email', v: 'Alguem@Exemplo.com' }) },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { items: [] });
    });
    const lookup = stub.calls.find((c) => c.sql.includes('LOWER(email)'));
    assert.equal(lookup.params[0], 'alguem@exemplo.com');
  } finally {
    stub.restore();
  }
});
