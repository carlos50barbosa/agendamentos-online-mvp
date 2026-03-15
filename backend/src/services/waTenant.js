import { pool } from '../lib/db.js';

const ACCOUNT_FIELDS = [
  'provider',
  'waba_id',
  'phone_number_id',
  'display_phone_number',
  'verified_name',
  'business_id',
  'access_token_enc',
  'token_last4',
  'status',
  'connected_at',
  'disconnected_at',
  'token_last_validated_at',
  'last_sync_at',
  'last_error',
  'metadata_json',
];

const DEFAULT_ACCOUNT_VALUES = Object.freeze({
  provider: 'meta_cloud',
  waba_id: null,
  phone_number_id: null,
  display_phone_number: null,
  verified_name: null,
  business_id: null,
  access_token_enc: null,
  token_last4: null,
  status: 'disconnected',
  connected_at: null,
  disconnected_at: null,
  token_last_validated_at: null,
  last_sync_at: null,
  last_error: null,
  metadata_json: null,
});

const normalizeId = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeMetadata(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseMetadata(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function hydrateAccountRow(row) {
  if (!row) return null;
  const metadata = parseMetadata(row.metadata_json);
  return {
    ...row,
    metadata_json: metadata,
    metadata,
  };
}

function buildNextAccount(existing, payload = {}) {
  const next = {
    ...DEFAULT_ACCOUNT_VALUES,
    ...(existing || {}),
  };
  for (const field of ACCOUNT_FIELDS) {
    if (!hasOwn(payload, field)) continue;
    if (field === 'metadata_json') {
      next.metadata_json = normalizeMetadata(payload.metadata_json);
      continue;
    }
    next[field] = payload[field];
  }
  return next;
}

async function selectAccountBySql(sql, params) {
  const [[row]] = await pool.query(sql, params);
  return hydrateAccountRow(row || null);
}

export async function getWaAccountByEstabelecimentoId(estabelecimentoId) {
  const id = normalizeId(estabelecimentoId);
  if (!id) return null;
  return selectAccountBySql(
    `SELECT id, estabelecimento_id, provider, waba_id, phone_number_id, display_phone_number,
            verified_name, business_id, access_token_enc, token_last4, status, connected_at,
            disconnected_at, token_last_validated_at, last_sync_at, last_error, metadata_json,
            created_at, updated_at
       FROM wa_accounts
      WHERE estabelecimento_id=? LIMIT 1`,
    [id]
  );
}

export async function getWaAccountByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  return selectAccountBySql(
    `SELECT id, estabelecimento_id, provider, waba_id, phone_number_id, display_phone_number,
            verified_name, business_id, access_token_enc, token_last4, status, connected_at,
            disconnected_at, token_last_validated_at, last_sync_at, last_error, metadata_json,
            created_at, updated_at
       FROM wa_accounts
      WHERE phone_number_id=? LIMIT 1`,
    [String(phoneNumberId)]
  );
}

export async function upsertWaAccount(estabelecimentoId, payload = {}) {
  const id = normalizeId(estabelecimentoId);
  if (!id) throw new Error('missing_estabelecimento');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existingRow]] = await conn.query(
      `SELECT id, estabelecimento_id, provider, waba_id, phone_number_id, display_phone_number,
              verified_name, business_id, access_token_enc, token_last4, status, connected_at,
              disconnected_at, token_last_validated_at, last_sync_at, last_error, metadata_json,
              created_at, updated_at
         FROM wa_accounts
        WHERE estabelecimento_id=?
        LIMIT 1
        FOR UPDATE`,
      [id]
    );

    const existing = hydrateAccountRow(existingRow || null);
    const next = buildNextAccount(existing, payload);
    const metadataJson = normalizeMetadata(next.metadata_json);

    if (existing) {
      await conn.query(
        `UPDATE wa_accounts
            SET provider=?,
                waba_id=?,
                phone_number_id=?,
                display_phone_number=?,
                verified_name=?,
                business_id=?,
                access_token_enc=?,
                token_last4=?,
                status=?,
                connected_at=?,
                disconnected_at=?,
                token_last_validated_at=?,
                last_sync_at=?,
                last_error=?,
                metadata_json=?,
                updated_at=NOW()
          WHERE estabelecimento_id=?`,
        [
          next.provider,
          next.waba_id,
          next.phone_number_id,
          next.display_phone_number,
          next.verified_name,
          next.business_id,
          next.access_token_enc,
          next.token_last4,
          next.status,
          next.connected_at,
          next.disconnected_at,
          next.token_last_validated_at,
          next.last_sync_at,
          next.last_error,
          metadataJson,
          id,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO wa_accounts (
          estabelecimento_id,
          provider,
          waba_id,
          phone_number_id,
          display_phone_number,
          verified_name,
          business_id,
          access_token_enc,
          token_last4,
          status,
          connected_at,
          disconnected_at,
          token_last_validated_at,
          last_sync_at,
          last_error,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
        [
          id,
          next.provider,
          next.waba_id,
          next.phone_number_id,
          next.display_phone_number,
          next.verified_name,
          next.business_id,
          next.access_token_enc,
          next.token_last4,
          next.status,
          next.connected_at,
          next.disconnected_at,
          next.token_last_validated_at,
          next.last_sync_at,
          next.last_error,
          metadataJson,
        ]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return getWaAccountByEstabelecimentoId(id);
}

export async function disconnectWaAccount(estabelecimentoId, options = {}) {
  const id = normalizeId(estabelecimentoId);
  if (!id) return { ok: false };

  const clearPhoneNumber = options.clearPhoneNumber === true;
  const [result] = await pool.query(
    `UPDATE wa_accounts
        SET status='disconnected',
            access_token_enc=NULL,
            token_last4=NULL,
            disconnected_at=NOW(),
            last_error=NULL,
            updated_at=NOW(),
            phone_number_id=CASE WHEN ? THEN NULL ELSE phone_number_id END
      WHERE estabelecimento_id=?`,
    [clearPhoneNumber ? 1 : 0, id]
  );
  return { ok: result?.affectedRows > 0 };
}

export async function releaseWaPhoneNumberFromAccount(estabelecimentoId) {
  const id = normalizeId(estabelecimentoId);
  if (!id) return { ok: false };
  const [result] = await pool.query(
    `UPDATE wa_accounts
        SET phone_number_id=NULL,
            access_token_enc=NULL,
            token_last4=NULL,
            updated_at=NOW()
      WHERE estabelecimento_id=?`,
    [id]
  );
  return { ok: result?.affectedRows > 0 };
}

export async function recordWaMessage({
  estabelecimentoId,
  direction,
  waId,
  wamid,
  phoneNumberId,
  payload,
  status,
}) {
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
    ) VALUES (?,?,?,?,?,?,?,NOW())`,
    [
      id,
      direction,
      waId ? String(waId) : null,
      wamid ? String(wamid) : null,
      phoneNumberId ? String(phoneNumberId) : null,
      payloadJson,
      status || null,
    ]
  );
  return { ok: true };
}
