import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionTenantTemplates, applyTenantTemplateStatus } from '../src/services/waTenantTemplates.js';

const SILENCIO = { warn() {}, info() {} };

const UM_MODELO = () => ([
  { kind: 'confirm_cli', name: 'confirmacao_agendamento_t1', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'x' }] },
]);

const erroDuplicado = () => {
  const err = new Error('duplicado');
  err.body = { error: { message: 'Message Template with this name already exists' } };
  return err;
};

test('reconexao: modelo ja existente pega o status REAL na Graph, nao presume PENDING', async () => {
  // O bug que isto trava: a Meta so manda message_template_status_update quando o veredito MUDA.
  // Um modelo aprovado meses atras nao gera evento novo. Presumir PENDING na reconexao deixaria a
  // linha assim para sempre e bloquearia todo envio ao cliente de um salao que antes funcionava.
  const gravadas = [];
  const r = await provisionTenantTemplates({
    estabelecimentoId: 186,
    wabaId: 'W1',
    accessToken: 'tok',
    deps: {
      listTenantTemplates: UM_MODELO,
      createWhatsAppTemplate: async () => { throw erroDuplicado(); },
      isDuplicateTemplateError: () => true,
      fetchWhatsAppTemplateStatus: async () => ({ status: 'APPROVED', metaTemplateId: '55' }),
      recordTenantTemplate: async (p) => { gravadas.push(p); },
      logger: SILENCIO,
    },
  });
  assert.equal(r.existentes, 1);
  assert.equal(gravadas[0].status, 'APPROVED');
  assert.equal(gravadas[0].metaTemplateId, '55');
  assert.equal(r.resultados[0].status_origem, 'graph');
});

test('reconexao: se a Graph nao responde, PENDING e o palpite seguro', async () => {
  // PENDING bloqueia o envio. O contrario — presumir APPROVED — mandaria pela WABA do salao um
  // modelo que pode nao existir la, e o cliente nao receberia nada.
  const gravadas = [];
  const r = await provisionTenantTemplates({
    estabelecimentoId: 186,
    wabaId: 'W1',
    accessToken: 'tok',
    deps: {
      listTenantTemplates: UM_MODELO,
      createWhatsAppTemplate: async () => { throw erroDuplicado(); },
      isDuplicateTemplateError: () => true,
      fetchWhatsAppTemplateStatus: async () => null,
      recordTenantTemplate: async (p) => { gravadas.push(p); },
      logger: SILENCIO,
    },
  });
  assert.equal(gravadas[0].status, 'PENDING');
  assert.equal(r.resultados[0].status_origem, 'presumido');
});

test('reconexao: consulta que EXPLODE tambem cai em PENDING, sem derrubar os outros modelos', async () => {
  const gravadas = [];
  const r = await provisionTenantTemplates({
    estabelecimentoId: 186,
    wabaId: 'W1',
    accessToken: 'tok',
    deps: {
      listTenantTemplates: UM_MODELO,
      createWhatsAppTemplate: async () => { throw erroDuplicado(); },
      isDuplicateTemplateError: () => true,
      fetchWhatsAppTemplateStatus: async () => { throw new Error('rede'); },
      recordTenantTemplate: async (p) => { gravadas.push(p); },
      logger: SILENCIO,
    },
  });
  assert.equal(gravadas[0].status, 'PENDING');
  assert.equal(r.falhas, 0, 'nao achar o status nao e falha de provisionamento');
});

test('status: devolve de quem e o modelo para o webhook poder avisar o dono', async () => {
  const respostas = [[{ affectedRows: 1 }], [[{ estabelecimento_id: 186 }]]];
  let i = 0;
  const r = await applyTenantTemplateStatus(
    { wabaId: 'W1', name: 'confirmacao_agendamento_t1', status: 'APPROVED', reason: null, metaTemplateId: null },
    { deps: { query: async () => respostas[i++], logger: SILENCIO } }
  );
  assert.deepEqual(r, { atualizado: true, estabelecimentoId: 186 });
});

test('status: sem linha correspondente nao devolve dono — nada a avisar', async () => {
  const r = await applyTenantTemplateStatus(
    { wabaId: 'W9', name: 'nao_existe', status: 'APPROVED', reason: null, metaTemplateId: null },
    { deps: { query: async () => [{ affectedRows: 0 }], logger: SILENCIO } }
  );
  assert.deepEqual(r, { atualizado: false, estabelecimentoId: null });
});
