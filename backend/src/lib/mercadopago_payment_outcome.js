function normalizeValue(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeStatusKey(value) {
  return normalizeValue(value).replace(/-/g, '_')
}

function firstCause(value) {
  if (Array.isArray(value)) return value.find(Boolean) || null
  if (Array.isArray(value?.cause)) return value.cause.find(Boolean) || null
  return null
}

function buildOutcome(overrides = {}) {
  return {
    status: null,
    status_detail: null,
    payment_method_id: null,
    payment_type_id: null,
    live_mode: null,
    status_group: 'unknown',
    normalized_reason: 'unknown',
    category: 'unknown',
    decision: 'ignore',
    action_recommendation: 'manual_review',
    user_message: 'Nao foi possivel concluir o pagamento no momento.',
    support_message: 'Resultado do pagamento sem mapeamento especifico.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: false,
    should_activate_subscription: false,
    should_mark_payment_approved: false,
    rejection_code: null,
    rejection_description: null,
    rejection_message: null,
    payment_id: null,
    preapproval_id: null,
    external_reference: null,
    transaction_amount: null,
    ...overrides,
  }
}

const REJECTED_STATUS_DETAILS = {
  cc_rejected_high_risk: {
    normalized_reason: 'risk_declined',
    category: 'risk',
    action_recommendation: 'use_other_card_or_payment_method',
    user_message: 'Nao foi possivel aprovar este pagamento com este cartao. Tente outro cartao ou outra forma de pagamento.',
    support_message: 'Recusa por analise de risco/antifraude do Mercado Pago.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: true,
    suggests_other_payment_method: true,
  },
  cc_rejected_blacklist: {
    normalized_reason: 'risk_declined',
    category: 'risk',
    action_recommendation: 'use_other_card_or_payment_method',
    user_message: 'Nao foi possivel aprovar este pagamento com este cartao. Tente outro cartao ou outra forma de pagamento.',
    support_message: 'Pagamento recusado por regra de seguranca do gateway.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: true,
    suggests_other_payment_method: true,
  },
  cc_rejected_other_reason: {
    normalized_reason: 'risk_or_bank_declined',
    category: 'risk',
    action_recommendation: 'use_other_card_or_payment_method',
    user_message: 'O pagamento nao foi aprovado. Tente outro cartao ou outra forma de pagamento.',
    support_message: 'Recusa do emissor com indicio de risco ou motivo nao detalhado.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: true,
    suggests_other_payment_method: true,
  },
  rejected_by_bank: {
    normalized_reason: 'bank_declined',
    category: 'bank',
    action_recommendation: 'contact_bank_or_use_other_card',
    user_message: 'O banco emissor recusou o pagamento. Tente outro cartao ou fale com o banco.',
    support_message: 'Pagamento recusado pelo banco emissor.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: true,
  },
  cc_rejected_call_for_authorize: {
    normalized_reason: 'bank_authorization_required',
    category: 'bank',
    action_recommendation: 'contact_bank_or_use_other_card',
    user_message: 'O banco nao autorizou a compra. Entre em contato com o banco ou use outro cartao.',
    support_message: 'Banco exige autorizacao adicional.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: true,
  },
  cc_rejected_card_disabled: {
    normalized_reason: 'card_disabled',
    category: 'bank',
    action_recommendation: 'use_other_card',
    user_message: 'Este cartao esta desabilitado. Entre em contato com o banco ou use outro cartao.',
    support_message: 'Cartao desabilitado pelo emissor.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: true,
    suggests_other_payment_method: true,
  },
  cc_rejected_insufficient_amount: {
    normalized_reason: 'insufficient_funds',
    category: 'funds',
    action_recommendation: 'use_other_card_or_payment_method',
    user_message: 'O cartao nao possui limite ou saldo suficiente para concluir o pagamento.',
    support_message: 'Cartao sem saldo ou limite suficiente.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: true,
  },
  cc_rejected_max_attempts: {
    normalized_reason: 'max_attempts',
    category: 'risk',
    action_recommendation: 'wait_before_retry_or_use_other_method',
    user_message: 'Muitas tentativas foram feitas com este cartao. Aguarde um pouco antes de tentar novamente ou use outra forma de pagamento.',
    support_message: 'Gateway bloqueou novas tentativas por excesso de repeticao.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: true,
  },
  cc_rejected_bad_filled_card_number: {
    normalized_reason: 'invalid_card_data',
    category: 'insufficient_data',
    action_recommendation: 'review_card_data',
    user_message: 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.',
    support_message: 'Numero do cartao invalido ou mal preenchido.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  cc_rejected_bad_filled_date: {
    normalized_reason: 'invalid_card_data',
    category: 'insufficient_data',
    action_recommendation: 'review_card_data',
    user_message: 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.',
    support_message: 'Data de validade invalida ou mal preenchida.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  cc_rejected_bad_filled_security_code: {
    normalized_reason: 'invalid_card_data',
    category: 'insufficient_data',
    action_recommendation: 'review_card_data',
    user_message: 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.',
    support_message: 'Codigo de seguranca invalido ou mal preenchido.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  cc_rejected_bad_filled_other: {
    normalized_reason: 'invalid_card_data',
    category: 'insufficient_data',
    action_recommendation: 'review_card_data',
    user_message: 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.',
    support_message: 'Dados do cartao ou titular invalidos/incompletos.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  rejected_insufficient_data: {
    normalized_reason: 'insufficient_data',
    category: 'insufficient_data',
    action_recommendation: 'review_card_data',
    user_message: 'Nao foi possivel processar o pagamento. Revise os dados do cartao e do titular.',
    support_message: 'Dados insuficientes para analise do pagamento.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  cc_rejected_card_error: {
    normalized_reason: 'card_processing_error',
    category: 'card_error',
    action_recommendation: 'retry_or_use_other_card',
    user_message: 'Nao foi possivel processar o pagamento com este cartao. Tente novamente ou use outro cartao.',
    support_message: 'Erro no processamento do cartao.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: true,
    suggests_other_payment_method: true,
  },
  cc_rejected_invalid_installments: {
    normalized_reason: 'invalid_installments',
    category: 'insufficient_data',
    action_recommendation: 'review_installments',
    user_message: 'Nao foi possivel processar o pagamento com a configuracao atual. Revise os dados do cartao.',
    support_message: 'Configuracao de parcelas invalida.',
    automatic_retry_allowed: false,
    manual_retry_allowed: true,
    requires_new_card: false,
    suggests_other_payment_method: false,
  },
  rejected_by_regulations: {
    normalized_reason: 'regulatory_declined',
    category: 'regulatory',
    action_recommendation: 'use_other_payment_method',
    user_message: 'O pagamento nao pode ser concluido com este cartao. Tente outra forma de pagamento.',
    support_message: 'Pagamento recusado por restricao/regra regulatoria.',
    automatic_retry_allowed: false,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: true,
  },
}

const PENDING_STATUS_DETAILS = {
  pending_review_manual: {
    normalized_reason: 'manual_review',
    category: 'review',
    action_recommendation: 'wait_gateway_review',
    user_message: 'O pagamento esta em analise pelo Mercado Pago. Aguarde a confirmacao antes de tentar novamente.',
    support_message: 'Pagamento em revisao manual.',
    automatic_retry_allowed: false,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: true,
  },
  pending_contingency: {
    normalized_reason: 'processing_contingency',
    category: 'processing',
    action_recommendation: 'wait_processing',
    user_message: 'Estamos processando o pagamento. Aguarde a confirmacao antes de tentar novamente.',
    support_message: 'Pagamento em contingencia/processamento.',
    automatic_retry_allowed: false,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: true,
  },
  offline_process: {
    normalized_reason: 'processing_offline',
    category: 'processing',
    action_recommendation: 'wait_processing',
    user_message: 'Estamos processando o pagamento. Aguarde a confirmacao antes de tentar novamente.',
    support_message: 'Pagamento em processamento offline.',
    automatic_retry_allowed: false,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: true,
  },
  deferred_retry: {
    normalized_reason: 'gateway_retry_scheduled',
    category: 'processing',
    action_recommendation: 'wait_gateway_retry',
    user_message: 'Ja existe uma tentativa em processamento. Aguarde antes de tentar novamente.',
    support_message: 'Gateway agendou nova tentativa de processamento.',
    automatic_retry_allowed: true,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: true,
  },
  pending_capture: {
    normalized_reason: 'authorized_pending_capture',
    category: 'processing',
    action_recommendation: 'wait_capture',
    user_message: 'O pagamento foi autorizado e aguarda confirmacao final. Aguarde antes de tentar novamente.',
    support_message: 'Pagamento autorizado e pendente de captura.',
    automatic_retry_allowed: false,
    manual_retry_allowed: false,
    requires_new_card: false,
    suggests_other_payment_method: false,
    wait_for_webhook: true,
  },
}

export function classifyMercadoPagoPaymentOutcome({
  status,
  statusDetail,
  paymentMethodId = null,
  paymentTypeId = null,
  liveMode = null,
  rejectionCode = null,
  rejectionDescription = null,
  rejectionMessage = null,
  paymentId = null,
  preapprovalId = null,
  externalReference = null,
  transactionAmount = null,
} = {}) {
  const normalizedStatus = normalizeValue(status)
  const normalizedStatusKey = normalizeStatusKey(status)
  const normalizedDetail = normalizeValue(statusDetail)

  if (['approved', 'paid'].includes(normalizedStatusKey)) {
    return buildOutcome({
      status: normalizedStatus || null,
      status_detail: normalizedDetail || null,
      payment_method_id: paymentMethodId || null,
      payment_type_id: paymentTypeId || null,
      live_mode: typeof liveMode === 'boolean' ? liveMode : null,
      status_group: 'approved',
      normalized_reason: normalizedDetail || 'accredited',
      category: 'approved',
      decision: 'activate',
      action_recommendation: 'activate_subscription',
      user_message: 'Pagamento aprovado.',
      support_message: 'Pagamento aprovado e apto a ativar a assinatura.',
      automatic_retry_allowed: false,
      manual_retry_allowed: false,
      requires_new_card: false,
      suggests_other_payment_method: false,
      wait_for_webhook: false,
      should_activate_subscription: true,
      should_mark_payment_approved: true,
      rejection_code: rejectionCode || null,
      rejection_description: rejectionDescription || null,
      rejection_message: rejectionMessage || null,
      payment_id: paymentId || null,
      preapproval_id: preapprovalId || null,
      external_reference: externalReference || null,
      transaction_amount: transactionAmount ?? null,
    })
  }

  if (
    ['pending', 'in_process', 'processing', 'authorized', 'created', 'scheduled'].includes(normalizedStatusKey) ||
    Object.prototype.hasOwnProperty.call(PENDING_STATUS_DETAILS, normalizedDetail)
  ) {
    const detailConfig = PENDING_STATUS_DETAILS[normalizedDetail] || {}
    return buildOutcome({
      status: normalizedStatus || null,
      status_detail: normalizedDetail || null,
      payment_method_id: paymentMethodId || null,
      payment_type_id: paymentTypeId || null,
      live_mode: typeof liveMode === 'boolean' ? liveMode : null,
      status_group: 'pending',
      normalized_reason: detailConfig.normalized_reason || normalizedDetail || normalizedStatusKey || 'pending',
      category: detailConfig.category || 'processing',
      decision: 'pending',
      action_recommendation: detailConfig.action_recommendation || 'wait_processing',
      user_message: detailConfig.user_message || 'O pagamento esta em processamento. Aguarde a confirmacao antes de tentar novamente.',
      support_message: detailConfig.support_message || 'Pagamento pendente/aguardando confirmacao do gateway.',
      automatic_retry_allowed: detailConfig.automatic_retry_allowed === true,
      manual_retry_allowed: detailConfig.manual_retry_allowed === true,
      requires_new_card: detailConfig.requires_new_card === true,
      suggests_other_payment_method: detailConfig.suggests_other_payment_method === true,
      wait_for_webhook: detailConfig.wait_for_webhook !== false,
      should_activate_subscription: false,
      should_mark_payment_approved: false,
      rejection_code: rejectionCode || null,
      rejection_description: rejectionDescription || null,
      rejection_message: rejectionMessage || null,
      payment_id: paymentId || null,
      preapproval_id: preapprovalId || null,
      external_reference: externalReference || null,
      transaction_amount: transactionAmount ?? null,
    })
  }

  if (
    ['rejected', 'cancelled', 'canceled', 'failed', 'refunded', 'charged_back'].includes(normalizedStatusKey) ||
    Object.prototype.hasOwnProperty.call(REJECTED_STATUS_DETAILS, normalizedDetail)
  ) {
    const detailConfig = REJECTED_STATUS_DETAILS[normalizedDetail] || {}
    return buildOutcome({
      status: normalizedStatus || null,
      status_detail: normalizedDetail || null,
      payment_method_id: paymentMethodId || null,
      payment_type_id: paymentTypeId || null,
      live_mode: typeof liveMode === 'boolean' ? liveMode : null,
      status_group: 'rejected',
      normalized_reason: detailConfig.normalized_reason || normalizedDetail || normalizedStatus || 'payment_declined',
      category: detailConfig.category || 'payment_declined',
      decision: 'reject',
      action_recommendation: detailConfig.action_recommendation || 'use_other_payment_method',
      user_message: detailConfig.user_message || 'O pagamento nao foi aprovado. Tente outro cartao ou outra forma de pagamento.',
      support_message: detailConfig.support_message || 'Pagamento recusado pelo gateway.',
      automatic_retry_allowed: false,
      manual_retry_allowed: detailConfig.manual_retry_allowed !== false,
      requires_new_card: detailConfig.requires_new_card === true,
      suggests_other_payment_method: detailConfig.suggests_other_payment_method !== false,
      wait_for_webhook: false,
      should_activate_subscription: false,
      should_mark_payment_approved: false,
      rejection_code: rejectionCode || null,
      rejection_description: rejectionDescription || null,
      rejection_message: rejectionMessage || null,
      payment_id: paymentId || null,
      preapproval_id: preapprovalId || null,
      external_reference: externalReference || null,
      transaction_amount: transactionAmount ?? null,
    })
  }

  return buildOutcome({
    status: normalizedStatus || null,
    status_detail: normalizedDetail || null,
    payment_method_id: paymentMethodId || null,
    payment_type_id: paymentTypeId || null,
    live_mode: typeof liveMode === 'boolean' ? liveMode : null,
    normalized_reason: normalizedDetail || normalizedStatus || 'unknown',
    rejection_code: rejectionCode || null,
    rejection_description: rejectionDescription || null,
    rejection_message: rejectionMessage || null,
    payment_id: paymentId || null,
    preapproval_id: preapprovalId || null,
    external_reference: externalReference || null,
    transaction_amount: transactionAmount ?? null,
  })
}

export function summarizeMercadoPagoGatewayResult(payment = null) {
  if (!payment || typeof payment !== 'object') return null
  const cause = firstCause(payment) || firstCause(payment?.transaction_details) || null
  return classifyMercadoPagoPaymentOutcome({
    status: payment?.status || null,
    statusDetail: payment?.status_detail || payment?.statusDetail || null,
    paymentMethodId: payment?.payment_method_id || payment?.paymentMethodId || null,
    paymentTypeId: payment?.payment_type_id || payment?.paymentTypeId || null,
    liveMode: payment?.live_mode ?? payment?.liveMode ?? null,
    rejectionCode: cause?.code != null ? String(cause.code) : null,
    rejectionDescription: cause?.description || null,
    rejectionMessage: payment?.message || payment?.status_message || null,
    paymentId: payment?.id != null ? String(payment.id) : null,
    preapprovalId: payment?.preapproval_id || payment?.preapprovalId || payment?.subscription_id || null,
    externalReference: payment?.external_reference || payment?.externalReference || null,
    transactionAmount: payment?.transaction_amount ?? payment?.transactionAmount ?? null,
  })
}

function normalizeStoredPaymentResult(result) {
  if (!result || typeof result !== 'object') return null
  return buildOutcome({
    ...result,
    status: normalizeValue(result.status) || null,
    status_detail: normalizeValue(result.status_detail) || null,
    payment_method_id: result.payment_method_id || null,
    payment_type_id: result.payment_type_id || null,
    live_mode: typeof result.live_mode === 'boolean' ? result.live_mode : null,
    automatic_retry_allowed: result.automatic_retry_allowed === true,
    manual_retry_allowed: result.manual_retry_allowed === true,
    requires_new_card: result.requires_new_card === true,
    suggests_other_payment_method: result.suggests_other_payment_method === true,
    wait_for_webhook: result.wait_for_webhook === true,
    should_activate_subscription: result.should_activate_subscription === true,
    should_mark_payment_approved: result.should_mark_payment_approved === true,
  })
}

export function extractMercadoPagoPaymentResultFromPayload(payload, { includePending = true } = {}) {
  if (!payload || typeof payload !== 'object') return null

  const stored = normalizeStoredPaymentResult(payload.payment_result)
  if (stored) {
    if (!includePending && stored.status_group === 'pending') return null
    if (stored.status_group === 'approved') return null
    return stored
  }

  const paymentCandidate =
    payload.payment ||
    payload.authorized_payment ||
    payload.authorizedPayment ||
    payload.raw?.payment ||
    payload.raw?.authorized_payment ||
    payload.raw?.authorizedPayment ||
    payload.raw ||
    null

  const summary = summarizeMercadoPagoGatewayResult(paymentCandidate)
  if (!summary) return null
  if (summary.status_group === 'approved') return null
  if (!includePending && summary.status_group === 'pending') return null
  return summary
}

export function enrichMercadoPagoSubscriptionEvent(event, options = {}) {
  if (!event || typeof event !== 'object') return event
  const paymentResult = extractMercadoPagoPaymentResultFromPayload(event.payload, options)
  if (!paymentResult) {
    return {
      ...event,
      external_reference:
        event?.payload?.external_reference ||
        event?.payload?.raw?.payment?.external_reference ||
        null,
      event_payment_method:
        event?.payload?.payment_method ||
        null,
    }
  }
  return {
    ...event,
    status: paymentResult.status,
    status_detail: paymentResult.status_detail,
    status_group: paymentResult.status_group,
    normalized_reason: paymentResult.normalized_reason,
    action_recommendation: paymentResult.action_recommendation,
    decision: paymentResult.decision,
    user_message: paymentResult.user_message,
    payment_method_id: paymentResult.payment_method_id,
    payment_type_id: paymentResult.payment_type_id,
    external_reference: paymentResult.external_reference || event?.payload?.external_reference || null,
    transaction_amount: paymentResult.transaction_amount ?? null,
    payment_result: paymentResult,
  }
}

export function findLatestMercadoPagoPaymentResult(events = [], { includePending = true, onlyFailures = false } = {}) {
  const list = Array.isArray(events) ? events : []
  for (const event of list) {
    const storedPaymentResult =
      normalizeStoredPaymentResult(event?.payment_result) ||
      normalizeStoredPaymentResult(event?.payload?.payment_result)
    if (storedPaymentResult?.status_group === 'approved') {
      return null
    }
    const paymentResult = storedPaymentResult || extractMercadoPagoPaymentResultFromPayload(event?.payload, { includePending })
    if (!paymentResult) continue
    if (onlyFailures && paymentResult.status_group !== 'rejected') continue
    if (!includePending && paymentResult.status_group === 'pending') continue
    if (!['rejected', 'pending'].includes(paymentResult.status_group)) continue
    return {
      ...paymentResult,
      event_type: event?.event_type || null,
      gateway_event_id: event?.gateway_event_id || null,
      created_at: event?.created_at || null,
    }
  }
  return null
}
