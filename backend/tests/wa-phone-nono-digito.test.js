// O mesmo celular, duas formas — e o desencontro que calava o consentimento.
//
// A Meta identifica celular brasileiro de DDD >= 31 pelo formato anterior à migração de 2013: o
// webhook entrega `553189524375` para quem, no cadastro, é `5531989524375`. Medido na base em
// 02/08/2026: DDD 11/12 chegam com 13 dígitos, DDD 31/63/71/91 com 12.
//
// Com igualdade exata, uma dona de salão de BH mandou AUTORIZO e ouviu "não encontramos este
// número em nenhum cadastro". E o desencontro tem um lado pior que o falso negativo: um `PARAR`
// gravado numa forma não silenciava a outra.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhoneBR, phoneVariantsBR } from '../src/lib/phone_br.js';
import { isOptInConfirmText } from '../src/whatsapp/inbound/optInConfirm.js';

test('as duas formas do numero da conta 191 se encontram', () => {
  const cadastro = '5531989524375';   // o que ela digitou — o numero de verdade, com o nono digito
  const webhook = '553189524375';     // o que a Meta entregou no inbound

  assert.ok(phoneVariantsBR(webhook).includes(cadastro), 'do webhook chega-se ao cadastro');
  assert.ok(phoneVariantsBR(cadastro).includes(webhook), 'do cadastro chega-se ao webhook');
});

test('a variante e simetrica para qualquer celular', () => {
  for (const [longo, curto] of [
    ['5531989524375', '553189524375'],
    ['5511987654321', '551187654321'],
    ['5591981044513', '559181044513'],
  ]) {
    assert.deepEqual(phoneVariantsBR(longo).sort(), [longo, curto].sort());
    assert.deepEqual(phoneVariantsBR(curto).sort(), [longo, curto].sort());
  }
});

test('a forma recebida vem primeiro — a busca tenta o exato antes do apelido', () => {
  assert.equal(phoneVariantsBR('553189524375')[0], '553189524375');
  assert.equal(phoneVariantsBR('5531989524375')[0], '5531989524375');
});

test('fixo nao ganha nono digito', () => {
  // 551133839847 existe na base (DDD 11, comeca em 3): telefone fixo, sem variante possivel.
  assert.deepEqual(phoneVariantsBR('551133839847'), ['551133839847']);
  assert.deepEqual(phoneVariantsBR('5511 3383-9847'), ['551133839847']);
});

test('13 digitos cujo nono digito nao e 9 nao inventa variante', () => {
  // Nao existe celular brasileiro comecando com 8 na posicao do nono digito.
  assert.deepEqual(phoneVariantsBR('5531889524375'), ['5531889524375']);
});

test('lixo nao vira lista', () => {
  for (const entrada of ['', null, undefined, 'abc', '123']) {
    assert.deepEqual(phoneVariantsBR(entrada), [], `entrada ${JSON.stringify(entrada)}`);
  }
});

test('a variante nao altera a normalizacao — formato recebido e preservado', () => {
  // phoneVariantsBR AMPLIA a busca; nao canoniza. Quem grava continua gravando o que chegou,
  // porque whatsapp_optins e trilha de prova para a Meta.
  assert.equal(normalizePhoneBR('553189524375'), '553189524375');
  assert.equal(normalizePhoneBR('5531989524375'), '5531989524375');
});

test('a palavra do aceite continua exigindo igualdade', () => {
  // Guarda de regressao: ampliar telefone nao pode afrouxar o resto do portao.
  assert.equal(isOptInConfirmText('AUTORIZO'), true);
  assert.equal(isOptInConfirmText('Autorizo!'), true);
  assert.equal(isOptInConfirmText('nao autorizo'), false);
  assert.equal(isOptInConfirmText('autorizo sim'), false);
});
