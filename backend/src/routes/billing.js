// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac, createHash } from 'node:crypto'
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
  if (config.billing?.mercadopago?.allowUnsigned) {
    return { valid: true, method: 'unsigned-allowed', using_secret_index: null }
  }

  const header = req.headers['x-signature'] || req.headers['x-mercadopago-signature']
  if (!header) return { valid: false, reason: 'missing_signature' }

  const parts = String(header)
    .split(',')
    .map((segment) => segment.trim().split('='))
    .filter((pair) => pair.length === 2)

  const normalizeHeaderVal = (v) => String(v || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  const headerData = Object.fromEntries(parts.map(([k, v]) => [k.trim().toLowerCase(), normalizeHeaderVal(v)]))

  const tsRaw = headerData.ts || headerData.t || headerData.time || headerData.timestamp || ''
  const tsCandidates = []
  const pushTsCandidate = (value) => {
    const normalized = String(value || '').trim()
    if (!normalized) return
    if (!tsCandidates.includes(normalized)) tsCandidates.push(normalized)
  }
  if (tsRaw) {
    pushTsCandidate(tsRaw)
    if (/^\d{13,}$/.test(tsRaw)) {
      try { pushTsCandidate(String(Math.floor(Number(tsRaw) / 1000))) } catch {}
    }
    if (/^\d{10}$/.test(tsRaw)) {
      try { pushTsCandidate(String(Math.floor(Number(tsRaw) * 1000))) } catch {}
    }
  }

  const signatureRaw = headerData.v1 || headerData.sign || headerData.signature || ''
  const signature = String(signatureRaw || '').trim().toLowerCase()
  if (!tsCandidates.length || !signature) return { valid: false, reason: 'invalid_signature_header' }

  const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {}
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : null
  const rawBodyHash = rawBody?.length ? createHash('sha256').update(rawBody).digest('hex') : null

  const collectTopics = () => {
    const rawValues = [
      req.query?.topic,
      req.query?.type,
      req.query?.entity,
      req.query?.action,
      req.headers['x-topic'],
      body?.topic,
      body?.type,
      body?.entity,
      body?.action,
    ]
    const seen = new Set()
    for (const value of rawValues) {
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      if (!trimmed) continue
      seen.add(trimmed)
      seen.add(trimmed.toLowerCase())
      if (trimmed.includes('.')) {
        const base = trimmed.split('.')[0]
        if (base) {
          seen.add(base)
          seen.add(base.toLowerCase())
        }
      }
    }
    return Array.from(seen)
  }

  const topicCandidates = collectTopics()

  const requestIdCandidates = [
    req.headers['x-request-id'],
    req.headers['x-mercadopago-request-id'],
    req.headers['x-idempotency-key'],
    req.query?.['request-id'],
    req.query?.request_id,
    body?.['request-id'],
    body?.request_id,
  ]
  const requestId = requestIdCandidates.map(normalizeId).find(Boolean) || ''

  const candidateIds = new Set()
  const addIdCandidate = (...values) => {
    for (const value of values) {
      const raw = normalizeId(value)
      if (!raw) continue
      candidateIds.add(raw)
      const compact = normalizeResourceCandidate(raw)
      if (compact && compact !== raw) candidateIds.add(compact)
    }
  }
  addIdCandidate(resourceId)
  addIdCandidate(req.query?.['data.id'], req.query?.id)
  addIdCandidate(body?.data?.id, body?.id, body?.resource, body?.resource_id, body?.payment_id)
  addIdCandidate(req.headers['x-resource-id'])
  const idCandidates = Array.from(candidateIds).filter(Boolean)

  const payloadCandidates = []
  const payloadSeen = new Set()
  const registerPayload = (payload, meta) => {
    if (!payload) return
    const key = `str:${payload}`
    if (payloadSeen.has(key)) return
    payloadSeen.add(key)
    payloadCandidates.push({ payload, meta })
  }
  const registerWithSemicolon = (payload, meta) => {
    if (!payload) return
    registerPayload(payload, meta)
    if (!payload.endsWith(';')) registerPayload(`${payload};`, { ...meta, appended_semicolon: true })
  }
  const composeSegments = (segments) => {
    const partsOut = []
    for (const [label, value] of segments) {
      const normalized = normalizeId(value)
      if (!normalized) continue
      partsOut.push(`${label}:${normalized}`)
    }
    return partsOut.join(';')
  }
  const addCandidate = (segments, meta) => {
    const payload = composeSegments(segments)
    if (payload) registerWithSemicolon(payload, meta)
  }

  for (const ts of tsCandidates) {
    for (const id of idCandidates) {
      addCandidate(
        [
          ['id', id],
          ['ts', ts],
        ],
        { strategy: 'id_ts', id, ts }
      )
      addCandidate(
        [
          ['ts', ts],
          ['id', id],
        ],
        { strategy: 'ts_id', id, ts }
      )
      if (requestId) {
        addCandidate(
          [
            ['id', id],
            ['request-id', requestId],
            ['ts', ts],
          ],
          { strategy: 'id_request-id_ts', id, ts, requestId }
        )
        addCandidate(
          [
            ['id', id],
            ['request_id', requestId],
            ['ts', ts],
          ],
          { strategy: 'id_request_id_ts', id, ts, requestId }
        )
        addCandidate(
          [
            ['request-id', requestId],
            ['id', id],
            ['ts', ts],
          ],
          { strategy: 'request-id_id_ts', id, ts, requestId }
        )
        addCandidate(
          [
            ['ts', ts],
            ['id', id],
            ['request-id', requestId],
          ],
          { strategy: 'ts_id_request-id', id, ts, requestId }
        )
      }
      for (const topic of topicCandidates) {
        addCandidate(
          [
            ['id', id],
            ['topic', topic],
            ['ts', ts],
          ],
          { strategy: 'id_topic_ts', id, ts, topic }
        )
        addCandidate(
          [
            ['topic', topic],
            ['id', id],
            ['ts', ts],
          ],
          { strategy: 'topic_id_ts', id, ts, topic }
        )
        addCandidate(
          [
            ['id', id],
            ['type', topic],
            ['ts', ts],
          ],
          { strategy: 'id_type_ts', id, ts, topic }
        )
      }
      if (rawBodyHash) {
        addCandidate(
          [
            ['id', id],
            ['ts', ts],
            ['body', rawBodyHash],
          ],
          { strategy: 'id_ts_bodyhash', id, ts }
        )
        if (requestId) {
          addCandidate(
            [
              ['id', id],
              ['request-id', requestId],
              ['ts', ts],
              ['body', rawBodyHash],
            ],
            { strategy: 'id_request_bodyhash', id, ts, requestId }
          )
        }
      }
    }

    if (requestId) {
      addCandidate(
        [
          ['id', requestId],
          ['ts', ts],
        ],
        { strategy: 'request-id_ts', requestId, ts }
      )
      addCandidate(
        [
          ['ts', ts],
          ['id', requestId],
        ],
        { strategy: 'ts_request-id', requestId, ts }
      )
      addCandidate(
        [
          ['request-id', requestId],
          ['ts', ts],
        ],
        { strategy: 'request-id_only', requestId, ts }
      )
    }
  }

  if (!payloadCandidates.length) {
    return { valid: false, reason: 'no_payload_candidates', signature, ts: tsRaw, request_id: requestId, topics_tried: topicCandidates }
  }

  const variants = []
  let matched = null

  for (let index = 0; index < secrets.length; index++) {
    const secret = secrets[index]
    for (const candidate of payloadCandidates) {
      const digest = createHmac('sha256', secret).update(candidate.payload).digest('hex')
      if (variants.length < 60) {
        variants.push({
          index,
          payload: candidate.payload,
          digest,
          meta: candidate.meta,
        })
      }
      if (digest === signature) {
        matched = { index, candidate, digest }
        break
      }
    }
    if (matched) break
  }

  if (matched) {
    return {
      valid: true,
      method: matched.candidate?.meta?.strategy || 'matched',
      using_secret_index: matched.index,
      ts: tsRaw,
      ts_used: matched.candidate?.meta?.ts || tsRaw,
      signature,
      request_id: requestId,
      topics_tried: topicCandidates,
      raw_body_len: rawBody?.length || 0,
      matched_payload: matched.candidate.payload,
      variants,
    }
  }

  return {
    valid: false,
    reason: 'signature_mismatch',
    signature,
    ts: tsRaw,
    ts_candidates_tried: tsCandidates,
    request_id: requestId,
    topics_tried: topicCandidates,
    raw_body_len: rawBody?.length || 0,
    variants,
  }
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
      const tsCandidates = [ts]
      if (/^\d{13,}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) / 1000)))
      if (/^\d{10}$/.test(ts)) tsCandidates.push(String(Math.floor(Number(ts) * 1000)))

      const results = secrets.map((sec, idx) => {
        const primary = (() => {
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${ts}`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${ts}`
          const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
          return { request_id_variant: { payload: payloadReqId, expected: expectedReqId }, topic_variant: { payload: payloadTopic, expected: expectedTopic } }
        })()

        const alternatives = []
        for (const alt of tsCandidates) {
          if (alt === ts) continue
          const payloadReqId = `id:${id};request-id:${requestId || ''};ts:${alt}`
          const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
          const payloadTopic = `id:${id};topic:${topic || ''};ts:${alt}`
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

