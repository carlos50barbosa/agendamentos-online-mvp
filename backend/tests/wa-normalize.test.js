import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInboundText,
  normalizeInboundMessage,
  parseWebhookPayload,
  summarizeChangeForLog,
} from '../src/whatsapp/inbound/normalize.js';

test('extractInboundText handles text/button/interactive', () => {
  assert.equal(extractInboundText({ text: { body: 'Olá' } }), 'Olá');
  assert.equal(extractInboundText({ button: { text: 'Confirmar' } }), 'Confirmar');
  assert.equal(
    extractInboundText({ interactive: { list_reply: { title: 'Corte masculino' } } }),
    'Corte masculino'
  );
});

test('parseWebhookPayload returns changes with phone number id', () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '123456' },
          messages: [{ id: 'wamid.1', from: '5511999999999', type: 'text', text: { body: 'menu' } }],
        },
      }],
    }],
  };
  const blocks = parseWebhookPayload(payload);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].phoneNumberId, '123456');
  assert.equal(blocks[0].messages.length, 1);
});

test('parseWebhookPayload preserva o field do change', () => {
  const blocks = parseWebhookPayload({
    entry: [{ changes: [{ field: 'account_update', value: { event: 'DISABLED_UPDATE' } }] }],
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].field, 'account_update');
  // account_update nao traz phone_number_id — e era exatamente por isso que sumia.
  assert.equal(blocks[0].phoneNumberId, '');
});

test('summarizeChangeForLog captura o estado da conta em account_update', () => {
  const resumo = summarizeChangeForLog({
    field: 'account_update',
    value: {
      event: 'ACCOUNT_RESTRICTION_REMOVED',
      ban_info: { waba_ban_state: 'REINSTATE', waba_ban_date: '2026-07-15' },
      violation_info: { violation_type: 'ACCOUNT_INTEGRITY' },
    },
  });
  assert.equal(resumo.field, 'account_update');
  assert.equal(resumo.event, 'ACCOUNT_RESTRICTION_REMOVED');
  assert.equal(resumo.ban_info.waba_ban_state, 'REINSTATE');
  assert.equal(resumo.violation_info.violation_type, 'ACCOUNT_INTEGRITY');
});

test('summarizeChangeForLog NAO vaza telefone nem corpo de mensagem', () => {
  const resumo = summarizeChangeForLog({
    field: 'messages',
    value: {
      metadata: { phone_number_id: '907736642421274' },
      contacts: [{ wa_id: '5511988887777', profile: { name: 'Juliana' } }],
      messages: [{ id: 'wamid.1', from: '5511988887777', text: { body: 'quero remarcar' } }],
    },
  });
  const serializado = JSON.stringify(resumo);
  // O phone_number_id e' o numero do PROPRIO negocio e ajuda a achar a conta no log; o que nao pode
  // vazar e' dado de quem escreveu.
  assert.equal(resumo.messages, 1);
  assert.ok(!serializado.includes('5511988887777'), 'telefone do cliente vazou no resumo');
  assert.ok(!serializado.includes('quero remarcar'), 'corpo da mensagem vazou no resumo');
  assert.ok(!serializado.includes('Juliana'), 'nome do contato vazou no resumo');
});

test('normalizeInboundMessage outputs canonical fields', () => {
  const normalized = normalizeInboundMessage({
    tenantId: 27,
    phoneNumberId: '999',
    value: { contacts: [{ wa_id: '5511888888888' }] },
    message: {
      id: 'wamid.abc',
      from: '55 (11) 98888-7777',
      type: 'text',
      text: { body: 'Agendar' },
      context: { id: 'wamid.ctx' },
    },
  });
  assert.equal(normalized.tenantId, 27);
  assert.equal(normalized.phoneNumberId, '999');
  assert.equal(normalized.messageId, 'wamid.abc');
  assert.equal(normalized.fromPhone, '5511988887777');
  assert.equal(normalized.text, 'Agendar');
  assert.equal(normalized.contextMessageId, 'wamid.ctx');
});
