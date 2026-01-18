// backend/src/lib/whatsapp.js
import dotenv from 'dotenv'; dotenv.config();

// Node 18+ já tem fetch global. Se quiser compatibilidade, descomente:
// import fetch from 'node-fetch';

const VERSION = process.env.WA_API_VERSION || 'v23.0';
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID;     // << use WA_* como no seu .env
const TOKEN    = process.env.WA_TOKEN;

if (!PHONE_ID) throw new Error('ENV WA_PHONE_NUMBER_ID ausente');
if (!TOKEN)   throw new Error('ENV WA_TOKEN ausente');

const API_URL = `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`;
const toDigits = (s) => String(s || '').replace(/\D/g, '');

function maskPhone(phone) {
  const digits = toDigits(phone);
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = payload.type || 'unknown';
  if (type === 'template') {
    const tpl = payload.template || {};
    const components = Array.isArray(tpl.components) ? tpl.components : [];
    const templateSummary = {
      name: tpl.name,
      lang: tpl.language?.code,
    };
    if (components.length) {
      templateSummary.components = components.map((comp) => ({
        type: comp?.type,
        params: Array.isArray(comp?.parameters) ? comp.parameters.length : 0,
      }));
    }
    return {
      type,
      template: templateSummary,
    };
  }
  if (type === 'text') {
    const body = payload.text?.body || '';
    return {
      type,
      text: { length: String(body).length },
    };
  }
  return { type };
}

function extractWamid(resp) {
  try {
    const id = resp?.messages?.[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

function isAllowed(to) {
  // Em ambiente de teste, o número de remetente é o +1 555 140 5688 (phone_id do print).
  // Garanta que só enviará para números da allowed list.
  const list = String(process.env.WHATSAPP_ALLOWED_LIST || '')
    .split(',')
    .map(x => toDigits(x))
    .filter(Boolean);
  if (!list.length) return true; // se não configurar, não bloqueia
  return list.includes(to);
}

async function postGraph(payload) {
  console.log('[wa/send]', JSON.stringify({
    type: payload?.type || 'unknown',
    to: maskPhone(payload?.to),
    payload: summarizePayload(payload),
  }));
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error;
    const logData = (error && typeof error === 'object')
      ? {
          message: error.message,
          code: error.code,
          error_data: error.error_data,
          fbtrace_id: error.fbtrace_id,
        }
      : data;
    console.error('[wa/graph/error]', { status: res.status, data: logData });
    const msg = error?.message || `Graph HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    err.graph = error;
    throw err;
  }
  console.log('[wa/send/ok]', JSON.stringify({
    type: payload?.type || 'unknown',
    to: maskPhone(payload?.to),
    wamid: extractWamid(data),
  }));
  return data;
}

export async function waSendText({ to, body }) {
  const dest = toDigits(to || process.env.WHATSAPP_TO);
  if (!dest) throw new Error('Destino (to) ausente');
  if (!isAllowed(dest)) {
    const e = new Error('Número não está na allowed list em modo de teste');
    e.status = 400;
    throw e;
  }
  return postGraph({
    messaging_product: 'whatsapp',
    to: dest,
    type: 'text',
    text: { body: String(body || 'Olá!') }
  });
}

export async function waSendTemplate({ to, name, lang = 'en_US', components }) {
  const dest = toDigits(to || process.env.WHATSAPP_TO);
  if (!dest) throw new Error('Destino (to) ausente');
  if (!isAllowed(dest)) {
    const e = new Error('Número não está na allowed list em modo de teste');
    e.status = 400;
    throw e;
  }
  const template = {
    name: name || process.env.WA_TEMPLATE_NAME || 'hello_world',
    language: { code: lang || process.env.WA_TEMPLATE_LANG || 'en_US' },
  };
  if (Array.isArray(components) && components.length > 0) {
    template.components = components;
  }
  return postGraph({
    messaging_product: 'whatsapp',
    to: dest,
    type: 'template',
    template,
  });
}
