// backend/src/whatsapp/inbound/optInConfirm.js
// "AUTORIZO" — o consentimento confirmado PELO PRÓPRIO NÚMERO.
//
// ─── O buraco que isto fecha ────────────────────────────────────────────────────────────────────
//
// Horas depois da WABA voltar, alguém criou um estabelecimento falso com o telefone de uma pessoa
// aleatória, entrou em Configurações e marcou a caixa de opt-in POR ELA. A vítima recebeu um
// lembrete de agendamento e respondeu que não tinha agenda conosco.
//
// O consentimento estava gravado com texto, data e IP — uma prova impecável de um aceite que não
// valia NADA, porque nunca verificamos que quem marca a caixa é dono do número. Todo o opt-in
// protegia contra descuido; não protegia contra abuso. E foi abuso.
//
// ─── Por que "mande AUTORIZO" e não "receba um código" ──────────────────────────────────────────
//
// O OTP clássico (mandamos um código, ela digita) tem dois problemas aqui:
//
//   1. PRÁTICO: fora da janela de 24h — o caso normal — texto livre não sai. Precisaria de um
//      template de autenticação aprovado na Meta, que não existe e leva dias.
//
//   2. DE FUNDO, e é o que decide: um código prova quem tem ACESSO AO APARELHO. Uma mensagem
//      ENVIADA daquele número prova quem é DONO DELE. Não dá para mandar mensagem do WhatsApp de um
//      estranho. É impossível de forjar — e é exatamente o que o atacante de hoje não conseguiria.
//
// De quebra: mensagem iniciada pelo usuário é o opt-in mais forte que existe para a Meta (mais que
// qualquer caixa marcada), é grátis, e abre a janela de 24h.
//
// A prova guardada é o `wamid` da mensagem dela. É o que transforma "ele disse que autorizou" em
// "a Meta registrou que ele autorizou, nesta mensagem, neste instante".
import { pool } from '../../lib/db.js';
import { sendWhatsAppSmart } from '../../lib/notifications.js';
import { normalizeInboundMessage } from './normalize.js';
import {
  grantWhatsAppConsent,
  getWhatsAppConsent,
  OPTIN_SOURCES,
  CONSENT_AUDIENCE,
} from '../../lib/whatsapp_consent.js';
import { normalizePhoneBR, phoneVariantsBR } from '../../lib/phone_br.js';
import { recordWhatsAppInbound } from '../../lib/whatsapp_contacts.js';

/**
 * A palavra tem de ser INEQUÍVOCA e improvável de sair por acaso. "sim" e "ok" estão fora de
 * propósito: são as respostas mais comuns do mundo, e um "ok" solto viraria consentimento — que é
 * o oposto de consentimento ativo.
 */
const PALAVRAS = new Set(['autorizo', 'autorizar', 'eu autorizo']);

export const JA_AUTORIZADO =
  'Você já estava autorizado — seus avisos no WhatsApp continuam ativos. ' +
  'Para sair a qualquer momento, é só responder PARAR.';

export const CONFIRMADO_ESTAB =
  'Pronto! Seus avisos de agendamento estão ativos aqui no WhatsApp. ' +
  'Pode fechar a página — já está valendo. Para sair a qualquer momento, responda PARAR.';

export const CONFIRMADO_CLIENTE =
  'Pronto! Você vai receber a confirmação e os lembretes dos seus agendamentos aqui. ' +
  'Para sair a qualquer momento, responda PARAR.';

export const NAO_ENCONTRADO =
  'Não encontramos este número em nenhum cadastro. Se você quer receber avisos de agendamento, ' +
  'faça o cadastro em agenda0.com.br e autorize por lá.';

function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Igualdade, não `includes`: "não autorizo" não pode virar autorização. */
export function isOptInConfirmText(text) {
  return PALAVRAS.has(normalizeForMatch(text));
}

/**
 * Quem é o dono deste número na nossa base?
 *
 * O consentimento é por TELEFONE, mas precisamos do usuário para saber QUAL TEXTO gravar — o dono
 * de salão recebe "avisos da minha agenda", o cliente recebe "confirmação dos meus agendamentos".
 * Gravar o texto errado faria a pessoa autorizar uma coisa e receber outra.
 *
 * Estabelecimento tem precedência: se o mesmo número aparece nos dois papéis, o que ele mais
 * recebe é aviso de agenda.
 *
 * Procura pelas DUAS formas do número (com e sem o nono dígito) porque o `from` do webhook e o
 * cadastro não usam a mesma: a Meta identifica celular de DDD ≥ 31 pelo formato antigo. Com
 * igualdade exata, quem é de Belo Horizonte mandava AUTORIZO e ouvia "não encontramos este número"
 * — autorização legítima, recusada por desencontro de formato. Ver `phoneVariantsBR`.
 */
async function resolveTitular(e164) {
  const variantes = phoneVariantsBR(e164);
  if (!variantes.length) return null;
  const [rows] = await pool.query(
    `SELECT id, nome, tipo FROM usuarios
      WHERE telefone IN (${variantes.map(() => '?').join(',')})
      ORDER BY (tipo = 'estabelecimento') DESC, id ASC
      LIMIT 1`,
    variantes
  );
  return rows?.[0] || null;
}

/**
 * Trata a mensagem se ela for uma confirmação de opt-in.
 *
 * `deps` existe para o teste: tudo aqui é I/O (banco e Meta), e o que precisa ser travado é a ORDEM
 * das chamadas — registrar a entrada antes de responder. Sem essa costura não há como provar isso
 * sem subir banco e WhatsApp.
 *
 * @returns {Promise<{handled: boolean}>} handled=true quando o webhook não deve seguir adiante.
 */
export async function handleInboundOptInConfirm({ phoneNumberId, value, message, deps = {} } = {}) {
  const normalizeMessage = deps.normalizeInboundMessage || normalizeInboundMessage;
  const recordInbound = deps.recordWhatsAppInbound || recordWhatsAppInbound;
  const sendReply = deps.sendWhatsAppSmart || sendWhatsAppSmart;
  const readConsent = deps.getWhatsAppConsent || getWhatsAppConsent;
  const grantConsent = deps.grantWhatsAppConsent || grantWhatsAppConsent;
  const findTitular = deps.resolveTitular || resolveTitular;
  const db = deps.pool || pool;
  const logger = deps.logger || console;

  const normalized = normalizeMessage({ tenantId: 0, phoneNumberId, message, value });
  if (!normalized.fromPhone || !isOptInConfirmText(normalized.text)) {
    return { handled: false };
  }

  const e164 = normalizePhoneBR(normalized.fromPhone);
  if (!e164) return { handled: false };

  // A janela de 24h está aberta — ela acabou de escrever. Mas quem GRAVA isso é o fluxo principal
  // do webhook, e este handler roda antes dele e devolve handled:true, cortando o resto. Sem este
  // registro, sendWhatsAppSmart lê "última entrada: nunca", conclui que a janela está fechada e cai
  // para template — e o template padrão pede 3 parâmetros que não temos, então nada era enviado.
  await recordInbound({ recipientId: e164 }).catch((err) => {
    logger.warn('[wa/optin-confirm] falha ao registrar inbound', err?.message || err);
  });

  const responder = async (texto) => {
    try {
      // Janela de 24h aberta (ela ACABOU de escrever): mensagem de sessão, sem template e sem
      // depender do próprio opt-in que estamos gravando.
      // `template: null` é deliberado: se por algum motivo a janela não estiver aberta, o certo é
      // NÃO enviar. Cair no template genérico manda a mensagem errada para quem pediu outra coisa.
      await sendReply({
        to: e164,
        message: texto,
        template: null,
        context: { kind: 'optin_confirm', phoneNumberId },
      });
    } catch (err) {
      logger.warn('[wa/optin-confirm] falha ao responder', err?.message || err);
    }
  };

  const atual = await readConsent(e164).catch(() => null);
  if (atual?.evento === 'granted') {
    await responder(JA_AUTORIZADO);
    return { handled: true };
  }

  const titular = await findTitular(e164);
  if (!titular) {
    // Número que não está em cadastro nenhum. NÃO grava consentimento: autorização sem vínculo não
    // serve para nada — não há a quem notificar — e gravá-la só encheria a tabela de prova com
    // linhas órfãs.
    await responder(NAO_ENCONTRADO);
    return { handled: true };
  }

  const ehEstab = titular.tipo === 'estabelecimento';

  try {
    await grantConsent({
      phone: e164,
      usuarioId: titular.id,
      origem: OPTIN_SOURCES.WHATSAPP_AUTORIZO,
      audience: ehEstab ? CONSENT_AUDIENCE.ESTABLISHMENT : CONSENT_AUDIENCE.CLIENT,
      // A prova. O wamid é o identificador que a MEta emitiu para a mensagem que ELE mandou — não
      // uma afirmação nossa. É isso que se leva a um recurso.
      metadados: {
        prova: 'inbound_autorizo',
        wamid: normalized.messageId || null,
        texto_recebido: String(normalized.text || '').slice(0, 64),
      },
    });
  } catch (err) {
    // Não confirma o que não gravou: dizer "pronto, está ativo" sem estar ativo é pior do que
    // não responder.
    logger.error('[wa/optin-confirm] falha ao gravar consentimento', err?.message || err);
    return { handled: false };
  }

  // Liga a preferência do dono junto — para ele, aceite e preferência são a mesma intenção.
  if (ehEstab) {
    try {
      await db.query('UPDATE usuarios SET notify_whatsapp_estab=1 WHERE id=?', [titular.id]);
    } catch (err) {
      logger.warn('[wa/optin-confirm] falha ao ligar notify_whatsapp_estab', err?.message || err);
    }
  }

  await responder(ehEstab ? CONFIRMADO_ESTAB : CONFIRMADO_CLIENTE);
  return { handled: true };
}
