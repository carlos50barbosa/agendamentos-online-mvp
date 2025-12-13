// Toggle global para notificacoes ao cliente (WhatsApp)
const rawClient = String(process.env.DISABLE_CLIENT_WHATSAPP_NOTIFICATIONS ?? 'false').trim().toLowerCase();
const DISABLE_CLIENT_WHATSAPP = ['1', 'true', 'yes', 'on', 'sim'].includes(rawClient);

// Desativa apenas notificacoes instantaneas via WhatsApp (confirmacao/cancelamento), preservando lembretes
const rawImmediate = String(
  process.env.DISABLE_WHATSAPP_IMMEDIATE_NOTIFICATIONS ??
  process.env.DISABLE_CLIENT_WHATSAPP_IMMEDIATE ??
  'false'
).trim().toLowerCase();
const DISABLE_WHATSAPP_IMMEDIATE = ['1', 'true', 'yes', 'on', 'sim'].includes(rawImmediate);

export function clientWhatsappDisabled() {
  return DISABLE_CLIENT_WHATSAPP;
}

export function clientWhatsappEnabled() {
  return !DISABLE_CLIENT_WHATSAPP;
}

export function whatsappImmediateDisabled() {
  return DISABLE_WHATSAPP_IMMEDIATE;
}

export function whatsappImmediateEnabled() {
  return !DISABLE_WHATSAPP_IMMEDIATE;
}
