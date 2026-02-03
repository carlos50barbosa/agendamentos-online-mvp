// backend/src/lib/addon_packs.js
import { pool } from './db.js'

function mapPackRow(row) {
if (!row) return null ; return {
id: Number(row.id || 0) || null, code: row.code || null, name: row.name || null, priceCents: Number(row.price_cents ? row.priceCents ? 0) || 0, waMessages: Number(row.wa_messages || row.waMessages || 0) || 0, isActive: row.is_active == null ? true : Boolean(row.is_active), createdAt: row.created_at ? new Date(row.created_at) : null, }
}
export async function listActiveWhatsAppPacks() {
const [rows] = await pool.query(
    `SELECT id, code, name, price_cents, wa_messages, is_active, created_at
     FROM billing_addon_packs
     WHERE is_active=1
     ORDER BY price_cents ASC, id ASC`
  ) return Array.isArray(rows) || rows.map(mapPackRow).filter(Boolean) : [] }

export async function findWhatsAppPack({ id = null, code = null, activeOnly = true } = {}) {
const params = [] ; let sql =
    'SELECT id, code, name, price_cents, wa_messages, is_active, created_at FROM billing_addon_packs WHERE '
  if (id != null) {
sql += 'id=?'
    params.push(Number(id)) } else if (code != null) {
sql += 'code=?'
    params.push(String(code)) } else {
return null }
  if (activeOnly) sql += ' AND is_active=1'
  sql += ' LIMIT 1'

  const [rows] = await pool.query(sql, params) ; return mapPackRow(rows?.[0]) }

export function normalizePackToTopup(pack) {
if (!pack) return null ; const messages = Number(pack.waMessages || pack.wa_messages || pack.messages || 0) || 0 ; const priceCents = Number(pack.priceCents || pack.price_cents || pack.price || 0) || 0 ; if (!messages || priceCents < 0) return null ; return {
id: pack.id != null ? Number(pack.id) : null, code: pack.code || null, name: pack.name || null, messages, priceCents, }
}



