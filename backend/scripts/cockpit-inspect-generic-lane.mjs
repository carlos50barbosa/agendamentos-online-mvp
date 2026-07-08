// READ-ONLY: mostra os agendamentos de HOJE SEM profissional (a lane "Atendimentos"),
// para entender os "Cliente Teste" repetidos.
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'
const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.pass, database: config.db.name,
})
const hhmm = (d) => { const x = new Date(d); return `${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}` }
try {
  const [[e]] = await conn.query("SELECT id FROM usuarios WHERE tipo='estabelecimento' AND nome LIKE '%Barbearia Teste%' LIMIT 1")
  const [rows] = await conn.query(
    `SELECT a.id, u.nome AS cliente, a.inicio, a.fim, a.status, a.profissional_id, a.origem, a.criado_em
       FROM agendamentos a JOIN usuarios u ON u.id=a.cliente_id
      WHERE a.estabelecimento_id=? AND DATE(a.inicio)=CURDATE()
      ORDER BY a.profissional_id IS NULL DESC, a.inicio, a.id`, [e.id]
  )
  const semProf = rows.filter(r => r.profissional_id == null)
  console.log(`Hoje: ${rows.length} agendamentos | sem profissional (lane "Atendimentos"): ${semProf.length}`)
  console.table(semProf.map(r => ({
    id: r.id, cliente: r.cliente, horario: `${hhmm(r.inicio)}–${hhmm(r.fim)}`,
    status: r.status, origem: r.origem || '(nulo)', criado_em: r.criado_em && new Date(r.criado_em).toISOString().slice(0,16),
  })))
  const canceladosSemProf = semProf.filter(r => String(r.status).includes('cancel')).length
  console.log(`Destes, cancelados: ${canceladosSemProf} | do meu seed (origem=cockpit_seed): ${semProf.filter(r=>r.origem==='cockpit_seed').length}`)
} finally { await conn.end() }
