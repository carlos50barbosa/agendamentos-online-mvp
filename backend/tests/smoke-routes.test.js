// SMOKE DAS ROTAS CONTRA UM MYSQL DE VERDADE.
//
// Por que este arquivo existe: em 12/07 o GET /establishments/:id/clients ficou 500 em
// producao por tres deploys seguidos — "Unknown column 'base.billable_appointments'".
// Nenhum teste pegou porque nenhum teste executa a SQL contra o schema real: os testes
// de rota mockam pool.query, e um mock nunca reclama de coluna inexistente. Aqui o app
// sobe como processo, fala com um MySQL real e as rotas sao chamadas por HTTP.
//
// A assercao e 200 (nao "< 500") de proposito: um 400/404 significaria que a requisicao
// morreu ANTES da query — o teste passaria sem nunca ter exercitado a SQL, que e
// exatamente o que estamos tentando cobrir.
//
// Rodar:  npm run test:smoke   (exige um banco descartavel; veja scripts/setup-test-db.mjs)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

import { DISPOSABLE_DB_RE } from '../scripts/setup-test-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, '..');

const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || '';
const DISPOSABLE = DISPOSABLE_DB_RE.test(DB_NAME);
// No CI isto e 1: sem banco, o smoke FALHA em vez de pular. Um smoke que pula sozinho
// quando o ambiente esta torto e um verde falso — pior que nao ter teste nenhum.
const REQUIRE_DB = process.env.SMOKE_REQUIRE_DB === '1';

if (!DISPOSABLE && REQUIRE_DB) {
  throw new Error(
    `SMOKE_REQUIRE_DB=1 mas MYSQL_DATABASE="${DB_NAME}" nao e descartavel ` +
    '(precisa terminar em _smoke/_test/_ci). Abortando em vez de pular.'
  );
}

const skip = DISPOSABLE
  ? false
  : `sem banco descartavel (MYSQL_DATABASE="${DB_NAME || 'vazio'}"). ` +
    'Rode: npm run test:smoke';

// IDs fixos: o smoke roda contra um banco recem-criado, entao nao ha o que colidir.
const ESTAB_ID = 9001;
const CLIENTE_ID = 9002;
const PROF_ID = 9003;
const SERVICO_ID = 9004;

let server = null;
let baseUrl = '';
let pool = null;
let estabToken = '';
const serverLog = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function iso(offsetMinutes) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function seed() {
  pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS || '',
    database: DB_NAME,
    connectionLimit: 4,
  });

  // Idempotente: da para rodar `node --test tests/smoke-routes.test.js` varias vezes
  // contra o mesmo banco de smoke sem recriar tudo. Na ordem das FKs.
  await pool.query('DELETE FROM agendamentos WHERE estabelecimento_id = ?', [ESTAB_ID]);
  await pool.query('DELETE FROM servico_profissionais WHERE servico_id = ?', [SERVICO_ID]);
  await pool.query('DELETE FROM servicos WHERE id = ?', [SERVICO_ID]);
  await pool.query('DELETE FROM profissionais WHERE id = ?', [PROF_ID]);
  await pool.query('DELETE FROM usuarios WHERE id IN (?, ?)', [ESTAB_ID, CLIENTE_ID]);

  await pool.query(
    `INSERT INTO usuarios (id, nome, email, senha_hash, tipo, telefone, plan, plan_status, slug)
     VALUES (?, 'Salao Smoke', 'estab.smoke@test.local', 'x', 'estabelecimento', '11999990000', 'pro', 'active', 'salao-smoke'),
            (?, 'Cliente Smoke', 'cliente.smoke@test.local', 'x', 'cliente', '11988887777', 'starter', 'active', NULL)`,
    [ESTAB_ID, CLIENTE_ID]
  );

  await pool.query(
    'INSERT INTO profissionais (id, estabelecimento_id, nome, ativo) VALUES (?, ?, ?, 1)',
    [PROF_ID, ESTAB_ID, 'Bruna Smoke']
  );

  await pool.query(
    `INSERT INTO servicos (id, estabelecimento_id, nome, duracao_min, preco_centavos, ativo)
     VALUES (?, ?, 'Corte Smoke', 30, 5000, 1)`,
    [SERVICO_ID, ESTAB_ID]
  );
  await pool.query(
    'INSERT INTO servico_profissionais (servico_id, profissional_id) VALUES (?, ?)',
    [SERVICO_ID, PROF_ID]
  );

  // Um agendamento no passado (conta como atendimento realizado -> alimenta o CRM,
  // os relatorios e a contagem de "mais agendados") e um no futuro.
  const [past] = await pool.query(
    `INSERT INTO agendamentos
       (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, total_centavos)
     VALUES (?, ?, ?, ?, ?, ?, 'concluido', 5000)`,
    [CLIENTE_ID, ESTAB_ID, SERVICO_ID, PROF_ID, iso(-2880), iso(-2850)]
  );
  const [future] = await pool.query(
    `INSERT INTO agendamentos
       (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status, total_centavos)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmado', 5000)`,
    [CLIENTE_ID, ESTAB_ID, SERVICO_ID, PROF_ID, iso(1440), iso(1470)]
  );

  for (const id of [past.insertId, future.insertId]) {
    await pool.query(
      `INSERT INTO agendamento_itens (agendamento_id, servico_id, ordem, duracao_min, preco_snapshot)
       VALUES (?, ?, 1, 30, 5000)`,
      [id, SERVICO_ID]
    );
  }
}

async function startServer() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;

  server = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Guardamos a saida do servidor: quando uma rota devolve 500, o erro de SQL esta AQUI,
  // e nao no corpo da resposta (que e generico). Sem isto, a falha seria indiagnosticavel.
  server.stdout.on('data', (b) => serverLog.push(String(b)));
  server.stderr.on('data', (b) => serverLog.push(String(b)));

  const deadline = Date.now() + 30000;
  for (;;) {
    if (server.exitCode !== null) {
      throw new Error(`servidor morreu no boot (exit ${server.exitCode}):\n${serverLog.join('')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    if (Date.now() > deadline) {
      throw new Error(`servidor nao respondeu /health em 30s:\n${serverLog.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function tailLog(n = 40) {
  return serverLog.join('').split('\n').slice(-n).join('\n');
}

async function get(pathname, { token } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.text();
  return { status: res.status, body };
}

before(async () => {
  if (!DISPOSABLE) return;
  await seed();
  estabToken = jwt.sign({ id: ESTAB_ID }, process.env.JWT_SECRET, { expiresIn: '15m' });
  await startServer();
});

after(async () => {
  if (server && server.exitCode === null) server.kill();
  if (pool) await pool.end();
});

// Toda rota GET que roda SQL de leitura pesada. Cada uma DEVE devolver 200 — se devolver
// 500, ha uma query quebrada contra o schema real; se devolver 4xx, o fixture/param esta
// errado e a SQL nem chegou a rodar (o teste estaria mentindo).
const ROTAS_AUTENTICADAS = [
  // A rota que quebrou em producao. Lista + agregacoes + segmentos, tudo numa SQL so.
  `/establishments/${ESTAB_ID}/clients?page=1&pageSize=10&period=30d&sort=last&dir=desc`,
  `/establishments/${ESTAB_ID}/clients?period=90d&relationship=novo`,
  `/establishments/${ESTAB_ID}/clients/contacts`,
  `/establishments/${ESTAB_ID}/clients/${CLIENTE_ID}/details`,
  `/establishments/${ESTAB_ID}/clients/export.csv?period=30d`,
  `/establishments/${ESTAB_ID}/stats`,
  `/establishments/${ESTAB_ID}/images`,
  '/relatorios/estabelecimento/overview?range=30d',
  '/relatorios/estabelecimento?range=30d',
  '/relatorios/estabelecimento/profissionais?range=30d',
  '/relatorios/estabelecimento/funil?range=30d',
  '/relatorios/estabelecimento/export.csv?range=30d',
  '/servicos',
  '/profissionais',
  '/agendamentos/estabelecimento?status=todos',
  '/billing/status',
  '/billing/subscription',
  '/billing/config',
  '/billing/plans',
  '/billing/whatsapp/packs',
  '/billing/whatsapp/wallet',
];

const ROTAS_PUBLICAS = [
  '/establishments',
  `/establishments/${ESTAB_ID}`,
  '/establishments/salao-smoke',
  // A contagem de "mais agendados" (UNION ALL com os agendamentos legados) so e
  // exercitada com um banco real — o mock nunca reclamaria da coluna.
  `/servicos?establishmentId=${ESTAB_ID}`,
  '/billing/plans/public',
];

for (const rota of ROTAS_AUTENTICADAS) {
  test(`GET ${rota} -> 200 (autenticado)`, { skip }, async () => {
    const { status, body } = await get(rota, { token: estabToken });
    assert.equal(
      status,
      200,
      `GET ${rota} devolveu ${status}.\ncorpo: ${body.slice(0, 300)}\n\nlog do servidor:\n${tailLog()}`
    );
  });
}

for (const rota of ROTAS_PUBLICAS) {
  test(`GET ${rota} -> 200 (publico)`, { skip }, async () => {
    const { status, body } = await get(rota);
    assert.equal(
      status,
      200,
      `GET ${rota} devolveu ${status}.\ncorpo: ${body.slice(0, 300)}\n\nlog do servidor:\n${tailLog()}`
    );
  });
}

// Alem do 200: o dado precisa realmente ter saido do banco. Sem isto, uma rota que
// devolvesse [] por um bug de filtro passaria no smoke.
test('o CRM devolve o cliente semeado, com as agregacoes do periodo', { skip }, async () => {
  const { status, body } = await get(
    `/establishments/${ESTAB_ID}/clients?page=1&pageSize=10&period=90d`,
    { token: estabToken }
  );
  assert.equal(status, 200, `status ${status}: ${body.slice(0, 200)}`);
  const data = JSON.parse(body);
  assert.equal(data.total, 1, 'o cliente semeado deveria aparecer na lista');
  assert.equal(data.items[0].nome, 'Cliente Smoke');
  // Este e o campo cuja coluna faltava no subquery e derrubava a rota inteira.
  assert.ok(data.aggregations, 'as agregacoes do periodo deveriam vir preenchidas');
  assert.equal(data.aggregations.revenue_centavos, 5000, 'receita = o agendamento concluido');
});

test('a vitrine publica marca o servico mais agendado', { skip }, async () => {
  const { status, body } = await get(`/servicos?establishmentId=${ESTAB_ID}`);
  assert.equal(status, 200, `status ${status}: ${body.slice(0, 200)}`);
  const servicos = JSON.parse(body);
  assert.equal(servicos.length, 1);
  assert.equal(servicos[0].booking_count, 2, 'os 2 agendamentos semeados deveriam ser contados');
  assert.equal(servicos[0].popular, true);
});
