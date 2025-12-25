// backend/src/routes/agendamentos.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded } from '../lib/plans.js';
import { auth as authRequired, isCliente, isEstabelecimento } from '../middleware/auth.js';
import { notifyEmail, notifyWhatsapp, sendTemplate } from '../lib/notifications.js';
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled, whatsappConfirmationDisabled } from '../lib/client_notifications.js';

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
const CANCEL_MINUTES_CLIENT = (() => {
  const raw = process.env.CANCEL_MINUTES_CLIENT;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 120;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 120;
})();
const formatCancelLimitLabel = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hora${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutos`;
};

/** Valida horario do payload (apenas sanity check; regras finas via slots/agenda) */
function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  // Usamos janela ampla (00:00-23:59) para não bloquear horários válidos configurados no estabelecimento.
  const h = d.getHours(), m = d.getMinutes();
  const afterStart = h >= 0;
  const beforeEnd = h < 24 || (h === 23 && m <= 59);
  return afterStart && beforeEnd;
}

const DAY_SLUG_TO_INDEX = Object.freeze({
  sunday: 0,
  sundayfeira: 0,
  sun: 0,
  domingo: 0,
  domingofeira: 0,
  dom: 0,
  monday: 1,
  mondayfeira: 1,
  mon: 1,
  segunda: 1,
  segundafeira: 1,
  seg: 1,
  tuesday: 2,
  tuesdayfeira: 2,
  tue: 2,
  terca: 2,
  tercafeira: 2,
  ter: 2,
  wednesday: 3,
  wednesdayfeira: 3,
  wed: 3,
  quarta: 3,
  quartafeira: 3,
  qua: 3,
  thursday: 4,
  thursdayfeira: 4,
  thu: 4,
  quinta: 4,
  quintafeira: 4,
  qui: 4,
  friday: 5,
  fridayfeira: 5,
  fri: 5,
  sexta: 5,
  sextafeira: 5,
  sex: 5,
  saturday: 6,
  saturdayfeira: 6,
  sat: 6,
  sabado: 6,
  sabadofeira: 6,
  sab: 6,
});

const normalizeDayKey = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
};

const resolveDayIndex = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.day,
    item.key,
    item.weekday,
    item.week_day,
    item.dia,
    item.label,
  ];
  if (item.value) {
    candidates.push(item.value);
    const firstChunk = String(item.value).split(/[\s,;-]+/)[0];
    candidates.push(firstChunk);
  }

  for (const candidate of candidates) {
    const normalized = normalizeDayKey(candidate);
    if (!normalized) continue;
    if (Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, normalized)) {
      return DAY_SLUG_TO_INDEX[normalized];
    }
  }
  return null;
};

const ensureTimeValue = (value) => {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;
  const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 2) {
    const hours = Number(digits);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
    return `${String(hours).padStart(2, '0')}:00`;
  }
  const hoursDigits = digits.slice(0, -2);
  const minutesDigits = digits.slice(-2);
  const hoursNum = Number(hoursDigits);
  const minutesNum = Number(minutesDigits);
  if (
    !Number.isInteger(hoursNum) ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    !Number.isInteger(minutesNum) ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return null;
  }
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
};

const toMinutes = (time) => {
  if (!time) return null;
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
};

const buildWorkingRules = (horariosJson) => {
  if (!horariosJson) return null;
  let entries;
  try {
    entries = JSON.parse(horariosJson);
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || !entries.length) return null;
  const rules = Array.from({ length: 7 }, () => ({
    enabled: false,
    startMinutes: null,
    endMinutes: null,
    breaks: [],
  }));
  let recognized = false;

  entries.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const idx = resolveDayIndex(item);
    if (idx == null) return;
    if (rules[idx].processed) return;

    const valueText = String(item.value ?? '').toLowerCase();
    if (
      valueText.includes('fechado') ||
      valueText.includes('sem atendimento') ||
      valueText.includes('nao atende')
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? null);
    const end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? null);
    if (!start || !end) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);
    if (
      startMinutes == null ||
      endMinutes == null ||
      startMinutes >= endMinutes
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const rawBlocks = Array.isArray(item.blocks)
      ? item.blocks
      : Array.isArray(item.breaks)
      ? item.breaks
      : [];

    const breaks = [];
    rawBlocks.forEach((block) => {
      if (!block) return;
      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? null);
      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? null);
      const blockStartMinutes = toMinutes(blockStart);
      const blockEndMinutes = toMinutes(blockEnd);
      if (
        blockStartMinutes == null ||
        blockEndMinutes == null ||
        blockStartMinutes >= blockEndMinutes ||
        blockStartMinutes < startMinutes ||
        blockEndMinutes > endMinutes
      ) {
        return;
      }
      breaks.push([blockStartMinutes, blockEndMinutes]);
    });

    rules[idx] = {
      enabled: true,
      startMinutes,
      endMinutes,
      breaks,
      processed: true,
    };
    recognized = true;
  });

  if (!recognized) return null;
  return rules.map((rule) => {
    if (!rule.processed) {
      return { enabled: false, startMinutes: null, endMinutes: null, breaks: [] };
    }
    const { processed, ...rest } = rule;
    return rest;
  });
};

const isWithinWorkingHours = (startDate, endDate, workingRules) => {
  if (!workingRules) return true;
  const rule = workingRules[startDate.getDay()];
  if (!rule || !rule.enabled) return false;
  const sameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate();
  if (!sameDay) return false;
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
  if (startMinutes < rule.startMinutes) return false;
  if (endMinutes > rule.endMinutes) return false;
  if (Array.isArray(rule.breaks) && rule.breaks.some(([start, end]) => startMinutes >= start && startMinutes < end)) {
    return false;
  }
  return true;
};

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
            u.telefone AS cliente_telefone,
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
      return res.status(400).json({ error: 'outside_business_hours', message: 'Horário fora do expediente (07:00-22:00).' });
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
    let workingRules = null;
    try {
      const [[profile]] = await pool.query(
        'SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1',
        [estabelecimento_id]
      );
      workingRules = buildWorkingRules(profile?.horarios_json || null);
    } catch {}
    if (!isWithinWorkingHours(inicioDate, fimDate, workingRules)) {
      return res.status(400).json({ error: 'outside_business_hours', message: 'Horario fora do expediente do estabelecimento.' });
    }
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
    const blockWhatsappImmediate = whatsappImmediateDisabled();
    const blockWhatsappConfirmation = whatsappConfirmationDisabled();
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
      if (blockWhatsappImmediate || blockWhatsappConfirmation) return; // WhatsApp imediato desativado via env ou confirmacao desativada
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

    const cancelLimitMinutes = Number.isFinite(CANCEL_MINUTES_CLIENT) ? CANCEL_MINUTES_CLIENT : 120;
    const enforceCancelLimit = cancelLimitMinutes > 0;
    const limitClause = enforceCancelLimit ? ' AND inicio >= DATE_ADD(NOW(), INTERVAL ? MINUTE)' : '';
    const params = [id, req.user.id];
    if (enforceCancelLimit) params.push(cancelLimitMinutes);

    const [rows] = await pool.query(
      `UPDATE agendamentos
         SET status="cancelado"
       WHERE id=? AND cliente_id=? AND cliente_confirmou_whatsapp_at IS NULL${limitClause}`,
      params
    );
    if (!rows.affectedRows) {
      // Pode ser porque já confirmou via WhatsApp ou não existe/pertence a outro cliente.
      const [[ag]] = await pool.query(
        `SELECT cliente_confirmou_whatsapp_at,
                TIMESTAMPDIFF(MINUTE, NOW(), inicio) AS minutes_to_start
           FROM agendamentos
          WHERE id=? AND cliente_id=?`,
        [id, req.user.id]
      );
      if (!ag) {
        return res.status(404).json({ error: 'not_found', message: 'Agendamento nao encontrado.' });
      }
      if (ag?.cliente_confirmou_whatsapp_at) {
        return res.status(409).json({
          error: 'cancel_forbidden_after_confirm',
          message: 'Agendamento já foi confirmado via WhatsApp. Se precisar de ajuda, entre em contato com o estabelecimento.',
        });
      }
      if (enforceCancelLimit) {
        const minutesToStart = Number(ag?.minutes_to_start);
        if (!Number.isFinite(minutesToStart) || minutesToStart < cancelLimitMinutes) {
          const limitLabel = formatCancelLimitLabel(cancelLimitMinutes);
          const message = limitLabel
            ? `Cancelamento permitido apenas até ${limitLabel} antes do horário. \nEntre em contato com o estabelecimento.`
            : 'Cancelamento não permitido para este horário.';
          return res.status(409).json({ error: 'cancel_forbidden_time_limit', message });
        }
      }
      return res.status(404).json({ error: 'not_found', message: 'Agendamento nao encontrado.' });
    }

    // contatos para notificar (opcional)
    const [[a]]   = await pool.query('SELECT estabelecimento_id, servico_id, profissional_id, inicio FROM agendamentos WHERE id=?', [id]);
    const [[svc]] = await pool.query('SELECT nome FROM servicos WHERE id=?', [a?.servico_id || 0]);
    const [[cli]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [req.user.id]);
    const [[est]] = await pool.query('SELECT nome, email, telefone, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?', [a?.estabelecimento_id || 0]);
    const [[pro]] = await pool.query('SELECT nome FROM profissionais WHERE id=?', [a?.profissional_id || 0]);

    const inicioBR = a?.inicio ? brDateTime(new Date(a.inicio).toISOString()) : '';

    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();
    const blockWhatsappImmediate = whatsappImmediateDisabled();
    const canEmailEst = boolPref(est?.notify_email_estab, true);
    const canWhatsappEst = boolPref(est?.notify_whatsapp_estab, true);
    const estNome = est?.nome || '';
    const serviceName = svc?.nome || '';
    const clientName = cli?.nome || 'cliente';
    const profName = pro?.nome || '';
    const profLabel = profName ? ` com ${profName}` : '';
    const whenLabel = inicioBR || '';
    const cancelText = `[Cancelamento] ${clientName} cancelou ${serviceName || 'o atendimento'}${profLabel} que estava marcado para ${whenLabel}.`;

    // Notificar estabelecimento (email/WhatsApp)
    fireAndForget(async () => {
      if (blockEstabNotifications) return;

      if (canEmailEst && est?.email) {
        try {
          await notifyEmail(
            est.email,
            'Cancelamento de agendamento',
            `<p>O cliente <b>${clientName}</b> cancelou o agendamento de <b>${serviceName}</b>${profLabel} que estava marcado para <b>${whenLabel}</b>.</p>`
          );
        } catch (err) {
          console.warn('[cancel/estab][email]', err?.message || err);
        }
      }

      if (canWhatsappEst && telEst && !blockWhatsappImmediate) {
        const paramMode = String(
          process.env.WA_TEMPLATE_PARAM_MODE_ESTAB_CANCEL ||
          process.env.WA_TEMPLATE_PARAM_MODE_CANCEL ||
          process.env.WA_TEMPLATE_PARAM_MODE ||
          'quad'
        ).toLowerCase();
        const tplName =
          process.env.WA_TEMPLATE_NAME_ESTAB_CANCEL ||
          process.env.WA_TEMPLATE_NAME_CANCEL ||
          process.env.WA_TEMPLATE_NAME ||
          'confirmacao_agendamento';
        const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
        const params3 = [serviceName, whenLabel, clientName];
        const params4 = [serviceName, whenLabel, clientName, profName || '-'];
        try {
          if (/^quad|4|quatro/.test(paramMode)) {
            await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: params4 });
          } else {
            await sendTemplate({ to: telEst, name: tplName, lang: tplLang, bodyParams: params3 });
          }
        } catch (err) {
          console.warn('[cancel/estab][wa]', err?.message || err);
          try { await notifyWhatsapp(cancelText, telEst); } catch (err2) { console.warn('[cancel/estab][wa-text]', err2?.message || err2); }
        }
      }
    });

    // WhatsApp: não notificar cliente quando ele mesmo cancela e não notificar estabelecimento (somente email configurado permanece).

    return res.json({ ok: true });
  } catch (e) {
    console.error('[agendamentos/cancel]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Cancelar (forcado pelo estabelecimento) - permitido ate a hora do agendamento
router.put('/:id/cancel-estab', authRequired, isEstabelecimento, async (req, res) => {
  try {
    const { id } = req.params;
    const estId = req.user.id;

    const [[ag]] = await pool.query(
      `SELECT id,
              cliente_id,
              servico_id,
              inicio,
              status,
              TIMESTAMPDIFF(SECOND, NOW(), inicio) AS seconds_to_start
         FROM agendamentos
        WHERE id=? AND estabelecimento_id=?`,
      [id, estId]
    );
    if (!ag) {
      return res.status(404).json({ error: 'not_found', message: 'Agendamento nao encontrado.' });
    }

    const statusNorm = String(ag.status || '').toLowerCase();
    if (statusNorm === 'cancelado') {
      return res.status(400).json({ error: 'already_cancelled', message: 'Agendamento ja esta cancelado.' });
    }
    if (statusNorm === 'concluido') {
      return res.status(409).json({ error: 'cancel_forbidden', message: 'Nao e possivel cancelar um atendimento ja concluido.' });
    }
    const secondsToStart = Number(ag?.seconds_to_start);
    const startTime = ag?.inicio ? new Date(ag.inicio).getTime() : NaN;
    const started =
      (Number.isFinite(secondsToStart) && secondsToStart <= 0) ||
      (Number.isFinite(startTime) && startTime <= Date.now());
    if (started) {
      return res.status(409).json({
        error: 'cancel_forbidden_time_limit', 
        message: 'Cancelamento indisponível: horário já iniciado.',
      });
    }

    const [rows] = await pool.query(
      'UPDATE agendamentos SET status="cancelado" WHERE id=? AND estabelecimento_id=? AND inicio > NOW()',
      [id, estId]
    );
    if (!rows.affectedRows) {
      if (started) {
        return res.status(409).json({
          error: 'cancel_forbidden_time_limit',
          message: 'Cancelamento indisponível: horário já iniciado.',
        });
      }
      return res.status(404).json({ error: 'not_found', message: 'Agendamento nao encontrado.' });
    }

    const [[svc]] = await pool.query('SELECT nome FROM servicos WHERE id=?', [ag?.servico_id || 0]);
    const [[cli]] = await pool.query('SELECT nome, telefone FROM usuarios WHERE id=?', [ag?.cliente_id || 0]);
    const [[est]] = await pool.query(
      'SELECT nome, telefone, notify_whatsapp_estab FROM usuarios WHERE id=?',
      [estId]
    );

    const inicioISO = ag?.inicio ? new Date(ag.inicio).toISOString() : null;
    const inicioBR = inicioISO ? brDateTime(inicioISO) : '';
    const hora = inicioISO ? brTime(inicioISO) : '';
    const data = inicioISO ? brDate(inicioISO) : '';
    const telCli = toDigits(cli?.telefone);
    const telEst = toDigits(est?.telefone);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();
    const blockWhatsappImmediate = whatsappImmediateDisabled();
    const canWhatsappEstCancel = boolPref(est?.notify_whatsapp_estab, true);

    // WhatsApp: apenas cliente deve ser notificado quando o estabelecimento cancela; não envia para o estabelecimento.
    fireAndForget(async () => {
      const paramModeEnv = String(
        process.env.WA_TEMPLATE_PARAM_MODE_CANCEL ||
        process.env.WA_TEMPLATE_PARAM_MODE ||
        'single'
      ).toLowerCase();
      const paramCountHint = Number(process.env.WA_TEMPLATE_CANCEL_PARAMS || NaN);
      const tplName = process.env.WA_TEMPLATE_NAME_CANCEL || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
      const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
      // Ajuste de ordem: em {{3}} -> estabelecimento; às {{4}} -> hora+data
      const params3 = [svc?.nome || '', `${hora} de ${data}`.trim(), est?.nome || ''];
      const params4 = [cli?.nome || 'cliente', svc?.nome || '', est?.nome || '', `${hora} de ${data}`.trim()];

      let paramMode = paramModeEnv;
      const tplNameLower = String(tplName || '').toLowerCase();
      if (paramCountHint === 4) {
        paramMode = 'quad';
      } else if (paramCountHint === 3) {
        paramMode = 'triple';
      } else if (/v2/.test(tplNameLower)) {
        paramMode = 'quad';
      }

      const sendParams = async (p) => sendTemplate({ to: telCli, name: tplName, lang: tplLang, bodyParams: p });

      if (/^quad|4|quatro/.test(paramMode)) {
        if (!blockClientWhatsapp && telCli) {
          try { await sendParams(params4); } catch (e) {
            const details = e?.body?.error?.error_data?.details || e?.body?.error?.message || e?.message || '';
            if (/expected number of params\s*\(3\)/i.test(String(details))) {
              try { await sendParams(params3); } catch (e2) { console.warn('[wa/cancel cli est] (fallback 3)', e2?.message || e2); }
            } else {
              console.warn('[wa/cancel cli est]', e?.message || e);
            }
          }
        }
      } else if (/^triple|3$/.test(paramMode)) {
        if (!blockClientWhatsapp && telCli) {
          try { await sendParams(params3); } catch (e) {
            const details = e?.body?.error?.error_data?.details || e?.body?.error?.message || e?.message || '';
            if (/expected number of params\s*\(4\)/i.test(String(details))) {
              try { await sendParams(params4); } catch (e2) { console.warn('[wa/cancel cli est] (fallback 4)', e2?.message || e2); }
            } else {
              console.warn('[wa/cancel cli est]', e?.message || e);
            }
          }
        }
      } else {
        if (!blockClientWhatsapp && telCli) {
          await notifyWhatsapp(`Seu agendamento ${id} (${svc?.nome ?? 'servico'}) em ${inicioBR} foi cancelado pelo estabelecimento.`, telCli);
        }
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[agendamentos/cancel-estab]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
