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
    // Log amigável pra debugar rapidinho
    console.error('[notifyWhatsapp] Graph error:', JSON.stringify(data, null, 2));
    const msg = data?.error?.message || `Graph HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.graph = data?.error;
    throw err;
  }
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
  return postGraph({
    messaging_product: 'whatsapp',
    to: dest,
    type: 'template',
    template: {
      name: name || process.env.WA_TEMPLATE_NAME || 'hello_world',
      language: { code: lang || process.env.WA_TEMPLATE_LANG || 'en_US' },
      ...(components ? { components } : {})
    }
  });
}
