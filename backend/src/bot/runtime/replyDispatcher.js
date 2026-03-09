import { sendWhatsAppSmart } from '../../lib/notifications.js';
import { enqueueAndSendWhatsAppOutbox } from '../../lib/whatsapp_outbox.js';
import { TEMPLATE_KEYS, getTemplate } from '../templates/templateRegistry.js';

function extractWamid(result) {
  return result?.messages?.[0]?.id || null;
}

async function dispatchBotReply({
  account,
  toPhone,
  message,
  replyMode = 'text',
  templateKey = TEMPLATE_KEYS.MENU_RETOMADA,
  templateParams = [],
  context = {},
  deps = {},
}) {
  const resolveTemplate = deps.getTemplate || getTemplate;
  const enqueueOutbox = deps.enqueueAndSendWhatsAppOutbox || enqueueAndSendWhatsAppOutbox;
  const sendText = deps.sendWhatsAppSmart || sendWhatsAppSmart;

  if (!account?.estabelecimento_id || !toPhone) {
    return {
      ok: false,
      replyType: replyMode === 'template' ? 'template' : 'text',
      errorCode: 'BOT_REPLY_INVALID',
      result: null,
      meta: null,
    };
  }

  if (replyMode === 'template') {
    const resolvedTemplate = resolveTemplate(templateKey, templateParams);
    if (!resolvedTemplate) {
      return {
        ok: false,
        replyType: 'template',
        errorCode: 'BOT_NO_TEMPLATE',
        result: null,
        meta: { decision: 'template', reason: 'template_missing' },
      };
    }
    const outboxResult = await enqueueOutbox({
      tenantId: account.estabelecimento_id,
      to: toPhone,
      kind: 'bot_outside_window',
      template: {
        name: resolvedTemplate.templateName,
        lang: resolvedTemplate.language,
        components: resolvedTemplate.components,
      },
      metadata: {
        source: 'bot',
        template_key: templateKey,
        ...(context || {}),
      },
    });
    if (!outboxResult?.ok) {
      return {
        ok: false,
        replyType: 'template',
        errorCode: outboxResult?.errorCode || 'BOT_TEMPLATE_SEND_FAILED',
        result: outboxResult || null,
        meta: { decision: 'template', reason: 'outbox_error', outbox_id: outboxResult?.outboxId || null },
      };
    }
    return {
      ok: true,
      replyType: 'template',
      result: outboxResult?.sendResult || outboxResult,
      meta: {
        decision: 'template',
        outbox_id: outboxResult?.outboxId || null,
        wamid: outboxResult?.providerMessageId || null,
      },
    };
  }

  const reply = await sendText({
    to: toPhone,
    message,
    context: {
      estabelecimentoId: account.estabelecimento_id,
      ...(context || {}),
    },
    allowText: true,
    forceTemplate: false,
    returnMeta: true,
  });
  return {
    ok: true,
    replyType: reply?.meta?.decision === 'template' ? 'template' : 'text',
    result: reply?.result || null,
    meta: {
      ...(reply?.meta || {}),
      wamid: reply?.meta?.wamid || extractWamid(reply?.result),
    },
  };
}

export { dispatchBotReply };
