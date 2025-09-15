// backend/src/routes/otp_public.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db.js';
import { notifyEmail, notifyWhatsapp } from '../lib/notifications.js';

const router = Router();

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
}

router.post('/request', async (req, res) => {
  try {
    const channel = String(req.body?.channel || '').toLowerCase();
    const valueRaw = String(req.body?.value || '');
    if (!['email','phone'].includes(channel)) return res.status(400).json({ error: 'invalid_channel' });
    const value = channel === 'email' ? valueRaw.trim().toLowerCase() : valueRaw.replace(/\D/g, '');
    if (!value) return res.status(400).json({ error: 'invalid_value' });

    // limits básicos (poderíamos adicionar rate-limit externo)
    const code = genCode();
    const hash = await bcrypt.hash(code, 8);
    const requestId = crypto.randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().slice(0,64);

    await pool.query(
      'INSERT INTO otp_codes (request_id, channel, value, code_hash, expires_at, ip_addr) VALUES (?,?,?,?,?,?)',
      [requestId, channel, value, hash, expires, ip]
    );

    // envia
    try {
      if (channel === 'email') {
        await notifyEmail(value, 'Seu código de verificação', `<p>Seu código é <b>${code}</b>. Ele expira em 10 minutos.</p>`);
      } else {
        await notifyWhatsapp(`Código de verificação: ${code} (expira em 10 minutos).`, value);
      }
    } catch (e) {
      // não falhar se envio der erro; o cliente pode tentar novamente
      console.warn('[otp/request] envio falhou:', e?.message || e);
    }

    return res.json({ ok: true, request_id: requestId });
  } catch (e) {
    console.error('[otp/request]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const requestId = String(req.body?.request_id || '');
    const code = String(req.body?.code || '');
    if (!requestId || !code) return res.status(400).json({ error: 'invalid_payload' });

    const [rows] = await pool.query('SELECT * FROM otp_codes WHERE request_id=? LIMIT 1', [requestId]);
    const rec = rows?.[0];
    if (!rec) return res.status(400).json({ error: 'invalid_request' });
    if (rec.used_at) return res.status(400).json({ error: 'already_used' });
    if (new Date(rec.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'expired' });

    const ok = await bcrypt.compare(code, rec.code_hash);
    if (!ok) {
      try { await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?', [rec.id]); } catch {}
      return res.status(400).json({ error: 'invalid_code' });
    }

    // marca usado
    try { await pool.query('UPDATE otp_codes SET used_at=NOW() WHERE id=?', [rec.id]); } catch {}

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config' });
    const token = jwt.sign({ scope: 'otp', ch: rec.channel, v: rec.value, rid: rec.request_id }, secret, { expiresIn: '30m' });

    return res.json({ ok: true, otp_token: token });
  } catch (e) {
    console.error('[otp/verify]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;

