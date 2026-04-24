import { Router } from 'express'
import { config } from '../lib/config.js'
import { verifyMercadoPagoWebhookSignature } from '../lib/mp_signature.js'
import { processLoyaltyMercadoPagoSellerWebhook } from '../services/loyaltySubscriptions.js'

const router = Router()

function resolveTopic(req) {
  const event = req.body || {}
  return String(
    req.query?.topic ||
      req.query?.type ||
      event?.topic ||
      event?.type ||
      req.headers['x-topic'] ||
      ''
  ).trim().toLowerCase()
}

router.get('/', (_req, res) => {
  return res.status(200).json({
    ok: true,
    owner_type: 'establishment',
    message: 'mercadopago sellers webhook up',
  })
})

router.head('/', (_req, res) => res.sendStatus(200))

router.post('/', async (req, res) => {
  const topic = resolveTopic(req)
  const verification = verifyMercadoPagoWebhookSignature(req)
  if (!verification.ok && !config.billing?.mercadopago?.allowUnsigned) {
    console.warn('[webhooks/mercadopago/sellers] invalid_signature', {
      request_id: req.requestId || null,
      topic: topic || null,
      reason: verification.reason || 'invalid_signature',
    })
    return res.status(200).json({ ok: true, ignored: true, reason: verification.reason || 'invalid_signature' })
  }

  try {
    const result = await processLoyaltyMercadoPagoSellerWebhook(req, verification)
    console.info('[webhooks/mercadopago/sellers] processed', {
      request_id: req.requestId || null,
      topic: topic || null,
      processed: result.processed === true,
      reason: result.reason || null,
      status: result.status || null,
      owner_type: result.owner?.owner_type || 'establishment',
      owner_id: result.owner?.owner_id || null,
      estabelecimento_id: result.owner?.estabelecimento_id || null,
      mp_user_id: result.owner?.mp_user_id || null,
      subscription_id: result.subscription_id || null,
    })
    return res.status(200).json({
      ok: true,
      processed: result.processed === true,
      reason: result.reason || null,
      status: result.status || null,
      owner: result.owner || null,
    })
  } catch (error) {
    console.error('[webhooks/mercadopago/sellers] failed', {
      request_id: req.requestId || null,
      topic: topic || null,
      message: error?.message || String(error),
    })
    return res.status(200).json({ ok: true, ignored: true, reason: 'internal_error' })
  }
})

export default router
