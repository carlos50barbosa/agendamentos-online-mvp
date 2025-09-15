// backend/src/lib/notifications.js
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

/**
 * Configuração (via ENV)
 *
 * WA_PHONE_NUMBER_ID=...
 * WA_TOKEN=...
 * WA_API_VERSION=v23.0
 * WA_FORCE_TEMPLATE=true|false
 * WA_TEMPLATE_NAME=hello_world
 * WA_TEMPLATE_LANG=en_US
 * WA_TEMPLATE_HAS_BODY_PARAM=0|1          // 1 se seu template tiver {{1}} no corpo
 * WHATSAPP_ALLOWED_LIST=551199...,551198...  // dígitos; aceitamos com + também
 * WA_DEBUG_LOG=true|false
 *
 * SMTP_HOST=...
 * SMTP_PORT=587
 * SMTP_SECURE=false
 * SMTP_USER=...
 * SMTP_PASS=...
 * EMAIL_FROM="Agendamentos Online" <no-reply@seu-dominio>
 */

const cfg = {
  phoneId: process.env.WA_PHONE_NUMBER_ID,
  token: process.env.WA_TOKEN,
  apiVersion: process.env.WA_API_VERSION || 'v23.0',

  forceTemplate: /^true$/i.test(process.env.WA_FORCE_TEMPLATE || ''),
  templateName: process.env.WA_TEMPLATE_NAME || 'hello_world',
  templateLang: process.env.WA_TEMPLATE_LANG || 'en_US',
  templateHasBodyParam: /^1|true$/i.test(process.env.WA_TEMPLATE_HAS_BODY_PARAM || ''),

  allowedList: String(process.env.WHATSAPP_ALLOWED_LIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\D/g, '')),

  debug: /^true$/i.test(process.env.WA_DEBUG_LOG || ''),
};

const toDigits = s => String(s || '').replace(/\D/g, '');

function isAllowed(to) {
  const n = toDigits(to);
  if (!cfg.allowedList.length) return true;
  return cfg.allowedList.includes(n);
}

function graphUrl(path) {
  return `https://graph.facebook.com/${cfg.apiVersion}/${path}`;
}

async function callGraph(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }

  if (cfg.debug) {
    console.log('[wa/cloud] url=%s status=%s body=%s',
      url, res.status, typeof json === 'string' ? json : JSON.stringify(json));
  }

  if (!res.ok) {
    const err = new Error(`WA ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ============== WhatsApp: Template ==============
export async function sendTemplate({ to, name, lang, bodyParams = [] }) {
  const phone = toDigits(to);
  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s', phone);
    return { blocked: true };
  }
  if (!cfg.token || !cfg.phoneId) {
    throw new Error('WA config missing (token/phoneId)');
  }

  const template = {
    name: name || cfg.templateName,
    language: { code: lang || cfg.templateLang },
  };

  // IMPORTANTE: só inclua components se houver params (evita erro 132000)
  if (Array.isArray(bodyParams) && bodyParams.length > 0) {
    template.components = [{
      type: 'body',
      parameters: bodyParams.map(t => ({ type: 'text', text: String(t) })),
    }];
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template,
  };

  const url = graphUrl(`${cfg.phoneId}/messages`);
  if (cfg.debug) {
    console.log('[wa/cloud/template] to=%s name=%s lang=%s params=%d',
      phone, template.name, template.language?.code, bodyParams.length);
  }
  return callGraph(url, payload);
}

// ============== WhatsApp: Texto (ou Template se forceTemplate=true) ==============
export async function notifyWhatsapp(message, to) {
  const phone = toDigits(to);
  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s', phone);
    return { blocked: true };
  }
  if (!cfg.token || !cfg.phoneId) {
    throw new Error('WA config missing (token/phoneId)');
  }

  // Se quisermos sempre iniciar por template (fora da janela de 24h)
  if (cfg.forceTemplate) {
    return sendTemplate({
      to: phone,
      name: cfg.templateName,
      lang: cfg.templateLang,
      bodyParams: cfg.templateHasBodyParam ? [message] : [], // só envia params se o template tiver {{1}}
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: message },
  };
  const url = graphUrl(`${cfg.phoneId}/messages`);
  if (cfg.debug) console.log('[wa/cloud/text] to=%s body=%s', phone, message);
  try{
    return await callGraph(url, payload);
  } catch (err) {
    // Fallback automático: fora da janela de 24h só é permitido template
    const msg = (err?.body && typeof err.body === 'object') ? (err.body.error?.message || '') : String(err?.body || err?.message || '');
    const code = err?.body?.error?.code;
    const sub = err?.body?.error?.error_subcode;
    const is24h = code === 470 || /24\s*h/i.test(msg) || sub === 2018028 || sub === 131047 || err?.status === 400;
    if (cfg.debug) console.warn('[wa/cloud/text] falhou (%s/%s): %s', code, sub, msg);
    if (is24h) {
      if (cfg.debug) console.log('[wa/cloud] tentando template por fallback (24h window)');
      return sendTemplate({
        to: phone,
        name: templateName || cfg.templateName,
        lang: templateLang || cfg.templateLang,
        bodyParams: cfg.templateHasBodyParam ? [message] : [],
      });
    }
    throw err;
  }
}

// ============== WhatsApp: Agendamento simples em memória ==============
const timers = new Set();

export async function scheduleWhatsApp({ to, scheduledAt, message, metadata, useTemplate, bodyParams, templateName, templateLang }) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(+when)) throw new Error('scheduledAt inválido');

  const ms = +when - Date.now();
  const phone = toDigits(to);

  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s (schedule)', phone);
    return { blocked: true };
  }

  const sendFn = async () => {
    try {
      if (cfg.forceTemplate || useTemplate) {
        const params = Array.isArray(bodyParams) && bodyParams.length > 0
          ? bodyParams
          : (cfg.templateHasBodyParam ? [message] : []);
        await sendTemplate({
          to: phone,
          name: templateName || cfg.templateName,
          lang: templateLang || cfg.templateLang,
          bodyParams: params,
        });
      } else {
        await notifyWhatsapp(message, phone);
      }
    } catch (err) {
      console.error('[scheduleWhatsApp/send]', err.status, err.body || err.message);
    }
  };

  if (ms <= 0) {
    await sendFn();
    return { sent: true, immediate: true };
  }

  const t = setTimeout(async () => {
    timers.delete(t);
    await sendFn();
  }, ms);
  timers.add(t);

  if (cfg.debug) {
    console.log('[scheduleWhatsApp] to=%s at=%s (%d ms) meta=%s',
      phone, when.toISOString(), ms, metadata ? JSON.stringify(metadata) : '-');
  }
  return { scheduled: true, at: when.toISOString() };
}

// ============== Email (Nodemailer) ==============
const smtp = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: /^true$/i.test(process.env.SMTP_SECURE || ''),
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
};

let transporter;
if (smtp.host && smtp.auth?.user) {
  transporter = nodemailer.createTransport(smtp);
} else {
  // Fallback: não envia de verdade, apenas “log”
  transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
  if (cfg.debug) console.warn('[email] SMTP não configurado — usando streamTransport (apenas log).');
}


export async function notifyEmail(to, subject, html) {
  if (!to) return { ok: false, error: 'missing_to' };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"Agendamentos Online" <${process.env.SMTP_USER || 'no-reply@localhost'}>`,
      to,
      subject,
      html,
    });
    if (cfg.debug) console.log('✅ Email enviado para %s (%s)', to, subject);
    return { ok: true };
  } catch (err) {
    console.error('[email] erro', err);
    return { ok: false, error: err?.message || 'email_error' };
  }
}
