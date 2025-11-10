// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { createMercadoPagoPixCheckout, syncMercadoPagoPayment } from '../lib/billing.js'
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
import {
  getLatestSubscriptionForEstabelecimento,
  listSubscriptionsForEstabelecimento,
  serializeSubscription,
} from '../lib/subscriptions.js'
import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'
import { resolveBillingState } from '../lib/billing_monitor.js'

const router = Router()
const DAY_MS = 86400000

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

function verifyWebhookSignature(req, resourceId) {
  const secretA = (config.billing?.mercadopago?.webhookSecret || '').trim()
  const secretB = (config.billing?.mercadopago?.webhookSecret2 || '').trim()
  const secrets = [secretA, secretB].filter(Boolean)
  if (!secrets.length) return { valid: true, method: 'none', using_secret_index: null }
  // Modo diagnóstico: permitir sem assinatura quando habilitado por env
  if (config.billing?.mercadopago?.allowUnsigned) {
    return { valid: true, method: 'unsigned-allowed', using_secret_index: null }
  }
  // Mercado Pago envia X-Signature: ts=<unix>, v1=<hex> (às vezes usa 't' em vez de 'ts')
  const header = req.headers['x-signature']
  if (!header) return { valid: false, reason: 'missing_signature' }

  const parts = String(header)
    .split(',')
    .map((segment) => segment.trim().split('='))
    .filter((pair) => pair.length === 2)

  const raw = Object.fromEntries(parts)
  const normalizeVal = (v) => String(v || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  const data = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), normalizeVal(v)]))
  const ts = data.ts || data.t || data.time || data.timestamp || ''
  const signature = data.v1 || data.sign || data.signature || ''
  if (!ts || !signature) return { valid: false, reason: 'invalid_signature_header' }

  // Alguns ambientes do MP usam request-id na mensagem, outros usam topic (query "topic" ou "type")
  const requestId = req.headers['x-request-id'] || ''
  // Colete várias fontes possíveis de tópico (MP varia entre 'topic', 'type', 'entity' e header 'x-topic')
  const topicCandidatesRaw = [
    req.query?.topic,
    req.query?.type,
    req.headers['x-topic'],
    req.body?.topic,
    req.body?.type,
    req.body?.entity,
  ]
  const topicCandidates = Array.from(new Set(topicCandidatesRaw.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => String(v).toLowerCase())))

  let matched = false
  let method = 'none'
  let usingSecretIndex = null
  const variants = []

  for (let i = 0; i < secrets.length; i++) {
    const sec = secrets[i]
    const payloadReqId = `id:${resourceId};request-id:${requestId};ts:${ts}`
    const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
    const validReq = expectedReqId === signature
    variants.push({ index: i, expected_request_id: expectedReqId, payload_request_id: payloadReqId })
    if (validReq) { matched = true; method = 'request-id'; usingSecretIndex = i; break }

    // Tente múltiplos candidatos de tópico
    for (const t of (topicCandidates.length ? topicCandidates : [''])) {
      const payloadTopic = `id:${resourceId};topic:${t};ts:${ts}`
      const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
      variants.push({ index: i, expected_topic: expectedTopic, payload_topic: payloadTopic, topic: t })
      if (expectedTopic === signature) {
        matched = true
        method = 'topic'
        usingSecretIndex = i
        break
      }
    }
    if (matched) break
  }

  return { valid: matched, signature, ts, method, using_secret_index: usingSecretIndex, topics_tried: topicCandidates, request_id: requestId, variants }
}

function normalizeId(value) {
  return String(value || '').trim()
}

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
    })
  } catch (err) {
    console.error('[billing/status]', err)
    return res.status(500).json({ error: 'server_error' })
  }
})

router.get('/subscription', auth, isEstabelecimento, async (req, res) => {
  try {
    const planContext = await getPlanContext(req.user.id)
    const history = await listSubscriptionsForEstabelecimento(req.user.id)

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

    return res.json({
      plan: serializePlanContext(planContext),
      subscription: serializeSubscription(effective),
      history: history.map(serializeSubscription),
    })
  } catch (error) {
    console.error('GET /billing/subscription', error)
    return res.status(500).json({ error: 'subscription_fetch_failed' })
  }
})

router.post('/webhook', async (req, res) => {
  const event = req.body || {}
  // MP pode mandar o id como body.data.id ou como query data.id
  const resourceId = event?.data?.id || req.query?.id || req.query?.['data.id'] || event?.resource || event?.id || null
  if (!resourceId) {
    console.warn('[billing:webhook] evento sem resource id', event)
    return res.status(200).json({ ok: false, reason: 'missing_resource' })
  }

  const verification = verifyWebhookSignature(req, resourceId)
  if (!verification.valid) {
    console.warn('[billing:webhook] assinatura invalida', verification)
    return res.status(401).json({ ok: false, reason: 'invalid_signature' })
  }

  try {
    const topic = String(req.query?.type || req.query?.topic || event?.type || event?.topic || req.headers['x-topic'] || '').toLowerCase()
    if (topic === 'payment') {
      const r = await syncMercadoPagoPayment(resourceId, event)
      console.log('[billing:webhook] payment', resourceId, r?.ok ? 'approved' : 'ignored', { ok: r?.ok })
      return res.status(200).json({ ok: true })
    }

    console.log('[billing:webhook] ignoring topic', topic || 'unknown', 'for resource', resourceId)
  } catch (error) {
    console.error('[billing:webhook] falha ao sincronizar', resourceId, error)
    return res.status(200).json({ ok: false })
  }

  return res.status(200).json({ ok: true })
})

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
      const results = secrets.map((sec, idx) => {
        const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${ts}`
        const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
        const payloadTopic = `id:${id};topic:${topic || ''};ts:${ts}`
        const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
        return { index: idx, request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } }
      })
      return res.status(200).json({ ...base, provided: { id, request_id: requestId, topic, ts }, secrets: results })
    } catch (e) {
      return res.status(200).json({ ...base, error: 'failed_to_compute_signature', detail: e?.message || String(e) })
    }
  }

  return res.status(200).json(base)
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

export default router
