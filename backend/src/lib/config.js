// backend/src/config.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

function getAny(...names) {
  for (const n of names) {
    let v = process.env[n]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim() // remove espaços finais/acidentais
    }
  }
  return undefined
}
function requireAny(...names) {
  const v = getAny(...names)
  if (!v) throw new Error(`ENV ausente: ${names.join(' | ')}`)
  return v
}

export const config = {
  db: {
    host: requireAny('DB_HOST', 'MYSQL_HOST'),
    port: Number(getAny('DB_PORT', 'MYSQL_PORT') || 3306),
    user: requireAny('DB_USER', 'MYSQL_USER'),
    pass: requireAny('DB_PASS', 'MYSQL_PASSWORD'),
    name: requireAny('DB_NAME', 'MYSQL_DATABASE'),
  },
  app: {
    port: Number(getAny('PORT') || 3002),
    jwtSecret: requireAny('JWT_SECRET'),
  }
}
