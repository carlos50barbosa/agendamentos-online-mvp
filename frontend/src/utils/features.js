function parseBool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

export function isWhatsAppConnectEnabled() {
  return parseBool(import.meta.env.VITE_WHATSAPP_CONNECT_ENABLED);
}

export function getWhatsAppConnectFeatureState() {
  const enabled = isWhatsAppConnectEnabled();
  return {
    featureEnabled: enabled,
    mode: enabled ? 'enabled' : 'coming_soon',
    message: enabled
      ? 'Integração com WhatsApp Business habilitada.'
      : 'Integração com WhatsApp Business em breve.',
  };
}

export default {
  isWhatsAppConnectEnabled,
  getWhatsAppConnectFeatureState,
};
