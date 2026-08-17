import test from 'node:test'
import assert from 'node:assert/strict'

const {
  gerarProtocolo,
  previewExclusao,
  excluirEstabelecimento,
  ExclusaoBloqueada,
} = await import('../src/lib/account_deletion.js')

const ESTAB = {
  id: 244,
  nome: 'Studio Lege',
  email: 'stylege3@gmail.com',
  telefone: '5575991592974',
  tipo: 'estabelecimento',
  asaas_customer_id: 'cus_123',
  plan: 'starter',
  plan_status: 'trialing',
  criado_em: '2026-01-02 10:00:00',
}

/** Banco de mentira: responde por trecho de SQL e guarda tudo que foi executado. */
function fakeDb({ usuario = ESTAB, agendamentos = { total: 12, clientes: 7 }, servicos = 3, profissionais = 2, subscriptions = [] } = {}) {
  const sqls = []
  const query = async (sql, params) => {
    sqls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params })
    if (/FROM usuarios WHERE id/.test(sql)) return [usuario ? [usuario] : []]
    if (/FROM agendamentos/.test(sql)) return [[agendamentos]]
    if (/FROM servicos/.test(sql)) return [[{ total: servicos }]]
    if (/FROM profissionais/.test(sql)) return [[{ total: profissionais }]]
    if (/FROM subscriptions/.test(sql)) return [subscriptions]
    return [[]]
  }
  return { query, sqls }
}

/**
 * Caminhos propositalmente inexistentes: `removeAvatarFile` e companhia tratam ENOENT como sucesso,
 * então a limpeza é exercitada de verdade sem que nenhum arquivo real corra risco.
 */
const ARQUIVOS = {
  avatarDono: '/uploads/avatars/teste-dono-inexistente.webp',
  avatarProf: '/uploads/avatars/teste-prof-inexistente.webp',
  servico: '/uploads/services/teste-servico-inexistente.webp',
  galeria: '/uploads/establishments/teste-galeria-inexistente.webp',
}

function fakeConn(db, { usuario = ESTAB, arquivos = true } = {}) {
  const acoes = []
  const conn = {
    query: async (sql, params) => {
      const texto = String(sql).replace(/\s+/g, ' ').trim()
      acoes.push({ sql: texto, params })
      if (/FROM usuarios WHERE id = \? FOR UPDATE/.test(texto)) return [usuario ? [usuario] : []]
      if (/SELECT avatar_url FROM usuarios/.test(texto)) return [[{ avatar_url: arquivos ? ARQUIVOS.avatarDono : null }]]
      if (/FROM profissionais/.test(texto)) return [arquivos ? [{ avatar_url: ARQUIVOS.avatarProf }] : []]
      if (/FROM servicos/.test(texto)) return [arquivos ? [{ imagem_url: ARQUIVOS.servico }] : []]
      if (/FROM estabelecimento_imagens/.test(texto)) return [arquivos ? [{ file_path: ARQUIVOS.galeria }] : []]
      return [{ affectedRows: 1 }]
    },
    beginTransaction: async () => { acoes.push({ sql: 'BEGIN' }) },
    commit: async () => { acoes.push({ sql: 'COMMIT' }) },
    rollback: async () => { acoes.push({ sql: 'ROLLBACK' }) },
    release: () => { acoes.push({ sql: 'RELEASE' }) },
  }
  return { conn, acoes }
}

test('o protocolo sai do mesmo carimbo de tempo da linha de auditoria', () => {
  const proto = gerarProtocolo({ stamp: '2026-08-17 14:30:12.404', sufixo: 'K7QP' })
  assert.equal(proto, 'AO-DEL-20260817-143012-K7QP')
})

test('o sufixo aleatorio nao usa caracteres ambiguos', () => {
  for (let i = 0; i < 200; i += 1) {
    const sufixo = gerarProtocolo().split('-').pop()
    assert.match(sufixo, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)
  }
})

test('o preview conta o que desaparece junto, inclusive clientes de terceiros', async () => {
  const db = fakeDb()
  const preview = await previewExclusao(244, { deps: { query: db.query } })
  assert.equal(preview.impacto.agendamentos, 12)
  assert.equal(preview.impacto.clientes_afetados, 7)
  assert.equal(preview.impacto.servicos, 3)
  assert.equal(preview.impacto.profissionais, 2)
  assert.equal(preview.assinatura_ativa, null)
})

test('assinatura viva no gateway aparece no preview', async () => {
  const db = fakeDb({ subscriptions: [{ id: 9, status: 'active', gateway: 'asaas', gateway_subscription_id: 'sub_1' }] })
  const preview = await previewExclusao(244, { deps: { query: db.query } })
  assert.equal(preview.assinatura_ativa.gateway_subscription_id, 'sub_1')
})

test('assinatura cancelada NAO bloqueia', async () => {
  const db = fakeDb({ subscriptions: [{ id: 9, status: 'canceled', gateway: 'asaas' }] })
  const preview = await previewExclusao(244, { deps: { query: db.query } })
  assert.equal(preview.assinatura_ativa, null)
})

test('recusa quem nao e estabelecimento', async () => {
  const db = fakeDb({ usuario: { ...ESTAB, tipo: 'cliente' } })
  await assert.rejects(
    () => excluirEstabelecimento({ id: 244, confirmacao: 'Studio Lege' }, { deps: { query: db.query } }),
    (e) => e instanceof ExclusaoBloqueada && e.code === 'nao_e_estabelecimento',
  )
})

test('recusa confirmacao que nao bate com o nome', async () => {
  const db = fakeDb()
  await assert.rejects(
    () => excluirEstabelecimento({ id: 244, confirmacao: 'studio lege' }, { deps: { query: db.query } }),
    (e) => e instanceof ExclusaoBloqueada && e.code === 'confirmacao_invalida',
  )
})

test('espaco sobrando na confirmacao nao e o erro que a trava procura', async () => {
  const db = fakeDb()
  const { conn, acoes } = fakeConn(db)
  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: '  Studio Lege  ', executor: 'admin' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )
  assert.match(r.protocolo, /^AO-DEL-\d{8}-\d{6}-[A-Z0-9]{4}$/)
  assert.ok(acoes.some((a) => a.sql === 'COMMIT'))
})

const ASSINATURA_ASAAS = { id: 9, status: 'active', gateway: 'asaas', gateway_subscription_id: 'sub_1' }

test('cancela a assinatura no Asaas antes de o banco esquecer o id dela', async () => {
  const db = fakeDb({ subscriptions: [ASSINATURA_ASAAS] })
  const { conn, acoes } = fakeConn(db)
  const chamadas = []
  const asaasPayments = { deleteSubscription: async (id) => { chamadas.push(id); return { deleted: true } } }

  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },   // repare: sem ignorarAssinatura
    { deps: { query: db.query, getConnection: async () => conn, asaasPayments } },
  )

  assert.deepEqual(chamadas, ['sub_1'])
  assert.equal(r.gateway.cancelada, true)
  const metadados = JSON.parse(acoes.find((a) => /INSERT INTO audit_log/.test(a.sql)).params.at(-1))
  assert.equal(metadados.gateway.cancelada, true)
  assert.equal(metadados.assinatura_ignorada, false)
})

test('gateway que recusa o cancelamento barra a exclusao', async () => {
  const db = fakeDb({ subscriptions: [ASSINATURA_ASAAS] })
  const asaasPayments = { deleteSubscription: async () => { throw new Error('401 unauthorized') } }

  await assert.rejects(
    () => excluirEstabelecimento({ id: 244, confirmacao: 'Studio Lege' }, { deps: { query: db.query, asaasPayments } }),
    (e) => e instanceof ExclusaoBloqueada && e.code === 'assinatura_ativa' && /401 unauthorized/.test(e.message),
  )

  // Assumindo a pendência, segue — e o protocolo registra que seguiu com a assinatura viva.
  const { conn, acoes } = fakeConn(db)
  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege', ignorarAssinatura: true },
    { deps: { query: db.query, getConnection: async () => conn, asaasPayments } },
  )
  assert.equal(r.gateway.cancelada, false)
  const metadados = JSON.parse(acoes.find((a) => /INSERT INTO audit_log/.test(a.sql)).params.at(-1))
  assert.equal(metadados.assinatura_ignorada, true)
  assert.equal(metadados.gateway.motivo, 'falha_no_gateway')
})

test('gateway sem automacao (mercadopago) continua exigindo decisao explicita', async () => {
  const db = fakeDb({ subscriptions: [{ id: 9, status: 'active', gateway: 'mercadopago', gateway_subscription_id: 'mp_1' }] })
  await assert.rejects(
    () => excluirEstabelecimento({ id: 244, confirmacao: 'Studio Lege' }, { deps: { query: db.query } }),
    (e) => e instanceof ExclusaoBloqueada && e.code === 'assinatura_ativa' && /sem cancelamento automatico/.test(e.message),
  )
})

test('o protocolo e gravado ANTES do delete, na mesma transacao', async () => {
  const db = fakeDb()
  const { conn, acoes } = fakeConn(db)
  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege', executor: 'admin@agenda0' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )

  const ordem = acoes.map((a) => a.sql)
  const iBegin = ordem.findIndex((s) => s === 'BEGIN')
  const iAudit = ordem.findIndex((s) => /INSERT INTO audit_log/.test(s))
  const iDelete = ordem.findIndex((s) => /DELETE FROM usuarios/.test(s))
  const iCommit = ordem.findIndex((s) => s === 'COMMIT')
  assert.ok(iBegin < iAudit && iAudit < iDelete && iDelete < iCommit, `ordem errada: ${ordem.join(' | ')}`)

  const audit = acoes.find((a) => /INSERT INTO audit_log/.test(a.sql))
  assert.ok(audit.params.includes('admin@agenda0'))
  assert.equal(JSON.parse(audit.params[audit.params.length - 1]).protocolo, r.protocolo)
})

test('revoga o WhatsApp por evento novo — nunca apagando o aceite', async () => {
  const db = fakeDb()
  const { conn, acoes } = fakeConn(db)
  await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )

  const optin = acoes.find((a) => /INSERT INTO whatsapp_optins/.test(a.sql))
  assert.ok(optin, 'deveria gravar a revogacao')
  assert.ok(optin.params.includes('5575991592974'))
  // A regra que nao pode ser quebrada: `whatsapp_optins` e trilha de prova para a Meta.
  assert.ok(!acoes.some((a) => /DELETE FROM whatsapp_optins/i.test(a.sql)), 'NUNCA apagar consentimento')
  // E a revogacao precisa vir antes do delete, que e' quem leva o telefone embora.
  const iOptin = acoes.findIndex((a) => /INSERT INTO whatsapp_optins/.test(a.sql))
  const iDelete = acoes.findIndex((a) => /DELETE FROM usuarios/.test(a.sql))
  assert.ok(iOptin < iDelete)
})

test('conta sem telefone nao gera revogacao vazia', async () => {
  const db = fakeDb({ usuario: { ...ESTAB, telefone: null } })
  const { conn, acoes } = fakeConn(db, { usuario: { ...ESTAB, telefone: null } })
  await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )
  assert.ok(!acoes.some((a) => /INSERT INTO whatsapp_optins/.test(a.sql)))
})

test('coleta os arquivos ANTES do delete e so' + ' limpa depois do commit', async () => {
  const db = fakeDb()
  const { conn, acoes } = fakeConn(db)
  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )

  // Avatar do dono, avatar da profissional, imagem do serviço e foto da galeria.
  assert.equal(r.arquivos.previstos, 4)
  assert.equal(r.arquivos.removidos, 4)
  assert.deepEqual(r.arquivos.falhas, [])

  const ordem = acoes.map((a) => a.sql)
  const iGaleria = ordem.findIndex((s) => /FROM estabelecimento_imagens/.test(s))
  const iDelete = ordem.findIndex((s) => /DELETE FROM usuarios/.test(s))
  assert.ok(iGaleria >= 0 && iGaleria < iDelete, 'os caminhos precisam ser lidos antes do DELETE')

  const metadados = JSON.parse(acoes.find((a) => /INSERT INTO audit_log/.test(a.sql)).params.at(-1))
  assert.equal(metadados.arquivos_previstos, 4)
})

test('conta sem imagem nenhuma nao inventa limpeza', async () => {
  const db = fakeDb()
  const { conn } = fakeConn(db, { arquivos: false })
  const r = await excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },
    { deps: { query: db.query, getConnection: async () => conn } },
  )
  assert.equal(r.arquivos.previstos, 0)
})

// A limpeza mora DEPOIS do commit no código; um rollback nunca chega nela — que é o ponto:
// arquivo apagado não volta, e devolver a conta sem as imagens seria pior que o lixo em disco.
test('falha no meio desfaz tudo', async () => {
  const db = fakeDb()
  const { conn, acoes } = fakeConn(db)
  conn.query = async (sql) => {
    const texto = String(sql).replace(/\s+/g, ' ').trim()
    acoes.push({ sql: texto })
    if (/FOR UPDATE/.test(texto)) return [[ESTAB]]
    if (/DELETE FROM usuarios/.test(texto)) throw new Error('deadlock')
    return [{ affectedRows: 1 }]
  }
  await assert.rejects(() => excluirEstabelecimento(
    { id: 244, confirmacao: 'Studio Lege' },
    { deps: { query: db.query, getConnection: async () => conn } },
  ))
  assert.ok(acoes.some((a) => a.sql === 'ROLLBACK'))
  assert.ok(!acoes.some((a) => a.sql === 'COMMIT'))
})
