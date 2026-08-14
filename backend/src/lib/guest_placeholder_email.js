// backend/src/lib/guest_placeholder_email.js
//
// O e-mail falso de quem agendou só com nome e telefone.
//
// Por que existe: `usuarios.email` é NOT NULL UNIQUE, e o agendamento público aceita cadastro sem
// e-mail. Alguma string precisa ocupar a coluna, e ela precisa ser única por pessoa — daí o
// telefone virar a chave (`guest-<telefone>@...`), o que de quebra faz o mesmo número reencontrar
// o mesmo cadastro em vez de criar um duplicado a cada agendamento.
//
// Por que o domínio termina em `.local`: é TLD reservada (RFC 6762, a do mDNS/Bonjour) e nunca é
// delegada na raiz do DNS — ninguém pode registrá-la. Um domínio inventado qualquer
// (`@sem-email.com`) seria comprável por um terceiro amanhã, e aí endereços derivados do telefone
// dos clientes passariam a existir de verdade, na caixa de outra pessoa. Aqui isso é impossível
// por construção, não por sorte.
//
// Este arquivo é um lib, e não um `const` dentro da rota que gera o placeholder, porque quem mais
// precisa da pergunta "esse endereço é real?" é quem ENVIA — e quem envia mora em outros seis
// arquivos.

export const GUEST_PLACEHOLDER_EMAIL_DOMAIN = 'sem-email.agendou.local';

export const isPlaceholderGuestEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${GUEST_PLACEHOLDER_EMAIL_DOMAIN}`);

export const buildPlaceholderGuestEmail = (phoneKey) =>
  `guest-${phoneKey}@${GUEST_PLACEHOLDER_EMAIL_DOMAIN}`;
