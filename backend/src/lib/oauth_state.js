import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export function buildOAuthState(payload, { secret, expiresIn = '1h' } = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }
  return jwt.sign(
    {
      ...payload,
      nonce: crypto.randomBytes(8).toString('hex'),
      ts: Date.now(),
    },
    secret,
    { expiresIn },
  );
}

export function verifyOAuthState(token, { secret } = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }
  return jwt.verify(String(token || ''), secret);
}

export function describeOAuthStateError(err) {
  const name = err?.name || 'Error';
  const message = err?.message || String(err);

  if (message === 'oauth_state_secret_missing') {
    return {
      reason: 'state_secret_missing',
      name,
      message,
      responseMessage: 'State secret missing',
    };
  }

  if (name === 'TokenExpiredError') {
    return {
      reason: 'state_expired',
      name,
      message,
      responseMessage: 'State expired',
    };
  }

  if (name === 'JsonWebTokenError' && /signature/i.test(message)) {
    return {
      reason: 'state_invalid_signature',
      name,
      message,
      responseMessage: 'Invalid state signature',
    };
  }

  return {
    reason: 'state_invalid',
    name,
    message,
    responseMessage: 'Invalid state',
  };
}
