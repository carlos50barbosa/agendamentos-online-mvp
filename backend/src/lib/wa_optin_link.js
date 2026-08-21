// O CONVITE: o link que faz a cliente mandar "AUTORIZO" PARA O NÚMERO DO SALÃO.
//
// Por que ele precisa existir separado do link da plataforma (`lib/wa_link_requests.js`, que usa
// `WA_PUBLIC_NUMBER`): consentimento é sobre QUEM manda. Quando o salão passa a falar pelo número
// dele, o aceite que vale é o dado ÀQUELE número — o da plataforma não serve, por desenho
// (`decideConsent`, em lib/whatsapp_consent.js). Apontar o convite para o número errado colhe
// aceite que não destrava nada.
//
// Módulo puro de propósito: a mesma regra é usada na tela do estabelecimento (para ele divulgar) e
// no fluxo público (para a cliente ativar na hora), e as duas têm de gerar o MESMO link.
export const OPTIN_KEYWORD = 'AUTORIZO';

/**
 * @param {string|null} displayPhoneNumber Ex.: "+55 11 91515-5349"
 * @returns {string|null} `https://wa.me/<digitos>?text=AUTORIZO`, ou null se não der para montar.
 */
export function buildTenantOptInLink(displayPhoneNumber) {
  const digits = String(displayPhoneNumber || '').replace(/\D/g, '');
  // Sem número não existe meio-link: `wa.me/?text=AUTORIZO` ABRE o WhatsApp, sem destinatário. A
  // pessoa acha que autorizou, a mensagem não vai para lugar nenhum e ninguém fica sabendo — o
  // mesmo silêncio que este trabalho todo está tentando eliminar. Melhor não oferecer o botão.
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(OPTIN_KEYWORD)}`;
}

export default { buildTenantOptInLink, OPTIN_KEYWORD };
