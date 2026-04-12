import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Api } from '../utils/api.js'
import { getUser } from '../utils/auth.js'

let mercadoPagoSdkPromise = null

function formatCurrencyFromCents(value) {
  return (Number(value || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatDate(value) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusLabel(value) {
  const key = String(value || '').toLowerCase().trim()
  const labels = {
    active: 'Ativo',
    pending_pix: 'PIX pendente',
    pending_payment: 'Aguardando cartao',
    past_due: 'Pagamento falhou',
    unpaid: 'Inadimplente',
    expired: 'Expirado',
    canceled: 'Cancelado',
    trialing: 'Teste',
  }
  return labels[key] || (key || 'Indefinido')
}

async function loadMercadoPagoSdk() {
  if (typeof window === 'undefined') throw new Error('browser_unavailable')
  if (window.MercadoPago) return window.MercadoPago
  if (mercadoPagoSdkPromise) return mercadoPagoSdkPromise

  mercadoPagoSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mercadopago-sdk="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.MercadoPago), { once: true })
      existing.addEventListener('error', () => reject(new Error('sdk_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://sdk.mercadopago.com/js/v2'
    script.async = true
    script.dataset.mercadopagoSdk = 'true'
    script.onload = () => resolve(window.MercadoPago)
    script.onerror = () => reject(new Error('sdk_load_failed'))
    document.head.appendChild(script)
  })

  return mercadoPagoSdkPromise
}

export default function LoyaltyAssinaturaCliente() {
  const user = getUser()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const estabelecimentoId = searchParams.get('estabelecimento') || ''
  const planFromQuery = searchParams.get('plano') || ''
  const cardFormRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState({ type: '', message: '' })
  const [gatewayPublicKey, setGatewayPublicKey] = useState('')
  const [plansBundle, setPlansBundle] = useState({ estabelecimento: null, plans: [] })
  const [currentDetails, setCurrentDetails] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(planFromQuery)
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [pixCheckout, setPixCheckout] = useState(null)
  const [cardState, setCardState] = useState({ loading: false, ready: false, error: '' })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const requests = [Api.clientLoyaltyConfig()]
      if (estabelecimentoId) {
        requests.push(Api.publicLoyaltyPlans(estabelecimentoId))
        requests.push(Api.clientLoyaltySubscription({ estabelecimento_id: estabelecimentoId }))
        requests.push(Api.clientLoyaltyHistory({ estabelecimento_id: estabelecimentoId }))
      } else {
        requests.push(Promise.resolve(null))
        requests.push(Promise.resolve(null))
        requests.push(Api.clientLoyaltyHistory())
      }
      const [configResponse, publicPlansResponse, currentResponse, historyResponse] = await Promise.all(requests)
      setGatewayPublicKey(configResponse?.mercadopago?.public_key || '')
      setPlansBundle({
        estabelecimento: publicPlansResponse?.estabelecimento || null,
        plans: Array.isArray(publicPlansResponse?.plans) ? publicPlansResponse.plans : [],
      })
      setCurrentDetails(currentResponse?.subscription || null)
      setHistory(Array.isArray(historyResponse?.subscriptions) ? historyResponse.subscriptions : [])
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Nao foi possivel carregar a assinatura de fidelidade.',
      })
    } finally {
      setLoading(false)
    }
  }, [estabelecimentoId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!selectedPlanId && plansBundle.plans?.[0]?.id) {
      setSelectedPlanId(String(planFromQuery || plansBundle.plans[0].id))
    }
  }, [planFromQuery, plansBundle.plans, selectedPlanId])

  const selectedPlan = useMemo(
    () => (plansBundle.plans || []).find((plan) => String(plan.id) === String(selectedPlanId)) || null,
    [plansBundle.plans, selectedPlanId]
  )

  const handlePixSubscribe = useCallback(async () => {
    if (!estabelecimentoId || !selectedPlanId) return
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    try {
      const response = await Api.clientLoyaltyPayPix({
        estabelecimento_id: Number(estabelecimentoId),
        loyalty_plan_id: Number(selectedPlanId),
      })
      setPixCheckout(response || null)
      setNotice({ type: 'success', message: 'PIX gerado. Pague para ativar o plano.' })
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Nao foi possivel gerar o PIX.',
      })
    } finally {
      setSubmitting(false)
    }
  }, [estabelecimentoId, loadData, selectedPlanId])

  const handleCancel = useCallback(async () => {
    if (!currentDetails?.subscription?.id) return
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    try {
      await Api.clientLoyaltyCancel({ subscription_id: currentDetails.subscription.id })
      setNotice({ type: 'success', message: 'Renovacao cancelada. Os beneficios pagos ficam ate o fim do ciclo.' })
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Nao foi possivel cancelar a assinatura.',
      })
    } finally {
      setSubmitting(false)
    }
  }, [currentDetails?.subscription?.id, loadData])

  const handleCardSubmit = useCallback(async (cardFormData) => {
    if (!estabelecimentoId || !selectedPlanId || !cardFormData?.token) return false
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    try {
      await Api.clientLoyaltyPayCard({
        estabelecimento_id: Number(estabelecimentoId),
        loyalty_plan_id: Number(selectedPlanId),
        card_token: cardFormData.token,
        payer_email: cardFormData.cardholderEmail || user?.email || '',
      })
      setNotice({ type: 'success', message: 'Assinatura enviada no cartao. A ativacao chega assim que o gateway confirmar o pagamento.' })
      await loadData()
      return true
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Nao foi possivel processar o cartao.',
      })
      return false
    } finally {
      setSubmitting(false)
    }
  }, [estabelecimentoId, loadData, selectedPlanId, user?.email])

  useEffect(() => {
    if (!gatewayPublicKey || paymentMethod !== 'credit_card' || !selectedPlan) {
      setCardState({ loading: false, ready: false, error: '' })
      return undefined
    }

    let cancelled = false
    const mountCardForm = async () => {
      setCardState({ loading: true, ready: false, error: '' })
      try {
        const MercadoPagoCtor = await loadMercadoPagoSdk()
        if (cancelled) return
        try {
          cardFormRef.current?.unmount?.()
        } catch {}
        const mp = new MercadoPagoCtor(gatewayPublicKey, { locale: 'pt-BR' })
        const amount = (Number(selectedPlan.preco_centavos || 0) / 100).toFixed(2)
        const cardForm = mp.cardForm({
          amount,
          iframe: true,
          form: {
            id: 'client-loyalty-card-form',
            cardNumber: { id: 'client-loyalty-card-number', placeholder: 'Numero do cartao' },
            expirationDate: { id: 'client-loyalty-card-expiration', placeholder: 'MM/AA' },
            securityCode: { id: 'client-loyalty-card-cvv', placeholder: 'CVV' },
            cardholderName: { id: 'client-loyalty-card-holder', placeholder: 'Titular do cartao' },
            issuer: { id: 'client-loyalty-card-issuer', placeholder: 'Banco emissor' },
            installments: { id: 'client-loyalty-card-installments', placeholder: 'Parcelas' },
            identificationType: { id: 'client-loyalty-card-doc-type', placeholder: 'Documento' },
            identificationNumber: { id: 'client-loyalty-card-doc-number', placeholder: 'Numero do documento' },
            cardholderEmail: { id: 'client-loyalty-card-email', placeholder: 'E-mail' },
          },
          callbacks: {
            onFormMounted: (error) => {
              if (cancelled) return
              if (error) {
                setCardState({ loading: false, ready: false, error: 'Nao foi possivel montar o formulario do cartao.' })
                return
              }
              setCardState({ loading: false, ready: true, error: '' })
            },
            onSubmit: async (event) => {
              event.preventDefault()
              const data = cardForm.getCardFormData()
              await handleCardSubmit(data)
            },
          },
        })
        cardFormRef.current = cardForm
      } catch {
        if (!cancelled) {
          setCardState({ loading: false, ready: false, error: 'Nao foi possivel carregar o SDK do cartao.' })
        }
      }
    }

    void mountCardForm()
    return () => {
      cancelled = true
      try {
        cardFormRef.current?.unmount?.()
      } catch {}
      cardFormRef.current = null
    }
  }, [gatewayPublicKey, handleCardSubmit, paymentMethod, selectedPlan])

  const activeCredits = currentDetails?.credits || []

  return (
    <div className="page loyalty-page">
      <div className="loyalty-page__hero">
        <div>
          <p className="loyalty-page__eyebrow">Fidelidade do cliente</p>
          <h1 className="loyalty-page__title">
            {plansBundle.estabelecimento?.nome || 'Minha assinatura de fidelidade'}
          </h1>
          <p className="loyalty-page__subtitle">
            Veja status, proximas cobrancas, saldo do ciclo e assine um plano quando estiver dentro de um estabelecimento.
          </p>
        </div>
      </div>

      {notice.message ? <div className={`loyalty-alert loyalty-alert--${notice.type || 'info'}`}>{notice.message}</div> : null}

      {currentDetails ? (
        <section className="card loyalty-card loyalty-current">
          <div className="loyalty-card__header">
            <div>
              <h2>{currentDetails.plan?.nome || 'Plano atual'}</h2>
              <p>{getStatusLabel(currentDetails.subscription?.status)}</p>
            </div>
            <div className="loyalty-current__price">
              {currentDetails.plan ? formatCurrencyFromCents(currentDetails.plan.preco_centavos) : '-'}
            </div>
          </div>

          <div className="loyalty-current__meta">
            <span>Proxima cobranca: {formatDate(currentDetails.subscription?.next_billing_at)}</span>
            <span>Periodo atual: {formatDate(currentDetails.subscription?.current_period_start)} ate {formatDate(currentDetails.subscription?.current_period_end)}</span>
            <span>Pagamento: {currentDetails.subscription?.payment_method || '-'}</span>
          </div>

          <div className="loyalty-grid loyalty-grid--two">
            <div className="loyalty-card loyalty-card--nested">
              <h3>Saldo do ciclo</h3>
              {activeCredits.length ? activeCredits.map((credit) => (
                <div key={credit.id} className="loyalty-credit-row">
                  <span>{credit.servico_nome}</span>
                  <strong>{credit.quantidade_restante}/{credit.quantidade_total}</strong>
                </div>
              )) : <p className="loyalty-empty">Nenhum credito ativo no momento.</p>}
            </div>

            <div className="loyalty-card loyalty-card--nested">
              <h3>Ultimos eventos</h3>
              {(currentDetails.events || []).slice(0, 6).map((event) => (
                <div key={event.id} className="loyalty-event-row">
                  <span>{event.tipo_evento}</span>
                  <strong>{formatDate(event.created_at)}</strong>
                </div>
              ))}
              {!currentDetails.events?.length ? <p className="loyalty-empty">Sem eventos ainda.</p> : null}
            </div>
          </div>

          <div className="loyalty-card__actions">
            <button type="button" className="btn btn--outline" onClick={handleCancel} disabled={submitting}>
              Cancelar renovacao
            </button>
          </div>
        </section>
      ) : null}

      {estabelecimentoId ? (
        <section className="card loyalty-card">
          <div className="loyalty-card__header">
            <div>
              <h2>Assinar plano</h2>
              <p>Escolha um plano e a forma de pagamento.</p>
            </div>
            {plansBundle.estabelecimento?.id ? (
              <Link className="btn btn--outline" to={`/planos-fidelidade/${plansBundle.estabelecimento.id}`}>
                Ver pagina publica
              </Link>
            ) : null}
          </div>

          <div className="loyalty-plan-selector">
            {(plansBundle.plans || []).map((plan) => (
              <button
                type="button"
                key={plan.id}
                className={`loyalty-plan-selector__item${String(plan.id) === String(selectedPlanId) ? ' is-selected' : ''}`}
                onClick={() => setSelectedPlanId(String(plan.id))}
              >
                <strong>{plan.nome}</strong>
                <span>{formatCurrencyFromCents(plan.preco_centavos)}</span>
              </button>
            ))}
          </div>

          {selectedPlan ? (
            <>
              <div className="loyalty-plan-card__items">
                {(selectedPlan.items || []).map((item) => (
                  <div className="loyalty-plan-card__item" key={item.id}>
                    <span>{item.servico?.nome || `Servico #${item.servico_id}`}</span>
                    <strong>{item.quantidade_por_ciclo} por ciclo</strong>
                  </div>
                ))}
              </div>

              <div className="loyalty-payment-methods">
                <button
                  type="button"
                  className={`btn ${paymentMethod === 'pix' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => setPaymentMethod('pix')}
                >
                  PIX
                </button>
                <button
                  type="button"
                  className={`btn ${paymentMethod === 'credit_card' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => setPaymentMethod('credit_card')}
                >
                  Cartao
                </button>
              </div>

              {paymentMethod === 'pix' ? (
                <div className="loyalty-checkout-block">
                  <p>Pagamento manual por ciclo. Ao pagar, o plano ativa e os creditos do mes sao liberados.</p>
                  <button type="button" className="btn btn--primary" onClick={handlePixSubscribe} disabled={submitting}>
                    Gerar PIX
                  </button>
                  {pixCheckout?.pix ? (
                    <div className="loyalty-pix-box">
                      <strong>PIX pendente</strong>
                      <p>Valor: {formatCurrencyFromCents(pixCheckout.pix.amount_cents)}</p>
                      <textarea className="input loyalty-pix-box__code" readOnly value={pixCheckout.pix.copia_e_cola || pixCheckout.pix.qr_code || ''} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="loyalty-checkout-block">
                  <p>Cartao com renovacao automatica mensal.</p>
                  <form id="client-loyalty-card-form" className="loyalty-card-form">
                    <div className="loyalty-card-form__grid">
                      <div id="client-loyalty-card-number" className="input loyalty-card-form__field" />
                      <div id="client-loyalty-card-expiration" className="input loyalty-card-form__field" />
                      <div id="client-loyalty-card-cvv" className="input loyalty-card-form__field" />
                      <input id="client-loyalty-card-holder" className="input loyalty-card-form__field" placeholder="Titular do cartao" />
                      <input id="client-loyalty-card-email" className="input loyalty-card-form__field" type="email" placeholder="E-mail" defaultValue={user?.email || ''} />
                      <select id="client-loyalty-card-doc-type" className="input loyalty-card-form__field" defaultValue="" />
                      <input id="client-loyalty-card-doc-number" className="input loyalty-card-form__field" placeholder="Numero do documento" />
                      <select id="client-loyalty-card-issuer" className="input loyalty-card-form__field" defaultValue="" />
                      <select id="client-loyalty-card-installments" className="input loyalty-card-form__field" defaultValue="" />
                    </div>
                    <button type="submit" className="btn btn--primary" disabled={submitting || !cardState.ready}>
                      {cardState.loading ? 'Carregando...' : 'Assinar no cartao'}
                    </button>
                  </form>
                  {cardState.error ? <p className="loyalty-inline-error">{cardState.error}</p> : null}
                </div>
              )}
            </>
          ) : (
            <p className="loyalty-empty">{loading ? 'Carregando planos...' : 'Nenhum plano disponivel para este estabelecimento.'}</p>
          )}
        </section>
      ) : (
        <section className="card loyalty-card">
          <div className="loyalty-card__header">
            <div>
              <h2>Como assinar um plano</h2>
              <p>Abra a pagina de um estabelecimento ou a tela publica de planos para contratar uma fidelidade.</p>
            </div>
          </div>
          <Link className="btn btn--primary" to="/novo">Explorar estabelecimentos</Link>
        </section>
      )}

      <section className="card loyalty-card">
        <div className="loyalty-card__header">
          <div>
            <h2>Historico</h2>
            <p>{history.length} assinatura(s) encontrada(s)</p>
          </div>
        </div>
        {history.length ? history.map((entry) => (
          <div className="loyalty-history-row" key={entry.subscription?.id || Math.random()}>
            <div>
              <strong>{entry.plan?.nome || 'Plano'}</strong>
              <p>{entry.estabelecimento?.nome || 'Estabelecimento'}</p>
            </div>
            <div className="loyalty-history-row__meta">
              <span>{getStatusLabel(entry.subscription?.status)}</span>
              <span>{formatDate(entry.subscription?.updated_at)}</span>
            </div>
          </div>
        )) : <p className="loyalty-empty">{loading ? 'Carregando...' : 'Nenhuma assinatura registrada.'}</p>}
      </section>
    </div>
  )
}
