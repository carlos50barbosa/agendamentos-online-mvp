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
  IconQrCode,
} from '../components/Icons.jsx'

export function buildNavigation(user) {
  const isAuthenticated = Boolean(user)
  const isEstab = Boolean(user && user.tipo === 'estabelecimento')
  const publicPagePath = (() => {
    if (!isEstab) return '/novo'
    const id = user?.id ? String(user.id) : ''
    // Link curto na raiz quando o estabelecimento já tem slug; sem slug, formato antigo por id.
    const slug = String(user?.slug || '').trim()
    if (slug) return `/${slug}`
    return id ? `/agendar/${id}` : '/novo'
  })()

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
    }
  }

  const mainItems = [
    { key: 'dashboard', label: 'Agendamentos', to: isEstab ? '/estab' : '/cliente', icon: IconHome, type: 'link' },
  ]

  if (isEstab) {
    mainItems.push(
      { key: 'my-page', label: 'Minha página', to: publicPagePath, icon: IconList, type: 'link' },
      { key: 'professionals', label: 'Profissionais', to: '/profissionais', icon: IconUser, type: 'link' },
      { key: 'services', label: 'Serviços', to: '/servicos', icon: IconWrench, type: 'link' },
      { key: 'clients', label: 'Clientes', to: '/clientes', icon: IconUsers, type: 'link' },
      { key: 'reports', label: 'Relatórios', to: '/relatorios', icon: IconChart, type: 'link' },
      { key: 'loyalty', label: 'Planos', to: '/fidelidade', icon: IconStar, type: 'link' },
      { key: 'finance', label: 'Financeiro', to: '/financeiro', icon: IconMoney, type: 'link' },
      { key: 'promotion', label: 'Meu QR Code', to: '/divulgacao', icon: IconQrCode, type: 'link' },
    )
  } else {
    mainItems.push(
      { key: 'new', label: 'Novo Agendamento', to: '/novo', icon: IconPlus, type: 'link' },
    )
  }

  const accountItems = [
    { key: 'settings', label: 'Configurações', to: '/configuracoes', icon: IconGear, type: 'link' },
    ...(isEstab
      ? [
          { key: 'subscription', label: 'Assinatura', to: '/assinatura', icon: IconStar, type: 'link' },
          { key: 'whatsapp-business', label: 'WhatsApp Business', to: '/whatsappbusiness', icon: IconPhone, type: 'link' },
          { key: 'deposit-settings', label: 'Sinal e PIX', to: '/sinal', icon: IconMoney, type: 'link' },
        ]
      : []),
    { key: 'logout', label: 'Sair', to: null, icon: IconLogout, type: 'action' },
  ]

  return {
    isAuthenticated: true,
    isEstab,
    sections: [
      { key: 'main', heading: 'Principal', items: mainItems },
      { key: 'account', heading: 'Conta', items: accountItems },
    ],
  }
}

export function flattenNavigationSections(structure) {
  if (!structure || !Array.isArray(structure.sections)) return []
  return structure.sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionKey: section.key })))
}
