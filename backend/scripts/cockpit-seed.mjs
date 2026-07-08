// backend/scripts/cockpit-seed.mjs — semeia dados de DEMO para o cockpit (/estab):
// 3 profissionais, 6 clientes e ~12 agendamentos de HOJE (concluídos, confirmados c/
// WhatsApp, pendentes, 1 cancelado, alguns com sinal Asaas pago e 1 acontecendo agora).
//
// Idempotente e NÃO-destrutivo: só mexe no que ele mesmo cria, identificado por
//   - agendamentos.origem = 'cockpit_seed'
//   - profissionais.descricao = '[seed cockpit]'
//   - usuarios.email LIKE '%@cockpit.local'
// Rodar de novo re-semeia do zero. Para LIMPAR: node scripts/cockpit-seed.mjs --clean
//
//   Uso: node scripts/cockpit-seed.mjs [--clean]
import mysql from 'mysql2/promise'
import { config } from '../src/lib/config.js'

const CLEAN_ONLY = process.argv.includes('--clean')
const SEED_TAG = 'cockpit_seed'
const PROF_TAG = '[seed cockpit]'
const CLIENT_DOMAIN = '@cockpit.local'
// Hash placeholder (não serve para login) — só para satisfazer senha_hash NOT NULL.
const PLACEHOLDER_HASH = '$2b$10$seedSEEDseedSEEDseedSEuFakeHashForCockpitSeedOnly00'

const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
const todayAt = (h, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.pass, database: config.db.name,
})

async function cleanup(estabId) {
  // Ordem importa por FKs: agendamentos (cascata p/ itens) -> profissionais -> clientes.
  const [a] = await conn.query(
    'DELETE FROM agendamentos WHERE estabelecimento_id=? AND origem=?', [estabId, SEED_TAG]
  )
  const [p] = await conn.query(
    'DELETE FROM profissionais WHERE estabelecimento_id=? AND descricao=?', [estabId, PROF_TAG]
  )
  const [c] = await conn.query(
    "DELETE FROM usuarios WHERE tipo='cliente' AND email LIKE ?", [`%${CLIENT_DOMAIN}`]
  )
  return { agendamentos: a.affectedRows, profissionais: p.affectedRows, clientes: c.affectedRows }
}

try {
  const [[estab]] = await conn.query(
    "SELECT id, nome FROM usuarios WHERE tipo='estabelecimento' AND nome LIKE '%Barbearia Teste%' ORDER BY id LIMIT 1"
  )
  if (!estab) throw new Error('Estabelecimento "Barbearia Teste" não encontrado.')
  const ESTAB = estab.id
  console.log(`Estabelecimento alvo: #${ESTAB} — ${estab.nome}`)

  await conn.beginTransaction()

  const removed = await cleanup(ESTAB)
  console.log('Limpeza de seed anterior:', removed)

  if (CLEAN_ONLY) {
    await conn.commit()
    console.log('✅ Somente limpeza concluída.')
  } else {
    const [servicos] = await conn.query(
      'SELECT id, nome, duracao_min, preco_centavos FROM servicos WHERE estabelecimento_id=? AND ativo=1 ORDER BY id',
      [ESTAB]
    )
    if (!servicos.length) throw new Error('Nenhum serviço ativo para semear agendas.')
    const svc = Object.fromEntries(servicos.map((s) => [s.nome, s]))
    const CORTE = svc['Corte Masculino'] || servicos[0]
    const BARBA = svc['Barba'] || servicos[servicos.length - 1]

    // --- Profissionais ---
    const profNames = ['Rafael Souza', 'Diego Martins', 'Bruno Lima']
    const profIds = []
    for (const nome of profNames) {
      const [r] = await conn.query(
        'INSERT INTO profissionais (estabelecimento_id, nome, descricao, ativo) VALUES (?,?,?,1)',
        [ESTAB, nome, PROF_TAG]
      )
      profIds.push(r.insertId)
    }
    // Vincula todos os profissionais a todos os serviços.
    for (const pid of profIds) {
      for (const s of servicos) {
        await conn.query(
          'INSERT IGNORE INTO servico_profissionais (servico_id, profissional_id) VALUES (?,?)',
          [s.id, pid]
        )
      }
    }
    const [rafael, diego, bruno] = profIds

    // --- Clientes ---
    const clientDefs = [
      { nome: 'João Vitor', slug: 'joao', tel: '5511990001111' },
      { nome: 'Pedro Santos', slug: 'pedro', tel: '5511990002222' },
      { nome: 'Marcos Antunes', slug: 'marcos', tel: '5511990003333' },
      { nome: 'Renata Oliveira', slug: 'renata', tel: '5511990004444' },
      { nome: 'Carla Teixeira', slug: 'carla', tel: '5511990005555' },
      { nome: 'Lucas Ferreira', slug: 'lucas', tel: '5511990006666' },
    ]
    const cli = {}
    for (const c of clientDefs) {
      const [r] = await conn.query(
        "INSERT INTO usuarios (nome, email, telefone, senha_hash, tipo) VALUES (?,?,?,?,'cliente')",
        [c.nome, `seed.${c.slug}${CLIENT_DOMAIN}`, c.tel, PLACEHOLDER_HASH]
      )
      cli[c.slug] = r.insertId
    }

    // --- Agendamentos de hoje ---
    async function addAppt({ cliente, prof, servico, start, status, wa = false, depositCent = 0 }) {
      const startDate = start instanceof Date ? start : new Date(start)
      const endDate = new Date(startDate.getTime() + servico.duracao_min * 60000)
      const waAt = wa ? fmt(new Date(startDate.getTime() - 60 * 60000)) : null
      const depPaid = depositCent > 0 ? fmt(new Date(startDate.getTime() - 120 * 60000)) : null
      const [r] = await conn.query(
        `INSERT INTO agendamentos
           (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status,
            total_centavos, deposit_required, deposit_centavos, deposit_paid_at,
            cliente_confirmou_whatsapp_at, origem)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          cliente, ESTAB, servico.id, prof, fmt(startDate), fmt(endDate), status,
          servico.preco_centavos, depositCent > 0 ? 1 : 0, depositCent > 0 ? depositCent : null,
          depPaid, waAt, SEED_TAG,
        ]
      )
      await conn.query(
        `INSERT INTO agendamento_itens (agendamento_id, servico_id, ordem, duracao_min, preco_snapshot)
         VALUES (?,?,1,?,?)`,
        [r.insertId, servico.id, servico.duracao_min, servico.preco_centavos]
      )
    }

    // "Acontecendo agora": começa ~15min atrás, dura 45min (na lane do Rafael).
    const liveStart = new Date()
    liveStart.setMinutes(liveStart.getMinutes() - 15, 0, 0)

    const plan = [
      // Rafael
      { cliente: cli.joao, prof: rafael, servico: CORTE, start: todayAt(9, 0), status: 'concluido' },
      { cliente: cli.pedro, prof: rafael, servico: BARBA, start: todayAt(11, 30), status: 'concluido' },
      { cliente: cli.marcos, prof: rafael, servico: CORTE, start: liveStart, status: 'confirmado', wa: true, depositCent: 5000 },
      // Diego
      { cliente: cli.renata, prof: diego, servico: CORTE, start: todayAt(10, 0), status: 'concluido' },
      { cliente: cli.carla, prof: diego, servico: BARBA, start: todayAt(14, 0), status: 'confirmado', wa: true, depositCent: 2500 },
      { cliente: cli.lucas, prof: diego, servico: CORTE, start: todayAt(16, 30), status: 'pendente' },
      { cliente: cli.joao, prof: diego, servico: CORTE, start: todayAt(18, 30), status: 'confirmado', wa: true },
      // Bruno
      { cliente: cli.pedro, prof: bruno, servico: BARBA, start: todayAt(9, 30), status: 'concluido' },
      { cliente: cli.marcos, prof: bruno, servico: CORTE, start: todayAt(13, 0), status: 'confirmado', wa: true, depositCent: 5000 },
      { cliente: cli.renata, prof: bruno, servico: CORTE, start: todayAt(15, 30), status: 'pendente' },
      { cliente: cli.carla, prof: bruno, servico: BARBA, start: todayAt(17, 30), status: 'cancelado' },
      { cliente: cli.lucas, prof: bruno, servico: BARBA, start: todayAt(19, 0), status: 'confirmado', wa: true },
    ]
    for (const appt of plan) await addAppt(appt)

    // Espalha agendamentos por outros dias, para as visões Semana e Mês terem dados.
    const dayAt = (offsetDays, h, m = 0) => {
      const d = new Date()
      d.setDate(d.getDate() + offsetDays)
      d.setHours(h, m, 0, 0)
      return d
    }
    const profCycle = [rafael, diego, bruno]
    const cliCycle = [cli.joao, cli.pedro, cli.marcos, cli.renata, cli.carla, cli.lucas]
    const svcCycle = [CORTE, BARBA]
    const spreadOffsets = [-14, -11, -10, -7, -6, -4, -3, -2, -1, 1, 2, 3, 4, 6, 9, 11, 14]
    let spreadCount = 0
    let k = 0
    for (const off of spreadOffsets) {
      const perDay = 2 + (Math.abs(off) % 2) // 2 ou 3 por dia
      for (let n = 0; n < perDay; n++) {
        const hour = 9 + ((k * 2 + n * 3) % 9) // 9..17
        const prof = profCycle[k % profCycle.length]
        const cliente = cliCycle[k % cliCycle.length]
        const servico = svcCycle[(k + n) % svcCycle.length]
        let status = 'confirmado'
        let wa = false
        let depositCent = 0
        if (off < 0) {
          status = k % 5 === 0 ? 'cancelado' : 'concluido'
        } else {
          status = n === 0 ? 'confirmado' : (k % 3 === 0 ? 'pendente' : 'confirmado')
          wa = status === 'confirmado'
          depositCent = k % 4 === 0 && status === 'confirmado' ? Math.round(servico.preco_centavos * 0.5) : 0
        }
        await addAppt({ cliente, prof, servico, start: dayAt(off, hour, (n % 2) * 30), status, wa, depositCent })
        spreadCount += 1
        k += 1
      }
    }

    await conn.commit()

    const faturamento = plan
      .filter((a) => a.status !== 'cancelado')
      .reduce((s, a) => s + a.servico.preco_centavos, 0)
    const sinais = plan.filter((a) => a.depositCent > 0)
    console.log('\n✅ Seed concluído:')
    console.log(`   profissionais: ${profIds.length} (${profNames.join(', ')})`)
    console.log(`   clientes:      ${clientDefs.length}`)
    console.log(`   agendamentos:  ${plan.length} (hoje) + ${spreadCount} (outros dias da semana/mês)`)
    console.log(`   faturamento:   R$ ${(faturamento / 100).toFixed(2)}`)
    console.log(`   sinais Asaas:  ${sinais.length} pagos, R$ ${(sinais.reduce((s, a) => s + a.depositCent, 0) / 100).toFixed(2)}`)
    console.log(`   acontecendo agora: Marcos Antunes · Corte · ${fmt(liveStart)}`)
    console.log('\n   Abra /estab e atualize a página. Para limpar: node scripts/cockpit-seed.mjs --clean')
  }
} catch (e) {
  try { await conn.rollback() } catch {}
  console.error('❌ Falhou:', e?.code || '', e?.message || e)
  process.exitCode = 1
} finally {
  await conn.end()
}
