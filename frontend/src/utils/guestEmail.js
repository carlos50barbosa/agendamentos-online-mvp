// frontend/src/utils/guestEmail.js
//
// Espelho de leitura do placeholder de convidado do backend (lib/guest_placeholder_email.js).
//
// Quem agenda sem informar e-mail recebe `guest-<telefone>@sem-email.agendou.local` na coluna
// `usuarios.email`, que é NOT NULL UNIQUE. É a AUSÊNCIA de um endereço escrita de um jeito que
// não colide com a de outra pessoa — nunca um e-mail de verdade, e o domínio é TLD reservada
// (.local, RFC 6762) justamente para que ninguém possa registrá-lo e passar a receber.
//
// O front não gera esse endereço: quem grava é o backend. Aqui só existe a pergunta inversa —
// "isto que veio da API é um e-mail para mostrar ao dono, ou é o marcador de que não há e-mail?".
// Sem essa pergunta, o placeholder aparece no lugar do endereço do cliente e se apresenta como
// se fosse dele.
export const GUEST_PLACEHOLDER_EMAIL_DOMAIN = 'sem-email.agendou.local'

export const isPlaceholderGuestEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${GUEST_PLACEHOLDER_EMAIL_DOMAIN}`)
