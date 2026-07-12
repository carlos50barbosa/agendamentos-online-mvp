import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../lib/db.js';

function serializeUserRow(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    telefone: row.telefone,
    data_nascimento: row.data_nascimento || null,
    cpf_cnpj: row.cpf_cnpj || null,
    cep: row.cep || null,
    endereco: row.endereco || null,
    numero: row.numero || null,
    complemento: row.complemento || null,
    bairro: row.bairro || null,
    cidade: row.cidade || null,
    estado: row.estado || null,
    avatar_url: row.avatar_url || null,
    slug: row.slug || null,
    tipo: row.tipo || 'cliente',
    notify_email_estab: Boolean(row.notify_email_estab ?? 0),
    notify_whatsapp_estab: Boolean(row.notify_whatsapp_estab ?? 0),
    plan: row.plan || 'starter',
    plan_status: row.plan_status || 'trialing',
    plan_trial_ends_at: row.plan_trial_ends_at ? new Date(row.plan_trial_ends_at).toISOString() : null,
    plan_active_until: row.plan_active_until ? new Date(row.plan_active_until).toISOString() : null,
    plan_subscription_id: row.plan_subscription_id || null,
    onboarding_concluido: Boolean(row.onboarding_concluido ?? 0),
    onboarding_etapa: row.onboarding_etapa || 'profissionais',
  };
}

export function extractBearerToken(req) {
  const header = req?.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function resolveUserFromToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
  const userId = Number(payload?.id);
  if (!Number.isFinite(userId)) {
    const err = new Error('token_invalid');
    err.code = 'token_invalid';
    throw err;
  }

  const [rows] = await pool.query(
    "SELECT id, nome, email, telefone, data_nascimento, cpf_cnpj, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, slug, tipo, notify_email_estab, notify_whatsapp_estab, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id, onboarding_concluido, onboarding_etapa FROM usuarios WHERE id=? LIMIT 1",
    [userId]
  );

  const row = rows?.[0];
  if (!row) {
    const err = new Error('token_invalid');
    err.code = 'token_invalid';
    throw err;
  }

  return serializeUserRow(row);
}

export async function tryAuthenticateRequest(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { token: null, user: null, error: null };
  }

  try {
    const user = await resolveUserFromToken(token);
    return { token, user, error: null };
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') {
      return { token, user: null, error: { code: 'token_expired', cause: e } };
    }
    return { token, user: null, error: { code: 'token_invalid', cause: e } };
  }
}

export async function auth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'token_missing' });

  try {
    req.user = await resolveUserFromToken(token);
    next();
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'token_expired' });
    }
    return res.status(401).json({ error: 'token_invalid' });
  }
}

export function isCliente(req, res, next) {
  if (req.user?.tipo !== 'cliente') {
    return res.status(403).json({
      error: 'forbidden_cliente',
      message: 'Acesso permitido apenas para clientes. Faça login como cliente.',
    });
  }
  next();
}

export function isEstabelecimento(req, res, next) {
  if (req.user?.tipo !== 'estabelecimento') {
    return res.status(403).json({
      error: 'forbidden_estabelecimento',
      message: 'Acesso permitido apenas para estabelecimentos. Faça login como estabelecimento.',
    });
  }
  next();
}
