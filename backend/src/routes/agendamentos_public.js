// backend/src/routes/agendamentos_public.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import bcrypt from 'bcryptjs';
import { notifyEmail, notifyWhatsapp, scheduleWhatsApp, sendTemplate } from '../lib/notifications.js';
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

// POST /public/agendamentos — cria agendamento sem login (guest)
router.post('/', async (req, res) => {
  let conn;
  try {
    const { estabelecimento_id, servico_id, inicio, nome, email, telefone, otp_token } = req.body || {};

    if (!estabelecimento_id || !servico_id || !inicio || !nome || !email || !telefone) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Campos obrigatórios: estabelecimento_id, servico_id, inicio, nome, email, telefone.' });
    }

    const inicioDate = new Date(inicio);
    if (Number.isNaN(inicioDate.getTime())) return res.status(400).json({ error: 'invalid_date' });
    if (inicioDate.getTime() <= Date.now()) return res.status(400).json({ error: 'past_datetime' });
    if (!inBusinessHours(inicioDate.toISOString())) return res.status(400).json({ error: 'outside_business_hours' });

    // valida serviço/estab
    const [[svc]] = await pool.query(
      'SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1',
      [servico_id, estabelecimento_id]
    );
    if (!svc) return res.status(400).json({ error: 'servico_invalido' });
    const dur = Number(svc.duracao_min || 0);
    if (!Number.isFinite(dur) || dur <= 0) return res.status(400).json({ error: 'duracao_invalida' });
    const fimDate = new Date(inicioDate.getTime() + dur * 60_000);

    // OTP opcional (exigido via flag)
    const requireOtp = /^(1|true)$/i.test(String(process.env.PUBLIC_BOOKING_REQUIRE_OTP || ''));
    if (requireOtp) {
      const token = String(req.headers['x-otp-token'] || otp_token || '');
      const secret = process.env.JWT_SECRET;
      if (!token || !secret) return res.status(400).json({ error: 'otp_required' });
      try {
        const payload = jwt.verify(token, secret);
        if (payload?.scope !== 'otp') throw new Error('bad_scope');
        const emailNormLower = String(email).trim().toLowerCase();
        const telNormDigits = toDigits(telefone);
        const ok = (payload.ch === 'email' && String(payload.v || '').toLowerCase() === emailNormLower) ||
                  (payload.ch === 'phone' && String(payload.v || '') === telNormDigits);
        if (!ok) return res.status(400).json({ error: 'otp_mismatch' });
      } catch (e) {
        return res.status(400).json({ error: 'otp_invalid' });
      }
    }

    // resolve/ cria cliente guest via email (preferência) ou telefone
    const emailNorm = String(email).trim().toLowerCase();
    const telNorm = toDigits(telefone);

    let userId = null;
    {
      const [urows] = await pool.query('SELECT id FROM usuarios WHERE LOWER(email)=? LIMIT 1', [emailNorm]);
      if (urows.length) userId = urows[0].id;
    }
    if (!userId && telNorm) {
      const [urows] = await pool.query('SELECT id FROM usuarios WHERE telefone=? LIMIT 1', [telNorm]);
      if (urows.length) userId = urows[0].id;
    }
    if (!userId) {
      const hash = await bcrypt.hash(Math.random().toString(36), 10);
      const [r] = await pool.query(
        "INSERT INTO usuarios (nome, email, telefone, senha_hash, tipo) VALUES (?,?,?,?,'cliente')",
        [String(nome).slice(0,120), emailNorm, telNorm || null, hash]
      );
      userId = r.insertId;
    } else {
      try { await pool.query('UPDATE usuarios SET nome=COALESCE(nome,?), telefone=COALESCE(telefone,?) WHERE id=?', [String(nome).slice(0,120), telNorm || null, userId]); } catch {}
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [conf] = await conn.query(
      `SELECT id FROM agendamentos
       WHERE estabelecimento_id=? AND status IN ('confirmado','pendente')
         AND (inicio < ? AND fim > ?) FOR UPDATE`,
      [estabelecimento_id, fimDate, inicioDate]
    );
    if (conf.length) { await conn.rollback(); conn.release(); return res.status(409).json({ error: 'slot_ocupado' }); }

    const [ins] = await conn.query(
      "INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status) VALUES (?,?,?,?,?,'confirmado')",
      [userId, estabelecimento_id, servico_id, inicioDate, fimDate]
    );

    await conn.commit(); conn.release(); conn = null;

    // Notificações best-effort
    const inicioISO = new Date(inicioDate).toISOString();
    const inicioBR = brDateTime(inicioISO);
    const [[est]] = await pool.query('SELECT email, telefone, nome FROM usuarios WHERE id=?', [estabelecimento_id]);
    const [tmplRows] = await pool.query('SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?', [estabelecimento_id]);
    const tmpl = (tmplRows && tmplRows[0]) ? tmplRows[0] : {};
    const telCli = telNorm;
    const telEst = toDigits(est?.telefone);
    (async () => {
      try {
        if (emailNorm) {
          const subject = tmpl.email_subject || 'Agendamento confirmado';
          const html = (tmpl.email_html || `<p>Olá, <b>{{cliente_nome}}</b>! Seu agendamento de <b>{{servico_nome}}</b> foi confirmado para <b>{{data_hora}}</b>.</p>`) 
            .replace(/{{\s*cliente_nome\s*}}/g, String(nome).split(' ')[0] || 'cliente')
            .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
            .replace(/{{\s*data_hora\s*}}/g, inicioBR)
            .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '');
          await notifyEmail(emailNorm, subject, html);
        }
      } catch {}
      try {
        if (est?.email) {
          await notifyEmail(
            est.email,
            'Novo agendamento (link público)',
            `<p>Você recebeu um novo agendamento de <b>${svc.nome}</b> em <b>${inicioBR}</b> — Cliente: <b>${String(nome) || ''}</b>.</p>`
          );
        }
      } catch {}
      try {
        if (telCli) {
          const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
          const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento';
          const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
          if (/^triple|3$/.test(paramMode)) {
            // Envia 3 parâmetros: [serviço, data_hora, estabelecimento]
            await sendTemplate({
              to: telCli,
              name: tplName,
              lang: tplLang,
              bodyParams: [svc.nome, inicioBR, est?.nome || '']
            });
          } else {
            // Mensagem pronta como 1 parâmetro (compatível com template de 1 {{1}} ou texto puro)
            const waMsg = (tmpl.wa_template || `✅ Confirmação: {{servico_nome}} em {{data_hora}} — {{estabelecimento_nome}}`)
              .replace(/{{\s*cliente_nome\s*}}/g, String(nome).split(' ')[0] || 'cliente')
              .replace(/{{\s*servico_nome\s*}}/g, svc.nome)
              .replace(/{{\s*data_hora\s*}}/g, inicioBR)
              .replace(/{{\s*estabelecimento_nome\s*}}/g, est?.nome || '');
            await notifyWhatsapp(waMsg, telCli);
          }
        }
      } catch {}
      try { if (telEst && telEst !== telCli) await notifyWhatsapp(`📅 Novo agendamento: ${svc.nome} em ${inicioBR} — Cliente: ${String(nome)||''}`, telEst); } catch {}
    })();

    return res.status(201).json({ id: ins.insertId, cliente_id: userId, estabelecimento_id, servico_id, inicio: inicioDate, fim: fimDate, status: 'confirmado' });
  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
    try { if (conn) conn.release(); } catch {}
    console.error('[public/agendamentos][POST]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
