// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus, formatPlanLimitExceeded } from '../lib/plans.js';
import bcrypt from 'bcryptjs';
import { notifyEmail, notifyWhatsapp, sendTemplate } from '../lib/notifications.js';
import { estabNotificationsDisabled } from '../lib/estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled } from '../lib/client_notifications.js';
import jwt from 'jsonwebtoken';
import { checkMonthlyAppointmentLimit, notifyAppointmentLimitReached } from '../lib/appointment_limits.js';

const router = Router();
const TZ = 'America/Sao_Paulo';

function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  // Janela ampla (00:00-23:59) para não bloquear horários configurados pelo estabelecimento.
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
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ,
  });
}

function toDigits(s){ return String(s || '').replace(/\D/g, ''); }

function normalizePhoneBR(value){
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

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

// POST /public/agendamentos — cria agendamento sem login (guest)
router.post('/', async (req, res) => {
  let conn;
  try {
    const { estabelecimento_id, servico_id, inicio, nome, email, telefone, otp_token, profissional_id: profissionalIdRaw, profissionalId } = req.body || {};

    const professionalCandidate = profissionalIdRaw != null ? profissionalIdRaw : profissionalId;
    const profissional_id = professionalCandidate == null ? null : Number(professionalCandidate);
    if (profissional_id !== null && !Number.isFinite(profissional_id)) {
      return res.status(400).json({ error: 'profissional_invalido', message: 'Profissional invalido.' });
    }

    if (!estabelecimento_id || !servico_id || !inicio || !nome || !email || !telefone) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Campos obrigatorios: estabelecimento_id, servico_id, inicio, nome, email, telefone.' });
    }

    const planContext = await getPlanContext(estabelecimento_id);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    if (isDelinquentStatus(planContext.status)) {
      return res.status(403).json({ error: 'plan_delinquent', message: 'Este estabelecimento esta com o plano em atraso. Agendamentos temporariamente suspensos.' });
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) return res.status(400).json({ error: 'invalid_date' });
    if (inicioDate.getTime() <= Date.now()) return res.status(400).json({ error: 'past_datetime' });
    if (!inBusinessHours(inicioDate.toISOString())) return res.status(400).json({ error: 'outside_business_hours' });

    // valida servico/estab
    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) return res.status(400).json({ error: 'servico_invalido' });

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
    if (!Number.isFinite(dur) || dur <= 0) return res.status(400).json({ error: 'duracao_invalida' });
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
      (async () => {
        try {
          await notifyAppointmentLimitReached({
            estabelecimentoId: estabelecimento_id,
            limit: limitCheck.limit,
            total: limitCheck.total,
            range: limitCheck.range,
            planConfig,
          });
        } catch (e) {
          console.warn('[agendamentos_public][limit_notify]', e?.message || e);
        }
      })();
      return res.status(403).json({
        error: 'plan_limit_agendamentos',
        message: formatPlanLimitExceeded(planConfig, 'appointments') || 'Limite de agendamentos atingido para este mes.',
        details: { limit: limitCheck.limit, total: limitCheck.total, month: limitCheck.range?.label || null },
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const telDigits = toDigits(telefone);
    const telNorm = normalizePhoneBR(telefone);

    // OTP opcional (exigido via flag)
    const requireOtp = /^(1|true)$/i.test(String(process.env.PUBLIC_BOOKING_REQUIRE_OTP || ''));
    if (requireOtp) {
      const token = String(req.headers['x-otp-token'] || otp_token || '');
      const secret = process.env.JWT_SECRET;
      if (!token || !secret) return res.status(400).json({ error: 'otp_required' });
      try {
        const payload = jwt.verify(token, secret);
        if (payload?.scope !== 'otp') throw new Error('bad_scope');
        const ok = (payload.ch === 'email' && String(payload.v || '').toLowerCase() === emailNorm) ||
                  (payload.ch === 'phone' && String(payload.v || '') === telDigits);
        if (!ok) return res.status(400).json({ error: 'otp_mismatch' });
      } catch (e) {
        return res.status(400).json({ error: 'otp_invalid' });
      }
    }

    // resolve/ cria cliente guest via email (preferencia) ou telefone

    let userId = null;
    {
      const [urows] = await pool.query('SELECT id FROM usuarios WHERE LOWER(email)=? LIMIT 1', [emailNorm]);
      if (urows.length) userId = urows[0].id;
    }
    if (!userId && (telNorm || telDigits)) {
      const candidates = [];
      if (telNorm) candidates.push(telNorm);
      if (telDigits && telDigits !== telNorm) candidates.push(telDigits);
      for (const candidate of candidates) {
        const [urows] = await pool.query('SELECT id FROM usuarios WHERE telefone=? LIMIT 1', [candidate]);
        if (urows.length) { userId = urows[0].id; break; }
      }
    }
    if (!userId) {
      const hash = await bcrypt.hash(Math.random().toString(36), 10);
      const [r] = await pool.query(
        "INSERT INTO usuarios (nome, email, telefone, senha_hash, tipo) VALUES (?,?,?,?,'cliente')",
        [String(nome).slice(0,120), emailNorm, telNorm || null, hash]
      );
      userId = r.insertId;
    } else {
      try {
        if (telNorm) {
          await pool.query('UPDATE usuarios SET nome=COALESCE(nome,?), telefone=? WHERE id=?', [String(nome).slice(0,120), telNorm, userId]);
        } else {
          await pool.query('UPDATE usuarios SET nome=COALESCE(nome,?) WHERE id=?', [String(nome).slice(0,120), userId]);
        }
      } catch {}
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    let conflictSql = `SELECT id FROM agendamentos
       WHERE estabelecimento_id=? AND status IN ('confirmado','pendente')
         AND (inicio < ? AND fim > ?)`;
    const conflictParams = [estabelecimento_id, fimDate, inicioDate];
    if (profissional_id != null && linkedProfessionalIds.length) {
      conflictSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
      conflictParams.push(profissional_id);
    }
    conflictSql += ' FOR UPDATE';
    const [conf] = await conn.query(conflictSql, conflictParams);
    if (conf.length) { await conn.rollback(); conn.release(); return res.status(409).json({ error: 'slot_ocupado' }); }

    const [ins] = await conn.query(
      "INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status) VALUES (?,?,?,?,?, 'confirmado')",
      [userId, estabelecimento_id, servico_id, profissional_id || null, inicioDate, fimDate]
    );

    await conn.commit(); conn.release(); conn = null;

    // Notificacoes best-effort
    const inicioISO = new Date(inicioDate).toISOString();
    const inicioBR = brDateTime(inicioISO);
    const [[est]] = await pool.query('SELECT email, telefone, nome, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?', [estabelecimento_id]);
    const [tmplRows] = await pool.query('SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?', [estabelecimento_id]);
    const tmpl = (tmplRows && tmplRows[0]) ? tmplRows[0] : {};
    const telCli = normalizePhoneBR(telNorm);
    const telEst = normalizePhoneBR(est?.telefone);
    const canWhatsappEst = boolPref(est?.notify_whatsapp_estab, true);
    const blockEstabNotifications = estabNotificationsDisabled();
    const blockClientWhatsapp = clientWhatsappDisabled();
    const blockWhatsappImmediate = whatsappImmediateDisabled();
    const profNome = profissionalRow?.nome || '';
    const profLabel = profNome ? ` com ${profNome}` : '';
    (async () => {
      try {
        if (emailNorm) {
          const subject = tmpl.email_subject || 'Agendamento confirmado';
          const html = (tmpl.email_html || `<p>Olá, <b>{{cliente_nome}}</b>! Seu agendamento de <b>{{servico_nome}}</b>{{profissional_nome}} foi confirmado para <b>{{data_hora}}</b>.</p>`) 
            .replace(/{{\s*cliente_nome\s*}}/g, String(nome).split(' ')[0] || 'cliente')
            .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
            .replace(/{{\s*data_hora\s*}}/g, inicioBR)
            .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '').replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com <b>${profNome}</b>` : '');
          await notifyEmail(emailNorm, subject, html);
        }
      } catch {}
      try {
        if (!blockWhatsappImmediate && !blockClientWhatsapp && telCli) {
          const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
          const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
          const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
          if (/^triple|3$/.test(paramMode)) {
            // Envia 3 parametros: [servico, data_hora, estabelecimento]
            await sendTemplate({
              to: telCli,
              name: tplName,
              lang: tplLang,
              bodyParams: [svc.nome, inicioBR, est?.nome || '']
            });
          } else {
            // Mensagem pronta como 1 parametro (compativel com template de 1 {{1}} ou texto puro)
            const waMsg = (tmpl.wa_template || `✅ Confirmacao: {{servico_nome}} em {{data_hora}} — {{estabelecimento_nome}}`)
              .replace(/{{\s*cliente_nome\s*}}/g, String(nome).split(' ')[0] || 'cliente')
              .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
              .replace(/{{\s*data_hora\s*}}/g, inicioBR)
              .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '').replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com <b>${profNome}</b>` : '');
            await notifyWhatsapp(waMsg, telCli);
          }
        }
      } catch {}
      try { if (!blockWhatsappImmediate && !blockEstabNotifications && canWhatsappEst && telEst && telEst !== telCli) await notifyWhatsapp(`🔔 Novo agendamento: ${svc.nome} em ${inicioBR} — Cliente: ${String(nome)||''}`, telEst); } catch {}
    })();

    return res.status(201).json({ id: ins.insertId, cliente_id: userId, estabelecimento_id, servico_id, profissional_id: profissional_id || null, inicio: inicioDate, fim: fimDate, status: 'confirmado' });
  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
    try { if (conn) conn.release(); } catch {}
    console.error('[public/agendamentos][POST]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
