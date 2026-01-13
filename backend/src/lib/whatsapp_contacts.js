// backend/src/lib/whatsapp_contacts.js
import { pool } from './db.js';

let ensured = false;
let ensurePromise = null;

const toDigits = (value) => String(value || '').replace(/\D/g, '');

function normalizeRecipientId(value) {
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

async function ensureTables() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_contacts (
        recipient_id VARCHAR(32) PRIMARY KEY,
        cliente_id INT NULL,
        last_inbound_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_whatsapp_contacts_cliente (cliente_id),
        INDEX idx_whatsapp_contacts_last_inbound (last_inbound_at),
        CONSTRAINT fk_whatsapp_contacts_cliente
          FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `).then(() => {
      ensured = true;
    }).catch((err) => {
      ensurePromise = null;
      console.warn('[wa_contacts] ensureTables failed', err?.message || err);
    });
  }
  await ensurePromise;
}

export async function initWhatsAppContacts() {
  await ensureTables();
}

async function resolveClienteIdByPhone(recipientId) {
  const normalized = normalizeRecipientId(recipientId);
  if (!normalized) return null;
  const candidates = new Set([normalized]);
  if (normalized.startsWith('55')) {
    candidates.add(normalized.slice(2));
  }
  const values = Array.from(candidates);
  if (!values.length) return null;
  const placeholders = values.map(() => '?').join(', ');
  try {
    const [rows] = await pool.query(
      `SELECT id FROM usuarios WHERE telefone IN (${placeholders}) LIMIT 1`,
      values
    );
    return rows?.[0]?.id || null;
  } catch (err) {
    console.warn('[wa_contacts] resolveClienteId failed', err?.message || err);
    return null;
  }
}

export async function recordWhatsAppInbound({ recipientId, clienteId }) {
  await ensureTables();
  const waId = normalizeRecipientId(recipientId);
  if (!waId) return { ok: false, error: 'invalid_recipient' };
  let resolvedClienteId = clienteId || null;
  if (!resolvedClienteId) {
    resolvedClienteId = await resolveClienteIdByPhone(waId);
  }
  try {
    await pool.query(
      `INSERT INTO whatsapp_contacts (recipient_id, cliente_id, last_inbound_at)
       VALUES (?,?, NOW())
       ON DUPLICATE KEY UPDATE
         last_inbound_at=VALUES(last_inbound_at),
         cliente_id=COALESCE(VALUES(cliente_id), cliente_id),
         updated_at=CURRENT_TIMESTAMP`,
      [waId, resolvedClienteId]
    );
    return { ok: true, recipient_id: waId, cliente_id: resolvedClienteId };
  } catch (err) {
    console.warn('[wa_contacts] recordInbound failed', err?.message || err);
    return { ok: false, error: err?.message || 'record_failed' };
  }
}

export async function getWhatsAppLastInboundAt(recipientId) {
  await ensureTables();
  const waId = normalizeRecipientId(recipientId);
  if (!waId) return null;
  try {
    const [[row]] = await pool.query(
      'SELECT last_inbound_at FROM whatsapp_contacts WHERE recipient_id=? LIMIT 1',
      [waId]
    );
    return row?.last_inbound_at || null;
  } catch (err) {
    console.warn('[wa_contacts] getLastInbound failed', err?.message || err);
    return null;
  }
}

export function isWhatsAppWindowOpen(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return false;
  const last = new Date(lastInboundAt);
  if (Number.isNaN(last.getTime())) return false;
  const diffMs = now.getTime() - last.getTime();
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}
