import test from 'node:test';
import assert from 'node:assert/strict';
import { selectConfirmationGroup } from '../src/whatsapp/inbound/reminderConfirmation.js';

const ag = (id, inicio, estabelecimento_id = 194) => ({ id, inicio, estabelecimento_id });

// Regressao: o fallback do "CONFIRMAR" digitado pegava candidates[0] e confirmava UMA linha.
// Em salao, atendimento simultaneo e rotina — escova com uma profissional e unha com outra as
// 14h —, entao a cliente recebia dois lembretes, digitava "CONFIRMAR" uma vez e um dos dois
// ficava pendente para sempre no painel.
test('selectConfirmationGroup confirma os dois atendimentos simultaneos', () => {
  const grupo = selectConfirmationGroup([
    ag(100, '2026-08-22T14:00:00-03:00'),
    ag(101, '2026-08-22T14:00:00-03:00'),
  ]);
  assert.deepEqual(grupo.map((r) => r.id), [100, 101]);
});

// So o horario MAIS PROXIMO: 14h e 18h no mesmo dia sao visitas diferentes, e a de 18h ainda
// vai receber o lembrete dela.
test('selectConfirmationGroup nao confirma um horario posterior', () => {
  const grupo = selectConfirmationGroup([
    ag(200, '2026-08-22T18:00:00-03:00'),
    ag(201, '2026-08-22T14:00:00-03:00'),
    ag(202, '2026-08-22T14:00:00-03:00'),
  ]);
  assert.deepEqual(grupo.map((r) => r.id), [201, 202]);
});

// O desempate era indefinido: dois simultaneos empatavam no sort e sobrava o que o MySQL
// tivesse devolvido primeiro. Agora a ordem e estavel pelo id, independente da entrada.
test('selectConfirmationGroup e determinístico com a entrada embaralhada', () => {
  const a = selectConfirmationGroup([ag(101, '2026-08-22T14:00:00-03:00'), ag(100, '2026-08-22T14:00:00-03:00')]);
  const b = selectConfirmationGroup([ag(100, '2026-08-22T14:00:00-03:00'), ag(101, '2026-08-22T14:00:00-03:00')]);
  assert.deepEqual(a.map((r) => r.id), [100, 101]);
  assert.deepEqual(b.map((r) => r.id), [100, 101]);
});

// Mesmo instante em salao diferente nao e atendimento simultaneo — e dado torto. O grupo fica
// preso ao estabelecimento do candidato mais proximo.
test('selectConfirmationGroup nao atravessa estabelecimento', () => {
  const grupo = selectConfirmationGroup([
    ag(300, '2026-08-22T14:00:00-03:00', 194),
    ag(301, '2026-08-22T14:00:00-03:00', 26),
  ]);
  assert.deepEqual(grupo.map((r) => r.id), [300]);
});

test('selectConfirmationGroup devolve lista vazia sem candidato util', () => {
  assert.deepEqual(selectConfirmationGroup([]), []);
  assert.deepEqual(selectConfirmationGroup(), []);
  assert.deepEqual(selectConfirmationGroup([{ id: 1, inicio: null }, { id: 2, inicio: 'nao-e-data' }]), []);
});
