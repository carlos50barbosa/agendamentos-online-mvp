// backend/src/lib/billing.js
import { randomUUID } from 'node:crypto'
import { MercadoPagoConfig, PreApproval, PreApprovalPlan, Preference, Payment } from 'mercadopago'
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
const BILLING_DEBUG = (() => {
  try {
    const v = String(process.env.BILLING_DEBUG || '').toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
  } catch { return false }
})()
const dbg = (...args) => { if (BILLING_DEBUG) console.log('[billing][debug]', ...args) }

let mercadoPagoClient = null
let mercadoPagoPreapproval = null
let mercadoPagoPlan = null
let mercadoPagoPreference = null
let mercadoPagoPayment = null

function ensureMercadoPagoPreapproval() {
  if (mercadoPagoPreapproval) return mercadoPagoPreapproval
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) {
    throw new Error('Mercado Pago access token is not configured')
  }
  const isTestToken = /^TEST-/.test(accessToken || '')
  dbg('init mp client (preapproval)', { tokenEnv: isTestToken ? 'TEST' : 'LIVE' })
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
  const isTestToken = /^TEST-/.test(accessToken || '')
  dbg('init mp client (preapproval_plan)', { tokenEnv: isTestToken ? 'TEST' : 'LIVE' })
  if (!mercadoPagoClient) mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPlan = new PreApprovalPlan(mercadoPagoClient)
  return mercadoPagoPlan
}

function ensureMercadoPagoPreference() {
  if (mercadoPagoPreference) return mercadoPagoPreference
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) throw new Error('Mercado Pago access token is not configured')
  if (!mercadoPagoClient) mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPreference = new Preference(mercadoPagoClient)
  return mercadoPagoPreference
}

function ensureMercadoPagoPayment() {
  if (mercadoPagoPayment) return mercadoPagoPayment
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) throw new Error('Mercado Pago access token is not configured')
  if (!mercadoPagoClient) mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPayment = new Payment(mercadoPagoClient)
  return mercadoPagoPayment
}

export async function getPlanInitPoint(preApprovalPlanId) {
  if (!preApprovalPlanId) return null
  const client = ensureMercadoPagoPlan()
  try {
    const plan = await client.get({ preApprovalPlanId })
    const accessToken = config.billing?.mercadopago?.accessToken || ''
    const isTestToken = /^TEST-/.test(accessToken)
    // Em modo teste, prefira o sandbox_init_point quando disponível
    const chosen = isTestToken
      ? (plan?.sandbox_init_point || plan?.init_point || null)
      : (plan?.init_point || plan?.sandbox_init_point || null)
    dbg('getPlanInitPoint', {
      planId: preApprovalPlanId,
      tokenEnv: isTestToken ? 'TEST' : 'LIVE',
      hasSandbox: Boolean(plan?.sandbox_init_point),
      hasInit: Boolean(plan?.init_point),
      chosen: chosen ? 'ok' : 'null',
    })
    return chosen
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
  paused: 'active',
  halted: 'active',
  stopped: 'canceled',
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

// Mapeia status do Preapproval do Mercado Pago para os valores aceitos pela coluna
// subscriptions.status (ENUM: 'initiated','pending','authorized','active','paused','past_due','canceled','expired')
function mapMpToSubscriptionStatus(status) {
  const key = String(status || '').toLowerCase()
  switch (key) {
    case 'authorized':
      return 'authorized'
    case 'active':
      return 'active'
    case 'paused':
    case 'halted':
      return 'paused'
    case 'stopped':
    case 'cancelled':
    case 'canceled':
    case 'cancelled_by_collector':
    case 'cancelled_by_merchant':
      return 'canceled'
    case 'expired':
    case 'finished':
      return 'expired'
    case 'pending':
    case 'inprocess':
    case 'in_process':
      return 'pending'
    case 'charged_back':
    case 'rejected':
      return 'past_due'
    default:
      return 'pending'
  }
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

  const normalizedCycle = subscription?.billingCycle ? normalizeBillingCycle(subscription.billingCycle) : null
  const computedActiveUntil = preapproval ? computeActiveUntil(preapproval) : null
  const effectiveActiveUntil = computedActiveUntil || subscription?.currentPeriodEnd || null
  const now = new Date()
  let nextPlanStatus = planStatus
  if (planStatus === 'canceled' && effectiveActiveUntil && effectiveActiveUntil > now) {
    nextPlanStatus = 'active'
  }

  if (nextPlanStatus) {
    updates.push('plan_status=?')
    values.push(nextPlanStatus)
  }

  let planValue = null
  let planCycleValue = normalizedCycle
  if (nextPlanStatus === 'active') {
    planValue = subscription.plan
  } else if ((nextPlanStatus === 'canceled' || nextPlanStatus === 'expired') && (!effectiveActiveUntil || effectiveActiveUntil <= now)) {
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

  if (nextPlanStatus !== 'trialing') {
    updates.push('plan_trial_ends_at=?')
    values.push(null)
  }

  updates.push('plan_active_until=?')
  values.push(effectiveActiveUntil)

  const subscriptionId = preapproval?.id || null
  const shouldClearPlanSubscription = planStatus === 'canceled' || planStatus === 'expired'
  updates.push('plan_subscription_id=?')
  values.push(shouldClearPlanSubscription ? null : subscriptionId)

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
  deferStartDate, // opcional: agenda a primeira cobrança para esta data
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

  // Em produção (token LIVE), nunca use o MERCADOPAGO_TEST_PAYER_EMAIL
  const payerEmail = isTestToken ? (testPayerEmail || estabelecimento.email) : estabelecimento.email
  if (!payerEmail) {
    throw new Error('Email do pagador nao disponivel. Informe MERCADOPAGO_TEST_PAYER_EMAIL ou cadastre um email para o estabelecimento.')
  }

  // Em sandbox muitas contas exigem card_token na criação direta de preapproval.
  // Caminho estável: criar um Plano de Assinatura e usar o init_point do plano.
  const planClient = ensureMercadoPagoPlan()
  dbg('createMercadoPagoCheckout:start', {
    plan: normalizedPlan,
    cycle: normalizedCycle,
    amount: amountNum,
    currency: BILLING_CURRENCY,
    tokenEnv: isTestToken ? 'TEST' : 'LIVE',
    payerIsTest: Boolean(isTestToken && testPayerEmail),
  })
  // Callback: preferir passar pelo backend para sincronizar imediatamente (fallback ao webhook)
  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONT_BASE)
  const DEFAULT_API_BASE = isDevFront ? 'http://localhost:3002' : `${FRONT_BASE}/api`
  const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')
  const uiSuccess = pickValidUrl(config.billing?.mercadopago?.successUrl) || `${FRONT_BASE}/configuracoes?checkout=sucesso`
  const callbackUrl = `${API_BASE}/billing/callback?next=${encodeURIComponent(uiSuccess)}`

  const planBody = {
    reason: `Agendamentos Online - Plano ${getPlanLabel(normalizedPlan)}`,
    back_url: callbackUrl,
    auto_recurring: {
      frequency: cycleCfg.frequency,
      frequency_type: cycleCfg.frequencyType,
      transaction_amount: amountNum,
      currency_id: BILLING_CURRENCY,
    },
  }
  // Opção A: sem pró‑rata; se upgrade, empurra a primeira cobrança para o próximo ciclo
  if (deferStartDate) {
    try {
      const d = new Date(deferStartDate)
      if (!Number.isNaN(d.getTime())) {
        // Algumas contas aceitam start_date diretamente, outras preferem free_trial em dias
        // Tentamos start_date; caso não seja aceito pela conta, o MP ignora e cobra no fluxo padrão
        planBody.auto_recurring.start_date = d.toISOString()
      }
    } catch {}
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

  const chosenInitPoint = (() => {
    const accessToken = config.billing?.mercadopago?.accessToken || ''
    const isTestToken = /^TEST-/.test(accessToken)
    return isTestToken
      ? (planResp.sandbox_init_point || planResp.init_point || null)
      : (planResp.init_point || planResp.sandbox_init_point || null)
  })()
  dbg('createMercadoPagoCheckout:plan_created', {
    planId: planResp.id,
    application_id: planResp.application_id,
    collector_id: planResp.collector_id,
    hasSandbox: Boolean(planResp.sandbox_init_point),
    hasInit: Boolean(planResp.init_point),
    chosen: chosenInitPoint ? 'ok' : 'null',
  })

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
    initPoint: chosenInitPoint,
    subscription,
    preapproval: null,
    planStatus: 'pending',
  }
}

// Cria um Checkout Pro (preferência) exclusivamente para PIX como fallback do primeiro ciclo
export async function createMercadoPagoPixCheckout({
  estabelecimento,
  plan,
  billingCycle,
  successUrl,
  failureUrl,
  pendingUrl,
}) {
  if (!estabelecimento?.id) throw new Error('Estabelecimento invalido')
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) throw new Error('Plano invalido')
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const priceCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  if (!priceCents) throw new Error('Preco do plano nao configurado')

  const amountNum = Number((Number(priceCents || 0) / 100).toFixed(2))
  const pref = ensureMercadoPagoPreference()

  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONT_BASE)
  const DEFAULT_API_BASE = isDevFront ? 'http://localhost:3002' : `${FRONT_BASE}/api`
  const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')
  const uiSuccess = pickValidUrl(config.billing?.mercadopago?.successUrl) || `${FRONT_BASE}/configuracoes?checkout=sucesso`
  const uiFailure = pickValidUrl(config.billing?.mercadopago?.failureUrl) || `${FRONT_BASE}/configuracoes?checkout=erro`
  const uiPending = pickValidUrl(config.billing?.mercadopago?.pendingUrl) || `${FRONT_BASE}/configuracoes?checkout=pendente`

  const externalReference = buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle)

  const body = {
    items: [
      {
        id: `plan-${normalizedPlan}-${normalizedCycle}`,
        title: `Agendamentos Online - ${getPlanLabel(normalizedPlan)} (${normalizedCycle})`,
        description: `Assinatura - primeiro ciclo via PIX`,
        quantity: 1,
        currency_id: BILLING_CURRENCY,
        unit_price: amountNum,
      },
    ],
    external_reference: externalReference,
    back_urls: {
      success: uiSuccess,
      failure: uiFailure,
      pending: uiPending,
    },
    auto_return: 'approved',
    payment_methods: {
      excluded_payment_types: [
        { id: 'credit_card' },
        { id: 'debit_card' },
        { id: 'ticket' },
        { id: 'atm' },
      ],
      default_payment_method_id: 'pix',
      installments: 1,
    },
    statement_descriptor: 'AGENDAMENTOS',
    metadata: { kind: 'pix_fallback', plan: normalizedPlan, cycle: normalizedCycle, estabelecimento_id: String(estabelecimento.id) },
    payer: estabelecimento?.email ? { email: estabelecimento.email } : undefined,
    notification_url: `${API_BASE}/billing/webhook`,
  }

  let resp
  try {
    resp = await pref.create({ body })
  } catch (e) {
    const detail = extractMpError(e)
    console.error('[mp][preference.create] error', detail)
    throw new Error('mercadopago_preference_error: ' + detail)
  }
  if (!resp?.id) throw new Error('mercadopago_preference_error: preferencia sem id')

  const subscription = await createSubscription({
    estabelecimentoId: estabelecimento.id,
    plan: normalizedPlan,
    amountCents: priceCents,
    currency: BILLING_CURRENCY,
    status: 'pending',
    gatewaySubscriptionId: null,
    gatewayPreferenceId: String(resp.id),
    externalReference,
    billingCycle: normalizedCycle,
  })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'preference.create',
    gatewayEventId: String(resp.id),
    payload: { preference: resp },
  })

  // Preferir init_point (ou sandbox_init_point em token TEST)
  const accessToken = config.billing?.mercadopago?.accessToken || ''
  const isTestToken = /^TEST-/.test(accessToken)
  const chosenInitPoint = isTestToken ? (resp.sandbox_init_point || resp.init_point || null) : (resp.init_point || resp.sandbox_init_point || null)

  return { initPoint: chosenInitPoint, subscription, planStatus: 'pending', preference: resp }
}

function addCycle(date, cycle) {
  const d = new Date(date)
  const c = normalizeBillingCycle(cycle)
  if (c === 'anual') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d
}

export async function syncMercadoPagoPayment(paymentId, eventPayload = null) {
  if (!paymentId) throw new Error('paymentId ausente')
  const client = ensureMercadoPagoPayment()
  const payment = await client.get({ id: String(paymentId) })
  if (!payment?.id) throw new Error('Pagamento nao encontrado')

  const status = String(payment.status || '').toLowerCase()
  const externalRef = String(payment.external_reference || '')
  // Tenta extrair tokens do external_reference
  const tokens = {}
  const parts = externalRef.split(':')
  for (let i = 0; i < parts.length - 1; i += 2) {
    tokens[parts[i]] = parts[i + 1]
  }
  const planToken = String(tokens.plan || '').toLowerCase()
  const cycleToken = normalizeBillingCycle(tokens.cycle)
  const estabId = Number(tokens.est || 0)

  // Recupera (se existir) a subscription criada ao gerar a preferência
  let subscription = null
  if (payment.order?.id) {
    // às vezes, o order.id não corresponde à preference, então mantemos fallback por external_reference
  }
  // fallback: tente localizar pelo external_reference (se já tivermos salvo)
  if (!subscription && externalRef) {
    try {
      const [rows] = await pool.query('SELECT * FROM subscriptions WHERE external_reference=? ORDER BY id DESC LIMIT 1', [externalRef])
      subscription = rows?.[0] ? {
        id: rows[0].id,
        estabelecimentoId: rows[0].estabelecimento_id,
        plan: rows[0].plan,
        amountCents: rows[0].amount_cents,
        currency: rows[0].currency,
        billingCycle: rows[0].billing_cycle,
        gateway: rows[0].gateway,
        gatewaySubscriptionId: rows[0].gateway_subscription_id,
        gatewayPreferenceId: rows[0].gateway_preference_id,
      } : null
    } catch {}
  }

  // Se não conseguimos inferir, mas temos tokens válidos, crie um registro minimamente coerente
  if (!subscription && estabId && PLAN_TIERS.includes(planToken)) {
    subscription = await createSubscription({
      estabelecimentoId: estabId,
      plan: planToken,
      amountCents: Math.round(Number(payment.transaction_amount || 0) * 100),
      currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
      status: 'pending',
      gatewaySubscriptionId: null,
      gatewayPreferenceId: null,
      externalReference: externalRef || null,
      billingCycle: cycleToken || 'mensal',
    })
  }

  if (status !== 'approved') {
    if (subscription?.id) {
      await appendSubscriptionEvent(subscription.id, {
        eventType: `payment.${status}`,
        gatewayEventId: String(payment.id),
        payload: { event: eventPayload, payment },
      })
    }
    return { ok: false, payment }
  }

  // status approved: ativa plano por 1 ciclo a partir de hoje (PIX fallback)
  const effectivePlan = (PLAN_TIERS.includes(planToken) ? planToken : (subscription?.plan || 'pro'))
  const effectiveCycle = cycleToken || subscription?.billingCycle || 'mensal'
  const activeUntil = addCycle(new Date(), effectiveCycle)

  if (subscription?.id) {
    await updateSubscription(subscription.id, {
      status: 'active',
      amountCents: Math.round(Number(payment.transaction_amount || subscription.amountCents / 100) * 100),
      currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
      currentPeriodEnd: activeUntil,
      lastEventId: String(payment.id),
      billingCycle: effectiveCycle,
    })
    await appendSubscriptionEvent(subscription.id, {
      eventType: 'payment.approved',
      gatewayEventId: String(payment.id),
      payload: { event: eventPayload, payment },
    })
  }

  // Atualiza o usuário
  if (subscription?.estabelecimentoId || estabId) {
    const estabelecimentoId = subscription?.estabelecimentoId || estabId
    const sql = `UPDATE usuarios SET plan=?, plan_status='active', plan_cycle=?, plan_trial_ends_at=NULL, plan_active_until=?, plan_subscription_id=NULL WHERE id=? AND tipo='estabelecimento' LIMIT 1`
    await pool.query(sql, [effectivePlan, effectiveCycle, activeUntil, estabelecimentoId])
  }

  return { ok: true, payment, plan: effectivePlan, cycle: effectiveCycle, active_until: activeUntil }
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
        status: mapMpToSubscriptionStatus(preapproval.status || 'pending'),
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
        status: mapMpToSubscriptionStatus(preapproval.status || 'pending'),
        gatewaySubscriptionId: preapproval.id,
        externalReference: preapproval.external_reference || null,
        billingCycle: cycleToken,
      })
    }
  }

  const computedActiveUntil = computeActiveUntil(preapproval)
  const updates = {
    status: mapMpToSubscriptionStatus(preapproval.status || 'pending'),
    currency: (preapproval.auto_recurring?.currency_id || BILLING_CURRENCY).toUpperCase(),
    amountCents: Math.round(Number(preapproval.auto_recurring?.transaction_amount || subscription.amountCents / 100) * 100),
    currentPeriodEnd: computedActiveUntil || subscription.currentPeriodEnd || null,
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

// Atualiza o status de um preapproval (recorrência) no Mercado Pago e sincroniza no banco
export async function updateMercadoPagoPreapprovalStatus(preapprovalId, nextStatus, eventTag = 'manual_update') {
  if (!preapprovalId) throw new Error('preapprovalId ausente')
  const preapprovalClient = ensureMercadoPagoPreapproval()
  const allowed = ['paused', 'authorized', 'cancelled', 'canceled']
  const status = String(nextStatus || '').toLowerCase()
  if (!allowed.includes(status)) throw new Error('status_invalido')
  const body = { status }
  try {
    // SDK v1 usa { id, body }
    await preapprovalClient.update({ id: preapprovalId, body })
  } catch (e) {
    const detail = extractMpError(e)
    throw new Error('mercadopago_preapproval_update_error: ' + detail)
  }
  // Sincroniza após atualizar
  return await syncMercadoPagoPreapproval(preapprovalId, { action: eventTag, set_status: status })
}
