// src/config/theme.js
// -----------------------------------------------------------------------------
// FONTE ÚNICA DE VERDADE do design system (Fase 1 do redesign).
// Nenhum componente deve ter cores hardcoded: importe daqui ou use as classes
// Tailwind mapeadas (tw-*-brand, tw-*-status-*), que resolvem para as CSS vars
// aplicadas por applyTheme().
//
// Identidade: índigo da logo do produto (badge calendário + check), distinto do
// azul da agência ServiçosTech (ver site.js -> developedBy).
// -----------------------------------------------------------------------------

/** Paleta bruta da marca (índigo). */
export const colors = {
  brand: '#5049E5', // primária (índigo)
  brandLight: '#7669ED', // hover / realce
  brandDeep: '#1E1B4B', // texto / headers
  brand100: '#EEEDFC', // tint claro
  brand200: '#D7D4F7', // tint médio
  bgLavender: '#F6F5FB', // fundo claro
  white: '#FFFFFF', // cards
  whatsapp: '#25D366', // CTA de contato
  // Neutros de apoio (texto/bordas) — usados por componentes novos.
  ink: '#1E1B4B',
  muted: '#6B7280',
  border: '#E7E5F5',
  surfaceSoft: '#FBFBFE',
};

/**
 * Mapa central de status do agendamento (cor + label + ícone).
 * StatusPill é a ÚNICA fonte de renderização — consome este mapa.
 * `icon` é o nome lucide-react resolvido dentro do StatusPill (mantém este
 * arquivo agnóstico de framework de UI).
 */
export const statusMap = {
  aguardando_sinal: {
    label: 'Aguardando sinal',
    icon: 'clock',
    bg: '#FBEEDA',
    fg: '#854F0B',
    ring: '#F3D9AE',
  },
  confirmado: {
    label: 'Confirmado',
    icon: 'check-circle',
    bg: '#E1F3E8',
    fg: '#128C4A',
    ring: '#BFE6CD',
  },
  concluido: {
    label: 'Concluído',
    icon: 'check-check',
    bg: '#E7EDF5',
    fg: '#334155',
    ring: '#CBD8E8',
  },
  cancelado: {
    label: 'Cancelado',
    icon: 'x-circle',
    bg: '#FBE6E6',
    fg: '#B4232A',
    ring: '#F3C9C9',
  },
  nao_compareceu: {
    label: 'Não compareceu',
    icon: 'user-x',
    bg: '#E5E7EB',
    fg: '#374151',
    ring: '#D1D5DB',
  },
  pendente: {
    label: 'Pendente',
    icon: 'clock',
    bg: '#EAF0FA',
    fg: '#2A5580',
    ring: '#CBDCF0',
  },
};

/** Status canônico usado como fallback quando o raw não é reconhecido. */
export const STATUS_FALLBACK = 'pendente';

const PENDING_DEPOSIT_RAW = new Set([
  'pendente_pagamento',
  'aguardando_pagamento',
  'aguardando pagamento',
  'aguardando_sinal',
  'aguardando sinal',
  'pending_payment',
  'awaiting_payment',
  'pending_deposit',
]);

const NO_SHOW_RAW = new Set([
  'nao_compareceu',
  'não compareceu',
  'nao compareceu',
  'no_show',
  'noshow',
  'faltou',
]);

/**
 * Normaliza um status cru (do backend ou legado) para uma chave canônica de
 * `statusMap`. `isPast` coage confirmados/pendentes passados para "concluído".
 */
export function normalizeStatus(rawStatus, { isPast = false } = {}) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) return isPast ? 'concluido' : 'pendente';
  if (NO_SHOW_RAW.has(status)) return 'nao_compareceu';
  if (PENDING_DEPOSIT_RAW.has(status)) return 'aguardando_sinal';
  if (status.includes('cancel')) return 'cancelado';
  if (status.includes('conclu') || status.includes('finaliz')) return 'concluido';
  if (status.includes('confirm')) return isPast ? 'concluido' : 'confirmado';
  if (status.includes('sinal') || status.includes('deposit')) return 'aguardando_sinal';
  if (status.includes('pend') || status.includes('aguard')) return 'pendente';
  if (statusMap[status]) return status;
  return 'pendente';
}

/** Retorna o meta (cor/label/ícone) de um status, já normalizado. */
export function getStatusMeta(rawStatus, options) {
  return statusMap[normalizeStatus(rawStatus, options)] || statusMap[STATUS_FALLBACK];
}

/** Raios generosos (cards rounded-2xl, botões/chips rounded-xl). */
export const radii = {
  card: '1rem', // rounded-2xl
  control: '0.75rem', // rounded-xl (botões/chips)
  pill: '9999px',
};

/** Alvos de toque (mobile-first, mínimo 44px). */
export const touch = {
  min: 44,
};

/** Tamanhos de ícone lucide-react. */
export const iconSizes = {
  nav: 24, // navegação
  inline: 20, // inline em textos/cards
};

/** Sombras suaves (sem gradientes pesados). */
export const shadows = {
  soft: '0 10px 30px -12px rgba(30, 27, 75, 0.18)',
  card: '0 4px 16px -8px rgba(30, 27, 75, 0.16)',
};

/**
 * Mapa varName -> valor. Aplicado no :root por applyTheme().
 * Reskina a UI legada (que usa var(--primary/--brand)) para o índigo sem tocar
 * nos ~776 hex hardcoded do CSS. NÃO sobrescreve --bg/--surface/--text para
 * preservar o tema escuro existente.
 */
export const cssVariables = {
  '--brand': colors.brand,
  '--brand-light': colors.brandLight,
  '--brand-deep': colors.brandDeep,
  '--brand-100': colors.brand100,
  '--brand-200': colors.brand200,
  // Espelha os tokens de "primary" que a UI legada consome.
  '--primary': colors.brand,
  '--primary-400': colors.brandLight,
  '--primary-500': colors.brand,
  '--primary-600': colors.brandDeep,
  '--primary-200': colors.brand200,
  // Novos tokens (usados só pelos componentes novos).
  '--bg-lav': colors.bgLavender,
  '--wa-green': colors.whatsapp,
  '--ink': colors.ink,
  '--muted-ink': colors.muted,
  '--brand-border': colors.border,
  '--surface-soft': colors.surfaceSoft,
  // Status (consumidos por classes Tailwind tw-*-status-* e por StatusPill).
  '--status-aguardando_sinal-bg': statusMap.aguardando_sinal.bg,
  '--status-aguardando_sinal-fg': statusMap.aguardando_sinal.fg,
  '--status-confirmado-bg': statusMap.confirmado.bg,
  '--status-confirmado-fg': statusMap.confirmado.fg,
  '--status-concluido-bg': statusMap.concluido.bg,
  '--status-concluido-fg': statusMap.concluido.fg,
  '--status-cancelado-bg': statusMap.cancelado.bg,
  '--status-cancelado-fg': statusMap.cancelado.fg,
  '--status-nao_compareceu-bg': statusMap.nao_compareceu.bg,
  '--status-nao_compareceu-fg': statusMap.nao_compareceu.fg,
};

/** Aplica as CSS vars da marca no :root. Idempotente. */
export function applyTheme(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.documentElement) return;
  const root = doc.documentElement.style;
  for (const [name, value] of Object.entries(cssVariables)) {
    root.setProperty(name, value);
  }
}

export default {
  colors,
  statusMap,
  normalizeStatus,
  getStatusMeta,
  radii,
  touch,
  iconSizes,
  shadows,
  cssVariables,
  applyTheme,
};
