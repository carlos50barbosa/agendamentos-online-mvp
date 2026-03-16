import { Router } from 'express';
import { initWhatsAppContacts, recordWhatsAppInbound } from '../lib/whatsapp_contacts.js';
import { getWaAccountByPhoneNumberId, recordWaMessage } from '../services/waTenant.js';
import { engine } from '../bot/engine/index.js';
import { createInboundEvent, markInboundProcessed } from '../bot/storage/inboundStore.js';
import { getSession, saveSession, touchLastInteraction } from '../bot/storage/sessionStore.js';
import { logConversation } from '../bot/logging/conversationLogger.js';
import { resolveReplyMode } from '../bot/engine/replyPolicy.js';
import { detectIntent, normalizeIntentText } from '../bot/engine/intents.js';
import { normalizeInboundMessage, parseWebhookPayload } from '../whatsapp/inbound/normalize.js';
import { handleInstitutionalInboundAutoReply } from '../whatsapp/inbound/institutionalAutoReply.js';
import { handleReminderConfirmation } from '../whatsapp/inbound/reminderConfirmation.js';
import { TEMPLATE_KEYS } from '../bot/templates/templateRegistry.js';
import { dispatchBotReply } from '../bot/runtime/replyDispatcher.js';
import { evaluateTenantPolicy, getTenantBotSettings } from '../bot/storage/settingsStore.js';
import { getActiveHandoff, openHandoff, closeHandoff } from '../bot/storage/handoffStore.js';
import { shouldPauseEngine } from '../bot/runtime/handoffPolicy.js';
import { checkRateLimit } from '../bot/runtime/rateLimiter.js';
import { mapEngineResultToMetrics } from '../bot/metrics/metricsMapper.js';
import { incrementDailyMetrics } from '../bot/storage/metricsStore.js';

const router = Router();
const OFFICIAL_WEBHOOK_PATH = '/api/webhooks/whatsapp';

initWhatsAppContacts().catch(() => {});

function isConnectedAccount(account) {
  return account && String(account.status || '').toLowerCase() === 'connected';
}

function emptyMetrics() {
  return {
    inbound_count: 1,
    started_agendar: 0,
    completed_agendar: 0,
    started_remarcar: 0,
    completed_remarcar: 0,
    started_cancelar: 0,
    completed_cancelar: 0,
    conflicts_409: 0,
    handoff_opened: 0,
    outside_window_template_sent: 0,
    errors_count: 0,
  };
}

function mergeMetrics(target, increments) {
  const base = target || {};
  const extra = increments || {};
  Object.keys(base).forEach((key) => {
    const sum = Number(base[key] || 0) + Number(extra[key] || 0);
    base[key] = Number.isFinite(sum) ? sum : Number(base[key] || 0);
  });
  return base;
}

function policyMessage(reason) {
  if (reason === 'DISABLED') {
    return 'No momento, vou te encaminhar para um atendente humano.';
  }
  if (reason === 'HUMAN_ONLY') {
    return 'Este canal esta em atendimento humano. Vou te encaminhar agora.';
  }
  if (reason === 'ROLLOUT_HOLDOUT') {
    return 'Para esta conversa, vou te encaminhar para um atendente humano.';
  }
  return 'Vou te encaminhar para um atendente humano.';
}

function pausedMessage() {
  return 'Seu atendimento humano esta em andamento. Se quiser retomar o bot, digite "voltar bot" ou "menu".';
}

function rateLimitMessage(retryAfterSec) {
  const wait = Number.isFinite(Number(retryAfterSec)) ? Math.max(1, Math.trunc(Number(retryAfterSec))) : 60;
  return `Recebi muitas mensagens em pouco tempo. Aguarde ${wait}s e tente novamente.`;
}

function resolveInboundReplyMode(lastInteractionAt) {
  if (!lastInteractionAt) return 'text';
  return resolveReplyMode({ lastInteractionAt, now: new Date() });
}

function deriveUpstreamErrorCode(engineResult) {
  const endpointResult = engineResult?.endpointResult || {};
  const explicit = String(
    endpointResult.bot_error_code ||
    endpointResult.error_code ||
    endpointResult.errorCode ||
    ''
  ).trim();
  if (explicit) return explicit;
  const status = Number(endpointResult.status || 0);
  if (status >= 500) return 'BOT_UPSTREAM_5XX';
  if (status === 0 && String(engineResult?.action || '').endsWith('_FAIL')) return 'BOT_UPSTREAM_TIMEOUT';
  return null;
}

async function handleStatusEvent({ account, phoneNumberId, value, status }) {
  await recordWaMessage({
    estabelecimentoId: account.estabelecimento_id,
    direction: 'out',
    waId: status?.recipient_id || null,
    wamid: status?.id || null,
    phoneNumberId,
    payload: { status, metadata: value?.metadata || null },
    status: status?.status || null,
  });
}

async function openHandoffAndPause({ tenantId, fromPhone, reason, baseSession }) {
  const opened = await openHandoff({ tenantId, fromPhone, reason });
  const context = (baseSession?.context && typeof baseSession.context === 'object')
    ? { ...baseSession.context }
    : {};
  context.bot_paused = true;
  context.handoff_reason = String(reason || 'manual').slice(0, 128);
  if (opened?.item?.id) context.handoff_id = opened.item.id;
  await saveSession({
    tenantId,
    fromPhone,
    state: 'HUMANO_OPEN',
    context,
  });
  return { opened, context };
}

async function sendBotReply({ account, toPhone, message, replyMode, context }) {
  return dispatchBotReply({
    account,
    toPhone,
    message,
    replyMode,
    templateKey: TEMPLATE_KEYS.MENU_RETOMADA,
    templateParams: message ? [message] : [],
    context,
  });
}

async function processInboundMessage({ account, phoneNumberId, value, message }) {
  const startedAt = Date.now();
  const tenantId = Number(account.estabelecimento_id);
  const tenantResolutionSource = `wa_accounts.phone_number_id:${phoneNumberId}`;

  const normalized = normalizeInboundMessage({
    tenantId,
    phoneNumberId,
    message,
    value,
  });

  if (!normalized.fromPhone || !normalized.messageId) {
    return;
  }

  await recordWaMessage({
    estabelecimentoId: tenantId,
    direction: 'in',
    waId: normalized.fromPhone,
    wamid: normalized.messageId,
    phoneNumberId,
    payload: normalized.rawMessage,
    status: null,
  });

  recordWhatsAppInbound({ recipientId: normalized.fromPhone }).catch((err) =>
    console.warn('[wa/webhook][inbound][contacts]', err?.message || err)
  );

  const inboundEvent = await createInboundEvent({
    tenantId,
    fromPhone: normalized.fromPhone,
    messageId: normalized.messageId,
    type: normalized.type,
    payload: normalized.rawMessage,
  });

  if (!inboundEvent.shouldProcess) {
    const status = String(inboundEvent.status || '').toLowerCase();
    if (!['processed', 'ignored', 'error'].includes(status)) {
      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'ignored',
        error: inboundEvent.duplicate ? 'duplicate_message' : inboundEvent.reason,
      });
    }
    return;
  }

  let metrics = emptyMetrics();
  let interactionAt = new Date();
  if (Number.isFinite(Number(normalized.timestamp)) && Number(normalized.timestamp) > 0) {
    const candidate = new Date(Number(normalized.timestamp) * 1000);
    if (Number.isFinite(candidate.getTime())) interactionAt = candidate;
  }

  let session = null;
  let replyMode = 'text';
  let replyType = 'text';
  let handoffOpened = false;
  let errorCode = null;
  let engineResult = null;
  let policyMode = 'hybrid';

  try {
    session = await getSession({ tenantId, fromPhone: normalized.fromPhone });
    replyMode = resolveInboundReplyMode(session?.lastInteractionAt);
    const normalizedText = normalizeIntentText(normalized.text || normalized.buttonPayload || '');
    const intent = detectIntent(normalizedText);

    const settings = await getTenantBotSettings(tenantId);
    const policy = evaluateTenantPolicy({
      settings,
      fromPhone: normalized.fromPhone,
    });
    policyMode = policy.mode;

    if (policy.reason === 'KILL_SWITCH') {
      await logConversation({
        tenantId,
        fromPhone: normalized.fromPhone,
        messageId: normalized.messageId,
        intent,
        prevState: session?.state || null,
        nextState: session?.state || null,
        action: 'KILL_SWITCH_IGNORE',
        endpointCalled: null,
        endpointResult: { policy, settings_source: settings.source },
        replyType: 'text',
        tenantResolutionSource,
        latencyMs: Date.now() - startedAt,
      });
      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'ignored',
        error: 'kill_switch',
      });
      return;
    }

    if (!policy.allowEngine) {
      const handoff = policy.openHandoff
        ? await openHandoffAndPause({
            tenantId,
            fromPhone: normalized.fromPhone,
            reason: `POLICY_${policy.reason}`,
            baseSession: session,
          })
        : null;
      handoffOpened = Boolean(handoff?.opened?.created);

      const messageText = policyMessage(policy.reason);
      const sent = policy.allowAutoReply
        ? await sendBotReply({
            account,
            toPhone: normalized.fromPhone,
            message: messageText,
            replyMode,
            context: {
              policy_reason: policy.reason,
              source: 'policy',
            },
          })
        : { ok: true, replyType: 'text', result: null, meta: null };
      replyType = sent.replyType || 'text';
      errorCode = sent.ok ? null : (sent.errorCode || null);

      if (errorCode === 'BOT_NO_TEMPLATE') {
        const auto = await openHandoffAndPause({
          tenantId,
          fromPhone: normalized.fromPhone,
          reason: 'BOT_NO_TEMPLATE',
          baseSession: session,
        });
        handoffOpened = handoffOpened || Boolean(auto?.opened?.created);
      }

      const policyResult = {
        policy,
        settings_source: settings.source,
        handoff_id: handoff?.opened?.item?.id || null,
        reply_mode: replyMode,
        reply_error_code: errorCode,
      };

      const syntheticResult = {
        intent,
        action: `POLICY_${policy.reason}`,
        prevState: session?.state || null,
        nextState: session?.state || null,
        endpointResult: { status: 0 },
      };
      mergeMetrics(metrics, mapEngineResultToMetrics({
        engineResult: syntheticResult,
        replyType,
        replyMode,
        handoffOpened,
        errorCode,
      }));

      await logConversation({
        tenantId,
        fromPhone: normalized.fromPhone,
        messageId: normalized.messageId,
        intent,
        prevState: session?.state || null,
        nextState: policy.openHandoff ? 'HUMANO_OPEN' : (session?.state || null),
        action: syntheticResult.action,
        endpointCalled: null,
        endpointResult: policyResult,
        replyType,
        tenantResolutionSource,
        latencyMs: Date.now() - startedAt,
      });

      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'processed',
      });
      return;
    }

    const activeHandoff = await getActiveHandoff({ tenantId, fromPhone: normalized.fromPhone });
    const pauseDecision = shouldPauseEngine({
      mode: policy.mode,
      botPaused: Boolean(session?.context?.bot_paused),
      hasActiveHandoff: Boolean(activeHandoff),
      text: normalizedText,
    });

    let textForEngine = normalized.text;
    if (pauseDecision.canResume) {
      await closeHandoff({ tenantId, fromPhone: normalized.fromPhone, closedBy: 'bot_resume' });
      const nextContext = {
        ...(session?.context && typeof session.context === 'object' ? session.context : {}),
        bot_paused: false,
      };
      delete nextContext.handoff_reason;
      delete nextContext.handoff_id;
      await saveSession({
        tenantId,
        fromPhone: normalized.fromPhone,
        state: 'START',
        context: nextContext,
      });
      session = { ...(session || {}), state: 'START', context: nextContext };
      textForEngine = 'menu';
    } else if (pauseDecision.blockEngine) {
      const sent = await sendBotReply({
        account,
        toPhone: normalized.fromPhone,
        message: pausedMessage(),
        replyMode,
        context: {
          source: 'handoff_pause',
          handoff_id: activeHandoff?.id || null,
        },
      });
      replyType = sent.replyType || 'text';
      errorCode = sent.ok ? null : (sent.errorCode || null);

      if (errorCode === 'BOT_NO_TEMPLATE') {
        const auto = await openHandoffAndPause({
          tenantId,
          fromPhone: normalized.fromPhone,
          reason: 'BOT_NO_TEMPLATE',
          baseSession: session,
        });
        handoffOpened = Boolean(auto?.opened?.created);
      }

      mergeMetrics(metrics, mapEngineResultToMetrics({
        engineResult: {
          intent,
          action: 'BOT_PAUSED',
          prevState: session?.state || null,
          nextState: session?.state || null,
          endpointResult: { status: 0 },
        },
        replyType,
        replyMode,
        handoffOpened,
        errorCode,
      }));

      await logConversation({
        tenantId,
        fromPhone: normalized.fromPhone,
        messageId: normalized.messageId,
        intent,
        prevState: session?.state || null,
        nextState: session?.state || null,
        action: 'BOT_PAUSED',
        endpointCalled: null,
        endpointResult: {
          pause_reason: pauseDecision.reason,
          handoff_id: activeHandoff?.id || null,
          reply_mode: replyMode,
          reply_error_code: errorCode,
        },
        replyType,
        tenantResolutionSource,
        latencyMs: Date.now() - startedAt,
      });
      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'processed',
      });
      return;
    }

    const rate = checkRateLimit({
      tenantId,
      fromPhone: normalized.fromPhone,
    });
    if (!rate.allowed) {
      const sent = await sendBotReply({
        account,
        toPhone: normalized.fromPhone,
        message: rateLimitMessage(rate.retryAfterSec),
        replyMode,
        context: {
          source: 'rate_limit',
          retry_after_sec: rate.retryAfterSec,
        },
      });
      replyType = sent.replyType || 'text';
      errorCode = sent.ok ? null : (sent.errorCode || null);

      if (errorCode === 'BOT_NO_TEMPLATE' && policy.mode === 'hybrid') {
        const auto = await openHandoffAndPause({
          tenantId,
          fromPhone: normalized.fromPhone,
          reason: 'BOT_NO_TEMPLATE',
          baseSession: session,
        });
        handoffOpened = Boolean(auto?.opened?.created);
      }

      mergeMetrics(metrics, mapEngineResultToMetrics({
        engineResult: {
          intent,
          action: 'RATE_LIMITED',
          prevState: session?.state || null,
          nextState: session?.state || null,
          endpointResult: { status: 429 },
        },
        replyType,
        replyMode,
        handoffOpened,
        errorCode: errorCode || 'BOT_RATE_LIMIT',
      }));

      await logConversation({
        tenantId,
        fromPhone: normalized.fromPhone,
        messageId: normalized.messageId,
        intent,
        prevState: session?.state || null,
        nextState: session?.state || null,
        action: 'RATE_LIMITED',
        endpointCalled: null,
        endpointResult: {
          count: rate.count,
          remaining: rate.remaining,
          retry_after_sec: rate.retryAfterSec,
          reply_mode: replyMode,
          reply_error_code: errorCode,
        },
        replyType,
        tenantResolutionSource,
        latencyMs: Date.now() - startedAt,
      });
      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'processed',
      });
      return;
    }

    const confirmation = await handleReminderConfirmation({
      fromPhone: normalized.fromPhone,
      text: textForEngine,
      buttonPayload: normalized.buttonPayload,
      contextMessageId: normalized.contextMessageId,
    });

    if (confirmation?.handled) {
      if (confirmation.message) {
        const sent = await sendBotReply({
          account,
          toPhone: normalized.fromPhone,
          message: confirmation.message,
          replyMode,
          context: { source: 'reminder_confirmation' },
        });
        replyType = sent.replyType || 'text';
        errorCode = sent.ok ? null : (sent.errorCode || null);
      }

      if (errorCode === 'BOT_NO_TEMPLATE' && policy.mode === 'hybrid') {
        const auto = await openHandoffAndPause({
          tenantId,
          fromPhone: normalized.fromPhone,
          reason: 'BOT_NO_TEMPLATE',
          baseSession: session,
        });
        handoffOpened = Boolean(auto?.opened?.created);
      }

      mergeMetrics(metrics, mapEngineResultToMetrics({
        engineResult: {
          intent: 'CONFIRMAR',
          action: confirmation.action || 'REMINDER_CONFIRM',
          prevState: session?.state || null,
          nextState: session?.state || null,
          endpointResult: { status: 200 },
        },
        replyType,
        replyMode,
        handoffOpened,
        errorCode,
      }));

      await logConversation({
        tenantId,
        fromPhone: normalized.fromPhone,
        messageId: normalized.messageId,
        intent: 'CONFIRMAR',
        prevState: session?.state || null,
        nextState: session?.state || null,
        action: confirmation.action || 'REMINDER_CONFIRM',
        endpointCalled: null,
        endpointResult: {
          ok: confirmation.ok,
          agendamentoId: confirmation.appointmentId || null,
          estabelecimentoId: confirmation.establishmentId || null,
          reply_mode: replyMode,
          reply_error_code: errorCode,
        },
        replyType,
        tenantResolutionSource,
        latencyMs: Date.now() - startedAt,
      });
      await markInboundProcessed({
        tenantId,
        messageId: normalized.messageId,
        status: 'processed',
      });
      return;
    }

    engineResult = await engine.handleInbound({
      tenantId,
      fromPhone: normalized.fromPhone,
      messageId: normalized.messageId,
      type: normalized.type,
      text: textForEngine,
      raw: normalized.rawMessage,
    });

    if (engineResult?.replyText) {
      const sent = await sendBotReply({
        account,
        toPhone: normalized.fromPhone,
        message: engineResult.replyText,
        replyMode,
        context: { source: 'engine' },
      });
      replyType = sent.replyType || 'text';
      errorCode = sent.ok ? null : (sent.errorCode || null);
    }

    if (engineResult?.action === 'HANDOFF_OPEN') {
      const opened = await openHandoffAndPause({
        tenantId,
        fromPhone: normalized.fromPhone,
        reason: 'USER_REQUEST',
        baseSession: { state: engineResult.nextState, context: engineResult.nextContext || {} },
      });
      handoffOpened = Boolean(opened?.opened?.created);
    }

    const upstreamErrorCode = deriveUpstreamErrorCode(engineResult);
    if (policy.mode === 'hybrid' && (upstreamErrorCode === 'BOT_UPSTREAM_TIMEOUT' || upstreamErrorCode === 'BOT_UPSTREAM_5XX')) {
      const opened = await openHandoffAndPause({
        tenantId,
        fromPhone: normalized.fromPhone,
        reason: upstreamErrorCode,
        baseSession: { state: engineResult.nextState, context: engineResult.nextContext || {} },
      });
      handoffOpened = handoffOpened || Boolean(opened?.opened?.created);
      errorCode = errorCode || upstreamErrorCode;
    }

    if (errorCode === 'BOT_NO_TEMPLATE' && policy.mode === 'hybrid') {
      const auto = await openHandoffAndPause({
        tenantId,
        fromPhone: normalized.fromPhone,
        reason: 'BOT_NO_TEMPLATE',
        baseSession: { state: engineResult.nextState, context: engineResult.nextContext || {} },
      });
      handoffOpened = handoffOpened || Boolean(auto?.opened?.created);
    }

    const endpointResult = {
      ...(engineResult?.endpointResult || {}),
      reply_mode: replyMode,
      reply_error_code: errorCode,
      upstream_error_code: upstreamErrorCode || null,
      handoff_opened: handoffOpened,
      policy_mode: policy.mode,
    };

    mergeMetrics(metrics, mapEngineResultToMetrics({
      engineResult: {
        ...engineResult,
        endpointResult,
      },
      replyType,
      replyMode,
      handoffOpened,
      errorCode,
    }));

    await logConversation({
      tenantId,
      fromPhone: normalized.fromPhone,
      messageId: normalized.messageId,
      intent: engineResult?.intent || intent,
      prevState: engineResult?.prevState || session?.state || null,
      nextState: handoffOpened ? 'HUMANO_OPEN' : (engineResult?.nextState || null),
      action: engineResult?.action || 'NO_ACTION',
      endpointCalled: engineResult?.endpointCalled || null,
      endpointResult,
      replyType,
      tenantResolutionSource,
      latencyMs: Date.now() - startedAt,
    });

    await markInboundProcessed({
      tenantId,
      messageId: normalized.messageId,
      status: 'processed',
    });
  } catch (err) {
    const fallbackIntent = detectIntent(normalizeIntentText(normalized.text || ''));
    errorCode = errorCode || 'BOT_PROCESS_ERROR';

    if (session && policyMode === 'hybrid') {
      const opened = await openHandoffAndPause({
        tenantId,
        fromPhone: normalized.fromPhone,
        reason: errorCode,
        baseSession: session,
      }).catch(() => null);
      handoffOpened = handoffOpened || Boolean(opened?.opened?.created);
    }

    mergeMetrics(metrics, mapEngineResultToMetrics({
      engineResult: {
        intent: engineResult?.intent || fallbackIntent || 'UNKNOWN',
        action: 'BOT_ERROR',
        prevState: engineResult?.prevState || session?.state || null,
        nextState: engineResult?.nextState || session?.state || null,
        endpointResult: { status: 500 },
      },
      replyType,
      replyMode,
      handoffOpened,
      errorCode,
    }));

    console.error('[wa/bot/process]', err?.message || err);
    await logConversation({
      tenantId,
      fromPhone: normalized.fromPhone,
      messageId: normalized.messageId,
      intent: engineResult?.intent || fallbackIntent || 'UNKNOWN',
      prevState: engineResult?.prevState || session?.state || null,
      nextState: handoffOpened ? 'HUMANO_OPEN' : (engineResult?.nextState || session?.state || null),
      action: 'BOT_ERROR',
      endpointCalled: engineResult?.endpointCalled || null,
      endpointResult: {
        error: String(err?.message || err),
        error_code: errorCode,
        reply_mode: replyMode,
        handoff_opened: handoffOpened,
      },
      replyType,
      tenantResolutionSource,
      latencyMs: Date.now() - startedAt,
    }).catch(() => {});
    await markInboundProcessed({
      tenantId,
      messageId: normalized.messageId,
      status: 'error',
      error: err,
    });
  } finally {
    touchLastInteraction({
      tenantId,
      fromPhone: normalized.fromPhone,
      at: interactionAt,
    }).catch((err) => {
      console.warn('[wa/bot/session/touch]', err?.message || err);
    });
    if (metrics) {
      incrementDailyMetrics({
        tenantId,
        increments: metrics,
      }).catch((err) => {
        console.warn('[wa/bot/metrics]', err?.message || err);
      });
    }
  }
}

async function processWebhookPayload(payload) {
  const parsed = parseWebhookPayload(payload);
  for (const block of parsed) {
    const phoneNumberId = String(block.phoneNumberId || '').trim();
    if (!phoneNumberId) continue;

    const account = await getWaAccountByPhoneNumberId(phoneNumberId);
    if (!isConnectedAccount(account)) {
      const messages = Array.isArray(block.messages) ? block.messages : [];
      for (const message of messages) {
        try {
          await handleInstitutionalInboundAutoReply({
            phoneNumberId,
            value: block.value,
            message,
          });
        } catch (err) {
          console.warn('[wa/webhook][institutional-auto-reply]', err?.message || err);
        }
      }
      continue;
    }

    const statuses = Array.isArray(block.statuses) ? block.statuses : [];
    for (const status of statuses) {
      try {
        await handleStatusEvent({ account, phoneNumberId, value: block.value, status });
      } catch (err) {
        console.warn('[wa/webhook][status]', err?.message || err);
      }
    }

    const messages = Array.isArray(block.messages) ? block.messages : [];
    for (const message of messages) {
      await processInboundMessage({
        account,
        phoneNumberId,
        value: block.value,
        message,
      });
    }
  }
}

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && challenge) {
    if (!process.env.WA_VERIFY_TOKEN || token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  return res.status(404).end();
});

router.post('/', async (req, res) => {
  const payload = req.body || {};
  processWebhookPayload(payload).catch((err) => {
    console.error('[wa/webhook][official]', err?.message || err);
  });
  return res.sendStatus(200);
});

router.get('/_meta', (_req, res) => {
  return res.json({
    ok: true,
    official: OFFICIAL_WEBHOOK_PATH,
    compat_aliases: ['/webhooks/whatsapp', '/wa/webhook'],
    now: new Date().toISOString(),
  });
});

export default router;
