// backend/src/lib/billing.js
import { randomUUID } from 'node:crypto'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { config } from './config.js'
import {
  PLAN_TIERS,
  getPlanPriceCents,
  getPlanLabel,
  normalizeBillingCycle,
  getBillingCycleConfig,
} from './plans.js'
import { cancelMercadoPagoCardSubscription } from './mercadopago_subscriptions.js'
import {
  creditWhatsAppTopup,
  getWhatsAppWalletSnapshot,
  resolveTopupPackage,
  normalizeTopupPackage,
} from './whatsapp_wallet.js'
import {
  createSubscription,
  updateSubscription,
  appendSubscriptionEvent,
  getSubscriptionById,
  getSubscriptionByExternalReference,
  getSubscriptionByGatewayId,
  getSubscriptionByGatewayPaymentId,
  getSubscriptionByPlanId,
  listSubscriptionEventsBySubscriptionId,
  listSubscriptionsForEstabelecimento,
} from './subscriptions.js'
import { pool } from './db.js'
import { findWhatsAppPack } from './addon_packs.js'
import { syncUserPlanContextFromSubscription } from './subscription_state.js'
import {
  appendUpgradeCreditEventsTx,
  applyScheduledDiscountForSubscriptionPaymentTx,
  createUpgradeProrationCreditTx,
  findUpgradeSourceSubscription,
  releaseScheduledSubscriptionCreditApplicationsTx,
} from './subscription_credits.js'
import {
  buildPixLogicalContext,
  buildPixPaymentContext,
  isSamePixLogicalContext,
  resolvePixPaymentDisposition,
  selectPixSubscriptionCandidate,
} from './pix_reconciliation.js'

const BILLING_CURRENCY = (config.billing?.currency || 'BRL').toUpperCase()
const BILLING_DEBUG = (() => {
  try {
    const v = String(process.env.BILLING_DEBUG || '').toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
  } catch { return false }
})()
const dbg = (...args) => { if (BILLING_DEBUG) console.log('[billing][debug]', ...args) }

const MOCK_MP = (() => {
  try {
    const raw = String(process.env.MERCADOPAGO_MOCK || process.env.BILLING_MOCK_MERCADOPAGO || '').toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  } catch { return false }
})()
const mockPayments = new Map()

let mercadoPagoClient = null
let mercadoPagoPayment = null
const mercadoPagoPaymentsByToken = new Map()

function ensureMercadoPagoPayment() {
  if (MOCK_MP) {
    if (mercadoPagoPayment) return mercadoPagoPayment
    mercadoPagoPayment = {
      async create({ body }) {
        const id = `mock-pay-${mockPayments.size + 1}`
        const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
        const txData = {
          qr_code: `000201mock:${id}`,
          qr_code_base64: Buffer.from(`mock-qr:${id}`).toString('base64'),
          ticket_url: body?.notification_url ? `${body.notification_url}/mock/${id}` : null,
          expires_at: expires,
        }
        const payment = {
          id,
          status: body?.status || 'pending',
          transaction_amount: body?.transaction_amount,
          payment_method_id: body?.payment_method_id,
          external_reference: body?.external_reference,
          metadata: body?.metadata || null,
          point_of_interaction: { transaction_data: txData },
          date_of_expiration: expires,
        }
        mockPayments.set(String(id), payment)
        return payment
      },
      async get({ id }) {
        return mockPayments.get(String(id)) || null
      },
    }
    return mercadoPagoPayment
  }

  if (mercadoPagoPayment) return mercadoPagoPayment
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) throw new Error('Mercado Pago access token is not configured')
  if (!mercadoPagoClient) mercadoPagoClient = new MercadoPagoConfig({ accessToken })
  mercadoPagoPayment = new Payment(mercadoPagoClient)
  return mercadoPagoPayment
}

function resolveMercadoPagoPayment(accessToken) {
  if (MOCK_MP) return ensureMercadoPagoPayment()
  if (!accessToken) return ensureMercadoPagoPayment()
  const tokenKey = String(accessToken)
  if (mercadoPagoPaymentsByToken.has(tokenKey)) {
    return mercadoPagoPaymentsByToken.get(tokenKey)
  }
  const mpClient = new MercadoPagoConfig({ accessToken: tokenKey })
  const paymentClient = new Payment(mpClient)
  mercadoPagoPaymentsByToken.set(tokenKey, paymentClient)
  return paymentClient
}

export async function fetchMercadoPagoPayment(paymentId, { accessToken } = {}) {
  if (!paymentId) throw new Error('paymentId ausente')
  const client = resolveMercadoPagoPayment(accessToken)
  return client.get({ id: String(paymentId) })
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

export async function createMercadoPagoPixPayment({
  amountCents,
  description,
  externalReference,
  metadata,
  notificationUrl,
  payerEmail,
  expiresAt = null,
  accessToken = null,
}) {
  const paymentClient = resolveMercadoPagoPayment(accessToken)
  const amountNum = Number((Number(amountCents || 0) / 100).toFixed(2))
  const paymentBody = {
    transaction_amount: amountNum,
    description: description || 'Agendamentos Online - Pagamento',
    payment_method_id: 'pix',
    external_reference: externalReference,
    metadata,
    notification_url: notificationUrl,
    payer: payerEmail ? { email: payerEmail } : undefined,
  }
  if (expiresAt) {
    const exp = new Date(expiresAt)
    if (Number.isFinite(exp.getTime())) {
      paymentBody.date_of_expiration = exp.toISOString()
    }
  }
  let payment
  try {
    payment = await paymentClient.create({ body: paymentBody })
  } catch (e) {
    const detail = extractMpError(e)
    console.error('[mp][payment.create][deposit] error', detail)
    throw new Error('mercadopago_payment_error: ' + detail)
  }
  if (!payment?.id) throw new Error('mercadopago_payment_error: pagamento sem id')
  const txData = payment?.point_of_interaction?.transaction_data || {}
  const pixPayload = {
    payment_id: String(payment.id),
    qr_code: txData.qr_code || null,
    qr_code_base64: txData.qr_code_base64 || null,
    copia_e_cola: txData.copia_e_cola || txData.qr_code || null,
    ticket_url: txData.ticket_url || null,
    expires_at: txData.expires_at || payment?.date_of_expiration || null,
    amount_cents: amountCents,
  }
  return { payment, pix: pixPayload }
}

function buildExternalReference(estabelecimentoId, plan, cycle) {
  const normalizedCycle = normalizeBillingCycle(cycle)
  const base = `plan:${plan}:cycle:${normalizedCycle}:est:${estabelecimentoId}`
  return `${base}:${randomUUID()}`
}

function buildExternalReferenceTopup(estabelecimentoId, messages, packCode = null) {
  const parts = ['wallet', 'whatsapp_topup']
  if (packCode) parts.push('pack', String(packCode))
  parts.push('msgs', Number(messages || 0), 'est', estabelecimentoId, 'uuid', randomUUID())
  return parts.join(':')
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

// Cria um Checkout Pro (preferência) exclusivamente para PIX como fallback do primeiro ciclo
export async function createMercadoPagoPixCheckout({
  estabelecimento,
  plan,
  billingCycle,
  amountCentsOverride = null,
  metadataExtras = null,
  existingSubscriptionId = null,
  externalReferenceOverride = null,
}) {
  if (!estabelecimento?.id) throw new Error('Estabelecimento inválido')
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) throw new Error('Plano inválido')
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const nominalPriceCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  const priceCents =
    amountCentsOverride == null
      ? nominalPriceCents
      : Math.max(0, Math.trunc(Number(amountCentsOverride || 0) || 0))
  if (!priceCents) throw new Error('Preço do plano não configurado')

  const amountNum = Number((Number(priceCents || 0) / 100).toFixed(2))
  const paymentClient = ensureMercadoPagoPayment()

  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONT_BASE)
  const DEFAULT_API_BASE = isDevFront ? 'http://localhost:3002' : `${FRONT_BASE}/api`
  const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')

  const externalReference = externalReferenceOverride || buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle)
  const metadata = {
    kind: 'pix_payment',
    plan: normalizedPlan,
    cycle: normalizedCycle,
    estabelecimento_id: String(estabelecimento.id),
    nominal_amount_cents: nominalPriceCents,
    subscription_id: existingSubscriptionId ? String(existingSubscriptionId) : undefined,
    ...(metadataExtras && typeof metadataExtras === 'object' ? metadataExtras : {}),
  }

  const paymentBody = {
    transaction_amount: amountNum,
    description: `Agendamentos Online - ${getPlanLabel(normalizedPlan)} (${normalizedCycle})`,
    payment_method_id: 'pix',
    external_reference: externalReference,
    metadata,
    notification_url: `${API_BASE}/billing/webhook`,
    payer: estabelecimento?.email ? { email: estabelecimento.email } : undefined,
  }

  let payment
  try {
    payment = await paymentClient.create({ body: paymentBody })
  } catch (e) {
    const detail = extractMpError(e)
    console.error('[mp][payment.create] error', detail)
    throw new Error('mercadopago_payment_error: ' + detail)
  }
  if (!payment?.id) throw new Error('mercadopago_payment_error: pagamento sem id')

  const transactionData = payment?.point_of_interaction?.transaction_data || {}
  const pixPayload = {
    payment_id: String(payment.id),
    qr_code: transactionData.qr_code || null,
    qr_code_base64: transactionData.qr_code_base64 || null,
    copia_e_cola: transactionData.copia_e_cola || transactionData.qr_code || null,
    ticket_url: transactionData.ticket_url || null,
    expires_at: transactionData.expires_at || payment?.date_of_expiration || null,
    amount_cents: priceCents,
  }

  const subscription = existingSubscriptionId
    ? await updateSubscription(existingSubscriptionId, {
        plan: normalizedPlan,
        amountCents: priceCents,
        currency: BILLING_CURRENCY,
        paymentMethod: 'pix',
        status: 'pending_pix',
        gatewaySubscriptionId: null,
        gatewayPaymentId: String(payment.id),
        gatewayPreferenceId: String(payment.id),
        externalReference,
        billingCycle: normalizedCycle,
      })
    : await createSubscription({
        estabelecimentoId: estabelecimento.id,
        plan: normalizedPlan,
        amountCents: priceCents,
        currency: BILLING_CURRENCY,
        paymentMethod: 'pix',
        status: 'pending_pix',
        gatewaySubscriptionId: null,
        gatewayPaymentId: String(payment.id),
        gatewayPreferenceId: String(payment.id),
        externalReference,
        billingCycle: normalizedCycle,
      })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'pix_generated',
    gatewayEventId: String(payment.id),
    payload: { payment },
  })

  const initPoint = transactionData.ticket_url || null

  return { initPoint, subscription, planStatus: 'pending_pix', pix: pixPayload, payment }
}

// Checkout PIX para compra avulsa (topup) de mensagens WhatsApp
export async function createMercadoPagoPixTopupCheckout({
  estabelecimento,
  messages,
  planHint,
  pack = null,
  availablePacks = null,
}) {
  if (!estabelecimento?.id) throw new Error('Estabelecimento inválido')
  const pkg = normalizeTopupPackage(pack) || resolveTopupPackage(messages, { availablePacks })
  if (!pkg) throw new Error('Pacote de mensagens inválido')

  const amountNum = Number((Number(pkg.priceCents || 0) / 100).toFixed(2))
  const paymentClient = ensureMercadoPagoPayment()

  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONT_BASE)
  const DEFAULT_API_BASE = isDevFront ? 'http://localhost:3002' : `${FRONT_BASE}/api`
  const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')

  const externalReference = buildExternalReferenceTopup(estabelecimento.id, pkg.messages, pkg.code)
  const metadata = {
    kind: 'whatsapp_topup',
    messages: pkg.messages,
    estabelecimento_id: String(estabelecimento.id),
    plan: planHint ? String(planHint).toLowerCase() : undefined,
    pack_code: pkg.code || null,
    pack_id: pkg.id ?? null,
    pack_name: pkg.name || null,
    price_cents: pkg.priceCents,
  }

  const paymentBody = {
    transaction_amount: amountNum,
    description: pkg.name
      ? `Agendamentos Online - ${pkg.name}`
      : `Agendamentos Online - WhatsApp +${pkg.messages} mensagens`,
    payment_method_id: 'pix',
    external_reference: externalReference,
    metadata,
    notification_url: `${API_BASE}/billing/webhook`,
    payer: estabelecimento?.email ? { email: estabelecimento.email } : undefined,
  }

  let payment
  try {
    payment = await paymentClient.create({ body: paymentBody })
  } catch (e) {
    const detail = extractMpError(e)
    console.error('[mp][payment.create][topup] error', detail)
    throw new Error('mercadopago_payment_error: ' + detail)
  }
  if (!payment?.id) throw new Error('mercadopago_payment_error: pagamento sem id')

  const transactionData = payment?.point_of_interaction?.transaction_data || {}
  const pixPayload = {
    payment_id: String(payment.id),
    qr_code: transactionData.qr_code || null,
    copia_e_cola: transactionData.qr_code || null,
    qr_code_base64: transactionData.qr_code_base64 || null,
    ticket_url: transactionData.ticket_url || null,
    expires_at: transactionData.expires_at || payment?.date_of_expiration || null,
    amount_cents: pkg.priceCents,
    messages: pkg.messages,
    status: payment?.status || null,
    pack_code: pkg.code || null,
    pack_id: pkg.id ?? null,
  }

  const planForRow = (() => {
    const p = String(planHint || 'starter').toLowerCase()
    return PLAN_TIERS.includes(p) ? p : 'starter'
  })()

  const subscription = await createSubscription({
    estabelecimentoId: estabelecimento.id,
    plan: planForRow,
    amountCents: pkg.priceCents,
    currency: BILLING_CURRENCY,
    paymentMethod: 'pix',
    status: 'pending_pix',
    gatewaySubscriptionId: null,
    gatewayPaymentId: String(payment.id),
    gatewayPreferenceId: String(payment.id),
    externalReference,
    billingCycle: 'mensal',
  })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'topup.create',
    gatewayEventId: String(payment.id),
    payload: { payment, messages: pkg.messages, pack_code: pkg.code || null, pack_id: pkg.id ?? null },
  })

  const initPoint = transactionData.ticket_url || null

  return { initPoint, subscription, pix: pixPayload, payment, package: pkg }
}

function addCycle(date, cycle) {
  const d = new Date(date)
  const c = normalizeBillingCycle(cycle)
  if (c === 'anual') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d
}

async function findPixObsoleteMarker(subscriptionId, { db = pool } = {}) {
  if (!subscriptionId) return null
  const events = await listSubscriptionEventsBySubscriptionId(subscriptionId, { limit: 10, db })
  return events.find((event) => String(event?.event_type || '').toLowerCase() === 'pix_obsolete') || null
}

async function findMatchingPixSubscription(payment, { db = pool } = {}) {
  const paymentContext = buildPixPaymentContext(payment)
  const paymentId = String(paymentContext.payment_id || '').trim()
  let subscription = null
  let matchedBy = null
  let matchScore = 0
  let matchReasons = []

  if (paymentId) {
    subscription = await getSubscriptionByGatewayPaymentId(paymentId, { db })
    if (subscription?.id) {
      matchedBy = 'gateway_payment_id'
      matchScore = 240
      matchReasons = ['gateway_payment_id']
    }
  }

  if (!subscription?.id && paymentId) {
    subscription = await getSubscriptionByPlanId(paymentId, { db })
    if (subscription?.id) {
      matchedBy = 'gateway_preference_id'
      matchScore = 220
      matchReasons = ['gateway_preference_id']
    }
  }

  if (!subscription?.id && paymentContext.subscription_id) {
    subscription = await getSubscriptionById(paymentContext.subscription_id, { db })
    if (subscription?.id) {
      matchedBy = 'metadata_subscription_id'
      matchScore = 200
      matchReasons = ['metadata_subscription_id']
    }
  }

  if (!subscription?.id && paymentContext.gateway_subscription_id) {
    subscription = await getSubscriptionByGatewayId(paymentContext.gateway_subscription_id, { db })
    if (subscription?.id) {
      matchedBy = 'gateway_subscription_id'
      matchScore = 180
      matchReasons = ['gateway_subscription_id']
    }
  }

  if (!subscription?.id && paymentContext.external_reference) {
    subscription = await getSubscriptionByExternalReference(paymentContext.external_reference, { db })
    if (subscription?.id) {
      matchedBy = 'external_reference'
      matchScore = 170
      matchReasons = ['external_reference']
    }
  }

  if (!subscription?.id && paymentContext.establishment_id) {
    const subscriptions = await listSubscriptionsForEstabelecimento(paymentContext.establishment_id, { db })
    const selected = selectPixSubscriptionCandidate(subscriptions, paymentContext)
    if (selected?.candidate?.id) {
      subscription = selected.candidate
      matchedBy = 'context_fallback'
      matchScore = selected.score || 0
      matchReasons = selected.reasons || []
    }
  }

  return {
    paymentContext,
    subscription: subscription?.id ? subscription : null,
    matchedBy,
    matchScore,
    matchReasons,
  }
}

async function markRelatedPendingPixSubscriptionsObsoleteTx(targetSubscription, payment, paymentContext, { db = pool } = {}) {
  if (!targetSubscription?.id || !targetSubscription?.estabelecimentoId) {
    return { count: 0, subscriptions: [] }
  }

  const siblings = await listSubscriptionsForEstabelecimento(targetSubscription.estabelecimentoId, { db })
  const logicalTarget = buildPixLogicalContext({
    estabelecimentoId: targetSubscription.estabelecimentoId,
    plan: targetSubscription.plan,
    billingCycle: targetSubscription.billingCycle,
    paymentMethod: 'pix',
    chargeKind: paymentContext?.charge_kind || null,
    externalReference: targetSubscription.externalReference,
  })
  const staleSubscriptions = siblings.filter((item) => {
    if (!item?.id || Number(item.id) === Number(targetSubscription.id)) return false
    if (String(item.paymentMethod || '').toLowerCase() !== 'pix') return false
    if (String(item.status || '').toLowerCase() !== 'pending_pix') return false
    return isSamePixLogicalContext(item, logicalTarget)
  })

  for (const staleSubscription of staleSubscriptions) {
    await updateSubscription(staleSubscription.id, {
      status: 'canceled',
      canceledAt: new Date(),
      cancelAt: new Date(),
      nextBillingAt: null,
      graceUntil: null,
    }, { db })
    await appendSubscriptionEvent(staleSubscription.id, {
      eventType: 'pix_obsolete',
      gatewayEventId: `pix-obsolete:${payment?.id || Date.now()}:${staleSubscription.id}`,
      payload: {
        payment_method: 'pix',
        payment_id: staleSubscription.gatewayPreferenceId || staleSubscription.gatewayPaymentId || null,
        approved_payment_id: payment?.id != null ? String(payment.id) : null,
        approved_external_reference: payment?.external_reference || null,
        approved_subscription_id: targetSubscription.id,
        reason: 'superseded_by_approved_pix',
      },
    }, { db })
  }

  return {
    count: staleSubscriptions.length,
    subscriptions: staleSubscriptions,
  }
}

async function finalizeApprovedPixSubscriptionTx(subscriptionId, {
  payment,
  eventPayload = null,
  effectivePlan,
  effectiveCycle,
}, { db }) {
  const paidAt = payment?.date_approved ? new Date(payment.date_approved) : new Date()
  const current = await getSubscriptionById(subscriptionId, { db })
  if (!current?.id) {
    throw new Error('subscription_not_found')
  }

  const sourceSubscription = await findUpgradeSourceSubscription(current.estabelecimentoId, {
    targetSubscriptionId: current.id,
    targetPlan: effectivePlan,
    changedAt: paidAt,
    db,
  })

  if (sourceSubscription?.id) {
    await releaseScheduledSubscriptionCreditApplicationsTx(sourceSubscription.id, {
      db,
      reason: 'source_subscription_upgraded',
      externalReference: payment?.external_reference || null,
    })
  }

  const activeUntil = addCycle(paidAt, effectiveCycle)
  const amountCents = Math.round(Number(payment.transaction_amount || current.amountCents / 100 || 0) * 100)
  const updated = await updateSubscription(current.id, {
    status: 'active',
    paymentMethod: 'pix',
    gatewayPaymentId: String(payment.id),
    amountCents,
    currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
    currentPeriodStart: paidAt,
    currentPeriodEnd: activeUntil,
    nextBillingAt: activeUntil,
    graceUntil: null,
    lastPaymentAt: paidAt,
    lastEventId: String(payment.id),
    billingCycle: effectiveCycle,
  }, { db })

  const appliedScheduledDiscount = await applyScheduledDiscountForSubscriptionPaymentTx(updated.id, {
    paymentId: payment?.id ? String(payment.id) : null,
    externalReference: payment?.external_reference || null,
    paymentDate: paidAt,
    db,
  })

  const creditResult = sourceSubscription?.id
    ? await createUpgradeProrationCreditTx({
        sourceSubscription,
        targetSubscription: updated,
        changedAt: paidAt,
        paymentMethod: 'pix',
        paymentId: payment?.id ? String(payment.id) : null,
        externalReference: payment?.external_reference || null,
        rawPayload: {
          event: eventPayload,
          payment,
        },
        db,
      })
    : { created: false, credit: null, reason: 'no_source_subscription' }

  if (sourceSubscription?.id && sourceSubscription.id !== updated.id) {
    await updateSubscription(sourceSubscription.id, {
      status: 'canceled',
      canceledAt: paidAt,
      cancelAt: paidAt,
      nextBillingAt: null,
      graceUntil: null,
    }, { db })
  }

  const obsoleteSiblings = await markRelatedPendingPixSubscriptionsObsoleteTx(updated, payment, buildPixPaymentContext(payment), { db })

  const paymentEventPayload = {
    event: eventPayload,
    payment,
    payment_method: 'pix',
    credit_applied_cents: appliedScheduledDiscount?.applied_credit_cents || 0,
    credit_generated_cents: creditResult?.credit?.generated_credit_cents || 0,
    source_plan: sourceSubscription?.plan || null,
    target_plan: updated.plan,
    stale_pix_marked_obsolete: obsoleteSiblings.count || 0,
  }

  if (appliedScheduledDiscount?.applied_credit_cents > 0) {
    await appendSubscriptionEvent(updated.id, {
      eventType: 'subscription_credit_applied',
      gatewayEventId: `pix-credit:${payment.id}`,
      payload: {
        payment_method: 'pix',
        payment_id: payment?.id ? String(payment.id) : null,
        external_reference: payment?.external_reference || null,
        application_type: 'pending_pix_discount',
        amount_cents: appliedScheduledDiscount.applied_credit_cents,
      },
    }, { db })
  }

  await appendSubscriptionEvent(updated.id, {
    eventType: 'pix_paid',
    gatewayEventId: String(payment.id),
    payload: paymentEventPayload,
  }, { db })
  await appendSubscriptionEvent(updated.id, {
    eventType: 'subscription_renewed',
    gatewayEventId: `renewal:${payment.id}`,
    payload: paymentEventPayload,
  }, { db })

  if (creditResult?.credit) {
    await appendUpgradeCreditEventsTx(sourceSubscription, updated, {
      credit: creditResult.credit,
      paymentMethod: 'pix',
      paymentId: payment?.id ? String(payment.id) : null,
      externalReference: payment?.external_reference || null,
      db,
    })
  }

  return {
    subscription: updated,
    sourceSubscription,
    credit: creditResult?.credit || null,
    activeUntil,
    obsoleteSiblingCount: obsoleteSiblings.count || 0,
  }
}

export async function syncMercadoPagoPayment(paymentId, eventPayload = null) {
  if (!paymentId) throw new Error('paymentId ausente')
  const client = ensureMercadoPagoPayment()
  const webhookMeta = eventPayload?._webhook && typeof eventPayload._webhook === 'object'
    ? eventPayload._webhook
    : {}
  const truncateText = (value, maxLen = 160) => {
    if (value === null || value === undefined) return null
    const text = String(value).trim()
    if (!text) return null
    if (text.length <= maxLen) return text
    return text.slice(0, Math.max(0, maxLen - 3)) + '...'
  }
  const sanitizeUrl = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return null
    try {
      const parsed = new URL(raw)
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return truncateText(raw, 200)
    }
  }
  const summarizeMetadata = (metadata) => {
    if (!metadata || typeof metadata !== 'object') return null
    const out = {}
    const sensitiveKey = /(token|secret|password|passwd|authorization|auth|bearer|key)/i
    for (const [key, value] of Object.entries(metadata)) {
      const safeKey = String(key)
      if (sensitiveKey.test(safeKey)) {
        out[safeKey] = '[redacted]'
        continue
      }
      if (value === null || value === undefined) {
        out[safeKey] = null
        continue
      }
      const t = typeof value
      if (t === 'string') {
        out[safeKey] = truncateText(value, 120)
      } else if (t === 'number' || t === 'boolean') {
        out[safeKey] = value
      } else {
        out[safeKey] = Array.isArray(value) ? '[array]' : '[object]'
      }
    }
    return out
  }
  const logPaymentSnapshot = (paymentData) => {
    const snapshot = {
      id: paymentData?.id ? String(paymentData.id) : String(paymentId),
      status: paymentData?.status || null,
      status_detail: paymentData?.status_detail || null,
      live_mode: paymentData?.live_mode ?? null,
      collector_id: paymentData?.collector_id ?? null,
      transaction_amount: paymentData?.transaction_amount ?? null,
      payment_method_id: paymentData?.payment_method_id || null,
      payment_type_id: paymentData?.payment_type_id || null,
      notification_url: sanitizeUrl(paymentData?.notification_url),
      external_reference: truncateText(paymentData?.external_reference, 200),
      description: truncateText(paymentData?.description, 200),
      metadata: summarizeMetadata(paymentData?.metadata),
      date_created: paymentData?.date_created || null,
      date_approved: paymentData?.date_approved || null,
    }
    console.info('[billing:sync] payment_snapshot', snapshot)
  }
  let payment = null
  const logSyncAction = (actionTaken, extra = {}) => {
    const paymentContext = buildPixPaymentContext(payment)
    console.info('[billing:sync][pix]', {
      request_id: webhookMeta.request_id || null,
      topic: webhookMeta.topic || null,
      payment_id: payment?.id ? String(payment.id) : String(paymentId),
      status: payment?.status || null,
      status_detail: payment?.status_detail || null,
      payment_type_id: payment?.payment_type_id || null,
      payment_method_id: payment?.payment_method_id || null,
      external_reference: truncateText(payment?.external_reference, 200),
      metadata: summarizeMetadata(payment?.metadata),
      establishment_id: paymentContext.establishment_id || null,
      action_taken: actionTaken || null,
      ...extra,
    })
  }
  const ignore = (reason, extra = null, resultExtra = null) => {
    const payload = {
      ignored_reason: String(reason || 'unknown'),
    }
    if (extra && typeof extra === 'object') {
      for (const [key, value] of Object.entries(extra)) {
        payload[key] = value
      }
    }
    logSyncAction('payment_ignored', payload)
    return { ok: false, payment, reason: String(reason || 'unknown'), ...(resultExtra || {}) }
  }

  payment = await client.get({ id: String(paymentId) })
  logPaymentSnapshot(payment)
  if (!payment?.id) throw new Error('Pagamento não encontrado')

  const paymentContext = buildPixPaymentContext(payment)
  const status = String(paymentContext.status || '')
  const externalRef = String(paymentContext.external_reference || '')
  const planToken = String(paymentContext.plan || '').toLowerCase()
  const cycleToken = normalizeBillingCycle(paymentContext.billing_cycle)
  const estabId = Number(paymentContext.establishment_id || 0) || 0
  const topupMessagesToken = Number(paymentContext.tokens?.msgs || 0) || 0
  const packCodeToken = paymentContext.tokens?.pack || null
  const isTopup = paymentContext.is_topup === true
  let topupMessages = Number(payment?.metadata?.messages || 0) || topupMessagesToken
  const packCode = payment?.metadata?.pack_code || packCodeToken || null
  const packIdRaw = payment?.metadata?.pack_id
  const packId = Number.isFinite(Number(packIdRaw)) ? Number(packIdRaw) : null
  const packName = payment?.metadata?.pack_name || null

  let matchResult = await findMatchingPixSubscription(payment, { db: pool })
  let subscription = matchResult.subscription || null

  // Se não conseguimos inferir, mas temos tokens válidos, crie um registro minimamente coerente
  if (!subscription && estabId && (PLAN_TIERS.includes(planToken) || isTopup)) {
    subscription = await createSubscription({
      estabelecimentoId: estabId,
      plan: PLAN_TIERS.includes(planToken) ? planToken : 'starter',
      amountCents: Math.round(Number(payment.transaction_amount || 0) * 100),
      currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
      paymentMethod: 'pix',
      status: 'pending_pix',
      gatewaySubscriptionId: null,
      gatewayPaymentId: String(payment.id),
      gatewayPreferenceId: null,
      externalReference: externalRef || null,
      billingCycle: cycleToken || 'mensal',
    })
    matchResult = {
      ...matchResult,
      subscription,
      matchedBy: 'created_from_payment_context',
      matchScore: 0,
      matchReasons: ['created_from_payment_context'],
    }
  }

  if (subscription?.id) {
    logSyncAction('payment_matched', {
      matched_entity_type: 'subscription',
      matched_entity_id: subscription.id,
      subscription_id: subscription.id,
      establishment_id: subscription.estabelecimentoId || estabId || null,
      match_strategy: matchResult?.matchedBy || null,
      match_score: matchResult?.matchScore || 0,
      match_reasons: matchResult?.matchReasons || [],
    })
  }

  const obsoleteMarker = subscription?.id
    ? await findPixObsoleteMarker(subscription.id, { db: pool })
    : null
  const paymentDisposition = resolvePixPaymentDisposition({
    status,
    paymentId: payment?.id ? String(payment.id) : null,
    subscriptionLastEventId: subscription?.lastEventId || null,
    hasObsoleteMarker: Boolean(obsoleteMarker),
  })

  if (paymentDisposition === 'already_processed') {
    if (status === 'approved') {
      logSyncAction('payment_already_processed', {
        matched_entity_type: 'subscription',
        matched_entity_id: subscription?.id || null,
        subscription_id: subscription?.id || null,
        establishment_id: subscription?.estabelecimentoId || estabId || null,
      })
      return { ok: true, payment, already_processed: true }
    }
    return ignore('already_processed', null, { already_processed: true })
  }

  if (paymentDisposition === 'stale_superseded') {
    return ignore('stale_pix_superseded', {
      matched_entity_type: 'subscription',
      matched_entity_id: subscription?.id || null,
      subscription_id: subscription?.id || null,
      establishment_id: subscription?.estabelecimentoId || estabId || null,
    }, {
      stale: true,
      obsolete_event_id: obsoleteMarker?.id || null,
    })
  }

  if (status !== 'approved') {
    if (subscription?.id) {
      const nextStatus = ['pending', 'in_process', 'authorized'].includes(status)
        ? 'pending_pix'
        : ['cancelled', 'canceled', 'expired'].includes(status)
          ? 'expired'
          : 'unpaid'
      if (nextStatus !== 'pending_pix') {
        await releaseScheduledSubscriptionCreditApplicationsTx(subscription.id, {
          db: pool,
          reason: `payment_${nextStatus}`,
          externalReference: externalRef || null,
        })
      }
      await updateSubscription(subscription.id, {
        paymentMethod: 'pix',
        gatewayPaymentId: String(payment.id),
        status: nextStatus,
        lastEventId: String(payment.id),
      })
      await appendSubscriptionEvent(subscription.id, {
        eventType: nextStatus === 'expired'
          ? 'pix_expired'
          : nextStatus === 'pending_pix'
            ? 'pix_generated'
            : 'payment_failed',
        gatewayEventId: String(payment.id),
        payload: { event: eventPayload, payment },
      })
      logSyncAction(nextStatus === 'pending_pix' ? 'payment_pending' : 'payment_not_approved', {
        matched_entity_type: 'subscription',
        matched_entity_id: subscription.id,
        subscription_id: subscription.id,
        establishment_id: subscription.estabelecimentoId || estabId || null,
        next_status: nextStatus,
      })
    }
    const reason = `unsupported_status:${status || 'unknown'}`
    return ignore(reason, {
      matched_entity_type: subscription?.id ? 'subscription' : null,
      matched_entity_id: subscription?.id || null,
      subscription_id: subscription?.id || null,
      establishment_id: subscription?.estabelecimentoId || estabId || null,
    })
  }

  if (isTopup) {
    let packRow = null
    if ((!topupMessages || topupMessages <= 0) && (packCode || packId)) {
      try {
        packRow = await findWhatsAppPack({ id: packId, code: packCode, activeOnly: false })
        if (!topupMessages && packRow?.waMessages) topupMessages = Number(packRow.waMessages || 0)
      } catch (err) {
        console.warn('[billing][topup][pack_lookup]', err?.message || err)
      }
    } else if (packCode || packId) {
      try {
        packRow = await findWhatsAppPack({ id: packId, code: packCode, activeOnly: false })
      } catch (err) {
        console.warn('[billing][topup][pack_lookup]', err?.message || err)
      }
    }
    const packForCredit =
      normalizeTopupPackage(
        packRow || {
          id: packId,
          code: packCode,
          name: packName,
          wa_messages: topupMessages,
          price_cents: Math.round(Number(payment.transaction_amount || 0) * 100) || null,
        }
      ) || null

    if (subscription?.id) {
      await updateSubscription(subscription.id, {
        status: 'active',
        paymentMethod: 'pix',
        gatewayPaymentId: String(payment.id),
        amountCents: Math.round(Number(payment.transaction_amount || subscription.amountCents / 100) * 100),
        currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
        lastPaymentAt: payment.date_approved || new Date(),
        lastEventId: String(payment.id),
      })
      await appendSubscriptionEvent(subscription.id, {
        eventType: 'payment_approved',
        gatewayEventId: String(payment.id),
        payload: { event: eventPayload, payment, messages: topupMessages, pack_code: packCode, pack_id: packId },
      })
    }

    const estabelecimentoId = subscription?.estabelecimentoId || estabId
    if (estabelecimentoId && topupMessages) {
      try {
        await creditWhatsAppTopup({
          estabelecimentoId,
          messages: topupMessages,
          paymentId: String(payment.id),
          subscriptionId: subscription?.id || null,
          metadata: { kind: 'whatsapp_topup', messages: topupMessages, pack_code: packCode, pack_id: packId },
          pack: packForCredit,
        })
      } catch (err) {
        console.error('[billing][topup][credit]', err?.message || err)
      }
    }

    logSyncAction('pix_topup_applied', {
      matched_entity_type: 'subscription',
      matched_entity_id: subscription?.id || null,
      subscription_id: subscription?.id || null,
      establishment_id: estabelecimentoId || null,
      topup_messages: topupMessages || 0,
    })

    return { ok: true, payment, topup: true, messages: topupMessages, pack: packForCredit }
  }

  // status approved: ativa plano por 1 ciclo a partir de hoje (PIX fallback)
  if (!subscription?.id) {
    return ignore('subscription_not_found', {
      matched_entity_type: null,
      matched_entity_id: null,
      subscription_id: null,
      establishment_id: estabId || null,
    })
  }

  const effectivePlan = (PLAN_TIERS.includes(planToken) ? planToken : (subscription?.plan || 'pro'))
  const effectiveCycle = cycleToken || subscription?.billingCycle || 'mensal'
  let activationResult = {
    subscription,
    sourceSubscription: null,
    credit: null,
    activeUntil: addCycle(new Date(), effectiveCycle),
  }

  if (subscription?.id) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      activationResult = await finalizeApprovedPixSubscriptionTx(subscription.id, {
        payment,
        eventPayload,
        effectivePlan,
        effectiveCycle,
      }, { db: conn })
      await conn.commit()
    } catch (error) {
      try { await conn.rollback() } catch {}
      throw error
    } finally {
      conn.release()
    }

    if (
      activationResult?.sourceSubscription?.gatewaySubscriptionId &&
      String(activationResult.sourceSubscription.paymentMethod || '').toLowerCase() === 'credit_card'
    ) {
      try {
        await cancelMercadoPagoCardSubscription(activationResult.sourceSubscription.gatewaySubscriptionId)
      } catch (error) {
        console.warn('[billing][upgrade][cancel_source_gateway_subscription]', {
          source_subscription_id: activationResult.sourceSubscription.id,
          gateway_subscription_id: activationResult.sourceSubscription.gatewaySubscriptionId,
          message: error?.message || error,
        })
      }
    }
  }

  // Atualiza o usuário
  if (subscription?.estabelecimentoId || estabId) {
    const estabelecimentoId = activationResult?.subscription?.estabelecimentoId || subscription?.estabelecimentoId || estabId
    await syncUserPlanContextFromSubscription(estabelecimentoId, {
      plan: effectivePlan,
      status: 'active',
      billingCycle: effectiveCycle,
      trialEndsAt: null,
      activeUntil: activationResult?.activeUntil || null,
      subscriptionId: activationResult?.subscription?.id || subscription?.id || null,
    })
    try { await getWhatsAppWalletSnapshot(estabelecimentoId) } catch {}
  }

  if ((activationResult?.obsoleteSiblingCount || 0) > 0) {
    logSyncAction('stale_pix_marked_obsolete', {
      matched_entity_type: 'subscription',
      matched_entity_id: activationResult?.subscription?.id || subscription?.id || null,
      subscription_id: activationResult?.subscription?.id || subscription?.id || null,
      establishment_id:
        activationResult?.subscription?.estabelecimentoId ||
        subscription?.estabelecimentoId ||
        estabId ||
        null,
      stale_pix_marked_obsolete: activationResult?.obsoleteSiblingCount || 0,
    })
  }

  logSyncAction(
    activationResult?.credit
      ? 'plan_upgraded'
      : 'pix_payment_applied',
    {
      matched_entity_type: 'subscription',
      matched_entity_id: activationResult?.subscription?.id || subscription?.id || null,
      subscription_id: activationResult?.subscription?.id || subscription?.id || null,
      establishment_id:
        activationResult?.subscription?.estabelecimentoId ||
        subscription?.estabelecimentoId ||
        estabId ||
        null,
      upgrade_credit_cents: activationResult?.credit?.generated_credit_cents || 0,
      stale_pix_marked_obsolete: activationResult?.obsoleteSiblingCount || 0,
      source_subscription_id: activationResult?.sourceSubscription?.id || null,
    }
  )

  return {
    ok: true,
    payment,
    plan: effectivePlan,
    cycle: effectiveCycle,
    active_until: activationResult?.activeUntil || null,
    subscription: activationResult?.subscription || subscription || null,
    upgrade_credit: activationResult?.credit || null,
  }
}
