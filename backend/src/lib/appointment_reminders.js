import { notifyEmail } from './notifications.js';
import { sendAppointmentWhatsApp } from './whatsapp_outbox.js';
import { clientWhatsappDisabled } from './client_notifications.js';

const TZ = 'America/Sao_Paulo';
const INTERVAL_MS = Number(process.env.REMINDER_8H_INTERVAL_MS || 60_000); // 1 min default

const toDigits = (s) => String(s || '').replace(/\D/g, '');
const firstName = (full) => {
  if (!full) return '';
  const part = String(full).trim().split(/\s+/)[0];
  return part || '';
};
const normalizePhoneBR = (value) => {
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
};

function brTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

function brDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });
}

function extractExpectedParams(err) {
  const details =
    err?.body?.error?.error_data?.details ||
    err?.body?.error?.message ||
    err?.message ||
    '';
  const m = String(details).match(/expected number of params\s*\((\d+)\)/i);
  if (m) return Number(m[1]);
  return null;
}

function requiresImageHeader(err) {
  const details =
    err?.body?.error?.error_data?.details ||
    err?.body?.error?.message ||
    err?.message ||
    '';
  return /header:\s*format mismatch.*expected\s*image/i.test(String(details));
}

async function markReminderSent(pool, id, messageId) {
  try {
    await pool.query(
      'UPDATE agendamentos SET reminder_8h_sent_at=NOW(), reminder_8h_msg_id=COALESCE(reminder_8h_msg_id, ?) WHERE id=? AND reminder_8h_sent_at IS NULL',
      [messageId || null, id]
    );
  } catch (e) {
    console.warn('[reminder8h] falha ao marcar reminder_8h_sent_at', e?.message || e);
  }
}

async function sendReminder(pool, row) {
  const telCli = normalizePhoneBR(row?.cliente_telefone);
  if (!telCli) {
    await markReminderSent(pool, row.id); // sem telefone, nao adianta tentar de novo
    return { sent: false, reason: 'no_phone' };
  }
  if (clientWhatsappDisabled()) {
    await markReminderSent(pool, row.id); // evita reprocessar se optou por desligar cliente
    return { sent: false, reason: 'client_whatsapp_disabled' };
  }

  const inicioISO = new Date(row.inicio).toISOString();
  const hora = brTime(inicioISO);
  const data = brDate(inicioISO);
  const estNome = row?.estabelecimento_nome || '';
  const estNomeFriendly = estNome || 'nosso estabelecimento';
  const profNome = row?.profissional_nome || '';
  const profLabel = profNome ? ` com ${profNome}` : '';
  const profFriendly = profNome || estNomeFriendly;
  const msg = `[Lembrete] Faltam 8 horas para o seu ${row.servico_nome}${profNome ? ' com ' + profNome : ''} em ${estNomeFriendly} (${hora} de ${data}).`;

  const paramModeEnv = String(
    process.env.WA_TEMPLATE_PARAM_MODE_REMINDER ||
    process.env.WA_TEMPLATE_PARAM_MODE ||
    'single'
  ).toLowerCase();
  const paramCountHint = Number(process.env.WA_TEMPLATE_REMINDER_PARAMS || process.env.WA_TEMPLATE_PARAMS_REMINDER || NaN);
  const tplName =
    process.env.WA_TEMPLATE_NAME_REMINDER ||
    process.env.WA_TEMPLATE_NAME_CONFIRM ||
    process.env.WA_TEMPLATE_NAME ||
    'confirmacao_agendamento';
  const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
  const tplNameLower = String(tplName || '').toLowerCase();
  const tplHeaderImage =
    process.env.WA_TEMPLATE_REMINDER_HEADER_URL ||
    process.env.WA_TEMPLATE_REMINDER_HEADER_IMAGE_URL ||
    process.env.WA_TEMPLATE_HEADER_URL ||
    process.env.WA_TEMPLATE_HEADER_IMAGE_URL ||
    null;

  let paramMode = paramModeEnv;
  if (paramCountHint === 4) {
    paramMode = 'quad';
  } else if (paramCountHint === 3) {
    paramMode = 'triple';
  } else if (paramCountHint === 1) {
    paramMode = 'single';
  } else if (/lembrete_agendamento_v2/.test(tplNameLower) && !/^quad|4|quatro/.test(paramModeEnv)) {
    // v2 template aceita 4 parametros: ajusta automaticamente mesmo sem mudar env
    paramMode = 'quad';
  }

  const tripleParams = [row.servico_nome, `${hora} de ${data}`, estNome];
  const quadParams = [
    firstName(row?.cliente_nome) || 'cliente',
    estNomeFriendly,
    data,
    hora,
  ];
  const singleParams = [msg];
  const emptyParams = [];

  const warnMissingMessageId = (reason) => {
    console.warn('[reminder8h] enviado sem message_id (confirmação WA pode não casar automaticamente)', {
      agendamentoId: row.id,
      inicio: row.inicio,
      clienteTelefone: telCli,
      motivo: reason || 'desconhecido',
    });
  };

  const sendTemplateWithParams = async (params) => {
    const r = await sendAppointmentWhatsApp({
      estabelecimentoId: row.estabelecimento_id,
      agendamentoId: row.id,
      to: telCli,
      kind: 'reminder_8h',
      template: {
        name: tplName,
        lang: tplLang,
        bodyParams: params,
        headerImageUrl: tplHeaderImage || undefined,
      },
    });
    return { result: r, messageId: r?.provider_message_id || null };
  };

  try {
    let waMessageId = null;
    let result = null;
    if (/^quad|4|quatro/.test(paramMode)) {
      const r = await sendTemplateWithParams(quadParams);
      waMessageId = r.messageId;
      result = r.result;
    } else if (/^triple|3$/.test(paramMode)) {
      const r = await sendTemplateWithParams(tripleParams);
      waMessageId = r.messageId;
      result = r.result;
    } else {
      const r = await sendTemplateWithParams(singleParams);
      waMessageId = r.messageId;
      result = r.result;
    }

    if (result?.blocked && (result.reason === 'insufficient_balance' || result.reason === 'per_appointment_limit')) {
      const email = String(row?.cliente_email || '').trim().toLowerCase();
      if (email) {
        try {
          await notifyEmail(
            email,
            'Lembrete do seu agendamento',
            `<p>Ol\u00e1${firstName(row?.cliente_nome) ? `, <b>${firstName(row?.cliente_nome)}</b>` : ''}! Faltam 8 horas para o seu agendamento de <b>${row.servico_nome}</b> em <b>${estNomeFriendly}</b> (${hora} de ${data}).</p>`
          );
        } catch (err) {
          console.warn('[reminder8h][email-fallback] failed', err?.message || err);
        }
      }
      await markReminderSent(pool, row.id, null);
      return { sent: false, reason: result.reason };
    }

    if (result && result.ok === false) {
      const pseudoErr = { body: result.wa_body, message: result.detail };
      const expected = extractExpectedParams(pseudoErr);
      try {
        if (expected === 4) {
          const attempt = await sendTemplateWithParams(quadParams);
          const waMessageId = attempt.messageId;
          const r = attempt.result;
          if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
          if (!waMessageId) warnMissingMessageId('waMessageId vazio na resposta do template (fallback quad)');
          await markReminderSent(pool, row.id, waMessageId);
          return { sent: true };
        }
        if (expected === 3) {
          const attempt = await sendTemplateWithParams(tripleParams);
          const waMessageId = attempt.messageId;
          const r = attempt.result;
          if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
          if (!waMessageId) warnMissingMessageId('waMessageId vazio na resposta do template (fallback triple)');
          await markReminderSent(pool, row.id, waMessageId);
          return { sent: true };
        }
        if (expected === 1) {
          const attempt = await sendTemplateWithParams(singleParams);
          const waMessageId = attempt.messageId;
          const r = attempt.result;
          if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
          if (!waMessageId) warnMissingMessageId('waMessageId vazio na resposta do template (fallback single)');
          await markReminderSent(pool, row.id, waMessageId);
          return { sent: true };
        }
        if (expected === 0) {
          const attempt = await sendTemplateWithParams(emptyParams);
          const waMessageId = attempt.messageId;
          const r = attempt.result;
          if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
          if (!waMessageId) warnMissingMessageId('waMessageId vazio na resposta do template (fallback empty)');
          await markReminderSent(pool, row.id, waMessageId);
          return { sent: true };
        }
      } catch (fallbackErr) {
        console.error('[reminder8h] erro ao enviar (fallback)', row.id, fallbackErr?.status, fallbackErr?.body || fallbackErr?.message || fallbackErr);
        return { sent: false, error: fallbackErr?.message || String(fallbackErr) };
      }

      const headerMismatch = requiresImageHeader(pseudoErr);
      if (headerMismatch) {
        if (!tplHeaderImage) {
          console.warn('[reminder8h] template requer header de imagem mas nenhuma URL foi configurada (WA_TEMPLATE_REMINDER_HEADER_URL)');
        }
      }
      return { sent: false, error: result?.detail || result?.error || 'send_failed' };
    }

    if (!waMessageId) {
      warnMissingMessageId('waMessageId vazio na resposta do template');
    }
    await markReminderSent(pool, row.id, waMessageId);
    return { sent: true };
  } catch (err) {
    // Fallback para mismatch de parametros do template (erro 132000)
    const expected = extractExpectedParams(err);
    try {
      if (expected === 4 && !/^quad|4|quatro/.test(paramMode)) {
        const attempt = await sendTemplateWithParams(quadParams);
        const waMessageId = attempt.messageId;
        const r = attempt.result;
        if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
        if (!waMessageId) {
          warnMissingMessageId('waMessageId vazio na resposta do template (fallback quad)');
        }
        await markReminderSent(pool, row.id, waMessageId);
        return { sent: true };
      }
      if (expected === 3 && !/^triple|3$/.test(paramMode)) {
        const attempt = await sendTemplateWithParams(tripleParams);
        const waMessageId = attempt.messageId;
        const r = attempt.result;
        if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
        if (!waMessageId) {
          warnMissingMessageId('waMessageId vazio na resposta do template (fallback triple)');
        }
        await markReminderSent(pool, row.id, waMessageId);
        return { sent: true };
      }
      if (expected === 1 && !/^single|1|um$/.test(paramMode)) {
        const attempt = await sendTemplateWithParams(singleParams);
        const waMessageId = attempt.messageId;
        const r = attempt.result;
        if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
        if (!waMessageId) {
          warnMissingMessageId('waMessageId vazio na resposta do template (fallback single)');
        }
        await markReminderSent(pool, row.id, waMessageId);
        return { sent: true };
      }
      if (expected === 0) {
        const attempt = await sendTemplateWithParams(emptyParams);
        const waMessageId = attempt.messageId;
        const r = attempt.result;
        if (r && r.ok === false) return { sent: false, error: r?.detail || r?.error || 'send_failed' };
        if (!waMessageId) {
          warnMissingMessageId('waMessageId vazio na resposta do template (fallback empty)');
        }
        await markReminderSent(pool, row.id, waMessageId);
        return { sent: true };
      }
    } catch (fallbackErr) {
      console.error('[reminder8h] erro ao enviar (fallback)', row.id, fallbackErr?.status, fallbackErr?.body || fallbackErr?.message || fallbackErr);
      return { sent: false, error: fallbackErr?.message || String(fallbackErr) };
    }

    const headerMismatch = requiresImageHeader(err);
    if (headerMismatch) {
      if (!tplHeaderImage) {
        console.warn('[reminder8h] template requer header de imagem mas nenhuma URL foi configurada (WA_TEMPLATE_REMINDER_HEADER_URL)');
      }
      console.error('[reminder8h] template header mismatch (template-only)', row.id, err?.status, err?.body || err?.message || err);
      return { sent: false, error: err?.message || String(err) };
    }

    console.error('[reminder8h] erro ao enviar', row.id, err?.status, err?.body || err?.message || err);
    return { sent: false, error: err?.message || String(err) };
  }
}

export function startAppointmentReminders(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || INTERVAL_MS);

  const tick = async () => {
    try {
      const [rows] = await pool.query(
        `
        SELECT a.id, a.inicio, a.estabelecimento_id, a.profissional_id,
               c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.email AS cliente_email,
               e.nome AS estabelecimento_nome, e.telefone AS estabelecimento_telefone,
               COALESCE(NULLIF(GROUP_CONCAT(s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS servico_nome,
               p.nome AS profissional_nome
        FROM agendamentos a
        JOIN usuarios c ON c.id = a.cliente_id
        JOIN usuarios e ON e.id = a.estabelecimento_id
        LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
        LEFT JOIN servicos s ON s.id = ai.servico_id
        LEFT JOIN servicos s0 ON s0.id = a.servico_id
        LEFT JOIN profissionais p ON p.id = a.profissional_id
        WHERE a.status='confirmado'
          AND a.reminder_8h_sent_at IS NULL
          AND a.inicio > NOW()
          AND TIMESTAMPDIFF(MINUTE, NOW(), a.inicio) <= 480
        GROUP BY a.id, a.inicio, a.estabelecimento_id, a.profissional_id,
                 c.nome, c.telefone, c.email, e.nome, e.telefone, p.nome, s0.nome
        ORDER BY a.inicio ASC
        LIMIT 50
      `
      );

      if (!rows?.length) return;
      const now = Date.now();
      for (const row of rows) {
        const startAt = new Date(row.inicio).getTime();
        const reminderAt = startAt - 8 * 60 * 60 * 1000;
        if (now < reminderAt - 5000) {
          // Ainda nao chegou em 8h exato (ajuste defensivo)
          continue;
        }
        await sendReminder(pool, row);
      }
    } catch (e) {
      console.error('[reminder8h] tick error', e?.message || e);
    }
  };

  // roda apos pequeno delay para nao travar boot
  setTimeout(tick, 10_000);
  return setInterval(tick, every);
}
