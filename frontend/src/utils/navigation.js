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

  // `mobilePrimary` marca o que fica FIXO na barra inferior do celular. Os
  // demais vão para o menu "Mais". São no máximo 4 + o botão "Mais": acima
  // disso o rótulo não cabe em 375px, e ícone sem rótulo o dono não decifra.
  //
  // O critério é frequência de uso diário de quem toca o salão, não a ordem do
  // menu lateral: agenda o dia inteiro, clientes e serviços com frequência,
  // dinheiro toda semana. O resto é configuração, que se visita raramente.
  const mainItems = [
    { key: 'dashboard', label: 'Agendamentos', to: isEstab ? '/estab' : '/cliente', icon: IconHome, type: 'link', mobilePrimary: true },
  ]

  if (isEstab) {
    mainItems.push(
      { key: 'my-page', label: 'Minha página', to: publicPagePath, icon: IconList, type: 'link' },
      { key: 'professionals', label: 'Profissionais', to: '/profissionais', icon: IconUser, type: 'link' },
      { key: 'services', label: 'Serviços', to: '/servicos', icon: IconWrench, type: 'link', mobilePrimary: true },
      { key: 'clients', label: 'Clientes', to: '/clientes', icon: IconUsers, type: 'link', mobilePrimary: true },
      { key: 'reports', label: 'Relatórios', to: '/relatorios', icon: IconChart, type: 'link' },
      { key: 'loyalty', label: 'Planos', to: '/fidelidade', icon: IconStar, type: 'link' },
      { key: 'finance', label: 'Financeiro', to: '/financeiro', icon: IconMoney, type: 'link', mobilePrimary: true },
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

// Quantos itens cabem na barra inferior com rótulo legível em 375px, já
// contando o botão "Mais" como um deles.
export const MOBILE_NAV_SLOTS = 5

/**
 * Divide a navegação entre a barra inferior e o menu "Mais".
 *
 * Existe porque a barra recebia os 14 itens do menu inteiro: ~850px de conteúdo
 * dentro de 375px de tela, rolando na horizontal com a scrollbar escondida e
 * sem rótulo. O dono via 6 ícones mudos e nenhuma pista de que havia mais 8.
 *
 * Quando tudo cabe (o caso do cliente, que tem 3 itens), não há "Mais" — um
 * menu com um item só é pior que nenhum menu.
 */
export function splitMobileNavigation(structure) {
  const items = flattenNavigationSections(structure)
  if (items.length <= MOBILE_NAV_SLOTS) return { primary: items, overflow: [] }

  const marked = items.filter((i) => i.mobilePrimary)
  // Completa com a ordem natural do menu se faltar marcação, para nunca sobrar
  // espaço vazio — e corta em SLOTS-1 porque o "Mais" ocupa uma vaga.
  const primary = [...marked]
  for (const item of items) {
    if (primary.length >= MOBILE_NAV_SLOTS - 1) break
    if (!primary.includes(item)) primary.push(item)
  }
  const capped = primary.slice(0, MOBILE_NAV_SLOTS - 1)
  const overflow = items.filter((i) => !capped.includes(i))
  return { primary: capped, overflow }
}
