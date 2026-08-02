import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionTenantTemplates } from '../src/services/waTenantTemplates.js';

const CATALOGO_FALSO = () => ([
  { kind: 'confirm_cli', name: 'a_t1', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'x {{1}} y' }] },
  { kind: 'reminder_cli', name: 'b_t1', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'x {{1}} y' }] },
  { kind: 'cancel_cli', name: 'c_t1', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'x {{1}} y' }] },
]);

const silencioso = { warn() {}, info() {}, error() {} };

function coletor() {
  const gravados = [];
  return { gravados, recordTenantTemplate: async (r) => { gravados.push(r); } };
}

test('cria todos e registra cada um como PENDING', async () => {
  const { gravados, recordTenantTemplate } = coletor();
  const r = await provisionTenantTemplates({
    estabelecimentoId: 7, wabaId: 'W1', accessToken: 'tok',
    deps: {
      listTenantTemplates: CATALOGO_FALSO,
      createWhatsAppTemplate: async ({ template }) => ({ id: 'id_' + template.name, status: 'PENDING' }),
      recordTenantTemplate, logger: silencioso,
    },
  });
  assert.equal(r.criados, 3);
  assert.equal(r.falhas, 0);
  assert.equal(gravados.length, 3);
  assert.equal(gravados[0].status, 'PENDING');
  assert.equal(gravados[0].metaTemplateId, 'id_a_t1');
  assert.equal(gravados[0].estabelecimentoId, 7);
});

test('nome duplicado conta como SUCESSO — e o caso normal de reconexao', async () => {
  const { gravados, recordTenantTemplate } = coletor();
  const r = await provisionTenantTemplates({
    estabelecimentoId: 7, wabaId: 'W1', accessToken: 'tok',
    deps: {
      listTenantTemplates: CATALOGO_FALSO,
      createWhatsAppTemplate: async () => { throw new Error('dup'); },
      isDuplicateTemplateError: () => true,
      recordTenantTemplate, logger: silencioso,
    },
  });
  assert.equal(r.existentes, 3);
  assert.equal(r.falhas, 0);
  assert.equal(gravados.length, 3, 'reconexao tambem registra');
  assert.ok(r.resultados.every((x) => x.ok && x.existente));
});

test('uma recusa NAO interrompe os demais', async () => {
  const { gravados, recordTenantTemplate } = coletor();
  const r = await provisionTenantTemplates({
    estabelecimentoId: 7, wabaId: 'W1', accessToken: 'tok',
    deps: {
      listTenantTemplates: CATALOGO_FALSO,
      createWhatsAppTemplate: async ({ template }) => {
        if (template.name === 'b_t1') {
          const e = new Error('recusado');
          e.body = { error: { error_user_msg: 'Conteudo nao permitido' } };
          throw e;
        }
        return { id: 'id', status: 'PENDING' };
      },
      isDuplicateTemplateError: () => false,
      recordTenantTemplate, logger: silencioso,
    },
  });
  assert.equal(r.criados, 2, 'os outros dois seguiram');
  assert.equal(r.falhas, 1);
  assert.equal(gravados.length, 3, 'a recusa tambem e registrada');
  const recusado = gravados.find((g) => g.kind === 'reminder_cli');
  assert.equal(recusado.status, 'REJECTED');
  assert.match(recusado.rejectedReason, /Conteudo nao permitido/);
});

test('falha ao GRAVAR nao derruba o provisionamento', async () => {
  // O registro e' rastreabilidade; perde-lo e' ruim, mas nao justifica abortar a conexao.
  const r = await provisionTenantTemplates({
    estabelecimentoId: 7, wabaId: 'W1', accessToken: 'tok',
    deps: {
      listTenantTemplates: CATALOGO_FALSO,
      createWhatsAppTemplate: async () => { throw new Error('x'); },
      isDuplicateTemplateError: () => true,
      recordTenantTemplate: async () => { throw new Error('banco fora'); },
      logger: silencioso,
    },
  });
  assert.equal(r.existentes, 3);
});

test('catalogo vazio devolve zeros, sem lancar', async () => {
  const r = await provisionTenantTemplates({
    estabelecimentoId: 7, wabaId: 'W1', accessToken: 'tok',
    deps: { listTenantTemplates: () => [], recordTenantTemplate: async () => {}, logger: silencioso },
  });
  assert.deepEqual([r.criados, r.existentes, r.falhas], [0, 0, 0]);
});
