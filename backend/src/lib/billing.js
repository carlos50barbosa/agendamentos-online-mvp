// backend/src/lib/billing.js
import { randomUUID } from 'node:crypto'
import { MercadoPagoConfig, PreApproval, PreApprovalPlan } from 'mercadopago'
import { config } from './config.js'
import {
  PLAN_TIERS,
  getPlanPriceCents,
  getPlanLabel,
  normalizeBillingCycle,
  getBillingCycleConfig,
} from './plans.js'
import {
  createSubscription,
  updateSubscription,
  getSubscriptionByGatewayId,
  getSubscriptionByPlanId,
  appendSubscriptionEvent,
} from './subscriptions.js'
import { pool } from './db.js'

const BILLING_CURRENCY = (config.billing?.currency || 'BRL').toUpperCase()

let mercadoPagoClient = null
let mercadoPagoPreapproval = null
let mercadoPagoPlan = null

function ensureMercadoPagoPreapproval() {
  if (mercadoPagoPreapproval) return mercadoPagoPreapproval
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) {
    throw new Error('Mercado Pago access token is not configured')
  }
  mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPreapproval = new PreApproval(mercadoPagoClient)
  return mercadoPagoPreapproval
}

function ensureMercadoPagoPlan() {
  if (mercadoPagoPlan) return mercadoPagoPlan
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) {
    throw new Error('Mercado Pago access token is not configured')
  }
  if (!mercadoPagoClient) mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPlan = new PreApprovalPlan(mercadoPagoClient)
  return mercadoPagoPlan
}

export async function getPlanInitPoint(preApprovalPlanId) {
  if (!preApprovalPlanId) return null
  const client = ensureMercadoPagoPlan()
  try {
    const plan = await client.get({ preApprovalPlanId })
    const accessToken = config.billing?.mercadopago?.accessToken || ''
    const isTestToken = /^TEST-/.test(accessToken)
    // Em modo teste, prefira o sandbox_init_point quando disponível
    if (isTestToken) return plan?.sandbox_init_point || plan?.init_point || null
    return plan?.init_point || plan?.sandbox_init_point || null
  } catch (e) {
    console.warn('[mp][preapproval_plan.get] failed', preApprovalPlanId, e?.message || e)
    return null
  }
}

function formatAmountString(priceCents) {
  const n = Number(priceCents || 0)
  return (n / 100).toFixed(2) // string com 2 casas decimais
}

function extractMpError(err) {
  try {
    const out = {
      name: err?.name,
      message: err?.message,
      status: err?.status,
      response: err?.response?.data || null,
      cause: Array.isArray(err?.cause) ? err.cause : undefined,
    }
    return JSON.stringify(out)
  } catch { return String(err?.message || err) }
}

function buildExternalReference(estabelecimentoId, plan, cycle) {
  const normalizedCycle = normalizeBillingCycle(cycle)
  const base = `plan:${plan}:cycle:${normalizedCycle}:est:${estabelecimentoId}`
  return `${base}:${randomUUID()}`
}

function pickValidUrl(...candidates) {
  for (const value of candidates) {
    const str = String(value || '').trim()
    if (!str) continue
    try {
      const parsed = new URL(str)
      if (parsed.protocol === 'https:') {
        return parsed.toString()
      }
    } catch {
      // ignora URLs inválidas
    }
  }
  return null
}

const MP_TO_PLAN_STATUS = {
  authorized: 'active',
  active: 'active',
  paused: 'delinquent',
  halted: 'delinquent',
  stopped: 'delinquent',
  cancelled: 'canceled',
  canceled: 'canceled',
  cancelled_by_collector: 'canceled',
  cancelled_by_merchant: 'canceled',
  expired: 'expired',
  finished: 'expired',
  pending: 'pending',
  inprocess: 'pending',
  in_process: 'pending',
  charged_back: 'delinquent',
  rejected: 'delinquent',
}

export function mapMercadoPagoStatus(status) {
  const key = String(status || '').toLowerCase()
  return MP_TO_PLAN_STATUS[key] || 'pending'
}

function computeActiveUntil(preapproval) {
  const date = preapproval?.next_payment_date || preapproval?.auto_recurring?.end_date || null
  if (!date) return null
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function persistUserFromSubscription(subscription, planStatus, preapproval) {
  if (!subscription?.estabelecimentoId) return

  const updates = []
  const values = []

  if (planStatus) {
    updates.push('plan_status=?')
    values.push(planStatus)
  }

  let planValue = null
  let planCycleValue = subscription?.billingCycle ? normalizeBillingCycle(subscription.billingCycle) : null
  if (planStatus === 'active') {
    planValue = subscription.plan
  } else if (planStatus === 'canceled' || planStatus === 'expired') {
    planValue = 'starter'
    planCycleValue = 'mensal'
  }

  if (planValue) {
    updates.push('plan=?')
    values.push(planValue)
  }

  if (planCycleValue) {
    updates.push('plan_cycle=?')
    values.push(planCycleValue)
  }

  if (planStatus !== 'trialing') {
    updates.push('plan_trial_ends_at=?')
    values.push(null)
  }

  updates.push('plan_active_until=?')
  values.push(computeActiveUntil(preapproval))

  const subscriptionId = preapproval?.id || null
  updates.push('plan_subscription_id=?')
  values.push(planStatus === 'canceled' || planStatus === 'expired' ? null : subscriptionId)

  if (!updates.length) return

  values.push(subscription.estabelecimentoId)

  const sql = `UPDATE usuarios SET ${updates.join(', ')} WHERE id=? AND tipo='estabelecimento' LIMIT 1`
  await pool.query(sql, values)
}

export async function createMercadoPagoCheckout({
  estabelecimento,
  plan,
  billingCycle,
  successUrl,
  failureUrl,
  pendingUrl,
}) {
  if (!estabelecimento?.id) {
    throw new Error('Estabelecimento invalido')
  }
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) {
    throw new Error('Plano invalido')
  }

  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const cycleCfg = getBillingCycleConfig(normalizedCycle)

  const priceCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  const amountNum = Number((Number(priceCents || 0) / 100).toFixed(2))
  if (!priceCents) {
    throw new Error('Preco do plano nao configurado')
  }

  const accessToken = config.billing?.mercadopago?.accessToken || ''
  const isTestToken = /^TEST-/.test(accessToken)
  const testPayerEmail = config.billing?.mercadopago?.testPayerEmail || null
  if (isTestToken && !testPayerEmail) {
    throw new Error('Configure MERCADOPAGO_TEST_PAYER_EMAIL com um e-mail de usuario de teste do Mercado Pago')
  }

  const payerEmail = testPayerEmail || estabelecimento.email
  if (!payerEmail) {
    throw new Error('Email do pagador nao disponivel. Informe MERCADOPAGO_TEST_PAYER_EMAIL ou cadastre um email para o estabelecimento.')
  }

  // Em sandbox muitas contas exigem card_token na criação direta de preapproval.
  // Caminho estável: criar um Plano de Assinatura e usar o init_point do plano.
  const planClient = ensureMercadoPagoPlan()
  const planBody = {
    reason: `Agendamentos Online - Plano ${getPlanLabel(normalizedPlan)}`,
    back_url: pickValidUrl(config.billing?.mercadopago?.successUrl) || undefined,
    auto_recurring: {
      frequency: cycleCfg.frequency,
      frequency_type: cycleCfg.frequencyType,
      transaction_amount: amountNum,
      currency_id: BILLING_CURRENCY,
    },
  }
  let planResp
  try {
    planResp = await planClient.create({ body: planBody })
  } catch (e) {
    const detail = extractMpError(e)
    console.error('[mp][preapproval_plan.create] error', detail)
    throw new Error('mercadopago_preapproval_error: ' + detail)
  }
  if (!planResp?.id) throw new Error('mercadopago_preapproval_error: plano sem id retornado')

  const externalReference = buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle)
  const subscription = await createSubscription({
    estabelecimentoId: estabelecimento.id,
    plan: normalizedPlan,
    amountCents: priceCents,
    currency: BILLING_CURRENCY,
    status: 'pending',
    gatewaySubscriptionId: null,
    gatewayPreferenceId: String(planResp.id),
    externalReference,
    billingCycle: normalizedCycle,
  })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'preapproval_plan.create',
    gatewayEventId: String(planResp.id),
    payload: { plan: planResp },
  })
  await persistUserFromSubscription(subscription, 'pending', null)

  return {
    // Em modo teste, prefira usar o sandbox_init_point para evitar mensagens de ambiente misto
    initPoint: (() => {
      const accessToken = config.billing?.mercadopago?.accessToken || ''
      const isTestToken = /^TEST-/.test(accessToken)
      return isTestToken
        ? (planResp.sandbox_init_point || planResp.init_point || null)
        : (planResp.init_point || planResp.sandbox_init_point || null)
    })(),
    subscription,
    preapproval: null,
    planStatus: 'pending',
  }
}

export async function syncMercadoPagoPreapproval(preapprovalId, eventPayload = null) {
  if (!preapprovalId) {
    throw new Error('preapprovalId ausente')
  }
  const preapprovalClient = ensureMercadoPagoPreapproval()
  const preapproval = await preapprovalClient.get({ id: preapprovalId })
  if (!preapproval?.id) {
    throw new Error('Preapproval nao encontrado')
  }

  const recurringType = String(preapproval?.auto_recurring?.frequency_type || '').toLowerCase()
  const derivedCycle = recurringType === 'years' ? 'anual' : 'mensal'

  let subscription = await getSubscriptionByGatewayId(preapproval.id)
  if (!subscription) {
    // Tenta localizar pelo plano vinculado (preapproval.preapproval_plan_id)
    const planId = preapproval?.preapproval_plan_id || preapproval?.plan_id || null
    const byPlan = await getSubscriptionByPlanId(planId)
    if (byPlan) {
      // amarra a assinatura ao registro existente
      subscription = await updateSubscription(byPlan.id, {
        gatewaySubscriptionId: preapproval.id,
        status: String(preapproval.status || 'pending').toLowerCase(),
        currency: (preapproval.auto_recurring?.currency_id || BILLING_CURRENCY).toUpperCase(),
        amountCents: Math.round(Number(preapproval.auto_recurring?.transaction_amount || byPlan.amountCents / 100) * 100),
        billingCycle: normalizeBillingCycle(derivedCycle),
      })
    } else {
      // Último recurso: inferir pelo external_reference
      let estabelecimentoId = null;
      let inferredPlan = 'starter';
      const tokens = {};
      const parts = String(preapproval.external_reference || '').split(':');
      for (let i = 0; i < parts.length - 1; i += 2) {
        const key = parts[i];
        const value = parts[i + 1];
        if (!key) continue;
        tokens[key] = value;
      }
      const planToken = String(tokens.plan || parts[1] || parts[0] || '').toLowerCase();
      const cycleToken = normalizeBillingCycle(tokens.cycle || derivedCycle);
      const estabToken = tokens.est;
      if (PLAN_TIERS.includes(planToken)) inferredPlan = planToken;
      if (estabToken) {
        const candidateId = Number(estabToken);
        if (Number.isFinite(candidateId)) estabelecimentoId = candidateId;
      }
      if (!estabelecimentoId) {
        throw new Error('Nao foi possivel vincular a assinatura ao estabelecimento');
      }
      subscription = await createSubscription({
        estabelecimentoId,
        plan: inferredPlan,
        amountCents:
          Math.round(Number(preapproval.auto_recurring?.transaction_amount || 0) * 100) ||
          getPlanPriceCents(inferredPlan, cycleToken),
        currency: (preapproval.auto_recurring?.currency_id || BILLING_CURRENCY).toUpperCase(),
        status: String(preapproval.status || 'pending').toLowerCase(),
        gatewaySubscriptionId: preapproval.id,
        externalReference: preapproval.external_reference || null,
        billingCycle: cycleToken,
      })
    }
  }

  const updates = {
    status: String(preapproval.status || 'pending').toLowerCase(),
    currency: (preapproval.auto_recurring?.currency_id || BILLING_CURRENCY).toUpperCase(),
    amountCents: Math.round(Number(preapproval.auto_recurring?.transaction_amount || subscription.amountCents / 100) * 100),
    currentPeriodEnd: computeActiveUntil(preapproval),
    lastEventId: eventPayload?.id ? String(eventPayload.id) : eventPayload?.action || null,
    billingCycle: normalizeBillingCycle(subscription.billingCycle || derivedCycle),
  }

  subscription = await updateSubscription(subscription.id, updates)

  await appendSubscriptionEvent(subscription.id, {
    eventType: `preapproval.${updates.status}`,
    gatewayEventId: eventPayload?.id ? String(eventPayload.id) : preapproval.id,
    payload: { event: eventPayload, preapproval },
  })

  const planStatus = mapMercadoPagoStatus(preapproval.status)
  await persistUserFromSubscription(subscription, planStatus, preapproval)

  return { subscription, preapproval, planStatus }
}
