import { pool } from '../lib/db.js';
import { decryptMpToken } from './mpCrypto.js';
const normalizeId = (value) => {
const n = Number(value);
if (!Number.isFinite(n)) return null;
return Math.trunc(n);
};
function parseBool(value, fallback = false) {
if (value === undefined || value === null) return fallback;
const normalized = String(value).trim().toLowerCase();
if (!normalized) return fallback;
if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
return fallback;
}

const MP_FALLBACK_ALLOWED = (() => {
return parseBool( process.env.MP_DEPOSIT_FALLBACK_PLATFORM || process.env.MERCADOPAGO_DEPOSIT_FALLBACK || process.env.MP_DEPOSIT_FALLBACK ||
    '', false );
})();
export function isMpDepositFallbackAllowed() {
return MP_FALLBACK_ALLOWED;
}

export async function getMpAccountByEstabelecimentoId(estabelecimentoId) {
const id = normalizeId(estabelecimentoId);
if (!id) return null;
const [[row]] = await pool.query(
    `SELECT estabelecimento_id, mp_user_id, access_token_enc, refresh_token_enc, token_last4,
            expires_at, status, created_at, updated_at
       FROM mercadopago_accounts
      WHERE estabelecimento_id= LIMIT 1`, [id] );
return row || null;
}

export async function upsertMpAccount({
estabelecimentoId, mpUserId, accessTokenEnc, refreshTokenEnc, tokenLast4, expiresAt, status = 'connected', }) {
const id = normalizeId(estabelecimentoId);
if (!id) throw new Error('missing_estabelecimento_id');
await pool.query(
    `
    INSERT INTO mercadopago_accounts (
      estabelecimento_id,
      mp_user_id,
      access_token_enc,
      refresh_token_enc,
      token_last4,
      expires_at,
      status,
      created_at,
      updated_at
    ) VALUES (?,?,?,?,?,?,?,NOW(),NOW())
    ON DUPLICATE KEY UPDATE
      mp_user_id=VALUES(mp_user_id),
      access_token_enc=VALUES(access_token_enc),
      refresh_token_enc=VALUES(refresh_token_enc),
      token_last4=VALUES(token_last4),
      expires_at=VALUES(expires_at),
      status=VALUES(status),
      updated_at=VALUES(updated_at)
    `, [
      id, mpUserId || null, accessTokenEnc || null, refreshTokenEnc || null, tokenLast4 || null, expiresAt || null, status, ]
  );
return getMpAccountByEstabelecimentoId(id);
}

export async function disconnectMpAccount(estabelecimentoId) {
const id = normalizeId(estabelecimentoId);
if (!id) return { ok: false };
const [result] = await pool.query(
    `UPDATE mercadopago_accounts
        SET status='revoked',
            access_token_enc=NULL,
            refresh_token_enc=NULL,
            token_last4=NULL,
            expires_at=NULL,
            updated_at=NOW()
      WHERE estabelecimento_id=?`, [id] );
return { ok: result?.affectedRows > 0 };
}

export async function resolveMpAccessToken(estabelecimentoId, { allowFallback = isMpDepositFallbackAllowed() } = {}) {
const account = await getMpAccountByEstabelecimentoId(estabelecimentoId);
if (account && account.status === 'connected' && account.access_token_enc) {
const expiresAt = account.expires_at ? new Date(account.expires_at) : null;
if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
return { accessToken: null, account, reason: 'expired', allowFallback };
}
    try {
const token = decryptMpToken(account.access_token_enc);
return { accessToken: token, account, reason: null, allowFallback };
} catch (err) {
return { accessToken: null, account, reason: 'decrypt_failed', error: err, allowFallback };
}
  } return { accessToken : null, account, reason: account  'not_connected' : 'not_found', allowFallback };
}



