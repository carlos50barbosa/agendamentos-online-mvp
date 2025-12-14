import { notifyWhatsapp, sendTemplate } from './notifications.js';
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

  const sendTemplateWithParams = async (params) => {
    const resp = await sendTemplate({
      to: telCli,
      name: tplName,
      lang: tplLang,
      bodyParams: params,
      headerImageUrl: tplHeaderImage || undefined,
    });
    return resp?.messages?.[0]?.id || null;
  };

  try {
    let waMessageId = null;
    if (/^quad|4|quatro/.test(paramMode)) {
      waMessageId = await sendTemplateWithParams(quadParams);
    } else if (/^triple|3$/.test(paramMode)) {
      waMessageId = await sendTemplateWithParams(tripleParams);
    } else {
      await notifyWhatsapp(msg, telCli);
    }
    await markReminderSent(pool, row.id, waMessageId);
    return { sent: true };
  } catch (err) {
    // Fallback para mismatch de parametros do template (erro 132000)
    const expected = extractExpectedParams(err);
    try {
      if (expected === 4 && !/^quad|4|quatro/.test(paramMode)) {
        const waMessageId = await sendTemplateWithParams(quadParams);
        await markReminderSent(pool, row.id, waMessageId);
        return { sent: true };
      }
      if (expected === 3 && !/^triple|3$/.test(paramMode)) {
        const waMessageId = await sendTemplateWithParams(tripleParams);
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
      try {
        await notifyWhatsapp(msg, telCli);
        await markReminderSent(pool, row.id, null);
        return { sent: true };
      } catch (fallbackErr) {
        console.error('[reminder8h] erro ao enviar (texto fallback header)', row.id, fallbackErr?.status, fallbackErr?.body || fallbackErr?.message || fallbackErr);
        return { sent: false, error: fallbackErr?.message || String(fallbackErr) };
      }
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
        SELECT a.id, a.inicio, a.servico_id, a.estabelecimento_id, a.profissional_id,
               c.nome AS cliente_nome, c.telefone AS cliente_telefone,
               e.nome AS estabelecimento_nome, e.telefone AS estabelecimento_telefone,
               s.nome AS servico_nome,
               p.nome AS profissional_nome
        FROM agendamentos a
        JOIN usuarios c ON c.id = a.cliente_id
        JOIN usuarios e ON e.id = a.estabelecimento_id
        JOIN servicos s ON s.id = a.servico_id
        LEFT JOIN profissionais p ON p.id = a.profissional_id
        WHERE a.status='confirmado'
          AND a.reminder_8h_sent_at IS NULL
          AND a.inicio > NOW()
          AND TIMESTAMPDIFF(MINUTE, NOW(), a.inicio) <= 480
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
