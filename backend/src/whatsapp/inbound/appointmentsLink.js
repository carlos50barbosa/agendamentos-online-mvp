// "MEUS AGENDAMENTOS <CÓDIGO>" — a prova de posse que destrava a lista de quem não tem senha.
//
// Mesma mecânica do AUTORIZO (optInConfirm.js) e pelo mesmo motivo prático: fora da janela de 24h a
// Meta só entrega template, e a categoria AUTHENTICATION — a única legítima para código — exige um
// scaling path que esta conta não alcança (ver sql/2026-08-20-add-wa-link-requests.sql). Invertendo
// o sentido, a mensagem que a pessoa envia É a prova, e nada precisa ser aprovado.
//
// ─── Este handler NÃO grava consentimento ──────────────────────────────────────────────────────
//
// Mandar "MEUS AGENDAMENTOS" é pedir para ver a própria agenda, não autorizar lembretes. Quem liga
// o canal é o AUTORIZO, com texto de aceite próprio, e a WABA já caiu duas vezes por consentimento
// deduzido de gesto ambíguo. A janela de 24h abre por consequência técnica da mensagem dela — isso
// é fato da Meta, não permissão nossa para começar a mandar coisas.
import { pool } from '../../lib/db.js';
import { normalizeInboundMessage } from './normalize.js';
import { recordWhatsAppInbound } from '../../lib/whatsapp_contacts.js';
import { normalizePhoneBR } from '../../lib/phone_br.js';
import {
  confirmLinkRequestByCode,
  extractLinkCodeCandidates,
} from '../../lib/wa_link_requests.js';

export async function handleInboundAppointmentsLink({ phoneNumberId, value, message, deps = {} } = {}) {
  const normalizeMessage = deps.normalizeInboundMessage || normalizeInboundMessage;
  const recordInbound = deps.recordWhatsAppInbound || recordWhatsAppInbound;
  const confirmRequest = deps.confirmLinkRequestByCode || confirmLinkRequestByCode;
  const db = deps.pool || pool;
  const logger = deps.logger || console;

  const normalized = normalizeMessage({ tenantId: 0, phoneNumberId, message, value });
  if (!normalized.fromPhone) return { handled: false };

  const candidates = extractLinkCodeCandidates(normalized.text);
  if (!candidates.length) return { handled: false };

  const e164 = normalizePhoneBR(normalized.fromPhone);
  if (!e164) return { handled: false };

  // Cada candidato é testado contra o banco. Texto qualquer com oito letras maiúsculas gera
  // candidato e não casa com nada — por isso a checagem barata (regex) NÃO devolve handled:true
  // sozinha: só quem confirma um pedido real consome a mensagem.
  for (const code of candidates) {
    let result;
    try {
      result = await confirmRequest({ code, phoneE164: e164, wamid: normalized.messageId, db });
    } catch (err) {
      logger.warn('[wa/appointments-link] falha ao confirmar', err?.message || err);
      return { handled: false };
    }
    if (!result?.ok) continue;

    // Só registra o inbound DEPOIS de casar: uma mensagem qualquer com oito maiúsculas não deve
    // mexer na janela de 24h por engano.
    await recordInbound({ recipientId: e164 }).catch((err) => {
      logger.warn('[wa/appointments-link] falha ao registrar inbound', err?.message || err);
    });

    // Sem resposta automática de propósito: quem está esperando é a ABA, que já está perguntando ao
    // servidor. Uma mensagem de volta seria mais um envio para manter, sem nada que a tela não diga
    // melhor no mesmo instante.
    return { handled: true, phone: e164 };
  }

  return { handled: false };
}

export default handleInboundAppointmentsLink;
