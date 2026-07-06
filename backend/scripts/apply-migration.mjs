// backend/scripts/apply-migration.mjs
// Aplicador de migração idempotente: executa cada statement de um arquivo .sql,
// tolerando "coluna/índice já existe" (re-run seguro). Usa a MESMA conexão do app.
//   Uso (na pasta backend/):  node scripts/apply-migration.mjs [caminho.sql]
import fs from 'node:fs'
import { pool } from '../src/lib/db.js'

const file = process.argv[2] || 'sql/2026-07-05-add-asaas-split-sinal.sql'

const raw = fs.readFileSync(file, 'utf8')
const cleaned = raw
  .split('\n')
  .filter((line) => !/^\s*--/.test(line) && !/^\s*USE\s/i.test(line))
  .join('\n')
const statements = cleaned.split(';').map((s) => s.trim()).filter(Boolean)

const DUP = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'])

async function columnsReport() {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          (TABLE_NAME='establishment_settings' AND COLUMN_NAME IN ('asaas_wallet_id','wallet_verified_at','deposit_type','deposit_fixed_centavos','deposit_min_centavos','deposit_max_centavos','refund_window_hours','retain_on_no_show'))
          OR (TABLE_NAME='appointment_payments' AND COLUMN_NAME IN ('split_centavos','platform_fee_centavos','asaas_fee_centavos','refunded_at','refund_initiated_by_cancellation'))
          OR (TABLE_NAME='asaas_webhook_events' AND COLUMN_NAME IN ('payload','processed_at','error'))
        )
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  )
  return rows.map((r) => `${r.t}.${r.c}`)
}

try {
  console.log(`Arquivo: ${file}`)
  console.log(`Colunas ANTES (${(await columnsReport()).length}):`, (await columnsReport()).join(', ') || '(nenhuma)')
  console.log(`\nExecutando ${statements.length} statement(s)...`)
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 70)
    try {
      await pool.query(stmt)
      console.log('  OK  :', label, '...')
    } catch (e) {
      if (DUP.has(e?.code)) {
        console.log('  SKIP: já aplicado —', label, '...')
      } else {
        throw e
      }
    }
  }
  const after = await columnsReport()
  console.log(`\nColunas DEPOIS (${after.length}):`, after.join(', '))
  console.log('\n✅ Migração aplicada.')
} catch (e) {
  console.error('\n❌ Erro na migração:', e?.message || e)
  if (e?.code) console.error('   code:', e.code)
  process.exitCode = 1
} finally {
  await pool.end()
}
