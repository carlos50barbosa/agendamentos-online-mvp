// backend/src/routes/agendamentos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import { auth as authRequired, isCliente, isEstabelecimento } from '../middleware/auth.js';
import { notifyEmail, notifyWhatsapp, scheduleWhatsApp, sendTemplate } from '../lib/notifications.js';

const router = Router();

const TZ = 'America/Sao_Paulo';
const toDigits = (s) => String(s || '').replace(/\D/g, ''); // normaliza telefone para apenas digitos

/** Horario comercial: 07:00 (inclusive) ate 22:00 (inclusive somente 22:00 em ponto) */
function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  // Observacao: usa timezone do servidor. Ideal seria usar TZ do estabelecimento.
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

// Utilitario: dispara funcao async em background sem nunca derrubar a rota
function fireAndForget(fn) {
  try {
    const p = Promise.resolve().then(fn);
    p.catch((e) => console.warn('[notify] erro (async):', e?.message || e));
  } catch (e) {
    console.warn('[notify] erro (sync):', e?.message || e);
  }
}

/* =================== Listagens =================== */

// Lista meus agendamentos (cliente)
router.get('/', authRequired, isCliente, async (req, res) => {
  const clienteId = req.user.id;
  const [rows] = await pool.query(`
    SELECT a.*, s.nome AS servico_nome, u.nome AS estabelecimento_nome
    FROM agendamentos a
    JOIN servicos s   ON s.id=a.servico_id
    JOIN usuarios u   ON u.id=a.estabelecimento_id
    WHERE a.cliente_id=?
    ORDER BY a.inicio DESC
  `, [clienteId]);
  res.json(rows);
});

// Lista agendamentos do estabelecimento (somente confirmados/pendentes)
router.get('/estabelecimento', authRequired, isEstabelecimento, async (req, res) => {
  const estId = req.user.id;
  const status = String(req.query?.status || '').toLowerCase();

  // Mapeia filtros: por padrao mantem confirmados+pendentes (comportamento atual)
  // status=todos -> todos; status=confirmado|cancelado|pendente -> somente aquele
  let where = 'a.estabelecimento_id=? AND a.status IN (\'confirmado\',\'pendente\')';
  const params = [estId];
  if (status === 'todos') {
    where = 'a.estabelecimento_id=?';
  } else if (['confirmado', 'cancelado', 'pendente'].includes(status)) {
    where = 'a.estabelecimento_id=? AND a.status=?';
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT a.*, s.nome AS servico_nome, u.nome AS cliente_nome
     FROM agendamentos a
     JOIN servicos s ON s.id=a.servico_id
     JOIN usuarios u ON u.id=a.cliente_id
     WHERE ${where}
     ORDER BY a.inicio DESC`,
    params
  );
  res.json(rows);
});

/* =================== Criacao =================== */

// Criar agendamento (cliente)
router.post('/', authRequired, isCliente, async (req, res) => {
  let conn;
  try {
    const { estabelecimento_id, servico_id, inicio } = req.body;

    // 1) validacao basica
    if (!estabelecimento_id || !servico_id || !inicio) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Campos obrigatorios: estabelecimento_id, servico_id, inicio (ISO).'
      });
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) {
      return res.status(400).json({ error: 'invalid_date', message: 'Formato de data/hora invalido.' });
    }
    if (inicioDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'past_datetime', message: 'Nao e possivel agendar no passado.' });
    }
    if (!inBusinessHours(inicioDate.toISOString())) {
      return res.status(400).json({ error: 'outside_business_hours', message: 'Horario fora do expediente (07:00-22:00).' });
    }

    // 2) valida servico e vinculo com estabelecimento
    const planContext = await getPlanContext(estabelecimento_id);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    if (isDelinquentStatus(planContext.status)) {
      return res.status(403).json({ error: 'plan_delinquent', message: 'Este estabelecimento esta com o plano em atraso. Agendamentos temporariamente suspensos.' });
    }

    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) {
      return res.status(400).json({ error: 'servico_invalido', message: 'Servico invalido ou inativo para este estabelecimento.' });
    }
    const dur = Number(svc.duracao_min || 0);
    if (!Number.isFinite(dur) || dur <= 0) {
      return res.status(400).json({ error: 'duracao_invalida', message: 'Duracao do servico invalida.' });
    }
    const fimDate = new Date(inicioDate.getTime() + dur * 60_000);

    // 3) transacao + checagem de conflito
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Conflito por sobreposicao: a.inicio < novoFim AND a.fim > novoInicio
    const [conf] = await conn.query(`
      SELECT id FROM agendamentos
      WHERE estabelecimento_id = ? AND status IN ('confirmado','pendente')
        AND (inicio < ? AND fim > ?)
      FOR UPDATE
    `, [estabelecimento_id, fimDate, inicioDate]);

    if (conf.length) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'slot_ocupado', message: 'Horario indisponivel.' });
    }

    // 4) insere
    const [r] = await conn.query(`
      INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status)
      VALUES (?,?,?,?,?,'confirmado')
    `, [req.user.id, estabelecimento_id, servico_id, inicioDate, fimDate]);

    // 5) le dados consistentes ainda na transacao
    const [[novo]] = await conn.query('SELECT * FROM agendamentos WHERE id=?', [r.insertId]);
    const [[cli]]  = await conn.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]]  = await conn.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [estabelecimento_id]);

    await conn.commit();
    conn.release(); conn = null;

    // 6) notificacao "best-effort" (NUNCA bloqueia a resposta)
    const inicioISO = new Date(novo.inicio).toISOString();
    const inicioBR  = brDateTime(inicioISO);
    const hora      = brTime(inicioISO);
    const data      = brDate(inicioISO);

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);
    const estNome = est?.nome || '';
    const estNomeFriendly = estNome || 'nosso estabelecimento';

    // (a) Emails (background)
    fireAndForget(async () => {
      if (cli?.email) {
        await notifyEmail(
          cli.email,
          'Agendamento confirmado',
          `<p>Ola, <b>${cli?.nome ?? 'cliente'}</b>! Seu agendamento de <b>${svc.nome}</b> foi confirmado para <b>${inicioBR}</b>.</p>`
        );
      }
      if (est?.email) {
        await notifyEmail(
          est.email,
          'Novo agendamento recebido',
          `<p>Voce recebeu um novo agendamento de <b>${svc.nome}</b> em <b>${inicioBR}</b> para o cliente <b>${cli?.nome ?? ''}</b>.</p>`
        );
      }
    });

    // (b) WhatsApp imediato
    fireAndForget(async () => {
      const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
      const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
      const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
      const estNomeLabel = estNome || '';
      if (telCli) {
        if (/^triple|3$/.test(paramMode)) {
          try { await sendTemplate({ to: telCli, name: tplName, lang: tplLang, bodyParams: [svc.nome, inicioBR, estNomeLabel] }); } catch (e) { console.warn('[wa/confirm cli]', e?.message || e); }
        } else {
          await notifyWhatsapp(`[OK] Confirmacao: ${svc.nome} em ${inicioBR} - ${estNomeLabel}`, telCli);
        }
      }
      if (telEst && telEst !== telCli) {
        if (/^triple|3$/.test(paramMode)) {
          try { await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: [svc.nome, inicioBR, estNomeLabel] }); } catch (e) { console.warn('[wa/confirm est]', e?.message || e); }
        } else {
          await notifyWhatsapp(`[Novo] Agendamento: ${svc.nome} em ${inicioBR} - Cliente: ${cli?.nome ?? ''}`, telEst);
        }
      }
    });

    // (c) Lembretes (WhatsApp) - somente se houver tempo habil
    const now = Date.now();
    const reminderTime = new Date(inicioDate.getTime() - 8 * 60 * 60 * 1000); // -8h

    const msgCliReminder = `[Lembrete] Faltam 8 horas para o seu ${svc.nome} em ${estNomeFriendly} (${hora} de ${data}).`;

    fireAndForget(async () => {
      if (telCli && reminderTime.getTime() > now) {
        await scheduleWhatsApp({
          to: telCli,
          scheduledAt: reminderTime.toISOString(),
          message: msgCliReminder,
          bodyParams: (String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase().match(/^triple|3$/)
            ? [svc.nome, `${hora} de ${data}`, estNomeFriendly]
            : undefined),
          templateName: process.env.WA_TEMPLATE_NAME_REMINDER || process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME,
          templateLang: process.env.WA_TEMPLATE_LANG || 'pt_BR',
          metadata: {
            role: 'cliente',
            kind: 'reminder_8h',
            appointment_id: novo.id,
            estabelecimento_id,
            servico_id,
            inicio: inicioISO,
            clientPhone: telCli,
            ownerPhone: telEst || null,
          },
        });
      }
    });

    // 7) resposta (NUNCA depende das notificacoes)
    return res.status(201).json({
      id: novo.id,
      cliente_id: novo.cliente_id,
      estabelecimento_id: novo.estabelecimento_id,
      servico_id: novo.servico_id,
      inicio: novo.inicio,
      fim: novo.fim,
      status: novo.status
    });

  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
    if (conn) { try { conn.release(); } catch {} }
    console.error('[agendamentos][POST] erro:', e);
    // Se for erro de chave/unique/conflito que porventura escapou:
    const msg = String(e?.message || '');
    if (/duplicate|unique|constraint/i.test(msg)) {
      return res.status(409).json({ error: 'slot_ocupado', message: 'Horario indisponivel.' });
    }
    return res.status(500).json({ error: 'server_error' });
  }
});

/* =================== Cancelamento =================== */

// Cancelar (cliente)
router.put('/:id/cancel', authRequired, isCliente, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'UPDATE agendamentos SET status="cancelado" WHERE id=? AND cliente_id=?',
      [id, req.user.id]
    );
    if (!rows.affectedRows) {
      return res.status(404).json({ error: 'not_found', message: 'Agendamento nao encontrado.' });
    }

    // contatos para notificar (opcional)
    const [[a]]   = await pool.query('SELECT estabelecimento_id, servico_id, inicio FROM agendamentos WHERE id=?', [id]);
    const [[svc]] = await pool.query('SELECT nome FROM servicos WHERE id=?', [a?.servico_id || 0]);
    const [[cli]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [a?.estabelecimento_id || 0]);

    const inicioBR = a?.inicio ? brDateTime(new Date(a.inicio).toISOString()) : '';

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);

    fireAndForget(async () => {
      const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
      const tplName = process.env.WA_TEMPLATE_NAME_CANCEL || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
      const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
    const params3 = [svc?.nome || '', inicioBR, est?.nome || ''];

    if (/^triple|3$/.test(paramMode)) {
    if (telCli) {
    try { await sendTemplate({ to: telCli, name: tplName, lang: tplLang, bodyParams: params3 }); } catch (e) { console.warn('[wa/cancel cli]', e?.message || e); }
    }
    if (telEst && telEst !== telCli) {
    try { await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: params3 }); } catch (e) { console.warn('[wa/cancel est]', e?.message || e); }
    }
    } else {
    if (telCli) {
      await notifyWhatsapp(`Seu agendamento ${id} (${svc?.nome ?? 'servico'}) em ${inicioBR} foi cancelado.`, telCli);
    }
    if (telEst && telEst !== telCli) {
      await notifyWhatsapp(`[Aviso] Cancelamento: agendamento ${id} (${svc?.nome ?? 'servico'}) em ${inicioBR} pelo cliente ${cli?.nome ?? ''}.`, telEst);
    }
    }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[agendamentos/cancel]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;




