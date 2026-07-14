// O BLOQUEIO DE VERDADE — contra um MariaDB real.
//
// Este é o teste que decide se o opt-in é uma garantia ou uma boa intenção. Ele não mocka nada:
// roda a SQL nova contra o schema real e chama o MESMO `sendAppointmentWhatsApp` que a produção
// chama. Se a tabela `whatsapp_optins` não existir, se o índice estiver errado, se a consulta do
// caminho quente não compilar — quebra aqui, não em produção.
//
// (Mock não serve: a lição de 12/07 foi exatamente essa. Um mock de pool.query nunca reclama de
// coluna inexistente, e três bugs foram para produção por causa disso.)
//
// A pergunta que este arquivo responde: "é POSSÍVEL uma mensagem sair sem consentimento?"
//
// Rodar: npm run db:setup:smoke && node --test tests/whatsapp-optin-db.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

import { DISPOSABLE_DB_RE } from '../scripts/setup-test-db.mjs';

const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || '';
const DISPOSABLE = DISPOSABLE_DB_RE.test(DB_NAME);
const REQUIRE_DB = process.env.SMOKE_REQUIRE_DB === '1';

if (!DISPOSABLE && REQUIRE_DB) {
  throw new Error(
    `SMOKE_REQUIRE_DB=1 mas MYSQL_DATABASE="${DB_NAME}" nao e descartavel. Abortando em vez de pular.`
  );
}

const skip = DISPOSABLE
  ? false
  : `sem banco descartavel (MYSQL_DATABASE="${DB_NAME || 'vazio'}"). Rode: npm run test:smoke`;

const ESTAB_ID = 9101;
const TEL_CLIENTE = '5512988887777';
const TEL_ESTAB = '5512977776666';

let db = null;
let consent = null;
let outbox = null;

before(async () => {
  if (!DISPOSABLE) return;

  // Importa depois do guard: src/lib/db.js abre pool no import e mancharia um banco real.
  consent = await import('../src/lib/whatsapp_consent.js');
  outbox = await import('../src/lib/whatsapp_outbox.js');

  db = await mysql.createPool({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS || '',
    database: DB_NAME,
    connectionLimit: 4,
  });

  await db.query('DELETE FROM whatsapp_optins WHERE telefone_e164 IN (?, ?)', [TEL_CLIENTE, TEL_ESTAB]);
  await db.query('DELETE FROM whatsapp_wallet_transactions WHERE estabelecimento_id = ?', [ESTAB_ID]);
  await db.query('DELETE FROM usuarios WHERE id = ?', [ESTAB_ID]);
  await db.query(
    `INSERT INTO usuarios (id, nome, email, senha_hash, tipo, telefone, plan, plan_status)
     VALUES (?, 'Studio Optin', 'estab.optin@test.local', 'x', 'estabelecimento', ?, 'pro', 'active')`,
    [ESTAB_ID, TEL_ESTAB]
  );
});

after(async () => {
  if (db) await db.end();
  // O pool interno da app (src/lib/db.js) também precisa fechar, senão o processo de teste
  // fica pendurado para sempre — foi o que manteve a suíte inteira sem nunca rodar até 12/07.
  if (consent) {
    const { pool } = await import('../src/lib/db.js');
    await pool.end();
  }
});

// --- O estado do consentimento ------------------------------------------------------------------

test('número nunca visto: NÃO tem consentimento', { skip }, async () => {
  assert.equal(await consent.hasWhatsAppConsent(TEL_CLIENTE), false);
});

test('aceite → tem consentimento, e a PROVA fica gravada (texto, versão, origem)', { skip }, async () => {
  await consent.grantWhatsAppConsent({
    phone: TEL_CLIENTE,
    estabelecimentoId: ESTAB_ID,
    origem: consent.OPTIN_SOURCES.PUBLIC_BOOKING,
  });
  assert.equal(await consent.hasWhatsAppConsent(TEL_CLIENTE), true);

  const row = await consent.getWhatsAppConsent(TEL_CLIENTE);
  assert.equal(row.evento, 'granted');
  assert.equal(row.texto_versao, 'v1');
  assert.equal(row.origem, 'agendamento_publico');
  // O texto é renderizado pelo SERVIDOR e nomeia o salão — é isso que vale como prova.
  assert.match(row.texto, /Studio Optin/);
  assert.match(row.texto, /WhatsApp/);
  assert.match(row.texto, /PARAR/);
});

test('aceitar de novo NÃO cria linha nova (senão a prova some num log de cliques)', { skip }, async () => {
  const [[antes]] = await db.query(
    'SELECT COUNT(*) AS n FROM whatsapp_optins WHERE telefone_e164=?', [TEL_CLIENTE]
  );
  await consent.grantWhatsAppConsent({
    phone: TEL_CLIENTE, estabelecimentoId: ESTAB_ID, origem: consent.OPTIN_SOURCES.CLIENT_BOOKING,
  });
  const [[depois]] = await db.query(
    'SELECT COUNT(*) AS n FROM whatsapp_optins WHERE telefone_e164=?', [TEL_CLIENTE]
  );
  assert.equal(depois.n, antes.n, 'o cliente que agenda toda semana não pode virar 52 linhas');
});

test('o telefone é gravado em E.164, venha como vier da tela', { skip }, async () => {
  // A tela manda "(12) 98888-7777"; o banco tem de casar com o mesmo número em E.164, senão o
  // envio consultaria uma chave e o aceite estaria gravado em outra — e nada sairia nunca.
  assert.equal(await consent.hasWhatsAppConsent('(12) 98888-7777'), true);
  assert.equal(await consent.hasWhatsAppConsent('12988887777'), true);
});

test('PARAR → revoga; e dá para voltar depois', { skip }, async () => {
  await consent.revokeWhatsAppConsent({ phone: TEL_CLIENTE, origem: consent.OPTIN_SOURCES.WHATSAPP_STOP });
  assert.equal(await consent.hasWhatsAppConsent(TEL_CLIENTE), false);

  await consent.grantWhatsAppConsent({
    phone: TEL_CLIENTE, estabelecimentoId: ESTAB_ID, origem: consent.OPTIN_SOURCES.CLIENT_PANEL,
  });
  assert.equal(await consent.hasWhatsAppConsent(TEL_CLIENTE), true);

  // O histórico inteiro sobrevive — é ele que responde "por que você mandou para este número
  // em tal data?".
  const [rows] = await db.query(
    'SELECT evento FROM whatsapp_optins WHERE telefone_e164=? ORDER BY id', [TEL_CLIENTE]
  );
  assert.deepEqual(rows.map((r) => r.evento), ['granted', 'revoked', 'granted']);
});

// --- O bloqueio no envio (o coração) ------------------------------------------------------------

test('SEM consentimento, o envio ao cliente é BLOQUEADO — não chega na API da Meta', { skip }, async () => {
  const semAceite = '5512900001111';
  await db.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [semAceite]);

  const r = await outbox.sendAppointmentWhatsApp({
    estabelecimentoId: ESTAB_ID,
    to: semAceite,
    kind: 'confirm_cli',
    message: 'não deveria sair',
  });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'no_optin');
  assert.equal(r.sent, false);
});

test('esquecer o `audience` BLOQUEIA (fail-closed) — um envio novo não vaza por omissão', { skip }, async () => {
  // Esta é a garantia estrutural: o padrão do parâmetro é "cliente". Se alguém criar um envio novo
  // e esquecer de declarar a audiência, a mensagem é barrada. O contrário — default
  // "establishment" — faria um esquecimento virar mensagem não autorizada, que é exatamente o
  // erro que custou a conta.
  const semAceite = '5512900002222';
  await db.query('DELETE FROM whatsapp_optins WHERE telefone_e164=?', [semAceite]);

  const r = await outbox.sendAppointmentWhatsApp({
    estabelecimentoId: ESTAB_ID,
    to: semAceite,
    kind: 'kind_novo_que_alguem_inventou',   // sem `audience`
    message: 'não deveria sair',
  });

  assert.equal(r.reason, 'no_optin', 'um envio sem audiência declarada TEM de ser bloqueado');
});

test('COM consentimento, o envio passa do portão (não é mais bloqueado por opt-in)', { skip }, async () => {
  const r = await outbox.sendAppointmentWhatsApp({
    estabelecimentoId: ESTAB_ID,
    to: TEL_CLIENTE,           // aceitou no teste acima
    kind: 'confirm_cli',
    message: 'pode sair',
  });

  // Sem credenciais da Meta no ambiente de teste ele não completa o envio — e não é isso que
  // estamos medindo. O que importa é que o motivo NÃO é mais falta de opt-in: o portão abriu.
  assert.notEqual(r.reason, 'no_optin', 'com aceite registrado, o opt-in não pode mais barrar');
});

test('o envio ao ESTABELECIMENTO não é barrado por opt-in (é o titular da conta)', { skip }, async () => {
  const r = await outbox.sendAppointmentWhatsApp({
    estabelecimentoId: ESTAB_ID,
    to: TEL_ESTAB,
    kind: 'confirm_est',
    audience: outbox.WA_AUDIENCE_ESTABLISHMENT,
    message: 'aviso ao dono',
  });
  assert.notEqual(r.reason, 'no_optin');
});

test('todo bloqueio por falta de opt-in fica REGISTRADO (não some em silêncio)', { skip }, async () => {
  const [rows] = await db.query(
    `SELECT reason FROM whatsapp_wallet_transactions
      WHERE estabelecimento_id=? AND kind='blocked' AND reason='no_optin'`,
    [ESTAB_ID]
  );
  assert.ok(rows.length >= 2, 'os bloqueios dos testes acima têm de aparecer na trilha da carteira');
});
