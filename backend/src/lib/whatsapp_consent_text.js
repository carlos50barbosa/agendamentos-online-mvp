// backend/src/lib/whatsapp_consent_text.js
// O TEXTO do consentimento. Módulo puro, sem imports, de propósito: ele é espelhado no frontend
// (frontend/src/utils/whatsappConsent.js) e um teste compara os dois caractere a caractere.
//
// Por que o espelho existe e por que é testado: o que vale como prova é o que a PESSOA LEU. A tela
// mostra um texto; o banco guarda outro texto (renderizado aqui, no servidor, para o cliente HTTP
// não poder forjar). Se os dois divergirem, o registro deixa de ser prova e vira ficção — a gente
// juraria à Meta que mostrou uma frase que ninguém viu. O teste é o que impede essa divergência
// de acontecer sem alguém perceber.
//
// Nada aqui é configurável por env. Um WA_SENDER_DISPLAY_NAME que a produção mudasse sem o
// frontend saber recriaria exatamente a divergência que este arquivo existe para evitar.

/** Muda junto com o texto. Nunca reescreva uma versão já publicada — crie a v2. */
export const CONSENT_VERSION = 'v1';

/**
 * O nome que o cliente vê no WhatsApp ao receber a mensagem.
 *
 * ⚠️ TEM DE SER IDÊNTICO ao "display name" verificado da conta na Meta. Se a pessoa autoriza
 * "Agenda0" e chega mensagem de outro nome, o consentimento não cobre aquele remetente — e, na
 * prática, é justamente aí que ela não reconhece quem escreveu e denuncia como spam.
 */
export const WA_SENDER_NAME = 'Agendamentos Online';

/**
 * A frase que a pessoa lê e aceita. Num fôlego ela precisa dizer:
 *   - o canal ...... WhatsApp
 *   - quem envia ... o nome que ela verá na conversa
 *   - a serviço de quem ... o salão
 *   - o que chega .. transacional (confirmação e lembrete). Dizer "não recebo promoções" é uma
 *                    promessa que o backend cumpre: não existe envio de marketing pela API.
 *   - como sair .... responder PARAR
 */
export function buildConsentText({ establishmentName } = {}) {
  const estab = String(establishmentName || '').trim();
  const emNomeDe = estab ? ` em nome de ${estab}` : '';
  return (
    `Quero receber no WhatsApp a confirmação e os lembretes dos meus agendamentos, ` +
    `enviados por ${WA_SENDER_NAME}${emNomeDe}. ` +
    `Não recebo promoções, e posso sair quando quiser respondendo PARAR.`
  );
}
