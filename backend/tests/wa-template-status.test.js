import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplateStatusEvent } from '../src/lib/wa_template_status.js';
import { parseWebhookPayload } from '../src/whatsapp/inbound/normalize.js';
import { applyTenantTemplateStatus } from '../src/services/waTenantTemplates.js';

const silencioso = { warn() {}, info() {}, error() {} };

const payloadStatus = (event, extra = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1404661824617702',
    changes: [{
      field: 'message_template_status_update',
      value: {
        event,
        message_template_id: 555,
        message_template_name: 'confirmacao_agendamento_t1',
        message_template_language: 'pt_BR',
        ...extra,
      },
    }],
  }],
});

test('o WABA id vem do ENTRY e sobrevive ao parseWebhookPayload', () => {
  // O id da conta nao esta no change nem no value: achatar sem carrega-lo perderia a unica
  // informacao que identifica a conta — e nome de modelo so e' unico DENTRO de uma WABA.
  const [bloco] = parseWebhookPayload(payloadStatus('APPROVED'));
  assert.equal(bloco.wabaId, '1404661824617702');
  assert.equal(bloco.field, 'message_template_status_update');
  assert.equal(bloco.phoneNumberId, '', 'evento de modelo nao traz phone_number_id');
});

test('extrai aprovacao', () => {
  const [bloco] = parseWebhookPayload(payloadStatus('APPROVED'));
  const ev = parseTemplateStatusEvent(bloco);
  assert.equal(ev.status, 'APPROVED');
  assert.equal(ev.name, 'confirmacao_agendamento_t1');
  assert.equal(ev.wabaId, '1404661824617702');
  assert.equal(ev.metaTemplateId, '555');
  assert.equal(ev.reason, null);
});

test('recusa carrega o motivo', () => {
  const [bloco] = parseWebhookPayload(payloadStatus('REJECTED', { reason: 'INCORRECT_CATEGORY' }));
  const ev = parseTemplateStatusEvent(bloco);
  assert.equal(ev.status, 'REJECTED');
  assert.equal(ev.reason, 'INCORRECT_CATEGORY');
});

test('reason "NONE" vira null — e como a Meta diz "sem motivo"', () => {
  const [bloco] = parseWebhookPayload(payloadStatus('APPROVED', { reason: 'NONE' }));
  assert.equal(parseTemplateStatusEvent(bloco).reason, null);
});

test('ignora change que nao e de status de modelo', () => {
  const [bloco] = parseWebhookPayload({
    entry: [{ id: 'W1', changes: [{ field: 'messages', value: { messages: [] } }] }],
  });
  assert.equal(parseTemplateStatusEvent(bloco), null);
});

test('ignora evento sem nome de modelo', () => {
  const [bloco] = parseWebhookPayload({
    entry: [{ id: 'W1', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }] }],
  });
  assert.equal(parseTemplateStatusEvent(bloco), null);
});

test('applyTenantTemplateStatus casa por (waba_id, name)', async () => {
  let sqlUsado = '';
  let params = null;
  const r = await applyTenantTemplateStatus(
    { wabaId: 'W1', name: 'x_t1', status: 'APPROVED', reason: null, metaTemplateId: '9' },
    { deps: { logger: silencioso, query: async (sql, p) => { sqlUsado = sql; params = p; return [{ affectedRows: 1 }]; } } }
  );
  assert.equal(r.atualizado, true);
  assert.match(sqlUsado, /waba_id=\? AND name=\?/);
  assert.deepEqual(params.slice(-2), ['W1', 'x_t1']);
});

test('nao achar linha nao e erro — pode ser modelo criado fora do catalogo', async () => {
  const r = await applyTenantTemplateStatus(
    { wabaId: 'W1', name: 'desconhecido', status: 'APPROVED' },
    { deps: { logger: silencioso, query: async () => [{ affectedRows: 0 }] } }
  );
  assert.equal(r.atualizado, false);
});

test('evento incompleto nao chega a tocar o banco', async () => {
  let chamou = false;
  const r = await applyTenantTemplateStatus(
    { wabaId: 'W1', name: '', status: 'APPROVED' },
    { deps: { logger: silencioso, query: async () => { chamou = true; return [{}]; } } }
  );
  assert.equal(r.atualizado, false);
  assert.equal(chamou, false);
});
