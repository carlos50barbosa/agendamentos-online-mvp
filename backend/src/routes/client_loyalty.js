import { Router } from 'express'
import { auth, isCliente } from '../middleware/auth.js'
import { pool } from '../lib/db.js'
import { getMercadoPagoPublicKey } from '../lib/mercadopago_subscriptions.js'
import {
  cancelClientLoyaltySubscriptionForClient,
  createClientLoyaltyPixCheckout,
  loadClientLoyaltySubscriptionDetails,
  startClientLoyaltyCardSubscription,
} from '../lib/client_loyalty_billing.js'
import {
  getPreferredClientLoyaltySubscription,
  listClientLoyaltySubscriptionsForClient,
} from '../lib/client_loyalty_subscriptions.js'
import {
  getClientLoyaltyBenefitContext,
  previewClientLoyaltyBenefits,
} from '../lib/client_loyalty_credits.js'

const router = Router()

function handleRouteError(res, error) {
  return res.status(Number(error?.status || 500)).json({
    error: error?.code || 'internal_error',
    message: error?.message || 'Falha ao processar assinatura de fidelidade.',
    details: error?.details || null,
  })
}

function normalizeId(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null
}

function parseServiceIds(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeId).filter(Boolean)
  }
  const raw = String(value || '').trim()
  if (!raw) return []
  return raw.split(',').map((entry) => normalizeId(entry)).filter(Boolean)
}

async function fetchPreviewServices(estabelecimentoId, serviceIds) {
  if (!serviceIds.length) return []
  const placeholders = serviceIds.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT id, nome, preco_centavos, duracao_min
       FROM servicos
      WHERE estabelecimento_id=?
        AND id IN (${placeholders})`,
    [estabelecimentoId, ...serviceIds]
  )
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  return serviceIds
    .map((id) => byId.get(Number(id)))
    .filter(Boolean)
    .map((row) => ({
      id: Number(row.id),
      nome: row.nome || '',
      preco_centavos: Number(row.preco_centavos || 0),
      duracao_min: Number(row.duracao_min || 0),
    }))
}

router.get('/config', auth, isCliente, async (_req, res) => {
  return res.json({
    gateway: 'mercadopago',
    mercadopago: {
      public_key: getMercadoPagoPublicKey(),
    },
  })
})

router.get('/subscription', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.query?.estabelecimento_id || req.query?.establishment_id)
    if (estabelecimentoId) {
      const subscription = await getPreferredClientLoyaltySubscription(req.user.id, estabelecimentoId)
      const details = subscription
        ? await loadClientLoyaltySubscriptionDetails(subscription)
        : null
      return res.json({ subscription: details })
    }

    const subscriptions = await listClientLoyaltySubscriptionsForClient(req.user.id)
    const details = await Promise.all(
      subscriptions.map((subscription) => loadClientLoyaltySubscriptionDetails(subscription))
    )
    return res.json({ subscriptions: details.filter(Boolean) })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.get('/context', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.query?.estabelecimento_id || req.query?.establishment_id)
    if (!estabelecimentoId) {
      return res.status(400).json({ error: 'estabelecimento_required', message: 'Informe o estabelecimento.' })
    }

    const serviceIds = parseServiceIds(req.query?.servico_ids || req.query?.service_ids)
    const context = await getClientLoyaltyBenefitContext({
      clienteId: req.user.id,
      estabelecimentoId,
      appointmentAt: new Date(),
    })
    const preview = serviceIds.length
      ? await previewClientLoyaltyBenefits({
          clienteId: req.user.id,
          estabelecimentoId,
          appointmentAt: new Date(),
          serviceItems: await fetchPreviewServices(estabelecimentoId, serviceIds),
        })
      : null

    return res.json({
      subscription: context.subscription
        ? await loadClientLoyaltySubscriptionDetails(context.subscription, { includeEvents: false })
        : null,
      plan: context.plan,
      credits: context.credits,
      credits_by_service: context.credits_by_service,
      preview,
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.post('/subscribe', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.body?.estabelecimento_id || req.body?.establishment_id)
    const loyaltyPlanId = normalizeId(req.body?.loyalty_plan_id || req.body?.plan_id)
    const paymentMethod = String(req.body?.payment_method || 'pix').trim().toLowerCase()
    if (!estabelecimentoId || !loyaltyPlanId) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Informe estabelecimento_id e loyalty_plan_id.',
      })
    }

    if (paymentMethod === 'credit_card') {
      const result = await startClientLoyaltyCardSubscription({
        clienteId: req.user.id,
        estabelecimentoId,
        loyaltyPlanId,
        cardToken: req.body?.card_token,
        payerEmail: req.body?.payer_email || req.user.email || '',
        paymentMethodId: req.body?.payment_method_id || null,
        issuerId: req.body?.issuer_id || null,
        identificationType: req.body?.identification_type || null,
        identificationNumber: req.body?.identification_number || null,
      })
      return res.status(201).json({
        ok: true,
        method: 'credit_card',
        subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
      })
    }

    const result = await createClientLoyaltyPixCheckout({
      clienteId: req.user.id,
      estabelecimentoId,
      loyaltyPlanId,
    })
    return res.status(201).json({
      ok: true,
      method: 'pix',
      subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
      pix: result.pix,
      payment: {
        id: result.payment?.id || null,
        status: result.payment?.status || null,
      },
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.post('/pay/pix', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.body?.estabelecimento_id || req.body?.establishment_id)
    const loyaltyPlanId = normalizeId(req.body?.loyalty_plan_id || req.body?.plan_id)
    if (!estabelecimentoId || !loyaltyPlanId) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Informe estabelecimento_id e loyalty_plan_id.',
      })
    }

    const result = await createClientLoyaltyPixCheckout({
      clienteId: req.user.id,
      estabelecimentoId,
      loyaltyPlanId,
    })
    return res.status(201).json({
      ok: true,
      subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
      pix: result.pix,
      payment: {
        id: result.payment?.id || null,
        status: result.payment?.status || null,
      },
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.post('/pay/card', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.body?.estabelecimento_id || req.body?.establishment_id)
    const loyaltyPlanId = normalizeId(req.body?.loyalty_plan_id || req.body?.plan_id)
    if (!estabelecimentoId || !loyaltyPlanId || !String(req.body?.card_token || '').trim()) {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Informe estabelecimento_id, loyalty_plan_id e card_token.',
      })
    }

    const result = await startClientLoyaltyCardSubscription({
      clienteId: req.user.id,
      estabelecimentoId,
      loyaltyPlanId,
      cardToken: String(req.body?.card_token || '').trim(),
      payerEmail: req.body?.payer_email || req.user.email || '',
      paymentMethodId: req.body?.payment_method_id || null,
      issuerId: req.body?.issuer_id || null,
      identificationType: req.body?.identification_type || null,
      identificationNumber: req.body?.identification_number || null,
    })
    return res.status(201).json({
      ok: true,
      subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.post('/cancel', auth, isCliente, async (req, res) => {
  try {
    const updated = await cancelClientLoyaltySubscriptionForClient({
      clienteId: req.user.id,
      subscriptionId: normalizeId(req.body?.subscription_id),
      estabelecimentoId: normalizeId(req.body?.estabelecimento_id || req.body?.establishment_id),
    })
    return res.json({
      ok: true,
      subscription: await loadClientLoyaltySubscriptionDetails(updated),
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.get('/history', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.query?.estabelecimento_id || req.query?.establishment_id)
    const subscriptions = estabelecimentoId
      ? [await getPreferredClientLoyaltySubscription(req.user.id, estabelecimentoId)].filter(Boolean)
      : await listClientLoyaltySubscriptionsForClient(req.user.id)
    const details = await Promise.all(
      subscriptions.map((subscription) => loadClientLoyaltySubscriptionDetails(subscription, { includeEvents: true }))
    )
    return res.json({ subscriptions: details.filter(Boolean) })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

export default router
