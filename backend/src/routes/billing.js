// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { createMercadoPagoCheckout, createMercadoPagoPixCheckout, syncMercadoPagoPreapproval, syncMercadoPagoPayment, getPlanInitPoint, updateMercadoPagoPreapprovalStatus } from '../lib/billing.js'
import {
  getPlanContext,
  serializePlanContext,
  PLAN_TIERS,
  isDowngrade,
  isUpgrade,
  resolvePlanConfig,
  countProfessionals,
  formatPlanLimitExceeded,
  normalizeBillingCycle,
} from '../lib/plans.js'
import {
  getLatestSubscriptionForEstabelecimento,
  listSubscriptionsForEstabelecimento,
  serializeSubscription,
} from '../lib/subscriptions.js'
import { pool } from '../lib/db.js'
import { config } from '../lib/config.js'

const router = Router()

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

async function resolveRecurringSubscription(estabelecimentoId, fallbackGatewayId) {
  const history = await listSubscriptionsForEstabelecimento(estabelecimentoId)
  const preferredStatuses = new Set(['active', 'authorized', 'paused', 'past_due'])
  const preferred = history.find((item) => item.gatewaySubscriptionId && preferredStatuses.has(String(item.status || '').toLowerCase()))
  if (preferred) return preferred
  const normalizedFallback = normalizeId(fallbackGatewayId)
  if (normalizedFallback) {
    const match = history.find((item) => normalizeId(item.gatewaySubscriptionId) === normalizedFallback)
    if (match) return match
  }
  return history.find((item) => item.gatewaySubscriptionId) || null
}

router.post('/checkout-session', auth, isEstabelecimento, async (req, res) => {
  try {
    const { plan, billing_cycle: rawCycle, successUrl, failureUrl, pendingUrl } = req.body || {}
    const billingCycle = normalizeBillingCycle(rawCycle)
    const forceNew = /^(1|true|yes)$/i.test(String(req.query?.force || req.body?.force || ''))

    // 1) Trava: se já está ativo e ainda dentro do período, não criar novo checkout
    const ctx = await getPlanContext(req.user.id)
    if (ctx?.status === 'active' && ctx?.activeUntil && new Date(ctx.activeUntil) > new Date()) {
      return res.status(409).json({
        error: 'already_active',
        message: `Assinatura ativa até ${new Date(ctx.activeUntil).toISOString()}`,
        plan: serializePlanContext(ctx),
      })
    }

    // 2) Reuso: se há assinatura pendente com plano criado, reusar o init_point (a menos que forceNew ou reuse desativado)
    const allowReuse = config.billing?.reusePending !== false && !forceNew
    if (allowReuse) {
      const last = await getLatestSubscriptionForEstabelecimento(req.user.id)
      if (last && last.status === 'pending' && last.gatewayPreferenceId) {
        const init = await getPlanInitPoint(last.gatewayPreferenceId)
        if (init) {
          return res.json({
            ok: true,
            init_point: init,
            plan_status: 'pending',
            subscription: serializeSubscription(last),
            reused: true,
          })
        }
      }
    }

    const result = await createMercadoPagoCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan,
      billingCycle,
      successUrl,
      failureUrl,
      pendingUrl,
    })

    req.user.plan_status = result.planStatus
    req.user.plan_subscription_id = result.subscription.gatewaySubscriptionId
    if (result.planStatus === 'active') {
      req.user.plan = result.subscription.plan
    }

    return res.json({
      ok: true,
      init_point: result.initPoint,
      plan_status: result.planStatus,
      subscription: serializeSubscription(result.subscription),
      billing_cycle: billingCycle,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message ||
      'Falha ao criar checkout'
    console.error('POST /billing/checkout-session', detail, cause || error)
    return res.status(400).json({ error: 'checkout_failed', message: detail, cause })
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

    const result = await syncMercadoPagoPreapproval(resourceId, event)
    const preStatus = result?.preapproval?.status || null
    const preDetail = result?.preapproval?.status_detail || null
    const action = event?.action || null
    console.log('[billing:webhook] preapproval', resourceId, result.planStatus, { preapproval_status: preStatus, preapproval_status_detail: preDetail, action })
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

// Callback de sucesso do Mercado Pago (back_url): tenta sincronizar e redireciona ao front
router.get('/callback', async (req, res) => {
  try {
    const preapprovalId = String(req.query.preapproval_id || req.query.id || req.query['data.id'] || '').trim()
    if (preapprovalId) {
      try {
        await syncMercadoPagoPreapproval(preapprovalId, { action: 'callback' })
      } catch (e) {
        console.warn('[billing:callback] sync failed', preapprovalId, e?.message || e)
      }
    }
  } catch (e) {
    console.warn('[billing:callback] error', e)
  }

  // Redireciona para a tela de configurações (ou "next" fornecido)
  const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
  const next = String(req.query.next || '').trim()
  // Sempre sinaliza sucesso e, quando disponível, inclui preapproval_id para o front sincronizar também
  const fallbackUrl = new URL(`${FRONT_BASE}/configuracoes`)
  fallbackUrl.searchParams.set('checkout', 'sucesso')
  const pre = String(req.query.preapproval_id || req.query.id || req.query['data.id'] || '').trim()
  if (pre) fallbackUrl.searchParams.set('preapproval_id', pre)

  let targetUrl
  if (next && /^https:\/\//i.test(next)) {
    try {
      const u = new URL(next)
      if (pre) u.searchParams.set('preapproval_id', pre)
      // Garante o banner de sucesso no front (se ele preservar o parâmetro)
      if (!u.searchParams.has('checkout')) u.searchParams.set('checkout', 'sucesso')
      targetUrl = u.toString()
    } catch {
      targetUrl = fallbackUrl.toString()
    }
  } else {
    targetUrl = fallbackUrl.toString()
  }
  try {
    return res.redirect(302, targetUrl)
  } catch {
    return res.status(302).set('Location', targetUrl).end()
  }
})

// Utilitário: sincroniza manualmente uma assinatura a partir do preapproval_id (ex.: retornado no back_url)
router.get('/sync', auth, isEstabelecimento, async (req, res) => {
  try {
    const preapprovalId = String(req.query.preapproval_id || req.query.id || '').trim()
    if (!preapprovalId) return res.status(400).json({ error: 'missing_preapproval_id' })
    const result = await syncMercadoPagoPreapproval(preapprovalId, { action: 'manual_sync' })
    const det = {
      status: result?.preapproval?.status || null,
      status_detail: result?.preapproval?.status_detail || null,
      reason: result?.preapproval?.reason || null,
      preapproval_id: result?.preapproval?.id || preapprovalId,
    }
    return res.json({ ok: true, plan_status: result.planStatus, preapproval: det })
  } catch (e) {
    console.error('GET /billing/sync', e)
    return res.status(400).json({ error: 'sync_failed', message: e?.message || String(e) })
  }
})

// Alteração de plano (upgrade/downgrade) – permite gerar checkout mesmo com assinatura ativa
router.post('/change', auth, isEstabelecimento, async (req, res) => {
  try {
    const target = String(req.body?.target_plan || req.body?.plan || '').toLowerCase()
    const billingCycle = normalizeBillingCycle(req.body?.billing_cycle)
    const forceNew = /^(1|true|yes)$/i.test(String(req.query?.force || req.body?.force || ''))
    if (!PLAN_TIERS.includes(target)) {
      return res.status(400).json({ error: 'invalid_plan' })
    }
    const ctx = await getPlanContext(req.user.id)
    if (!ctx) return res.status(404).json({ error: 'not_found' })

    const currentPlan = ctx.plan
    if (currentPlan === target) {
      return res.status(409).json({ error: 'same_plan', message: 'Este já é o plano atual.' })
    }

    // Se for downgrade, validar limites antes de permitir
    if (isDowngrade(currentPlan, target)) {
      const targetCfg = resolvePlanConfig(target)
      // Serviços
      const [[svcRow]] = await pool.query('SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?', [req.user.id])
      const totalServices = Number(svcRow?.total || 0)
      if (targetCfg.maxServices !== null && totalServices > targetCfg.maxServices) {
        return res.status(409).json({
          error: 'plan_downgrade_blocked',
          message: formatPlanLimitExceeded(targetCfg, 'services'),
          details: { services: totalServices, limit: targetCfg.maxServices },
        })
      }
      // Profissionais (se existir a tabela)
      const totalProfessionals = await countProfessionals(req.user.id)
      if (targetCfg.maxProfessionals !== null && totalProfessionals > targetCfg.maxProfessionals) {
        return res.status(409).json({
          error: 'plan_downgrade_blocked',
          message: formatPlanLimitExceeded(targetCfg, 'professionals'),
          details: { professionals: totalProfessionals, limit: targetCfg.maxProfessionals },
        })
      }
    }

    // Reusar link pendente para o mesmo destino (a menos que forceNew ou reuse desativado)
    const allowReuse = config.billing?.reusePending !== false && !forceNew
    if (allowReuse) {
      const last = await getLatestSubscriptionForEstabelecimento(req.user.id)
      if (last && last.status === 'pending' && last.plan === target && last.gatewayPreferenceId) {
        const init = await getPlanInitPoint(last.gatewayPreferenceId)
        if (init) {
          return res.json({ ok: true, init_point: init, plan_status: 'pending', subscription: serializeSubscription(last), reused: true })
        }
      }
    }

    const result = await createMercadoPagoCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: target,
      billingCycle,
      deferStartDate: (() => {
        // Opção A: se upgrade com assinatura ativa, agenda primeira cobrança do novo valor para a virada do ciclo atual
        if (isUpgrade(currentPlan, target) && ctx?.status === 'active' && ctx?.activeUntil) {
          const nextAt = new Date(ctx.activeUntil)
          if (!Number.isNaN(nextAt.getTime()) && nextAt > new Date()) return nextAt.toISOString()
        }
        return null
      })(),
    })
    return res.json({
      ok: true,
      init_point: result.initPoint,
      plan_status: result.planStatus,
      subscription: serializeSubscription(result.subscription),
      billing_cycle: billingCycle,
    })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message ||
      'Falha ao alterar plano'
    console.error('POST /billing/change', detail, cause || error)
    return res.status(400).json({ error: 'change_failed', message: detail, cause })
  }
})

// Fallback: cria preferência de PIX para primeiro ciclo
router.post('/pix', auth, isEstabelecimento, async (req, res) => {
  try {
    const { plan, billing_cycle: rawCycle, successUrl, failureUrl, pendingUrl } = req.body || {}
    const billingCycle = normalizeBillingCycle(rawCycle)
    const result = await createMercadoPagoPixCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan,
      billingCycle,
      successUrl,
      failureUrl,
      pendingUrl,
    })
    return res.json({ ok: true, init_point: result.initPoint, plan_status: result.planStatus, subscription: serializeSubscription(result.subscription) })
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

// Configurar recorrência no cartão após ativação por PIX (gera preapproval com início na virada do ciclo atual)
router.post('/recurring/setup', auth, isEstabelecimento, async (req, res) => {
  try {
    const ctx = await getPlanContext(req.user.id)
    if (!ctx) return res.status(404).json({ error: 'not_found' })

    const plan = ctx.plan
    const billingCycle = ctx.cycle
    const deferStartDate = ctx?.activeUntil || null

    // Gera o preapproval mesmo estando ativo (não usar rota /checkout-session que bloqueia already_active)
    const result = await createMercadoPagoCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan,
      billingCycle,
      successUrl: undefined,
      failureUrl: undefined,
      pendingUrl: undefined,
      deferStartDate,
    })

    return res.json({ ok: true, init_point: result.initPoint, plan_status: result.planStatus, subscription: serializeSubscription(result.subscription), billing_cycle: billingCycle })
  } catch (error) {
    const responseData = error?.response?.data
    const cause = error?.cause || responseData || null
    const detail =
      (responseData && (responseData.message || responseData.error || responseData.error_message)) ||
      (Array.isArray(error?.cause) && (error.cause[0]?.description || error.cause[0]?.error)) ||
      error?.message || 'Falha ao configurar recorrencia'
    console.error('POST /billing/recurring/setup', detail, cause || error)
    return res.status(400).json({ error: 'recurring_failed', message: detail, cause })
  }
})

// Pausar recorrência no cartão (preapproval)
router.post('/recurring/pause', auth, isEstabelecimento, async (req, res) => {
  try {
    const sub = await resolveRecurringSubscription(req.user.id, req.user?.plan_subscription_id)
    const preId = normalizeId(sub?.gatewaySubscriptionId || req.user?.plan_subscription_id || null)
    if (!preId) return res.status(409).json({ error: 'no_recurring', message: 'Nenhuma recorrência configurada.' })
    const result = await updateMercadoPagoPreapprovalStatus(preId, 'paused', 'recurring_pause')
    return res.json({ ok: true, status: result?.subscription?.status || null, preapproval: { id: result?.preapproval?.id || preId, status: result?.preapproval?.status || 'paused' } })
  } catch (error) {
    const detail = error?.message || 'Falha ao pausar recorrência'
    console.error('POST /billing/recurring/pause', detail)
    return res.status(400).json({ error: 'recurring_pause_failed', message: detail })
  }
})

// Retomar recorrência
router.post('/recurring/resume', auth, isEstabelecimento, async (req, res) => {
  try {
    const sub = await resolveRecurringSubscription(req.user.id, req.user?.plan_subscription_id)
    const preId = normalizeId(sub?.gatewaySubscriptionId || req.user?.plan_subscription_id || null)
    if (!preId) return res.status(409).json({ error: 'no_recurring', message: 'Nenhuma recorrência configurada.' })
    const result = await updateMercadoPagoPreapprovalStatus(preId, 'authorized', 'recurring_resume')
    return res.json({ ok: true, status: result?.subscription?.status || null, preapproval: { id: result?.preapproval?.id || preId, status: result?.preapproval?.status || 'authorized' } })
  } catch (error) {
    const detail = error?.message || 'Falha ao retomar recorrência'
    console.error('POST /billing/recurring/resume', detail)
    return res.status(400).json({ error: 'recurring_resume_failed', message: detail })
  }
})

// Cancelar recorrência
router.post('/recurring/cancel', auth, isEstabelecimento, async (req, res) => {
  try {
    const sub = await resolveRecurringSubscription(req.user.id, req.user?.plan_subscription_id)
    const preId = normalizeId(sub?.gatewaySubscriptionId || req.user?.plan_subscription_id || null)
    if (!preId) return res.status(409).json({ error: 'no_recurring', message: 'Nenhuma recorrência configurada.' })
    const result = await updateMercadoPagoPreapprovalStatus(preId, 'cancelled', 'recurring_cancel')
    return res.json({ ok: true, status: result?.subscription?.status || null, preapproval: { id: result?.preapproval?.id || preId, status: result?.preapproval?.status || 'cancelled' } })
  } catch (error) {
    const detail = error?.message || 'Falha ao cancelar recorrência'
    console.error('POST /billing/recurring/cancel', detail)
    return res.status(400).json({ error: 'recurring_cancel_failed', message: detail })
  }
})

export default router

