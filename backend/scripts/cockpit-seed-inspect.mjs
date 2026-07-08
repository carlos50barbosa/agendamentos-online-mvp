// backend/scripts/cockpit-seed-inspect.mjs — READ-ONLY. Levanta o estado atual para
// planejar a semeadura do cockpit (/estab): estabelecimentos, serviços, profissionais,
// clientes reutilizáveis e agendamentos de hoje. Não escreve nada.
//   Uso: node scripts/cockpit-seed-inspect.mjs
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.pass, database: config.db.name,
})

try {
  const [estabs] = await conn.query(
    "SELECT id, nome, email FROM usuarios WHERE tipo='estabelecimento' ORDER BY id"
  )
  console.log('== ESTABELECIMENTOS ==')
  console.table(estabs)

  // Escolhe "Barbearia Teste" se existir; senão o primeiro estabelecimento.
  const target = estabs.find((e) => /barbearia\s*teste/i.test(e.nome)) || estabs[0]
  if (!target) {
    console.log('Nenhum estabelecimento encontrado.')
  } else {
    console.log(`\n== ALVO: #${target.id} — ${target.nome} ==`)

    const [servicos] = await conn.query(
      'SELECT id, nome, duracao_min, preco_centavos, ativo FROM servicos WHERE estabelecimento_id=? ORDER BY id',
      [target.id]
    )
    console.log('\n-- serviços --')
    console.table(servicos)

    const [profs] = await conn.query(
      'SELECT id, nome, ativo FROM profissionais WHERE estabelecimento_id=? ORDER BY id',
      [target.id]
    )
    console.log('\n-- profissionais --')
    console.table(profs)

    const [clientes] = await conn.query(
      "SELECT id, nome, telefone FROM usuarios WHERE tipo='cliente' ORDER BY id LIMIT 10"
    )
    console.log('\n-- clientes (para reuso como cliente_id) --')
    console.table(clientes)

    const [[hoje]] = await conn.query(
      `SELECT COUNT(*) AS total,
              SUM(status='cancelado') AS cancelados
         FROM agendamentos
        WHERE estabelecimento_id=? AND DATE(inicio)=CURDATE()`,
      [target.id]
    )
    console.log('\n-- agendamentos de HOJE --')
    console.table([hoje])
  }
} finally {
  await conn.end()
}
