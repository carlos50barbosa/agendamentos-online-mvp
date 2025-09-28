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

const router = Router()

function verifyWebhookSignature(req, resourceId) {
  const secret = config.billing?.mercadopago?.webhookSecret
  if (!secret) return { valid: true }
  const header = req.headers['x-signature']
  const requestId = req.headers['x-request-id'] || ''
  if (!header) return { valid: false, reason: 'missing_signature' }

  const parts = String(header)
    .split(',')
    .map((segment) => segment.trim().split('='))
    .filter((pair) => pair.length === 2)

  const data = Object.fromEntries(parts)
  const ts = data.ts || data.time || data.timestamp || ''
  const signature = data.v1 || data.sign || data.signature || ''

  if (!ts || !signature) return { valid: false, reason: 'invalid_signature_header' }

  const payload = `id:${resourceId};request-id:${requestId};ts:${ts}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const valid = expected === signature
  return { valid, expected, signature, payload }
}

router.post('/checkout-session', auth, isEstabelecimento, async (req, res) => {
  try {
    const { plan, successUrl, failureUrl, pendingUrl } = req.body || {}

    // 1) Trava: se já está ativo e ainda dentro do período, não criar novo checkout
    const ctx = await getPlanContext(req.user.id)
    if (ctx?.status === 'active' && ctx?.activeUntil && new Date(ctx.activeUntil) > new Date()) {
      return res.status(409).json({
        error: 'already_active',
        message: `Assinatura ativa até ${new Date(ctx.activeUntil).toISOString()}`,
        plan: serializePlanContext(ctx),
      })
    }

    // 2) Reuso: se há assinatura pendente com plano criado, reusar o init_point
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

    const result = await createMercadoPagoCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan,
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
  }

  try {
    const result = await syncMercadoPagoPreapproval(resourceId, event)
    console.log('[billing:webhook] sincronizado', resourceId, result.planStatus)
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

    // Reusar link pendente para o mesmo destino
    const last = await getLatestSubscriptionForEstabelecimento(req.user.id)
    if (last && last.status === 'pending' && last.plan === target && last.gatewayPreferenceId) {
      const init = await getPlanInitPoint(last.gatewayPreferenceId)
      if (init) {
        return res.json({ ok: true, init_point: init, plan_status: 'pending', subscription: serializeSubscription(last), reused: true })
      }
    }

    const result = await createMercadoPagoCheckout({
      estabelecimento: { id: req.user.id, email: req.user.email },
      plan: target,
    })
    return res.json({
      ok: true,
      init_point: result.initPoint,
      plan_status: result.planStatus,
      subscription: serializeSubscription(result.subscription),
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

