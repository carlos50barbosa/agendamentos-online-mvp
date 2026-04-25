import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { auth, isCliente } from '../middleware/auth.js'
import { pool } from '../lib/db.js'
import { toMercadoPagoCardFlowError } from '../lib/mercadopago_card_tokens.js'
import {
  cancelClientLoyaltySubscriptionForClient,
  createClientLoyaltyPixCheckout,
  loadClientLoyaltySubscriptionDetails,
  startClientLoyaltyCardSubscription,
} from '../services/loyaltySubscriptions.js'
import { getMpAccountByEstabelecimentoId, getMpPublicKey, summarizeMpAccount } from '../services/mpAccounts.js'
import {
  getPreferredClientLoyaltySubscription,
  listClientLoyaltySubscriptionsForClient,
} from '../lib/client_loyalty_subscriptions.js'
import {
  getClientLoyaltyBenefitContext,
  previewClientLoyaltyBenefits,
} from '../lib/client_loyalty_credits.js'

const router = Router()

function createInternalRequestId(req) {
  return String(req.requestId || req.headers['x-request-id'] || '').trim() || randomUUID()
}

function handleRouteError(res, error, requestId = null) {
  const normalized = toMercadoPagoCardFlowError(error) || error
  console.error('[client-loyalty] route_failed', {
    request_id: requestId || null,
    error: normalized?.code || 'internal_error',
    message: normalized?.message || 'Falha ao processar assinatura de fidelidade.',
    details: normalized?.details || null,
  })
  return res.status(Number(normalized?.status || 500)).json({
    error: normalized?.code || 'internal_error',
    message: normalized?.message || 'Falha ao processar assinatura de fidelidade.',
    details: normalized?.details || null,
    request_id: requestId || null,
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

function getDetailsClienteId(details) {
  return normalizeId(
    details?.subscription?.cliente_id ||
    details?.subscription?.clienteId
  )
}

function getDetailsEstabelecimentoId(details) {
  return normalizeId(
    details?.subscription?.estabelecimento_id ||
    details?.subscription?.estabelecimentoId
  )
}

export function filterClientLoyaltyDetailsForAuthenticatedClient(detailsList = [], {
  clienteId = null,
  estabelecimentoId = null,
} = {}) {
  const safeClienteId = normalizeId(clienteId)
  const safeEstabelecimentoId = normalizeId(estabelecimentoId)

  return (Array.isArray(detailsList) ? detailsList : [detailsList])
    .filter(Boolean)
    .filter((details) => (
      !safeClienteId ||
      getDetailsClienteId(details) === safeClienteId
    ))
    .filter((details) => (
      !safeEstabelecimentoId ||
      getDetailsEstabelecimentoId(details) === safeEstabelecimentoId
    ))
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

router.get('/config', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.query?.estabelecimento_id || req.query?.establishment_id)
    const account = estabelecimentoId ? await getMpAccountByEstabelecimentoId(estabelecimentoId) : null
    const publicKey = estabelecimentoId
      ? await getMpPublicKey(estabelecimentoId, { fallbackToApp: true })
      : await getMpPublicKey(null, { fallbackToApp: true })
    const accountSummary = summarizeMpAccount(account)

    return res.json({
      gateway: 'mercadopago',
      mercadopago: {
        public_key: publicKey || null,
        owner_type: 'establishment',
        account: {
          ...accountSummary,
          estabelecimento_id: estabelecimentoId || accountSummary?.estabelecimento_id || null,
        },
        credentials: {
          owner_type: 'establishment',
          token_source: 'seller_oauth',
          connected: accountSummary.connected === true,
          status: accountSummary.status || 'disconnected',
          public_key_source: account?.public_key ? 'seller_account' : 'application',
        },
      },
    })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.get('/subscription', auth, isCliente, async (req, res) => {
  try {
    const estabelecimentoId = normalizeId(req.query?.estabelecimento_id || req.query?.establishment_id)
    if (estabelecimentoId) {
      const subscription = await getPreferredClientLoyaltySubscription(req.user.id, estabelecimentoId)
      const details = filterClientLoyaltyDetailsForAuthenticatedClient(
        [subscription ? await loadClientLoyaltySubscriptionDetails(subscription) : null],
        {
          clienteId: req.user.id,
          estabelecimentoId,
        }
      )[0] || null
      return res.json({ subscription: details })
    }

    const subscriptions = await listClientLoyaltySubscriptionsForClient(req.user.id)
    const details = filterClientLoyaltyDetailsForAuthenticatedClient(await Promise.all(
      subscriptions.map((subscription) => loadClientLoyaltySubscriptionDetails(subscription))
    ), {
      clienteId: req.user.id,
    })
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
      subscription: filterClientLoyaltyDetailsForAuthenticatedClient(
        [
          context.subscription
            ? await loadClientLoyaltySubscriptionDetails(context.subscription, { includeEvents: false })
            : null,
        ],
        {
          clienteId: req.user.id,
          estabelecimentoId,
        }
      )[0] || null,
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
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
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
        cardToken: String(req.body?.card_token || '').trim(),
        payerEmail: req.body?.payer_email || req.user.email || '',
        paymentMethodId: req.body?.payment_method_id || null,
        issuerId: req.body?.issuer_id || null,
        identificationType: req.body?.identification_type || null,
        identificationNumber: req.body?.identification_number || null,
        requestContext: {
          requestId,
          route: '/client-loyalty/subscribe',
          operation: 'client_loyalty_card_subscription_create',
        },
      })
      return res.status(201).json({
        ok: true,
        method: 'credit_card',
        subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
        request_id: requestId,
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
      request_id: requestId,
    })
  } catch (error) {
    return handleRouteError(res, error, requestId)
  }
})

router.post('/pay/pix', auth, isCliente, async (req, res) => {
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
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
      request_id: requestId,
    })
  } catch (error) {
    return handleRouteError(res, error, requestId)
  }
})

router.post('/pay/card', auth, isCliente, async (req, res) => {
  const requestId = createInternalRequestId(req)
  res.set('X-Request-Id', requestId)
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
      requestContext: {
        requestId,
        route: '/client-loyalty/pay/card',
        operation: 'client_loyalty_card_subscription_create',
      },
    })
    return res.status(201).json({
      ok: true,
      subscription: await loadClientLoyaltySubscriptionDetails(result.subscription),
      request_id: requestId,
    })
  } catch (error) {
    return handleRouteError(res, error, requestId)
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
    const details = filterClientLoyaltyDetailsForAuthenticatedClient(await Promise.all(
      subscriptions.map((subscription) => loadClientLoyaltySubscriptionDetails(subscription, { includeEvents: true }))
    ), {
      clienteId: req.user.id,
      estabelecimentoId,
    })
    return res.json({ subscriptions: details.filter(Boolean) })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

export default router
