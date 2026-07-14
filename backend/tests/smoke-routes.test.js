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
    // Sem isto as rotas de fidelidade devolvem 503 (loyalty_disabled) e o smoke passaria
    // 'verde' sem exercitar uma linha do modulo — o oposto do que ele existe para fazer.
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOYALTY_ENABLED: '1' },
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
  // Planos de fidelidade (cliente -> estabelecimento). Rotas novas: entram no smoke desde o
  // primeiro dia, e nao depois de quebrarem em producao.
  '/loyalty/plans',
  '/loyalty/subscribers',
  '/loyalty/split-preview?price_cents=8000',
];

const ROTAS_PUBLICAS = [
  '/establishments',
  `/establishments/${ESTAB_ID}`,
  '/establishments/salao-smoke',
  // A contagem de "mais agendados" (UNION ALL com os agendamentos legados) so e
  // exercitada com um banco real — o mock nunca reclamaria da coluna.
  `/servicos?establishmentId=${ESTAB_ID}`,
  '/billing/plans/public',
  `/public/estabelecimentos/${ESTAB_ID}/loyalty-plans`,
  '/public/estabelecimentos/salao-smoke/loyalty-plans',
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

// --- Opt-in do WhatsApp: o fio entre a TELA e o BANCO --------------------------------------------
//
// Os testes de unidade provam que a lib grava e que o envio bloqueia. Nenhum deles prova que a
// ROTA leva a caixa marcada ate a lib. Se o nome do campo no corpo estiver errado (whatsapp_optin
// vs whatsappOptin vs optin), tudo continua "passando": ninguem nunca opta, nada e gravado, e o
// WhatsApp simplesmente emudece — sem erro, sem log, sem ninguem perceber. Este teste faz um
// agendamento publico DE VERDADE, por HTTP, e vai olhar a linha no banco.

async function postJson(pathname, payload) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text() };
}

async function post(pathname, payload, { token } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload || {}),
  });
  return { status: res.status, body: await res.text() };
}

// Amanha as 10:00 local: dentro do expediente padrao (07:00-22:00) e longe do lead minimo.
function amanhaAs10h() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

test('agendamento publico COM a caixa marcada grava o consentimento (com a prova)', { skip }, async () => {
  const telefone = '12987650001';
  const e164 = `55${telefone}`;
  await pool.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [e164]);
  await pool.query('DELETE FROM usuarios WHERE email=?', ['optin.sim@test.local']);

  const { status, body } = await postJson('/public/agendamentos', {
    estabelecimento_id: ESTAB_ID,
    servico_ids: [SERVICO_ID],
    profissional_id: PROF_ID,
    inicio: amanhaAs10h(),
    nome: 'Cliente Optou',
    email: 'optin.sim@test.local',
    telefone,
    whatsapp_optin: true,
  });
  assert.equal(status, 201, `status ${status}: ${body.slice(0, 300)}`);

  const [rows] = await pool.query(
    'SELECT evento, origem, texto, texto_versao FROM whatsapp_optins WHERE telefone_e164=?',
    [e164]
  );
  assert.equal(rows.length, 1, 'a caixa marcada tinha de virar exatamente uma linha de consentimento');
  assert.equal(rows[0].evento, 'granted');
  assert.equal(rows[0].origem, 'agendamento_publico');
  assert.equal(rows[0].texto_versao, 'v1');
  // O texto e renderizado pelo SERVIDOR e nomeia o salao — e isso que vale como prova.
  assert.match(rows[0].texto, /Salao Smoke/);
  assert.match(rows[0].texto, /PARAR/);
});

// --- O que decide se o BANNER do dono aparece ----------------------------------------------------
//
// `precisa_reaceitar` e a unica coisa que o front consulta para mostrar (ou nao) o banner que cutuca
// o dono a autorizar o WhatsApp. Se essa flag vier errada, o banner some — e o dono nunca descobre
// que os avisos dele estao bloqueados. Nao ha erro, nao ha log: so silencio. Por isso vai por HTTP,
// com JWT de verdade, contra o banco de verdade.

async function optinStatus() {
  const { status, body } = await get('/auth/me/whatsapp-optin', { token: estabToken });
  assert.equal(status, 200, `status ${status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

test('dono LEGADO (notificacao ligada, sem aceite) -> o banner DEVE aparecer', { skip }, async () => {
  const e164 = '5511999990000'; // telefone do Salao Smoke, em E.164
  await pool.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [e164]);
  await pool.query('UPDATE usuarios SET notify_whatsapp_estab=1 WHERE id=?', [ESTAB_ID]);

  const r = await optinStatus();
  assert.equal(r.optin, false);
  assert.equal(r.precisa_reaceitar, true, 'sem esta flag o dono legado nunca ve o banner');
});

test('depois de aceitar, a pendencia acaba -> o banner some (e e assim que deve ser)', { skip }, async () => {
  const { status } = await post('/auth/me/whatsapp-optin', {}, { token: estabToken });
  assert.equal(status, 200);

  const r = await optinStatus();
  assert.equal(r.optin, true);
  assert.equal(r.precisa_reaceitar, false, 'quem ja autorizou nao tem o que reaceitar');
  assert.match(r.texto, /avisos da minha agenda/, 'a prova gravada e a do DONO, nao a do cliente');
});

test('dono com a notificacao DESLIGADA nao ve banner — ele optou por nao receber', { skip }, async () => {
  const e164 = '5511999990000';
  await pool.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [e164]);
  await pool.query('UPDATE usuarios SET notify_whatsapp_estab=0 WHERE id=?', [ESTAB_ID]);

  const r = await optinStatus();
  assert.equal(r.precisa_reaceitar, false, 'cobrar aceite de quem desligou o aviso seria ruido');

  await pool.query('UPDATE usuarios SET notify_whatsapp_estab=1 WHERE id=?', [ESTAB_ID]);
});

test('agendamento publico SEM a caixa marcada NAO grava consentimento (e o agendamento vale)', { skip }, async () => {
  const telefone = '12987650002';
  const e164 = `55${telefone}`;
  await pool.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [e164]);
  await pool.query('DELETE FROM usuarios WHERE email=?', ['optin.nao@test.local']);

  const inicio = new Date(amanhaAs10h());
  inicio.setHours(inicio.getHours() + 2); // outro horario, para nao colidir com o teste acima

  const { status, body } = await postJson('/public/agendamentos', {
    estabelecimento_id: ESTAB_ID,
    servico_ids: [SERVICO_ID],
    profissional_id: PROF_ID,
    inicio: inicio.toISOString(),
    nome: 'Cliente Nao Optou',
    email: 'optin.nao@test.local',
    telefone,
    // sem whatsapp_optin — exatamente como fica quando a pessoa deixa a caixa desmarcada
  });

  // O agendamento TEM de funcionar. Condicionar o servico ao aceite seria consentimento forcado —
  // nao vale para a Meta, nao vale para a LGPD, e ainda derrubaria a conversao.
  assert.equal(status, 201, `status ${status}: ${body.slice(0, 300)}`);

  const [rows] = await pool.query('SELECT id FROM whatsapp_optins WHERE telefone_e164=?', [e164]);
  assert.equal(rows.length, 0, 'sem a caixa marcada NAO pode existir consentimento gravado');
});
