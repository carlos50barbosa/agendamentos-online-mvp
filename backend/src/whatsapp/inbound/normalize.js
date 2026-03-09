const FACEBOOK_ORIGINS = ['facebook.com', 'meta.com'];

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function extractInboundText(message) {
  const raw =
    message?.text?.body ||
    message?.button?.text ||
    message?.button?.payload ||
    message?.interactive?.button_reply?.title ||
    message?.interactive?.button_reply?.id ||
    message?.interactive?.list_reply?.title ||
    message?.interactive?.list_reply?.id ||
    '';
  return normalizeText(raw);
}

function detectMessageType(message) {
  if (!message || typeof message !== 'object') return 'unknown';
  if (message.type) return String(message.type);
  if (message.text?.body) return 'text';
  if (message.button) return 'button';
  if (message.interactive?.button_reply) return 'interactive_button';
  if (message.interactive?.list_reply) return 'interactive_list';
  return 'unknown';
}

function normalizeInboundMessage({ tenantId, phoneNumberId, message, value }) {
  const fromPhone = toDigits(message?.from || value?.contacts?.[0]?.wa_id || '');
  const messageId = normalizeText(message?.id || '');
  const text = extractInboundText(message);
  const type = detectMessageType(message);
  return {
    tenantId: Number(tenantId),
    phoneNumberId: String(phoneNumberId || ''),
    messageId,
    fromPhone,
    text,
    type,
    timestamp: message?.timestamp ? Number(message.timestamp) : null,
    contextMessageId: normalizeText(message?.context?.id || ''),
    buttonPayload: normalizeText(
      message?.button?.payload ||
      message?.interactive?.button_reply?.id ||
      message?.interactive?.list_reply?.id ||
      ''
    ),
    rawMessage: message || null,
  };
}

function pickPhoneNumberId(value) {
  return String(value?.metadata?.phone_number_id || value?.phone_number_id || '').trim();
}

function extractChanges(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const changes = [];
  entries.forEach((entry) => {
    const list = Array.isArray(entry?.changes) ? entry.changes : [];
    list.forEach((change) => {
      changes.push(change);
    });
  });
  return changes;
}

function parseWebhookPayload(payload) {
  const changes = extractChanges(payload);
  const parsed = [];
  changes.forEach((change) => {
    const value = change?.value || {};
    const phoneNumberId = pickPhoneNumberId(value);
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
    parsed.push({
      phoneNumberId,
      value,
      messages,
      statuses,
    });
  });
  return parsed;
}

function isTrustedMetaOrigin(origin) {
  const raw = String(origin || '').trim().toLowerCase();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return FACEBOOK_ORIGINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export {
  toDigits,
  extractInboundText,
  normalizeInboundMessage,
  parseWebhookPayload,
  pickPhoneNumberId,
  isTrustedMetaOrigin,
};
