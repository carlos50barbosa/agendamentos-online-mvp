// backend/src/lib/notifications.js
import 'dotenv/config';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

// ========= E-mail =========
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function notifyEmail(to, subject, html) {
  if (!to) return { ok: false, error: 'missing_to' };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"Agendamentos Online" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`✅ Email enviado para ${to}`);
    return { ok: true };
  } catch (err) {
    console.error('Erro ao enviar email', err);
    return { ok: false, error: err?.message || 'email_error' };
  }
}

// ========= WhatsApp =========
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WA_TOKEN;

// Envia imediatamente (texto OU template)
export async function sendWhatsApp({ to, message, template }) {
  if (!to) return { ok: false, error: 'invalid_phone' };
  if (!message && !template) return { ok: false, error: 'missing_message_or_template' };

  // Normaliza telefone (E.164 sem '+')
  const phone = String(to).replace(/\D/g, '');

  if (!WA_PHONE_NUMBER_ID || !WA_TOKEN) {
    console.log('[notifyWhatsapp] (dev) sem WA_PHONE_NUMBER_ID/WA_TOKEN. to=%s msg=%s',
      phone, message || (template && template.name));
    return { ok: true, dev: true };
  }

  const url = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

  const payload = template ? {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.lang || process.env.WA_TEMPLATE_LANG || 'pt_BR' },
      components: template.params ? [{ type: 'body', parameters: template.params }] : undefined,
    },
  } : {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: message },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      console.error('Erro WhatsApp', data?.error || res.statusText);
      return { ok: false, error: data?.error || res.statusText };
    }

    console.log(`✅ WhatsApp enviado para ${phone}`);
    return { ok: true, data };
  } catch (err) {
    console.error('Erro WhatsApp (network)', err);
    return { ok: false, error: err?.message || 'wa_network_error' };
  }
}

// Backwards-compat (mantém sua função antiga)
export async function notifyWhatsapp(message, to) {
  return sendWhatsApp({ to, message });
}

// ========= Agendamento in-memory com DEDUP =========
const scheduled = [];
const scheduledKeys = new Set();

/**
 * Agenda envio de WhatsApp.
 * DEDUP: se já houver (to normalizado) + mesmo segundo, ignora o novo.
 */
export function scheduleWhatsApp({ to, scheduledAt, message, template, metadata }) {
  if (!to || !scheduledAt || (!message && !template)) {
    return { ok: false, error: 'invalid_params' };
  }

  // normaliza telefone E.164 sem '+'
  const phone = String(to).replace(/\D/g, '');
  const date = new Date(scheduledAt);
  const ts = date.getTime();
  if (Number.isNaN(ts)) return { ok: false, error: 'invalid_date' };

  // chave de deduplicação: mesmo destino + MESMO segundo
  const key = `${phone}|${date.toISOString().slice(0, 19)}`; // yyyy-mm-ddTHH:MM:SS

  if (scheduledKeys.has(key)) {
    console.warn('[scheduleWhatsApp] dedup: já existe envio para %s às %s', phone, date.toISOString());
    return { ok: true, dedup: true, key };
  }

  const now = Date.now();
  const delay = Math.max(0, ts - now);

  console.log('⏱️ WhatsApp agendado: to=%s when=%s (delay=%sms) kind=%s',
    phone, date.toISOString(), delay, metadata?.kind || '-');

  const timer = setTimeout(async () => {
    try {
      await sendWhatsApp({ to: phone, message, template });
    } catch (e) {
      console.error('[scheduleWhatsApp] send error:', e);
    } finally {
      scheduledKeys.delete(key);
    }
  }, delay);

  scheduledKeys.add(key);
  scheduled.push({ key, to: phone, scheduledAt: date.toISOString(), message, template, metadata, timer });
  return { ok: true, key, scheduledAt: date.toISOString(), to: phone };
}

export function listScheduled() {
  return scheduled.map((s) => ({
    to: s.to,
    scheduledAt: s.scheduledAt,
    message: s.message,
    template: s.template,
    metadata: s.metadata,
  }));
}

// Opcional: apenas para logar “pronto” ao subir
export function initNotifications() {
  console.log('[notifications] in-memory scheduler pronto');
}
