// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { createMercadoPagoPixCheckout, createMercadoPagoPixTopupCheckout, syncMercadoPagoPayment } from '../lib/billing.js'
import { notifyEmail } from '../lib/notifications.js'
import {
  getWhatsAppWalletSnapshot,
  WHATSAPP_TOPUP_PACKAGES,
  listWhatsAppTopups,
} from '../lib/whatsapp_wallet.js'
import {
  getPlanContext,
  serializePlanContext,
  normalizeBillingCycle,
  PLAN_TIERS,
  isDowngrade,
  resolvePlanConfig,
  countProfessionals,
  formatPlanLimitExceeded,
} from '../lib/plans.js'
import { checkMonthlyAppointmentLimit } from '../lib/appointment_limits.js'
import {
  getLatestSubscriptionForEstabelecimento,
  listSubscriptionsForEstabelecimento,
  serializeSubscription,
} from '../lib/subscriptions.js'
import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'
import { resolveBillingState } from '../lib/billing_monitor.js'
import { BillingService } from '../lib/billing_service.js'
import { listActiveWhatsAppPacks, findWhatsAppPack } from '../lib/addon_packs.js'
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js'

const router = Router()
const DAY_MS = 86400000
const WEBHOOK_MISMATCH_WINDOW_MS = 60000
const webhookMismatchLogByIp = new Map()

function normalizeWebhookHeaderValue(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function parseSignatureHeaderForLog(header) {
  const raw = normalizeWebhookHeaderValue(header)
  const trimmed = raw.trim()
  if (!trimmed) {
    return { signaturePrefix: null, ts: null, v1Prefix: null }
  }
  const signaturePrefix = trimmed.slice(0, 32)
  let ts = null
  let v1 = null
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex < 0) continue
    const key = part.slice(0, separatorIndex).trim().toLowerCase()
    const value = part.slice(separatorIndex + 1).trim()
    if (key === 'ts') ts = value
    if (key === 'v1') v1 = value
  }
  return { signaturePrefix, ts, v1Prefix: v1 ? v1.slice(0, 12) : null }
}

function getClientIpForLog(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim()
  if (forwarded) return forwarded
  return String(req.ip || '').trim()
}

function shouldLogMismatchForIp(ip) {
  const key = ip || 'unknown'
  const now = Date.now()
  const last = webhookMismatchLogByIp.get(key) || 0
  if (now - last < WEBHOOK_MISMATCH_WINDOW_MS) return false
  webhookMismatchLogByIp.set(key, now)
  if (webhookMismatchLogByIp.size > 500) {
    const cutoff = now - WEBHOOK_MISMATCH_WINDOW_MS * 5
    for (const [storedKey, timestamp] of webhookMismatchLogByIp.entries()) {
      if (timestamp < cutoff) webhookMismatchLogByIp.delete(storedKey)
    }
  }
  return true
}

async function summarizeReminders(estabelecimentoId) {
  const [rows] = await pool.query(
    `SELECT reminder_kind, channel, MAX(sent_at) AS sent_at
     FROM billing_payment_reminders
     WHERE estabelecimento_id=?
     GROUP BY reminder_kind, channel`,
    [estabelecimentoId]
  )
  const reminders = {}
  for (const row of rows) {
    const kind = row?.reminder_kind
    if (!kind) continue
    if (!reminders[kind]) reminders[kind] = {}
    reminders[kind][row.channel] = row.sent_at ? new Date(row.sent_at).toISOString() : null
  }
  return reminders
}

function normalizePlanKey(plan) {
  const p = String(plan || '').toLowerCase().trim()
  return PLAN_TIERS.includes(p) ? p : ''
}

async function findPendingPixSubscription(estabelecimentoId, { plan, billingCycle } = {}) {
  const targetPlan = normalizePlanKey(plan)
  const targetCycle = billingCycle ? normalizeBillingCycle(billingCycle) : null
  const subs = await listSubscriptionsForEstabelecimento(estabelecimentoId)
  for (const sub of subs) {
    const status = String(sub.status || '').toLowerCase()
    if (status !== 'pending') continue
    if (!sub.gatewayPreferenceId) continue
    const ref = String(sub.externalReference || '')
    if (ref.startsWith('wallet:whatsapp_topup')) continue
    if (targetPlan && normalizePlanKey(sub.plan) !== targetPlan) continue
    if (targetCycle && normalizeBillingCycle(sub.billingCycle) !== targetCycle) continue
  return sub
}
return null
}

function toIsoDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function formatOpenPaymentPayload({
  paymentId,
  status,
  expiresAt,
  qrCode,
  qrCodeBase64,
  copiaECola,
  initPoint,
  ticketUrl,
  amountCents,
  plan,
  billingCycle,
}) {
  const expiresIso = toIsoDate(expiresAt)
  const copyValue = copiaECola || qrCode || null
  const amount = Number.isFinite(Number(amountCents)) ? Number(amountCents) : null
  const normalizedInitPoint = initPoint || ticketUrl || null
  return {
    payment_id: paymentId || null,
    id: paymentId || null,
    status: status || null,
    expiresAt: expiresIso,
    expires_at: expiresIso,
    qrCode: qrCode || null,
    qr_code: qrCode || null,
    qrCodeBase64: qrCodeBase64 || null,
    qr_code_base64: qrCodeBase64 || null,
    copiaECola: copyValue,
    copia_e_cola: copyValue,
    initPoint: normalizedInitPoint,
    init_point: normalizedInitPoint,
    ticketUrl: normalizedInitPoint,
    ticket_url: normalizedInitPoint,
    amountCents: amount,
    amount_cents: amount,
    plan: plan || null,
    billingCycle: billingCycle || null,
  }
}

async function loadOpenPaymentFromSubscription(subscription) {
  if (!subscription?.gatewayPreferenceId) return null
  let payment = null
  try {
    const sync = await syncMercadoPagoPayment(subscription.gatewayPreferenceId)
    payment = sync?.payment || null
  } catch (err) {
    console.warn('[billing/open-payment] sync failed', err?.message || err)
  }
  if (!payment) return null
  const txData = payment.point_of_interaction?.transaction_data || {}
  return formatOpenPaymentPayload({
    paymentId: subscription.gatewayPreferenceId,
    status: payment.status || subscription.status,
    expiresAt: txData.expires_at || payment.date_of_expiration || null,
    qrCode: txData.qr_code || null,
    qrCodeBase64: txData.qr_code_base64 || null,
    copiaECola: txData.copia_e_cola || txData.qr_code || null,
    initPoint: txData.ticket_url || txData.init_point || null,
    amountCents: subscription.amountCents,
    plan: subscription.plan,
    billingCycle: subscription.billingCycle,
  })
}

function isOpenPaymentExpired(payment) {
  if (!payment?.expiresAt) return false
  const expiresAt = new Date(payment.expiresAt)
  if (!Number.isFinite(expiresAt.getTime())) return false
  return expiresAt.getTime() <= Date.now()
}

function parseMercadoPagoSignatureHeader(xSignature) {
  // Example header: "ts=1700000000, v1=abcdef..."
  if (!xSignature) return { ts: null, v1: null }
  const raw = Array.isArray(xSignature) ? xSignature.join(',') : String(xSignature)
  const trimmed = raw.trim()
  if (!trimmed) return { ts: null, v1: null }
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
  const headerData = {}
  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex < 0) continue
    const key = part.slice(0, separatorIndex).trim().toLowerCase()
    const value = part.slice(separatorIndex + 1).trim()
    if (!key) continue
    headerData[key] = value
  }
  return { ts: headerData.ts || null, v1: headerData.v1 || null }
}

function safeTimingCompareHex(expectedHex, receivedHex) {
  const expectedBuffer = Buffer.from(String(expectedHex || ''), 'hex')
  const receivedBuffer = Buffer.from(String(receivedHex || ''), 'hex')
  if (expectedBuffer.length !== receivedBuffer.length) {
    const maxLength = Math.max(expectedBuffer.length, receivedBuffer.length)
    const paddedExpected = Buffer.alloc(maxLength)
    const paddedReceived = Buffer.alloc(maxLength)
    expectedBuffer.copy(paddedExpected)
    receivedBuffer.copy(paddedReceived)
    timingSafeEqual(paddedExpected, paddedReceived)
    return false
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

// How to test (example headers):
// const headers = { 'x-signature': 'ts=1700000000, v1=abcdef1234', 'x-request-id': 'req-123' }
// validateMercadoPagoWebhook({ headers, query: { id: '999' }, body: {} })
function validateMercadoPagoWebhook(req) {
  const header =
    req.headers['x-signature'] ||
    req.headers['x_signature'] ||
    req.headers['x-mercadopago-signature'] ||
    req.headers['x_mercadopago_signature']
  const { ts, v1 } = parseMercadoPagoSignatureHeader(header)
  const tsCandidates = []
  const tsCandidateSet = new Set()
  const tsValue = String(ts || '').trim()
  const addTsCandidate = (value) => {
    if (!value) return
    if (tsCandidateSet.has(value)) return
    tsCandidateSet.add(value)
    tsCandidates.push(value)
  }
  addTsCandidate(tsValue)
  if (tsValue && /^\d+$/.test(tsValue)) {
    const tsNumber = Number(tsValue)
    if (Number.isFinite(tsNumber)) {
      if (tsValue.length === 10) {
        addTsCandidate(String(tsNumber * 1000))
      } else if (tsValue.length === 13) {
        addTsCandidate(String(Math.floor(tsNumber / 1000)))
      }
    }
  }
  if (!tsCandidates.length) {
    tsCandidates.push(tsValue || String(ts || '').trim())
  }
  const requestId = String(req.headers['x-request-id'] || req.headers['x_request_id'] || '').trim()
  const id = normalizeId(req.query?.id || req.query?.['data.id'] || req.body?.data?.id || req.body?.id || req.body?.resource)
  const topic = String(req.query?.topic || req.query?.type || '').trim()

  if (!id || !ts || !v1 || (!requestId && !topic)) {
    console.warn('[billing:webhook] missing_fields', {
      id: id || null,
      ts: ts || null,
      v1: v1 || null,
      request_id: requestId || null,
    })
    return { ok: false, reason: 'missing_fields', status: 401 }
  }

  if (config.billing?.mercadopago?.allowUnsigned) {
    return {
      ok: true,
      skipped: 'unsigned-allowed',
      id,
      request_id: requestId,
      ts,
      using_variant: null,
      using_secret_index: null,
    }
  }

  const secretA = (config.billing?.mercadopago?.webhookSecret || '').trim()
  const secretB = (config.billing?.mercadopago?.webhookSecret2 || '').trim()
  let secrets = [secretA, secretB].filter(Boolean)
  if (!secrets.length) {
    const envA = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim()
    const envB = String(process.env.MERCADOPAGO_WEBHOOK_SECRET_2 || '').trim()
    secrets = [envA, envB].filter(Boolean)
  }

  const buildManifestCandidates = (tsCandidate) => {
    const candidates = []
    if (requestId) {
      candidates.push({ variant: 'request-id', manifest: `id:${id};request-id:${requestId};ts:${tsCandidate};` })
      candidates.push({ variant: 'request_id', manifest: `id:${id};request_id:${requestId};ts:${tsCandidate};` })
    }
    if (topic) {
      candidates.push({ variant: 'topic', manifest: `id:${id};topic:${topic};ts:${tsCandidate};` })
    }
    return candidates
  }
  const previewTs = tsCandidates[0]
  const previewCandidates = buildManifestCandidates(previewTs)

  if (!secrets.length) {
    return { ok: true, skipped: 'missing_secret', id, request_id: requestId, ts, manifest: previewCandidates[0]?.manifest }
  }

  for (let index = 0; index < secrets.length; index++) {
    const secret = secrets[index]
    for (const tsCandidate of tsCandidates) {
      const manifestCandidates = buildManifestCandidates(tsCandidate)
      for (const candidate of manifestCandidates) {
        const expected = createHmac('sha256', secret).update(candidate.manifest).digest('hex')
        if (safeTimingCompareHex(expected, v1)) {
          if (String(process.env.DEBUG_WEBHOOKS || '0') === '1') {
            console.log('[billing:webhook] signature_match', {
              id,
              topic,
              using_secret_index: index,
              using_variant: candidate.variant,
              using_ts: tsCandidate,
            })
          }
          return {
            ok: true,
            id,
            request_id: requestId,
            ts,
            manifest: candidate.manifest,
            using_variant: candidate.variant,
            using_secret_index: index,
            using_ts: tsCandidate,
          }
        }
      }
    }
  }

  const requestIdManifest = previewCandidates.find((candidate) => candidate.variant === 'request-id')?.manifest || ''
  const topicManifest = previewCandidates.find((candidate) => candidate.variant === 'topic')?.manifest || ''
  const previewRequestId =
    requestIdManifest.length > 160 ? `${requestIdManifest.slice(0, 160)}...` : requestIdManifest
  const previewTopic = topicManifest.length > 160 ? `${topicManifest.slice(0, 160)}...` : topicManifest
  const v1Prefix = String(v1 || '').slice(0, 8)
  console.warn('[billing:webhook] signature_mismatch', {
    url: req.originalUrl,
    id,
    id_from_body: req.body?.data?.id ?? null,
    id_from_query_data: req.query?.['data.id'] ?? null,
    id_from_query_id: req.query?.id ?? null,
    topic,
    ts,
    ts_candidates: tsCandidates,
    request_id_present: Boolean(requestId),
    topic_present: Boolean(topic),
    v1_prefix: v1Prefix || null,
    manifest_preview_request_id: previewRequestId || null,
    manifest_preview_topic: previewTopic || null,
  })
  // Se Nginx/proxy sobrescrever X-Request-Id, a assinatura nunca vai bater. Nao setar proxy_set_header X-Request-Id ...
  const debugPayload = { request_id_received: requestId || null }
  const forwardedRequestId = req.headers['x-forwarded-request-id']
  const amznTraceId = req.headers['x-amzn-trace-id']
  if (forwardedRequestId) debugPayload.x_forwarded_request_id = forwardedRequestId
  if (amznTraceId) debugPayload.x_amzn_trace_id = amznTraceId
  console.warn('[billing:webhook] signature_mismatch_debug', debugPayload)
  return { ok: false, reason: 'signature_mismatch', status: 401, id, ts, manifest: requestIdManifest }
}

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeResourceCandidate(value) {
  const raw = normalizeId(value)
  if (!raw) return ''
  const withoutQuery = raw.split('?')[0].split('#')[0]
  const withoutHost = withoutQuery.replace(/^https?:\/\/[^/]+/i, '')
  const trimmed = withoutHost.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmed) return raw
  if (!trimmed.includes('/')) return trimmed
  const segments = trimmed.split('/').filter(Boolean)
  if (!segments.length) return trimmed
  return segments[segments.length - 1]
}

function serializeWhatsAppPack(pack) {
  if (!pack) return null
  const waMessages = Number(pack.waMessages ?? pack.wa_messages ?? pack.messages ?? 0) || 0
  const priceCents = Number(pack.price_cents ?? pack.priceCents ?? pack.price ?? 0) || 0
  return {
    id: pack.id ?? null,
    code: pack.code || null,
    name: pack.name || null,
    price_cents: priceCents,
    wa_messages: waMessages,
  }
}

function serializeTopupHistory(entry) {
  if (!entry) return null
  const meta = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
  const nestedPack = meta.pack && typeof meta.pack === 'object' ? meta.pack : {}
  return {
    id: entry.id ?? null,
    payment_id: entry.payment_id || null,
    messages: meta.messages ?? entry.delta ?? null,
    extra_delta: entry.extra_delta ?? null,
    pack_code: meta.pack_code || nestedPack.code || null,
    pack_id: meta.pack_id ?? nestedPack.id ?? null,
    price_cents: meta.price_cents ?? nestedPack.price_cents ?? null,
    created_at: entry.created_at || null,
  }
}

router.get('/plans', auth, isEstabelecimento, async (_req, res) => {
  try {
    const plans = await BillingService.listPlans()
    return res.json({
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        price_cents: plan.priceCents,
        max_professionals: plan.maxProfessionals,
        included_wa_messages: plan.includedWaMessages,
      })),
    })
  } catch (err) {
    console.error('GET /billing/plans', err)
    return res.status(500).json({ error: 'plans_fetch_failed' })
  }
})

router.get('/status', auth, isEstabelecimento, async (req, res) => {
  try {
    const ctx = await getPlanContext(req.user.id)
    if (!ctx) return res.status(404).json({ error: 'plan_context_not_found' })
    const state = resolveBillingState({
      planStatus: ctx.status,
      planActiveUntil: ctx.activeUntil,
      planTrialEndsAt: ctx.trialEndsAt,
    })
    const dueAtIso = state.dueAt ? state.dueAt.toISOString() : null
    const graceDeadlineIso =
      state.dueAt && state.graceDays
        ? new Date(state.dueAt.getTime() + state.graceDays * DAY_MS).toISOString()
        : null
    const reminders = await summarizeReminders(req.user.id)

    const trialEndsAt = ctx.trialEndsAt
    const trialEndsIso = trialEndsAt ? trialEndsAt.toISOString() : null
    const trialExpired = trialEndsAt ? trialEndsAt.getTime() <= Date.now() : false
    const pendingSubscription = await findPendingPixSubscription(req.user.id, { plan: ctx.plan, billingCycle: ctx.cycle })
    let openPayment = null
    if (pendingSubscription) {
      openPayment = await loadOpenPaymentFromSubscription(pendingSubscription)
      if (openPayment && isOpenPaymentExpired(openPayment)) {
        openPayment = null
      }
    }
    const hasOpenPayment = Boolean(openPayment)
    const normalizedStatus = String(ctx.status || '').toLowerCase()
    const hasActiveSubscription = ['active', 'authorized'].includes(normalizedStatus)
    const renewalRequired =
      (trialExpired && !hasActiveSubscription) ||
      ['due_soon', 'overdue', 'blocked'].includes(state.state) ||
      normalizedStatus === 'pending'

    return res.json({
      ok: true,
      plan: ctx.plan,
      plan_status: ctx.status,
      billing_cycle: ctx.cycle,
      due_at: dueAtIso,
      state: state.state,
      warn_days: state.warnDays,
      grace_days: state.graceDays,
      grace_deadline: graceDeadlineIso,
      days_to_due: state.daysToDue,
      days_overdue: state.daysOverdue,
      grace_days_remaining: state.graceDaysRemaining,
      reminders,
      trial: {
        wasUsed: Boolean(trialEndsAt),
        isExpired: trialExpired,
        endsAt: trialEndsIso,
      },
      subscription: {
        plan: ctx.plan,
        status: ctx.status,
        billingCycle: ctx.cycle,
        currentPeriodEnd: ctx.activeUntil ? ctx.activeUntil.toISOString() : null,
        paymentMethod: 'pix_manual',
      },
      billing: {
        renewalRequired,
        hasOpenPayment,
        openPayment,
      },
    })
  } catch (err) {
    console.error('[billing/status]', err)
    return res.status(500).json({ error: 'server_error' })
  }
})

router.get('/subscription', auth, isEstabelecimento, async (req, res) => {
  try {
    const planContext = await getPlanContext(req.user.id)
    const fullHistory = await listSubscriptionsForEstabelecimento(req.user.id)

    const isWhatsAppTopup = (sub) => {
      const ref = String(sub?.externalReference || '')
      return ref.startsWith('wallet:whatsapp_topup')
    }

    const topups = fullHistory.filter(isWhatsAppTopup)
    const history = fullHistory.filter((sub) => !isWhatsAppTopup(sub))

    // Escolhe uma assinatura "efetiva" priorizando status ativos
    const priority = {
      active: 60,
      authorized: 50,
      paused: 40,
      past_due: 35,
      pending: 20,
      canceled: 10,
      expired: 5,
    }
    let effective = null
    for (const s of history) {
      const key = String(s?.status || '').toLowerCase()
      if (!effective) { effective = s; continue }
      const pA = priority[key] || 0
      const pB = priority[String(effective.status || '').toLowerCase()] || 0
      if (pA > pB) {
        effective = s
      } else if (pA === pB) {
        // desempate pelo id mais recente
        if (Number(s.id || 0) > Number(effective.id || 0)) effective = s
      }
    }
    if (!effective && history.length) effective = history[0]

    const planLimit = planContext?.config?.maxMonthlyAppointments ?? null
    let usage = { total: 0, limit: planLimit, range: null }
    if (planContext) {
      try {
        const result = await checkMonthlyAppointmentLimit({
          estabelecimentoId: req.user.id,
          planConfig: planContext.config,
          appointmentDate: new Date(),
        })
        usage = {
          total: typeof result?.total === 'number' ? result.total : 0,
          limit: result?.limit ?? planLimit,
          range: result?.range || null,
        }
      } catch (err) {
        console.warn('[billing/subscription][usage]', err?.message || err)
      }
    }

    const serializedPlan = serializePlanContext(planContext)
    if (serializedPlan) {
      serializedPlan.usage = {
        appointments: {
          total: usage.total,
          limit: usage.limit,
          month: usage.range?.label || null,
          period_start: usage.range?.start ? usage.range.start.toISOString() : null,
          period_end: usage.range?.end ? usage.range.end.toISOString() : null,
        },
      }
    }

    let billingPlan = null
    let professionalsUsage = null
    try {
      billingPlan = await BillingService.getCurrentPlan(req.user.id)
      const totalActive = await BillingService.countActiveProfessionals(req.user.id)
      professionalsUsage = { total: totalActive, limit: billingPlan?.maxProfessionals ?? null }
    } catch (err) {
      console.warn('[billing/subscription][current plan]', err?.message || err)
    }

    if (serializedPlan) {
      serializedPlan.limits = serializedPlan.limits || {}
      serializedPlan.limits.maxProfessionals =
        billingPlan?.maxProfessionals ?? serializedPlan.limits.maxProfessionals ?? null
      serializedPlan.usage = serializedPlan.usage || {}
      if (professionalsUsage) {
        serializedPlan.usage.professionals = {
          total: professionalsUsage.total,
          limit: professionalsUsage.limit,
        }
      }
    }

    let whatsappWallet = null
    try {
      whatsappWallet = await getWhatsAppWalletSnapshot(req.user.id, { planContext })
      if (serializedPlan) {
        serializedPlan.usage = serializedPlan.usage || {}
        serializedPlan.usage.whatsapp = whatsappWallet
      }
    } catch (err) {
      console.warn('[billing/subscription][wallet]', err?.message || err)
    }

    let whatsappPacks = []
    try {
      whatsappPacks = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/subscription][packs]', err?.message || err)
    }

    return res.json({
      plan: serializedPlan,
      whatsapp_packages: (whatsappPacks.length ? whatsappPacks : WHATSAPP_TOPUP_PACKAGES).map(serializeWhatsAppPack).filter(Boolean),
      subscription: serializeSubscription(effective),
      history: history.map(serializeSubscription),
      topups: topups.map(serializeSubscription),
      current_plan: billingPlan
        ? {
            code: billingPlan.code,
            name: billingPlan.name,
            price_cents: billingPlan.priceCents,
            max_professionals: billingPlan.maxProfessionals,
            included_wa_messages: billingPlan.includedWaMessages,
          }
        : null,
      professional_limit: professionalsUsage,
    })
  } catch (error) {
    console.error('GET /billing/subscription', error)
    return res.status(500).json({ error: 'subscription_fetch_failed' })
  }
})

router.get('/whatsapp/packs', auth, isEstabelecimento, async (_req, res) => {
  try {
    let packs = []
    try {
      packs = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/whatsapp/packs] fallback to static packages', err?.message || err)
    }
    const responsePacks = (packs.length ? packs : WHATSAPP_TOPUP_PACKAGES).map(serializeWhatsAppPack).filter(Boolean)
    return res.json({ ok: true, packs: responsePacks })
  } catch (err) {
    console.error('GET /billing/whatsapp/packs', err)
    return res.status(500).json({ error: 'packs_fetch_failed' })
  }
})

// Wallet WhatsApp (saldo de mensagens por estabelecimento)
router.get('/whatsapp/wallet', auth, isEstabelecimento, async (req, res) => {
  // Evita cache/304: sempre retorna dados atualizados (saldo muda após PIX/webhook)
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });

  try {
    const planContext = await getPlanContext(req.user.id);
    const wallet = await getWhatsAppWalletSnapshot(req.user.id, { planContext });

    let packs = [];
    try {
      packs = await listActiveWhatsAppPacks();
    } catch (err) {
      console.warn('[billing/whatsapp/wallet][packs]', err?.message || err);
    }

    const history = await listWhatsAppTopups(req.user.id, { limit: 5 }).catch(() => []);

    return res.json({
      ok: true,
      wallet,
      packages: (packs.length ? packs : WHATSAPP_TOPUP_PACKAGES)
        .map(serializeWhatsAppPack)
        .filter(Boolean),
      history: history.map(serializeTopupHistory).filter(Boolean),
    });
  } catch (err) {
    console.error('GET /billing/whatsapp/wallet', err);
    return res.status(500).json({ error: 'wallet_fetch_failed' });
  }
});

router.get('/whatsapp/pix/status', auth, isEstabelecimento, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const estabelecimentoId = req.user.id;
    const paymentId = String(req.query.payment_id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'missing_payment_id' });
    }

    const [rows] = await pool.query(
      `SELECT id, created_at
         FROM whatsapp_wallet_transactions
        WHERE estabelecimento_id = ?
          AND payment_id = ?
          AND kind = 'topup_credit'
        ORDER BY id DESC
        LIMIT 1`,
      [estabelecimentoId, paymentId]
    );

    const credited = Array.isArray(rows) && rows.length > 0;
    const creditedAt = credited && rows[0]?.created_at ? new Date(rows[0].created_at).toISOString() : null;
    return res.json({ ok: true, credited, credited_at: creditedAt });
  } catch (err) {
    console.error('GET /billing/whatsapp/pix/status', err);
    return res.status(500).json({ ok: false, error: 'status_failed' });
  }
});

// Checkout PIX para pacote extra de mensagens WhatsApp
router.post('/whatsapp/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const { messages, pack_code, pack_id, packCode, packId } = req.body || {}
    const packCodeInput = (pack_code || packCode || '').trim() || null
    const packIdInput = pack_id ?? packId ?? null

    if (!packCodeInput) {
      return res.status(400).json({ error: 'pack_required' })
    }

    let availablePacks = []
    try {
      availablePacks = await listActiveWhatsAppPacks()
    } catch (err) {
      console.warn('[billing/whatsapp/pix][packs]', err?.message || err)
    }

    let selectedPack = null
    if (packIdInput != null || packCodeInput) {
      selectedPack = await findWhatsAppPack({ id: packIdInput, code: packCodeInput, activeOnly: true })
      if (!selectedPack) return res.status(404).json({ error: 'pack_not_found' })
    } else if (messages && availablePacks.length) {
      selectedPack = availablePacks.find((p) => Number(p.waMessages || 0) === Number(messages || 0)) || null
    }

    if (!selectedPack && !messages) {
      return res.status(400).json({ error: 'invalid_pack', message: 'Pacote n\u00e3o informado.' })
    }

    const result = await createMercadoPagoPixTopupCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      messages: selectedPack?.waMessages ?? messages,
      planHint: req.user.plan || 'starter',
      pack: selectedPack,
      availablePacks: availablePacks.length ? availablePacks : null,
    })

    const packResponse =
      serializeWhatsAppPack(selectedPack) ||
      (result.package
        ? {
            code: result.package.code || null,
            name: result.package.name || null,
            price_cents: result.package.priceCents,
            wa_messages: result.package.messages,
          }
        : null)

    console.info('[billing/whatsapp/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      pack_code: selectedPack?.code || packCodeInput || null,
      pack_id: selectedPack?.id ?? packIdInput ?? null,
      messages: result?.pix?.messages || messages || selectedPack?.waMessages,
      payment_id: result?.pix?.payment_id || result?.subscription?.gateway_preference_id || null,
    })

    return res.json({
      ok: true,
      init_point: result.initPoint,
      subscription: serializeSubscription(result.subscription),
      pix: result.pix,
      pack: packResponse,
      package: result.package ? { messages: result.package.messages, price_cents: result.package.priceCents } : null,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message || 'Falha ao criar cobranca PIX'
    console.error('POST /billing/whatsapp/pix', detail, cause || error)
    return res.status(400).json({ error: 'pix_failed', message: detail, cause })
  }
})

router.post('/webhook', async (req, res) => {
  const event = req.body || {}
  const topic = String(
    req.query?.type ||
    req.query?.topic ||
    event?.type ||
    event?.topic ||
    req.headers['x-topic'] ||
    ''
  ).toLowerCase()
  const bodyUserId = event?.user_id ?? event?.userId ?? null
  const liveMode = typeof event?.live_mode === 'boolean' ? event.live_mode : null
  const bodyType = event?.type ?? event?.topic ?? null
  const bodyAction = event?.action ?? null

  const verification = verifyMercadoPagoWebhookSignature(req)
  if (!verification.ok) {
    const reason = verification.reason || 'invalid_signature'

    // Se veio x-signature, loga detalhes (util p/ diagnosticar fonte/ambiente errado),
    // mas SEMPRE responde 200 para nao gerar retries.
    const xSignature = req.headers['x-signature']
    const signaturePresent = Boolean(String(normalizeWebhookHeaderValue(xSignature)).trim())
    const signatureDetails = parseSignatureHeaderForLog(xSignature)
    const requestId = String(req.headers['x-request-id'] || '').trim()
    const ip = getClientIpForLog(req)

    if (signaturePresent && shouldLogMismatchForIp(ip)) {
      console.warn('[billing:webhook] mismatch_source', {
        host: String(req.headers.host || '').trim() || null,
        url: req.originalUrl,
        ip: ip || null,
        user_agent: String(req.headers['user-agent'] || '').trim() || null,
        x_request_id: requestId || null,
        x_request_id_present: Boolean(requestId),
        x_signature_present: signaturePresent,
        x_signature_prefix: signatureDetails.signaturePrefix,
        ts: signatureDetails.ts || null,
        v1_prefix: signatureDetails.v1Prefix,
        resource_id: verification.id || null,
        topic: topic || null,
        body_user_id: bodyUserId,
        body_live_mode: liveMode,
        body_type: bodyType,
        body_action: bodyAction,
        reason,
      })
    } else {
      console.warn('[billing:webhook] invalid_webhook', {
        url: req.originalUrl,
        ip: ip || null,
        user_agent: String(req.headers['user-agent'] || '').trim() || null,
        topic: topic || null,
        resource_id: verification.id || null,
        body_user_id: bodyUserId,
        body_live_mode: liveMode,
        body_type: bodyType,
        body_action: bodyAction,
        reason,
        x_signature_present: signaturePresent,
      })
    }

    return res.status(200).json({ ok: true, ignored: true, reason })
  }

  const resourceId = verification.id

  try {
    if (topic === 'payment') {
      const r = await syncMercadoPagoPayment(resourceId, event);
      console.log('[billing:webhook] payment', resourceId, r?.ok ? 'approved' : 'ignored', { ok: !!r?.ok });
      return res.status(200).json({ ok: true, processed: !!r?.ok });
    }

    console.log('[billing:webhook] ignoring topic', topic || 'unknown', 'for resource', resourceId);
    return res.status(200).json({ ok: true, ignored: 'unsupported_topic', topic: topic || 'unknown' });
  } catch (error) {
    console.error('[billing:webhook] falha ao sincronizar', resourceId, error);
    // 200 pra evitar retries; o log já registra o problema
    return res.status(200).json({ ok: true, ignored: 'internal_error' });
  }
});

// Auxilia validações do painel do Mercado Pago (algumas checagens usam GET/HEAD)
router.get('/webhook', (req, res) => {
  return res.status(200).json({ ok: true, message: 'billing webhook up; send POST with Mercado Pago event body' })
})
router.head('/webhook', (req, res) => res.sendStatus(200))

// Health/diagnóstico do webhook: sinaliza se segredo está configurado e permite calcular assinatura esperada
router.get('/webhook/health', (req, res) => {
  const secretA = (config.billing?.mercadopago?.webhookSecret || '').trim()
  const secretB = (config.billing?.mercadopago?.webhookSecret2 || '').trim()
  const secrets = [secretA, secretB].filter(Boolean)
  const hasSecret = secrets.length > 0

  const id = String(req.query.id || req.query['data.id'] || '').trim()
  const requestId = String(req.query['request-id'] || req.query.request_id || '').trim()
  const ts = String(req.query.ts || '').trim()
  const topic = String(req.query.type || req.query.topic || '').trim()

  const base = {
    ok: true,
    signature_required: hasSecret,
    algorithm: 'HMAC-SHA256',
    header_format: "x-signature: ts=<unix>, v1=<hex>",
    uses_request_id: true,
  }

  if (!hasSecret) return res.status(200).json(base)

  if (id && ts) {
    try {
      const tsCandidates = [ts]
      if (/^\d{13,}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) / 1000)))
      if (/^\d{10}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) * 1000)))

      const results = secrets.map((sec, idx) => {
        const primary = (() => {
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${ts};`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${ts};`
          const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
          return { request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } }
        })()

        const alternatives = []
        for (const alt of tsCandidates) {
          if (alt === ts) continue
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${alt};`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${alt};`
          const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
          alternatives.push({ ts: alt, request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } })
        }
        return { index: idx, ...primary, alt_ts: alternatives }
      })
      return res.status(200).json({ ...base, provided: { id, request_id: requestId, topic, ts }, secrets: results, ts_candidates: tsCandidates })
    } catch (e) {
      return res.status(200).json({ ...base, error: 'failed_to_compute_signature', detail: e?.message || String(e) })
    }
  }

  return res.status(200).json(base)
})

// Recupera a última preferência PIX pendente (mesmo plano/ciclo) se ainda válida
router.get('/pix/pending', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = normalizePlanKey(req.query.plan || req.user.plan || 'starter')
    const billingCycle = normalizeBillingCycle(req.query.billing_cycle || req.query.cycle || req.user.plan_cycle || 'mensal')

    const pending = await findPendingPixSubscription(req.user.id, { plan, billingCycle })
    if (!pending) return res.status(404).json({ error: 'pending_pix_not_found' })

    console.info('[billing/pix/pending]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan,
      billing_cycle: billingCycle,
      preference_id: pending.gatewayPreferenceId,
    })

    let payment = null
    try {
      const sync = await syncMercadoPagoPayment(pending.gatewayPreferenceId)
      payment = sync?.payment || null
    } catch (err) {
      console.error('[billing/pix/pending] sync failed', err?.message || err)
    }

    const txData = payment?.point_of_interaction?.transaction_data || {}
    const expiresRaw = txData.expires_at || payment?.date_of_expiration || null
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null
    if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      console.info('[billing/pix/pending] expired preference', {
        user_id: req.user?.id,
        plan,
        billing_cycle: billingCycle,
        preference_id: pending.gatewayPreferenceId,
        expires_at: expiresAt.toISOString(),
      })
      return res.status(404).json({ error: 'pending_pix_not_found' })
    }
    const pixPayload = {
      payment_id: pending.gatewayPreferenceId,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
      expires_at: expiresRaw || null,
      amount_cents: pending.amountCents,
      plan: pending.plan,
      billing_cycle: pending.billingCycle,
    }

    // Se não tem QR/ticket, provavelmente expirou
    if (!pixPayload.qr_code && !pixPayload.ticket_url) {
      return res.status(404).json({ error: 'pending_pix_not_found' })
    }

    return res.json({
      ok: true,
      pix: pixPayload,
      subscription: serializeSubscription(pending),
    })
  } catch (error) {
    console.error('GET /billing/pix/pending', error)
    return res.status(500).json({ error: 'pix_pending_failed' })
  }
})

// Checkout exclusivo via PIX (link dinâmico do Mercado Pago)
router.post('/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const { plan, billing_cycle: rawCycle } = req.body || {}
    const targetPlan = String(plan || req.user.plan || 'starter').toLowerCase()
    if (!PLAN_TIERS.includes(targetPlan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plano inválido.' })
    }
    const billingCycle = normalizeBillingCycle(rawCycle)
    const currentPlan = String(req.user.plan || 'starter').toLowerCase()

    if (isDowngrade(currentPlan, targetPlan)) {
      const limits = resolvePlanConfig(targetPlan)
      const totalProfessionals = await countProfessionals(req.user.id)
      if (typeof limits.maxProfessionals === 'number' && totalProfessionals > limits.maxProfessionals) {
        return res.status(409).json({
          error: 'plan_limit_professionals',
          message: formatPlanLimitExceeded(limits, 'professionals') || 'Reduza a equipe antes de fazer downgrade.',
        })
      }
    }

    const result = await createMercadoPagoPixCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: targetPlan,
      billingCycle,
    })
    console.info('[billing/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan: targetPlan,
      billing_cycle: billingCycle,
      preference_id: result?.pix?.payment_id || result?.subscription?.gatewayPreferenceId || null,
    })
    // Alerta opcional por email (admin)
    try {
      const adminEmail =
        process.env.BILLING_ALERT_EMAIL ||
        process.env.NEW_USER_ALERT_EMAIL ||
        'servicos.negocios.digital@gmail.com'
      if (adminEmail) {
        const amountCents = result?.pix?.amount_cents ?? result?.subscription?.amount_cents ?? null
        const amountLabel =
          typeof amountCents === 'number'
            ? (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : 'N/D'
        const html = `
          <p>PIX gerado para assinatura.</p>
          <ul>
            <li>Usuário: ${req.user?.id || '-'} / ${req.user?.email || '-'}</li>
            <li>Plano: ${targetPlan}</li>
            <li>Ciclo: ${billingCycle}</li>
            <li>Pagamento/Preference ID: ${result?.pix?.payment_id || result?.subscription?.gatewayPreferenceId || 'N/D'}</li>
            <li>Valor: ${amountLabel}</li>
            <li>Data/hora: ${new Date().toLocaleString('pt-BR')}</li>
          </ul>
        `
        notifyEmail(adminEmail, '[AO] Log: PIX gerado', html)
      }
    } catch (err) {
      console.warn('[billing/pix/create][email_log] falhou', err?.message || err)
    }
    return res.json({
      ok: true,
      init_point: result.initPoint,
      plan_status: result.planStatus,
      subscription: serializeSubscription(result.subscription),
      pix: result.pix,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message || 'Falha ao criar cobrança PIX'
    console.error('POST /billing/pix', detail, cause || error)
    return res.status(400).json({ error: 'pix_failed', message: detail, cause })
  }
})

router.post('/renew/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const planContext = await getPlanContext(req.user.id)
    if (!planContext) {
      return res.status(404).json({ error: 'plan_context_not_found' })
    }
    const targetPlan = normalizePlanKey(planContext.plan || req.user.plan || 'starter') || 'starter'
    const targetCycle = normalizeBillingCycle(planContext.cycle || req.user.plan_cycle || 'mensal')

    const pending = await findPendingPixSubscription(req.user.id, { plan: targetPlan, billingCycle: targetCycle })
    if (pending) {
      const openPayment = await loadOpenPaymentFromSubscription(pending)
      if (openPayment && !isOpenPaymentExpired(openPayment)) {
        console.info('[billing/renew/pix/existing]', {
          user_id: req.user?.id,
          user_email: req.user?.email,
          estab_id: req.user?.id,
          plan: targetPlan,
          billing_cycle: targetCycle,
          preference_id: pending.gatewayPreferenceId,
        })
        return res.json({
          ok: true,
          renewal: { hasOpenPayment: true, openPayment },
          subscription: serializeSubscription(pending),
        })
      }
    }

    const result = await createMercadoPagoPixCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: targetPlan,
      billingCycle: targetCycle,
    })
    const newOpenPayment = formatOpenPaymentPayload({
      paymentId: result.pix?.payment_id || result.subscription?.gatewayPreferenceId || null,
      status: result.payment?.status || result.subscription?.status || 'pending',
      expiresAt: result.pix?.expires_at || null,
      qrCode: result.pix?.qr_code || null,
      qrCodeBase64: result.pix?.qr_code_base64 || null,
      copiaECola: result.pix?.copia_e_cola || result.pix?.qr_code || null,
      initPoint: result.initPoint || result.pix?.ticket_url || null,
      amountCents: result.pix?.amount_cents ?? result.subscription?.amountCents ?? null,
      plan: targetPlan,
      billingCycle: targetCycle,
    })

    console.info('[billing/renew/pix/create]', {
      user_id: req.user?.id,
      user_email: req.user?.email,
      estab_id: req.user?.id,
      plan: targetPlan,
      billing_cycle: targetCycle,
      preference_id: result.pix?.payment_id || result.subscription?.gatewayPreferenceId || null,
    })

    return res.json({
      ok: true,
      renewal: { hasOpenPayment: true, openPayment: newOpenPayment },
      subscription: serializeSubscription(result.subscription),
    })
  } catch (error) {
    console.error('POST /billing/renew/pix', error)
    return res.status(500).json({ error: 'renewal_pix_failed' })
  }
})

router.get('/renew/pix/status', auth, isEstabelecimento, async (req, res) => {
  try {
    const paymentId = String(req.query.payment_id || '').trim()
    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' })
    }

    const result = await syncMercadoPagoPayment(paymentId)
    const payment = result?.payment || null
    const openPayment = formatOpenPaymentPayload({
      paymentId: payment?.id || paymentId,
      status: payment?.status || null,
      expiresAt: payment?.point_of_interaction?.transaction_data?.expires_at || payment?.date_of_expiration || null,
      qrCode: payment?.point_of_interaction?.transaction_data?.qr_code || null,
      qrCodeBase64: payment?.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      copiaECola:
        payment?.point_of_interaction?.transaction_data?.copia_e_cola ||
        payment?.point_of_interaction?.transaction_data?.qr_code ||
        null,
      initPoint: payment?.point_of_interaction?.transaction_data?.ticket_url || null,
      amountCents: payment?.transaction_amount ? Math.round(Number(payment.transaction_amount || 0) * 100) : null,
      plan: result?.subscription?.plan || null,
      billingCycle: result?.subscription?.billingCycle || null,
    })
    const statusNormalized = String(payment?.status || '').toLowerCase()
    const paid =
      !!statusNormalized &&
      (statusNormalized.includes('approved') || statusNormalized.includes('paid'))

    return res.json({
      ok: true,
      paid,
      status: payment?.status || null,
      payment_id: payment?.id || paymentId,
      openPayment,
      subscription: result?.subscription ? serializeSubscription(result.subscription) : null,
    })
  } catch (err) {
    console.error('GET /billing/renew/pix/status', err)
    return res.status(500).json({ error: 'renewal_status_failed' })
  }
})

export default router

// Manual test snippet (keep commented):
// parseMercadoPagoSignatureHeader('ts=1700000000,v1=abc') // => { ts: '1700000000', v1: 'abc' }
// parseMercadoPagoSignatureHeader('ts=1700000000, v1=abc') // => { ts: '1700000000', v1: 'abc' }
// parseMercadoPagoSignatureHeader('v1=abc,ts=1700000000') // => { ts: '1700000000', v1: 'abc' }
// const verification = verifyMercadoPagoWebhookSignature({
//   headers: { 'x-signature': 'ts=1700000000,v1=abc', 'x-request-id': 'req-123' },
//   query: { id: '123', topic: 'payment' },
//   body: {},
//   originalUrl: '/api/billing/webhook',
// })
// Expect: verification.ok === false when v1 does not match any configured secret.
