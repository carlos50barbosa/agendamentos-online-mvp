import 'dotenv/config';

// src/lib/notifications.js
// ESM — Node >= 18 (fetch global)
// Exports: notifyEmail, notifyWhatsapp, scheduleWhatsApp, initNotifications

/* ===================== Utils ===================== */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  // ajuste se quiser forçar país: if (!digits.startsWith('55')) return null;
  return digits.length >= 10 ? digits : null;
}

/* ===================== Email ===================== */
// Envia e-mail via SMTP (se SMTP_* estiver configurado). Caso contrário, apenas loga (MVP).
export async function notifyEmail(to, subject, html) {
  if (!to) return; // sem destinatário = no-op
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST) {
    console.log("[notifyEmail] (dev) sem SMTP configurado. to=%s subject=%s", to, subject);
    return;
  }

  try {
    // import dinâmico para não exigir dependência em todos os ambientes
    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: String(SMTP_PORT) === "465",
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("[notifyEmail] falha ao enviar:", err?.message || err);
    // não propaga erro para não quebrar o fluxo do MVP
  }
}

/* ===================== WhatsApp Cloud API ===================== */
async function sendWhatsApp({ to, message, template }) {
  const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
  const TOKEN = process.env.WA_TOKEN;

  if (!PHONE_NUMBER_ID || !TOKEN) {
    console.log("[notifyWhatsapp] (dev) sem WA_PHONE_NUMBER_ID/WA_TOKEN. to=%s msg=%s", to, message);
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };

  let body;

  if (template) {
    // Envio por template aprovado
    // template: { name, lang?: 'pt_BR', params?: [{type:'text', text:'...'}] }
    body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.lang || "pt_BR" },
        components: template.params?.length
          ? [{ type: "body", parameters: template.params }]
          : [],
      },
    };
  } else if (process.env.WA_TEMPLATE_NAME) {
    // Fallback: usa template com 1 variável, jogando a mensagem como {{1}}
    body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: process.env.WA_TEMPLATE_NAME,
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
      },
    };
  } else {
    // Texto simples — só funciona com sessão ativa (<24h desde última msg do usuário)
    body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    };
  }

  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const errMsg = json?.error?.message || JSON.stringify(json) || "wa_send_failed";
    throw new Error(errMsg);
  }
  return json;
}

// Envio imediato (mensagem curta). Assinatura compatível com seu routes:
// notifyWhatsapp(mensagem, telefone?)
export async function notifyWhatsapp(message, to) {
  if (!message || !to) return; // sem telefone = no-op
  const phone = normalizePhone(to);
  if (!phone) return;

  try {
    await sendWhatsApp({ to: phone, message });
  } catch (err) {
    console.error("[notifyWhatsapp] falha ao enviar:", err?.message || err);
    // não propaga para não quebrar o fluxo
  }
}

/* ===================== Scheduler em memória ===================== */
// Bem simples para MVP. Para produção, troque por BullMQ/Redis.
const JOBS = new Map(); // id -> timeout
let COUNTER = 0;

function schedule(fn, whenISO, idHint = "job") {
  const when = new Date(whenISO);
  const delay = Math.max(0, when.getTime() - Date.now());
  const id = `${idHint}:${++COUNTER}:${when.toISOString()}`;
  const to = setTimeout(async () => {
    try { await fn(); }
    finally {
      clearTimeout(to);
      JOBS.delete(id);
    }
  }, delay);
  JOBS.set(id, to);
  return id;
}

/**
 * Agenda um WhatsApp para o futuro.
 * Payload compatível com o front:
 *   { to, scheduledAt, message, metadata?, template? }
 */
export async function scheduleWhatsApp({ to, scheduledAt, message, metadata, template }) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error("invalid_phone");

  const when = new Date(scheduledAt);
  if (isNaN(when.getTime())) throw new Error("invalid_scheduledAt");

  const jobId = schedule(
    () => sendWhatsApp({ to: phone, message, template }),
    when.toISOString(),
    `wa:${metadata?.kind || "generic"}:${phone}`
  );

  return { ok: true, jobId, scheduledAt: when.toISOString() };
}

export function initNotifications() {
  console.log("[notifications] in-memory scheduler pronto");
}

// --- no final do arquivo: backend/src/lib/notifications.js ---

// Envio imediato (usa a mesma lógica interna do módulo)
export async function sendWhatsAppDirect({ to, message, template }) {
  // Reaproveita a função interna que já fala com a Cloud API
  return await sendWhatsApp({ to, message, template });
}
