import { TEMPLATE_KEYS, getTemplate } from '../templates/templateRegistry.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function isWindowOpen(lastInteractionAt, now = new Date()) {
  const last = parseDate(lastInteractionAt);
  if (!last) return false;
  const nowDate = parseDate(now) || new Date();
  return (nowDate.getTime() - last.getTime()) <= WINDOW_MS;
}

function resolveTemplateFallbackConfig(messageText = '') {
  const template = getTemplate(TEMPLATE_KEYS.MENU_RETOMADA, messageText ? [messageText] : []);
  if (!template) {
    return {
      ok: false,
      reason: 'template_missing',
      template: null,
    };
  }
  return {
    ok: true,
    reason: null,
    template: {
      name: template.templateName,
      lang: template.language,
      components: template.components,
    },
  };
}

function resolveReplyMode({ lastInteractionAt, now = new Date() }) {
  if (isWindowOpen(lastInteractionAt, now)) return 'text';
  return 'template';
}

export { isWindowOpen, resolveReplyMode, resolveTemplateFallbackConfig };
