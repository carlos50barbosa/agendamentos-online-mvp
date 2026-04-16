// backend/src/middleware/billing.js
import { BillingService } from '../lib/billing_service.js'
import { loadEffectiveSubscriptionContext } from '../lib/subscription_state.js'

function toBoolean(value, defaultValue = true) {
  if (value === true || value === false) return value
  if (value == null) return defaultValue
  const lower = String(value || '').trim().toLowerCase()
  if (!lower) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(lower)
}

export function ensureWithinProfessionalLimit({ isActivating } = {}) {
  return async (req, res, next) => {
    try {
      const estabelecimentoId = req.user?.id
      if (!estabelecimentoId) {
        return res.status(401).json({ error: 'unauthorized' })
      }

      const activating = typeof isActivating === 'function'
        ? !!isActivating(req)
        : toBoolean(req.body?.ativo, true)

      if (!activating) return next()

      const plan = await BillingService.getCurrentPlan(estabelecimentoId)
      const max = plan?.maxProfessionals
      if (max == null) return next()

      const total = await BillingService.countActiveProfessionals(estabelecimentoId)
      if (total >= max) {
        return res.status(403).json({
          error: 'professional_limit_reached',
          message: 'Você atingiu o limite de profissionais do seu plano. Faça upgrade para adicionar mais.',
          details: { limit: max, total },
        })
      }

      return next()
    } catch (err) {
      console.error('[billing][ensureWithinProfessionalLimit]', err)
      return res.status(500).json({ error: 'professional_limit_check_failed' })
    }
  }
}

function buildSubscriptionBlockMessage(context, fallbackMessage) {
  if (fallbackMessage) return fallbackMessage
  const status = context?.computedState?.resolvedStatus || 'unpaid'
  if (status === 'pending_pix') {
    return 'Existe um PIX pendente. Conclua ou gere uma nova cobrança para liberar este recurso.'
  }
  if (status === 'pending_payment') {
    return 'Seu cartão ainda não teve a cobrança confirmada. Atualize a forma de pagamento ou aguarde a confirmação.'
  }
  if (status === 'past_due') {
    return 'Sua assinatura está com cobrança pendente. Regularize para evitar bloqueio.'
  }
  if (status === 'expired') {
    return 'Sua assinatura expirou. Gere um novo PIX ou atualize o cartão para continuar.'
  }
  if (status === 'canceled') {
    return 'Sua assinatura foi cancelada. Reative o plano para continuar usando este recurso.'
  }
  return 'Sua assinatura não permite usar este recurso agora. Regularize o pagamento na área de assinatura.'
}

export function ensureSubscriptionOperationalAccess({
  getEstabelecimentoId = (req) => req.user?.id || null,
  message = '',
} = {}) {
  return async (req, res, next) => {
    try {
      const estabelecimentoId = Number(getEstabelecimentoId(req))
      if (!Number.isFinite(estabelecimentoId) || estabelecimentoId <= 0) {
        return res.status(400).json({ error: 'estabelecimento_invalido' })
      }

      const context = await loadEffectiveSubscriptionContext(estabelecimentoId)
      req.subscriptionContext = context

      if (context?.computedState?.coreFeaturesAllowed) {
        return next()
      }

      return res.status(402).json({
        error: 'subscription_access_blocked',
        message: buildSubscriptionBlockMessage(context, message),
        subscription_status: context?.computedState?.resolvedStatus || null,
        access_state: context?.computedState?.accessState || 'blocked',
        state: context?.computedState?.state || 'blocked',
        payment_method: context?.computedState?.paymentMethod || null,
        grace_until: context?.computedState?.graceUntil ? context.computedState.graceUntil.toISOString() : null,
        next_billing_at: context?.computedState?.nextBillingAt ? context.computedState.nextBillingAt.toISOString() : null,
        billing_access_allowed: true,
      })
    } catch (err) {
      console.error('[billing][ensureSubscriptionOperationalAccess]', err)
      return res.status(500).json({ error: 'subscription_access_check_failed' })
    }
  }
}

