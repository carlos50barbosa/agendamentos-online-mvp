// Toggle global para notificacoes enviadas ao estabelecimento (email e WhatsApp)
const raw = String(process.env.DISABLE_ESTAB_NOTIFICATIONS ?? 'true').trim().toLowerCase();
const DISABLE_ESTAB_NOTIFICATIONS = ['1', 'true', 'yes', 'on', 'sim'].includes(raw);

export function estabNotificationsDisabled() {
  return DISABLE_ESTAB_NOTIFICATIONS;
}

export function estabNotificationsEnabled() {
  return !DISABLE_ESTAB_NOTIFICATIONS;
}
