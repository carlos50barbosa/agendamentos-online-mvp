import { pool } from '../lib/db.js';
const normalizeId = (value) => {
const n = Number(value);
if (!Number.isFinite(n)) return null;
return Math.trunc(n);
};
export async function getWaAccountByEstabelecimentoId(estabelecimentoId) {
const id = normalizeId(estabelecimentoId);
if (!id) return null;
const [[row]] = await pool.query(
    `SELECT id, estabelecimento_id, waba_id, phone_number_id, display_phone_number, business_id,
            access_token_enc, token_last4, status, connected_at, updated_at
       FROM wa_accounts
      WHERE estabelecimento_id= LIMIT 1`, [id] );
return row || null;
}

export async function getWaAccountByPhoneNumberId(phoneNumberId) {
if (!phoneNumberId) return null;
const [[row]] = await pool.query(
    `SELECT id, estabelecimento_id, waba_id, phone_number_id, display_phone_number, business_id,
            access_token_enc, token_last4, status, connected_at, updated_at
       FROM wa_accounts
      WHERE phone_number_id= LIMIT 1`, [String(phoneNumberId)] );
return row || null;
}

export async function upsertWaAccount({
estabelecimentoId, wabaId, phoneNumberId, displayPhoneNumber, businessId, accessTokenEnc, tokenLast4, status = 'connected', connectedAt = new Date(), }) {
const id = normalizeId(estabelecimentoId);
if (!id || !phoneNumberId) throw new Error('missing_estabelecimento_or_phone');
await pool.query(
    `
    INSERT INTO wa_accounts (
      estabelecimento_id,
      waba_id,
      phone_number_id,
      display_phone_number,
      business_id,
      access_token_enc,
      token_last4,
      status,
      connected_at,
      updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,NOW())
    ON DUPLICATE KEY UPDATE
      waba_id=VALUES(waba_id),
      phone_number_id=VALUES(phone_number_id),
      display_phone_number=VALUES(display_phone_number),
      business_id=VALUES(business_id),
      access_token_enc=VALUES(access_token_enc),
      token_last4=VALUES(token_last4),
      status=VALUES(status),
      connected_at=VALUES(connected_at),
      updated_at=VALUES(updated_at)
    `, [
      id, wabaId || null, String(phoneNumberId), displayPhoneNumber || null, businessId || null, accessTokenEnc || null, tokenLast4 || null, status, connectedAt, ]
  );
return getWaAccountByEstabelecimentoId(id);
}

export async function disconnectWaAccount(estabelecimentoId) {
const id = normalizeId(estabelecimentoId);
if (!id) return { ok: false };
const [result] = await pool.query(
    `UPDATE wa_accounts
        SET status='disconnected',
            access_token_enc=NULL,
            token_last4=NULL,
            updated_at=NOW()
      WHERE estabelecimento_id=?`, [id] );
return { ok: result?.affectedRows > 0 };
}

export async function recordWaMessage({
estabelecimentoId, direction, waId, wamid, phoneNumberId, payload, status, }) {
const id = normalizeId(estabelecimentoId);
if (!id || !direction) return { ok: false };
const payloadJson = payload ? JSON.stringify(payload) : null;
await pool.query(
    `INSERT INTO wa_messages (
      estabelecimento_id,
      direction,
      wa_id,
      wamid,
      phone_number_id,
      payload_json,
      status,
      created_at
    ) VALUES (?,?,?,?,?,?,?,NOW())`, [
      id, direction, waId ? String(waId) : null, wamid ? String(wamid) : null, phoneNumberId ? String(phoneNumberId) : null, payloadJson, status || null, ]
  );
return { ok: true };
}


