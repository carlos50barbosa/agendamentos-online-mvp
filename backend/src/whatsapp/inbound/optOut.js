// backend/src/whatsapp/inbound/optOut.js
// "PARAR" — a saída pelo próprio WhatsApp.
//
// A Meta exige que sair seja tão fácil quanto entrar, e trata o pedido de saída ignorado como
// violação. Além disso é o caminho que a pessoa irritada usa ANTES de clicar em "denunciar spam":
// atender o PARAR na hora é o que separa um descadastro de uma denúncia — e denúncia é o que
// derruba a conta.
//
// Roda no topo do webhook, antes do bot e antes do auto-reply institucional: quem pediu para sair
// não pode receber menu, saudação nem "não entendi".
import { sendWhatsAppSmart } from '../../lib/notifications.js';
import { normalizeInboundMessage } from './normalize.js';
import { revokeWhatsAppConsent, OPTIN_SOURCES } from '../../lib/whatsapp_consent.js';

const OPT_OUT_CONFIRMATION =
  'Pronto: você não vai mais receber mensagens nossas no WhatsApp. ' +
  'Seus agendamentos continuam valendo, e os avisos passam a chegar por e-mail. ' +
  'Se mudar de ideia, é só reativar na hora de agendar.';

/**
 * Só o pedido INTEIRO conta — a comparação é com a mensagem completa, não "contém a palavra".
 * "Não consigo parar de indicar vocês" não é um opt-out, e tratar como tal descadastraria um
 * cliente satisfeito em silêncio.
 *
 * "cancelar" de propósito NÃO está aqui: no bot ela significa cancelar o AGENDAMENTO. Confundir as
 * duas coisas faria quem quer desmarcar um horário perder também as notificações.
 */
const STOP_WORDS = new Set([
  'parar',
  'pare',
  'sair',
  'stop',
  'remover',
  'descadastrar',
  'unsubscribe',
  'nao quero receber',
  'nao quero mais receber',
  'cancelar inscricao',
]);

/** Minúsculas, sem acento e sem pontuação — "PARAR!" e "Parar." são o mesmo pedido. */
function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOptOutText(text) {
  return STOP_WORDS.has(normalizeForMatch(text));
}

/**
 * Trata a mensagem se ela for um pedido de saída.
 * @returns {Promise<{handled: boolean}>} handled=true quando o webhook não deve seguir adiante.
 */
export async function handleInboundOptOut({ phoneNumberId, value, message } = {}) {
  const normalized = normalizeInboundMessage({ tenantId: 0, phoneNumberId, message, value });
  if (!normalized.fromPhone || !isOptOutText(normalized.text)) {
    return { handled: false };
  }

  try {
    await revokeWhatsAppConsent({
      phone: normalized.fromPhone,
      origem: OPTIN_SOURCES.WHATSAPP_STOP,
    });
  } catch (err) {
    // Se a revogação falhar, NÃO confirmamos — dizer "pronto, você saiu" sem ter saído é pior do
    // que não responder. O erro sobe para o log e a mensagem segue o fluxo normal.
    console.error('[wa/optout] falha ao revogar consentimento', err?.message || err);
    return { handled: false };
  }

  try {
    // Resposta dentro da janela de 24h (a pessoa acabou de escrever): é mensagem de sessão, não
    // precisa de template nem de opt-in — e negar a confirmação a quem pediu para sair seria
    // exatamente o tipo de coisa que a Meta pune.
    await sendWhatsAppSmart({
      to: normalized.fromPhone,
      message: OPT_OUT_CONFIRMATION,
      context: { kind: 'optout_confirm', phoneNumberId },
    });
  } catch (err) {
    // A saída já está registrada; falhar em confirmar não a desfaz.
    console.warn('[wa/optout] falha ao confirmar saída', err?.message || err);
  }

  return { handled: true };
}
