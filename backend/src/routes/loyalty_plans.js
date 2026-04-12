import { Router } from 'express'
import { auth, isEstabelecimento } from '../middleware/auth.js'
import {
  archiveLoyaltyPlan,
  createLoyaltyPlan,
  getLoyaltyPlanForEstablishment,
  listLoyaltyPlansForEstablishment,
  listLoyaltySubscribersForEstablishment,
  updateLoyaltyPlan,
  updateLoyaltyPlanStatus,
} from '../lib/loyalty_plans.js'

const router = Router()

function handleRouteError(res, error) {
  const status = Number(error?.status || 500)
  return res.status(status).json({
    error: error?.code || 'internal_error',
    message: error?.message || 'Falha ao processar plano de fidelidade.',
    details: error?.details || null,
  })
}

router.get('/plans', auth, isEstabelecimento, async (req, res) => {
  try {
    const includeArchived = ['1', 'true', 'yes'].includes(String(req.query?.include_archived || '').toLowerCase())
    const plans = await listLoyaltyPlansForEstablishment(req.user.id, { includeArchived })
    return res.json({ plans })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.get('/plans/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = await getLoyaltyPlanForEstablishment(req.user.id, Number(req.params.id))
    if (!plan) {
      return res.status(404).json({ error: 'loyalty_plan_not_found', message: 'Plano nao encontrado.' })
    }
    return res.json({ plan })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.post('/plans', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = await createLoyaltyPlan(req.user.id, req.body || {})
    return res.status(201).json({ ok: true, plan })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.put('/plans/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = await updateLoyaltyPlan(req.user.id, Number(req.params.id), req.body || {})
    return res.json({ ok: true, plan })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.patch('/plans/:id/status', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = await updateLoyaltyPlanStatus(req.user.id, Number(req.params.id), req.body?.status)
    return res.json({ ok: true, plan })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.delete('/plans/:id', auth, isEstabelecimento, async (req, res) => {
  try {
    const plan = await archiveLoyaltyPlan(req.user.id, Number(req.params.id))
    return res.json({ ok: true, plan })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

router.get('/subscribers', auth, isEstabelecimento, async (req, res) => {
  try {
    const subscribers = await listLoyaltySubscribersForEstablishment(req.user.id, {
      status: String(req.query?.status || '').trim().toLowerCase(),
    })
    return res.json({ subscribers })
  } catch (error) {
    return handleRouteError(res, error)
  }
})

export default router
