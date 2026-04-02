import jwt from 'jsonwebtoken';

function resolveSecret(env = process.env) {
  return String(env.JWT_SECRET || '').trim();
}

function resolveTokenTtlDays(env = process.env) {
  const raw = Number(env.PUBLIC_DEPOSIT_TOKEN_DAYS || 30);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 30;
}

export function buildPublicDepositToken({
  agendamentoId,
  clienteId,
  estabelecimentoId,
  paymentId = null,
}, env = process.env) {
  const secret = resolveSecret(env);
  if (!secret) return null;
  const payload = {
    scope: 'public_deposit',
    agendamento_id: Number(agendamentoId),
    cliente_id: Number(clienteId),
    estabelecimento_id: Number(estabelecimentoId),
  };
  const normalizedPaymentId = Number(paymentId);
  if (Number.isFinite(normalizedPaymentId) && normalizedPaymentId > 0) {
    payload.payment_id = normalizedPaymentId;
  }
  try {
    return jwt.sign(payload, secret, { expiresIn: `${resolveTokenTtlDays(env)}d` });
  } catch {
    return null;
  }
}

export function verifyPublicDepositToken(rawToken, env = process.env) {
  const token = String(rawToken || '').trim();
  if (!token) return { ok: false, reason: 'missing_token' };
  const secret = resolveSecret(env);
  if (!secret) return { ok: false, reason: 'missing_secret' };
  try {
    const payload = jwt.verify(token, secret);
    if (payload?.scope !== 'public_deposit') {
      return { ok: false, reason: 'invalid_scope' };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, reason: err?.name || 'invalid_token', error: err };
  }
}
