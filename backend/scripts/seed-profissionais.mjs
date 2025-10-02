import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

// Carrega backend/.env
try {
  dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') })
} catch {}

const DB = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.DB_USER || process.env.MYSQL_USER || process.env.MYSQL_USERNAME,
  password: process.env.DB_PASS || process.env.MYSQL_PASSWORD,
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
}

function log(msg, obj) { console.log(msg, obj ?? '') }
function warn(msg, obj) { console.warn(msg, obj ?? '') }

async function ensureMigration(pool) {
  const [rows] = await pool.query("SHOW TABLES LIKE 'profissionais'")
  if (rows && rows.length) return
  const file = path.join(process.cwd(), 'backend', 'sql', '2025-10-06-add-profissionais.sql')
  const sql = fs.readFileSync(file, 'utf8')
  await runSqlBatch(pool, sql)
}

async function runSqlBatch(pool, text) {
  // naive split by ; lines, ignore comments and USE statements, keep engine options
  const stmts = []
  let acc = ''
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/--.*$/, '').trim()
    if (!line) continue
    if (/^USE\s+/i.test(line)) continue
    acc += (acc ? '\n' : '') + line
    if (acc.endsWith(';')) { stmts.push(acc.slice(0, -1)); acc = '' }
  }
  if (acc) stmts.push(acc)
  for (const sql of stmts) {
    await pool.query(sql)
  }
}

async function pickEstablishmentId(pool) {
  // try id 1
  let [[row]] = await pool.query("SELECT id FROM usuarios WHERE id=1 AND tipo='estabelecimento'")
  if (row?.id) return row.id
  // else pick first estabelecimento
  ;[[row]] = await pool.query("SELECT id FROM usuarios WHERE tipo='estabelecimento' ORDER BY id LIMIT 1")
  if (row?.id) return row.id
  throw new Error('Nenhum estabelecimento encontrado para seed.')
}

async function main() {
  const pool = mysql.createPool(DB)
  try {
    log('Conectando ao banco...', { host: DB.host, port: DB.port, db: DB.database })
    await ensureMigration(pool)
    const estId = await pickEstablishmentId(pool)
    log('Usando estabelecimento:', estId)

    const professionals = [
      { nome: 'Ana Souza', descricao: 'Especialista em cortes', ativo: 1 },
      { nome: 'Bruno Lima', descricao: 'Colorista', ativo: 1 },
      { nome: 'Carla Dias', descricao: 'Massoterapeuta', ativo: 1 },
    ]

    // insert professionals
    const createdIds = []
    for (const p of professionals) {
      const [r] = await pool.query(
        'INSERT INTO profissionais (estabelecimento_id, nome, descricao, avatar_url, ativo) VALUES (?,?,?,?,?)',
        [estId, p.nome, p.descricao || null, null, p.ativo ? 1 : 0]
      )
      createdIds.push(r.insertId)
    }
    log('Profissionais criados:', createdIds)

    // Link first existing service to two professionals (if any services exist)
    const [[svc]] = await pool.query('SELECT id FROM servicos WHERE estabelecimento_id=? ORDER BY id LIMIT 1', [estId])
    if (svc?.id) {
      await pool.query('DELETE FROM servico_profissionais WHERE servico_id=?', [svc.id])
      for (const pid of createdIds.slice(0, 2)) {
        await pool.query('INSERT INTO servico_profissionais (servico_id, profissional_id) VALUES (?,?)', [svc.id, pid])
      }
      log('Vinculos criados para servico', { servico_id: svc.id, profissionais: createdIds.slice(0, 2) })
    } else {
      warn('Nenhum servico encontrado para vincular. Pulei vinculos.')
    }

    log('Seed de profissionais concluido.')
    process.exit(0)
  } catch (e) {
    console.error('Falha no seed:', e?.message || e)
    process.exit(1)
  } finally {
    try { await pool.end() } catch {}
  }
}

main()
