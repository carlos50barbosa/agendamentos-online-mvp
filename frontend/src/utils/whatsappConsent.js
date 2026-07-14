// frontend/src/utils/whatsappConsent.js
// ESPELHO de backend/src/lib/whatsapp_consent_text.js. Mantenha os dois idênticos.
//
// O backend renderiza e GUARDA o texto do aceite (para o cliente HTTP não poder forjar a prova);
// esta cópia é o que a pessoa efetivamente LÊ na tela. Se as duas divergirem, o registro no banco
// deixa de refletir o que foi mostrado — e uma prova que não bate com a realidade é pior do que
// nenhuma.
//
// backend/tests/whatsapp-consent.test.js compara os dois caractere a caractere e quebra o CI se
// alguém mexer só de um lado.

export const CONSENT_VERSION = 'v1';

/** ⚠️ Idêntico ao "display name" verificado da conta na Meta — é o nome que aparece na conversa. */
export const WA_SENDER_NAME = 'Agendamentos Online';

export function buildConsentText({ establishmentName } = {}) {
  const estab = String(establishmentName || '').trim();
  const emNomeDe = estab ? ` em nome de ${estab}` : '';
  return (
    `Quero receber no WhatsApp a confirmação e os lembretes dos meus agendamentos, ` +
    `enviados por ${WA_SENDER_NAME}${emNomeDe}. ` +
    `Não recebo promoções, e posso sair quando quiser respondendo PARAR.`
  );
}
