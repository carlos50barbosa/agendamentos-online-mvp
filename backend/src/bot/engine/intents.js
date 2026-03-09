function normalizeIntentText(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TERMS_MENU = new Set(['menu', 'inicio', 'comecar', 'iniciar', '0']);
const TERMS_HUMANO = new Set(['humano', 'atendente', 'pessoa', 'suporte']);
const TERMS_AGENDAR = new Set(['agendar', 'marcar', 'agenda', 'horario', 'horarios']);
const TERMS_REMARCAR = new Set(['remarcar', 'reagendar', 'mudar horario']);
const TERMS_CANCELAR = new Set(['cancelar', 'desmarcar', 'cancelamento']);

function detectIntent(value) {
  const text = normalizeIntentText(value);
  if (!text) return 'UNKNOWN';
  if (TERMS_MENU.has(text)) return 'MENU';
  if (TERMS_HUMANO.has(text)) return 'HUMANO';
  if (TERMS_AGENDAR.has(text)) return 'AGENDAR';
  if (TERMS_REMARCAR.has(text)) return 'REMARCAR';
  if (TERMS_CANCELAR.has(text)) return 'CANCELAR';
  return 'UNKNOWN';
}

export { normalizeIntentText, detectIntent };
