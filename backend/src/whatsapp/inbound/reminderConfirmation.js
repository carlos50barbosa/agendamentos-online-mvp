import { pool } from '../../lib/db.js';

const HOURS_BACK_FALLBACK = 2;
const HOURS_FORWARD_FALLBACK = 24;

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeConfirmText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!.,;:?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Quais candidatos um "CONFIRMAR" digitado deve marcar.
 *
 * PURA de propósito: a escolha é a parte que errava, e ela precisa de teste sem banco.
 *
 * Devolve o GRUPO do horário mais próximo, não uma linha só. Em salão, atendimento simultâneo
 * é rotina — a mesma cliente faz escova com uma profissional e unha com outra às 14h, recebe
 * os dois lembretes e digita "CONFIRMAR" uma vez. Marcar só um deixava o outro pendente para
 * sempre no painel, e QUAL dos dois sobrava era indefinido: o desempate caía na ordem que o
 * MySQL devolveu. O `|| id` no sort mata essa indefinição.
 *
 * O grupo é o mesmo INSTANTE e o mesmo estabelecimento. Quem tem 14h e 18h no mesmo dia
 * confirma só o das 14h, que é o que o lembrete estava cobrando — os dois são visitas
 * diferentes, e a de 18h ainda vai receber o lembrete dela.
 */
export function selectConfirmationGroup(candidates = []) {
  const ordenados = (candidates || [])
    .filter((row) => row && row.inicio != null && !Number.isNaN(new Date(row.inicio).getTime()))
    .sort((a, b) => (new Date(a.inicio) - new Date(b.inicio)) || (Number(a.id) - Number(b.id)));
  if (!ordenados.length) return [];
  const instante = new Date(ordenados[0].inicio).getTime();
  const estabelecimento = Number(ordenados[0].estabelecimento_id);
  return ordenados.filter((row) => (
    new Date(row.inicio).getTime() === instante
    && Number(row.estabelecimento_id) === estabelecimento
  ));
}

// Devolve sempre uma LISTA — inclusive nos caminhos de erro. Os chamadores leem `.length`, e
// um `null` escapando por aqui viraria TypeError em vez de "não achei".
async function findAppointmentByPhoneFallback({ fromDigits, reason }) {
  if (!fromDigits) return [];
  try {
    const now = Date.now();
    const lower = new Date(now - HOURS_BACK_FALLBACK * 60 * 60 * 1000);
    const upper = new Date(now + HOURS_FORWARD_FALLBACK * 60 * 60 * 1000);

    const [rows] = await pool.query(
      `SELECT a.id, a.inicio, a.status, a.estabelecimento_id, u.telefone
         FROM agendamentos a
         JOIN usuarios u ON u.id = a.cliente_id
        WHERE a.status IN ('confirmado','pendente')
          AND a.cliente_confirmou_whatsapp_at IS NULL
          AND a.reminder_8h_sent_at IS NOT NULL
          AND a.inicio BETWEEN ? AND ?`,
      [lower, upper]
    );

    const candidates = (rows || []).filter((row) => toDigits(row.telefone) === fromDigits);
    if (!candidates.length) return [];
    const grupo = selectConfirmationGroup(candidates);
    // O aviso agora distingue os dois casos, porque só um deles é ambíguo: várias linhas do
    // MESMO horário são um atendimento simultâneo e vão TODAS ser confirmadas; várias de
    // horários diferentes é que sobram de fora.
    if (candidates.length > grupo.length) {
      console.warn('[wa/confirm-btn][fallback] confirmando so o horario mais proximo', {
        from: fromDigits,
        confirmados: grupo.map((item) => item.id),
        ignorados: candidates.filter((item) => !grupo.includes(item)).map((item) => item.id),
        reason,
      });
    }
    return grupo;
  } catch (err) {
    console.warn('[wa/confirm-btn][fallback]', err?.message || err);
    return [];
  }
}

// Marca o grupo inteiro numa query. COALESCE preserva a primeira confirmação, igual a antes.
async function markConfirmed(ids) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE agendamentos
        SET cliente_confirmou_whatsapp_at = COALESCE(cliente_confirmou_whatsapp_at, NOW())
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
}

async function tryRecordReminderConfirmation({ contextMessageId, fromDigits }) {
  if (!contextMessageId) {
    const grupo = await findAppointmentByPhoneFallback({ fromDigits, reason: 'missing_context_id' });
    if (!grupo.length) return { ok: false, reason: 'not_found' };
    await markConfirmed(grupo.map((item) => item.id));
    return {
      ok: true,
      agendamentoId: grupo[0].id,
      agendamentoIds: grupo.map((item) => item.id),
      estabelecimentoId: grupo[0].estabelecimento_id || null,
    };
  }

  try {
    const [[row]] = await pool.query(
      `SELECT a.id, a.status, a.estabelecimento_id, u.telefone
         FROM agendamentos a
         JOIN usuarios u ON u.id = a.cliente_id
        WHERE a.reminder_8h_msg_id=? LIMIT 1`,
      [contextMessageId]
    );
    if (!row) {
      const grupo = await findAppointmentByPhoneFallback({ fromDigits, reason: 'context_id_not_found' });
      if (!grupo.length) return { ok: false, reason: 'not_found' };
      await markConfirmed(grupo.map((item) => item.id));
      return {
        ok: true,
        agendamentoId: grupo[0].id,
        agendamentoIds: grupo.map((item) => item.id),
        estabelecimentoId: grupo[0].estabelecimento_id || null,
      };
    }

    const tel = toDigits(row.telefone);
    if (tel && tel !== fromDigits) return { ok: false, reason: 'phone_mismatch' };
    const statusNorm = String(row.status || '').toLowerCase();
    if (!['confirmado', 'pendente'].includes(statusNorm)) {
      if (statusNorm === 'cancelado') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'not_confirmable', status: statusNorm };
    }

    await pool.query(
      'UPDATE agendamentos SET cliente_confirmou_whatsapp_at = COALESCE(cliente_confirmou_whatsapp_at, NOW()) WHERE id=? LIMIT 1',
      [row.id]
    );
    return { ok: true, agendamentoId: row.id, estabelecimentoId: row.estabelecimento_id || null };
  } catch (err) {
    console.warn('[wa/confirm-btn]', err?.message || err);
    return { ok: false, reason: 'error' };
  }
}

function shouldTryConfirmation({ text, buttonPayload, contextMessageId }) {
  const textNorm = normalizeConfirmText(text);
  const payloadNorm = String(buttonPayload || '').trim().toLowerCase();
  if (textNorm === 'confirmar' || textNorm.startsWith('confirmar ')) return true;
  if (payloadNorm.includes('confirm')) return true;
  if (contextMessageId) return true;
  return false;
}

async function handleReminderConfirmation({ fromPhone, text, buttonPayload, contextMessageId }) {
  const fromDigits = toDigits(fromPhone);
  if (!fromDigits) return { handled: false };
  if (!shouldTryConfirmation({ text, buttonPayload, contextMessageId })) return { handled: false };

  const recorded = await tryRecordReminderConfirmation({
    contextMessageId: contextMessageId || null,
    fromDigits,
  });

  if (recorded?.ok) {
    return {
      handled: true,
      ok: true,
      action: 'REMINDER_CONFIRM',
      establishmentId: recorded.estabelecimentoId || null,
      appointmentId: recorded.agendamentoId || null,
      message: 'Confirmado! Vamos te aguardar no horário combinado.',
    };
  }

  if (recorded?.reason === 'cancelled') {
    return {
      handled: true,
      ok: false,
      action: 'REMINDER_CONFIRM_CANCELLED',
      message: 'Esse agendamento foi cancelado e não pode ser confirmado.',
    };
  }

  if (recorded?.reason === 'not_confirmable') {
    return {
      handled: true,
      ok: false,
      action: 'REMINDER_CONFIRM_NOT_ALLOWED',
      message: 'Esse agendamento não está disponível para confirmação.',
    };
  }

  return { handled: false };
}

export { handleReminderConfirmation, normalizeConfirmText, shouldTryConfirmation };
