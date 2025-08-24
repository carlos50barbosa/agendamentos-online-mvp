// backend/src/routes/auth.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth } from '../middleware/auth.js';
import dotenv from 'dotenv'; dotenv.config();

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
    const token = jwt.sign({ id: user.id, nome, email, tipo }, secret, { expiresIn: '7d' });
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
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

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

export default router;
