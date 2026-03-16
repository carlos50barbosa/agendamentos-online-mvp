import { sendWhatsAppSmart } from '../../lib/notifications.js';
import { recordWhatsAppInbound } from '../../lib/whatsapp_contacts.js';
import { normalizeInboundMessage } from './normalize.js';

const INSTITUTIONAL_AUTO_REPLY_TEXT = [
  'Ol\u00e1! Aqui \u00e9 o assist\u00eante do Agendamentos Online.',
  '',
  'Para marcar, reagendar ou cancelar, use nosso site.',
  '',
  'Se tiver qualquer d\u00favida, chamar no WhatsApp: 11915155349 ou acesse: https://agendamentosonline.com/ajuda.',
  '',
  'Obrigado!',
].join('\n');

const RECENT_MESSAGE_TTL_MS = 30 * 60 * 1000;
const recentInstitutionalMessageIds = new Map();

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskPhone(value) {
  const digits = toDigits(value);
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function pruneRecentInstitutionalMessageIds(nowMs = Date.now()) {
  recentInstitutionalMessageIds.forEach((expiresAt, key) => {
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      recentInstitutionalMessageIds.delete(key);
    }
  });
}

function reserveInstitutionalMessageId({ phoneNumberId, messageId, nowMs = Date.now() }) {
  const channel = String(phoneNumberId || '').trim();
  const inboundMessageId = String(messageId || '').trim();
  if (!channel || !inboundMessageId) return { ok: false, duplicate: false };
  pruneRecentInstitutionalMessageIds(nowMs);
  const key = `${channel}:${inboundMessageId}`;
  if (recentInstitutionalMessageIds.has(key)) {
    return { ok: false, duplicate: true, key };
  }
  recentInstitutionalMessageIds.set(key, nowMs + RECENT_MESSAGE_TTL_MS);
  return { ok: true, duplicate: false, key };
}

function releaseInstitutionalMessageId(key) {
  if (!key) return;
  recentInstitutionalMessageIds.delete(String(key));
}

function getInstitutionalPhoneNumberId(env = process.env) {
  return String(env?.WA_PHONE_NUMBER_ID || '').trim();
}

function hasInstitutionalCredentials(env = process.env) {
  return Boolean(String(env?.WA_DEFAULT_TOKEN || env?.WA_TOKEN || '').trim());
}

function isInstitutionalWebhookPhoneNumber(phoneNumberId, env = process.env) {
  const normalizedPhoneNumberId = String(phoneNumberId || '').trim();
  return Boolean(
    normalizedPhoneNumberId
    && hasInstitutionalCredentials(env)
    && normalizedPhoneNumberId === getInstitutionalPhoneNumberId(env)
  );
}

function getBusinessPhoneDigits(value) {
  return toDigits(
    value?.metadata?.display_phone_number ||
    value?.display_phone_number ||
    ''
  );
}

function isInstitutionalSelfMessage({ normalized, value }) {
  const fromPhone = toDigits(normalized?.fromPhone || '');
  const businessPhone = getBusinessPhoneDigits(value);
  if (!fromPhone || !businessPhone) return false;
  return fromPhone === businessPhone;
}

async function handleInstitutionalInboundAutoReply({
  phoneNumberId,
  value,
  message,
  deps = {},
}) {
  const env = deps.env || process.env;
  const normalizeMessage = deps.normalizeInboundMessage || normalizeInboundMessage;
  const recordInbound = deps.recordWhatsAppInbound || recordWhatsAppInbound;
  const sendReply = deps.sendWhatsAppSmart || sendWhatsAppSmart;
  const now = deps.now || Date.now;
  const logger = deps.logger || console;

  if (!isInstitutionalWebhookPhoneNumber(phoneNumberId, env)) {
    return { handled: false, reason: 'not_institutional_phone' };
  }

  const normalized = normalizeMessage({
    tenantId: 0,
    phoneNumberId,
    message,
    value,
  });

  if (!normalized?.fromPhone || !normalized?.messageId) {
    logger.warn('[wa/webhook][institutional-auto-reply] skip invalid inbound', {
      phone_number_id: phoneNumberId || null,
      has_from_phone: Boolean(normalized?.fromPhone),
      has_message_id: Boolean(normalized?.messageId),
      type: normalized?.type || null,
    });
    return { handled: false, reason: 'invalid_inbound', normalized };
  }

  if (isInstitutionalSelfMessage({ normalized, value })) {
    logger.log('[wa/webhook][institutional-auto-reply] skip self message', {
      phone_number_id: phoneNumberId,
      from_phone: maskPhone(normalized.fromPhone),
      message_id: normalized.messageId,
    });
    return { handled: false, reason: 'self_message', normalized };
  }

  const reservation = reserveInstitutionalMessageId({
    phoneNumberId,
    messageId: normalized.messageId,
    nowMs: now(),
  });
  if (reservation.duplicate) {
    logger.log('[wa/webhook][institutional-auto-reply] skip duplicate inbound', {
      phone_number_id: phoneNumberId,
      from_phone: maskPhone(normalized.fromPhone),
      message_id: normalized.messageId,
    });
    return { handled: false, reason: 'duplicate_message', normalized };
  }

  try {
    await recordInbound({ recipientId: normalized.fromPhone });
    const reply = await sendReply({
      to: normalized.fromPhone,
      message: INSTITUTIONAL_AUTO_REPLY_TEXT,
      allowText: true,
      forceTemplate: false,
      returnMeta: true,
      context: {
        source: 'institutional_auto_reply',
        phone_number_id: String(phoneNumberId || ''),
      },
    });

    logger.log('[wa/webhook][institutional-auto-reply] sent', {
      phone_number_id: phoneNumberId,
      from_phone: maskPhone(normalized.fromPhone),
      message_id: normalized.messageId,
      reply_decision: reply?.meta?.decision || null,
      wamid: reply?.meta?.wamid || null,
      type: normalized.type || null,
    });

    return {
      handled: true,
      reason: 'sent',
      normalized,
      reply,
    };
  } catch (err) {
    releaseInstitutionalMessageId(reservation.key);
    logger.warn('[wa/webhook][institutional-auto-reply] send failed', {
      phone_number_id: phoneNumberId,
      from_phone: maskPhone(normalized.fromPhone),
      message_id: normalized.messageId,
      error: err?.message || String(err),
    });
    return {
      handled: false,
      reason: 'send_failed',
      normalized,
      error: err,
    };
  }
}

function __resetInstitutionalAutoReplyState() {
  recentInstitutionalMessageIds.clear();
}

export {
  INSTITUTIONAL_AUTO_REPLY_TEXT,
  handleInstitutionalInboundAutoReply,
  isInstitutionalWebhookPhoneNumber,
  isInstitutionalSelfMessage,
  __resetInstitutionalAutoReplyState,
};
