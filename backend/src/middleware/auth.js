import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../lib/db.js';

export async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'token_missing' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const userId = Number(payload?.id);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ error: 'token_invalid' });
    }

    const [rows] = await pool.query(
      "SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, tipo, plan, plan_trial_ends_at FROM usuarios WHERE id=? LIMIT 1",
      [userId]
    );

    const row = rows?.[0];
    if (!row) return res.status(401).json({ error: 'token_invalid' });

    req.user = {
      id: row.id,
      nome: row.nome,
      email: row.email,
      telefone: row.telefone,
      cep: row.cep || null,
      endereco: row.endereco || null,
      numero: row.numero || null,
      complemento: row.complemento || null,
      bairro: row.bairro || null,
      cidade: row.cidade || null,
      estado: row.estado || null,
      tipo: row.tipo || 'cliente',
      plan: row.plan || 'starter',
      plan_trial_ends_at: row.plan_trial_ends_at ? new Date(row.plan_trial_ends_at).toISOString() : null,
    };

    next();
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'token_expired' });
    }
    return res.status(401).json({ error: 'token_invalid' });
  }
}

export function isCliente(req, res, next) {
  if (req.user?.tipo !== 'cliente') return res.status(403).json({ error: 'forbidden_cliente' });
  next();
}

export function isEstabelecimento(req, res, next) {
  if (req.user?.tipo !== 'estabelecimento') return res.status(403).json({ error: 'forbidden_estabelecimento' });
  next();
}
