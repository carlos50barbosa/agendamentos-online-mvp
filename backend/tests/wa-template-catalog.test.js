import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listTenantTemplates,
  getTenantTemplate,
  countBodyParams,
  validateCatalog,
  assertCatalogIsValid,
  TENANT_TEMPLATE_KINDS,
} from '../src/lib/wa_template_catalog.js';

test('o catalogo e valido — cada problema aqui seria uma recusa da Graph', () => {
  const problemas = validateCatalog();
  assert.deepEqual(problemas, [], problemas.join(' | '));
  assert.doesNotThrow(() => assertCatalogIsValid());
});

test('cobre exatamente os 4 tipos voltados ao CLIENTE', () => {
  const kinds = listTenantTemplates().map((t) => t.kind);
  assert.deepEqual(kinds.slice().sort(), TENANT_TEMPLATE_KINDS.slice().sort());
  // Avisos ao dono continuam saindo do numero global da plataforma: nao entram no catalogo
  // do tenant, senao o salao mandaria mensagem para ele mesmo.
  assert.ok(!kinds.some((k) => k.endsWith('_est')), 'nenhum modelo de dono no catalogo do tenant');
});

test('nenhum corpo comeca ou termina com variavel', () => {
  // Recusa real recebida em 01/08/2026:
  // "As variaveis nao podem estar no inicio ou no fim do modelo."
  for (const t of listTenantTemplates()) {
    const corpo = t.components.find((c) => c.type === 'BODY').text.trim();
    assert.ok(!/^\{\{\d+\}\}/.test(corpo), `${t.kind} comeca com variavel`);
    assert.ok(!/\{\{\d+\}\}$/.test(corpo), `${t.kind} termina com variavel`);
  }
});

test('paramCount bate com o corpo e com os exemplos', () => {
  for (const t of listTenantTemplates()) {
    assert.equal(countBodyParams(t), t.paramCount, `${t.kind}: contagem divergente`);
    const exemplo = t.components.find((c) => c.type === 'BODY').example.body_text[0];
    assert.equal(exemplo.length, t.paramCount, `${t.kind}: exemplos divergentes`);
  }
});

test('os nomes nao colidem com os modelos da PLATAFORMA', () => {
  // Nome e unico por WABA, mas usar o mesmo nome com estrutura diferente esconderia o erro ate
  // o primeiro disparo em producao. O sufixo _t1 mantem os dois catalogos distinguiveis no log.
  const daPlataforma = [
    'confirmacao_agendamento_v2',
    'lembrete_agendamento_v2',
    'cancelamento_agendamento_v2',
    'lembrete_agendamento_estab_v1',
    'cancelamento_agendamento_estab_v1',
  ];
  for (const t of listTenantTemplates()) {
    assert.ok(!daPlataforma.includes(t.name), `${t.name} colide com modelo da plataforma`);
  }
});

test('o lembrete mantem o botao CONFIRMAR — o bot depende dele', () => {
  const lembrete = getTenantTemplate('reminder_cli');
  const botoes = lembrete.components.find((c) => c.type === 'BUTTONS');
  assert.ok(botoes, 'lembrete sem BUTTONS');
  assert.equal(botoes.buttons[0].type, 'QUICK_REPLY');
  assert.equal(botoes.buttons[0].text, 'CONFIRMAR');
});

test('getTenantTemplate devolve null para kind desconhecido', () => {
  assert.equal(getTenantTemplate('nao_existe'), null);
});
