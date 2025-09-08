// backend/src/routes/auth.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth } from '../middleware/auth.js';
import dotenv from 'dotenv'; dotenv.config();
import { notifyEmail } from '../lib/notifications.js';
import crypto from 'crypto';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { nome, email, senha, tipo, telefone } = req.body;
    if (!nome || !email || !senha || !['cliente','estabelecimento'].includes(tipo)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }
    if (telefone && String(telefone).length > 20) {
      return res.status(400).json({ error: 'telefone_invalido' });
    }

    const [rows] = await pool.query('SELECT id FROM usuarios WHERE email=?', [email]);
    if (rows.length) return res.status(400).json({ error: 'email_exists' });

    const hash = await bcrypt.hash(String(senha), 10);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nome, email, telefone, senha_hash, tipo) VALUES (?,?,?,?,?)',
      [nome, email, telefone || null, hash, tipo]
    );

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    const user = { id: r.insertId, nome, email, telefone: telefone || null, tipo };
    // Expira em 10 horas
    const token = jwt.sign({ id: user.id, nome, email, tipo }, secret, { expiresIn: '10h' });
    res.json({ token, user });
  } catch (e) {
    console.error('[auth/register] erro:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const senha = req.body?.senha;
    if (!emailRaw || !senha) {
      return res.status(400).json({ error: 'missing_fields', message: 'Informe email e senha.' });
    }
    const email = String(emailRaw).trim().toLowerCase();

    // 🔧 Removido "senha" do SELECT (coluna não existe)
    const [rows] = await pool.query(
      'SELECT id, nome, email, telefone, senha_hash, tipo FROM usuarios WHERE LOWER(email)=? LIMIT 1',
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'invalid_credentials' });

    const u = rows[0];
    if (!u.senha_hash) {
      return res.status(500).json({ error: 'user_password_not_configured' });
    }

    const ok = await bcrypt.compare(String(senha), String(u.senha_hash));
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    const payload = { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo || 'cliente' };
    // Expira em 10 horas
    const token = jwt.sign(payload, secret, { expiresIn: '10h' });

    const user = { id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, tipo: u.tipo || 'cliente' };
    return res.json({ ok: true, token, user });
  } catch (e) {
    console.error('[auth/login] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/me', auth, async (_req, res) => {
  res.json({ user: _req.user });
});

// Recuperação de senha (envio de link com token)
router.post('/forgot', async (req, res) => {
  try{
    const emailRaw = req.body?.email;
    if (!emailRaw) return res.status(400).json({ error: 'missing_email' });
    const email = String(emailRaw).trim().toLowerCase();

    // Busca usuário — mas SEM revelar se existe ou não
    let user = null;
    try{
      const [rows] = await pool.query('SELECT id, nome, email FROM usuarios WHERE LOWER(email)=? LIMIT 1', [email]);
      user = rows?.[0] || null;
    }catch{}

    // Monta link com token JWT de uso único por período curto
    const appUrl = process.env.APP_URL || 'http://localhost:3001';
    const secret = process.env.JWT_SECRET;
    let link = `${appUrl.replace(/\/$/,'')}/recuperar-senha`;
    if (user && secret) {
      const jti = crypto.randomBytes(16).toString('hex');
      const expires = new Date(Date.now() + 30 * 60 * 1000);
      // registra token para invalidação pós-uso
      try{
        await pool.query(
          'INSERT INTO password_resets (user_id, jti, expires_at) VALUES (?,?,?)',
          [user.id, jti, expires]
        );
      }catch(e){
        console.error('[auth/forgot] falha ao registrar token:', e?.message || e);
      }

      const token = jwt.sign(
        { sub: user.id, email: user.email, scope: 'pwd_reset' },
        secret,
        { expiresIn: '30m', jwtid: jti }
      );
      link = `${appUrl.replace(/\/$/,'')}/definir-senha?token=${encodeURIComponent(token)}`;
    }

    // Envia email apenas se usuário existir e SMTP estiver configurado; caso contrário, apenas loga
    if (user) {
      const subject = 'Recuperação de senha';
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5;color:#111">
          <h2>Recuperar senha</h2>
          <p>Olá, ${user.nome?.split(' ')[0] || 'usuário'}.</p>
          <p>Para redefinir sua senha, acesse o link abaixo:</p>
          <p><a href="${link}" style="color:#5c5ccc">Redefinir senha</a></p>
          <p style="color:#555;font-size:12px">Se você não solicitou, ignore este email.</p>
        </div>`;
      try{
        await notifyEmail(email, subject, html);
      }catch(e){
        // continua silencioso
        console.error('[auth/forgot] notifyEmail falhou:', e?.message || e);
      }
    } else {
      console.log('[auth/forgot] pedido para email inexistente (não informado ao cliente)');
    }

    // Resposta neutra
    return res.json({ ok: true });
  }catch(e){
    console.error('[auth/forgot] erro:', e);
    return res.status(200).json({ ok: true }); // mantém resposta neutra
  }
});

// Redefinição de senha com token
router.post('/reset', async (req, res) => {
  try{
    const token = req.body?.token;
    const senha = req.body?.senha;
    if (!token || !senha) return res.status(400).json({ error: 'missing_fields' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    let payload;
    try {
      payload = jwt.verify(String(token), secret);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    if (payload?.scope !== 'pwd_reset' || !payload?.sub || !payload?.jti) {
      return res.status(400).json({ error: 'invalid_scope' });
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'invalid_token' });

    // Verifica token no banco (não usado/expirado)
    try{
      const [rows] = await pool.query(
        'SELECT id, user_id, used_at, expires_at FROM password_resets WHERE jti=? LIMIT 1',
        [String(payload.jti)]
      );
      const rec = rows?.[0];
      if (!rec || rec.user_id !== userId) {
        return res.status(400).json({ error: 'invalid_token' });
      }
      if (rec.used_at) {
        return res.status(400).json({ error: 'token_used' });
      }
      if (new Date(rec.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'token_expired' });
      }
    }catch(e){
      console.error('[auth/reset] falha ao validar token:', e?.message || e);
      return res.status(500).json({ error: 'server_error' });
    }

    const hash = await bcrypt.hash(String(senha), 10);
    await pool.query('UPDATE usuarios SET senha_hash=? WHERE id=?', [hash, userId]);
    // marca este token como usado e invalida quaisquer outros abertos do usuário
    try{
      await pool.query('UPDATE password_resets SET used_at=NOW() WHERE jti=?', [String(payload.jti)]);
      await pool.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()', [userId]);
    }catch(e){
      console.error('[auth/reset] falha ao invalidar tokens:', e?.message || e);
    }

    return res.json({ ok: true });
  }catch(e){
    console.error('[auth/reset] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
