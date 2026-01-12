import assert from 'node:assert/strict'

process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1'
process.env.DB_USER = process.env.DB_USER || 'test'
process.env.DB_PASS = process.env.DB_PASS || 'test'
process.env.DB_NAME = process.env.DB_NAME || 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret'
process.env.WHATSAPP_ALLOWED_LIST = process.env.WHATSAPP_ALLOWED_LIST || ''
process.env.MERCADOPAGO_MOCK = process.env.MERCADOPAGO_MOCK || '1'
process.env.MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || 'test-token'

const { pool } = await import('../src/lib/db.js')
const establishmentsRouter = (await import('../src/routes/estabelecimentos.js')).default
const agendamentosRouter = (await import('../src/routes/agendamentos.js')).default
const servicosRouter = (await import('../src/routes/servicos.js')).default
const slotsRouter = (await import('../src/routes/slots.js')).default
const relatoriosRouter = (await import('../src/routes/relatorios.js')).default
const professionalsRouter = (await import('../src/routes/profissionais.js')).default
const billingRouter = (await import('../src/routes/billing.js')).default
const { setAppointmentLimitNotifier } = await import('../src/lib/appointment_limits.js')
const { ensureWithinProfessionalLimit } = await import('../src/middleware/billing.js')
const {
  getWhatsAppWalletSnapshot,
  debitWhatsAppMessage,
  recordWhatsAppBlocked,
  WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT,
} = await import('../src/lib/whatsapp_wallet.js')
const { createMercadoPagoPixTopupCheckout, syncMercadoPagoPayment } = await import('../src/lib/billing.js')

const DEFAULT_BILLING_PLANS = [
  { code: 'starter', name: 'Starter', price_cents: 1490, max_professionals: 2, included_wa_messages: 250 },
  { code: 'pro', name: 'Pro', price_cents: 2990, max_professionals: 5, included_wa_messages: 500 },
  { code: 'premium', name: 'Premium', price_cents: 9990, max_professionals: 10, included_wa_messages: 1500 },
]

const DEFAULT_WHATSAPP_PACKS = [
  { id: 1, code: 'wa-100', name: 'WhatsApp 100', price_cents: 990, wa_messages: 100, is_active: 1 },
  { id: 2, code: 'wa-300', name: 'WhatsApp 300', price_cents: 2490, wa_messages: 300, is_active: 1 },
]

const state = {
  usuarios: new Map(),
  servicos: [],
  agendamentos: [],
  agendamentoItens: [],
  profissionais: [],
  servicoProfissionais: new Map(),
  bloqueios: [],
  report: defaultReport(),
  subscriptions: [],
  billingPlans: [],
  billingAddonPacks: [],
  whatsappWallets: new Map(),
  whatsappTransactions: [],
  subscriptionEvents: [],
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

function seedScenario({ user = {}, services = null, professionals = [], serviceProfessionals = [], bloqueios = [], appointments = [], subscriptions = [], report = null, billingPlans = null, addonPacks = null } = {}) {
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

  const agendamentoItens = []
  state.agendamentos = appointments.map((item, index) => {
    const id = item.id ?? index + 1
    const rawServiceIds = Array.isArray(item.servico_ids)
      ? item.servico_ids
      : Array.isArray(item.servicos)
      ? item.servicos.map((svc) => svc?.id).filter(Boolean)
      : (item.servico_id ?? item.servicoId ?? null) != null
      ? [item.servico_id ?? item.servicoId]
      : []
    const serviceIds = rawServiceIds.map((svcId) => Number(svcId)).filter((svcId) => Number.isFinite(svcId))
    const primaryServiceId = serviceIds[0] ?? (item.servico_id ?? item.servicoId ?? null)
    serviceIds.forEach((svcId, idx) => {
      const svc = state.servicos.find((row) => row.id === svcId)
      agendamentoItens.push({
        agendamento_id: id,
        servico_id: svcId,
        ordem: idx + 1,
        duracao_min: svc?.duracao_min ?? 0,
        preco_snapshot: svc?.preco_centavos ?? 0,
      })
    })
    return {
      id,
      cliente_id: item.cliente_id ?? item.clienteId ?? null,
      estabelecimento_id: item.estabelecimento_id ?? 1,
      servico_id: primaryServiceId,
      profissional_id: item.profissional_id ?? item.profissionalId ?? null,
      inicio: (() => {
        const d = item.inicio ? new Date(item.inicio) : new Date()
        return Number.isNaN(d.getTime()) ? new Date() : d
      })(),
      fim: (() => {
        if (item.fim) {
          const d = new Date(item.fim)
          if (!Number.isNaN(d.getTime())) return d
        }
        const start = item.inicio ? new Date(item.inicio) : new Date()
        const base = Number.isNaN(start.getTime()) ? new Date() : start
        const durMin = Number(item.duracao_min || item.duracaoMin || 60) || 60
        return new Date(base.getTime() + durMin * 60_000)
      })(),
      public_confirm_expires_at: item.public_confirm_expires_at ? new Date(item.public_confirm_expires_at) : null,
      status: item.status || 'confirmado',
      wa_messages_sent: item.wa_messages_sent ?? item.waMessagesSent ?? 0,
    }
  })
  state.agendamentoItens = agendamentoItens

  state.subscriptions = Array.isArray(subscriptions) ? clone(subscriptions) : []

  state.report = applyReportOverrides(defaultReport(), report)
  state.billingPlans = Array.isArray(billingPlans) && billingPlans.length ? clone(billingPlans) : clone(DEFAULT_BILLING_PLANS)
  state.billingAddonPacks = Array.isArray(addonPacks) && addonPacks.length ? clone(addonPacks) : clone(DEFAULT_WHATSAPP_PACKS)
  state.whatsappWallets = new Map()
  state.whatsappTransactions = []
  state.subscriptionEvents = []
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

async function simulateSendAppointment({ estabelecimentoId, agendamentoId, to, providerMessageId = 'test-message', message = '' }) {
  const estId = Number(estabelecimentoId || 0)
  const agId = agendamentoId != null ? Number(agendamentoId) : null
  if (!estId || !to) return { ok: false, error: 'invalid_payload' }

  const wallet = await getWhatsAppWalletSnapshot(estId)
  if (!wallet) return { ok: false, error: 'wallet_unavailable' }

  if (agId) {
    const ag = state.agendamentos.find((a) => Number(a.id) === agId)
    const sentCount = ag ? Number(ag.wa_messages_sent || 0) : 0
    if (sentCount >= WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT) {
      await recordWhatsAppBlocked({
        estabelecimentoId: estId,
        agendamentoId: agId,
        reason: 'per_appointment_limit',
        metadata: { sentCount, max: WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT },
      })
      return { ok: true, sent: false, blocked: true, reason: 'per_appointment_limit', wallet }
    }
  }

  if ((wallet.total_balance || 0) < 1) {
    await recordWhatsAppBlocked({
      estabelecimentoId: estId,
      agendamentoId: agId,
      reason: 'insufficient_balance',
      metadata: { message },
    })
    return { ok: true, sent: false, blocked: true, reason: 'insufficient_balance', wallet }
  }

  if (agId) {
    const ag = state.agendamentos.find((a) => Number(a.id) === agId)
    if (ag) ag.wa_messages_sent = (ag.wa_messages_sent || 0) + 1
  }

  const debit = await debitWhatsAppMessage({
    estabelecimentoId: estId,
    agendamentoId: agId,
    providerMessageId,
    metadata: { message },
  })
  return { ok: true, sent: true, provider_message_id: providerMessageId, debit }
}

function getWallet(estId) {
  return state.whatsappWallets.get(Number(estId)) || null
}

function upsertWallet({ estabelecimento_id, cycle_start, cycle_end, included_limit, included_balance, extra_balance }) {
  const key = Number(estabelecimento_id)
  const current = state.whatsappWallets.get(key)
  if (current) {
    state.whatsappWallets.set(key, {
      ...current,
      cycle_start,
      cycle_end,
      included_limit,
      included_balance,
      extra_balance,
    })
    return current
  }
  const wallet = {
    estabelecimento_id: key,
    cycle_start,
    cycle_end,
    included_limit,
    included_balance,
    extra_balance,
  }
  state.whatsappWallets.set(key, wallet)
  return wallet
}

function insertWaTransaction(tx) {
  const nextId = state.whatsappTransactions.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1
  const providerId = tx.provider_message_id ? String(tx.provider_message_id) : null
  if (providerId && state.whatsappTransactions.some((t) => String(t.provider_message_id || '') === providerId)) {
    return { affectedRows: 0, insertId: 0 }
  }
  if (tx.payment_id && state.whatsappTransactions.some((t) => t.kind === tx.kind && String(t.payment_id || '') === String(tx.payment_id))) {
    return { affectedRows: 0, insertId: 0 }
  }
  if (
    tx.kind === 'cycle_reset' &&
    tx.cycle_start &&
    state.whatsappTransactions.some(
      (t) =>
        t.kind === 'cycle_reset' &&
        Number(t.estabelecimento_id) === Number(tx.estabelecimento_id) &&
        new Date(t.cycle_start).getTime() === new Date(tx.cycle_start).getTime()
    )
  ) {
    return { affectedRows: 0, insertId: 0 }
  }

  const record = { id: nextId, ...tx }
  if (!record.created_at) record.created_at = new Date()
  state.whatsappTransactions.push(record)
  return { affectedRows: 1, insertId: nextId }
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

  if (norm.startsWith("SELECT COUNT(*) AS total FROM agendamentos WHERE estabelecimento_id=? AND status IN ('confirmado','pendente'") && norm.includes('AND inicio >= ? AND inicio < ?')) {
    const [estId, start, end] = params
    const startMs = new Date(start).getTime()
    const endMs = new Date(end).getTime()
    const allowedStatuses = norm.includes("'concluido'")
      ? ['confirmado', 'pendente', 'concluido']
      : ['confirmado', 'pendente']
    const total = state.agendamentos.filter((a) => {
      if (Number(a.estabelecimento_id) !== Number(estId)) return false
      const ms = new Date(a.inicio).getTime()
      if (Number.isNaN(ms)) return false
      const status = String(a.status || 'confirmado').toLowerCase()
      return allowedStatuses.includes(status) && ms >= startMs && ms < endMs
    }).length
    return [[{ total }], []]
  }

  if (norm.startsWith('SELECT COUNT(*) AS total FROM agendamentos WHERE estabelecimento_id=? AND inicio >= ? AND inicio < ?')) {
    const [estId, start, end] = params
    const startMs = new Date(start).getTime()
    const endMs = new Date(end).getTime()
    const total = state.agendamentos.filter((a) => {
      if (Number(a.estabelecimento_id) !== Number(estId)) return false
      const ms = new Date(a.inicio).getTime()
      if (Number.isNaN(ms)) return false
      return ms >= startMs && ms < endMs
    }).length
    return [[{ total }], []]
  }

  if (norm.startsWith('SELECT id FROM agendamentos WHERE estabelecimento_id') && norm.includes("status IN ('confirmado','pendente')") && norm.includes('(inicio < ? AND fim > ?)')) {
    const estId = params[0]
    const endMs = new Date(params[1]).getTime()
    const startMs = new Date(params[2]).getTime()
    const hasProfessionalFilter = norm.includes('profissional_id=?')
    const professionalId = hasProfessionalFilter ? Number(params[3]) : null
    const nowMs = Date.now()

    const rows = state.agendamentos
      .filter((a) => {
        if (Number(a.estabelecimento_id) !== Number(estId)) return false
        const status = String(a.status || 'confirmado').toLowerCase()
        if (!['confirmado', 'pendente'].includes(status)) return false

        if (status === 'pendente') {
          const expMs = a.public_confirm_expires_at ? new Date(a.public_confirm_expires_at).getTime() : NaN
          if (Number.isFinite(expMs) && expMs < nowMs) return false
        }

        const aStartMs = new Date(a.inicio).getTime()
        const aEndMs = new Date(a.fim).getTime()
        if (Number.isNaN(aStartMs) || Number.isNaN(aEndMs)) return false
        if (!(aStartMs < endMs && aEndMs > startMs)) return false

        if (hasProfessionalFilter) {
          if (a.profissional_id != null && Number(a.profissional_id) !== Number(professionalId)) return false
        }

        return true
      })
      .map((a) => ({ id: a.id }))

    return [rows, []]
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

  if (norm.startsWith('SELECT code, name, price_cents, max_professionals, included_wa_messages FROM billing_plans WHERE code=?')) {
    const code = params[0]
    const row = state.billingPlans.find((p) => p.code === code)
    return [row ? [{ ...row }] : [], []]
  }

  if (norm.startsWith('SELECT code, name, price_cents, max_professionals, included_wa_messages FROM billing_plans ORDER BY')) {
    return [state.billingPlans.map((p) => ({ ...p })), []]
  }

  if (norm.startsWith('SELECT id, code, name, price_cents, wa_messages, is_active, created_at FROM billing_addon_packs WHERE is_active=1')) {
    const rows = state.billingAddonPacks.filter((p) => p.is_active === 1 || p.is_active === true).map((p) => ({ ...p }))
    return [rows, []]
  }

  if (norm.startsWith('SELECT id, code, name, price_cents, wa_messages, is_active, created_at FROM billing_addon_packs WHERE code=?')) {
    const code = params[0]
    const requireActive = norm.includes('AND is_active=1')
    const row = state.billingAddonPacks.find(
      (p) => p.code === code && (!requireActive || p.is_active === 1 || p.is_active === true)
    )
    return [row ? [{ ...row }] : [], []]
  }

  if (norm.startsWith('SELECT id, code, name, price_cents, wa_messages, is_active, created_at FROM billing_addon_packs WHERE id=?')) {
    const id = Number(params[0])
    const requireActive = norm.includes('AND is_active=1')
    const row = state.billingAddonPacks.find(
      (p) => Number(p.id) === id && (!requireActive || p.is_active === 1 || p.is_active === true)
    )
    return [row ? [{ ...row }] : [], []]
  }

  if (norm.startsWith('SELECT bp.* FROM subscriptions s JOIN billing_plans bp ON bp.code = s.plan WHERE s.estabelecimento_id')) {
    const estId = Number(params[0])
    const allowed = new Set(['active', 'trialing'])
    const matches = state.subscriptions
      .filter((row) => Number(row?.estabelecimento_id ?? row?.estabelecimentoId) === estId && allowed.has(String(row?.status || '').toLowerCase()))
      .map((row) => {
        const endRaw = row.current_period_end ?? row.currentPeriodEnd ?? row.period_end ?? null
        const endMs = endRaw ? new Date(endRaw).getTime() : 0
        return { row, endMs: Number.isFinite(endMs) ? endMs : 0 }
      })
      .sort((a, b) => {
        if (a.endMs !== b.endMs) return b.endMs - a.endMs
        const idA = Number(a.row?.id || 0)
        const idB = Number(b.row?.id || 0)
        return idB - idA
      })
    const picked = matches[0]?.row
    if (!picked) return [[], []]
    const plan = state.billingPlans.find((p) => p.code === picked.plan)
    return [plan ? [{ ...plan }] : [], []]
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

  if (norm.startsWith("SELECT id, nome, duracao_min, preco_centavos FROM servicos WHERE id IN (")) {
    const estId = Number(params[params.length - 1])
    const serviceIds = params.slice(0, -1).map(Number)
    const rows = serviceIds
      .map((id) => state.servicos.find((s) => s.id === id && s.estabelecimento_id === estId && s.ativo))
      .filter(Boolean)
      .map((svc) => ({
        id: svc.id,
        nome: svc.nome,
        duracao_min: svc.duracao_min,
        preco_centavos: svc.preco_centavos ?? 0,
      }))
    return [rows, []]
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

  if (norm.startsWith("SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id=? AND ativo = 1")) {
    const estId = params[0]
    const total = state.profissionais.filter((p) => p.estabelecimento_id === estId && (p.ativo === 1 || p.ativo === true)).length
    return [[{ total }], []]
  }

  if (norm.startsWith("SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id")) {
    const estId = params[0]
    const total = state.profissionais.filter((p) => p.estabelecimento_id === estId).length
    return [[{ total }], []]
  }

  if (norm.startsWith('SELECT wa_messages_sent FROM agendamentos WHERE id=?')) {
    const id = params[0]
    const row = state.agendamentos.find((a) => Number(a.id) === Number(id))
    return [row ? [{ wa_messages_sent: row.wa_messages_sent ?? 0 }] : [], []]
  }

  if (norm.startsWith('UPDATE agendamentos SET wa_messages_sent=wa_messages_sent+1 WHERE id=?')) {
    const id = params[0]
    const row = state.agendamentos.find((a) => Number(a.id) === Number(id))
    if (row) row.wa_messages_sent = (row.wa_messages_sent || 0) + 1
    return [{ affectedRows: row ? 1 : 0 }, []]
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

  if (norm.startsWith('INSERT INTO profissionais')) {
    const [estId, nome, descricao, avatarUrl, ativoFlag] = params
    const nextId = state.profissionais.reduce((max, p) => Math.max(max, p.id), 0) + 1
    const newProf = {
      id: nextId,
      estabelecimento_id: estId,
      nome,
      descricao: descricao || null,
      avatar_url: avatarUrl || null,
      ativo: ativoFlag ? 1 : 0,
      created_at: new Date(),
      updated_at: new Date(),
    }
    state.profissionais.push(newProf)
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  if (norm.startsWith('SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, created_at FROM profissionais WHERE id=?')) {
    const id = params[0]
    const p = state.profissionais.find((row) => row.id === id)
    return [p ? [{ ...p }] : [], []]
  }

  if (norm.startsWith('UPDATE profissionais SET')) {
    const [nome, descricao, avatarUrl, ativoFlag, id, estId] = params
    const p = state.profissionais.find((row) => row.id === id && row.estabelecimento_id === estId)
    if (!p) return [{ affectedRows: 0 }, []]
    p.nome = nome
    p.descricao = descricao
    p.avatar_url = avatarUrl
    p.ativo = ativoFlag
    p.updated_at = new Date()
    return [{ affectedRows: 1 }, []]
  }

  if (norm.startsWith('SELECT email, telefone, nome FROM usuarios WHERE id=?')) {
    const id = params[0]
    const user = findUserById(id)
    if (!user) return [[], []]
    return [[{
      email: user.email || null,
      telefone: user.telefone || null,
      nome: user.nome || null,
    }], []]
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
    const estId = params[0]
    const nome = params[1]
    const descricao = params.length >= 6 ? params[2] : null
    const hasImage = params.length >= 7
    const imagemUrl = hasImage ? params[3] : null
    const duracaoMin = hasImage ? params[4] : params[3]
    const precoCentavos = hasImage ? params[5] : params[4]
    const ativoFlag = hasImage ? params[6] : params[5]
    const nextId = state.servicos.reduce((max, svc) => Math.max(max, svc.id), 0) + 1
    const newSvc = {
      id: nextId,
      estabelecimento_id: estId,
      nome,
      descricao: descricao || null,
      imagem_url: imagemUrl || null,
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

  if (norm.startsWith('SELECT servico_id, profissional_id FROM servico_profissionais WHERE servico_id IN (')) {
    const serviceIds = params.map(Number)
    const rows = []
    for (const svcId of serviceIds) {
      const set = state.servicoProfissionais.get(Number(svcId)) || new Set()
      for (const profId of set) {
        rows.push({ servico_id: svcId, profissional_id: profId })
      }
    }
    return [rows, []]
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

  if (norm.startsWith('SELECT * FROM subscriptions WHERE estabelecimento_id=? ORDER BY created_at DESC LIMIT 1')) {
    const estId = params[0]
    const latest = state.subscriptions
      .filter((row) => Number(row?.estabelecimento_id ?? row?.estabelecimentoId) === Number(estId))
      .map((row) => ({ row, ms: new Date(row?.created_at ?? row?.createdAt ?? 0).getTime() }))
      .filter((entry) => Number.isFinite(entry.ms))
      .sort((a, b) => b.ms - a.ms)?.[0]?.row || null
    return [latest ? [clone(latest)] : [], []]
  }

  if (norm.startsWith('SELECT * FROM subscriptions WHERE id=?')) {
    const id = Number(params[0])
    const row = state.subscriptions.find((r) => Number(r.id) === id)
    return [row ? [clone(row)] : [], []]
  }

  if (norm.startsWith('SELECT * FROM subscriptions WHERE gateway_preference_id=?')) {
    const pref = String(params[0])
    const matches = state.subscriptions
      .filter((r) => String(r.gateway_preference_id || r.gatewayPreferenceId || '') === pref)
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    const row = matches[0] || null
    return [row ? [clone(row)] : [], []]
  }

  if (norm.startsWith('SELECT * FROM subscriptions WHERE external_reference=?')) {
    const external = String(params[0])
    const matches = state.subscriptions
      .filter((r) => String(r.external_reference || r.externalReference || '') === external)
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    const row = matches[0] || null
    return [row ? [clone(row)] : [], []]
  }

  if (norm.startsWith('SELECT * FROM subscriptions WHERE estabelecimento_id=? ORDER BY created_at DESC')) {
    const estId = Number(params[0])
    const rows = state.subscriptions
      .filter((row) => Number(row?.estabelecimento_id ?? row?.estabelecimentoId) === estId)
      .sort((a, b) => {
        const msA = new Date(a?.created_at ?? a?.createdAt ?? 0).getTime()
        const msB = new Date(b?.created_at ?? b?.createdAt ?? 0).getTime()
        if (msA !== msB) return msB - msA
        return Number(b.id || 0) - Number(a.id || 0)
      })
    return [rows.map((r) => clone(r)), []]
  }

  if (norm.startsWith('INSERT INTO subscriptions')) {
    const columnsStr = norm.substring(norm.indexOf('(') + 1, norm.indexOf(') VALUES'))
    const columns = columnsStr.split(',').map((c) => c.trim())
    const row = { id: state.subscriptions.reduce((max, s) => Math.max(max, s.id || 0), 0) + 1 }
    columns.forEach((col, idx) => {
      row[col] = params[idx]
    })
    row.created_at = row.created_at || new Date()
    row.updated_at = row.updated_at || new Date()
    state.subscriptions.push(row)
    return [{ insertId: row.id, affectedRows: 1 }, []]
  }

  if (norm.startsWith('UPDATE subscriptions SET')) {
    const id = Number(params[params.length - 1])
    const row = state.subscriptions.find((r) => Number(r.id) === id)
    if (!row) return [{ affectedRows: 0 }, []]
    const setPart = norm.substring('UPDATE subscriptions SET '.length, norm.indexOf(' WHERE'))
    const assignments = setPart.split(',').map((a) => a.trim())
    const values = params.slice(0, -1)
    assignments.forEach((assign, idx) => {
      const [col] = assign.split('=')
      if (col && col !== 'updated_at') {
        row[col] = values[idx]
      }
    })
    row.updated_at = new Date()
    return [{ affectedRows: 1 }, []]
  }

  if (norm.startsWith('INSERT INTO subscription_events')) {
    const [subscriptionId, eventType, gatewayEventId, payload] = params
    const nextId = state.subscriptionEvents.reduce((max, ev) => Math.max(max, ev.id || 0), 0) + 1
    state.subscriptionEvents.push({
      id: nextId,
      subscription_id: subscriptionId,
      event_type: eventType,
      gateway_event_id: gatewayEventId,
      payload,
      created_at: new Date(),
    })
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  if (norm.startsWith('INSERT IGNORE INTO whatsapp_wallets')) {
    const [estId, cycleStart, cycleEnd, includedLimit, includedBalance] = params
    const existing = getWallet(estId)
    if (existing) return [{ affectedRows: 0, insertId: 0 }, []]
    upsertWallet({
      estabelecimento_id: estId,
      cycle_start: new Date(cycleStart),
      cycle_end: new Date(cycleEnd),
      included_limit: Number(includedLimit),
      included_balance: Number(includedBalance),
      extra_balance: 0,
    })
    return [{ affectedRows: 1, insertId: null }, []]
  }

  if (norm.startsWith('SELECT estabelecimento_id, cycle_start, cycle_end, included_limit, included_balance, extra_balance FROM whatsapp_wallets WHERE estabelecimento_id=?')) {
    const estId = params[0]
    const wallet = getWallet(estId)
    return [wallet ? [{ ...wallet }] : [], []]
  }

  if (norm.startsWith('UPDATE whatsapp_wallets SET cycle_start=?')) {
    const [cycleStart, cycleEnd, includedLimit, includedBalance, estId] = params
    const wallet = getWallet(estId)
    if (wallet) {
      upsertWallet({
        ...wallet,
        cycle_start: new Date(cycleStart),
        cycle_end: new Date(cycleEnd),
        included_limit: Number(includedLimit),
        included_balance: Number(includedBalance),
      })
    }
    return [{ affectedRows: wallet ? 1 : 0 }, []]
  }

  if (norm.startsWith('UPDATE whatsapp_wallets SET included_limit=')) {
    const [includedLimit, includedBalance, estId] = params
    const wallet = getWallet(estId)
    if (wallet) {
      upsertWallet({
        ...wallet,
        included_limit: Number(includedLimit),
        included_balance: Number(includedBalance),
      })
    }
    return [{ affectedRows: wallet ? 1 : 0 }, []]
  }

  if (norm.startsWith('UPDATE whatsapp_wallets SET extra_balance=extra_balance+?')) {
    const [delta, estId] = params
    const wallet = getWallet(estId)
    if (wallet) {
      wallet.extra_balance = (wallet.extra_balance || 0) + Number(delta || 0)
      upsertWallet(wallet)
    }
    return [{ affectedRows: wallet ? 1 : 0 }, []]
  }

  if (norm.startsWith('UPDATE whatsapp_wallets SET included_balance=GREATEST(included_balance-1')) {
    const estId = params[0]
    const wallet = getWallet(estId)
    if (wallet) {
      wallet.included_balance = Math.max((wallet.included_balance || 0) - 1, 0)
      upsertWallet(wallet)
    }
    return [{ affectedRows: wallet ? 1 : 0 }, []]
  }

  if (norm.startsWith('UPDATE whatsapp_wallets SET extra_balance=GREATEST(extra_balance-1')) {
    const estId = params[0]
    const wallet = getWallet(estId)
    if (wallet) {
      wallet.extra_balance = Math.max((wallet.extra_balance || 0) - 1, 0)
      upsertWallet(wallet)
    }
    return [{ affectedRows: wallet ? 1 : 0 }, []]
  }

  if (norm.startsWith('INSERT INTO whatsapp_wallet_transactions')) {
    if (norm.includes("'blocked'")) {
      const [estId, agendamentoId, reason, metadata] = params
      const result = insertWaTransaction({
        estabelecimento_id: estId,
        kind: 'blocked',
        delta: 0,
        included_delta: 0,
        extra_delta: 0,
        agendamento_id: agendamentoId,
        reason,
        metadata,
      })
      return [result, []]
    }
  }

  if (norm.startsWith("SELECT id, delta, included_delta, extra_delta, payment_id, metadata, created_at FROM whatsapp_wallet_transactions WHERE estabelecimento_id=? AND kind='topup_credit'")) {
    const [estId, limitRaw] = params
    const limit = Number(limitRaw) || 0
    const rows = state.whatsappTransactions
      .filter((t) => Number(t.estabelecimento_id) === Number(estId) && t.kind === 'topup_credit')
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      .slice(0, limit || state.whatsappTransactions.length)
      .map((t) => ({ id: t.id, delta: t.delta, included_delta: t.included_delta, extra_delta: t.extra_delta, payment_id: t.payment_id, metadata: t.metadata, created_at: t.created_at }))
    return [rows, []]
  }

  if (norm.startsWith('INSERT IGNORE INTO whatsapp_wallet_transactions')) {
    if (norm.includes("'cycle_reset'")) {
      const [estId, delta, includedDelta, cycleStart, cycleEnd, metadata] = params
      const result = insertWaTransaction({
        estabelecimento_id: estId,
        kind: 'cycle_reset',
        delta: Number(delta),
        included_delta: Number(includedDelta),
        extra_delta: 0,
        cycle_start: new Date(cycleStart),
        cycle_end: new Date(cycleEnd),
        metadata,
      })
      return [result, []]
    }
    if (norm.includes("'topup_credit'")) {
      const [estId, delta, extraDelta, subscriptionId, paymentId, reason, metadata] = params.length >= 7
        ? params
        : [...params, 'pix_pack', null].slice(0, 7)
      const result = insertWaTransaction({
        estabelecimento_id: estId,
        kind: 'topup_credit',
        delta: Number(delta),
        included_delta: 0,
        extra_delta: Number(extraDelta),
        subscription_id: subscriptionId,
        payment_id: paymentId,
        reason,
        metadata,
      })
      return [result, []]
    }
    if (norm.includes("'debit'")) {
      const [estId, includedDelta, extraDelta, agendamentoId, providerMessageId, metadata] = params
      const result = insertWaTransaction({
        estabelecimento_id: estId,
        kind: 'debit',
        delta: -1,
        included_delta: Number(includedDelta),
        extra_delta: Number(extraDelta),
        agendamento_id: agendamentoId,
        provider_message_id: providerMessageId,
        metadata,
      })
      return [result, []]
    }
    if (norm.includes("'blocked'")) {
      const [estId, agendamentoId, reason, metadata] = params
      const result = insertWaTransaction({
        estabelecimento_id: estId,
        kind: 'blocked',
        delta: 0,
        included_delta: 0,
        extra_delta: 0,
        agendamento_id: agendamentoId,
        reason,
        metadata,
      })
      return [result, []]
    }
  }

  if (norm.startsWith('INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, profissional_id, inicio, fim)')) {
    const [clienteId, estId, servicoId, profissionalId, inicio, fim] = params
    const nextId = state.agendamentos.reduce((max, item) => Math.max(max, item.id), 0) + 1
    state.agendamentos.push({
      id: nextId,
      cliente_id: clienteId,
      estabelecimento_id: estId,
      servico_id: servicoId,
      profissional_id: profissionalId ?? null,
      inicio: new Date(inicio),
      fim: new Date(fim),
      status: 'confirmado',
      public_confirm_expires_at: null,
    })
    return [{ insertId: nextId, affectedRows: 1 }, []]
  }

  if (norm.startsWith('INSERT INTO agendamento_itens (agendamento_id, servico_id, ordem, duracao_min, preco_snapshot)')) {
    const chunkSize = 5
    for (let i = 0; i < params.length; i += chunkSize) {
      const [agendamentoId, servicoId, ordem, duracaoMin, precoSnapshot] = params.slice(i, i + chunkSize)
      state.agendamentoItens.push({
        agendamento_id: Number(agendamentoId),
        servico_id: Number(servicoId),
        ordem: Number(ordem),
        duracao_min: Number(duracaoMin),
        preco_snapshot: Number(precoSnapshot),
      })
    }
    return [{ affectedRows: params.length / chunkSize, insertId: null }, []]
  }

  if (norm.startsWith('SELECT ai.agendamento_id, ai.servico_id, ai.ordem, ai.duracao_min, ai.preco_snapshot, s.nome AS servico_nome FROM agendamento_itens ai JOIN servicos s ON s.id = ai.servico_id WHERE ai.agendamento_id IN (')) {
    const appointmentIds = params.map(Number)
    const rows = []
    state.agendamentoItens
      .filter((item) => appointmentIds.includes(Number(item.agendamento_id)))
      .sort((a, b) => {
        if (a.agendamento_id !== b.agendamento_id) return a.agendamento_id - b.agendamento_id
        return (a.ordem || 0) - (b.ordem || 0)
      })
      .forEach((item) => {
        const svc = state.servicos.find((s) => s.id === Number(item.servico_id))
        rows.push({
          agendamento_id: item.agendamento_id,
          servico_id: item.servico_id,
          ordem: item.ordem,
          duracao_min: item.duracao_min,
          preco_snapshot: item.preco_snapshot,
          servico_nome: svc?.nome || null,
        })
      })
    return [rows, []]
  }

  if (norm.startsWith('SELECT * FROM agendamentos WHERE id=?')) {
    const id = params[0]
    const row = state.agendamentos.find((a) => Number(a.id) === Number(id)) || null
    return [row ? [clone(row)] : [], []]
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

async function callHandler(handler, { params = {}, body = {}, query = {}, user = {}, headers = {}, middlewares = [] }) {
  return new Promise((resolve, reject) => {
    let statusCode = 200
    let finished = false
    const req = { params, body, query, user, headers }
    const res = {
      status(code) { statusCode = code; return this },
      json(payload) {
        finished = true
        resolve({ status: statusCode, body: payload }); return this
      },
      send(payload) {
        finished = true
        resolve({ status: statusCode, body: payload }); return this
      },
      setHeader() { return this }
    }
    const runHandler = () => {
      if (finished) return
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
    }
    const runMiddleware = (index) => {
      if (finished) return
      if (index >= middlewares.length) return runHandler()
      try {
        const maybe = middlewares[index](req, res, (err) => {
          if (err) reject(err)
          else runMiddleware(index + 1)
        })
        if (maybe && typeof maybe.then === 'function') {
          maybe.catch(reject)
        }
      } catch (err) {
        reject(err)
      }
    }
    runMiddleware(0)
  })
}

const planHandler = getRouteHandler(establishmentsRouter, '/:id/plan', 'put')
const createAppointmentHandler = getRouteHandler(agendamentosRouter, '/', 'post')
const createServiceHandler = getRouteHandler(servicosRouter, '/', 'post')
const createProfessionalHandler = getRouteHandler(professionalsRouter, '/', 'post')
const slotToggleHandler = getRouteHandler(slotsRouter, '/toggle', 'post')
const relatorioHandler = getRouteHandler(relatoriosRouter, '/estabelecimento', 'get')
const waWalletHandler = getRouteHandler(billingRouter, '/whatsapp/wallet', 'get')
const waPacksHandler = getRouteHandler(billingRouter, '/whatsapp/packs', 'get')

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
    servico_ids: [10],
    inicio: future.toISOString()
  },
  user: { id: 42, tipo: 'cliente' }
})
results.push({ name: 'agendar com plano delinquent', response: res2 })
assert.equal(res2.status, 403)
assert.equal(res2.body?.error, 'plan_delinquent')

// 3) downgrade permitido mesmo com muitos servicos (sem limite de servicos)
seedScenario({
  user: { plan: 'pro', plan_status: 'active' },
  services: Array.from({ length: 12 }, (_, index) => ({ id: 200 + index }))
})
const res3 = await callHandler(planHandler, {
  params: { id: '1' },
  user: { id: 1, tipo: 'estabelecimento', plan: 'pro', plan_status: 'active' },
  body: { plan: 'starter' }
})
results.push({ name: 'downgrade permitido sem limite de servicos', response: res3 })
assert.equal(res3.status, 200)
assert.equal(res3.body.ok, true)
assert.equal(res3.body.plan.plan, 'starter')

// 4) criacao de servico bloqueada por inadimplencia
seedScenario({ user: { plan_status: 'delinquent' } })
const res4 = await callHandler(createServiceHandler, {
  body: { nome: 'Novo Servico', duracao_min: 30, preco_centavos: 1000 },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'criar servico com plano delinquent', response: res4 })
assert.equal(res4.status, 402)
assert.equal(res4.body?.error, 'plan_delinquent')

// 5) criacao de servico permitida acima do antigo limite (sem limite de servicos)
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  services: Array.from({ length: 10 }, (_, index) => ({ id: 300 + index })),
  professionals: [{ id: 10, estabelecimento_id: 1, nome: 'Profissional Teste' }],
})
const res5 = await callHandler(createServiceHandler, {
  body: { nome: 'Servico Extra', duracao_min: 45, preco_centavos: 1500, professionalIds: [10] },
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'criar servico acima do antigo limite', response: res5 })
assert.equal(res5.status, 200)
assert.equal(res5.body?.nome, 'Servico Extra')
assert.equal(state.servicos.length, 11)

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

// 13) agendamento permitido mesmo acima do antigo limite mensal do plano
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
    servico_ids: [10],
    inicio: limitAttempt.toISOString(),
  },
  user: { id: 77, tipo: 'cliente' }
})
results.push({ name: 'agendar permitido acima do antigo limite do plano', response: res13 })
assert.equal(res13.status, 201)
assert.equal(typeof res13.body?.id, 'number')
assert.equal(res13.body?.error, undefined)
assert.equal(appointmentLimitNotifications.length, 0)

// 14) bloqueio ao exceder limite de profissionais do plano vigente (starter)
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  subscriptions: [{
    id: 1,
    estabelecimento_id: 1,
    plan: 'starter',
    status: 'active',
    current_period_end: new Date(),
    created_at: new Date(),
  }],
})
const res14a = await callHandler(createProfessionalHandler, {
  body: { nome: 'Profissional A', ativo: true },
  user: { id: 1, tipo: 'estabelecimento' },
  middlewares: [ensureWithinProfessionalLimit()],
})
results.push({ name: 'criar profissional dentro do limite', response: res14a })
assert.equal(res14a.status, 200)

const res14b = await callHandler(createProfessionalHandler, {
  body: { nome: 'Profissional B', ativo: true },
  user: { id: 1, tipo: 'estabelecimento' },
  middlewares: [ensureWithinProfessionalLimit()],
})
results.push({ name: 'criar segundo profissional dentro do limite', response: res14b })
assert.equal(res14b.status, 200)

const res14c = await callHandler(createProfessionalHandler, {
  body: { nome: 'Profissional C', ativo: true },
  user: { id: 1, tipo: 'estabelecimento' },
  middlewares: [ensureWithinProfessionalLimit()],
})
results.push({ name: 'bloqueio ao exceder limite de profissionais', response: res14c })
assert.equal(res14c.status, 403)
assert.equal(res14c.body?.error, 'professional_limit_reached')

// 15) wallet cria franquia do plano e debita com idempotencia
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  subscriptions: [{
    id: 10,
    estabelecimento_id: 1,
    plan: 'starter',
    status: 'active',
    current_period_end: new Date(),
    created_at: new Date(),
  }],
})
const walletA = await getWhatsAppWalletSnapshot(1)
results.push({ name: 'wallet cria franquia starter', response: { status: 200 } })
assert.equal(walletA?.included_balance, 250)
assert.equal(walletA?.total_balance, 250)

const debitA = await debitWhatsAppMessage({ estabelecimentoId: 1, agendamentoId: null, providerMessageId: 'msg-123' })
assert.equal(debitA.ok, true)
assert.equal(debitA.bucket, 'included')
const walletB = await getWhatsAppWalletSnapshot(1)
assert.equal(walletB?.included_balance, 249)

const debitB = await debitWhatsAppMessage({ estabelecimentoId: 1, agendamentoId: null, providerMessageId: 'msg-123' })
assert.equal(debitB.ok, true)
assert.equal(debitB.idempotent, true)
const walletC = await getWhatsAppWalletSnapshot(1)
assert.equal(walletC?.included_balance, 249)

// 16) limite de 5 mensagens por agendamento
seedScenario({
  user: { plan: 'starter', plan_status: 'active' },
  appointments: [{ id: 900, estabelecimento_id: 1, wa_messages_sent: WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT }],
})
const waLimit = await simulateSendAppointment({
  estabelecimentoId: 1,
  agendamentoId: 900,
  to: '5511999999999',
  message: 'teste',
})
results.push({ name: 'wa bloqueia por limite por agendamento', response: { status: 200 } })
assert.equal(waLimit.blocked, true)
assert.equal(waLimit.reason, 'per_appointment_limit')
const agLimitRow = state.agendamentos.find((a) => a.id === 900)
assert.equal(agLimitRow?.wa_messages_sent, WHATSAPP_MAX_MESSAGES_PER_APPOINTMENT)

// 17) sem saldo: bloqueia envio mas mantem agendamento
seedScenario({
  user: { plan: 'starter', plan_status: 'delinquent' },
  appointments: [{ id: 901, estabelecimento_id: 1, wa_messages_sent: 0 }],
})
const waNoBalance = await simulateSendAppointment({
  estabelecimentoId: 1,
  agendamentoId: 901,
  to: '5511888888888',
  message: 'sem saldo',
})
results.push({ name: 'wa bloqueia por saldo insuficiente', response: { status: 200 } })
assert.equal(waNoBalance.blocked, true)
assert.equal(waNoBalance.reason, 'insufficient_balance')
const agNoBalance = state.agendamentos.find((a) => a.id === 901)
assert.equal(agNoBalance?.wa_messages_sent, 0)
assert.ok(agNoBalance)

// 18) listar pacotes extras de WhatsApp
seedScenario()
const res15 = await callHandler(waPacksHandler, {
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'listar pacotes whatsapp', response: res15 })
assert.equal(res15.status, 200)
assert.ok(Array.isArray(res15.body?.packs))
assert.ok(res15.body.packs.length >= 1)
assert.equal(res15.body.packs[0]?.code, state.billingAddonPacks[0].code)

// 19) cobranca PIX do pack e credito apos webhook
seedScenario({
  user: { plan: 'starter', plan_status: 'active', email: 'pix@teste.com' },
})
const targetPack = state.billingAddonPacks[0]
const beforePixWallet = await getWhatsAppWalletSnapshot(1)
results.push({ name: 'wallet inicial pix pack', response: { status: 200, body: beforePixWallet } })
assert.equal(beforePixWallet.extra_balance, 0)

const pixPack = await createMercadoPagoPixTopupCheckout({
  estabelecimento: { id: 1, email: 'pix@teste.com' },
  pack: targetPack,
  planHint: 'starter',
  availablePacks: state.billingAddonPacks,
})
results.push({ name: 'criar cobranca pix pack', response: { status: 200, body: pixPack.pix } })
assert.ok(pixPack.pix?.payment_id)
assert.ok(pixPack.pix?.qr_code)
assert.equal(pixPack.pix?.pack_code, targetPack.code)
pixPack.payment.status = 'approved'

const syncPixA = await syncMercadoPagoPayment(pixPack.payment.id, { type: 'payment' })
results.push({ name: 'webhook aprovado pack', response: { status: syncPixA?.ok ? 200 : 400 } })
assert.equal(syncPixA.ok, true)

const afterPixWallet = await getWhatsAppWalletSnapshot(1)
assert.equal(afterPixWallet.extra_balance, targetPack.wa_messages)
const txCount = state.whatsappTransactions.length

const syncPixB = await syncMercadoPagoPayment(pixPack.payment.id, { type: 'payment' })
results.push({ name: 'webhook idempotente pack', response: { status: syncPixB?.ok ? 200 : 400, body: syncPixB } })
const afterRepeatWallet = await getWhatsAppWalletSnapshot(1)
assert.equal(afterRepeatWallet.extra_balance, targetPack.wa_messages)
assert.equal(state.whatsappTransactions.length, txCount)

const walletRes = await callHandler(waWalletHandler, {
  user: { id: 1, tipo: 'estabelecimento' }
})
results.push({ name: 'wallet com historico', response: walletRes })
assert.equal(walletRes.status, 200)
assert.equal(walletRes.body?.wallet?.extra_balance, targetPack.wa_messages)
assert.ok(Array.isArray(walletRes.body?.history))
assert.equal(walletRes.body.history?.[0]?.payment_id, pixPack.pix.payment_id)
assert.equal(walletRes.body.history?.[0]?.pack_code, targetPack.code)

console.log('Testes executados com sucesso:')
for (const { name, response } of results) {
  console.log(`- ${name}: status ${response.status}`)
}

if (typeof pool.end === 'function') {
  try { await pool.end() } catch {}
}

process.exit(0)
