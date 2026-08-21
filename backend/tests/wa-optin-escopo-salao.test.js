// AUTORIZO QUE CHEGA NO NÚMERO DO SALÃO AUTORIZA O SALÃO — NÃO A PLATAFORMA.
//
// Por que este arquivo existe: `decideConsent` (lib/whatsapp_consent.js) não aceita aceite de
// plataforma para um remetente novo — o número próprio do salão é remetente novo. E o AUTORIZO era
// gravado SEMPRE sem escopo. Somando as duas coisas: o dono conecta o número, manda o link para a
// base, todas respondem AUTORIZO, todas recebem "pronto!", e TODAS continuam bloqueadas por
// `no_optin`. Consentimento colhido, prova gravada, canal mudo.
//
// O que se trava aqui é a regra: o escopo do aceite é o número que RECEBEU a mensagem.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleInboundOptInConfirm,
  JA_AUTORIZADO,
  CONFIRMADO_CLIENTE,
  CONFIRMADO_ESTAB,
} from '../src/whatsapp/inbound/optInConfirm.js';

const NUMERO_PLATAFORMA = '907736642421274';
const NUMERO_DO_SALAO = '558800112233445';
const ESTAB_DO_SALAO = 194;

function inbound(phoneNumberId, texto = 'AUTORIZO') {
  return {
    phoneNumberId,
    value: { metadata: { display_phone_number: '+55 11 4000-0000' } },
    message: {
      from: '5511999999380',
      id: 'wamid-escopo-1',
      timestamp: '1710000000',
      type: 'text',
      text: { body: texto },
    },
  };
}

function spy({ conta = null, jaAutorizado = false, titular, contaLanca = false } = {}) {
  const grants = [];
  const sent = [];
  const updates = [];
  const consultas = [];

  const deps = {
    logger: { log() {}, warn() {}, error() {} },
    pool: {
      query: async (sql, params) => {
        updates.push({ sql, params });
        return [[], []];
      },
    },
    recordWhatsAppInbound: async () => ({ ok: true }),
    sendWhatsAppSmart: async (payload) => { sent.push(payload); return { ok: true }; },
    hasWhatsAppConsent: async (phone, opcoes) => {
      consultas.push(opcoes || {});
      return jaAutorizado;
    },
    grantWhatsAppConsent: async (payload) => { grants.push(payload); return { ok: true }; },
    getWaAccountByPhoneNumberId: async () => {
      if (contaLanca) throw new Error('db offline');
      return conta;
    },
    resolveTitular: async () => titular || { id: 7, nome: 'Cliente Teste', tipo: 'cliente' },
  };

  return { deps, grants, sent, updates, consultas };
}

const contaConectada = {
  estabelecimento_id: ESTAB_DO_SALAO,
  status: 'connected',
  phone_number_id: NUMERO_DO_SALAO,
};

test('no número do SALÃO, o aceite é gravado no escopo daquele salão', async () => {
  const { deps, grants } = spy({ conta: contaConectada });

  const r = await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(r.handled, true);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].estabelecimentoId, ESTAB_DO_SALAO);
});

test('no número da PLATAFORMA, segue sem escopo — o comportamento de antes', async () => {
  const { deps, grants } = spy();

  await handleInboundOptInConfirm({ ...inbound(NUMERO_PLATAFORMA), deps });

  assert.equal(grants.length, 1);
  assert.equal(grants[0].estabelecimentoId, null);
});

test('quem já autorizou a PLATAFORMA não é dispensado no número do salão', async () => {
  // A regressão inteira: `hasWhatsAppConsent` tem de ser consultado COM o escopo do salão. Sem
  // isso o handler responde "você já estava autorizado" e vai embora sem gravar nada — e o envio
  // pelo número do salão continua bloqueado, sem nenhum sinal de que algo deu errado.
  const { deps, grants, sent, consultas } = spy({ conta: contaConectada, jaAutorizado: false });

  await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.deepEqual(consultas[0], { estabelecimentoId: ESTAB_DO_SALAO });
  assert.equal(grants.length, 1, 'tem de gravar o aceite do salão');
  assert.equal(sent[0].message, CONFIRMADO_CLIENTE);
});

test('já autorizado NAQUELE escopo confirma sem regravar', async () => {
  const { deps, grants, sent } = spy({ conta: contaConectada, jaAutorizado: true });

  await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(grants.length, 0);
  assert.equal(sent[0].message, JA_AUTORIZADO);
});

test('no número do salão a audiência é CLIENTE mesmo se quem escreveu é o dono', async () => {
  // O número do salão só fala com cliente. Os avisos do DONO saem do número global, no escopo da
  // plataforma — tratá-lo como estabelecimento aqui gravaria o aceite onde ele não atende nada e
  // ainda responderia "seus avisos de agenda estão ativos", que seria mentira.
  const { deps, grants, sent, updates } = spy({
    conta: contaConectada,
    titular: { id: 9, nome: 'Studio Teste', tipo: 'estabelecimento' },
  });

  await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(grants[0].audience, 'client');
  assert.equal(grants[0].estabelecimentoId, ESTAB_DO_SALAO);
  assert.equal(sent[0].message, CONFIRMADO_CLIENTE);
  assert.notEqual(sent[0].message, CONFIRMADO_ESTAB);
  assert.equal(
    updates.some((u) => /notify_whatsapp_estab/.test(String(u.sql))),
    false,
    'a preferência do dono é do canal global, não deste número'
  );
});

test('conta que existe mas NÃO está conectada cai no escopo da plataforma', async () => {
  // Linha antiga de uma conexão desfeita não pode reivindicar o aceite: o número já não é dela.
  const { deps, grants } = spy({
    conta: { ...contaConectada, status: 'disconnected' },
  });

  await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(grants[0].estabelecimentoId, null);
});

test('sem conseguir saber de quem é o número, NÃO grava nada', async () => {
  // Fail-closed: escopo errado é pior que escopo nenhum — um lado ganha permissão que não recebeu
  // e o outro segue mudo, os dois em silêncio.
  const { deps, grants, sent } = spy({ contaLanca: true });

  const r = await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(r.handled, false);
  assert.equal(grants.length, 0);
  assert.equal(sent.length, 0);
});

test('a prova guarda em qual número o AUTORIZO caiu', async () => {
  const { deps, grants } = spy({ conta: contaConectada });

  await handleInboundOptInConfirm({ ...inbound(NUMERO_DO_SALAO), deps });

  assert.equal(grants[0].metadados.recebido_em, NUMERO_DO_SALAO);
  assert.equal(grants[0].metadados.prova, 'inbound_autorizo');
});
