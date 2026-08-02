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
      // O id da WABA vive no ENTRY, não no change nem no value. Achatar sem carregá-lo junto
      // torna impossível saber a qual conta um evento de modelo pertence — e o nome do modelo
      // só é único DENTRO de uma WABA, então sem isso a atualização de status seria ambígua.
      changes.push({ ...change, __wabaId: entry?.id ? String(entry.id) : null });
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
      // `field` diz QUE tipo de evento é ("messages", "account_update", ...). Sem ele, quem consome
      // só consegue inferir pelo formato do value — e evento de conta não tem phone_number_id,
      // então era descartado sem deixar rastro. Ver summarizeChangeForLog.
      field: change?.field ? String(change.field) : null,
      wabaId: change?.__wabaId || null,
      phoneNumberId,
      value,
      messages,
      statuses,
    });
  });
  return parsed;
}

// Campos de `account_update` que interessam e NÃO são dado de terceiro. A lista é branca de
// propósito: o value de um webhook carrega telefone e corpo de mensagem, e log de produção é lido
// por muita gente e vai para backup. Só entra aqui o que descreve o estado da CONTA.
const ACCOUNT_FIELDS = ['event', 'ban_info', 'restriction_info', 'violation_info', 'decision',
  'disable_info', 'current_limit', 'requested_verified_name', 'rejection_reason'];

/**
 * Resumo de um change de webhook para ir ao log: tipo do evento, contagens e, quando for evento de
 * conta, o estado dela. NUNCA inclui corpo de mensagem nem telefone de cliente.
 *
 * Existe porque a WABA foi desabilitada em 15/07/2026 e a decisão da apelação chega justamente por
 * `account_update` — que até então entrava, era respondido com 200 e descartado.
 */
function summarizeChangeForLog(change) {
  const value = change?.value || {};
  const field = change?.field ? String(change.field) : null;
  const resumo = {
    field,
    phoneNumberId: pickPhoneNumberId(value) || null,
    messages: Array.isArray(value?.messages) ? value.messages.length : 0,
    statuses: Array.isArray(value?.statuses) ? value.statuses.length : 0,
  };
  for (const key of ACCOUNT_FIELDS) {
    if (value?.[key] !== undefined) resumo[key] = value[key];
  }
  return resumo;
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
  summarizeChangeForLog,
};
