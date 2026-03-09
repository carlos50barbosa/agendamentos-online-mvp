// backend/src/lib/wa_store.js
import { pool } from './db.js';

let initialized = false;

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_legacy_sessions (
      phone VARCHAR(32) PRIMARY KEY,
      state JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_links (
      token VARCHAR(128) PRIMARY KEY,
      phone VARCHAR(32) NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      used_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function initWAStore() {
  try {
    await ensureTables();
    initialized = true;
  } catch (e) {
    console.error('[wa_store] ensureTables', e);
  }
}

async function ensureInit() {
  if (initialized) return;
  await initWAStore();
}

export async function getSession(phone) {
  await ensureInit();
  const [rows] = await pool.query('SELECT state FROM wa_legacy_sessions WHERE phone=? LIMIT 1', [phone]);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].state); } catch { return null; }
}

export async function setSession(phone, state) {
  await ensureInit();
  const json = JSON.stringify(state || {});
  await pool.query(
    'INSERT INTO wa_legacy_sessions (phone, state) VALUES (?,?) ON DUPLICATE KEY UPDATE state=VALUES(state), updated_at=CURRENT_TIMESTAMP',
    [phone, json]
  );
}

export async function clearSession(phone) {
  await ensureInit();
  await pool.query('DELETE FROM wa_legacy_sessions WHERE phone=?', [phone]);
}

export async function createLinkToken(phone, token) {
  await ensureInit();
  await pool.query('INSERT INTO wa_links (token, phone) VALUES (?,?) ON DUPLICATE KEY UPDATE phone=VALUES(phone), used=0, created_at=CURRENT_TIMESTAMP, used_at=NULL', [token, phone]);
}

export async function consumeLinkToken(token) {
  await ensureInit();
  const [rows] = await pool.query('SELECT token, phone, used FROM wa_links WHERE token=? LIMIT 1', [token]);
  const row = rows?.[0];
  if (!row || row.used) return null;
  await pool.query('UPDATE wa_links SET used=1, used_at=CURRENT_TIMESTAMP WHERE token=?', [token]);
  return { phone: row.phone };
}

