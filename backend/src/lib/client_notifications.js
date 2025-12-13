// Toggle global para notificacoes ao cliente (WhatsApp)
const rawClient = String(process.env.DISABLE_CLIENT_WHATSAPP_NOTIFICATIONS ?? 'false').trim().toLowerCase();
const DISABLE_CLIENT_WHATSAPP = ['1', 'true', 'yes', 'on', 'sim'].includes(rawClient);

export function clientWhatsappDisabled() {
  return DISABLE_CLIENT_WHATSAPP;
}

export function clientWhatsappEnabled() {
  return !DISABLE_CLIENT_WHATSAPP;
}
