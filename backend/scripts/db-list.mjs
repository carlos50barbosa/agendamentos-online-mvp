// backend/scripts/db-list.mjs — diagnóstico read-only: lista databases e checa aguser.
//   Uso: PROBE_PORT=3306 PROBE_USER=root PROBE_PASS= node scripts/db-list.mjs
import mysql from 'mysql2/promise'

const port = Number(process.env.PROBE_PORT || 3306)
const user = process.env.PROBE_USER || 'root'
const password = process.env.PROBE_PASS || ''

try {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port, user, password })
  const [dbs] = await conn.query('SHOW DATABASES')
  const names = dbs.map((r) => Object.values(r)[0])
  console.log(`✅ ${user}@127.0.0.1:${port} conectou. Databases: ${names.join(', ')}`)
  console.log('   tem "agendamentos"?', names.includes('agendamentos'))
  try {
    const [users] = await conn.query("SELECT User, Host FROM mysql.user WHERE User='aguser'")
    console.log('   aguser existe?', users.length > 0, JSON.stringify(users))
  } catch (e) {
    console.log('   (sem acesso a mysql.user:', e.code, ')')
  }
  await conn.end()
} catch (e) {
  console.error(`❌ ${user}@127.0.0.1:${port} falhou:`, e?.code || '', e?.message || e)
  process.exitCode = 1
}
