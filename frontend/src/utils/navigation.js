import {
  IconUser,
  IconHome,
  IconPlus,
  IconPhone,
  IconChart,
  IconMoney,
  IconStar,
  IconWrench,
  IconGear,
  IconList,
  IconUsers,
  IconLogout,
} from '../components/Icons.jsx';

const toSlug = (value = '') => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'estabelecimento';
};

/**
 * Build navigation structure used across desktop sidebar and mobile bottom bar.
 * @param {object|null} user
 * @returns {{ isAuthenticated: boolean, isEstab: boolean, sections: Array<{ key: string, heading?: string|null, items: Array<object> }> }}
 */
export function buildNavigation(user) {
  const isAuthenticated = Boolean(user);
  const isEstab = Boolean(user && user.tipo === 'estabelecimento');
  const publicPagePath = (() => {
    if (!isEstab) return '/novo';
    const id = user?.id ? String(user.id) : '';
    const slugSource = user?.slug || user?.nome || '';
    const slug = toSlug(slugSource || (id ? `estabelecimento-${id}` : 'estabelecimento'));
    const query = id ? `?estabelecimento=${encodeURIComponent(id)}` : '';
    return `/novo/${slug}${query}`;
  })();

  if (!isAuthenticated) {
    return {
      isAuthenticated: false,
      isEstab: false,
      sections: [
        {
          key: 'guest',
          heading: null,
          items: [
            { key: 'login', label: 'Login', to: '/login', icon: IconUser, type: 'link' },
          ],
        },
      ],
    };
  }

  const mainItems = [
    { key: 'dashboard', label: 'Agendamentos', to: isEstab ? '/estab' : '/cliente', icon: IconHome, type: 'link' },
  ];

  if (isEstab) {
    mainItems.push(
      { key: 'my-page', label: 'Minha pagina', to: publicPagePath, icon: IconList, type: 'link' },
      { key: 'professionals', label: 'Profissionais', to: '/profissionais', icon: IconUser, type: 'link' },
      { key: 'services', label: 'Servicos', to: '/servicos', icon: IconWrench, type: 'link' },
      { key: 'clients', label: 'Clientes', to: '/clientes', icon: IconUsers, type: 'link' },
      { key: 'reports', label: 'Relatorios', to: '/relatorios', icon: IconChart, type: 'link' },
    );
  } else {
    mainItems.push(
      { key: 'new', label: 'Novo Agendamento', to: '/novo', icon: IconPlus, type: 'link' },
    );
  }

  const accountItems = [
    { key: 'settings', label: 'Configuracoes', to: '/configuracoes', icon: IconGear, type: 'link' },
    ...(isEstab
      ? [
          { key: 'subscription', label: 'Assinatura', to: '/assinatura', icon: IconStar, type: 'link' },
          { key: 'whatsapp-business', label: 'WhatsApp Business', to: '/whatsappbusiness', icon: IconPhone, type: 'link' },
          { key: 'deposit-settings', label: 'Sinal e PIX', to: '/sinal', icon: IconMoney, type: 'link' },
        ]
      : []),
    { key: 'logout', label: 'Sair', to: null, icon: IconLogout, type: 'action' },
  ];

  return {
    isAuthenticated: true,
    isEstab,
    sections: [
      { key: 'main', heading: 'Principal', items: mainItems },
      { key: 'account', heading: 'Conta', items: accountItems },
    ],
  };
}

/**
 * Flatten navigation sections into a single ordered list.
 * Useful for compact UIs like a bottom nav.
 */
export function flattenNavigationSections(structure) {
  if (!structure || !Array.isArray(structure.sections)) return [];
  return structure.sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionKey: section.key })));
}
