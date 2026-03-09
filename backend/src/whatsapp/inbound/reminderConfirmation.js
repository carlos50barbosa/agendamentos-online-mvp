import { pool } from '../../lib/db.js';

const HOURS_BACK_FALLBACK = 2;
const HOURS_FORWARD_FALLBACK = 24;

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeConfirmText(text) {
  return String(text || '')
    .replace(/[!.,;:?]+$/g, '')
    .trim()
    .toLowerCase();
}

async function findAppointmentByPhoneFallback({ fromDigits, reason }) {
  if (!fromDigits) return null;
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
    if (!candidates.length) return null;
    candidates.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    if (candidates.length > 1) {
      console.warn('[wa/confirm-btn][fallback] multiplas correspondencias por telefone', {
        from: fromDigits,
        ids: candidates.map((item) => item.id),
        reason,
      });
    }
    return candidates[0];
  } catch (err) {
    console.warn('[wa/confirm-btn][fallback]', err?.message || err);
    return null;
  }
}

async function tryRecordReminderConfirmation({ contextMessageId, fromDigits }) {
  if (!contextMessageId) {
    const fallback = await findAppointmentByPhoneFallback({ fromDigits, reason: 'missing_context_id' });
    if (!fallback?.id) return { ok: false, reason: 'not_found' };
    await pool.query(
      'UPDATE agendamentos SET cliente_confirmou_whatsapp_at = COALESCE(cliente_confirmou_whatsapp_at, NOW()) WHERE id=? LIMIT 1',
      [fallback.id]
    );
    return { ok: true, agendamentoId: fallback.id, estabelecimentoId: fallback.estabelecimento_id || null };
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
      const fallback = await findAppointmentByPhoneFallback({ fromDigits, reason: 'context_id_not_found' });
      if (!fallback?.id) return { ok: false, reason: 'not_found' };
      await pool.query(
        'UPDATE agendamentos SET cliente_confirmou_whatsapp_at = COALESCE(cliente_confirmou_whatsapp_at, NOW()) WHERE id=? LIMIT 1',
        [fallback.id]
      );
      return { ok: true, agendamentoId: fallback.id, estabelecimentoId: fallback.estabelecimento_id || null };
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

export { handleReminderConfirmation };
