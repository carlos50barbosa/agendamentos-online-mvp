// backend/scripts/db-probe.mjs — diagnóstico read-only de conexão/schema.
//   Uso: node scripts/db-probe.mjs [porta]   (default 3306)
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'

const port = Number(process.argv[2] || 3306)
try {
  const conn = await mysql.createConnection({
    host: config.db.host, port, user: config.db.user, password: config.db.pass, database: config.db.name,
  })
  const [[dbRow]] = await conn.query('SELECT DATABASE() AS db, VERSION() AS v')
  const want = ['establishment_settings', 'appointment_payments', 'asaas_webhook_events', 'agendamentos', 'usuarios']
  const found = {}
  for (const t of want) {
    const [rows] = await conn.query('SHOW TABLES LIKE ?', [t])
    found[t] = rows.length > 0
  }
  console.log(`✅ Conectado em ${config.db.host}:${port} | DATABASE()=${dbRow.db} | MySQL ${dbRow.v}`)
  console.log('Tabelas do app:', found)
  await conn.end()
} catch (e) {
  console.error(`❌ Falhou em ${config.db.host}:${port} —`, e?.code || '', e?.message || e)
  process.exitCode = 1
}
