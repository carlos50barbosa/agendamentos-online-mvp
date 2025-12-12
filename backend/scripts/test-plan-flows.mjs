import assert from 'node:assert/strict'

process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1'
process.env.DB_USER = process.env.DB_USER || 'test'
process.env.DB_PASS = process.env.DB_PASS || 'test'
process.env.DB_NAME = process.env.DB_NAME || 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret'

const { pool } = await import('../src/lib/db.js')
const establishmentsRouter = (await import('../src/routes/estabelecimentos.js')).default
const agendamentosRouter = (await import('../src/routes/agendamentos.js')).default
const servicosRouter = (await import('../src/routes/servicos.js')).default
const slotsRouter = (await import('../src/routes/slots.js')).default
const relatoriosRouter = (await import('../src/routes/relatorios.js')).default
const { setAppointmentLimitNotifier } = await import('../src/lib/appointment_limits.js')

const state = {
  usuarios: new Map(),
  servicos: [],
  agendamentos: [],
  profissionais: [],
  servicoProfissionais: new Map(),
  bloqueios: [],
  report: defaultReport()
}

const appointmentLimitNotifications = []
setAppointmentLimitNotifier(async (payload) => {
  appointmentLimitNotifications.push(payload)
})

function applyReportOverrides(base, overrides = {}) {
  const next = clone(base);
  const data = overrides ? clone(overrides) : {};
  if (data.totals) next.totals = { ...next.totals, ...clone(data.totals) };
  if (data.daily) next.daily = clone(data.daily);
  if (data.services) next.services = clone(data.services);
  return next;
}

function defaultReport() {
  return {
    totals: {
      total: 3,
      confirmados: 2,
      cancelados: 1,
      concluidos: 1,
      futuros: 1,
      receita_confirmada: 15000,
      receita_concluida: 8000,
      receita_futura: 7000,
      receita_perdida: 2000
    },
    daily: [
      { dia: '2025-01-01', confirmados: 1, cancelados: 0, receita_centavos: 8000 },
      { dia: '2025-01-02', confirmados: 1, cancelados: 1, receita_centavos: 7000 }
    ],
    services: [
      { id: 10, nome: 'Consulta', total: 2, confirmados: 1, cancelados: 1, receita_centavos: 8000 },
      { id: 11, nome: 'Exame', total: 1, confirmados: 1, cancelados: 0, receita_centavos: 7000 }
    ]
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function seedScenario({ user = {}, services = null, professionals = [], serviceProfessionals = [], bloqueios = [], appointments = [], report = null } = {}) {
  state.usuarios.clear()
  state.usuarios.set(1, {
    id: 1,
    nome: 'Clinica Exemplo',
    email: 'contato@exemplo.com',
    telefone: '5511999999999',
    slug: 'clinica-exemplo',
    tipo: 'estabelecimento',
    plan: 'starter',
    plan_status: 'trialing',
    plan_cycle: 'mensal',
    plan_trial_ends_at: null,
    plan_active_until: null,
    plan_subscription_id: null,
    ...user
  })

  if (services) {
    state.servicos = services.map((svc, index) => ({
      id: svc.id ?? 10 + index,
      estabelecimento_id: svc.estabelecimento_id ?? 1,
      nome: svc.nome ?? `Servico ${index + 1}`,
      duracao_min: svc.duracao_min ?? 60,
      preco_centavos: svc.preco_centavos ?? 0,
      ativo: svc.ativo ?? 1
    }))
  } else {
    state.servicos = [
      { id: 10, estabelecimento_id: 1, nome: 'Consulta', duracao_min: 60, preco_centavos: 8000, ativo: 1 }
    ]
  }

  state.profissionais = professionals.map((prof, index) => ({
    id: prof.id ?? 100 + index,
    estabelecimento_id: prof.estabelecimento_id ?? 1,
    nome: prof.nome ?? `Profissional ${index + 1}`,
    descricao: prof.descricao ?? null,
    avatar_url: prof.avatar_url ?? null,
    ativo: prof.ativo ?? 1,
    created_at: prof.created_at ? new Date(prof.created_at) : new Date(),
    updated_at: prof.updated_at ? new Date(prof.updated_at) : new Date()
  }))

  state.servicoProfissionais = new Map()
  if (Array.isArray(serviceProfessionals)) {
    serviceProfessionals.forEach((entry) => {
      if (!entry) return
      const serviceId = Number(entry.servico_id ?? entry.serviceId)
      const professionalId = Number(entry.profissional_id ?? entry.professionalId)
      if (!Number.isFinite(serviceId) || !Number.isFinite(professionalId)) return
      const set = state.servicoProfissionais.get(serviceId) || new Set()
      set.add(professionalId)
      state.servicoProfissionais.set(serviceId, set)
    })
  } else if (serviceProfessionals instanceof Map) {
    serviceProfessionals.forEach((value, key) => {
      const serviceId = Number(key)
      const set = new Set()
      if (Array.isArray(value) || value instanceof Set) {
        Array.from(value).forEach((id) => {
          if (Number.isFinite(Number(id))) set.add(Number(id))
        })
      }
      if (set.size) state.servicoProfissionais.set(serviceId, set)
    })
  }

  state.bloqueios = bloqueios.map((item, index) => ({
    id: item.id ?? index + 1,
    estabelecimento_id: item.estabelecimento_id ?? 1,
    inicio: new Date(item.inicio),
    fim: new Date(item.fim)
  }))

  state.agendamentos = appointments.map((item, index) => ({
    id: item.id ?? index + 1,
    estabelecimento_id: item.estabelecimento_id ?? 1,
    inicio: item.inicio ? new Date(item.inicio) : new Date(),
    status: item.status || 'confirmado'
  }))

  state.report = applyReportOverrides(defaultReport(), report)
}

function findUserById(id) {
  return state.usuarios.get(Number(id)) || null
}

function findProfessionalById(id) {
  return state.profissionais.find((p) => p.id === Number(id)) || null
}

function getProfessionalsByService(serviceId) {
  const set = state.servicoProfissionais.get(Number(serviceId)) || new Set()
  return Array.from(set).map((id) => findProfessionalById(id)).filter(Boolean)
}


function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

pool.query = async (sql, params = []) => {
  const norm = normalize(sql)

  if (norm.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until FROM usuarios WHERE id=?")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      plan: user.plan,
      plan_status: user.plan_status,
      plan_trial_ends_at: user.plan_trial_ends_at ? new Date(user.plan_trial_ends_at) : null,
      plan_active_until: user.plan_active_until ? new Date(user.plan_active_until) : null
    }], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM agendamentos WHERE estabelecimento_id=? AND status IN ('confirmado','pendente') AND inicio >= ? AND inicio < ?")) {
    const [estId, start, end] = params
    const startMs = new Date(start).getTime()
    const endMs = new Date(end).getTime()
    const total = state.agendamentos.filter((a) => {
      if (Number(a.estabelecimento_id) !== Number(estId)) return false
      const ms = new Date(a.inicio).getTime()
      if (Number.isNaN(ms)) return false
      const status = String(a.status || 'confirmado').toLowerCase()
      return ['confirmado', 'pendente'].includes(status) && ms >= startMs && ms < endMs
    }).length
    return [[{ total }], []]
  }

  if (norm.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id, plan_cycle FROM usuarios WHERE id=?")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      plan: user.plan,
      plan_status: user.plan_status,
      plan_trial_ends_at: user.plan_trial_ends_at ? new Date(user.plan_trial_ends_at) : null,
      plan_active_until: user.plan_active_until ? new Date(user.plan_active_until) : null,
      plan_subscription_id: user.plan_subscription_id || null,
      plan_cycle: user.plan_cycle || 'mensal'
    }], []]
  }

  if (norm.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=?")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      plan: user.plan,
      plan_status: user.plan_status,
      plan_trial_ends_at: user.plan_trial_ends_at ? new Date(user.plan_trial_ends_at) : null,
      plan_active_until: user.plan_active_until ? new Date(user.plan_active_until) : null,
      plan_subscription_id: user.plan_subscription_id || null
    }], []]
  }

  if (norm.startsWith("SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[clone(user)], []]
  }

  if (norm.startsWith("SELECT id, nome, email, telefone, slug, avatar_url, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE slug")) {
    const slug = params[0]
    const user = [...state.usuarios.values()].find((u) => u.slug === slug)
    if (!user) return [[], []]
    return [[clone(user)], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id")) {
    const estId = params[0]
    const total = state.servicos.filter((s) => s.estabelecimento_id === estId).length
    return [[{ total }], []]
  }

  if (norm.startsWith("SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=?")) {
    const [svcId, estId] = params
    const svc = state.servicos.find((s) => s.id === svcId && s.estabelecimento_id === estId && s.ativo)
    return [svc ? [{ duracao_min: svc.duracao_min, nome: svc.nome }] : [], []]
  }
  if (norm.startsWith("SELECT duracao_min, nome FROM servicos WHERE id=?")) {
    const [svcId] = params
    const svc = state.servicos.find((s) => s.id === svcId && s.ativo)
    return [svc ? [{ duracao_min: svc.duracao_min, nome: svc.nome }] : [], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id")) {
    const estId = params[0]
    const total = state.profissionais.filter((p) => p.estabelecimento_id === estId).length
    return [[{ total }], []]
  }

  if (norm.includes('FROM agendamentos a') && norm.includes('receita_perdida')) {
    return [[clone(state.report.totals)], []]
  }

  if (norm.includes('GROUP BY dia')) {
    return [clone(state.report.daily), []]
  }

  if (norm.includes('GROUP BY s.id, s.nome')) {
    return [clone(state.report.services), []]
  }

  if (norm.startsWith("UPDATE usuarios SET")) {
    const assignments = norm.substring("UPDATE usuarios SET ".length, norm.indexOf(' WHERE'))
      .split(', ')
      .map((part) => part.trim())

    const id = params[assignments.length]
    const user = findUserById(id)
    if (!user) return [{ affectedRows: 0 }, []]
    assignments.forEach((assignment, index) => {
      const [column] = assignment.split('=')
      const value = params[index]
      switch (column) {
        case 'plan':
          user.plan = value
          break
        case 'plan_status':
          user.plan_status = value
          break
        case 'plan_cycle':
          user.plan_cycle = value || 'mensal'
          break
        case 'plan_trial_ends_at':
          user.plan_trial_ends_at = value ? new Date(value) : null
          break
        case 'plan_active_until':
          user.plan_active_until = value ? new Date(value) : null
          break
        case 'plan_subscription_id':
          user.plan_subscription_id = value || null
          break
        default:
          break
      }
    })
    return [{ affectedRows: 1 }, []]
  }

  if (norm.startsWith("SHOW TABLES LIKE 'profissionais'")) {
    return [[], []]
  }

  if (norm.startsWith('SELECT id, ativo FROM profissionais WHERE estabelecimento_id=? AND id IN (')) {
    const estId = params[0]
    const ids = params.slice(1)
    const rows = state.profissionais
      .filter((p) => p.estabelecimento_id === estId && ids.includes(p.id))
      .map((p) => ({ id: p.id, ativo: p.ativo ? 1 : 0 }))
    return [rows, []]
  }

  if (norm.startsWith('SELECT id, nome, avatar_url, ativo FROM profissionais WHERE id=? AND estabelecimento_id=?')) {
    const [id, estId] = params
    const p = state.profissionais.find((row) => row.id === id && row.estabelecimento_id === estId)
    return [p ? [{ id: p.id, nome: p.nome, avatar_url: p.avatar_url || null, ativo: p.ativo ? 1 : 0 }] : [], []]
  }

  if (norm.startsWith('SELECT email, telefone, nome, notify_email_estab, notify_whatsapp_estab FROM usuarios WHERE id=?')) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      email: user.email || null,
      telefone: user.telefone || null,
      nome: user.nome || null,
      notify_email_estab: user.notify_email_estab ?? 1,
      notify_whatsapp_estab: user.notify_whatsapp_estab ?? 1
    }], []]
  }

  if (norm.startsWith("INSERT INTO servicos")) {
    const [estId, nome, duracaoMin, precoCentavos, ativoFlag] = params
    const nextId = state.servicos.reduce((max, svc) => Math.max(max, svc.id), 0) + 1
    const newSvc = {
      id: nextId,
      estabelecimento_id: estId,
      nome,
      duracao_min: duracaoMin,
      preco_centavos: precoCentavos,
      ativo: ativoFlag
    }
    state.servicos.push(newSvc)
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  if (norm.startsWith("SELECT * FROM servicos WHERE id")) {
    const id = params[0]
    const svc = state.servicos.find((s) => s.id === id)
    return [svc ? [clone(svc)] : [], []]
  }

  if (norm.startsWith('SELECT * FROM servicos WHERE id=? AND estabelecimento_id=?')) {
    const [id, estId] = params
    const svc = state.servicos.find((s) => s.id === id && s.estabelecimento_id === estId)
    return [svc ? [clone(svc)] : [], []]
  }

  if (norm.startsWith('SELECT sp.servico_id, p.id, p.nome, p.descricao, p.avatar_url FROM servico_profissionais sp JOIN profissionais p ON p.id = sp.profissional_id WHERE sp.servico_id IN (')) {
    const serviceIds = params.map(Number)
    const rows = []
    for (const svcId of serviceIds) {
      const set = state.servicoProfissionais.get(svcId) || new Set()
      for (const profId of set) {
        const p = findProfessionalById(profId)
        if (p) rows.push({ servico_id: svcId, id: p.id, nome: p.nome, descricao: p.descricao || null, avatar_url: p.avatar_url || null })
      }
    }
    rows.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')))
    return [rows, []]
  }

  if (norm.startsWith('DELETE FROM servico_profissionais WHERE servico_id=?')) {
    const [svcId] = params
    state.servicoProfissionais.delete(Number(svcId))
    return [{ affectedRows: 1 }, []]
  }

  if (norm.startsWith('INSERT INTO servico_profissionais (servico_id, profissional_id) VALUES (?,?)')) {
    const [svcId, profId] = params.map(Number)
    const set = state.servicoProfissionais.get(svcId) || new Set()
    set.add(profId)
    state.servicoProfissionais.set(svcId, set)
    return [{ affectedRows: 1, insertId: null }, []]
  }

  if (norm.startsWith('SELECT profissional_id FROM servico_profissionais WHERE servico_id=?')) {
    const [svcId] = params
    const set = state.servicoProfissionais.get(Number(svcId)) || new Set()
    return [Array.from(set).map((id) => ({ profissional_id: id })), []]
  }

  if (norm.startsWith("SELECT id FROM bloqueios")) {
    const [estId, inicio, fim] = params
    const match = state.bloqueios.find((b) => b.estabelecimento_id === estId && b.inicio.getTime() === new Date(inicio).getTime() && b.fim.getTime() === new Date(fim).getTime())
    return [match ? [{ id: match.id }] : [], []]
  }

  if (norm.startsWith("DELETE FROM bloqueios")) {
    const id = params[0]
    const index = state.bloqueios.findIndex((b) => b.id === id)
    if (index >= 0) state.bloqueios.splice(index, 1)
    return [{ affectedRows: index >= 0 ? 1 : 0 }, []]
  }

  if (norm.startsWith("INSERT INTO bloqueios")) {
    const [estId, inicio, fim] = params
    const nextId = state.bloqueios.reduce((max, item) => Math.max(max, item.id), 0) + 1
    state.bloqueios.push({
      id: nextId,
      estabelecimento_id: estId,
      inicio: new Date(inicio),
      fim: new Date(fim)
    })
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  throw new Error(`Unhandled query: ${norm}`)
}

pool.getConnection = async () => {
  return {
    async beginTransaction() { return },
    async commit() { return },
    async rollback() { return },
    async release() { return },
    async query(sql, params = []) { return pool.query(sql, params) },
  }
}

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods[method])
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`)
  const stack = layer.route.stack
  return stack[stack.length - 1].handle
}

async function callHandler(handler, { params = {}, body = {}, query = {}, user = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    let statusCode = 200
    const req = { params, body, query, user, headers }
    const res = {
      status(code) { statusCode = code; return this },
      json(payload) { resolve({ status: statusCode, body: payload }); return this },
      send(payload) { resolve({ status: statusCode, body: payload }); return this },
      setHeader() { return this }
    }
    try {
      const maybe = handler(req, res, (err) => {
        if (err) reject(err)
        else resolve({ status: statusCode, body: null })
      })
      if (maybe && typeof maybe.then === 'function') {
        maybe.catch(reject)
      }
    } catch (err) {
      reject(err)
    }
  })
}

const planHandler = getRouteHandler(establishmentsRouter, '/:id/plan', 'put')
const createAppointmentHandler = getRouteHandler(agendamentosRouter, '/', 'post')
const createServiceHandler = getRouteHandler(servicosRouter, '/', 'post')
const slotToggleHandler = getRouteHandler(slotsRouter, '/toggle', 'post')
const relatorioHandler = getRouteHandler(relatoriosRouter, '/estabelecimento', 'get')

const results = []

// 1) ativar trial pro
seedScenario()
const res1 = await callHandler(planHandler, {
  params: { id: '1' },
  user: { id: 1, tipo: 'estabelecimento', plan: 'starter', plan_status: 'trialing' },
  body: { plan: 'pro', status: 'trialing', trialDays: 14 }
})
results.push({ name: 'ativar trial pro', response: res1 })
assert.equal(res1.status, 200)
assert.equal(res1.body.ok, true)
assert.equal(res1.body.plan.plan, 'pro')
assert.equal(res1.body.plan.status, 'trialing')
assert.ok(typeof res1.body.plan.trial?.days_left === 'number' && res1.body.plan.trial.days_left > 0)

// 2) agendar com plano delinquent deve falhar
seedScenario({ user: { plan_status: 'delinquent' } })
const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
future.setHours(14, 0, 0, 0)
const res2 = await callHandler(createAppointmentHandler, {
  body: {
    estabelecimento_id: 1,
    servico_id: 10,
    inicio: future.toISOString()
  },
  user: { id: 42, tipo: 'cliente' }
})
results.push({ name: 'agendar com plano delinquent', response: res2 })
assert.equal(res2.status, 403)
assert.equal(res2.body?.error, 'plan_delinquent')

// 3) downgrade bloqueado por limite de servicos
seedScenario({
  user: { plan: 'pro', plan_status: 'active' },
  services: Array.from({ length: 12 }, (_, index) => ({ id: 200 + index }))
})
const res3 = await callHandler(planHandler, {
  params: { id: '1' },
  user: { id: 1, tipo: 'estabelecimento', plan: 'pro', plan_status: 'active' },
  body: { plan: 'starter' }
})
results.push({ name: 'downgrade bloqueado por limite', response: res3 })
assert.equal(res3.status, 409)
assert.equal(res3.body?.error, 'plan_downgrade_blocked')

// 4) criacao de servico bloqueada por inadimplencia
seedScenario({ user: { plan_status: 'delinquent' } })
const res4 = await callHandler(createServiceHandler, {
  body: { nome: 'Novo Servico', duracao_min: 30, preco_centavos: 1000 },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'criar servico com plano delinquent', response: res4 })
assert.equal(res4.status, 402)
assert.equal(res4.body?.error, 'plan_delinquent')

// 5) criacao de servico bloqueada por limite do plano
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  services: Array.from({ length: 10 }, (_, index) => ({ id: 300 + index }))
})
const res5 = await callHandler(createServiceHandler, {
  body: { nome: 'Servico Extra', duracao_min: 45, preco_centavos: 1500 },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'criar servico acima do limite', response: res5 })
assert.equal(res5.status, 403)
assert.equal(res5.body?.error, 'plan_limit')

// 6) upgrade direto para premium ativo
seedScenario()
const activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const res6 = await callHandler(planHandler, {
  params: { id: '1' },
  user: { id: 1, tipo: 'estabelecimento', plan: 'starter', plan_status: 'trialing' },
  body: { plan: 'premium', status: 'active', activeUntil }
})
results.push({ name: 'upgrade para premium', response: res6 })
assert.equal(res6.status, 200)
assert.equal(res6.body.plan.plan, 'premium')
assert.equal(res6.body.plan.status, 'active')
assert.equal(res6.body.plan.limits.maxServices, null)

// 7) criacao de servico permitida em plano pro ativo
seedScenario({
  user: { plan: 'pro', plan_status: 'active' },
  services: [],
  professionals: [{ id: 10, estabelecimento_id: 1, nome: 'Profissional Teste' }],
})
const payload = {
  nome: 'Massagem',
  duracao_min: 60,
  preco_centavos: 2000,
  professionalIds: [10],
}
const res7 = await callHandler(createServiceHandler, {
  body: payload,
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'criar servico permitido', response: res7 })
assert.equal(res7.status, 200)
assert.equal(res7.body?.nome, 'Massagem')
assert.equal(state.servicos.length, 1)

// 8) slots toggle permitido (bloquear)
seedScenario({ user: { plan: 'pro', plan_status: 'active' } })
const slotIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
const res8 = await callHandler(slotToggleHandler, {
  body: { slotDatetime: slotIso },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'slot toggle bloqueado', response: res8 })
assert.equal(res8.status, 200)
assert.equal(res8.body?.action, 'bloqueado')

// 9) slots toggle liberar o mesmo intervalo
const res9 = await callHandler(slotToggleHandler, {
  body: { slotDatetime: slotIso },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'slot toggle liberado', response: res9 })
assert.equal(res9.status, 200)
assert.equal(res9.body?.action, 'liberado')

// 10) slots bloqueado por inadimplencia
seedScenario({ user: { plan_status: 'delinquent' } })
const res10 = await callHandler(slotToggleHandler, {
  body: { slotDatetime: slotIso },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'slot toggle bloqueado por plano', response: res10 })
assert.equal(res10.status, 403)
assert.equal(res10.body?.error, 'plan_delinquent')

// 11) relatorio permitido para plano pro ativo
seedScenario({
  user: { plan: 'pro', plan_status: 'active' },
  report: {
    totals: {
      total: 5,
      confirmados: 3,
      cancelados: 2,
      concluidos: 2,
      futuros: 1,
      receita_confirmada: 25000,
      receita_concluida: 15000,
      receita_futura: 10000,
      receita_perdida: 3000
    },
    daily: [{ dia: '2025-02-01', confirmados: 2, cancelados: 0, receita_centavos: 15000 }],
    services: [{ id: 10, nome: 'Consulta', total: 3, confirmados: 2, cancelados: 1, receita_centavos: 15000 }]
  }
})
const res11 = await callHandler(relatorioHandler, {
  query: {},
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'relatorio permitido', response: res11 })
assert.equal(res11.status, 200)
assert.equal(res11.body?.plan?.allow_advanced, true)
assert.equal(res11.body?.totals?.total, 5)

// 12) relatorio bloqueado por inadimplencia
seedScenario({ user: { plan_status: 'delinquent' } })
const res12 = await callHandler(relatorioHandler, {
  query: {},
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'relatorio bloqueado por plano', response: res12 })
assert.equal(res12.status, 402)
assert.equal(res12.body?.error, 'plan_delinquent')

// 13) agendamento bloqueado por limite mensal do plano
const limitMonth = new Date()
limitMonth.setMonth(limitMonth.getMonth() + 1)
limitMonth.setDate(10)
limitMonth.setHours(14, 0, 0, 0)
const appointments = Array.from({ length: 100 }, (_, index) => {
  const d = new Date(limitMonth)
  d.setDate(1 + (index % 10))
  d.setHours(9 + (index % 4), 0, 0, 0)
  return { id: 500 + index, estabelecimento_id: 1, inicio: d, status: 'confirmado' }
})
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  appointments,
})
appointmentLimitNotifications.length = 0
const limitAttempt = new Date(limitMonth)
limitAttempt.setDate(limitMonth.getDate() + 2)
limitAttempt.setHours(15, 0, 0, 0)
const res13 = await callHandler(createAppointmentHandler, {
  body: {
    estabelecimento_id: 1,
    servico_id: 10,
    inicio: limitAttempt.toISOString(),
  },
  user: { id: 77, tipo: 'cliente' }
})
results.push({ name: 'agendar bloqueado por limite do plano', response: res13 })
assert.equal(res13.status, 403)
assert.equal(res13.body?.error, 'plan_limit_agendamentos')
assert.equal(appointmentLimitNotifications.length, 1)
assert.equal(appointmentLimitNotifications[0]?.limit, 100)
assert.equal(appointmentLimitNotifications[0]?.total, 100)

console.log('Testes executados com sucesso:')
for (const { name, response } of results) {
  console.log(`- ${name}: status ${response.status}`)
}

if (typeof pool.end === 'function') {
  try { await pool.end() } catch {}
}

process.exit(0)
