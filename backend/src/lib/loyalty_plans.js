import { pool } from './db.js'

const PLAN_STATUSES = new Set(['active', 'inactive', 'archived'])
const PERIODICITIES = new Set(['monthly'])

function toPositiveInt(value, { allowZero = false, fallback = null } = {}) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const parsed = Math.trunc(num)
  if (allowZero ? parsed < 0 : parsed <= 0) return fallback
  return parsed
}

function normalizeStatus(value, fallback = 'inactive') {
  const normalized = String(value || '').trim().toLowerCase()
  return PLAN_STATUSES.has(normalized) ? normalized : fallback
}

function normalizePeriodicity(value, fallback = 'monthly') {
  const normalized = String(value || '').trim().toLowerCase()
  return PERIODICITIES.has(normalized) ? normalized : fallback
}

function normalizePercent(value) {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (num < 0 || num > 100) return null
  return Number(num.toFixed(2))
}

function safeJsonParse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function mapPlanRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    estabelecimento_id: Number(row.estabelecimento_id),
    nome: row.nome || '',
    descricao: row.descricao || '',
    preco_centavos: Number(row.preco_centavos || 0),
    periodicidade: normalizePeriodicity(row.periodicidade),
    status: normalizeStatus(row.status),
    desconto_percentual_extras:
      row.desconto_percentual_extras == null ? null : Number(row.desconto_percentual_extras),
    max_assinantes: row.max_assinantes == null ? null : Number(row.max_assinantes),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    metrics: row.metrics_json ? safeJsonParse(row.metrics_json) : null,
    items: [],
  }
}

function mapPlanItemRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    loyalty_plan_id: Number(row.loyalty_plan_id),
    servico_id: Number(row.servico_id),
    quantidade_por_ciclo: Number(row.quantidade_por_ciclo || 0),
    ordem: Number(row.ordem || 0),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    servico: row.servico_nome
      ? {
          id: Number(row.servico_id),
          nome: row.servico_nome,
          descricao: row.servico_descricao || '',
          duracao_min: Number(row.servico_duracao_min || 0),
          preco_centavos: Number(row.servico_preco_centavos || 0),
          ativo: row.servico_ativo == null ? null : Boolean(row.servico_ativo),
        }
      : null,
  }
}

export function normalizeLoyaltyPlanPayload(payload = {}) {
  const nome = String(payload.nome || '').trim().slice(0, 120)
  const descricao = String(payload.descricao || '').trim()
  const precoCentavos = toPositiveInt(payload.preco_centavos)
  const periodicidade = normalizePeriodicity(payload.periodicidade)
  const status = normalizeStatus(payload.status || 'inactive')
  const descontoPercentualExtras = normalizePercent(payload.desconto_percentual_extras)
  const maxAssinantes =
    payload.max_assinantes === undefined || payload.max_assinantes === null || payload.max_assinantes === ''
      ? null
      : toPositiveInt(payload.max_assinantes)

  return {
    nome,
    descricao: descricao || null,
    preco_centavos: precoCentavos,
    periodicidade,
    status,
    desconto_percentual_extras: descontoPercentualExtras,
    max_assinantes: maxAssinantes,
  }
}

export async function validateLoyaltyPlanItems(estabelecimentoId, items = [], { db = pool } = {}) {
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item, index) => ({
          servico_id: toPositiveInt(item?.servico_id ?? item?.service_id ?? item?.id),
          quantidade_por_ciclo: toPositiveInt(item?.quantidade_por_ciclo ?? item?.quantity),
          ordem: toPositiveInt(item?.ordem ?? item?.order ?? index + 1, { allowZero: true, fallback: index + 1 }),
        }))
        .filter((item) => item.servico_id && item.quantidade_por_ciclo)
    : []

  if (!normalizedItems.length) {
    const error = new Error('Adicione ao menos um serviço ao plano.')
    error.status = 400
    error.code = 'loyalty_plan_items_required'
    throw error
  }

  const uniqueServiceIds = Array.from(new Set(normalizedItems.map((item) => item.servico_id)))
  if (uniqueServiceIds.length !== normalizedItems.length) {
    const error = new Error('Não repita o mesmo serviço dentro do plano.')
    error.status = 400
    error.code = 'loyalty_plan_duplicate_service'
    throw error
  }

  const placeholders = uniqueServiceIds.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT id, estabelecimento_id, nome, descricao, duracao_min, preco_centavos, ativo
       FROM servicos
      WHERE estabelecimento_id=?
        AND id IN (${placeholders})`,
    [estabelecimentoId, ...uniqueServiceIds]
  )

  const servicesById = new Map(rows.map((row) => [Number(row.id), row]))
  const missing = uniqueServiceIds.filter((id) => !servicesById.has(id))
  if (missing.length) {
    const error = new Error('Serviço inválido para este estabelecimento.')
    error.status = 400
    error.code = 'loyalty_plan_invalid_service'
    error.details = { missing }
    throw error
  }

  return normalizedItems
    .map((item) => ({
      ...item,
      servico: servicesById.get(item.servico_id),
    }))
    .sort((a, b) => a.ordem - b.ordem || a.servico_id - b.servico_id)
}

async function attachPlanItems(plans = [], { db = pool } = {}) {
  if (!Array.isArray(plans) || !plans.length) return plans
  const planIds = plans.map((plan) => plan.id)
  const placeholders = planIds.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT lpi.id,
            lpi.loyalty_plan_id,
            lpi.servico_id,
            lpi.quantidade_por_ciclo,
            lpi.ordem,
            lpi.created_at,
            s.nome AS servico_nome,
            s.descricao AS servico_descricao,
            s.duracao_min AS servico_duracao_min,
            s.preco_centavos AS servico_preco_centavos,
            s.ativo AS servico_ativo
       FROM loyalty_plan_items lpi
       JOIN servicos s ON s.id = lpi.servico_id
      WHERE lpi.loyalty_plan_id IN (${placeholders})
      ORDER BY lpi.loyalty_plan_id, lpi.ordem, lpi.id`,
    planIds
  )

  const grouped = new Map()
  rows.forEach((row) => {
    const key = Number(row.loyalty_plan_id)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(mapPlanItemRow(row))
  })

  plans.forEach((plan) => {
    plan.items = grouped.get(plan.id) || []
  })
  return plans
}

async function attachPlanMetrics(plans = [], { db = pool } = {}) {
  if (!Array.isArray(plans) || !plans.length) return plans
  const planIds = plans.map((plan) => plan.id)
  const placeholders = planIds.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT lp.id AS loyalty_plan_id,
            COUNT(cls.id) AS total_subscribers,
            SUM(CASE
                  WHEN cls.status IN ('active','past_due','unpaid')
                   AND cls.current_period_end IS NOT NULL
                   AND cls.current_period_end >= NOW()
                  THEN 1
                  ELSE 0
                END) AS active_subscribers,
            SUM(CASE
                  WHEN cls.status IN ('pending_payment','pending_pix')
                  THEN 1
                  ELSE 0
                END) AS pending_subscribers,
            SUM(CASE
                  WHEN cls.status IN ('canceled','expired')
                  THEN 1
                  ELSE 0
                END) AS inactive_subscribers,
            COALESCE(SUM(cc.quantidade_utilizada), 0) AS consumed_benefits
       FROM loyalty_plans lp
  LEFT JOIN client_loyalty_subscriptions cls ON cls.loyalty_plan_id = lp.id
  LEFT JOIN client_loyalty_subscription_credits cc ON cc.client_loyalty_subscription_id = cls.id
      WHERE lp.id IN (${placeholders})
      GROUP BY lp.id`,
    planIds
  )
  const metricsByPlanId = new Map()
  rows.forEach((row) => {
    metricsByPlanId.set(Number(row.loyalty_plan_id), {
      total_subscribers: Number(row.total_subscribers || 0),
      active_subscribers: Number(row.active_subscribers || 0),
      pending_subscribers: Number(row.pending_subscribers || 0),
      inactive_subscribers: Number(row.inactive_subscribers || 0),
      consumed_benefits: Number(row.consumed_benefits || 0),
    })
  })

  plans.forEach((plan) => {
    const metrics = metricsByPlanId.get(plan.id) || {
      total_subscribers: 0,
      active_subscribers: 0,
      pending_subscribers: 0,
      inactive_subscribers: 0,
      consumed_benefits: 0,
    }
    plan.metrics = {
      ...metrics,
      estimated_monthly_revenue_cents: metrics.active_subscribers * Number(plan.preco_centavos || 0),
    }
  })
  return plans
}

export async function listLoyaltyPlansForEstablishment(estabelecimentoId, { includeArchived = true, db = pool } = {}) {
  const filters = ['estabelecimento_id=?']
  const values = [estabelecimentoId]
  if (!includeArchived) {
    filters.push("status<>'archived'")
  }
  const [rows] = await db.query(
    `SELECT *
       FROM loyalty_plans
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC, id DESC`,
    values
  )
  const plans = rows.map(mapPlanRow)
  await attachPlanItems(plans, { db })
  await attachPlanMetrics(plans, { db })
  return plans
}

export async function getLoyaltyPlanById(id, { db = pool } = {}) {
  const [rows] = await db.query('SELECT * FROM loyalty_plans WHERE id=? LIMIT 1', [id])
  const plan = mapPlanRow(rows?.[0])
  if (!plan) return null
  await attachPlanItems([plan], { db })
  await attachPlanMetrics([plan], { db })
  return plan
}

export async function getLoyaltyPlanForEstablishment(estabelecimentoId, planId, { db = pool } = {}) {
  const [rows] = await db.query(
    'SELECT * FROM loyalty_plans WHERE id=? AND estabelecimento_id=? LIMIT 1',
    [planId, estabelecimentoId]
  )
  const plan = mapPlanRow(rows?.[0])
  if (!plan) return null
  await attachPlanItems([plan], { db })
  await attachPlanMetrics([plan], { db })
  return plan
}

export async function getPublicLoyaltyPlansForEstablishment(estabelecimentoId, { db = pool } = {}) {
  const [rows] = await db.query(
    `SELECT *
       FROM loyalty_plans
      WHERE estabelecimento_id=?
        AND status='active'
      ORDER BY preco_centavos ASC, created_at ASC, id ASC`,
    [estabelecimentoId]
  )
  const plans = rows.map(mapPlanRow)
  await attachPlanItems(plans, { db })
  return plans
}

export async function createLoyaltyPlan(estabelecimentoId, payload = {}) {
  const planData = normalizeLoyaltyPlanPayload(payload)
  if (!planData.nome || !planData.preco_centavos) {
    const error = new Error('Informe nome e valor mensal do plano.')
    error.status = 400
    error.code = 'loyalty_plan_invalid_payload'
    throw error
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const items = await validateLoyaltyPlanItems(estabelecimentoId, payload.items || [], { db: conn })
    const [insert] = await conn.query(
      `INSERT INTO loyalty_plans
        (estabelecimento_id, nome, descricao, preco_centavos, periodicidade, status, desconto_percentual_extras, max_assinantes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        estabelecimentoId,
        planData.nome,
        planData.descricao,
        planData.preco_centavos,
        planData.periodicidade,
        planData.status,
        planData.desconto_percentual_extras,
        planData.max_assinantes,
      ]
    )

    for (const item of items) {
      await conn.query(
        `INSERT INTO loyalty_plan_items
          (loyalty_plan_id, servico_id, quantidade_por_ciclo, ordem)
         VALUES (?,?,?,?)`,
        [insert.insertId, item.servico_id, item.quantidade_por_ciclo, item.ordem]
      )
    }

    await conn.commit()
    return getLoyaltyPlanById(insert.insertId)
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function updateLoyaltyPlan(estabelecimentoId, planId, payload = {}) {
  const existing = await getLoyaltyPlanForEstablishment(estabelecimentoId, planId)
  if (!existing) {
    const error = new Error('Plano não encontrado.')
    error.status = 404
    error.code = 'loyalty_plan_not_found'
    throw error
  }

  const nextData = normalizeLoyaltyPlanPayload({
    ...existing,
    ...payload,
  })
  if (!nextData.nome || !nextData.preco_centavos) {
    const error = new Error('Informe nome e valor mensal do plano.')
    error.status = 400
    error.code = 'loyalty_plan_invalid_payload'
    throw error
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const items = await validateLoyaltyPlanItems(estabelecimentoId, payload.items || existing.items || [], { db: conn })
    await conn.query(
      `UPDATE loyalty_plans
          SET nome=?,
              descricao=?,
              preco_centavos=?,
              periodicidade=?,
              status=?,
              desconto_percentual_extras=?,
              max_assinantes=?
        WHERE id=? AND estabelecimento_id=?
        LIMIT 1`,
      [
        nextData.nome,
        nextData.descricao,
        nextData.preco_centavos,
        nextData.periodicidade,
        nextData.status,
        nextData.desconto_percentual_extras,
        nextData.max_assinantes,
        planId,
        estabelecimentoId,
      ]
    )
    await conn.query('DELETE FROM loyalty_plan_items WHERE loyalty_plan_id=?', [planId])
    for (const item of items) {
      await conn.query(
        `INSERT INTO loyalty_plan_items
          (loyalty_plan_id, servico_id, quantidade_por_ciclo, ordem)
         VALUES (?,?,?,?)`,
        [planId, item.servico_id, item.quantidade_por_ciclo, item.ordem]
      )
    }
    await conn.commit()
    return getLoyaltyPlanById(planId)
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function updateLoyaltyPlanStatus(estabelecimentoId, planId, status) {
  const normalizedStatus = normalizeStatus(status, '')
  if (!normalizedStatus) {
    const error = new Error('Status inválido para o plano.')
    error.status = 400
    error.code = 'loyalty_plan_invalid_status'
    throw error
  }
  const [result] = await pool.query(
    'UPDATE loyalty_plans SET status=? WHERE id=? AND estabelecimento_id=? LIMIT 1',
    [normalizedStatus, planId, estabelecimentoId]
  )
  if (!result?.affectedRows) {
    const error = new Error('Plano não encontrado.')
    error.status = 404
    error.code = 'loyalty_plan_not_found'
    throw error
  }
  return getLoyaltyPlanById(planId)
}

export async function archiveLoyaltyPlan(estabelecimentoId, planId) {
  return updateLoyaltyPlanStatus(estabelecimentoId, planId, 'archived')
}

export async function listLoyaltySubscribersForEstablishment(estabelecimentoId, { status = '', db = pool } = {}) {
  const filters = ['cls.estabelecimento_id=?']
  const values = [estabelecimentoId]
  if (status) {
    filters.push('cls.status=?')
    values.push(String(status).trim().toLowerCase())
  }
  const [rows] = await db.query(
    `SELECT cls.*,
            lp.nome AS plan_name,
            lp.preco_centavos AS plan_price_cents,
            lp.desconto_percentual_extras AS plan_discount_percent,
            u.nome AS cliente_nome,
            u.email AS cliente_email,
            u.telefone AS cliente_telefone
       FROM client_loyalty_subscriptions cls
       JOIN loyalty_plans lp ON lp.id = cls.loyalty_plan_id
       JOIN usuarios u ON u.id = cls.cliente_id
      WHERE ${filters.join(' AND ')}
      ORDER BY cls.updated_at DESC, cls.id DESC`,
    values
  )
  return rows.map((row) => ({
    id: Number(row.id),
    cliente_id: Number(row.cliente_id),
    cliente_nome: row.cliente_nome || '',
    cliente_email: row.cliente_email || '',
    cliente_telefone: row.cliente_telefone || '',
    estabelecimento_id: Number(row.estabelecimento_id),
    loyalty_plan_id: Number(row.loyalty_plan_id),
    plan_name: row.plan_name || '',
    plan_price_cents: Number(row.plan_price_cents || 0),
    plan_discount_percent:
      row.plan_discount_percent == null ? null : Number(row.plan_discount_percent),
    status: String(row.status || '').toLowerCase(),
    payment_method: String(row.payment_method || '').toLowerCase(),
    current_period_start: row.current_period_start ? new Date(row.current_period_start).toISOString() : null,
    current_period_end: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    next_billing_at: row.next_billing_at ? new Date(row.next_billing_at).toISOString() : null,
    last_payment_at: row.last_payment_at ? new Date(row.last_payment_at).toISOString() : null,
    canceled_at: row.canceled_at ? new Date(row.canceled_at).toISOString() : null,
    auto_renew: Boolean(row.auto_renew ?? 0),
  }))
}
