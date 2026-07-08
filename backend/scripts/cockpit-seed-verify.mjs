// backend/scripts/cockpit-seed-verify.mjs — READ-ONLY. Confere se o seed aparece
// como o backend/cockpit vão ler: replica o SELECT de /agendamentos/estabelecimento
// (join de cliente/profissional) + itens de serviço, para as agendas de hoje.
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.pass, database: config.db.name,
})
const pad2 = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad2(new Date(d).getHours())}:${pad2(new Date(d).getMinutes())}`

try {
  const [[estab]] = await conn.query(
    "SELECT id FROM usuarios WHERE tipo='estabelecimento' AND nome LIKE '%Barbearia Teste%' LIMIT 1"
  )
  const ESTAB = estab.id
  const [rows] = await conn.query(
    `SELECT a.id, a.inicio, a.fim, a.status, a.total_centavos, a.deposit_centavos, a.deposit_paid_at,
            a.cliente_confirmou_whatsapp_at AS wa,
            u.nome AS cliente_nome, p.nome AS profissional_nome
       FROM agendamentos a
       JOIN usuarios u ON u.id = a.cliente_id
       LEFT JOIN profissionais p ON p.id = a.profissional_id
      WHERE a.estabelecimento_id=? AND DATE(a.inicio)=CURDATE() AND a.origem='cockpit_seed'
      ORDER BY p.nome, a.inicio`,
    [ESTAB]
  )
  const [items] = await conn.query(
    `SELECT ai.agendamento_id, s.nome
       FROM agendamento_itens ai JOIN servicos s ON s.id = ai.servico_id
      WHERE ai.agendamento_id IN (${rows.map(() => '?').join(',') || 'NULL'})`,
    rows.map((r) => r.id)
  )
  const svcByAppt = {}
  for (const it of items) (svcByAppt[it.agendamento_id] ||= []).push(it.nome)

  const now = Date.now()
  const table = rows.map((r) => ({
    profissional: r.profissional_nome || '(sem lane)',
    horario: `${hhmm(r.inicio)}–${hhmm(r.fim)}`,
    cliente: r.cliente_nome,
    servico: (svcByAppt[r.id] || []).join(' + ') || '(sem item!)',
    status: r.status,
    WA: r.wa ? 'sim' : '',
    sinal: r.deposit_paid_at ? `R$${(r.deposit_centavos / 100).toFixed(0)}` : '',
    agora: new Date(r.inicio).getTime() <= now && new Date(r.fim).getTime() > now ? '⬅ AGORA' : '',
  }))
  console.table(table)

  const semItem = rows.filter((r) => !svcByAppt[r.id]).length
  const agora = table.filter((t) => t.agora).length
  console.log(`Total seed hoje: ${rows.length} | sem item de serviço: ${semItem} | acontecendo agora: ${agora}`)
} finally {
  await conn.end()
}
