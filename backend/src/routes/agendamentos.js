// backend/src/routes/agendamentos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isCliente, isEstabelecimento } from '../middleware/auth.js';
import { notifyEmail, notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';

const router = Router();

const TZ = 'America/Sao_Paulo';
const toDigits = (s) => String(s || '').replace(/\D/g, ''); // normaliza telefone

/** Horário comercial: 07:00 (inclusive) até 22:00 (inclusive somente 22:00 em ponto) */
function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  // Usamos hora/min local do servidor; ideal seria normalizar para TZ do estabelecimento
  const h = d.getHours(), m = d.getMinutes();
  const afterStart = h > 7 || (h === 7 && m >= 0);
  const beforeEnd  = h < 22 || (h === 22 && m === 0);
  return afterStart && beforeEnd;
}

function brDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: TZ
  });
}
function brDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });
}
function brTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

// Lista meus agendamentos (cliente)
router.get('/', auth, isCliente, async (req, res) => {
  const clienteId = req.user.id;
  const [rows] = await pool.query(`
    SELECT a.*, s.nome AS servico_nome, u.nome AS estabelecimento_nome
    FROM agendamentos a
    JOIN servicos s ON s.id=a.servico_id
    JOIN usuarios u ON u.id=a.estabelecimento_id
    WHERE a.cliente_id=?
    ORDER BY a.inicio DESC
  `, [clienteId]);
  res.json(rows);
});

// Lista agendamentos do estabelecimento (somente confirmados)
router.get('/estabelecimento', auth, isEstabelecimento, async (req, res) => {
  const estId = req.user.id;
  const [rows] = await pool.query(`
    SELECT a.*, s.nome AS servico_nome, u.nome AS cliente_nome
    FROM agendamentos a
    JOIN servicos s ON s.id=a.servico_id
    JOIN usuarios u ON u.id=a.cliente_id
    WHERE a.estabelecimento_id=? AND a.status='confirmado'
    ORDER BY a.inicio DESC
  `, [estId]);
  res.json(rows);
});

// Criar agendamento (cliente)
router.post('/', auth, isCliente, async (req, res) => {
  let conn;
  try {
    const { estabelecimento_id, servico_id, inicio } = req.body;
    if (!estabelecimento_id || !servico_id || !inicio) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Campos obrigatórios: estabelecimento_id, servico_id, inicio (ISO).' });
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) {
      return res.status(400).json({ error: 'invalid_date', message: 'Formato de data/hora inválido.' });
    }
    if (inicioDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'past_datetime', message: 'Não é possível agendar no passado.' });
    }

    // Regra de horário comercial
    if (!inBusinessHours(inicioDate.toISOString())) {
      return res.status(400).json({ error: 'outside_business_hours', message: 'Horário fora do expediente (07:00–22:00).' });
    }

    // Dados do serviço (valida vínculo com o estabelecimento)
    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) return res.status(400).json({ error: 'servico_invalido', message: 'Serviço inválido ou inativo para este estabelecimento.' });

    const fimDate = new Date(inicioDate.getTime() + svc.duracao_min * 60_000);

    // ==== Concurrency-safe: transação + lock otimista nos conflitos ====
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // checa sobreposição: padrão universal => a.inicio < novoFim AND a.fim > novoInicio
    const [conf] = await conn.query(`
      SELECT id FROM agendamentos
      WHERE estabelecimento_id = ? AND status = 'confirmado'
        AND (inicio < ? AND fim > ?)
      FOR UPDATE
    `, [estabelecimento_id, fimDate, inicioDate]);

    if (conf.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'slot_ocupado', message: 'Horário indisponível.' });
    }

    // insere
    const [r] = await conn.query(`
      INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status)
      VALUES (?,?,?,?,?,'confirmado')
    `, [req.user.id, estabelecimento_id, servico_id, inicioDate, fimDate]);

    // carrega registro e contatos ainda dentro da transação (consistente)
    const [[novo]] = await conn.query('SELECT * FROM agendamentos WHERE id=?', [r.insertId]);
    const [[cli]]  = await conn.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]]  = await conn.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [estabelecimento_id]);

    await conn.commit();
    conn.release(); conn = null;

    // ===== Notificações imediatas (não bloqueiam a resposta) =====
    const inicioISO = new Date(novo.inicio).toISOString(); // garante ISO
    const inicioBR  = brDateTime(inicioISO);

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone); // ⚠️ usa o telefone do estabelecimento SEM fallback para o do cliente

    // Cliente
    notifyEmail(
      cli?.email,
      'Agendamento confirmado',
      `<p>Olá, <b>${cli?.nome ?? 'cliente'}</b>! Seu agendamento de <b>${svc.nome}</b> foi confirmado para <b>${inicioBR}</b>.</p>`
    ).catch(() => {});
    if (telCli) {
      notifyWhatsapp(`✅ Confirmação de agendamento: ${svc.nome} em ${inicioBR}`, telCli).catch(() => {});
    }

    // Estabelecimento
    notifyEmail(
      est?.email,
      'Novo agendamento recebido',
      `<p>Você recebeu um novo agendamento de <b>${svc.nome}</b> em <b>${inicioBR}</b> para o cliente <b>${cli?.nome ?? ''}</b>.</p>`
    ).catch(() => {});
    // Só envia WhatsApp ao estabelecimento se houver telefone E for diferente do do cliente
    if (telEst && telEst !== telCli) {
      notifyWhatsapp(`📅 Novo agendamento: ${svc.nome} em ${inicioBR} — Cliente: ${cli?.nome ?? ''}`, telEst).catch(() => {});
    }

    // ===== Lembretes agendados (WhatsApp) =====
    const now = Date.now();
    const t1  = new Date(inicioDate.getTime() - 24 * 60 * 60 * 1000); // -24h
    const t2  = new Date(inicioDate.getTime() - 15 * 60 * 1000);      // -15m

    const hora    = brTime(inicioISO);
    const data    = brDate(inicioISO);
    const estNome = est?.nome ?? 'nosso estabelecimento';

    // Cliente
    const msg1Cli = `🔔 Lembrete: amanhã às ${hora} você tem ${svc.nome} em ${estNome}.`;
    const msg2Cli = `⏰ Faltam 15 minutos para o seu ${svc.nome} em ${estNome} (${hora} de ${data}).`;

    if (telCli) {
      if (t1.getTime() > now) {
        scheduleWhatsApp({
          to: telCli,
          scheduledAt: t1.toISOString(),
          message: msg1Cli,
          metadata: {
            role: 'cliente',
            kind: 'reminder_1d',
            appointment_id: novo.id,
            estabelecimento_id,
            servico_id,
            inicio: inicioISO,
            clientPhone: telCli,
            ownerPhone: telEst || null
          }
        }).catch(() => {});
      }
      if (t2.getTime() > now) {
        scheduleWhatsApp({
          to: telCli,
          scheduledAt: t2.toISOString(),
          message: msg2Cli,
          metadata: {
            role: 'cliente',
            kind: 'reminder_15m',
            appointment_id: novo.id,
            estabelecimento_id,
            servico_id,
            inicio: inicioISO,
            clientPhone: telCli,
            ownerPhone: telEst || null
          }
        }).catch(() => {});
      }
    }

    // Estabelecimento — SOMENTE se telefone diferente do cliente
    // (evita duplicidade quando, em testes, ambos usam o mesmo número)
    if (telEst && telEst !== telCli) {
      const msg2Est = `⏰ Faltam 15 minutos para o seu ${svc.nome} em seu estabelecimento (${hora} de ${data}).`;
      if (t2.getTime() > now) {
        scheduleWhatsApp({
          to: telEst,
          scheduledAt: t2.toISOString(),
          message: msg2Est,
          metadata: {
            role: 'dono',
            kind: 'reminder_15m',
            appointment_id: novo.id,
            estabelecimento_id,
            servico_id,
            inicio: inicioISO,
            clientPhone: telCli,
            ownerPhone: telEst
          }
        }).catch(() => {});
      }
    }

    // Log útil para auditoria/debug
    console.log('[agendamentos] agendado id=%s telCli=%s telEst=%s', novo.id, telCli || '-', telEst || '-');

    return res.json(novo);

  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
    if (conn) { conn.release(); }
    console.error('[agendamentos/create]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Cancelar (cliente)
router.put('/:id/cancel', auth, isCliente, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'UPDATE agendamentos SET status="cancelado" WHERE id=? AND cliente_id=?',
      [id, req.user.id]
    );
    if (!rows.affectedRows) return res.status(404).json({ error: 'not_found', message: 'Agendamento não encontrado.' });

    // contatos para notificar (opcional)
    const [[a]]   = await pool.query('SELECT estabelecimento_id, servico_id, inicio FROM agendamentos WHERE id=?', [id]);
    const [[svc]] = await pool.query('SELECT nome FROM servicos WHERE id=?', [a?.servico_id || 0]);
    const [[cli]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [a?.estabelecimento_id || 0]);

    const inicioBR = a?.inicio ? brDateTime(new Date(a.inicio).toISOString()) : '';

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);

    if (telCli) {
      notifyWhatsapp(`❌ Seu agendamento ${id} (${svc?.nome ?? 'serviço'}) em ${inicioBR} foi cancelado.`, telCli).catch(() => {});
    }
    if (telEst && telEst !== telCli) {
      notifyWhatsapp(`❌ Cancelamento: agendamento ${id} (${svc?.nome ?? 'serviço'}) em ${inicioBR} pelo cliente ${cli?.nome ?? ''}.`, telEst).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[agendamentos/cancel]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
