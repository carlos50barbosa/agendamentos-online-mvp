// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { createMercadoPagoCheckout, syncMercadoPagoPreapproval, getPlanInitPoint } from '../lib/billing.js'
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
  const header = req.headers['x-signature']
  if (!header) return { valid: false, reason: 'missing_signature' }

  const parts = String(header)
    .split(',')
    .map((segment) => segment.trim().split('='))
    .filter((pair) => pair.length === 2)

  const data = Object.fromEntries(parts)
  const ts = data.ts || data.time || data.timestamp || ''
  const signature = data.v1 || data.sign || data.signature || ''
  if (!ts || !signature) return { valid: false, reason: 'invalid_signature_header' }

  // Alguns ambientes do MP usam request-id na mensagem, outros usam topic (type)
  const requestId = req.headers['x-request-id'] || ''
  const topic = req.query?.type || req.body?.type || req.headers['x-topic'] || ''

  let matched = false
  let method = 'none'
  let usingSecretIndex = null
  const variants = []

  for (let i = 0; i < secrets.length; i++) {
    const sec = secrets[i]
    const payloadReqId = `id:${resourceId};request-id:${requestId};ts:${ts}`
    const expectedReqId = createHmac('sha256', sec).update(payloadReqId).digest('hex')
    const payloadTopic = `id:${resourceId};topic:${topic};ts:${ts}`
    const expectedTopic = createHmac('sha256', sec).update(payloadTopic).digest('hex')
    const validReq = expectedReqId === signature
    const validTop = expectedTopic === signature
    variants.push({ index: i, expected_request_id: expectedReqId, expected_topic: expectedTopic, payload_request_id: payloadReqId, payload_topic: payloadTopic })
    if (validReq || validTop) {
      matched = true
      method = validReq ? 'request-id' : 'topic'
      usingSecretIndex = i
      break
    }
  }

  return { valid: matched, signature, ts, method, using_secret_index: usingSecretIndex, topic, request_id: requestId, variants }
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
    const subscription = await getLatestSubscriptionForEstabelecimento(req.user.id)
    const history = await listSubscriptionsForEstabelecimento(req.user.id)

    return res.json({
      plan: serializePlanContext(planContext),
      subscription: serializeSubscription(subscription),
      history: history.map(serializeSubscription),
    })
  } catch (error) {
    console.error('GET /billing/subscription', error)
    return res.status(500).json({ error: 'subscription_fetch_failed' })
  }
})

router.post('/webhook', async (req, res) => {
  const event = req.body || {}
  const resourceId = event?.data?.id || req.query?.id || event?.resource || event?.id || null
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
    const result = await syncMercadoPagoPreapproval(resourceId, event)
    // Loga status e status_detail (quando disponível) para facilitar diagnóstico de recusas/cancelamentos
    const preStatus = result?.preapproval?.status || null
    const preDetail = result?.preapproval?.status_detail || null
    const action = event?.action || null
    console.log('[billing:webhook] sincronizado', resourceId, result.planStatus, { preapproval_status: preStatus, preapproval_status_detail: preDetail, action })
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

// Utilitário: sincroniza manualmente uma assinatura a partir do preapproval_id (ex.: retornado no back_url)
router.get('/sync', auth, isEstabelecimento, async (req, res) => {
  try {
    const preapprovalId = String(req.query.preapproval_id || req.query.id || '').trim()
    if (!preapprovalId) return res.status(400).json({ error: 'missing_preapproval_id' })
    const result = await syncMercadoPagoPreapproval(preapprovalId, { action: 'manual_sync' })
    return res.json({ ok: true, plan_status: result.planStatus })
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

export default router

