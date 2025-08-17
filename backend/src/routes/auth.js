import { Router } from 'express';
import { pool } from '../lib/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth } from '../middleware/auth.js';
import dotenv from 'dotenv'; dotenv.config();

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { nome, email, senha, tipo, telefone } = req.body; // << + telefone
    if (!nome || !email || !senha || !['cliente','estabelecimento'].includes(tipo))
      return res.status(400).json({ error: 'invalid_payload' });

    // validação simples do telefone (opcional)
    if (telefone && String(telefone).length > 20) {
      return res.status(400).json({ error: 'telefone_invalido' });
    }

    const [rows] = await pool.query('SELECT id FROM usuarios WHERE email=?', [email]);
    if (rows.length) return res.status(400).json({ error: 'email_exists' });

    const hash = await bcrypt.hash(senha, 10);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nome, email, telefone, senha_hash, tipo) VALUES (?,?,?,?,?)',
      [nome, email, telefone || null, hash, tipo]
    );

    const user = { id: r.insertId, nome, email, telefone: telefone || null, tipo };
    const token = jwt.sign({ id: user.id, nome, email, tipo }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const [rows] = await pool.query(
      'SELECT id, nome, email, telefone, senha_hash, tipo FROM usuarios WHERE email=? LIMIT 1',
      [email]
    );
    if (!rows.length) return res.status(400).json({ error: 'invalid_credentials' });
    const u = rows[0];
    const ok = await bcrypt.compare(senha, u.senha_hash);
    if (!ok) return res.status(400).json({ error: 'invalid_credentials' });

    const user = { id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, tipo: u.tipo };
    const token = jwt.sign({ id: u.id, nome: u.nome, email: u.email, tipo: u.tipo }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
