import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; dotenv.config();

export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'token_missing' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = payload;
    next();
  } catch (e) {
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