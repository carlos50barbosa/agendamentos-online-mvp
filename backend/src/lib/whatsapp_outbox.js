// backend/src/lib/whatsapp_outbox.js
import { pool } from './db.js';
import { notifyWhatsapp, sendTemplate } from './notifications.js';
import {
  debitWhatsAppMessage,
  getWhatsAppWalletSnapshot,
  recordWhatsAppBlocked,
  WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT,
} from './whatsapp_wallet.js';

const toInt = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

async function getAppointmentWaCount(agendamentoId) {
  const id = toInt(agendamentoId, 0);
  if (!id) return null;
  const [[row]] = await pool.query('SELECT wa_messages_sent FROM agendamentos WHERE id=? LIMIT 1', [id]);
  if (!row) return null;
  return toInt(row.wa_messages_sent, 0);
}

async function incrementAppointmentWaCount(agendamentoId) {
  const id = toInt(agendamentoId, 0);
  if (!id) return { ok: false };
  await pool.query('UPDATE agendamentos SET wa_messages_sent=wa_messages_sent+1 WHERE id=? LIMIT 1', [id]);
  return { ok: true };
}

function extractProviderMessageId(resp) {
  try {
    const id = resp?.messages?.[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export async function sendAppointmentWhatsApp({
  estabelecimentoId,
  agendamentoId,
  to,
  kind = 'appointment',
  message,
  template,
  metadata,
}) {
  const estabId = toInt(estabelecimentoId, 0);
  const agId = agendamentoId != null ? toInt(agendamentoId, 0) : null;
  if (!estabId || !to) {
    return { ok: false, error: 'invalid_payload' };
  }

  const wallet = await getWhatsAppWalletSnapshot(estabId).catch(() => null);
  if (!wallet) {
    return { ok: false, error: 'wallet_unavailable' };
  }

  if (agId) {
    try {
      const sentCount = await getAppointmentWaCount(agId);
      if (typeof sentCount === 'number' && sentCount >= WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT) {
        await recordWhatsAppBlocked({
          estabelecimentoId: estabId,
          agendamentoId: agId,
          reason: 'per_appointment_limit',
          metadata: { kind, sentCount, max: WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT },
        });
        return { ok: true, sent: false, blocked: true, reason: 'per_appointment_limit', wallet };
      }
    } catch (err) {
      // se a coluna ainda nao existir, nao bloqueia envio (mantem compat)
      console.warn('[wa][limit-check] failed', err?.message || err);
    }
  }

  if (toInt(wallet.total_balance, 0) < 1) {
    await recordWhatsAppBlocked({
      estabelecimentoId: estabId,
      agendamentoId: agId,
      reason: 'insufficient_balance',
      metadata: { kind, wallet },
    });
    return { ok: true, sent: false, blocked: true, reason: 'insufficient_balance', wallet };
  }

  let resp;
  try {
    if (template && template.name) {
      resp = await sendTemplate({
        to,
        name: template.name,
        lang: template.lang,
        bodyParams: template.bodyParams || [],
        headerImageUrl: template.headerImageUrl,
        headerDocumentUrl: template.headerDocumentUrl,
        headerVideoUrl: template.headerVideoUrl,
        headerText: template.headerText,
      });
    } else {
      resp = await notifyWhatsapp(String(message || ''), to);
    }
  } catch (err) {
    return {
      ok: false,
      sent: false,
      error: 'send_failed',
      detail: err?.message || String(err),
      wa_status: err?.status,
      wa_body: err?.body,
    };
  }

  if (resp?.blocked) return { ok: true, sent: false, blocked: true, reason: 'blocked_allowed_list' };
  if (resp?.invalid) return { ok: true, sent: false, blocked: true, reason: 'invalid_phone' };

  const providerMessageId = extractProviderMessageId(resp);
  if (agId) {
    try {
      await incrementAppointmentWaCount(agId);
    } catch (err) {
      console.warn('[wa][count] increment failed', err?.message || err);
    }
  }

  if (providerMessageId) {
    try {
      await debitWhatsAppMessage({
        estabelecimentoId: estabId,
        agendamentoId: agId,
        providerMessageId,
        metadata: { kind, ...metadata },
      });
    } catch (err) {
      console.warn('[wa][wallet][debit] failed', err?.message || err);
    }
  }

  return { ok: true, sent: true, provider_message_id: providerMessageId, result: resp };
}
