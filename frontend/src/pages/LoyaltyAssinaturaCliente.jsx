import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Api } from '../utils/api.js'
import { getUser } from '../utils/auth.js'
import {
  resolveLoyaltyFailureDisplay,
  resolveLoyaltyPaymentStateDisplay,
  resolveLoyaltyRetryDisplay,
} from '../utils/loyaltyFailure.js'
import { getMercadoPagoCardErrorMessage, isMercadoPagoCardTokenRefreshRequired } from '../utils/mercadoPagoCard.js'
import {
  buildLoyaltyRiskContext,
  buildLoyaltyCardPaymentPayload,
  getLoyaltyCardholderNameDebugInfo,
  LOYALTY_CARDHOLDER_NAME_FIELD,
  resolveLoyaltyCardholderName,
  validateLoyaltyCardPayerData,
} from '../utils/loyaltyPaymentValidation.js'

let mercadoPagoSdkPromise = null
let mercadoPagoSecurityPromise = null

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

function formatCooldown(value) {
  const totalMinutes = Math.max(1, Math.ceil((Number(value || 0) || 0) / 60000))
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes ? `${hours}h ${minutes}min` : `${hours}h`
  }
  return `${totalMinutes} min`
}

function getStatusLabel(value) {
  const key = String(value || '').toLowerCase().trim()
  const labels = {
    active: 'Ativo',
    pending_pix: 'PIX pendente',
    pending_payment: 'Aguardando primeira cobrança',
    past_due: 'Pagamento falhou',
    unpaid: 'Inadimplente',
    expired: 'Expirado',
    canceled: 'Cancelado',
    trialing: 'Teste',
  }
  return labels[key] || (key || 'Indefinido')
}

function getFailureFriendlyMessage(failure) {
  const detail = String(failure?.status_detail || '').toLowerCase().trim()
  const messages = {
    cc_rejected_bad_filled_card_number: 'Número do cartão inválido.',
    cc_rejected_bad_filled_date: 'Data de validade inválida.',
    cc_rejected_bad_filled_other: 'Dados do cartão inválidos.',
    cc_rejected_bad_filled_security_code: 'Código de segurança inválido.',
    cc_rejected_blacklist: 'Pagamento recusado por regra de segurança do gateway.',
    cc_rejected_call_for_authorize: 'O banco não autorizou a compra. Entre em contato com o banco ou use outro cartão.',
    cc_rejected_card_disabled: 'Este cartão está desabilitado. Entre em contato com o banco.',
    cc_rejected_card_error: 'Não foi possível processar o cartão. Tente novamente ou use outro cartão.',
    cc_rejected_duplicated_payment: 'O gateway identificou uma tentativa de pagamento duplicada.',
    cc_rejected_high_risk: 'Pagamento recusado por análise de risco do Mercado Pago. Tente outro cartão ou outro comprador.',
    cc_rejected_insufficient_amount: 'Cartão sem limite ou saldo suficiente para esta cobrança.',
    cc_rejected_invalid_installments: 'Configuração de parcelas inválida para este cartão.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Aguarde um pouco antes de tentar novamente.',
    cc_rejected_other_reason: 'O banco emissor recusou o pagamento.',
  }
  return messages[detail] || ''
}

function getInputValueById(id) {
  if (typeof document === 'undefined') return ''
  const element = document.getElementById(id)
  return typeof element?.value === 'string' ? element.value : ''
}

function formatFailureDetail(failure) {
  if (!failure) return ''
  const parts = [
    failure.description || null,
    failure.message || null,
  ].filter(Boolean)
  return parts.join(' | ')
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

async function loadMercadoPagoSecurityScript() {
  if (typeof window === 'undefined') return null
  if (window.MP_DEVICE_SESSION_ID) return window.MP_DEVICE_SESSION_ID
  if (mercadoPagoSecurityPromise) return mercadoPagoSecurityPromise

  mercadoPagoSecurityPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-mercadopago-security="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.MP_DEVICE_SESSION_ID || null), { once: true })
      existing.addEventListener('error', () => resolve(null), { once: true })
      setTimeout(() => resolve(window.MP_DEVICE_SESSION_ID || null), 2500)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://www.mercadopago.com/v2/security.js'
    script.async = true
    script.dataset.mercadopagoSecurity = 'true'
    script.setAttribute('view', 'checkout')
    script.onload = () => resolve(window.MP_DEVICE_SESSION_ID || null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })

  return mercadoPagoSecurityPromise
}

export default function LoyaltyAssinaturaCliente() {
  const user = getUser()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const estabelecimentoId = searchParams.get('estabelecimento') || ''
  const planFromQuery = searchParams.get('plano') || ''
  const cardFormRef = useRef(null)
  const cardSubmittingRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState({ type: '', message: '' })
  const [gatewayPublicKey, setGatewayPublicKey] = useState('')
  const [gatewayAccount, setGatewayAccount] = useState(null)
  const [plansBundle, setPlansBundle] = useState({ estabelecimento: null, plans: [] })
  const [currentDetails, setCurrentDetails] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(planFromQuery)
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [fallbackIntent, setFallbackIntent] = useState(null)
  const [pixCheckout, setPixCheckout] = useState(null)
  const [cardFormResetKey, setCardFormResetKey] = useState(0)
  const [cardState, setCardState] = useState({ loading: false, ready: false, error: '' })
  const currentStatus = String(currentDetails?.subscription?.status || '').toLowerCase().trim()
  const sellerConnected = gatewayAccount?.connected === true || gatewayAccount?.status === 'connected'
  const isCardPendingActivation = currentStatus === 'pending_payment' && String(currentDetails?.subscription?.payment_method || '').toLowerCase() === 'credit_card'
  const failureDisplay = resolveLoyaltyFailureDisplay(currentDetails)
  const paymentStateDisplay = resolveLoyaltyPaymentStateDisplay(currentDetails)
  const retryDisplay = resolveLoyaltyRetryDisplay(currentDetails)
  const latestFailure = failureDisplay.raw || null
  const latestPaymentSnapshot = currentDetails?.latest_payment_snapshot || currentDetails?.subscription?.latest_payment_snapshot || null
  const cardRetryBlocked = retryDisplay.cardCooldownActive || retryDisplay.cardEnabled === false

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const requests = [Api.clientLoyaltyConfig(estabelecimentoId ? { estabelecimento_id: estabelecimentoId } : {})]
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
      setGatewayAccount(configResponse?.mercadopago?.account || null)
      setPlansBundle({
        estabelecimento: publicPlansResponse?.estabelecimento || null,
        plans: Array.isArray(publicPlansResponse?.plans) ? publicPlansResponse.plans : [],
      })
      setCurrentDetails(currentResponse?.subscription || null)
      setHistory(Array.isArray(historyResponse?.subscriptions) ? historyResponse.subscriptions : [])
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível carregar a assinatura de fidelidade.',
      })
    } finally {
      setLoading(false)
    }
  }, [estabelecimentoId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!estabelecimentoId || !sellerConnected) return undefined
    void loadMercadoPagoSecurityScript()
    return undefined
  }, [estabelecimentoId, sellerConnected])

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
    if (!sellerConnected) {
      setNotice({ type: 'error', message: 'Este estabelecimento ainda não conectou uma conta Mercado Pago.' })
      return
    }
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    try {
      const recoveryFallback = fallbackIntent || (
        failureDisplay.technicalCode === 'cc_rejected_high_risk'
          ? {
              reason: 'card_high_risk',
              source: 'card_decline_recovery',
              previous_failure_code: failureDisplay.technicalCode,
              previous_subscription_id: currentDetails?.subscription?.id || null,
            }
          : null
      )
      const response = await Api.clientLoyaltyPayPix({
        estabelecimento_id: Number(estabelecimentoId),
        loyalty_plan_id: Number(selectedPlanId),
        fallback_reason: recoveryFallback?.reason || null,
        fallback_source: recoveryFallback?.source || null,
        previous_failure_code: recoveryFallback?.previous_failure_code || null,
        previous_subscription_id: recoveryFallback?.previous_subscription_id || null,
      })
      setPixCheckout(response || null)
      setFallbackIntent(null)
      setNotice({ type: 'success', message: 'PIX gerado. Pague para ativar o plano.' })
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível gerar o PIX.',
      })
    } finally {
      setSubmitting(false)
    }
  }, [
    currentDetails?.subscription?.id,
    estabelecimentoId,
    failureDisplay.technicalCode,
    fallbackIntent,
    loadData,
    selectedPlanId,
    sellerConnected,
  ])

  const handleCancel = useCallback(async () => {
    if (!currentDetails?.subscription?.id) return
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    try {
      await Api.clientLoyaltyCancel({ subscription_id: currentDetails.subscription.id })
      setNotice({ type: 'success', message: 'Renovação cancelada. Os benefícios pagos ficam até o fim do ciclo.' })
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível cancelar a assinatura.',
      })
    } finally {
      setSubmitting(false)
    }
  }, [currentDetails?.subscription?.id, loadData])

  const resetCardFormForNewToken = useCallback(() => {
    try {
      cardFormRef.current?.unmount?.()
    } catch {}
    cardFormRef.current = null
    cardSubmittingRef.current = false
    setCardFormResetKey((current) => current + 1)
    setCardState((current) => ({
      ...current,
      loading: true,
      ready: false,
    }))
  }, [])

  const handleCardSubmit = useCallback(async (cardFormData) => {
    if (!estabelecimentoId || !selectedPlanId || !cardFormData?.token || cardSubmittingRef.current) return false
    if (!sellerConnected) {
      setNotice({ type: 'error', message: 'Conta Mercado Pago desconectada ou sem permissao valida.' })
      return false
    }
    const cardholderInputValue = getInputValueById('client-loyalty-card-holder')
    const cardholderNameInput = resolveLoyaltyCardholderName({
      [LOYALTY_CARDHOLDER_NAME_FIELD]: cardFormData?.cardholder_name,
      cardholderName: cardFormData?.cardholderName || cardholderInputValue,
      payer_name: cardFormData?.payer_name,
      payerName: cardFormData?.payerName,
      holder_name: cardFormData?.holder_name,
      holderName: cardFormData?.holderName,
      name: cardFormData?.name,
    })
    console.info('[loyalty][card-validation] cardholder_name_check', {
      ...getLoyaltyCardholderNameDebugInfo(cardholderNameInput),
      payload_field: LOYALTY_CARDHOLDER_NAME_FIELD,
      validation_field: LOYALTY_CARDHOLDER_NAME_FIELD,
      stage: 'frontend_submit',
    })
    const payerValidation = validateLoyaltyCardPayerData({
      payerEmail: cardFormData.cardholderEmail || user?.email || '',
      [LOYALTY_CARDHOLDER_NAME_FIELD]: cardholderNameInput.normalized,
      identificationType: cardFormData.identificationType || '',
      identificationNumber: cardFormData.identificationNumber || '',
      payerPhone: user?.telefone || user?.phone || '',
    })
    if (!payerValidation.valid) {
      const message = payerValidation.message || 'Confira os dados do titular do cartão antes de continuar.'
      setCardState((current) => ({ ...current, error: message }))
      setNotice({ type: 'error', message })
      return false
    }

    cardSubmittingRef.current = true
    setSubmitting(true)
    setNotice({ type: '', message: '' })
    setCardState((current) => ({ ...current, error: '' }))
    try {
      const riskContext = buildLoyaltyRiskContext({
        payment_method: 'credit_card',
        retry_recovery_visible: retryDisplay.showRecovery,
        card_cooldown_active: retryDisplay.cardCooldownActive,
      })
      await Api.clientLoyaltyPayCard(buildLoyaltyCardPaymentPayload({
        estabelecimentoId,
        loyaltyPlanId: selectedPlanId,
        cardFormData,
        payerValidation,
        user,
        riskContext,
      }))
      setCardState((current) => ({ ...current, error: '' }))
      setNotice({ type: 'success', message: 'Cartão validado. A primeira cobrança será confirmada pelo Mercado Pago. Esse processo pode levar até cerca de 1 hora.' })
      await loadData()
      return true
    } catch (error) {
      const message = getMercadoPagoCardErrorMessage(error, 'Não foi possível processar o cartão.')
      if (isMercadoPagoCardTokenRefreshRequired(error)) {
        resetCardFormForNewToken()
      }
      setCardState((current) => ({ ...current, error: message }))
      setNotice({
        type: 'error',
        message,
      })
      return false
    } finally {
      cardSubmittingRef.current = false
      setSubmitting(false)
    }
  }, [
    estabelecimentoId,
    loadData,
    resetCardFormForNewToken,
    retryDisplay.cardCooldownActive,
    retryDisplay.showRecovery,
    selectedPlanId,
    sellerConnected,
    user?.email,
    user?.phone,
    user?.telefone,
  ])

  useEffect(() => {
    if (!gatewayPublicKey || !sellerConnected || paymentMethod !== 'credit_card' || !selectedPlan) {
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
            cardNumber: { id: 'client-loyalty-card-number', placeholder: 'Número do cartão' },
            expirationDate: { id: 'client-loyalty-card-expiration', placeholder: 'MM/AA' },
            securityCode: { id: 'client-loyalty-card-cvv', placeholder: 'CVV' },
            cardholderName: { id: 'client-loyalty-card-holder', placeholder: 'Titular do cartão' },
            issuer: { id: 'client-loyalty-card-issuer', placeholder: 'Banco emissor' },
            installments: { id: 'client-loyalty-card-installments', placeholder: 'Parcelas' },
            identificationType: { id: 'client-loyalty-card-doc-type', placeholder: 'Documento' },
            identificationNumber: { id: 'client-loyalty-card-doc-number', placeholder: 'Número do documento' },
            cardholderEmail: { id: 'client-loyalty-card-email', placeholder: 'E-mail' },
          },
          callbacks: {
            onFormMounted: (error) => {
              if (cancelled) return
              if (error) {
                setCardState({ loading: false, ready: false, error: 'Não foi possível montar o formulário do cartão.' })
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
          setCardState({ loading: false, ready: false, error: 'Não foi possível carregar o SDK do cartão.' })
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
  }, [cardFormResetKey, gatewayPublicKey, handleCardSubmit, paymentMethod, selectedPlan, sellerConnected])

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
            Veja status, próximas cobranças, saldo do ciclo e assine um plano quando estiver dentro de um estabelecimento.
          </p>
        </div>
      </div>

      {notice.message ? <div className={`loyalty-alert loyalty-alert--${notice.type || 'info'}`}>{notice.message}</div> : null}

      {!sellerConnected && estabelecimentoId ? (
        <div className="loyalty-alert loyalty-alert--warn">
          Este estabelecimento ainda não conectou uma conta Mercado Pago. A fidelidade mensal não pode ser contratada no momento.
        </div>
      ) : null}

      {currentDetails ? (
        <section className="card loyalty-card loyalty-current">
          <div className="loyalty-card__header">
            <div>
              <h2>{currentDetails.plan?.nome || 'Plano atual'}</h2>
              <p>{paymentStateDisplay.statusLabel || getStatusLabel(currentDetails.subscription?.status)}{currentStatus ? ` (${currentStatus})` : ''}</p>
            </div>
            <div className="loyalty-current__price">
              {currentDetails.plan ? formatCurrencyFromCents(currentDetails.plan.preco_centavos) : '-'}
            </div>
          </div>

          <div className="loyalty-current__meta">
            <span>
              {isCardPendingActivation
                ? 'Primeira cobrança: aguardando confirmação do Mercado Pago (pode levar até cerca de 1 hora)'
                : `Próxima cobrança: ${formatDate(currentDetails.subscription?.next_billing_at)}`}
            </span>
            <span>
              {currentDetails.subscription?.current_period_start && currentDetails.subscription?.current_period_end
                ? `Período atual: ${formatDate(currentDetails.subscription?.current_period_start)} até ${formatDate(currentDetails.subscription?.current_period_end)}`
                : 'Período atual: será liberado após a primeira cobrança'}
            </span>
            <span>Pagamento: {currentDetails.subscription?.payment_method || '-'}</span>
          </div>

          {paymentStateDisplay.show && !failureDisplay.technicalCode ? (
            <div className="loyalty-payment-state-box">
              <strong>{paymentStateDisplay.title}</strong>
              {paymentStateDisplay.description ? <span>{paymentStateDisplay.description}</span> : null}
              {latestPaymentSnapshot?.status ? <span>Último status do payment: {latestPaymentSnapshot.status}</span> : null}
              {latestPaymentSnapshot?.status_detail ? <span>Último status_detail do payment: {latestPaymentSnapshot.status_detail}</span> : null}
            </div>
          ) : null}

          {failureDisplay.technicalCode ? (
            <div className="loyalty-failure-box">
              <strong>Cobrança pendente de regularização</strong>
              <span>Status da assinatura: {currentDetails?.subscription_status || currentStatus || '-'}</span>
              <span>Última falha técnica: {failureDisplay.technicalCode}</span>
              {failureDisplay.technicalMessage ? <span>{failureDisplay.technicalMessage}</span> : null}
              {failureDisplay.occurredAt ? <span>Última tentativa registrada em: {formatDate(failureDisplay.occurredAt)}</span> : null}
              {latestFailure?.payment_method_id ? <span>Método da última tentativa: {latestFailure.payment_method_id}</span> : null}
              {latestPaymentSnapshot?.status ? <span>Último status do payment: {latestPaymentSnapshot.status}</span> : null}
              {latestPaymentSnapshot?.status_detail ? <span>Último status_detail do payment: {latestPaymentSnapshot.status_detail}</span> : null}
              {retryDisplay.showRecovery ? (
                <>
                  {retryDisplay.title ? <span>{retryDisplay.title}</span> : null}
                  {retryDisplay.description ? <span>{retryDisplay.description}</span> : null}
                  {retryDisplay.cardCooldownActive ? (
                    <span>Cartão temporariamente em cooldown: {formatCooldown(retryDisplay.cardCooldownRemainingMs)}.</span>
                  ) : null}
                  <div className="loyalty-card__actions">
                    <button
                      type="button"
                      className="btn btn--outline"
                      onClick={() => {
                        setFallbackIntent(null)
                        setPaymentMethod('credit_card')
                      }}
                      disabled={!retryDisplay.cardEnabled}
                    >
                      {retryDisplay.cardActionLabel}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => {
                        setFallbackIntent({
                          reason: failureDisplay.technicalCode === 'cc_rejected_high_risk' ? 'card_high_risk' : 'card_decline',
                          source: 'failure_recovery',
                          previous_failure_code: failureDisplay.technicalCode || null,
                          previous_subscription_id: currentDetails?.subscription?.id || null,
                        })
                        setPaymentMethod('pix')
                      }}
                      disabled={!retryDisplay.pixEnabled}
                    >
                      {retryDisplay.pixActionLabel}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="loyalty-grid loyalty-grid--two">
            <div className="loyalty-card loyalty-card--nested">
              <h3>Saldo do ciclo</h3>
              {activeCredits.length ? activeCredits.map((credit) => (
                <div key={credit.id} className="loyalty-credit-row">
                  <span>{credit.servico_nome}</span>
                  <strong>{credit.quantidade_restante}/{credit.quantidade_total}</strong>
                </div>
              )) : <p className="loyalty-empty">Nenhum crédito ativo no momento.</p>}
            </div>

            <div className="loyalty-card loyalty-card--nested">
              <h3>Últimos eventos</h3>
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
                Ver página pública
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
                    <span>{item.servico?.nome || `Serviço #${item.servico_id}`}</span>
                    <strong>{item.quantidade_por_ciclo} por ciclo</strong>
                  </div>
                ))}
              </div>

              <div className="loyalty-payment-methods">
                <button
                  type="button"
                  className={`btn ${paymentMethod === 'pix' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => {
                    if (failureDisplay.technicalCode === 'cc_rejected_high_risk') {
                      setFallbackIntent({
                        reason: 'card_high_risk',
                        source: 'payment_method_selector',
                        previous_failure_code: failureDisplay.technicalCode,
                        previous_subscription_id: currentDetails?.subscription?.id || null,
                      })
                    }
                    setPaymentMethod('pix')
                  }}
                  disabled={!sellerConnected}
                >
                  PIX
                </button>
                <button
                  type="button"
                  className={`btn ${paymentMethod === 'credit_card' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => {
                    setFallbackIntent(null)
                    setPaymentMethod('credit_card')
                  }}
                  disabled={!sellerConnected}
                >
                  Cartão
                </button>
              </div>

              {paymentMethod === 'pix' ? (
                <div className="loyalty-checkout-block">
                  <p>Pagamento manual por ciclo. Ao pagar, o plano é ativado e os créditos do mês são liberados.</p>
                  <button type="button" className="btn btn--primary" onClick={handlePixSubscribe} disabled={submitting || !sellerConnected}>
                    {fallbackIntent || failureDisplay.technicalCode === 'cc_rejected_high_risk' ? 'Pagar por PIX agora' : 'Gerar PIX'}
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
                  <p>Cartão com primeira cobrança confirmada pelo Mercado Pago, o que pode levar até cerca de 1 hora, e renovação automática mensal.</p>
                  {!sellerConnected ? (
                    <p className="loyalty-inline-error">Conta Mercado Pago desconectada ou sem permissao valida.</p>
                  ) : null}
                  {cardRetryBlocked ? (
                    <p className="loyalty-inline-error">
                      {retryDisplay.cardCooldownActive
                        ? `Por segurança, novas tentativas com cartão ficam indisponíveis por ${formatCooldown(retryDisplay.cardCooldownRemainingMs)}. PIX continua disponível.`
                        : 'Não foi possível aprovar este cartão no momento. Tente PIX ou outro cartão.'}
                    </p>
                  ) : null}
                  <form key={cardFormResetKey} id="client-loyalty-card-form" className="loyalty-card-form">
                    <div className="loyalty-card-form__grid">
                      <div id="client-loyalty-card-number" className="input loyalty-card-form__field" />
                      <div id="client-loyalty-card-expiration" className="input loyalty-card-form__field" />
                      <div id="client-loyalty-card-cvv" className="input loyalty-card-form__field" />
                      <input id="client-loyalty-card-holder" name="cardholderName" className="input loyalty-card-form__field" placeholder="Titular do cartão" autoComplete="cc-name" />
                      <input id="client-loyalty-card-email" className="input loyalty-card-form__field" type="email" placeholder="E-mail" defaultValue={user?.email || ''} />
                      <select id="client-loyalty-card-doc-type" className="input loyalty-card-form__field" defaultValue="" />
                      <input id="client-loyalty-card-doc-number" className="input loyalty-card-form__field" placeholder="Número do documento" />
                      <select id="client-loyalty-card-issuer" className="input loyalty-card-form__field" defaultValue="" />
                      <select id="client-loyalty-card-installments" className="input loyalty-card-form__field" defaultValue="" />
                    </div>
                    <button type="submit" className="btn btn--primary" disabled={submitting || !cardState.ready || !sellerConnected || cardRetryBlocked}>
                      {cardState.loading ? 'Carregando...' : 'Assinar no cartão'}
                    </button>
                  </form>
                  {cardState.error ? <p className="loyalty-inline-error">{cardState.error}</p> : null}
                </div>
              )}
            </>
          ) : (
            <p className="loyalty-empty">{loading ? 'Carregando planos...' : 'Nenhum plano disponível para este estabelecimento.'}</p>
          )}
        </section>
      ) : (
        <section className="card loyalty-card">
          <div className="loyalty-card__header">
            <div>
              <h2>Como assinar um plano</h2>
              <p>Abra a página de um estabelecimento ou a tela pública de planos para contratar uma fidelidade.</p>
            </div>
          </div>
          <Link className="btn btn--primary" to="/novo">Explorar estabelecimentos</Link>
        </section>
      )}

      <section className="card loyalty-card">
        <div className="loyalty-card__header">
          <div>
            <h2>Histórico</h2>
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
