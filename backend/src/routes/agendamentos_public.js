// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { getPlanContext, isDelinquentStatus } from '../lib/plans.js';
import bcrypt from 'bcryptjs';
import { notifyEmail, notifyWhatsapp, sendTemplate } from '../lib/notifications.js';
import jwt from 'jsonwebtoken';

const router = Router();
const TZ = 'America/Sao_Paulo';

function inBusinessHours(dateISO) {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getHours(), m = d.getMinutes();
  const afterStart = h > 7 || (h === 7 && m >= 0);
  const beforeEnd = h < 22 || (h === 22 && m === 0);
  return afterStart && beforeEnd;
}

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
        if (telCli) {
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
      try { if (canWhatsappEst && telEst && telEst !== telCli) await notifyWhatsapp(`🔔 Novo agendamento: ${svc.nome} em ${inicioBR} — Cliente: ${String(nome)||''}`, telEst); } catch {}
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



