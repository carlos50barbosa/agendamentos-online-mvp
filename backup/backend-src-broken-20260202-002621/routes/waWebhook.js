import { Router } from 'express';
import { initWhatsAppContacts, recordWhatsAppInbound } from '../lib/whatsapp_contacts.js';
import { decryptAccessToken } from '../services/waCrypto.js';
import { sendWhatsAppMessage, extractWamid } from '../services/waGraph.js';
import { getWaAccountByPhoneNumberId, recordWaMessage } from '../services/waTenant.js';

/*
Webhook examples (payload minimo):
1) Messages
{
  "entry":[{"changes":[{"value":{
    "metadata":{"phone_number_id":"123"},
    "contacts":[{"wa_id":"5511999999999","profile":{"name":"Ana"}}],
    "messages":[{"from":"5511999999999","id":"wamid.X","timestamp":"1700000000","type":"text","text":{"body":"Oi"}}]
  }}]}]
}
2) Statuses
{
  "entry":[{"changes":[{"value":{
    "metadata":{"phone_number_id":"123"},
    "statuses":[{"id":"wamid.X","status":"delivered","timestamp":"1700000001","recipient_id":"5511999999999"}]
  }}]}]
}
*/

const router = Router();
const AUTO_REPLY = 'Olá! Digite 1 para agendar, 2 para preços.';
initWhatsAppContacts().catch(() => {});
function pickPhoneNumberId(value) {
return value?.metadata?.phone_number_id || value?.phone_number_id || null;
}

function toDigits(value) {
return String(value || '').replace(/\D/g, '');
}

router.get('/', (req, res) => {
const mode = req.query['hub.mode'];
const token = req.query['hub.verify_token'];
const challenge = req.query['hub.challenge'];
if (mode === 'subscribe' && challenge) {
if (!process.env.WA_VERIFY_TOKEN || token === process.env.WA_VERIFY_TOKEN) {
return res.status(200).send(challenge);
}
    return res.status(403).send('Forbidden');
}
  return res.status(404).end();
});
router.post('/', async (req, res) => {
try {
const entry = req.body?.entry?.[0];
const changes = entry?.changes?.[0];
const value = changes?.value || {};
const phoneNumberId = pickPhoneNumberId(value);
if (!phoneNumberId) return res.sendStatus(200);
const account = await getWaAccountByPhoneNumberId(phoneNumberId);
if (!account || account.status !== 'connected') return res.sendStatus(200);
const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
for (const status of statuses) {
await recordWaMessage({
estabelecimentoId: account.estabelecimento_id, direction: 'out', waId: status?.recipient_id || null, wamid: status?.id || null, phoneNumberId, payload: { status, metadata: value?.metadata || null }, status: status?.status || null, });
} const messages = Array.isArray(value?.messages) || value.messages : [];
if (!messages.length) return res.sendStatus(200);
const firstMsg = messages[0];
const from = firstMsg?.from || value?.contacts?.[0]?.wa_id || null;
const fromDigits = toDigits(from);
for (const msg of messages) {
await recordWaMessage({
estabelecimentoId: account.estabelecimento_id, direction: 'in', waId: msg?.from || null, wamid: msg?.id || null, phoneNumberId, payload: msg, status: null, });
}

    if (fromDigits) {
recordWhatsAppInbound({ recipientId: fromDigits }).catch((err) => console.warn('[wa/webhook][inbound] failed to record', err?.message || err) );
}

    if (!fromDigits) return res.sendStatus(200);
const token = account.access_token_enc ? decryptAccessToken(account.access_token_enc) : null;
if (!token) return res.sendStatus(200);
const payload = {
messaging_product: 'whatsapp', to: fromDigits, type: 'text', text: { preview_url: false, body: AUTO_REPLY }, };
try {
const resp = await sendWhatsAppMessage({
accessToken: token, phoneNumberId, payload, });
await recordWaMessage({
estabelecimentoId: account.estabelecimento_id, direction: 'out', waId: fromDigits, wamid: extractWamid(resp), phoneNumberId, payload, status: 'sent', });
} catch (err) {
console.warn('[wa/webhook][reply]', err?.message || err);
}

    return res.sendStatus(200);
} catch (err) {
console.error('[wa/webhook]', err?.message || err);
return res.sendStatus(200);
}
});
export default router;



