// Que número tem chance real de receber WhatsApp — e qual não pode nem ser tentado.
//
// Contexto: com a WABA banida, mandar para número impossível não custava nada. Com a conta de volta,
// custa. Uma taxa alta de destinatário inexistente é a assinatura de lista raspada ou comprada — o
// padrão que a Meta procura — e cada tentativa dessas ainda debita a carteira do estabelecimento
// por uma mensagem que nunca chegou a lugar nenhum.
//
// A régua é o IMPOSSÍVEL, não o improvável. Os casos aqui saíram de cadastros REAIS que apareceram
// no log de produção em 14/07/2026 — inclusive um que FUNCIONA e que uma regra ingênua ("tem de ter
// 13 dígitos") teria quebrado.
//
// Rodar: node --test tests/phone-mobile-br.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidMobileBR, isValidPhoneBR, normalizePhoneBR } from '../src/lib/phone_br.js';

test('os cadastros reais de 14/07: o impossível é barrado, o que funciona continua passando', () => {
  // Sergio (usuario 170): 55 + DDD 19 + 876646464. Nenhum celular brasileiro começa com 8 —
  // depois da migração do nono dígito, todos começam com 9. Este número NÃO EXISTE.
  assert.equal(isValidMobileBR('5519876646464'), false);

  // Vana beauty (usuario 168): 55 + DDD 11 + 99873664. São 8 dígitos — celular ANTERIOR à migração
  // do nono dígito. A Meta normaliza, e este envio ESTÁ FUNCIONANDO em produção (saiu com wamid).
  // Uma regra ingênua ("13 dígitos ou nada") teria quebrado um cliente de verdade.
  assert.equal(isValidMobileBR('551199873664'), true);

  // Meli (usuario 169): celular atual, bem formado.
  assert.equal(isValidMobileBR('5511987373737'), true);
});

test('telefone FIXO é barrado — não recebe WhatsApp', () => {
  assert.equal(isValidMobileBR('551133334444'), false);  // 11 3333-4444
  assert.equal(isValidMobileBR('552122223333'), false);  // 21 2222-3333
  // E o de 8 dígitos começando com 6..9 continua passando: é celular velho, não fixo.
  assert.equal(isValidMobileBR('551188887777'), true);
});

test('DDD que não existe é barrado', () => {
  // A lista tem 67 DDDs. 20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52, 56-60, 70, 72, 76, 78, 80 e 90
  // nunca foram atribuídos.
  for (const ddd of ['00', '20', '23', '36', '52', '78', '90']) {
    assert.equal(isValidMobileBR(`55${ddd}999999999`), false, `DDD ${ddd} não existe e passou`);
  }
  for (const ddd of ['11', '19', '21', '48', '61', '85', '92', '99']) {
    assert.equal(isValidMobileBR(`55${ddd}999999999`), true, `DDD ${ddd} existe e foi barrado`);
  }
});

test('Santa Maria (DDD 55) sobrevive — de novo', () => {
  // O 55 é país E DDD. Já derrubou a máscara do frontend uma vez (ver phone-roundtrip.test.mjs);
  // não vai derrubar a validação também.
  assert.equal(isValidMobileBR('5555999998888'), true);
  assert.equal(normalizePhoneBR('5555999998888'), '5555999998888');
});

test('a regra nova é MAIS ESTRITA que a antiga — e é esse o ponto', () => {
  // isValidPhoneBR só conta dígitos: serve para "cadastrei um telefone", não para decidir um ENVIO.
  // Se as duas concordassem, esta mudança não teria feito nada.
  const impossiveis = ['5519876646464', '551133334444', '5500999999999'];
  for (const n of impossiveis) {
    assert.equal(isValidPhoneBR(n), true, `${n}: a regra ANTIGA aceitava (era o problema)`);
    assert.equal(isValidMobileBR(n), false, `${n}: a regra NOVA tem de barrar`);
  }
});

test('lixo continua sendo lixo', () => {
  for (const n of ['', null, undefined, '123', 'abc', '5511', '5511999999999999']) {
    assert.equal(isValidMobileBR(n), false);
  }
});
