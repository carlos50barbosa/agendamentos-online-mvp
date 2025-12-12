// backend/src/lib/appointment_limits.js
import { pool } from './db.js';
import { notifyEmail, notifyWhatsapp } from './notifications.js';

const ACTIVE_APPOINTMENT_STATUSES = ['confirmado', 'pendente'];
let customNotifier = null;

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

function ensureDate(input) {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function computeMonthRange(dateInput = new Date()) {
  const base = ensureDate(dateInput);
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const label = start.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

async function countAppointmentsInRange(estabelecimentoId, range) {
  const { start, end } = range;
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS total FROM agendamentos WHERE estabelecimento_id=? AND status IN ('confirmado','pendente') AND inicio >= ? AND inicio < ?",
    [estabelecimentoId, start, end]
  );
  return Number(rows?.[0]?.total || 0);
}

export function setAppointmentLimitNotifier(fn) {
  customNotifier = typeof fn === 'function' ? fn : null;
}

export async function checkMonthlyAppointmentLimit({ estabelecimentoId, planConfig, appointmentDate }) {
  const range = computeMonthRange(appointmentDate || new Date());
  const limit = planConfig?.maxMonthlyAppointments ?? null;

  if (limit === null || limit === undefined) {
    return { ok: true, limit: null, total: null, range };
  }

  const total = await countAppointmentsInRange(estabelecimentoId, range);
  return { ok: total < limit, limit, total, range };
}

async function defaultLimitNotifier({ estabelecimentoId, limit, total, range, planConfig }) {
  try {
    const [[est]] = await pool.query(
      'SELECT email, telefone, nome, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?',
      [estabelecimentoId]
    );
    const estNome = est?.nome || '';
    const monthLabel = range?.label || 'este mes';
    const planLabel = planConfig?.label || 'seu plano atual';
    const emailSubject = 'Limite de agendamentos do plano atingido';
    const html = `<p>Olá${estNome ? `, <b>${estNome}</b>` : ''}! Você atingiu o limite de <b>${limit}</b> agendamentos no ${monthLabel} do ${planLabel}.</p><p>Total atual: <b>${total}</b>. Faça upgrade para continuar recebendo novos agendamentos.</p>`;

    if (est?.email && boolPref(est?.notify_email_estab, true)) {
      await notifyEmail(est.email, emailSubject, html);
    }

    const tel = toDigits(est?.telefone);
    if (tel && boolPref(est?.notify_whatsapp_estab, true)) {
      const text = `[Limite] Você atingiu ${total}/${limit} agendamentos no ${monthLabel}. Atualize seu plano para continuar confirmando novos horários.`;
      await notifyWhatsapp(text, tel);
    }
  } catch (e) {
    console.warn('[appointments][limit][notify]', e?.message || e);
  }
}

export async function notifyAppointmentLimitReached(payload) {
  const notifier = customNotifier || defaultLimitNotifier;
  try {
    await notifier(payload);
  } catch (e) {
    console.warn('[appointments][limit][notify-failed]', e?.message || e);
  }
}

export const __test = {
  computeMonthRange,
  ACTIVE_APPOINTMENT_STATUSES,
};

