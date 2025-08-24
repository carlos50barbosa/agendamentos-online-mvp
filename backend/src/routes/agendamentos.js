import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isCliente, isEstabelecimento } from '../middleware/auth.js';
import { notifyEmail, notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';

const router = Router();

/** Horário comercial: 07:00 (inclusive) até 22:00 (inclusive somente 22:00 em ponto) */
function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  const h = d.getHours(), m = d.getMinutes();
  const afterStart = h > 7 || (h === 7 && m >= 0);
  const beforeEnd  = h < 22 || (h === 22 && m === 0);
  return afterStart && beforeEnd;
}

function brDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function brDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}
function brTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
    ORDER BY a.inicio DESC`, [clienteId]);
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
    ORDER BY a.inicio DESC`, [estId]);
  res.json(rows);
});

// Criar agendamento (cliente)
router.post('/', auth, isCliente, async (req, res) => {
  try {
    const { estabelecimento_id, servico_id, inicio } = req.body;
    if (!estabelecimento_id || !servico_id || !inicio) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    // Regra de horário comercial
    if (!inBusinessHours(inicio)) {
      return res.status(400).json({ error: 'outside_business_hours' });
    }

    // Calcula fim com base na duração do serviço
    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) return res.status(400).json({ error: 'servico_invalido' });

    const inicioDate = new Date(inicio);
    const fim = new Date(inicioDate.getTime() + svc.duracao_min * 60000);

    // Verifica conflito (janela sobreposta)
    const [conf] = await pool.query(`
      SELECT id FROM agendamentos 
      WHERE estabelecimento_id=? AND status='confirmado'
      AND ((inicio < ? AND fim > ?) OR (inicio >= ? AND inicio < ?))`,
      [estabelecimento_id, fim, inicioDate, inicioDate, fim]
    );
    if (conf.length) return res.status(409).json({ error: 'slot_ocupado' });

    // Insere
    const [r] = await pool.query(`
      INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status)
      VALUES (?,?,?,?,?,'confirmado')`,
      [req.user.id, estabelecimento_id, servico_id, inicioDate, fim]
    );
    const [novo] = await pool.query('SELECT * FROM agendamentos WHERE id=?', [r.insertId]);

    // carrega contatos
    const [[cli]] = await pool.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]] = await pool.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [estabelecimento_id]);

    const inicioBR = brDateTime(inicioDate.toISOString());

    // ===== Notificações imediatas =====
    // Cliente (e-mail + WhatsApp)
    notifyEmail(
      cli?.email,
      'Agendamento confirmado',
      `<p>Seu agendamento foi confirmado para <b>${inicioBR}</b> (serviço: <b>${svc.nome}</b>).</p>`
    ).catch(() => {});
    notifyWhatsapp(
      `✅ Confirmação de agendamento: ${svc.nome} em ${inicioBR}`,
      cli?.telefone
    ).catch(() => {});

    // Estabelecimento (e-mail + WhatsApp)
    notifyEmail(
      est?.email,
      'Novo agendamento recebido',
      `<p>Você recebeu um novo agendamento (<b>${svc.nome}</b>) em <b>${inicioBR}</b> para o cliente ${cli?.nome ?? ''}.</p>`
    ).catch(() => {});
    notifyWhatsapp(
      `📅 Novo agendamento: ${svc.nome} em ${inicioBR}`,
      est?.telefone
    ).catch(() => {});

    // ===== Lembretes agendados (WhatsApp) - Cliente =====
    // 1 dia antes e 15 minutos antes (apenas se ainda não passou)
    const now = Date.now();
    const t1 = new Date(inicioDate.getTime() - 24 * 60 * 60 * 1000); // -24h
    const t2 = new Date(inicioDate.getTime() - 15 * 60 * 1000);      // -15m

    const hora = brTime(inicioDate.toISOString());
    const data = brDate(inicioDate.toISOString());

    const msg1 = `🔔 Lembrete: amanhã às ${hora} você tem ${svc.nome} em ${est?.nome ?? 'nosso estabelecimento'}.`;
    const msg2 = `⏰ Faltam 15 minutos para o seu ${svc.nome} em ${est?.nome ?? 'nosso estabelecimento'} (${hora} de ${data}).`;

    if (cli?.telefone) {
      if (t1.getTime() > now) {
        scheduleWhatsApp({
          to: cli.telefone,
          scheduledAt: t1.toISOString(),
          message: msg1,
          metadata: { kind: 'reminder_1d', appointment_id: r.insertId, estabelecimento_id, servico_id, inicio: inicioDate.toISOString() }
        }).catch(() => {});
      }
      if (t2.getTime() > now) {
        scheduleWhatsApp({
          to: cli.telefone,
          scheduledAt: t2.toISOString(),
          message: msg2,
          metadata: { kind: 'reminder_15m', appointment_id: r.insertId, estabelecimento_id, servico_id, inicio: inicioDate.toISOString() }
        }).catch(() => {});
      }
    }

    res.json(novo[0]);
  } catch (e) {
    console.error(e);
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
    if (!rows.affectedRows) return res.status(404).json({ error: 'not_found' });

    // Notificação simples (você pode evoluir para notificar o estabelecimento também)
    notifyWhatsapp(`❌ Agendamento ${id} cancelado pelo cliente.`).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
