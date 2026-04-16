import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Api } from '../utils/api.js'
import { getUser } from '../utils/auth.js'

function formatCurrencyFromCents(value) {
  return (Number(value || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default function LoyaltyPlanosPublicos() {
  const { idOrSlug = '' } = useParams()
  const navigate = useNavigate()
  const user = getUser()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({ estabelecimento: null, plans: [] })

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await Api.publicLoyaltyPlans(idOrSlug)
      setData({
        estabelecimento: response?.estabelecimento || null,
        plans: Array.isArray(response?.plans) ? response.plans : [],
      })
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.message || 'Não foi possível carregar os planos.')
    } finally {
      setLoading(false)
    }
  }, [idOrSlug])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const subscribeLink = useMemo(() => {
    if (!data.estabelecimento?.id) return '/login'
    return `/cliente/fidelidade?estabelecimento=${encodeURIComponent(String(data.estabelecimento.id))}`
  }, [data.estabelecimento?.id])

  const handleSubscribe = useCallback((planId) => {
    if (!data.estabelecimento?.id) return
    const target = `${subscribeLink}&plano=${encodeURIComponent(String(planId))}`
    if (user?.tipo === 'cliente') {
      navigate(target)
      return
    }
    navigate(`/login?next=${encodeURIComponent(target)}`)
  }, [data.estabelecimento?.id, navigate, subscribeLink, user?.tipo])

  return (
    <div className="page loyalty-page">
      <div className="loyalty-page__hero">
        <div>
          <p className="loyalty-page__eyebrow">Planos públicos</p>
          <h1 className="loyalty-page__title">
            {data.estabelecimento?.nome || 'Planos de fidelidade do estabelecimento'}
          </h1>
          <p className="loyalty-page__subtitle">
            Assine um plano mensal, use os serviços incluídos no ciclo e receba desconto nos extras quando o plano oferecer.
          </p>
        </div>
        <div className="loyalty-page__hero-actions">
          <Link className="btn btn--outline" to={data.estabelecimento?.slug ? `/novo/${data.estabelecimento.slug}?estabelecimento=${data.estabelecimento.id}` : '/novo'}>
            Voltar para agendamentos
          </Link>
        </div>
      </div>

      {error ? <div className="loyalty-alert loyalty-alert--error">{error}</div> : null}
      {loading ? <div className="loyalty-empty">Carregando planos...</div> : null}

      <div className="loyalty-grid">
        {(data.plans || []).map((plan) => (
          <article className="card loyalty-card loyalty-plan-card" key={plan.id}>
            <div className="loyalty-plan-card__top">
              <div>
                <span className={`loyalty-status loyalty-status--${plan.status}`}>{plan.status}</span>
                <h2>{plan.nome}</h2>
                <p>{plan.descricao || 'Plano mensal de benefícios recorrentes.'}</p>
              </div>
              <strong>{formatCurrencyFromCents(plan.preco_centavos)}</strong>
            </div>

            <div className="loyalty-plan-card__items">
              {(plan.items || []).map((item) => (
                <div className="loyalty-plan-card__item" key={item.id}>
                  <span>{item.servico?.nome || `Serviço #${item.servico_id}`}</span>
                  <strong>{item.quantidade_por_ciclo} por ciclo</strong>
                </div>
              ))}
            </div>

            <div className="loyalty-plan-card__metrics">
              <span>Periodicidade: mensal</span>
              <span>
                Extras: {plan.desconto_percentual_extras != null ? `${plan.desconto_percentual_extras}% off` : 'sem desconto'}
              </span>
            </div>

            <div className="loyalty-plan-card__actions">
              <button type="button" className="btn btn--primary" onClick={() => handleSubscribe(plan.id)}>
                Assinar plano
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
