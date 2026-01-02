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
} from './subscriptions.js'
import { pool } from './db.js'
import { findWhatsAppPack } from './addon_packs.js'

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

// Cria um Checkout Pro (preferência) exclusivamente para PIX como fallback do primeiro ciclo
export async function createMercadoPagoPixCheckout({
  estabelecimento,
  plan,
  billingCycle,
}) {
  if (!estabelecimento?.id) throw new Error('Estabelecimento invalido')
  const normalizedPlan = String(plan || '').toLowerCase()
  if (!PLAN_TIERS.includes(normalizedPlan)) throw new Error('Plano invalido')
  const normalizedCycle = normalizeBillingCycle(billingCycle)
  const priceCents = getPlanPriceCents(normalizedPlan, normalizedCycle)
  if (!priceCents) throw new Error('Preco do plano nao configurado')

  const amountNum = Number((Number(priceCents || 0) / 100).toFixed(2))
  const paymentClient = ensureMercadoPagoPayment()

  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(FRONT_BASE)
  const DEFAULT_API_BASE = isDevFront ? 'http://localhost:3002' : `${FRONT_BASE}/api`
  const API_BASE = String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')

  const externalReference = buildExternalReference(estabelecimento.id, normalizedPlan, normalizedCycle)
  const metadata = { kind: 'pix_payment', plan: normalizedPlan, cycle: normalizedCycle, estabelecimento_id: String(estabelecimento.id) }

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
    ticket_url: transactionData.ticket_url || null,
    expires_at: transactionData.expires_at || payment?.date_of_expiration || null,
    amount_cents: priceCents,
  }

  const subscription = await createSubscription({
    estabelecimentoId: estabelecimento.id,
    plan: normalizedPlan,
    amountCents: priceCents,
    currency: BILLING_CURRENCY,
    status: 'pending',
    gatewaySubscriptionId: null,
    gatewayPreferenceId: String(payment.id),
    externalReference,
    billingCycle: normalizedCycle,
  })
  await appendSubscriptionEvent(subscription.id, {
    eventType: 'payment.create',
    gatewayEventId: String(payment.id),
    payload: { payment },
  })

  const initPoint = transactionData.ticket_url || null

  return { initPoint, subscription, planStatus: 'pending', pix: pixPayload, payment }
}

// Checkout PIX para compra avulsa (topup) de mensagens WhatsApp
export async function createMercadoPagoPixTopupCheckout({
  estabelecimento,
  messages,
  planHint,
  pack = null,
  availablePacks = null,
}) {
  if (!estabelecimento?.id) throw new Error('Estabelecimento invalido')
  const pkg = normalizeTopupPackage(pack) || resolveTopupPackage(messages, { availablePacks })
  if (!pkg) throw new Error('Pacote de mensagens invalido')

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
    status: 'pending',
    gatewaySubscriptionId: null,
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

export async function syncMercadoPagoPayment(paymentId, eventPayload = null) {
  if (!paymentId) throw new Error('paymentId ausente')
  const client = ensureMercadoPagoPayment()
  const payment = await client.get({ id: String(paymentId) })
  if (!payment?.id) throw new Error('Pagamento nao encontrado')

  const status = String(payment.status || '').toLowerCase()
  const externalRef = String(payment.external_reference || '')
  const metadataKind = String(payment?.metadata?.kind || '').toLowerCase()
  // Tenta extrair tokens do external_reference
  const tokens = {}
  const parts = externalRef.split(':')
  for (let i = 0; i < parts.length - 1; i += 2) {
    tokens[parts[i]] = parts[i + 1]
  }
  const planToken = String(tokens.plan || '').toLowerCase()
  const cycleToken = normalizeBillingCycle(tokens.cycle)
  const estabId = Number(tokens.est || 0)
  const topupMessagesToken = Number(tokens.msgs || 0) || 0
  const packCodeToken = tokens.pack || null
  const isTopup = metadataKind === 'whatsapp_topup' || String(tokens.wallet || '').toLowerCase() === 'whatsapp_topup'
  let topupMessages = Number(payment?.metadata?.messages || 0) || topupMessagesToken
  const packCode = payment?.metadata?.pack_code || packCodeToken || null
  const packIdRaw = payment?.metadata?.pack_id
  const packId = Number.isFinite(Number(packIdRaw)) ? Number(packIdRaw) : null
  const packName = payment?.metadata?.pack_name || null

  // Recupera (se existir) a subscription criada ao gerar a preferência
  let subscription = null
  if (payment.order?.id) {
    // às vezes, o order.id não corresponde à preference, então mantemos fallback por external_reference
  }
  // fallback: tente localizar pelo external_reference (se já tivermos salvo)
  if (!subscription) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM subscriptions WHERE gateway_preference_id=? ORDER BY id DESC LIMIT 1',
        [String(payment.id)]
      )
      subscription = rows?.[0]
        ? {
            id: rows[0].id,
            estabelecimentoId: rows[0].estabelecimento_id,
            plan: rows[0].plan,
            amountCents: rows[0].amount_cents,
            currency: rows[0].currency,
            billingCycle: rows[0].billing_cycle,
            gateway: rows[0].gateway,
            gatewaySubscriptionId: rows[0].gateway_subscription_id,
            gatewayPreferenceId: rows[0].gateway_preference_id,
            status: rows[0].status,
            lastEventId: rows[0].last_event_id,
          }
        : null
    } catch {}
  }
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
        status: rows[0].status,
        lastEventId: rows[0].last_event_id,
      } : null
    } catch {}
  }

  // Se não conseguimos inferir, mas temos tokens válidos, crie um registro minimamente coerente
  if (!subscription && estabId && (PLAN_TIERS.includes(planToken) || isTopup)) {
    subscription = await createSubscription({
      estabelecimentoId: estabId,
      plan: PLAN_TIERS.includes(planToken) ? planToken : 'starter',
      amountCents: Math.round(Number(payment.transaction_amount || 0) * 100),
      currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
      status: 'pending',
      gatewaySubscriptionId: null,
      gatewayPreferenceId: null,
      externalReference: externalRef || null,
      billingCycle: cycleToken || 'mensal',
    })
  }

  if (subscription?.lastEventId && String(subscription.lastEventId) === String(payment.id)) {
    return { ok: status === 'approved', payment, already_processed: true }
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
        amountCents: Math.round(Number(payment.transaction_amount || subscription.amountCents / 100) * 100),
        currency: (payment.currency_id || BILLING_CURRENCY).toUpperCase(),
        lastEventId: String(payment.id),
      })
      await appendSubscriptionEvent(subscription.id, {
        eventType: 'topup.approved',
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

    return { ok: true, payment, topup: true, messages: topupMessages, pack: packForCredit }
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
    try { await getWhatsAppWalletSnapshot(estabelecimentoId) } catch {}
  }

  return { ok: true, payment, plan: effectivePlan, cycle: effectiveCycle, active_until: activeUntil }
}

