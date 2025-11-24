import { notifyWhatsapp, sendTemplate } from './notifications.js';

const TZ = 'America/Sao_Paulo';
const INTERVAL_MS = Number(process.env.REMINDER_8H_INTERVAL_MS || 60_000); // 1 min default

const toDigits = (s) => String(s || '').replace(/\D/g, '');
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

async function markReminderSent(pool, id) {
  try {
    await pool.query(
      'UPDATE agendamentos SET reminder_8h_sent_at=NOW() WHERE id=? AND reminder_8h_sent_at IS NULL',
      [id]
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

  const inicioISO = new Date(row.inicio).toISOString();
  const hora = brTime(inicioISO);
  const data = brDate(inicioISO);
  const estNome = row?.estabelecimento_nome || '';
  const estNomeFriendly = estNome || 'nosso estabelecimento';
  const profNome = row?.profissional_nome || '';
  const profLabel = profNome ? ` com ${profNome}` : '';
  const msg = `[Lembrete] Faltam 8 horas para o seu ${row.servico_nome}${profNome ? ' com ' + profNome : ''} em ${estNomeFriendly} (${hora} de ${data}).`;

  const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
  const tplName =
    process.env.WA_TEMPLATE_NAME_REMINDER ||
    process.env.WA_TEMPLATE_NAME_CONFIRM ||
    process.env.WA_TEMPLATE_NAME ||
    'confirmacao_agendamento';
  const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';

  try {
    if (/^triple|3$/.test(paramMode)) {
      await sendTemplate({
        to: telCli,
        name: tplName,
        lang: tplLang,
        bodyParams: [row.servico_nome, `${hora} de ${data}`, estNome],
      });
    } else {
      await notifyWhatsapp(msg, telCli);
    }
    await markReminderSent(pool, row.id);
    return { sent: true };
  } catch (err) {
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
