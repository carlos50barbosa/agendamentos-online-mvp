// backend/src/middleware/billing.js
import { BillingService } from '../lib/billing_service.js'

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

