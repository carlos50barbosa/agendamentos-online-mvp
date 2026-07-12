// src/utils/publicTheme.js
// Tema da página pública de agendamento (/agendar). Deriva as CSS vars de marca
// (--brand e família) a partir da cor de "Identidade visual" que o estabelecimento
// define nas Configurações (perfil.accent_color). Aplicado no wrapper do BookingPublic,
// cascateia para BookingWizard e EstablishmentHeader.
//
// Mantém paridade com o fluxo legado (NovoAgendamento.jsx), acrescentando --brand-deep
// e --brand-border que o wizard novo consome.

export const PUBLIC_PAGE_THEME_DEFAULTS = Object.freeze({
  accent: '#5b7385',
  accentStrong: '#243746',
});

export function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefixed = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(prefixed)) return '';
  if (prefixed.length === 4) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  return prefixed.toLowerCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function toRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

export function mixColors(hexA, hexB, weight = 0.5) {
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  if (!colorA || !colorB) return normalizeHexColor(hexA) || normalizeHexColor(hexB) || '';

  const safeWeight = Math.max(0, Math.min(1, weight));
  const mixChannel = (channel) => Math.round((colorA[channel] * safeWeight) + (colorB[channel] * (1 - safeWeight)));
  const mixed = [mixChannel('r'), mixChannel('g'), mixChannel('b')]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return `#${mixed}`;
}

// Resolve a cor da marca a partir do perfil público (+ overrides ?accent=/?cor= na URL).
// Retorna '' quando não há cor customizada — nesse caso o chamador não deve aplicar tema
// (mantém o índigo global padrão).
export function resolvePublicAccent(profile, searchParams) {
  const q = (key) => (searchParams && typeof searchParams.get === 'function' ? searchParams.get(key) : null);
  const accent =
    q('accent') || q('cor') ||
    profile?.accent_color || profile?.brand_color || profile?.cor_primaria || '';
  const accentStrong =
    q('accentStrong') || q('corStrong') ||
    profile?.accent_strong_color || profile?.secondary_color || profile?.cor_secundaria || '';
  return { accent, accentStrong };
}

// Constrói o mapa de CSS vars a partir da cor de destaque. Sem accent válido → índigo default.
export function buildPublicThemeStyle({ accent, accentStrong } = {}) {
  const resolvedAccent = normalizeHexColor(accent) || PUBLIC_PAGE_THEME_DEFAULTS.accent;
  const resolvedStrong =
    normalizeHexColor(accentStrong) ||
    mixColors(resolvedAccent, PUBLIC_PAGE_THEME_DEFAULTS.accentStrong, 0.46);

  const accentSoft = toRgba(resolvedAccent, 0.1);
  const accentSoftStrong = toRgba(resolvedAccent, 0.18);
  const accentBorder = toRgba(resolvedAccent, 0.22);
  const accentRing = toRgba(resolvedAccent, 0.18);
  const accentShadow = toRgba(resolvedStrong, 0.18);

  return {
    '--brand': resolvedAccent,
    // Cor de destaque escurecida p/ manter legibilidade — títulos e o fim do degradê do topo.
    '--brand-deep': mixColors(resolvedStrong, '#0b1020', 0.55),
    '--brand-100': mixColors(resolvedAccent, '#ffffff', 0.12),
    '--brand-200': mixColors(resolvedAccent, '#ffffff', 0.24),
    '--brand-border': mixColors(resolvedAccent, '#ffffff', 0.14),
    '--primary-50': accentSoft,
    '--primary-100': toRgba(resolvedAccent, 0.14),
    '--primary-200': accentBorder,
    '--primary-500': resolvedAccent,
    '--primary-600': resolvedStrong,
    '--primary-700': mixColors(resolvedStrong, '#0f172a', 0.72),
    '--booking-accent': resolvedAccent,
    '--booking-accent-strong': resolvedStrong,
    '--booking-accent-soft': accentSoft,
    '--booking-accent-soft-strong': accentSoftStrong,
    '--booking-accent-border': accentBorder,
    '--booking-accent-ring': accentRing,
    '--booking-accent-shadow': accentShadow,
  };
}
