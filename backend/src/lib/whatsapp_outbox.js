// backend/src/lib/whatsapp_outbox.js
import { pool } from './db.js';
import { sendWhatsAppSmart } from './notifications.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from './whatsapp_templates.js';
import { hasWhatsAppConsent } from './whatsapp_consent.js';
import { whatsappUnavailable } from './whatsapp_availability.js';
import { isValidMobileBR } from './phone_br.js';
import {
  debitWhatsAppMessage,
  getWhatsAppWalletSnapshot,
  recordWhatsAppBlocked,
  WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT,
} from './whatsapp_wallet.js';

/**
 * Quem recebe a mensagem. NÃO é mais um portão — é rótulo.
 *
 * Por um tempo o envio ao ESTABLISHMENT era isento do opt-in, com o argumento de que o dono é o
 * titular da conta e o número é dele. O argumento é verdadeiro e não importa: a regra da Meta não
 * abre exceção para o titular. Continua sendo mensagem iniciada pelo negócio para um número, e
 * continua exigindo aceite comprovável. Uma isenção era exatamente a frincha que a gente teria de
 * explicar num recurso — e "esse a gente não pediu autorização, mas é o dono" não é resposta.
 *
 * Hoje TODO destinatário precisa de consentimento registrado. A audiência sobrevive só para dizer,
 * na trilha de bloqueios, para quem a mensagem barrada era — o que muda quem você vai cutucar
 * (o cliente ou o dono), não se a mensagem sai.
 */
export const WA_AUDIENCE_CLIENT = 'client';
export const WA_AUDIENCE_ESTABLISHMENT = 'establishment';

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

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
}

function parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
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
  // Só rótulo, para a trilha de bloqueios saber de quem era a mensagem barrada. Não isenta
  // ninguém do opt-in — nem o dono do salão.
  audience = WA_AUDIENCE_CLIENT,
}) {
  const estabId = toInt(estabelecimentoId, 0);
  const agId = agendamentoId != null ? toInt(agendamentoId, 0) : null;
  if (!estabId || !to) {
    return { ok: false, error: 'invalid_payload' };
  }

  // Canal fora do ar (conta suspensa): nem tenta. Sem isto, cada confirmação e cada tick do cron
  // de lembrete bate numa conta desabilitada, falha e enche o log — e o volume cresce junto com o
  // número de pessoas que marcam a caixa de opt-in.
  //
  // Não gera linha na carteira: um apagão da plataforma não é um evento do estabelecimento, e
  // registrar um "bloqueado" por envio transformaria a trilha dele em lixo.
  //
  // Devolve `blocked`, e é isso que faz o lembrete cair em e-mail sozinho — o fallback já trata
  // QUALQUER bloqueio, justamente para um motivo novo como este não sumir em silêncio.
  if (whatsappUnavailable()) {
    return { ok: true, sent: false, blocked: true, reason: 'wa_unavailable' };
  }

  // Número que não pode existir (DDD inexistente, telefone fixo, celular começando com 8): não sai.
  //
  // Vem antes do opt-in porque não merece nem um SELECT. E vem, sobretudo, porque uma taxa alta de
  // destinatário inexistente é a assinatura de lista raspada — o padrão que a Meta procura. De
  // quebra, cada tentativa dessas debitaria a carteira do estabelecimento por uma mensagem que
  // nunca chegaria a lugar nenhum.
  //
  // O cliente NÃO fica sem aviso: `blocked` faz o lembrete cair em e-mail sozinho, porque o
  // fallback trata qualquer bloqueio. Quem digitou o telefone errado já não recebia WhatsApp —
  // a diferença é que agora não queima crédito nem reputação tentando.
  if (!isValidMobileBR(to)) {
    await recordWhatsAppBlocked({
      estabelecimentoId: estabId,
      agendamentoId: agId,
      reason: 'invalid_phone',
      metadata: { kind, audience },
    }).catch(() => {});
    return { ok: true, sent: false, blocked: true, reason: 'invalid_phone' };
  }

  // Opt-in, para TODO destinatário: sem autorização não se consulta saldo, não se debita, não se
  // envia. É a pergunta mais barata e a única que, respondida errado, tira a plataforma do ar.
  const consented = await hasWhatsAppConsent(to);
  if (!consented) {
    await recordWhatsAppBlocked({
      estabelecimentoId: estabId,
      agendamentoId: agId,
      reason: 'no_optin',
      metadata: { kind, audience },
    }).catch(() => {});
    return { ok: true, sent: false, blocked: true, reason: 'no_optin' };
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
      components: Array.isArray(template.components) ? template.components : undefined,
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
    const errorCode = err?.code === 'wa_not_connected' ? 'wa_not_connected' : 'send_failed';
    return {
      ok: false,
      sent: false,
      error: errorCode,
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

export async function enqueueWhatsAppOutbox({
  tenantId,
  to,
  kind = 'bot',
  message = null,
  template = null,
  metadata = null,
}) {
  const tenant = toInt(tenantId, 0);
  const toPhone = String(to || '').trim();
  if (!tenant || !toPhone) return { ok: false, error: 'invalid_payload' };
  const payload = {
    message: message != null ? String(message) : null,
    template: template && typeof template === 'object' ? template : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
  };
  try {
    const [result] = await pool.query(
      `INSERT INTO whatsapp_outbox
        (tenant_id, to_phone, kind, payload_json, status, provider_message_id, attempt_count, last_error, created_at, updated_at, sent_at)
       VALUES (?,?,?,?, 'pending', NULL, 0, NULL, NOW(), NOW(), NULL)`,
      [tenant, toPhone, String(kind || 'bot').slice(0, 64), safeJson(payload)]
    );
    return { ok: true, outboxId: Number(result?.insertId || 0), payload };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, error: 'outbox_table_missing' };
    }
    throw err;
  }
}

export async function processWhatsAppOutboxItem(outboxId) {
  const id = toInt(outboxId, 0);
  if (!id) return { ok: false, error: 'invalid_id' };
  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, to_phone, kind, payload_json, status, attempt_count
         FROM whatsapp_outbox
        WHERE id=?
        LIMIT 1`,
      [id]
    );
    const row = rows?.[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (String(row.status || '').toLowerCase() === 'sent') {
      return { ok: true, alreadySent: true, outboxId: id, providerMessageId: null };
    }
    const payload = parseJson(row.payload_json) || {};
    const template = payload?.template && typeof payload.template === 'object'
      ? payload.template
      : null;
    const message = payload?.message != null ? String(payload.message) : null;

    const sendResult = await sendAppointmentWhatsApp({
      estabelecimentoId: row.tenant_id,
      agendamentoId: null,
      to: row.to_phone,
      kind: row.kind || 'bot',
      message,
      template,
      metadata: payload?.metadata || null,
    });

    const providerMessageId = sendResult?.provider_message_id || null;
    const ok = Boolean(sendResult?.ok && sendResult?.sent !== false);
    const status = ok ? 'sent' : 'error';
    const lastError = ok ? null : String(sendResult?.detail || sendResult?.error || 'send_failed').slice(0, 1000);
    await pool.query(
      `UPDATE whatsapp_outbox
          SET status=?,
              provider_message_id=COALESCE(?, provider_message_id),
              attempt_count=attempt_count+1,
              last_error=?,
              sent_at=CASE WHEN ?='sent' THEN NOW() ELSE sent_at END,
              updated_at=NOW()
        WHERE id=?`,
      [status, providerMessageId, lastError, status, id]
    );
    return {
      ok: true,
      status,
      outboxId: id,
      providerMessageId,
      sendResult,
      errorCode: ok ? null : 'BOT_TEMPLATE_SEND_FAILED',
    };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, error: 'outbox_table_missing' };
    }
    throw err;
  }
}

export async function enqueueAndSendWhatsAppOutbox(payload) {
  const queued = await enqueueWhatsAppOutbox(payload);
  if (!queued.ok) {
    return { ok: false, error: queued.error, errorCode: queued.error === 'outbox_table_missing' ? 'BOT_OUTBOX_UNAVAILABLE' : null };
  }
  const processed = await processWhatsAppOutboxItem(queued.outboxId);
  if (!processed.ok) {
    return {
      ok: false,
      outboxId: queued.outboxId,
      error: processed.error,
      errorCode: processed.error === 'outbox_table_missing' ? 'BOT_OUTBOX_UNAVAILABLE' : 'BOT_TEMPLATE_SEND_FAILED',
    };
  }
  return {
    ok: processed.status === 'sent',
    outboxId: queued.outboxId,
    providerMessageId: processed.providerMessageId || null,
    sendResult: processed.sendResult || null,
    status: processed.status || 'error',
    errorCode: processed.status === 'sent' ? null : processed.errorCode || 'BOT_TEMPLATE_SEND_FAILED',
  };
}
