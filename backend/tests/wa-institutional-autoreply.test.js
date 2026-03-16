import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetInstitutionalAutoReplyState,
  handleInstitutionalInboundAutoReply,
  INSTITUTIONAL_AUTO_REPLY_TEXT,
  isInstitutionalWebhookPhoneNumber,
} from '../src/whatsapp/inbound/institutionalAutoReply.js';

function createLogger() {
  return {
    logs: [],
    warns: [],
    log(...args) {
      this.logs.push(args);
    },
    warn(...args) {
      this.warns.push(args);
    },
  };
}

test.beforeEach(() => {
  __resetInstitutionalAutoReplyState();
});

test('isInstitutionalWebhookPhoneNumber only enables the default fallback channel', () => {
  const env = {
    WA_PHONE_NUMBER_ID: 'default-phone-id',
    WA_DEFAULT_TOKEN: 'default-token',
  };

  assert.equal(isInstitutionalWebhookPhoneNumber('default-phone-id', env), true);
  assert.equal(isInstitutionalWebhookPhoneNumber('other-phone-id', env), false);
  assert.equal(isInstitutionalWebhookPhoneNumber('default-phone-id', { WA_PHONE_NUMBER_ID: 'default-phone-id' }), false);
});

test('handleInstitutionalInboundAutoReply envia a mensagem institucional atualizada', async () => {
  const logger = createLogger();
  const sent = [];
  const recorded = [];

  const result = await handleInstitutionalInboundAutoReply({
    phoneNumberId: 'default-phone-id',
    value: {
      metadata: { display_phone_number: '+55 11 4000-0000' },
    },
    message: {
      from: '5511999998888',
      id: 'wamid-1',
      timestamp: '1710000000',
      text: { body: 'oi' },
      type: 'text',
    },
    deps: {
      env: {
        WA_PHONE_NUMBER_ID: 'default-phone-id',
        WA_DEFAULT_TOKEN: 'default-token',
      },
      recordWhatsAppInbound: async ({ recipientId }) => {
        recorded.push(recipientId);
      },
      sendWhatsAppSmart: async (payload) => {
        sent.push(payload);
        return {
          result: { ok: true },
          meta: { decision: 'text', wamid: 'wamid-reply-1' },
        };
      },
      logger,
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'sent');
  assert.deepEqual(recorded, ['5511999998888']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '5511999998888');
  assert.equal(sent[0].message, INSTITUTIONAL_AUTO_REPLY_TEXT);
  assert.equal(sent[0].context.source, 'institutional_auto_reply');
  assert.match(logger.logs[0][0], /\[wa\/webhook\]\[institutional-auto-reply\] sent/);
});

test('handleInstitutionalInboundAutoReply ignora self message e nao envia reply', async () => {
  const logger = createLogger();
  let sendCount = 0;

  const result = await handleInstitutionalInboundAutoReply({
    phoneNumberId: 'default-phone-id',
    value: {
      metadata: { display_phone_number: '+55 11 99999-0000' },
    },
    message: {
      from: '5511999990000',
      id: 'wamid-self',
      text: { body: 'teste' },
      type: 'text',
    },
    deps: {
      env: {
        WA_PHONE_NUMBER_ID: 'default-phone-id',
        WA_DEFAULT_TOKEN: 'default-token',
      },
      sendWhatsAppSmart: async () => {
        sendCount += 1;
        return { result: null, meta: null };
      },
      logger,
    },
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'self_message');
  assert.equal(sendCount, 0);
  assert.match(logger.logs[0][0], /\[wa\/webhook\]\[institutional-auto-reply\] skip self message/);
});

test('handleInstitutionalInboundAutoReply ignora redelivery duplicado pelo mesmo messageId', async () => {
  const logger = createLogger();
  let sendCount = 0;

  const deps = {
    env: {
      WA_PHONE_NUMBER_ID: 'default-phone-id',
      WA_DEFAULT_TOKEN: 'default-token',
    },
    sendWhatsAppSmart: async () => {
      sendCount += 1;
      return {
        result: { ok: true },
        meta: { decision: 'text', wamid: `wamid-reply-${sendCount}` },
      };
    },
    recordWhatsAppInbound: async () => {},
    logger,
  };

  const payload = {
    phoneNumberId: 'default-phone-id',
    value: {
      metadata: { display_phone_number: '+55 11 4000-0000' },
    },
    message: {
      from: '5511912345678',
      id: 'wamid-dup',
      text: { body: 'oi de novo' },
      type: 'text',
    },
    deps,
  };

  const first = await handleInstitutionalInboundAutoReply(payload);
  const second = await handleInstitutionalInboundAutoReply(payload);

  assert.equal(first.handled, true);
  assert.equal(second.handled, false);
  assert.equal(second.reason, 'duplicate_message');
  assert.equal(sendCount, 1);
  assert.match(logger.logs[1][0], /\[wa\/webhook\]\[institutional-auto-reply\] skip duplicate inbound/);
});
