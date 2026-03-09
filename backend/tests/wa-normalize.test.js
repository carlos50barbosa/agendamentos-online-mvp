import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInboundText,
  normalizeInboundMessage,
  parseWebhookPayload,
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
