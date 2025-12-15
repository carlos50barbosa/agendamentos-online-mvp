// backend/src/routes/whatsapp_webhook.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { notifyWhatsapp } from '../lib/notifications.js';
import { initWAStore, getSession as dbGet, setSession as dbSet } from '../lib/wa_store.js';
import crypto from 'crypto';

const router = Router();

// Inicializa tabelas de sessão/links
initWAStore().catch(() => {});

const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
const INTERVAL_MIN = 30;

const toDigits = (s) => String(s || '').replace(/\D/g, '');

function parseDate(str) {
  // aceita YYYY-MM-DD ou DD/MM
  const s = String(str || '').trim();
  const today = new Date();
  const lower = s.toLowerCase();
  if (lower === 'hoje') {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (lower === 'amanha' || lower === 'amanhã') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const y = today.getFullYear();
    return new Date(y, mm - 1, dd);
  }
  return null;
}

function fmtHour(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function toISO(d) {
  return new Date(d).toISOString();
}

async function listEstablishments() {
  const [rows] = await pool.query(
    "SELECT id, nome FROM usuarios WHERE tipo='estabelecimento' ORDER BY nome"
  );
  return rows || [];
}

async function listServices(estabId) {
  const [rows] = await pool.query(
    `SELECT id, nome, duracao_min FROM servicos
     WHERE estabelecimento_id=? AND (ativo IS NULL OR ativo=1)
     ORDER BY nome`,
    [estabId]
  );
  return rows || [];
}

async function listFreeSlots(estabId, dateObj) {
  const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0);
  const dayEnd   = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 23, 59, 59);

  const [ags] = await pool.query(
    `SELECT inicio, fim FROM agendamentos
     WHERE estabelecimento_id=? AND status IN ('confirmado','pendente')
       AND (inicio BETWEEN ? AND ? OR fim BETWEEN ? AND ?)`,
    [estabId, dayStart, dayEnd, dayStart, dayEnd]
  );
  const [blq] = await pool.query(
    `SELECT inicio, fim FROM bloqueios
     WHERE estabelecimento_id=? AND (inicio BETWEEN ? AND ? OR fim BETWEEN ? AND ?)`,
    [estabId, dayStart, dayEnd, dayStart, dayEnd]
  );

  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    for (let m = 0; m < 60; m += INTERVAL_MIN) {
      const s = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), h, m, 0);
      const e = new Date(s.getTime() + INTERVAL_MIN * 60000);
      const ocupado = ags.some(a => new Date(a.inicio) < e && new Date(a.fim) > s);
      const bloqueado = blq.some(b => new Date(b.inicio) < e && new Date(b.fim) > s);
      if (!ocupado && !bloqueado) slots.push({ iso: toISO(s), label: fmtHour(s) });
    }
  }
  return slots;
}

async function send(to, text) {
  try { await notifyWhatsapp(String(text || ''), to); } catch (e) { console.warn('[wa/out]', e?.message || e); }
}

function welcomeText() {
  return [
    'Olá! Eu sou seu assistente de agendamentos.',
    'Envie um número para escolher:',
    '1) Marcar novo horário',
    '2) Meus agendamentos',
    '3) Ajuda',
  ].join('\n');
}

async function getSession(phone) {
  const s = (await dbGet(phone)) || { step: 'WELCOME', data: {} };
  return s;
}
async function setSession(phone, state) { await dbSet(phone, state); }

async function tryRecordReminderConfirmation({ contextMessageId, fromDigits }) {
  if (!contextMessageId) return false;
  try {
    const [[row]] = await pool.query(
      `SELECT a.id, a.cliente_id, u.telefone
       FROM agendamentos a
       JOIN usuarios u ON u.id = a.cliente_id
       WHERE a.reminder_8h_msg_id=? LIMIT 1`,
      [contextMessageId]
    );
    if (!row) return false;
    const tel = toDigits(row.telefone);
    if (tel && tel !== fromDigits) return false;

    await pool.query(
      'UPDATE agendamentos SET cliente_confirmou_whatsapp_at = COALESCE(cliente_confirmou_whatsapp_at, NOW()) WHERE id=? LIMIT 1',
      [row.id]
    );
    return true;
  } catch (e) {
    console.warn('[wa/confirm-btn] erro ao registrar confirmacao', e?.message || e);
    return false;
  }
}

// GET: verificação do webhook do Facebook
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && challenge) {
    if (!process.env.WA_VERIFY_TOKEN || token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  return res.status(404).end();
});

// POST: eventos de mensagens

router.post('/', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const statuses = value?.statuses;
    if (Array.isArray(statuses) && statuses.length) {
      console.log('[wa/webhook/status]', JSON.stringify(statuses));
      return res.sendStatus(200);
    }
    const msgs = value?.messages;
    if (!msgs || !msgs.length) return res.sendStatus(200);

    const msg = msgs[0];
    const from = toDigits(msg?.from);
    if (!from) return res.sendStatus(200);

    // Confirmacao de lembrete (botao "CONFIRMAR") usando context.id do template
    const interactive = msg?.interactive?.button_reply || null;
    const buttonPayload = msg?.button?.payload || interactive?.id || null;
    const contextMsgId = msg?.context?.id || null;
    if (buttonPayload || contextMsgId) {
      const recorded = await tryRecordReminderConfirmation({ contextMessageId: contextMsgId, fromDigits: from });
      if (recorded) {
        await send(from, 'Confirmado! Vamos te aguardar no horario combinado.');
        return res.sendStatus(200);
      }
    }

    // Resposta fixa (menu desativado)
    const autoReply = 'Olá! Aqui é o assistênte do Agendamentos Online. Para marcar, reagendar ou cancelar, use nosso site. Se tiver qualquer dúvida, acesse https://agendamentosonline.com/ajuda. Obrigado!';
    await send(from, autoReply);
    return res.sendStatus(200);
  } catch (e) {
    console.error('[wa/webhook] erro geral', e);
    return res.sendStatus(200);
  }
});

export default router;
