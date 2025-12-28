import {
  IconUser,
  IconHome,
  IconPlus,
  IconChart,
  IconWrench,
  IconGear,
  IconList,
  IconUsers,
  IconLogout,
} from '../components/Icons.jsx';

/**
 * Build navigation structure used across desktop sidebar and mobile bottom bar.
 * @param {object|null} user
 * @returns {{ isAuthenticated: boolean, isEstab: boolean, sections: Array<{ key: string, heading?: string|null, items: Array<object> }> }}
 */
export function buildNavigation(user) {
  const isAuthenticated = Boolean(user);
  const isEstab = Boolean(user && user.tipo === 'estabelecimento');

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
            { key: 'signup', label: 'Cadastro', to: '/cadastro', icon: IconPlus, type: 'link' },
          ],
        },
      ],
    };
  }

  const mainItems = [
    { key: 'dashboard', label: 'Agendamentos', to: isEstab ? '/estab' : '/cliente', icon: IconHome, type: 'link' },
    { key: 'new', label: 'Novo Agendamento', to: '/novo', icon: IconPlus, type: 'link' },
  ];

  if (isEstab) {
    mainItems.push(
      { key: 'services', label: 'Serviços', to: '/servicos', icon: IconWrench, type: 'link' },
      { key: 'clients', label: 'Clientes', to: '/clientes', icon: IconUsers, type: 'link' },
      { key: 'professionals', label: 'Profissionais', to: '/profissionais', icon: IconUser, type: 'link' },
      { key: 'reports', label: 'Relatórios', to: '/relatorios', icon: IconChart, type: 'link' },
    );
  }

  const accountItems = [
    { key: 'settings', label: 'Configurações', to: '/configuracoes', icon: IconGear, type: 'link' },
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
