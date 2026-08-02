import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTemplateRows } from '../src/lib/wa_template_status.js';

const linha = (kind, status, motivo = null) => ({ kind, name: `${kind}_t1`, status, rejected_reason: motivo });

test('todos aprovados -> ready', () => {
  const r = summarizeTemplateRows([
    linha('confirm_cli', 'APPROVED'), linha('reminder_cli', 'APPROVED'),
    linha('cancel_cli', 'APPROVED'), linha('reschedule_cli', 'APPROVED'),
  ]);
  assert.equal(r.ready, true);
  assert.equal(r.aprovados, 4);
  assert.equal(r.pendentes, 0);
});

test('UM pendente ja tira o ready — aquele aviso sai por e-mail', () => {
  const r = summarizeTemplateRows([
    linha('confirm_cli', 'APPROVED'), linha('reminder_cli', 'PENDING'),
  ]);
  assert.equal(r.ready, false);
  assert.equal(r.aprovados, 1);
  assert.equal(r.pendentes, 1);
});

test('recusado conta separado e carrega o motivo', () => {
  const r = summarizeTemplateRows([linha('cancel_cli', 'REJECTED', 'INCORRECT_CATEGORY')]);
  assert.equal(r.recusados, 1);
  assert.equal(r.pendentes, 0, 'recusado NAO e pendente — nao adianta esperar');
  assert.equal(r.detalhes[0].motivo, 'INCORRECT_CATEGORY');
});

test('estados intermediarios da Meta contam como pendente', () => {
  const r = summarizeTemplateRows([linha('confirm_cli', 'PAUSED'), linha('reminder_cli', 'FLAGGED')]);
  assert.equal(r.pendentes, 2);
  assert.equal(r.ready, false);
});

test('sem linhas -> nao esta pronto, mas tambem nao ha o que avisar', () => {
  // Estabelecimento sem WABA propria: a tela nao deve mostrar aviso nenhum.
  const r = summarizeTemplateRows([]);
  assert.equal(r.total, 0);
  assert.equal(r.ready, false);
  assert.deepEqual(r.detalhes, []);
});

test('tolera entrada invalida', () => {
  assert.equal(summarizeTemplateRows(null).total, 0);
  assert.equal(summarizeTemplateRows(undefined).total, 0);
});

test('status vem normalizado em maiusculas', () => {
  const r = summarizeTemplateRows([{ kind: 'confirm_cli', name: 'x', status: 'approved' }]);
  assert.equal(r.aprovados, 1);
  assert.equal(r.detalhes[0].status, 'APPROVED');
});
