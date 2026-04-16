import { Router } from 'express'
import { pool } from '../lib/db.js'
import { getPublicLoyaltyPlansForEstablishment } from '../lib/loyalty_plans.js'

const router = Router()

async function resolveEstablishmentByIdOrSlug(idOrSlug) {
  const raw = String(idOrSlug || '').trim()
  if (!raw) return null
  const numericId = Number(raw)
  const sql = Number.isFinite(numericId) && numericId > 0
    ? `SELECT id, nome, slug, avatar_url, cidade, estado
         FROM usuarios
        WHERE id=?
          AND tipo='estabelecimento'
        LIMIT 1`
    : `SELECT id, nome, slug, avatar_url, cidade, estado
         FROM usuarios
        WHERE slug=?
          AND tipo='estabelecimento'
        LIMIT 1`
  const [rows] = await pool.query(sql, [Number.isFinite(numericId) && numericId > 0 ? numericId : raw])
  return rows?.[0] || null
}

router.get('/:idOrSlug/loyalty-plans', async (req, res) => {
  try {
    const estabelecimento = await resolveEstablishmentByIdOrSlug(req.params.idOrSlug)
    if (!estabelecimento) {
      return res.status(404).json({ error: 'estabelecimento_not_found', message: 'Estabelecimento não encontrado.' })
    }

    const plans = await getPublicLoyaltyPlansForEstablishment(estabelecimento.id)
    return res.json({
      estabelecimento: {
        id: Number(estabelecimento.id),
        nome: estabelecimento.nome || '',
        slug: estabelecimento.slug || '',
        avatar_url: estabelecimento.avatar_url || null,
        cidade: estabelecimento.cidade || '',
        estado: estabelecimento.estado || '',
      },
      plans,
    })
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error?.code || 'internal_error',
      message: error?.message || 'Falha ao carregar planos públicos.',
    })
  }
})

export default router
