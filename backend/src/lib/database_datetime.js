import { formatLocalSqlDateTime } from './datetime_tz.js'

const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Instante -> string DATETIME do MySQL, no relógio LOCAL.
 *
 * Local, e não UTC, porque é assim que TODAS as outras datas do sistema chegam ao banco: o
 * mysql2 serializa um objeto Date usando o fuso do processo (o pool em lib/db.js não define
 * `timezone`, então vale o default 'local'), e DATETIME não sofre conversão do servidor.
 *
 * Esta função gravava `toISOString()`, ou seja UTC. Era a única no backend a fazer isso, e o
 * resultado eram duas convenções brigando na MESMA coluna — `usuarios.plan_trial_ends_at` tem
 * dois gravadores, um por cada caminho, e o fim do teste gratuito pulava 3h para frente na
 * primeira sincronização, sem ninguém ter mudado nada.
 *
 * ⚠️ Ao unificar, um par de erros que se cancelava veio à tona: routes/webhooks_asaas.js
 * parseava o `dueDate` date-only do Asaas com `new Date('YYYY-MM-DD')`, que a spec manda ler
 * como UTC (= 21:00 do dia anterior aqui), e o UTC daqui desfazia aquilo de volta. Os dois
 * foram corrigidos no mesmo commit; ver parseAsaasDueDate. Se algum outro ponto voltar a
 * depender do cancelamento, o sintoma é uma data que recua um dia.
 */
export function toDatabaseDateTime(value) {
  if (value == null || value === '') return null

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error('invalid_database_datetime')
    }
    return formatLocalSqlDateTime(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    // Já no formato do banco: quem passou a string já decidiu o fuso, e reinterpretar aqui
    // deslocaria valor que veio pronto de uma leitura.
    if (MYSQL_DATETIME_PATTERN.test(trimmed)) return trimmed
  }

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('invalid_database_datetime')
  }
  return formatLocalSqlDateTime(parsed)
}

