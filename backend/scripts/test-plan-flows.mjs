import assert from 'node:assert/strict'

process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1'
process.env.DB_USER = process.env.DB_USER || 'test'
process.env.DB_PASS = process.env.DB_PASS || 'test'
process.env.DB_NAME = process.env.DB_NAME || 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret'

const { pool } = await import('../src/lib/db.js')
const establishmentsRouter = (await import('../src/routes/estabelecimentos.js')).default
const agendamentosRouter = (await import('../src/routes/agendamentos.js')).default

const state = {
  usuarios: new Map(),
  servicos: [],
}

function resetState() {
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
    plan_trial_ends_at: null,
    plan_active_until: null,
    plan_subscription_id: null,
  })
  state.servicos = [
    { id: 10, estabelecimento_id: 1, nome: 'Consulta', duracao_min: 60, ativo: 1 }
  ]
}

function cloneRow(row) {
  return { ...row }
}

function findUserById(id) {
  return state.usuarios.get(Number(id)) || null
}

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

pool.query = async (sql, params = []) => {
  const norm = normalize(sql)

  if (norm.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? AND tipo='estabelecimento'")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      plan: user.plan,
      plan_status: user.plan_status,
      plan_trial_ends_at: user.plan_trial_ends_at ? new Date(user.plan_trial_ends_at) : null,
      plan_active_until: user.plan_active_until ? new Date(user.plan_active_until) : null,
      plan_subscription_id: user.plan_subscription_id || null,
    }], []]
  }

  if (norm.startsWith("SELECT id, nome, email, telefone, slug, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=")) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[cloneRow(user)], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=")) {
    const estId = params[0]
    const total = state.servicos.filter((s) => s.estabelecimento_id === estId).length
    return [[{ total }], []]
  }

  if (norm.startsWith("SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1")) {
    const [svcId, estId] = params
    const svc = state.servicos.find((s) => s.id === svcId && s.estabelecimento_id === estId && s.ativo)
    return [svc ? [{ duracao_min: svc.duracao_min, nome: svc.nome }] : [], []]
  }

  if (norm.startsWith("UPDATE usuarios SET plan=?")) {
    const [plan, status, trialEndsAt, activeUntil, subId, id] = params
    const user = findUserById(id)
    if (!user) return [{ affectedRows: 0 }, []]
    user.plan = plan
    user.plan_status = status
    user.plan_trial_ends_at = trialEndsAt ? new Date(trialEndsAt) : null
    user.plan_active_until = activeUntil ? new Date(activeUntil) : null
    user.plan_subscription_id = subId || null
    return [{ affectedRows: 1 }, []]
  }

  if (norm.startsWith("SHOW TABLES LIKE 'profissionais'")) {
    return [[], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id=")) {
    return [[{ total: 0 }], []]
  }

  throw new Error(`Unhandled query: ${norm}`)
}

pool.getConnection = async () => {
  throw new Error('pool.getConnection should not be called in these tests')
}

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method])
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
    }
    try {
      const maybe = handler(req, res, (err) => err ? reject(err) : resolve({ status: statusCode, body: null }))
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

const results = []

// Teste 1: ativar trial Pro
resetState()
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
const daysLeft = res1.body.plan.trial?.days_left
assert.ok(typeof daysLeft === 'number' && daysLeft >= 13 && daysLeft <= 14)
const updatedUser = findUserById(1)
assert.equal(updatedUser.plan, 'pro')
assert.equal(updatedUser.plan_status, 'trialing')
assert.ok(updatedUser.plan_trial_ends_at instanceof Date)

// Teste 2: tentar agendar com plano delinquent
resetState()
const delinquentUser = findUserById(1)
delinquentUser.plan_status = 'delinquent'
const scheduleDate = new Date()
scheduleDate.setDate(scheduleDate.getDate() + 1)
scheduleDate.setHours(14, 0, 0, 0)
const res2 = await callHandler(createAppointmentHandler, {
  body: {
    estabelecimento_id: 1,
    servico_id: 10,
    inicio: scheduleDate.toISOString(),
  },
  user: { id: 42, tipo: 'cliente' },
})
results.push({ name: 'agendar com plano delinquent', response: res2 })
assert.equal(res2.status, 403)
assert.equal(res2.body?.error, 'plan_delinquent')

console.log('Testes executados com sucesso:')
for (const { name, response } of results) {
  console.log(`- ${name}: status ${response.status}`)
}

if (typeof pool.end === 'function') {
  try { await pool.end() } catch {}
}

process.exit(0)
