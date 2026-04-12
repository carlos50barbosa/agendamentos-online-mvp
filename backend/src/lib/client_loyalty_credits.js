import { pool } from './db.js'
import {
  computeClientLoyaltySubscriptionState,
  getPreferredClientLoyaltySubscription,
} from './client_loyalty_subscriptions.js'

function toDate(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function addMonths(dateValue, months = 1) {
  const date = toDate(dateValue)
  if (!date) return null
  const result = new Date(date)
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

export function formatCycleRef(dateValue) {
  const date = toDate(dateValue)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function normalizeServiceItems(serviceItems = []) {
  return Array.isArray(serviceItems)
    ? serviceItems
        .map((item) => ({
          id: Number(item?.id || item?.servico_id || 0),
          nome: item?.nome || item?.name || '',
          preco_centavos: Math.max(0, Math.round(Number(item?.preco_centavos ?? item?.preco_snapshot ?? 0) || 0)),
          duracao_min: Math.max(0, Math.round(Number(item?.duracao_min || 0) || 0)),
        }))
        .filter((item) => Number.isFinite(item.id) && item.id > 0)
    : []
}

function mapCreditRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    client_loyalty_subscription_id: Number(row.client_loyalty_subscription_id),
    servico_id: Number(row.servico_id),
    ciclo_ref: row.ciclo_ref ? new Date(row.ciclo_ref).toISOString().slice(0, 10) : null,
    quantidade_total: Number(row.quantidade_total || 0),
    quantidade_utilizada: Number(row.quantidade_utilizada || 0),
    quantidade_restante: Number(row.quantidade_restante || 0),
    expira_em: row.expira_em ? new Date(row.expira_em).toISOString() : null,
    servico_nome: row.servico_nome || '',
  }
}

export async function listSubscriptionCredits(subscriptionId, { db = pool, cycleRef = null, onlyAvailable = false } = {}) {
  if (!subscriptionId) return []
  const filters = ['cc.client_loyalty_subscription_id=?']
  const values = [subscriptionId]
  if (cycleRef) {
    filters.push('cc.ciclo_ref=?')
    values.push(cycleRef)
  }
  if (onlyAvailable) {
    filters.push('cc.quantidade_restante > 0')
  }
  const [rows] = await db.query(
    `SELECT cc.*, s.nome AS servico_nome
       FROM client_loyalty_subscription_credits cc
       JOIN servicos s ON s.id = cc.servico_id
      WHERE ${filters.join(' AND ')}
      ORDER BY cc.ciclo_ref DESC, cc.servico_id ASC`,
    values
  )
  return rows.map(mapCreditRow)
}

export async function ensureCreditsForCurrentCycle(subscription, { db = pool } = {}) {
  if (!subscription?.id || !subscription?.loyaltyPlanId) return []
  const cycleStart = toDate(subscription.currentPeriodStart)
  const cycleEnd = toDate(subscription.currentPeriodEnd)
  if (!cycleStart || !cycleEnd) return []

  const cycleRef = formatCycleRef(cycleStart)
  const [items] = await db.query(
    `SELECT servico_id, quantidade_por_ciclo
       FROM loyalty_plan_items
      WHERE loyalty_plan_id=?
      ORDER BY ordem ASC, id ASC`,
    [subscription.loyaltyPlanId]
  )
  for (const item of items) {
    const total = Math.max(0, Math.trunc(Number(item.quantidade_por_ciclo || 0)))
    await db.query(
      `INSERT INTO client_loyalty_subscription_credits
        (client_loyalty_subscription_id, servico_id, ciclo_ref, quantidade_total, quantidade_utilizada, quantidade_restante, expira_em)
       VALUES (?,?,?,?,0,?,?)
       ON DUPLICATE KEY UPDATE
         quantidade_total=VALUES(quantidade_total),
         quantidade_restante=GREATEST(quantidade_restante, VALUES(quantidade_restante)),
         expira_em=VALUES(expira_em),
         updated_at=CURRENT_TIMESTAMP`,
      [subscription.id, item.servico_id, cycleRef, total, total, cycleEnd]
    )
  }
  return listSubscriptionCredits(subscription.id, { db, cycleRef })
}

function buildBenefitPreview({ subscription, plan, credits = [], serviceItems = [] }) {
  const normalizedItems = normalizeServiceItems(serviceItems)
  const discountPercent = plan?.desconto_percentual_extras == null ? null : Number(plan.desconto_percentual_extras)
  const creditsByServiceId = new Map()
  credits.forEach((credit) => {
    creditsByServiceId.set(Number(credit.servico_id), {
      ...credit,
      quantidade_restante: Number(credit.quantidade_restante || 0),
    })
  })

  const previewItems = normalizedItems.map((item) => {
    const credit = creditsByServiceId.get(item.id)
    const hasCredit = Boolean(credit && Number(credit.quantidade_restante || 0) > 0)
    if (hasCredit) {
      credit.quantidade_restante -= 1
      return {
        servico_id: item.id,
        nome: item.nome,
        original_centavos: item.preco_centavos,
        cobrado_centavos: 0,
        benefit_type: 'credit',
        credit_id: credit.id,
        discount_percent: null,
      }
    }

    if (discountPercent != null && discountPercent > 0) {
      const charged = Math.max(
        0,
        Math.round(item.preco_centavos * ((100 - discountPercent) / 100))
      )
      return {
        servico_id: item.id,
        nome: item.nome,
        original_centavos: item.preco_centavos,
        cobrado_centavos: charged,
        benefit_type: 'discount',
        credit_id: null,
        discount_percent: discountPercent,
      }
    }

    return {
      servico_id: item.id,
      nome: item.nome,
      original_centavos: item.preco_centavos,
      cobrado_centavos: item.preco_centavos,
      benefit_type: 'full',
      credit_id: null,
      discount_percent: null,
    }
  })

  const consumedCredits = previewItems
    .filter((item) => item.benefit_type === 'credit' && item.credit_id)
    .reduce((acc, item) => {
      const key = Number(item.credit_id)
      if (!acc.has(key)) {
        acc.set(key, {
          credit_id: key,
          servico_id: Number(item.servico_id),
          quantity: 0,
        })
      }
      acc.get(key).quantity += 1
      return acc
    }, new Map())

  const totalOriginalCents = previewItems.reduce((sum, item) => sum + item.original_centavos, 0)
  const totalChargeCents = previewItems.reduce((sum, item) => sum + item.cobrado_centavos, 0)

  return {
    subscription,
    plan,
    items: previewItems,
    total_original_centavos: totalOriginalCents,
    total_cobrado_centavos: totalChargeCents,
    loyalty_credit_applied: previewItems.some((item) => item.benefit_type === 'credit'),
    loyalty_discount_percent:
      previewItems.some((item) => item.benefit_type === 'discount') ? discountPercent : null,
    consumed_credits: Array.from(consumedCredits.values()),
  }
}

async function loadEligibleSubscription(clienteId, estabelecimentoId, appointmentAt, { db = pool } = {}) {
  const subscription = await getPreferredClientLoyaltySubscription(
    clienteId,
    estabelecimentoId,
    { db, referenceDate: appointmentAt }
  )
  if (!subscription) return null

  const state = computeClientLoyaltySubscriptionState(subscription, { referenceDate: appointmentAt })
  if (!state.benefitsActive) return null

  const [planRows] = await db.query(
    'SELECT * FROM loyalty_plans WHERE id=? LIMIT 1',
    [subscription.loyaltyPlanId]
  )
  const plan = planRows?.[0]
  if (!plan || String(plan.status || '').toLowerCase() === 'archived') return null

  const cycleRef = formatCycleRef(subscription.currentPeriodStart)
  const credits = await listSubscriptionCredits(subscription.id, {
    db,
    cycleRef,
    onlyAvailable: false,
  })

  return {
    subscription,
    plan: {
      id: Number(plan.id),
      nome: plan.nome || '',
      desconto_percentual_extras:
        plan.desconto_percentual_extras == null ? null : Number(plan.desconto_percentual_extras),
    },
    credits,
  }
}

export async function previewClientLoyaltyBenefits({
  clienteId,
  estabelecimentoId,
  serviceItems = [],
  appointmentAt = new Date(),
  db = pool,
} = {}) {
  const eligible = await loadEligibleSubscription(clienteId, estabelecimentoId, appointmentAt, { db })
  if (!eligible) {
    return {
      subscription: null,
      plan: null,
      items: normalizeServiceItems(serviceItems).map((item) => ({
        servico_id: item.id,
        nome: item.nome,
        original_centavos: item.preco_centavos,
        cobrado_centavos: item.preco_centavos,
        benefit_type: 'full',
        credit_id: null,
        discount_percent: null,
      })),
      total_original_centavos: normalizeServiceItems(serviceItems).reduce((sum, item) => sum + item.preco_centavos, 0),
      total_cobrado_centavos: normalizeServiceItems(serviceItems).reduce((sum, item) => sum + item.preco_centavos, 0),
      loyalty_credit_applied: false,
      loyalty_discount_percent: null,
      consumed_credits: [],
    }
  }

  return buildBenefitPreview({
    subscription: eligible.subscription,
    plan: eligible.plan,
    credits: eligible.credits,
    serviceItems,
  })
}

export async function applyClientLoyaltyBenefitsTx({
  db,
  clienteId,
  estabelecimentoId,
  serviceItems = [],
  appointmentAt = new Date(),
} = {}) {
  const normalizedItems = normalizeServiceItems(serviceItems)
  if (!normalizedItems.length) {
    return {
      subscription: null,
      plan: null,
      items: [],
      total_original_centavos: 0,
      total_cobrado_centavos: 0,
      loyalty_credit_applied: false,
      loyalty_discount_percent: null,
      consumed_credits: [],
      snapshot: null,
    }
  }

  const eligible = await loadEligibleSubscription(clienteId, estabelecimentoId, appointmentAt, { db })
  if (!eligible) {
    const total = normalizedItems.reduce((sum, item) => sum + item.preco_centavos, 0)
    return {
      subscription: null,
      plan: null,
      items: normalizedItems.map((item) => ({
        servico_id: item.id,
        nome: item.nome,
        original_centavos: item.preco_centavos,
        cobrado_centavos: item.preco_centavos,
        benefit_type: 'full',
        credit_id: null,
        discount_percent: null,
      })),
      total_original_centavos: total,
      total_cobrado_centavos: total,
      loyalty_credit_applied: false,
      loyalty_discount_percent: null,
      consumed_credits: [],
      snapshot: null,
    }
  }

  await ensureCreditsForCurrentCycle(eligible.subscription, { db })
  const cycleRef = formatCycleRef(eligible.subscription.currentPeriodStart)
  const serviceIds = Array.from(new Set(normalizedItems.map((item) => item.id)))
  const placeholders = serviceIds.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT cc.*, s.nome AS servico_nome
       FROM client_loyalty_subscription_credits cc
       JOIN servicos s ON s.id = cc.servico_id
      WHERE cc.client_loyalty_subscription_id=?
        AND cc.ciclo_ref=?
        AND cc.servico_id IN (${placeholders})
      FOR UPDATE`,
    [eligible.subscription.id, cycleRef, ...serviceIds]
  )
  const preview = buildBenefitPreview({
    subscription: eligible.subscription,
    plan: eligible.plan,
    credits: rows.map(mapCreditRow),
    serviceItems: normalizedItems,
  })

  for (const consumed of preview.consumed_credits) {
    await db.query(
      `UPDATE client_loyalty_subscription_credits
          SET quantidade_utilizada = quantidade_utilizada + ?,
              quantidade_restante = GREATEST(0, quantidade_restante - ?),
              updated_at = CURRENT_TIMESTAMP
        WHERE id=?
        LIMIT 1`,
      [consumed.quantity, consumed.quantity, consumed.credit_id]
    )
  }

  const snapshot = {
    loyalty_plan_id: eligible.subscription.loyaltyPlanId,
    loyalty_subscription_id: eligible.subscription.id,
    plan_name: eligible.plan.nome,
    discount_percent: preview.loyalty_discount_percent,
    total_original_centavos: preview.total_original_centavos,
    total_cobrado_centavos: preview.total_cobrado_centavos,
    current_period_start: eligible.subscription.currentPeriodStart
      ? eligible.subscription.currentPeriodStart.toISOString()
      : null,
    current_period_end: eligible.subscription.currentPeriodEnd
      ? eligible.subscription.currentPeriodEnd.toISOString()
      : null,
    items: preview.items,
    consumed_credits: preview.consumed_credits,
  }

  return {
    ...preview,
    snapshot,
  }
}

export async function restoreClientLoyaltyBenefitsFromSnapshotTx(snapshotInput, { db = pool } = {}) {
  const snapshot =
    typeof snapshotInput === 'string'
      ? (() => {
          try { return JSON.parse(snapshotInput) } catch { return null }
        })()
      : snapshotInput
  const consumedCredits = Array.isArray(snapshot?.consumed_credits) ? snapshot.consumed_credits : []
  for (const item of consumedCredits) {
    const creditId = Number(item?.credit_id || 0)
    const quantity = Math.max(0, Math.trunc(Number(item?.quantity || 0)))
    if (!creditId || !quantity) continue
    await db.query(
      `UPDATE client_loyalty_subscription_credits
          SET quantidade_utilizada = GREATEST(0, quantidade_utilizada - ?),
              quantidade_restante = quantidade_restante + ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id=?
        LIMIT 1`,
      [quantity, quantity, creditId]
    )
  }
}

export async function getClientLoyaltyBenefitContext({
  clienteId,
  estabelecimentoId,
  appointmentAt = new Date(),
  db = pool,
} = {}) {
  const eligible = await loadEligibleSubscription(clienteId, estabelecimentoId, appointmentAt, { db })
  if (!eligible) {
    return {
      subscription: null,
      plan: null,
      credits: [],
      credits_by_service: {},
    }
  }
  await ensureCreditsForCurrentCycle(eligible.subscription, { db })
  const credits = await listSubscriptionCredits(eligible.subscription.id, {
    db,
    cycleRef: formatCycleRef(eligible.subscription.currentPeriodStart),
    onlyAvailable: false,
  })
  const creditsByService = {}
  credits.forEach((credit) => {
    creditsByService[String(credit.servico_id)] = {
      credit_id: credit.id,
      servico_id: credit.servico_id,
      servico_nome: credit.servico_nome,
      quantidade_total: credit.quantidade_total,
      quantidade_utilizada: credit.quantidade_utilizada,
      quantidade_restante: credit.quantidade_restante,
      expira_em: credit.expira_em,
    }
  })
  return {
    subscription: eligible.subscription,
    plan: eligible.plan,
    credits,
    credits_by_service: creditsByService,
  }
}
