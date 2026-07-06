// backend/scripts/migrate.mjs
// Runner de migrações com RASTREIO (tabela schema_migrations), forward-only.
// Aplica, em ordem, cada sql/*.sql (exceto schema.sql) ainda não registrado, executando
// o arquivo inteiro numa conexão com multipleStatements (o mysql2 divide corretamente,
// respeitando `;` dentro de comentários/strings). Qualquer erro aborta o processo — o
// deploy usa `set -e`, então ele para e NÃO recarrega uma API contra um schema quebrado.
//
// Uso (na pasta backend/):
//   node scripts/migrate.mjs             -> aplica as pendentes
//   node scripts/migrate.mjs --baseline  -> marca TODAS como aplicadas SEM rodar (bootstrap
//                                            de um banco que já tem o histórico aplicado)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'

const SQL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql')
const baseline = process.argv.includes('--baseline')

const migrationFiles = () =>
  fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql') && f !== 'schema.sql').sort()

const conn = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
  multipleStatements: true,
})

try {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  )
  const [doneRows] = await conn.query('SELECT filename FROM schema_migrations')
  const done = new Set(doneRows.map((r) => r.filename))
  const files = migrationFiles()

  if (baseline) {
    for (const f of files) await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [f])
    console.log(`✅ Baseline: ${files.length} migração(ões) marcadas como aplicadas (nada foi executado).`)
  } else {
    const pending = files.filter((f) => !done.has(f))
    if (!pending.length) {
      console.log('✅ Nenhuma migração pendente.')
    } else {
      console.log(`==> ${pending.length} migração(ões) pendente(s).`)
      for (const f of pending) {
        const sql = fs.readFileSync(path.join(SQL_DIR, f), 'utf8')
        try {
          await conn.query(sql)
        } catch (e) {
          console.error(`❌ Falha em ${f}: ${e?.message}`)
          throw e
        }
        await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [f])
        console.log(`  ✅ ${f}`)
      }
      console.log('✅ Migrações aplicadas.')
    }
  }
} catch (e) {
  console.error('❌ Erro nas migrações:', e?.message || e)
  process.exitCode = 1
} finally {
  await conn.end()
}
