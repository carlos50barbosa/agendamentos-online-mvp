// backend/src/routes/billing.js
import { Router } from 'express'
import { createHmac } from 'node:crypto'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import { createMercadoPagoCheckout, syncMercadoPagoPreapproval } from '../lib/billing.js'
import { getPlanContext, serializePlanContext } from '../lib/plans.js'
import {
  getLatestSubscriptionForEstabelecimento,
  listSubscriptionsForEstabelecimento,
  serializeSubscription,
} from '../lib/subscriptions.js'
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

export default router

