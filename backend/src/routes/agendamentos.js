// backend/src/routes/agendamentos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded } from '../lib/plans.js';
import { auth as authRequired, isCliente, isEstabelecimento } from '../middleware/auth.js';
import { notifyEmail, notifyWhatsapp, sendTemplate } from '../lib/notifications.js';
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled } from '../lib/client_notifications.js';

const router = Router();

const TZ = 'America/Sao_Paulo';
const toDigits = (s) => String(s || '').replace(/\D/g, ''); // normaliza telefone para apenas digitos
const boolPref = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === false) return Boolean(value);
  const num = Number(value);
  if (!Number.isNaN(num)) return num !== 0;
  const norm = String(value).trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'nao'].includes(norm)) return false;
  if (['1', 'true', 'on', 'yes', 'sim'].includes(norm)) return true;
  return fallback;
};

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
    SELECT a.*,
           s.nome AS servico_nome,
           u.nome AS estabelecimento_nome,
           p.nome AS profissional_nome,
           p.avatar_url AS profissional_avatar_url
    FROM agendamentos a
    JOIN servicos s   ON s.id=a.servico_id
    JOIN usuarios u   ON u.id=a.estabelecimento_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
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
    `SELECT a.*,
            s.nome AS servico_nome,
            u.nome AS cliente_nome,
            p.nome AS profissional_nome,
            p.avatar_url AS profissional_avatar_url
     FROM agendamentos a
     JOIN servicos s ON s.id=a.servico_id
     JOIN usuarios u ON u.id=a.cliente_id
     LEFT JOIN profissionais p ON p.id = a.profissional_id
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
    const { estabelecimento_id, servico_id, inicio, profissional_id: profissionalIdRaw, profissionalId } = req.body || {};
    const professionalCandidate = profissionalIdRaw != null ? profissionalIdRaw : profissionalId;
    const profissional_id = professionalCandidate == null ? null : Number(professionalCandidate);

    if (profissional_id !== null && !Number.isFinite(profissional_id)) {
      return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional invalido.' });
    }

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
      return res.status(400).json({ error: 'past_datetime', message: 'Não é possível agendar no passado.' });
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

    const [serviceProfessionals] = await pool.query(
      'SELECT profissional_id FROM servico_profissionais WHERE servico_id=?',
      [servico_id]
    );
    const linkedProfessionalIds = serviceProfessionals.map((row) => row.profissional_id);
    let profissionalRow = null;

    if (linkedProfessionalIds.length && profissional_id == null) {
      return res.status(400).json({ error: 'profissional_obrigatorio', message: 'Escolha um profissional para este servico.' });
    }

    if (profissional_id != null) {
      const [[profRow]] = await pool.query(
        'SELECT id, nome, avatar_url, ativo FROM profissionais WHERE id=? AND estabelecimento_id=?',
        [profissional_id, estabelecimento_id]
      );
      if (!profRow) {
        return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional nao encontrado para este estabelecimento.' });
      }
      if (!profRow.ativo) {
        return res.status(400).json({ error: 'profissional_inativo', message: 'Profissional inativo.' });
      }
      if (linkedProfessionalIds.length && !linkedProfessionalIds.includes(profissional_id)) {
        return res.status(400).json({ error: 'profissional_servico', message: 'Profissional nao esta associado a este servico.' });
      }
      profissionalRow = profRow;
    }

    const dur = Number(svc.duracao_min || 0);
    if (!Number.isFinite(dur) || dur <= 0) {
      return res.status(400).json({ error: 'duracao_invalida', message: 'Duracao do servico invalida.' });
    }
    const fimDate = new Date(inicioDate.getTime() + dur * 60_000);
    const planConfig = planContext?.config;
    const limitCheck = await checkMonthlyAppointmentLimit({
      estabelecimentoId: estabelecimento_id,
      planConfig,
      appointmentDate: inicioDate,
    });
    if (!limitCheck.ok) {
      fireAndForget(() => notifyAppointmentLimitReached({
        estabelecimentoId: estabelecimento_id,
        limit: limitCheck.limit,
        total: limitCheck.total,
        range: limitCheck.range,
        planConfig,
      }));
      return res.status(403).json({
        error: 'plan_limit_agendamentos',
        message: formatPlanLimitExceeded(planConfig, 'appointments') || 'Limite de agendamentos atingido para este mes.',
        details: {
          limit: limitCheck.limit,
          total: limitCheck.total,
          month: limitCheck.range?.label || null,
        },
      });
    }

    // 3) transacao + checagem de conflito
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Conflito por sobreposicao: a.inicio < novoFim AND a.fim > novoInicio
    let conflictSql = `
      SELECT id FROM agendamentos
      WHERE estabelecimento_id = ? AND status IN ('confirmado','pendente')
        AND (inicio < ? AND fim > ?)
    `;
    const conflictParams = [estabelecimento_id, fimDate, inicioDate];
    if (profissional_id != null && linkedProfessionalIds.length) {
      conflictSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
      conflictParams.push(profissional_id);
    }
    conflictSql += ' FOR UPDATE';

    const [conf] = await conn.query(conflictSql, conflictParams);

    if (conf.length) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: 'slot_ocupado', message: 'Horario indisponivel.' });
    }

    // 4) insere (status usa default 'confirmado')
    const [r] = await conn.query(
      'INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim) VALUES (?,?,?,?,?,?)',
      [req.user.id, estabelecimento_id, servico_id, profissional_id || null, inicioDate, fimDate]
    );

    // 5) le dados consistentes ainda na transacao
    const [[novo]] = await conn.query('SELECT * FROM agendamentos WHERE id=?', [r.insertId]);
    const [[cli]]  = await conn.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]]  = await conn.query('SELECT email, telefone, nome, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?', [estabelecimento_id]);

    await conn.commit();
    conn.release(); conn = null;

    // 6) notificacao "best-effort" (NUNCA bloqueia a resposta)
    const inicioISO = new Date(novo.inicio).toISOString();
    const inicioBR  = brDateTime(inicioISO);
    const hora      = brTime(inicioISO);
    const data      = brDate(inicioISO);

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);
    const canEmailEst = boolPref(est?.notify_email_estab, true);
    const canWhatsappEst = boolPref(est?.notify_whatsapp_estab, true);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();
    const estNome = est?.nome || '';
    const estNomeFriendly = estNome || 'nosso estabelecimento';
    const profNome = profissionalRow?.nome || '';
    const profLabel = profNome ? ` com ${profNome}` : '';

    // (a) Emails (background)
    fireAndForget(async () => {
      if (cli?.email) {
        await notifyEmail(
          cli.email,
          'Agendamento confirmado',
          `<p>Olá, <b>${cli?.nome ?? 'cliente'}</b>! Seu agendamento de <b>${svc.nome}</b>${profLabel ? ` com <b>${profNome}</b>` : ''} foi confirmado para <b>${inicioBR}</b>.</p>`
        );
      }
      if (!blockEstabNotifications && est?.email && canEmailEst) {
        await notifyEmail(
          est.email,
          'Novo agendamento recebido',
          `<p>Você recebeu um novo agendamento de <b>${svc.nome}</b>${profLabel ? ` com <b>${profNome}</b>` : ''} em <b>${inicioBR}</b> para o cliente <b>${cli?.nome ?? ''}</b>.</p>`
        );
      }
    });

    // (b) WhatsApp imediato
    fireAndForget(async () => {
      const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
      const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
      const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
      const estNomeLabel = estNome || '';
      if (!blockClientWhatsapp && telCli) {
        if (/^triple|3$/.test(paramMode)) {
          try { await sendTemplate({ to: telCli, name: tplName, lang: tplLang, bodyParams: [svc.nome, inicioBR, estNomeLabel] }); } catch (e) { console.warn('[wa/confirm cli]', e?.message || e); }
        } else {
          await notifyWhatsapp(`[OK] Confirmacao: ${svc.nome}${profNome ? ' / ' + profNome : ''} em ${inicioBR} - ${estNomeLabel}`, telCli);
        }
      }
      if (!blockEstabNotifications && canWhatsappEst && telEst && telEst !== telCli) {
        if (/^triple|3$/.test(paramMode)) {
          try { await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: [svc.nome, inicioBR, estNomeLabel] }); } catch (e) { console.warn('[wa/confirm est]', e?.message || e); }
        } else {
          await notifyWhatsapp(`[Novo] Agendamento: ${svc.nome}${profNome ? ' / ' + profNome : ''} em ${inicioBR} - Cliente: ${cli?.nome ?? ''}`, telEst);
        }
      }
    });

    // (c) Lembretes de 8h: agora gerenciados por um worker em background que reprocessa mesmo apos restart

    // 7) resposta (NUNCA depende das notificacoes)
    return res.status(201).json({
      id: novo.id,
      cliente_id: novo.cliente_id,
      estabelecimento_id: novo.estabelecimento_id,
      servico_id: novo.servico_id,
      profissional_id: novo.profissional_id,
      profissional_nome: profissionalRow?.nome || null,
      profissional_avatar_url: profissionalRow?.avatar_url || null,
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
    const [[est]] = await pool.query('SELECT nome, telefone, notify_whatsapp_estab FROM usuarios WHERE id=?', [a?.estabelecimento_id || 0]);

    const inicioBR = a?.inicio ? brDateTime(new Date(a.inicio).toISOString()) : '';

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();

    fireAndForget(async () => {
      const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
      const tplName = process.env.WA_TEMPLATE_NAME_CANCEL || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
      const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
      const params3 = [svc?.nome || '', inicioBR, est?.nome || ''];

      const canWhatsappEstCancel = boolPref(est?.notify_whatsapp_estab, true);

      if (/^triple|3$/.test(paramMode)) {
        if (!blockClientWhatsapp && telCli) {
          try { await sendTemplate({ to: telCli, name: tplName, lang: tplLang, bodyParams: params3 }); } catch (e) { console.warn('[wa/cancel cli]', e?.message || e); }
        }
        if (!blockEstabNotifications && canWhatsappEstCancel && telEst && telEst !== telCli) {
          try { await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: params3 }); } catch (e) { console.warn('[wa/cancel est]', e?.message || e); }
        }
      } else {
        if (!blockClientWhatsapp && telCli) {
          await notifyWhatsapp(`Seu agendamento ${id} (${svc?.nome ?? 'servico'}) em ${inicioBR} foi cancelado.`, telCli);
        }
        if (!blockEstabNotifications && canWhatsappEstCancel && telEst && telEst !== telCli) {
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
