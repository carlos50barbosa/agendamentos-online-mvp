// backend/src/lib/notifications.js
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

/* =========================
 *  E-MAIL
 * ========================= */
export async function notifyEmail(to, subject, html) {
  try {
    if (!to) return { skipped: true, reason: 'missing_to' };

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      console.warn('[notifyEmail] SMTP nÃ£o configurado; skip');
      return { skipped: true, reason: 'smtp_not_configured' };
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const info = await transporter.sendMail({
      from: SMTP_FROM || 'Agendamentos <no-reply@agendamentos.local>',
      to,
      subject,
      html
    });

    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[notifyEmail] erro:', e.message);
    return { ok: false, error: e.message };
  }
}


/* =========================
 *  WHATSAPP (Cloud API)
 * ========================= */
function normalizeBRPhone(p) {
  if (!p) return null;
  const only = String(p).replace(/\D/g, '');
  if (only.startsWith('55')) return only;
  return '55' + only;
}

const policyErrorCodes = new Set([470, 131047, 131056]); // janela/template

async function sendWA(baseUrl, token, payload) {
  const r = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

/**
 * notifyWhatsapp(message, toPhone, options?)
 * options:
 *  - type: 'text' | 'template'
 *  - templateName, templateLang
 *  - fallbackToTemplate: boolean (tenta template se texto falhar por polÃ­tica)
 */
export async function notifyWhatsapp(message, toPhone, options = {}) {
  try {
    if (!message || !toPhone) return { skipped: true, reason: 'missing_params' };

    const TOKEN = process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN;
    const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const API_VER = process.env.WA_API_VERSION || 'v22.0';

    if (!TOKEN || !PHONE_NUMBER_ID) {
      console.warn('[notifyWhatsapp] WA_TOKEN/WA_PHONE_NUMBER_ID nÃ£o configurados; skip');
      return { skipped: true, reason: 'wa_not_configured' };
    }

    const to = normalizeBRPhone(toPhone);
    const baseUrl = `https://graph.facebook.com/${API_VER}/${PHONE_NUMBER_ID}/messages`;

    const wantTemplate = options.type === 'template';
    const templateName = options.templateName || process.env.WA_TEMPLATE_NAME;
    const templateLang = options.templateLang || process.env.WA_TEMPLATE_LANG || 'pt_BR';
    const fallbackToTemplate = options.fallbackToTemplate ?? true;

    // Se pediu template explicitamente
    if (wantTemplate) {
      if (!templateName) {
        return { ok: false, error: 'template_name_missing' };
      }
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: templateLang } }
      };
      const r = await sendWA(baseUrl, TOKEN, payload);
      if (!r.ok) console.error('[notifyWhatsapp] Template error:', r.data);
      return r.ok ? { ok: true, data: r.data, usedTemplate: templateName } :
                    { ok: false, error: r.data?.error?.message || 'wa_template_failed', raw: r.data };
    }

    // Primeiro tenta TEXTO
    const textPayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message }
    };
    const r1 = await sendWA(baseUrl, TOKEN, textPayload);
    if (r1.ok) return { ok: true, data: r1.data };

    // Se falhou por polÃ­tica (janela de 24h) e temos template â†’ fallback
    const err = r1.data?.error;
    const code = Number(err?.code);
    if (fallbackToTemplate && templateName && policyErrorCodes.has(code)) {
      const tplPayload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: templateLang } }
      };
      const r2 = await sendWA(baseUrl, TOKEN, tplPayload);
      if (!r2.ok) console.error('[notifyWhatsapp] Template fallback error:', r2.data);
      return r2.ok ? { ok: true, data: r2.data, usedTemplate: templateName } :
                     { ok: false, error: r2.data?.error?.message || 'wa_template_failed', raw: r2.data };
    }

    console.error('[notifyWhatsapp] Graph error:', r1.data);
    return { ok: false, error: err?.message || 'wa_send_failed', raw: r1.data };
  } catch (e) {
    console.error('[notifyWhatsapp] erro:', e);
    return { ok: false, error: e.message };
  }
}


/* =========================
 *  AGENDAMENTO IN-MEMORY
 *  (sem persistÃªncia; some no restart)
 * ========================= */
let nextTimerId = 1;
const timers = new Map(); // id -> timeout

/**
 * Agenda um WhatsApp para o futuro usando setTimeout.
 * Retorna Promise (para suportar `.catch(...)` no seu cÃ³digo).
 *  - Se scheduledAt <= agora, envia imediatamente.
 *  - NÃƒO persiste se o processo reiniciar.
 */
export async function scheduleWhatsApp({ to, scheduledAt, message, metadata }) {
  if (!to || !scheduledAt || !message) {
    return Promise.reject(new Error('missing_params'));
  }

  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return Promise.reject(new Error('invalid_datetime'));
  }

  const delay = when.getTime() - Date.now();

  // Envia agora se jÃ¡ passou
  if (delay <= 0) {
    const r = await notifyWhatsapp(message, to);
    return { ok: true, sentNow: true, result: r };
  }

  const id = nextTimerId++;
  const timeout = setTimeout(async () => {
    try {
      await notifyWhatsapp(message, to);
    } catch (e) {
      console.error('[scheduleWhatsApp] envio agendado falhou:', e);
    } finally {
      timers.delete(id);
    }
  }, delay);

  timers.set(id, timeout);
  return { ok: true, id, scheduledAt: when.toISOString(), meta: metadata || null };
}

/** Cancela um envio agendado (opcional) */
export function cancelScheduledWhatsApp(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
    return { ok: true, canceled: true };
  }
  return { ok: false, canceled: false, reason: 'not_found' };
}
