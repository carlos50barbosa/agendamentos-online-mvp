// backend/src/lib/db.js
import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
})

// Isolamento fixado por sessao, nao herdado do my.cnf.
//
// Toda a defesa contra dupla-marcacao depende de GAP LOCK: os guards de slot
// (`lib/service_capacity.js`) e de bloqueio (`routes/slots.js`) leem uma faixa que
// normalmente esta VAZIA e contam com o lock do intervalo vazio para o concorrente nao
// conseguir inserir dentro dele. Gap lock so existe a partir de REPEATABLE READ. Num
// servidor configurado com READ COMMITTED as duas transacoes leem "livre", as duas gravam e
// ninguem recebe 409 — agendamento por cima de bloqueio, e bloqueio por cima de agendamento,
// em silencio e sem erro nenhum no log. Como isso e configuracao de servidor (uma linha no
// my.cnf que ninguem daqui controla), fixamos na conexao em vez de torcer pelo default.
//
// A forma SQL padrao e de proposito: a variavel `transaction_isolation` nao existe em MariaDB
// < 11.1 e `tx_isolation` foi removida no MySQL 8 — `SET SESSION TRANSACTION ISOLATION LEVEL`
// funciona nos dois. O handler roda no evento 'connection', que o mysql2 emite ANTES de
// entregar a conexao, entao o SET entra na fila do socket na frente de qualquer query nossa.
pool.on('connection', (connection) => {
  connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', (err) => {
    // Nao derruba a conexao: sem isolamento fixado o sistema continua de pe (e correto se o
    // servidor ja for REPEATABLE READ). O log e o sinal de que os guards estao sem rede.
    if (err) console.error('[db] falha ao fixar REPEATABLE READ na conexao:', err.code || err.message)
  })
})

// Erros de lock que valem uma nova tentativa: a transacao morreu por CONTENCAO, nao por dado
// invalido, entao repetir do zero tende a passar. 1213 = ER_LOCK_DEADLOCK (o InnoDB escolheu
// esta transacao como vitima do ciclo), 1205 = ER_LOCK_WAIT_TIMEOUT.
const RETRIABLE_LOCK_ERRNOS = new Set([1213, 1205])
const RETRIABLE_LOCK_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])

export function isRetriableLockError(err) {
  if (!err) return false
  if (RETRIABLE_LOCK_ERRNOS.has(err.errno) || RETRIABLE_LOCK_CODES.has(err.code)) return true
  const message = String(err.message || '').toLowerCase()
  return message.includes('deadlock') || message.includes('lock wait timeout')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Roda `work` dentro de uma transacao, repetindo quando o InnoDB mata a transacao por
 * deadlock/lock wait. `work(conn)` devolve `{ commit, value }` — `commit: false` faz ROLLBACK
 * e NAO e tentativa de novo (e uma decisao de negocio, tipo "achei conflito, devolve 409").
 *
 * Existe porque a alternativa e devolver 500 para o dono no meio de uma acao que so precisava
 * ser refeita: contencao aqui e milissegundos, e quem perdeu a corrida perdeu por azar.
 */
export async function withTransactionRetry(work, { attempts = 3, opName = 'tx' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const outcome = await work(conn)
      if (outcome && outcome.commit === false) await conn.rollback()
      else await conn.commit()
      return outcome ? outcome.value : undefined
    } catch (err) {
      try { await conn.rollback() } catch { /* conexao ja perdida; o release cuida do resto */ }
      if (attempt >= attempts || !isRetriableLockError(err)) throw err
      console.warn('[db] retry por lock', { op: opName, attempt, code: err?.code, errno: err?.errno })
      // Backoff com jitter: sem o jitter as duas vitimas voltam juntas e colidem de novo.
      await sleep(50 * attempt + Math.round(Math.random() * 50))
    } finally {
      conn.release()
    }
  }
}
