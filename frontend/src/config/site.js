// src/config/site.js
// -----------------------------------------------------------------------------
// Strings e config do produto (não visuais). Cores ficam em theme.js.
// -----------------------------------------------------------------------------

export const site = {
  name: 'Agendamentos Online',
  shortName: 'Agendamentos',
  tagline: 'Sua agenda, do jeito simples.',
  description: 'Agende horários e confirme com sinal via PIX — rápido e sem complicação.',
  lang: 'pt-BR',
  locale: 'pt-BR',
  timeZone: 'America/Sao_Paulo',

  // Identidade de quem desenvolveu (agência), distinta da marca do produto.
  developedBy: {
    label: 'ServiçosTech',
    url: 'https://servicostech.com.br',
    color: '#1E88E5', // azul da agência — NÃO usar na UI do app.
  },

  // Períodos do dia usados para agrupar horários/agenda.
  dayPeriods: [
    { key: 'manha', label: 'Manhã', icon: 'sunrise', startHour: 0, endHour: 12 },
    { key: 'tarde', label: 'Tarde', icon: 'sun', startHour: 12, endHour: 18 },
    { key: 'noite', label: 'Noite', icon: 'moon', startHour: 18, endHour: 24 },
  ],

  // Navegação inferior (mobile) do painel do negócio.
  bottomNav: {
    items: [
      { key: 'agenda', label: 'Agenda', icon: 'calendar', to: '/estab' },
      { key: 'clientes', label: 'Clientes', icon: 'users', to: '/clientes' },
      { key: 'financeiro', label: 'Financeiro', icon: 'wallet', to: '/relatorios' },
      { key: 'config', label: 'Config', icon: 'settings', to: '/configuracoes' },
    ],
    primary: { key: 'novo', label: 'Novo agendamento', icon: 'plus', to: '/novo' },
  },

  // Passos do fluxo público de marcação (BookingWizard).
  bookingSteps: [
    { key: 'servico', label: 'Serviço' },
    { key: 'profissional', label: 'Profissional' },
    { key: 'dia', label: 'Dia' },
    { key: 'horario', label: 'Horário' },
    { key: 'confirmacao', label: 'Confirmação' },
    { key: 'pagamento', label: 'Pagamento' },
  ],

  whatsapp: {
    // Mensagem pré-preenchida ao tocar no atalho de WhatsApp de um agendamento.
    defaultMessage: 'Olá! Sobre o seu agendamento em {estabelecimento}...',
  },
};

/** Retorna a mensagem de WhatsApp com placeholders substituídos. */
export function waMessage(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : '',
  );
}

/**
 * Monta um link wa.me. `phone` é normalizado para dígitos (com DDI 55 default
 * quando faltar), `message` é opcional e já pré-preenchido.
 */
export function waLink(phone, message = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  const withDdi = digits.length && digits.length <= 11 ? `55${digits}` : digits;
  const base = `https://wa.me/${withDdi}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export default site;
