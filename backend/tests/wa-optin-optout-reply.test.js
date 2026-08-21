// A RESPOSTA do AUTORIZO e do PARAR — o caminho que quebrou em silêncio.
//
// ─── O bug que estes testes existem para impedir de voltar ──────────────────────────────────────
//
// Os dois handlers rodam no topo do webhook e devolvem `handled: true`, cortando o fluxo principal
// — que era justamente quem chamava `recordWhatsAppInbound`. Resultado: quem ACABAVA de escrever
// ficava com "última entrada: nunca" em `whatsapp_contacts`. `sendWhatsAppSmart` lia isso, concluía
// que a janela de 24h estava fechada e caía para template. O template padrão
// (`confirmacao_agendamento_v2`) exige 3 parâmetros que estes fluxos não têm, e o envio morria:
//
//   [wa/template] missing params, skip send { expected: 3, provided: 0,
//     context: { kind: 'optin_confirm' } }
//
// Nada saía, e o único rastro era um `warn`. Quem mandou AUTORIZO não recebia confirmação; quem
// mandou PARAR também não — e confirmação de saída é exigência da Meta, não cortesia.
//
// ─── Por que os testes olham a ORDEM das chamadas ───────────────────────────────────────────────
//
// O bug não era uma chamada errada: era a chamada CERTA no momento errado. Registrar a entrada
// depois de responder é indistinguível de registrar antes se você só contar chamadas. Por isso a
// asserção é sobre a sequência, e não sobre "foi chamado".
//
// O outro invariante travado aqui é `template: null` em toda resposta. É o que garante que janela
// fechada signifique NÃO ENVIAR, em vez de disparar o template de confirmação de agendamento para
// alguém que pediu para sair — que seria pior do que o silêncio que estamos consertando.
//
// Rodar: node --test tests/wa-optin-optout-reply.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleInboundOptInConfirm,
  CONFIRMADO_CLIENTE,
  CONFIRMADO_ESTAB,
  JA_AUTORIZADO,
  NAO_ENCONTRADO,
} from '../src/whatsapp/inbound/optInConfirm.js';
import {
  handleInboundOptOut,
  OPT_OUT_CONFIRMATION,
  WRONG_PERSON_REPLY,
} from '../src/whatsapp/inbound/optOut.js';

const TELEFONE = '5511999999380';

function inbound(texto) {
  return {
    phoneNumberId: '907736642421274',
    value: { metadata: { display_phone_number: '+55 11 4000-0000' } },
    message: {
      from: TELEFONE,
      id: 'wamid-teste-1',
      timestamp: '1710000000',
      type: 'text',
      text: { body: texto },
    },
  };
}

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

/**
 * Um espião que registra em UMA lista, na ordem, tudo que o handler faz. É a lista que prova o
 * bug: `['record', 'send']` está certo, `['send', 'record']` (ou sem o `record`) é a regressão.
 */
function createSpy(overrides = {}) {
  const calls = [];
  const sent = [];

  const deps = {
    logger: silentLogger(),
    pool: { query: async () => [[], []] },
    recordWhatsAppInbound: async () => {
      calls.push('record');
      return { ok: true };
    },
    sendWhatsAppSmart: async (payload) => {
      calls.push('send');
      sent.push(payload);
      return { ok: true };
    },
    hasWhatsAppConsent: async () => {
      calls.push('read-consent');
      return false;
    },
    // Número da PLATAFORMA por padrão: sem conta de tenant, o escopo do aceite é o global.
    getWaAccountByPhoneNumberId: async () => null,
    grantWhatsAppConsent: async () => {
      calls.push('grant');
      return { ok: true };
    },
    revokeWhatsAppConsent: async () => {
      calls.push('revoke');
      return { ok: true };
    },
    resolveTitular: async () => ({ id: 7, nome: 'Studio Teste', tipo: 'estabelecimento' }),
    ...overrides,
  };

  return { calls, sent, deps };
}

// ─── AUTORIZO ───────────────────────────────────────────────────────────────────────────────────

test('AUTORIZO registra a entrada ANTES de responder', async () => {
  // A regressão inteira em uma asserção: se o `record` sair de cena ou for parar depois do `send`,
  // a janela volta a ser lida como fechada e a confirmação para de sair.
  const { calls, deps } = createSpy();

  const result = await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(result.handled, true);
  assert.ok(calls.includes('record'), 'a entrada precisa ser registrada');
  assert.ok(
    calls.indexOf('record') < calls.indexOf('send'),
    `o registro tem de vir antes do envio, veio: ${JSON.stringify(calls)}`
  );
});

test('AUTORIZO responde como mensagem de sessão, nunca como template', async () => {
  // `template: null` é o que faz "janela fechada" significar NÃO ENVIAR. Sem ele, a resposta cai no
  // `confirmacao_agendamento_v2` — o template de 3 parâmetros que originou o `skip send`.
  const { sent, deps } = createSpy();

  await handleInboundOptInConfirm({ ...inbound('autorizo'), deps });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, TELEFONE);
  assert.equal(sent[0].template, null, 'a resposta não pode carregar template');
  assert.equal(sent[0].templateName, undefined);
  assert.equal(sent[0].context.kind, 'optin_confirm');
});

test('AUTORIZO de estabelecimento grava consentimento e liga a preferência do dono', async () => {
  const updates = [];
  const { sent, deps } = createSpy({
    pool: {
      query: async (sql, params) => {
        updates.push({ sql, params });
        return [[], []];
      },
    },
  });

  const result = await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(result.handled, true);
  assert.equal(sent[0].message, CONFIRMADO_ESTAB);
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /notify_whatsapp_estab=1/);
  assert.deepEqual(updates[0].params, [7]);
});

test('AUTORIZO de cliente recebe o texto de cliente e não mexe na preferência do dono', async () => {
  // Gravar o texto errado faria a pessoa autorizar uma coisa e receber outra — e a preferência
  // `notify_whatsapp_estab` não existe para quem não é dono de salão.
  let updateCount = 0;
  const { sent, deps } = createSpy({
    resolveTitular: async () => ({ id: 42, nome: 'Maria', tipo: 'cliente' }),
    pool: {
      query: async () => {
        updateCount += 1;
        return [[], []];
      },
    },
  });

  await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(sent[0].message, CONFIRMADO_CLIENTE);
  assert.notEqual(sent[0].message, CONFIRMADO_ESTAB);
  assert.equal(updateCount, 0);
});

test('AUTORIZO de quem já autorizou confirma sem regravar', async () => {
  const { calls, sent, deps } = createSpy({
    hasWhatsAppConsent: async () => {
      calls.push('read-consent');
      return true;
    },
  });

  const result = await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(result.handled, true);
  assert.equal(sent[0].message, JA_AUTORIZADO);
  assert.equal(sent[0].template, null);
  assert.equal(calls.includes('grant'), false, 'não deve regravar consentimento');
});

test('AUTORIZO de número sem cadastro responde mas NÃO grava consentimento', async () => {
  // Autorização sem vínculo não serve para nada — não há a quem notificar — e gravá-la só encheria
  // a tabela de prova com linhas órfãs.
  const { calls, sent, deps } = createSpy({
    resolveTitular: async () => null,
  });

  const result = await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(result.handled, true);
  assert.equal(sent[0].message, NAO_ENCONTRADO);
  assert.equal(calls.includes('grant'), false);
});

test('AUTORIZO não confirma o que não conseguiu gravar', async () => {
  // Dizer "pronto, está ativo" sem estar ativo é pior do que não responder: a pessoa fica achando
  // que autorizou e some do fluxo, sem consentimento nenhum no banco.
  const { sent, deps } = createSpy({
    grantWhatsAppConsent: async () => {
      throw new Error('db offline');
    },
  });

  const result = await handleInboundOptInConfirm({ ...inbound('AUTORIZO'), deps });

  assert.equal(result.handled, false);
  assert.equal(sent.length, 0, 'nada pode ser enviado se o consentimento não foi gravado');
});

// ─── PARAR ──────────────────────────────────────────────────────────────────────────────────────

test('PARAR revoga, registra a entrada e só então responde — nessa ordem', async () => {
  // A ordem importa duas vezes aqui: `revoke` antes de tudo (quem pediu para sair sai, mesmo que a
  // resposta falhe) e `record` antes do `send` (senão a confirmação de saída não sai).
  const { calls, deps } = createSpy();

  const result = await handleInboundOptOut({ ...inbound('PARAR'), deps });

  assert.equal(result.handled, true);
  assert.deepEqual(calls, ['revoke', 'record', 'send']);
});

test('PARAR responde como mensagem de sessão, nunca como template', async () => {
  const { sent, deps } = createSpy();

  await handleInboundOptOut({ ...inbound('parar'), deps });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, OPT_OUT_CONFIRMATION);
  assert.equal(sent[0].template, null, 'a confirmação de saída não pode virar template');
  assert.equal(sent[0].context.kind, 'optout_confirm');
});

test('PARAR não confirma saída que não foi revogada', async () => {
  const { sent, deps } = createSpy({
    revokeWhatsAppConsent: async () => {
      throw new Error('db offline');
    },
  });

  const result = await handleInboundOptOut({ ...inbound('PARAR'), deps });

  assert.equal(result.handled, false);
  assert.equal(sent.length, 0);
});

test('"veio errado" recebe desculpa, não instrução de descadastro', async () => {
  // Quem não te conhece não quer saber como se descadastrar — quer um pedido de desculpas e sumir.
  // Insistir com essa pessoa é o passo anterior a uma denúncia, e denúncia derruba a WABA.
  const { calls, sent, deps } = createSpy();

  const result = await handleInboundOptOut({ ...inbound('veio errado, não tenho agenda com vocês'), deps });

  assert.equal(result.handled, true);
  assert.ok(calls.includes('revoke'), 'na dúvida, sai');
  assert.equal(sent[0].message, WRONG_PERSON_REPLY);
  assert.notEqual(sent[0].message, OPT_OUT_CONFIRMATION);
  assert.equal(sent[0].context.kind, 'wrong_person');
  assert.equal(sent[0].template, null);
});

test('conversa comum não é confundida com AUTORIZO nem com PARAR', async () => {
  // O handler roda em TODA mensagem que chega. Um falso positivo aqui descadastraria — ou
  // autorizaria — alguém que só estava conversando.
  for (const texto of ['bom dia', 'quero marcar um horário', 'não autorizo', 'não consigo parar de indicar vocês']) {
    const optOut = createSpy();
    const optIn = createSpy();

    const saida = await handleInboundOptOut({ ...inbound(texto), deps: optOut.deps });
    const entrada = await handleInboundOptInConfirm({ ...inbound(texto), deps: optIn.deps });

    assert.equal(saida.handled, false, `"${texto}" não é pedido de saída`);
    assert.equal(entrada.handled, false, `"${texto}" não é autorização`);
    assert.deepEqual(optOut.calls, [], `"${texto}" não pode disparar nada no opt-out`);
    assert.deepEqual(optIn.calls, [], `"${texto}" não pode disparar nada no opt-in`);
  }
});
