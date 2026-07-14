// AUTORIZO — o consentimento confirmado pelo PRÓPRIO NÚMERO.
//
// O buraco que isto fecha, com o caso real de 14/07/2026: alguém criou um estabelecimento falso com
// o telefone de uma pessoa aleatória, marcou a caixa de opt-in POR ELA, e a vítima passou a receber
// template de lembrete. O aceite ficava gravado com texto, data e IP — prova impecável de algo que
// não valia NADA, porque nunca verificamos que quem clica é dono do número.
//
// Um clique prova que alguém clicou. Uma mensagem ENVIADA daquele número prova quem é DONO dele.
// É a única prova de posse que não dá para forjar: ninguém manda mensagem do WhatsApp de um
// estranho — nem o atacante de 14/07.
//
// Rodar: node --test tests/whatsapp-optin-autorizo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { isOptInConfirmText } from '../src/whatsapp/inbound/optInConfirm.js';
import { isOptOutText } from '../src/whatsapp/inbound/optOut.js';

test('reconhece o AUTORIZO, com acento, caixa e pontuação variados', () => {
  for (const t of ['AUTORIZO', 'autorizo', 'Autorizo!', ' autorizo ', 'eu autorizo', 'Autorizar']) {
    assert.equal(isOptInConfirmText(t), true, `deveria reconhecer: "${t}"`);
  }
});

test('"não autorizo" NÃO vira autorização', () => {
  // É por isso que a comparação é por IGUALDADE e não por `includes`. Um matcher que procurasse a
  // palavra no meio da frase transformaria a recusa mais explícita possível em consentimento.
  assert.equal(isOptInConfirmText('não autorizo'), false);
  assert.equal(isOptInConfirmText('nao autorizo vocês a mandar nada'), false);
  assert.equal(isOptInConfirmText('quem autorizou isso?'), false);
});

test('"sim" e "ok" NÃO autorizam — de propósito', () => {
  // São as duas respostas mais comuns do mundo. Um "ok" solto virando consentimento seria o oposto
  // de consentimento ATIVO: a pessoa estaria autorizando sem saber que autorizou.
  for (const t of ['sim', 'ok', 'blz', 'certo', 'pode', 'claro', 'aceito', '']) {
    assert.equal(isOptInConfirmText(t), false, `NÃO deveria reconhecer: "${t}"`);
  }
});

test('AUTORIZO e PARAR são universos separados', () => {
  // O webhook chama o opt-out ANTES do opt-in: quem pede para sair ganha de quem pede para entrar.
  // Se as duas funções se confundissem, um "parar" poderia virar autorização — o pior bug possível.
  assert.equal(isOptInConfirmText('parar'), false);
  assert.equal(isOptOutText('autorizo'), false);
});
