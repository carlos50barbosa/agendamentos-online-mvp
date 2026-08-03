import test from 'node:test';
import assert from 'node:assert/strict';
import { decideConsent, hasWhatsAppConsent } from '../src/lib/whatsapp_consent.js';

// A regra: AUTORIZACAO E ESTREITA, REVOGACAO E AMPLA.
//
// Enquanto tudo saia do numero global, um estado por telefone bastava — havia um so remetente.
// Com cada salao no proprio numero, consentimento passa a ser sobre QUEM manda.

// ─── a decisao pura ────────────────────────────────────────────────────────────────────────────

test('escopo plataforma: vale a autorizacao dada a plataforma', () => {
  assert.equal(decideConsent({ plataforma: 'granted', escopoSalao: false }), true);
  assert.equal(decideConsent({ plataforma: 'revoked', escopoSalao: false }), false);
  assert.equal(decideConsent({ plataforma: null, escopoSalao: false }), false, 'sem evento = sem autorizacao');
});

test('escopo salao: autorizacao DA PLATAFORMA nao libera o numero do salao', () => {
  // O ponto da opcao A. A cliente autorizou receber do Agenda0; o numero do salao e outro
  // remetente, que ela nunca autorizou.
  assert.equal(decideConsent({ plataforma: 'granted', salao: null, escopoSalao: true }), false);
});

test('escopo salao: autorizacao daquele salao libera', () => {
  assert.equal(decideConsent({ plataforma: null, salao: 'granted', escopoSalao: true }), true);
});

test('PARAR na plataforma cala TUDO, inclusive o numero do salao', () => {
  // Assimetria deliberada: quem pediu para sair pediu para sair.
  assert.equal(decideConsent({ plataforma: 'revoked', salao: 'granted', escopoSalao: true }), false);
});

test('PARAR num salao NAO cala os outros', () => {
  // Este era o problema que a mudanca resolve: hoje o revoked de um silenciaria todos.
  const salaoA = decideConsent({ plataforma: 'granted', salao: 'revoked', escopoSalao: true });
  const salaoB = decideConsent({ plataforma: 'granted', salao: 'granted', escopoSalao: true });
  assert.equal(salaoA, false);
  assert.equal(salaoB, true);
});

test('sem argumento nenhum: fail-closed', () => {
  assert.equal(decideConsent(), false);
  assert.equal(decideConsent({}), false);
});

// ─── a consulta ────────────────────────────────────────────────────────────────────────────────

function banco({ plataforma = null, salao = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      const texto = String(sql).replace(/\s+/g, ' ').trim();
      chamadas.push({ sql: texto, params });
      if (/estabelecimento_id IS NULL/i.test(texto)) return [plataforma ? [{ evento: plataforma }] : []];
      return [salao ? [{ evento: salao }] : []];
    },
  };
}

test('sem estabelecimento consulta SO o escopo da plataforma', async () => {
  const b = banco({ plataforma: 'granted' });
  assert.equal(await hasWhatsAppConsent('11999990000', { deps: { query: b.query } }), true);
  assert.equal(b.chamadas.length, 1, 'consultar o salao aqui seria trabalho jogado fora');
  assert.match(b.chamadas[0].sql, /estabelecimento_id IS NULL/i);
});

test('com estabelecimento consulta os DOIS escopos', async () => {
  const b = banco({ plataforma: 'granted', salao: 'granted' });
  assert.equal(await hasWhatsAppConsent('11999990000', { estabelecimentoId: 26, deps: { query: b.query } }), true);
  assert.equal(b.chamadas.length, 2);
  // normalizePhoneBR devolve sem o "+" — conferido contra o comportamento real, nao presumido.
  //
  // Duas formas do MESMO celular: a Meta identifica numero brasileiro pelo formato anterior a
  // 2013 (sem o nono digito), entao o aceite pode ter sido gravado sob qualquer uma das duas.
  // Ler so uma deixava aceite valido invisivel para o envio — e, pior, PARAR gravado numa forma
  // sem calar a outra. O id do estabelecimento vem por ultimo. Ver wa-phone-nono-digito.test.js.
  assert.deepEqual(b.chamadas[1].params, ['5511999990000', '551199990000', 26]);
});

test('revogacao de plataforma nem consulta o salao — ja esta decidido', async () => {
  const b = banco({ plataforma: 'revoked', salao: 'granted' });
  assert.equal(await hasWhatsAppConsent('11999990000', { estabelecimentoId: 26, deps: { query: b.query } }), false);
  assert.equal(b.chamadas.length, 1);
});

test('telefone invalido nao consulta nada e nao autoriza', async () => {
  let tocou = false;
  const query = async () => { tocou = true; return [[]]; };
  assert.equal(await hasWhatsAppConsent('123', { deps: { query } }), false);
  assert.equal(tocou, false);
});

test('erro de banco responde NAO — fail-closed', async () => {
  const query = async () => { throw new Error('banco fora'); };
  assert.equal(await hasWhatsAppConsent('11999990000', { deps: { query } }), false);
});

test('o comportamento antigo (sem opcoes) continua igual', async () => {
  // Todos os chamadores que nao passarem escopo seguem no escopo da plataforma, como antes da
  // mudanca. Regressao aqui silenciaria os avisos que hoje funcionam.
  const b = banco({ plataforma: 'granted' });
  assert.equal(await hasWhatsAppConsent('11999990000', { deps: { query: b.query } }), true);
});
