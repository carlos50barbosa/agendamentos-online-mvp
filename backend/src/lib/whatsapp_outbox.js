// backend/src/lib/whatsapp_outbox.js
import { pool } from './db.js';
import { sendWhatsAppSmart } from './notifications.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from './whatsapp_templates.js';
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

const TZ = 'America/Sao_Paulo';

function brDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TZ,
  });
}

async function loadConfirmacaoAgendamentoV2Context({ agendamentoId, estabelecimentoId }) {
  const agId = toInt(agendamentoId, 0);
  if (!agId) return null;
  const params = [agId];
  let where = 'WHERE a.id=?';
  if (estabelecimentoId) {
    const estId = toInt(estabelecimentoId, 0);
    if (estId) {
      where += ' AND a.estabelecimento_id=?';
      params.push(estId);
    }
  }
  try {
    const [rows] = await pool.query(
      `
      SELECT a.inicio,
             e.nome AS estabelecimento_nome,
             COALESCE(NULLIF(GROUP_CONCAT(s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS servico_nome
      FROM agendamentos a
      JOIN usuarios e ON e.id = a.estabelecimento_id
      LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ai.servico_id
      LEFT JOIN servicos s0 ON s0.id = a.servico_id
      ${where}
      GROUP BY a.id, a.inicio, e.nome, s0.nome
      LIMIT 1
      `,
      params
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      serviceLabel: row.servico_nome || '',
      dataHoraLabel: brDateTime(row.inicio),
      estabelecimentoNome: row.estabelecimento_nome || '',
    };
  } catch (err) {
    console.warn('[wa][confirmacao_v2] context load failed', err?.message || err);
    return null;
  }
}

async function ensureConfirmacaoAgendamentoV2BodyParams(template, { agendamentoId, estabelecimentoId } = {}) {
  if (!template || !isConfirmacaoAgendamentoV2(template.name)) return template;
  const rawParams = Array.isArray(template.bodyParams) ? template.bodyParams : [];
  const hasThree = rawParams.length === 3 && rawParams.every((p) => String(p || '').trim());
  if (hasThree) {
    template.bodyParams = buildConfirmacaoAgendamentoV2Components({
      serviceLabel: rawParams[0],
      dataHoraLabel: rawParams[1],
      estabelecimentoNome: rawParams[2],
    });
    return template;
  }
  const ctx = await loadConfirmacaoAgendamentoV2Context({ agendamentoId, estabelecimentoId });
  template.bodyParams = buildConfirmacaoAgendamentoV2Components({
    serviceLabel: ctx?.serviceLabel ?? rawParams[0],
    dataHoraLabel: ctx?.dataHoraLabel ?? rawParams[1],
    estabelecimentoNome: ctx?.estabelecimentoNome ?? rawParams[2],
  });
  return template;
}

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
    let templateToSend = template && template.name ? {
      name: template.name,
      lang: template.lang,
      bodyParams: template.bodyParams || [],
      headerImageUrl: template.headerImageUrl,
      headerDocumentUrl: template.headerDocumentUrl,
      headerVideoUrl: template.headerVideoUrl,
      headerText: template.headerText,
    } : null;
    if (templateToSend) {
      templateToSend = await ensureConfirmacaoAgendamentoV2BodyParams(templateToSend, {
        agendamentoId: agId,
        estabelecimentoId: estabId,
      });
    }
    resp = await sendWhatsAppSmart({
      to,
      message: message != null ? String(message) : null,
      template: templateToSend,
      context: { kind, agendamentoId: agId, estabelecimentoId: estabId },
    });
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
