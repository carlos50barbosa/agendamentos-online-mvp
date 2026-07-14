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
 * Resposta a quem diz "vocês erraram a pessoa". É outra coisa e pede outro tom: quem não te conhece
 * não quer instrução de descadastro — quer um pedido de desculpas e sumir.
 */
const WRONG_PERSON_REPLY =
  'Desculpe pelo incômodo! Alguém cadastrou este número por engano. ' +
  'Já removemos: você não vai receber mais nada da gente.';

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

/**
 * "Vocês erraram a pessoa" — o sinal mais perigoso que existe, e o mais fácil de ignorar.
 *
 * Caso real (14/07/2026): alguém criou um estabelecimento falso com o telefone de uma pessoa
 * aleatória e marcou a caixa de opt-in por ela. Ela recebeu um lembrete de agendamento e respondeu
 * "veio errado não tenho agenda com voces". O bot não reconheceu, caiu no `generic_fallback` e
 * respondeu com MAIS uma mensagem. Para ela, virou insistência — e o passo seguinte de quem é
 * importunado por um número que não conhece é DENUNCIAR. Denúncia é o que derruba a WABA.
 *
 * Aqui a comparação é por FRASE (contém), não por igualdade, porque ninguém escreve "parar" nessa
 * situação — escreve uma frase inteira, irritada.
 *
 * A assimetria justifica o risco de falso positivo: descadastrar por engano um cliente de verdade é
 * um aborrecimento reversível (ele reativa no próximo agendamento, e a resposta diz como). Insistir
 * com alguém que não te conhece é existencial. Na dúvida, sai.
 *
 * Por isso as frases exigem a NEGAÇÃO DE VÍNCULO ("com voces", "de voces", "sou cliente"), e não só
 * "não tenho agenda" — que um cliente real diria querendo dizer "estou sem horário marcado".
 */
const WRONG_PERSON_PHRASES = [
  'veio errado',
  'numero errado',
  'pessoa errada',
  'nao tenho agenda com voc',
  'nao tenho agendamento com voc',
  'nao tenho nada com voc',
  'nao conheco voc',
  'nao sou cliente',
  'nunca fui cliente',
  'nao pedi isso',
  'nao solicitei',
  'nao me cadastrei',
  'nao fui eu',
];

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

/** "Vocês erraram a pessoa." Frase, não palavra — e é por isso que a busca é por `includes`. */
export function isWrongPersonText(text) {
  const norm = normalizeForMatch(text);
  if (!norm) return false;
  return WRONG_PERSON_PHRASES.some((frase) => norm.includes(frase));
}

/**
 * Trata a mensagem se ela for um pedido de saída.
 * @returns {Promise<{handled: boolean}>} handled=true quando o webhook não deve seguir adiante.
 */
export async function handleInboundOptOut({ phoneNumberId, value, message } = {}) {
  const normalized = normalizeInboundMessage({ tenantId: 0, phoneNumberId, message, value });
  if (!normalized.fromPhone) return { handled: false };

  const pediuParaSair = isOptOutText(normalized.text);
  const pessoaErrada = !pediuParaSair && isWrongPersonText(normalized.text);
  if (!pediuParaSair && !pessoaErrada) return { handled: false };

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

  if (pessoaErrada) {
    // Vale um log alto: "vocês erraram a pessoa" quase sempre significa que ALGUÉM CADASTROU o
    // número de um terceiro. O número saiu, mas o cadastro que o inseriu continua lá — e vai
    // fazer de novo. Isto é o rastro para achá-lo.
    console.error('[wa/optout][pessoa-errada] destinatário diz não ter vínculo — investigar o cadastro', {
      texto: normalized.text?.slice(0, 120),
    });
  }

  try {
    // Resposta dentro da janela de 24h (a pessoa acabou de escrever): é mensagem de sessão, não
    // precisa de template nem de opt-in — e negar a confirmação a quem pediu para sair seria
    // exatamente o tipo de coisa que a Meta pune.
    //
    // UMA mensagem, e ponto. Quem não te conhece não quer conversa: quer sumir. A resposta genérica
    // do bot ("não entendi, escolha uma opção") é o que transforma um incomodado num denunciante.
    await sendWhatsAppSmart({
      to: normalized.fromPhone,
      message: pessoaErrada ? WRONG_PERSON_REPLY : OPT_OUT_CONFIRMATION,
      context: { kind: pessoaErrada ? 'wrong_person' : 'optout_confirm', phoneNumberId },
    });
  } catch (err) {
    // A saída já está registrada; falhar em confirmar não a desfaz.
    console.warn('[wa/optout] falha ao confirmar saída', err?.message || err);
  }

  return { handled: true };
}
