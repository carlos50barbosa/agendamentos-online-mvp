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
    const text = (msg?.text?.body || '').trim();
    if (!from) return res.sendStatus(200);

    let s = await getSession(from);

    // Confirmacao de lembrete (botao "CONFIRMAR") usando context.id do template
    const interactive = msg?.interactive?.button_reply || null;
    const buttonPayload = msg?.button?.payload || interactive?.id || null;
    const contextMsgId = msg?.context?.id || null;
    if (buttonPayload || contextMsgId) {
      const recorded = await tryRecordReminderConfirmation({ contextMessageId: contextMsgId, fromDigits: from });
      if (recorded) {
        await send(from, 'Confirmado! Vamos te aguardar no horário combinado.');
        return res.sendStatus(200);
      }
    }

    // Resposta fixa (bot desativado)
    const autoReply = 'Ol?! Aqui ? o assistente do Agendamentos Online. Para marcar, reagendar ou cancelar, use nosso site. Se tiver qualquer d?vida, acesse https://agendamentosonline.com/ajuda. Obrigado!';
    await send(from, autoReply);
    s.step = 'MENU';
    await setSession(from, s);
    return res.sendStatus(200);

    // Fluxo simples tipo menu → coleta
    if (s.step === 'WELCOME') {
      await send(from, welcomeText());
      s.step = 'MENU';
      await setSession(from, s);
      return res.sendStatus(200);
    }

    if (s.step === 'MENU') {
      if (text === '1') {
        // novo agendamento
        const ests = await listEstablishments();
        if (!ests.length) { await send(from, 'Sem estabelecimentos no momento.'); return res.sendStatus(200); }
        s.data.ests = ests;
        s.step = 'ASK_ESTAB';
        await setSession(from, s);
        const lines = ['Escolha o estabelecimento (envie o número):'];
        ests.slice(0, 9).forEach((e, i) => lines.push(`${i+1}) ${e.nome}`));
        await send(from, lines.join('\n'));
        return res.sendStatus(200);
      }
      if (text === '2') {
        // lista meus agendamentos (por telefone do cliente)
        const [rows] = await pool.query(
          `SELECT a.id, a.inicio, s.nome AS servico, u.nome AS estabelecimento
           FROM agendamentos a
           JOIN servicos s ON s.id=a.servico_id
           JOIN usuarios u ON u.id=a.estabelecimento_id
           JOIN usuarios c ON c.id=a.cliente_id
           WHERE REPLACE(REPLACE(REPLACE(c.telefone,'+',''),'-',''),' ','') = ?
           ORDER BY a.inicio DESC LIMIT 5`,
          [from]
        );
        if (!rows.length) { await send(from, 'Você não tem agendamentos recentes.'); return res.sendStatus(200); }
        const lines = ['Seus últimos agendamentos:'];
        rows.forEach(a => {
          const dt = new Date(a.inicio).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
          lines.push(`#${a.id} — ${a.servico} em ${a.estabelecimento} — ${dt}`);
        });
        lines.push('\nEnvie: CANCELAR #ID ou REMARCAR #ID');
        await send(from, lines.join('\n'));
        s.step = 'MENU';
        await setSession(from, s);
        return res.sendStatus(200);
      }
      if (text === '3') {
        await send(from, 'Envie 1 para novo agendamento, 2 para listar seus agendamentos.');
        s.step = 'MENU';
        return res.sendStatus(200);
      }
      await send(from, 'Opção inválida. ' + welcomeText());
      return res.sendStatus(200);
    }

    if (s.step === 'ASK_ESTAB') {
      const n = Number(text);
      const idx = Number.isFinite(n) ? n - 1 : -1;
      const est = s.data.ests?.[idx];
      if (!est) { await send(from, 'Escolha inválida. Envie um número da lista.'); return res.sendStatus(200); }
      s.data.est = est;
      // serviços
      const svcs = await listServices(est.id);
      if (!svcs.length) { await send(from, 'Este estabelecimento não tem serviços disponíveis. Digite 1 para voltar ao menu.'); s.step='MENU'; return res.sendStatus(200); }
      s.data.svcs = svcs;
      s.step = 'ASK_SERVICE';
      await setSession(from, s);
      const lines = ['Escolha o serviço (número):'];
      svcs.slice(0, 9).forEach((sv, i) => lines.push(`${i+1}) ${sv.nome}`));
      await send(from, lines.join('\n'));
      return res.sendStatus(200);
    }

    if (s.step === 'ASK_SERVICE') {
      const n = Number(text);
      const idx = Number.isFinite(n) ? n - 1 : -1;
      const sv = s.data.svcs?.[idx];
      if (!sv) { await send(from, 'Escolha inválida. Envie um número da lista.'); return res.sendStatus(200); }
      s.data.sv = sv;
      s.step = 'ASK_DATE';
      await setSession(from, s);
      await send(from, 'Informe a data (ex.: hoje, amanhã, 2025-09-30 ou 30/09)');
      return res.sendStatus(200);
    }

    if (s.step === 'ASK_DATE') {
      const d = parseDate(text);
      if (!d || Number.isNaN(+d)) { await send(from, 'Data inválida. Tente: hoje, amanhã, YYYY-MM-DD ou DD/MM'); return res.sendStatus(200); }
      s.data.date = d;
      const slots = await listFreeSlots(s.data.est.id, d);
      if (!slots.length) { await send(from, 'Sem horários livres nesta data. Informe outra data.'); return res.sendStatus(200); }
      s.data.slots = slots;
      s.step = 'ASK_TIME';
      await setSession(from, s);
      const lines = ['Escolha o horário (número):'];
      slots.slice(0, 9).forEach((sl, i) => lines.push(`${i+1}) ${sl.label}`));
      await send(from, lines.join('\n'));
      return res.sendStatus(200);
    }

    if (s.step === 'ASK_TIME') {
      const n = Number(text);
      const idx = Number.isFinite(n) ? n - 1 : -1;
      const sl = s.data.slots?.[idx];
      if (!sl) { await send(from, 'Escolha inválida. Envie um número da lista.'); return res.sendStatus(200); }
      s.data.slot = sl;
      s.step = 'CONFIRM';
      await setSession(from, s);
      const dt = new Date(sl.iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      await send(from, `Confirmar ${s.data.sv.nome} em ${s.data.est.nome} — ${dt}?\nResponda SIM ou NAO`);
      return res.sendStatus(200);
    }

    if (s.step === 'CONFIRM') {
      const yes = /^s(im)?$/i.test(text);
      if (!yes) { await send(from, 'Cancelado. Envie 1 para iniciar novamente.'); s.step='MENU'; await setSession(from, s); return res.sendStatus(200); }
      // Precisamos vincular telefone ao cliente no sistema; aqui buscamos usuário pelo telefone
      const [[cli]] = await pool.query("SELECT id FROM usuarios WHERE tipo='cliente' AND REPLACE(REPLACE(REPLACE(telefone,'+',''),'-',''),' ','')=?", [from]);
      if (!cli) {
        // Gera link mágico para vincular telefone após login no site
        const token = crypto.randomBytes(20).toString('hex');
        try {
          const { createLinkToken } = await import('../lib/wa_store.js');
          await createLinkToken(from, token);
        } catch (e) { console.warn('[wa/link] falhou criar token', e?.message || e); }
        const base = (process.env.APP_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:3001').replace(/\/$/,'');
        const link = `${base}/link-phone?token=${encodeURIComponent(token)}`;
        await send(from, `Para concluir, acesse: ${link} e faça login. Isso associará seu WhatsApp à sua conta.`);
        s.step='MENU';
        await setSession(from, s);
        return res.sendStatus(200);
      }

      // calcula fim com base na duração do serviço
      const start = new Date(s.data.slot.iso);
      const fim   = new Date(start.getTime() + (Number(s.data.sv.duracao_min||30) * 60000));

      try {
        // checagem simples de conflito na hora de salvar
        const [conf] = await pool.query(
          `SELECT id FROM agendamentos WHERE estabelecimento_id=? AND status IN ('confirmado','pendente') AND (inicio < ? AND fim > ?)`,
          [s.data.est.id, fim, start]
        );
        if (conf.length) { await send(from, 'Ih! O horário acabou de ficar indisponível. Tente outro.'); s.step='ASK_TIME'; return res.sendStatus(200); }
        const [r] = await pool.query(
          `INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status) VALUES (?,?,?,?,?,'confirmado')`,
          [cli.id, s.data.est.id, s.data.sv.id, start, fim]
        );
        await send(from, `Agendado com sucesso! Número ${r.insertId}.`);
      } catch (e) {
        console.error('[wa/webhook][confirm] erro', e);
        await send(from, 'Falha ao salvar seu agendamento. Tente novamente.');
      }
      s.step='MENU';
      await setSession(from, s);
      return res.sendStatus(200);
    }

    // Comandos curtos no menu para cancelar/remarcar
    if (/^cancelar\s*#?\d+$/i.test(text)) {
      const id = Number(text.replace(/\D+/g,'').trim());
      try {
        const [[cli]] = await pool.query("SELECT id FROM usuarios WHERE tipo='cliente' AND REPLACE(REPLACE(REPLACE(telefone,'+',''),'-',''),' ','')=?", [from]);
        if (!cli) { await send(from, 'Não identifiquei seu cadastro.'); return res.sendStatus(200); }
        const [r] = await pool.query(`UPDATE agendamentos SET status='cancelado' WHERE id=? AND cliente_id=?`, [id, cli.id]);
        if (!r.affectedRows) { await send(from, 'Não encontrei esse agendamento para você.'); return res.sendStatus(200); }
        await send(from, `Agendamento #${id} cancelado.`);
      } catch (e) {
        await send(from, 'Não foi possível cancelar agora.');
      }
      return res.sendStatus(200);
    }

    if (/^remarcar\s*#?\d+$/i.test(text)) {
      await send(from, 'Remarcação: envie 1 para iniciar um novo fluxo e depois cancele o antigo com CANCELAR #ID.');
      return res.sendStatus(200);
    }

    // fallback
    await send(from, 'Não entendi. ' + welcomeText());
    return res.sendStatus(200);
  } catch (e) {
    console.error('[wa/webhook] erro geral', e);
    return res.sendStatus(200);
  }
});

export default router;
