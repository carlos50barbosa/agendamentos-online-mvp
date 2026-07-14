// Round-trip do telefone entre a tela e o banco.
//
// Regressão de um bug que destruiu o WhatsApp de estabelecimentos em produção:
// `components/settings/helpers.js` tinha uma cópia do formatador que cortava em 11 dígitos
// SEM remover o "55" do país. Com o telefone gravado em E.164, a tela de Configurações passava
// a exibir o DDD errado e, ao salvar, o backend prefixava outro 55:
//
//   banco 5512981686284  ->  tela 55129816862  ->  banco 5555129816862
//
// Bastava abrir Configurações e salvar QUALQUER campo para o dono parar de receber as
// notificações de agendamento — sem nenhum aviso. E piorava a cada save.
//
// Rodar: node --test frontend/src/utils/__tests__/phone-roundtrip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBRPhone, onlyLocalDigits } from '../masks.js';
import { formatPhoneBR } from '../../components/settings/helpers.js';

/** A regra do backend (lib/phone_br.js): decide pelo COMPRIMENTO, nunca por "começa com 55". */
function backendNormalizePhoneBR(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

/** Abrir a tela (formata o valor do banco) e salvar (o backend normaliza de volta). */
const abrirESalvar = (doBanco) => backendNormalizePhoneBR(formatPhoneBR(doBanco));

test('Configurações usa a MESMA máscara do resto do app (sem cópia divergente)', () => {
  assert.equal(formatPhoneBR, formatBRPhone);
});

test('abrir e salvar o perfil NÃO altera o telefone (era o bug: 55 duplicado a cada save)', () => {
  const E164 = '5512981686284'; // caso real: Studio Dihcampos
  assert.equal(abrirESalvar(E164), E164);
  // E não pode degradar em cascata: 3 saves seguidos.
  let db = E164;
  for (let i = 0; i < 3; i += 1) db = abrirESalvar(db);
  assert.equal(db, E164, 'cada save corrompia mais: 5555129816862, 5555551298168...');
});

test('o número corrompido que foi para produção não pode mais nascer', () => {
  assert.notEqual(abrirESalvar('5512981686284'), '5555129816862');
});

test('Santa Maria (DDD 55) sobrevive — cortar o "55" cegamente apagaria o DDD de quem é de lá', () => {
  const santaMaria = '5555999998888'; // 55 (país) + 55 (DDD) + celular
  assert.equal(onlyLocalDigits(santaMaria), '55999998888');
  assert.equal(formatPhoneBR(santaMaria), '(55) 99999-8888');
  assert.equal(abrirESalvar(santaMaria), santaMaria);
});

test('número local digitado do zero continua funcionando', () => {
  assert.equal(backendNormalizePhoneBR(formatPhoneBR('12981686284')), '5512981686284');
});
