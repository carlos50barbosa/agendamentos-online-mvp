// Simple smoke test for POST /agendamentos creating an appointment
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret'
// Satisfy config.js requirements without connecting to real DB
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1'
process.env.DB_USER = process.env.DB_USER || 'test'
process.env.DB_PASS = process.env.DB_PASS || 'test'
process.env.DB_NAME = process.env.DB_NAME || 'test'

const { pool } = await import('../src/lib/db.js')
const agendamentosRouter = (await import('../src/routes/agendamentos.js')).default

const state = {
  usuarios: new Map([[1, { id: 1, tipo: 'estabelecimento', plan: 'starter', plan_status: 'active' }], [123, { id: 123, tipo: 'cliente' }]]),
  servicos: new Map([[10, { id: 10, estabelecimento_id: 1, nome: 'Consulta', duracao_min: 60, ativo: 1 }]]),
  agendamentos: [],
  servicoProf: new Map(),
}

function normalize(sql) { return sql.replace(/\s+/g, ' ').trim() }

pool.query = async (sql, params = []) => {
  const norm = normalize(sql)
  // plan context
  if (norm.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id, plan_cycle FROM usuarios WHERE id=?")) {
    const id = Number(params[0])
    if (!state.usuarios.has(id)) return [[], []]
    const u = state.usuarios.get(id)
    return [[{ plan: u.plan, plan_status: u.plan_status, plan_trial_ends_at: null, plan_active_until: null, plan_subscription_id: null, plan_cycle: 'mensal' }], []]
  }
  // service
  if (norm.startsWith('SELECT duracao_min, nome FROM servicos WHERE id=? AND estabelecimento_id=? AND ativo=1')) {
    const [id, estId] = params
    const s = state.servicos.get(Number(id))
    if (s && s.estabelecimento_id === Number(estId) && s.ativo) return [[{ duracao_min: s.duracao_min, nome: s.nome }], []]
    return [[], []]
  }
  // linked professionals
  if (norm.startsWith('SELECT profissional_id FROM servico_profissionais WHERE servico_id=?')) {
    const [svcId] = params
    const set = state.servicoProf.get(Number(svcId)) || new Set()
    return [Array.from(set).map((id) => ({ profissional_id: id })), []]
  }
  // after commit reads
  if (norm.startsWith('SELECT * FROM agendamentos WHERE id=?')) {
    const [id] = params
    const a = state.agendamentos.find((x) => x.id === Number(id))
    return [a ? [a] : [], []]
  }
  if (norm.startsWith('SELECT email, telefone, nome FROM usuarios WHERE id=?')) {
    const [id] = params
    const u = state.usuarios.get(Number(id)) || { nome: 'User', email: null, telefone: null }
    return [[{ email: u.email || null, telefone: u.telefone || null, nome: u.nome || 'User' }], []]
  }
  // unknown
  throw new Error('Unhandled pool.query: ' + norm)
}

pool.getConnection = async () => {
  return {
    async beginTransaction() { return },
    async commit() { return },
    async rollback() { return },
    async release() { return },
    async query(sql, params = []) {
      const norm = normalize(sql)
      // conflicts
      if (norm.startsWith('SELECT id FROM agendamentos WHERE estabelecimento_id = ?')) {
        return [[], []]
      }
      if (norm.startsWith('SELECT * FROM agendamentos WHERE id=?')) {
        const [id] = params
        const a = state.agendamentos.find((x) => x.id === Number(id))
        return [a ? [a] : [], []]
      }
      if (norm.startsWith('SELECT email, telefone, nome FROM usuarios WHERE id=?')) {
        const [id] = params
        const u = state.usuarios.get(Number(id)) || { nome: 'User', email: null, telefone: null }
        return [[{ email: u.email || null, telefone: u.telefone || null, nome: u.nome || 'User' }], []]
      }
      // insert
      if (norm.startsWith('INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim) VALUES (?,?,?,?,?,?)')) {
        // verify placeholders vs params length
        const placeholders = (sql.match(/\?/g) || []).length
        assert.equal(placeholders, params.length, 'placeholders should match params length')
        const [cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim] = params
        const nextId = (state.agendamentos[state.agendamentos.length - 1]?.id || 0) + 1
        state.agendamentos.push({ id: nextId, cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim, status: 'confirmado' })
        return [{ insertId: nextId, affectedRows: 1 }, []]
      }
      throw new Error('Unhandled conn.query: ' + norm)
    },
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

// run
const createAppointmentHandler = getRouteHandler(agendamentosRouter, '/', 'post')
const future = new Date(Date.now() + 24 * 60 * 60 * 1000); future.setHours(14, 0, 0, 0)
const res = await callHandler(createAppointmentHandler, {
  body: { estabelecimento_id: 1, servico_id: 10, inicio: future.toISOString() },
  user: { id: 123, tipo: 'cliente' }
})

console.log('SMOKE create agendamento:', res.status)
assert.equal(res.status, 201)
assert.ok(res.body?.id, 'should return created id')
console.log('OK')
