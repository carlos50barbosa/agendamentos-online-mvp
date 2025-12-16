// backend/src/lib/estab_reminders.js
import { notifyEmail, notifyWhatsapp, sendTemplate } from './notifications.js';
import { estabNotificationsDisabled } from './estab_notifications.js';

const TZ = 'America/Sao_Paulo';
const INTERVAL_MS = Number(process.env.ESTAB_REMINDER_5H_INTERVAL_MS || 60_000); // roda a cada 1 min por padrao

const toDigits = (s) => String(s || '').replace(/\D/g, '');
const boolPref = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === false) return Boolean(value);
  const num = Number(value);
  if (!Number.isNaN(num)) return num !== 0;
  const norm = String(value).trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'nao'].includes(norm)) return false;
  if (['1', 'true', 'on', 'yes', 'sim'].includes(norm)) return true;
  return fallback;
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

let hasColumnsCache = null;
async function ensureHasReminderColumns(pool) {
  if (hasColumnsCache !== null) return hasColumnsCache;
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM agendamentos LIKE 'estab_reminder_5h_sent_at'");
    hasColumnsCache = rows.length > 0;
    if (!hasColumnsCache) {
      console.warn('[estab-reminder-5h] coluna estab_reminder_5h_sent_at ausente. Rode as migracoes SQL.');
    }
  } catch (err) {
    hasColumnsCache = false;
    console.warn('[estab-reminder-5h] falha ao verificar colunas', err?.message || err);
  }
  return hasColumnsCache;
}

async function markReminderSent(pool, id, messageId) {
  try {
    await pool.query(
      'UPDATE agendamentos SET estab_reminder_5h_sent_at=NOW(), estab_reminder_5h_msg_id=COALESCE(estab_reminder_5h_msg_id, ?) WHERE id=? AND estab_reminder_5h_sent_at IS NULL',
      [messageId || null, id]
    );
  } catch (e) {
    console.warn('[estab-reminder-5h] falha ao marcar lembrete como enviado', e?.message || e);
  }
}

async function sendEstabReminder(pool, row) {
  if (estabNotificationsDisabled()) {
    return { skipped: 'disabled' };
  }

  const telEst = normalizePhoneBR(row?.estabelecimento_telefone);
  const emailEst = String(row?.estabelecimento_email || '').trim();
  const canEmail = boolPref(row?.notify_email_estab, true) && !!emailEst;
  const canWhatsapp = boolPref(row?.notify_whatsapp_estab, true) && !!telEst;

  if (!canEmail && !canWhatsapp) {
    await markReminderSent(pool, row.id, null);
    return { skipped: 'no_channel' };
  }

  const inicioISO = new Date(row.inicio).toISOString();
  const hora = brTime(inicioISO);
  const data = brDate(inicioISO);
  const whenLabel = `${hora} de ${data}`;
  const service = row?.servico_nome || 'Atendimento';
  const clientName = row?.cliente_nome || 'cliente';
  const estName = row?.estabelecimento_nome || '';
  const profName = row?.profissional_nome || '';
  const profLabel = profName ? ` com ${profName}` : '';
  const msgText = `[Lembrete] Faltam 5h para ${service}${profLabel} (${whenLabel}) para o cliente ${clientName}.`;

  let waMessageId = null;
  if (canWhatsapp) {
    const paramModeEnv = String(
      process.env.WA_TEMPLATE_PARAM_MODE_ESTAB_REMINDER ||
      process.env.WA_TEMPLATE_PARAM_MODE_REMINDER ||
      process.env.WA_TEMPLATE_PARAM_MODE ||
      'quad'
    ).toLowerCase();
    const tplName =
      process.env.WA_TEMPLATE_NAME_ESTAB_REMINDER ||
      process.env.WA_TEMPLATE_NAME_ESTAB ||
      process.env.WA_TEMPLATE_NAME_REMINDER ||
      process.env.WA_TEMPLATE_NAME ||
      'confirmacao_agendamento';
    const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
    const params3 = [service, whenLabel, clientName];
    const params4 = [service, whenLabel, clientName, profName || '-'];

    const sendWithParams = async (params) => {
      const resp = await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: params });
      return resp?.messages?.[0]?.id || null;
    };

    try {
      if (/^quad|4|quatro/.test(paramModeEnv)) {
        waMessageId = await sendWithParams(params4);
      } else {
        waMessageId = await sendWithParams(params3);
      }
    } catch (err) {
      const expected = extractExpectedParams(err);
      try {
        if (expected === 4 && !/^quad|4|quatro/.test(paramModeEnv)) {
          waMessageId = await sendWithParams(params4);
        } else if (expected === 3 && !/^triple|3$/.test(paramModeEnv)) {
          waMessageId = await sendWithParams(params3);
        } else {
          await notifyWhatsapp(msgText, telEst);
        }
      } catch (fallbackErr) {
        console.warn('[estab-reminder-5h] erro ao enviar (fallback WA)', fallbackErr?.message || fallbackErr);
      }
    }
  }

  if (canEmail) {
    try {
      await notifyEmail(
        emailEst,
        'Lembrete: atendimento em 5h',
        `<p>Voce tem um atendimento de <b>${service}</b>${profLabel} as <b>${whenLabel}</b> para o cliente <b>${clientName}</b>.</p>`
      );
    } catch (err) {
      console.warn('[estab-reminder-5h] falha ao enviar email', err?.message || err);
    }
  }

  await markReminderSent(pool, row.id, waMessageId);
  return { sent: true };
}

export function startEstabReminders(pool, { intervalMs } = {}) {
  const every = Number(intervalMs || INTERVAL_MS);

  const tick = async () => {
    try {
      if (estabNotificationsDisabled()) return;
      const hasColumns = await ensureHasReminderColumns(pool);
      if (!hasColumns) return;

      const [rows] = await pool.query(
        `
        SELECT a.id, a.inicio, a.servico_id, a.cliente_id, a.profissional_id,
               s.nome AS servico_nome,
               c.nome AS cliente_nome,
               e.nome AS estabelecimento_nome, e.email AS estabelecimento_email, e.telefone AS estabelecimento_telefone,
               e.notify_email_estab, e.notify_whatsapp_estab,
               p.nome AS profissional_nome
        FROM agendamentos a
        JOIN usuarios e ON e.id = a.estabelecimento_id
        JOIN usuarios c ON c.id = a.cliente_id
        JOIN servicos s ON s.id = a.servico_id
        LEFT JOIN profissionais p ON p.id = a.profissional_id
        WHERE a.status='confirmado'
          AND a.inicio > NOW()
          AND a.estab_reminder_5h_sent_at IS NULL
          AND TIMESTAMPDIFF(MINUTE, NOW(), a.inicio) <= 300
        ORDER BY a.inicio ASC
        LIMIT 50
        `
      );

      if (!rows?.length) return;
      for (const row of rows) {
        await sendEstabReminder(pool, row);
      }
    } catch (e) {
      console.error('[estab-reminder-5h] tick error', e?.message || e);
    }
  };

  setTimeout(tick, 10_000);
  return setInterval(tick, every);
}
