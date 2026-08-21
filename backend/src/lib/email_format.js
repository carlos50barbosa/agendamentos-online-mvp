// backend/src/lib/email_format.js
//
// A única checagem de formato de e-mail das rotas de agendamento.
//
// Nasceu quando o e-mail virou OPCIONAL também no painel do estabelecimento (POST
// /agendamentos/estabelecimento), que é a rota irmã do agendamento público. As duas passaram a
// precisar da mesma pergunta — "veio vazio, ou veio torto?" — e a regra estava escrita como um
// `const` solto dentro de agendamentos_public.js.
//
// Duplicar validador já custou caro aqui uma vez: a normalização de telefone morava copiada em
// dois arquivos e as cópias divergiram, deixando a base com 11 e 13 dígitos para o mesmo dado
// (ver lib/phone_br.js). Um regex é menor que aquilo, mas o modo de falhar é o mesmo — alguém
// aperta a regra de um lado e o outro segue aceitando.
//
// O que ela NÃO é: verificação de existência. Um endereço com um dedo errado passa inteiro por
// aqui. Quem depende de o e-mail chegar não pode tratar "passou" como "é dele" — foi o que
// transformou a mensagem de sucesso da rota pública numa garantia falsa em 19/08/2026.
export const isValidEmailFormat = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
