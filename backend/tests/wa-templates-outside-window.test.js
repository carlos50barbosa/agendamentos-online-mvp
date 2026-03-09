import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchBotReply } from '../src/bot/runtime/replyDispatcher.js';
import { TEMPLATE_KEYS } from '../src/bot/templates/templateRegistry.js';

test('fora da janela usa outbox template e nao envia texto direto', async () => {
  let outboxCalled = 0;
  let textCalled = 0;
  const result = await dispatchBotReply({
    account: { estabelecimento_id: 27 },
    toPhone: '5511999999999',
    message: 'menu',
    replyMode: 'template',
    templateKey: TEMPLATE_KEYS.MENU_RETOMADA,
    templateParams: ['menu'],
    deps: {
      getTemplate: () => ({
        templateName: 'menu_retomada',
        language: 'pt_BR',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'menu' }] }],
      }),
      enqueueAndSendWhatsAppOutbox: async () => {
        outboxCalled += 1;
        return { ok: true, outboxId: 101, providerMessageId: 'wamid.test', status: 'sent', sendResult: { ok: true } };
      },
      sendWhatsAppSmart: async () => {
        textCalled += 1;
        return { ok: true };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.replyType, 'template');
  assert.equal(outboxCalled, 1);
  assert.equal(textCalled, 0);
});

test('fora da janela sem template retorna BOT_NO_TEMPLATE', async () => {
  const result = await dispatchBotReply({
    account: { estabelecimento_id: 27 },
    toPhone: '5511888877777',
    message: 'menu',
    replyMode: 'template',
    deps: {
      getTemplate: () => null,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'BOT_NO_TEMPLATE');
  assert.equal(result.replyType, 'template');
});
