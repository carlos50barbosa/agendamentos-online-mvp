const PAYMENT_METHOD_LABELS = {
  credit_card: 'Cartão de crédito',
  pix: 'PIX',
  credit_balance: 'Crédito da assinatura',
}

const STATUS_DETAIL_MESSAGES = {
  cc_rejected_high_risk: 'Não foi possível aprovar este cartão no momento.',
  card_token_already_consumed: 'Os dados do cartão precisam ser confirmados novamente.',
}

const FALLBACK_EVENT_TITLES = {
  subscription_created: 'Assinatura criada',
  payment_approved: 'Pagamento aprovado',
  payment_failed: 'Pagamento não aprovado',
  payment_recovery_attempt: 'Tentativa com cartão',
  payment_recovered: 'Pendência regularizada',
  payment_pending: 'Pagamento em análise',
  pix_generated: 'PIX em aberto',
  pix_paid: 'PIX pago',
  pix_expired: 'PIX expirado',
  pix_obsolete: 'PIX substituído',
  subscription_renewed: 'Assinatura renovada',
  subscription_canceled: 'Assinatura cancelada',
  subscription_blocked: 'Assinatura bloqueada',
  payment_method_changed: 'Forma de pagamento alterada',
  subscription_updated: 'Assinatura atualizada',
  subscription_state_corrected: 'Estado sincronizado',
  upgrade_credit_generated: 'Upgrade com crédito proporcional',
  subscription_credit_reserved: 'Crédito reservado',
  subscription_credit_applied: 'Crédito aplicado',
  subscription_credit_released: 'Crédito liberado',
  subscription_upgraded: 'Plano substituído',
}

const FINANCIAL_EVENT_TYPES = new Set([
  'subscription_created',
  'payment_approved',
  'payment_failed',
  'payment_recovery_attempt',
  'payment_recovered',
  'payment_pending',
  'pix_generated',
  'pix_paid',
  'pix_expired',
  'pix_obsolete',
  'subscription_renewed',
  'subscription_canceled',
  'subscription_blocked',
  'upgrade_credit_generated',
  'subscription_credit_reserved',
  'subscription_credit_applied',
  'subscription_credit_released',
])

function formatCurrencyFromCents(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  return (amount / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function toTimestamp(value) {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return 0
  return date.getTime()
}

function normalizePaymentMethod(value) {
  const key = normalizeKey(value)
  if (key === 'card' || key === 'credit_card' || key === 'credit-card') return 'credit_card'
  if (key === 'pix' || key === 'pix_manual' || key === 'manual_pix') return 'pix'
  return key || null
}

function getPaymentMethodLabel(value) {
  const key = normalizePaymentMethod(value)
  return PAYMENT_METHOD_LABELS[key] || (key || 'Não definido')
}

function getPaymentResult(event) {
  return event?.payment_result || event?.payload?.payment_result || null
}

function getRawPayment(event) {
  return (
    event?.payload?.raw?.payment ||
    event?.payload?.payment ||
    null
  )
}

function inferPaymentMethod(event) {
  const eventType = normalizeKey(event?.event_type)
  if (eventType.startsWith('pix_')) return 'pix'

  const payloadMethod = normalizePaymentMethod(event?.payload?.payment_method)
  if (payloadMethod) return payloadMethod

  const paymentResult = getPaymentResult(event)
  const rawPayment = getRawPayment(event)
  const paymentTypeId = normalizeKey(
    paymentResult?.payment_type_id ||
    rawPayment?.payment_type_id
  )
  if (paymentTypeId === 'bank_transfer') return 'pix'

  const paymentMethodId = normalizeKey(
    paymentResult?.payment_method_id ||
    rawPayment?.payment_method_id
  )
  if (paymentMethodId === 'pix') return 'pix'
  if (paymentMethodId) return 'credit_card'

  const eventMethod = normalizePaymentMethod(event?.payment_method)
  if (eventMethod) return eventMethod

  if ([
    'payment_recovery_attempt',
    'payment_failed',
    'payment_pending',
    'payment_recovered',
  ].includes(eventType)) {
    return 'credit_card'
  }

  if ([
    'upgrade_credit_generated',
    'subscription_credit_reserved',
    'subscription_credit_applied',
    'subscription_credit_released',
  ].includes(eventType)) {
    return payloadMethod || 'credit_balance'
  }

  return null
}

function resolveStatusMeta(event, paymentMethod) {
  const eventType = normalizeKey(event?.event_type)
  const paymentResult = getPaymentResult(event)
  const statusGroup = normalizeKey(paymentResult?.status_group)
  const status = normalizeKey(paymentResult?.status || event?.status)

  if (eventType === 'pix_generated') {
    return { payment_status: 'pending', status_group: 'pending', label: 'Aguardando pagamento', tone: 'warning' }
  }
  if (eventType === 'pix_paid') {
    return { payment_status: 'approved', status_group: 'approved', label: 'Pago', tone: 'success' }
  }
  if (eventType === 'pix_expired') {
    return { payment_status: 'expired', status_group: 'expired', label: 'Expirado', tone: 'danger' }
  }
  if (eventType === 'pix_obsolete') {
    return { payment_status: 'obsolete', status_group: 'obsolete', label: 'Substituído', tone: 'neutral' }
  }
  if (eventType === 'payment_recovery_attempt') {
    return { payment_status: 'started', status_group: 'started', label: 'Tentativa iniciada', tone: 'info' }
  }
  if (eventType === 'upgrade_credit_generated') {
    return { payment_status: 'generated', status_group: 'generated', label: 'Crédito gerado', tone: 'success' }
  }
  if (eventType === 'subscription_credit_reserved') {
    return { payment_status: 'reserved', status_group: 'reserved', label: 'Abatimento agendado', tone: 'info' }
  }
  if (eventType === 'subscription_credit_applied') {
    return { payment_status: 'applied', status_group: 'approved', label: 'Crédito aplicado', tone: 'success' }
  }
  if (eventType === 'subscription_credit_released') {
    return { payment_status: 'released', status_group: 'released', label: 'Crédito liberado', tone: 'neutral' }
  }

  if (statusGroup === 'approved' || ['approved', 'paid', 'active'].includes(status)) {
    return { payment_status: 'approved', status_group: 'approved', label: 'Pago', tone: 'success' }
  }
  if (statusGroup === 'pending' || ['pending', 'in_process', 'processing', 'authorized', 'created'].includes(status)) {
    return {
      payment_status: 'pending',
      status_group: 'pending',
      label: paymentMethod === 'pix' ? 'Aguardando pagamento' : 'Em análise',
      tone: 'warning',
    }
  }
  if (
    statusGroup === 'rejected' ||
    ['rejected', 'cancelled', 'canceled', 'failed', 'past_due', 'expired', 'unpaid'].includes(status)
  ) {
    return {
      payment_status: 'rejected',
      status_group: 'rejected',
      label: paymentMethod === 'pix' ? 'Não pago' : 'Recusado',
      tone: 'danger',
    }
  }

  return { payment_status: status || 'unknown', status_group: statusGroup || 'unknown', label: 'Sem status', tone: 'neutral' }
}

function getStatusDetailMessage(event) {
  const paymentResult = getPaymentResult(event)
  const detail = normalizeKey(
    paymentResult?.status_detail ||
    event?.status_detail ||
    event?.payload?.details?.status_detail ||
    event?.payload?.error
  )

  if (STATUS_DETAIL_MESSAGES[detail]) return STATUS_DETAIL_MESSAGES[detail]
  return paymentResult?.user_message || event?.payload?.message || event?.message || null
}

function getReferenceData(event, paymentMethod) {
  const paymentResult = getPaymentResult(event)
  const rawPayment = getRawPayment(event)
  const gatewayEventId = String(event?.gateway_event_id || '').trim()
  const externalReference = String(
    paymentResult?.external_reference ||
    event?.payload?.external_reference ||
    rawPayment?.external_reference ||
    ''
  ).trim()
  const paymentId = String(paymentResult?.payment_id || rawPayment?.id || '').trim()
  const payloadPaymentId = String(
    event?.payload?.payment_id ||
    event?.payload?.obsolete_payment_id ||
    event?.payload?.approved_payment_id ||
    ''
  ).trim()

  if (paymentMethod === 'pix') {
    if (paymentId) return { label: 'ID PIX', value: paymentId, key: `pix:${paymentId}` }
    if (payloadPaymentId) return { label: 'ID PIX', value: payloadPaymentId, key: `pix:${payloadPaymentId}` }
    if (gatewayEventId) return { label: 'ID PIX', value: gatewayEventId, key: `pix:${gatewayEventId}` }
  }

  if (externalReference) return { label: 'Referência', value: externalReference, key: externalReference }
  if (gatewayEventId) return { label: 'ID', value: gatewayEventId, key: gatewayEventId }
  if (paymentId) return { label: 'Pagamento', value: paymentId, key: paymentId }
  return { label: null, value: null, key: null }
}

function buildDisplayCopy(event, paymentMethod, statusMeta, reasonMessage) {
  const eventType = normalizeKey(event?.event_type)
  const sourcePlan = normalizeKey(event?.payload?.source_plan)
  const targetPlan = normalizeKey(event?.payload?.target_plan)
  const sourceNominal = formatCurrencyFromCents(event?.payload?.original_plan_amount_cents)
  const targetNominal = formatCurrencyFromCents(event?.payload?.target_plan_amount_cents)
  const generatedCredit = formatCurrencyFromCents(event?.payload?.generated_credit_cents)
  const appliedCredit = formatCurrencyFromCents(event?.payload?.amount_cents || event?.payload?.credit_applied_cents)
  const nextChargeCredit = formatCurrencyFromCents(event?.payload?.next_charge_credit_cents)
  const nextChargeAmount = formatCurrencyFromCents(event?.payload?.next_charge_amount_cents)

  if (eventType === 'upgrade_credit_generated') {
    return {
      display_title: 'Upgrade realizado',
      display_subtitle:
        sourcePlan && targetPlan
          ? `${sourcePlan.charAt(0).toUpperCase() + sourcePlan.slice(1)} -> ${targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)}`
          : 'Crédito proporcional gerado',
      display_message:
        generatedCredit
          ? `Crédito proporcional gerado: ${generatedCredit}.${sourceNominal && targetNominal ? ` Plano anterior ${sourceNominal} e novo plano ${targetNominal}.` : ''} O abatimento entrará automaticamente nas próximas cobranças.`
          : (reasonMessage || 'Crédito proporcional gerado no upgrade do plano.'),
    }
  }

  if (eventType === 'subscription_credit_reserved') {
    return {
      display_title: 'Crédito reservado',
      display_subtitle: 'Abatimento programado para a próxima cobrança.',
      display_message:
        nextChargeCredit && nextChargeAmount
          ? `Abatimento previsto: ${nextChargeCredit}. Próxima cobrança estimada: ${nextChargeAmount}.`
          : (reasonMessage || 'O crédito disponível será abatido automaticamente na próxima renovação.'),
    }
  }

  if (eventType === 'subscription_credit_applied') {
    return {
      display_title: 'Crédito aplicado',
      display_subtitle: 'Abatimento registrado na renovação.',
      display_message:
        appliedCredit
          ? `Valor abatido: ${appliedCredit}.`
          : (reasonMessage || 'O crédito proporcional foi consumido na renovação da assinatura.'),
    }
  }

  if (eventType === 'subscription_credit_released') {
    return {
      display_title: 'Crédito liberado',
      display_subtitle: 'Reserva cancelada e saldo devolvido para uso futuro.',
      display_message: reasonMessage || 'O crédito voltou a ficar disponível para a próxima cobrança.',
    }
  }

  if (eventType === 'pix_obsolete') {
    return {
      display_title: 'PIX anterior substituído',
      display_subtitle: 'Esta cobrança deixou de valer porque outra conciliação resolveu a assinatura.',
      display_message: reasonMessage || 'O PIX anterior foi mantido no histórico, mas não compete mais com o pagamento confirmado.',
    }
  }

  if (paymentMethod === 'pix') {
    if (statusMeta.status_group === 'pending') {
      return {
        display_title: 'PIX em aberto',
        display_subtitle: 'PIX gerado e aguardando pagamento.',
        display_message: reasonMessage || 'Finalize o PIX para regularizar a assinatura.',
      }
    }
    if (statusMeta.status_group === 'approved') {
      return {
        display_title: 'PIX pago',
        display_subtitle: 'Pagamento PIX confirmado.',
        display_message: reasonMessage || 'A assinatura foi atualizada com a confirmação do PIX.',
      }
    }
    if (statusMeta.payment_status === 'expired' || statusMeta.status_group === 'rejected') {
      return {
        display_title: 'PIX expirado',
        display_subtitle: 'O PIX não foi concluído.',
        display_message: reasonMessage || 'Gere um novo PIX para continuar a regularização.',
      }
    }
  }

  if (paymentMethod === 'credit_card') {
    if (eventType === 'payment_recovery_attempt' && statusMeta.status_group === 'started') {
      return {
        display_title: 'Tentativa com cartão',
        display_subtitle: 'Tentativa de regularização iniciada.',
        display_message: reasonMessage || 'A cobrança foi enviada para processamento no cartão.',
      }
    }
    if (statusMeta.status_group === 'approved') {
      return {
        display_title: 'Cartão aprovado',
        display_subtitle: 'Pendência regularizada no cartão.',
        display_message: reasonMessage || 'A assinatura voltou a usar o cartão como fluxo principal.',
      }
    }
    if (statusMeta.status_group === 'pending') {
      return {
        display_title: 'Cartão em análise',
        display_subtitle: 'Tentativa com cartão em processamento.',
        display_message: reasonMessage || 'Aguarde a confirmação antes de repetir a cobrança.',
      }
    }
    if (statusMeta.status_group === 'rejected') {
      return {
        display_title: 'Cartão recusado',
        display_subtitle: 'Tentativa com cartão não aprovada.',
        display_message: reasonMessage || 'Revise os dados do titular ou tente outro cartão.',
      }
    }
  }

  return {
    display_title: FALLBACK_EVENT_TITLES[eventType] || 'Evento financeiro',
    display_subtitle: reasonMessage || 'Evento financeiro registrado na assinatura.',
    display_message: null,
  }
}

export function mapSubscriptionFinancialEvent(event) {
  if (!event || typeof event !== 'object') return null

  const paymentMethod = inferPaymentMethod(event)
  const statusMeta = resolveStatusMeta(event, paymentMethod)
  const reasonMessage = getStatusDetailMessage(event)
  const reference = getReferenceData(event, paymentMethod)
  const display = buildDisplayCopy(event, paymentMethod, statusMeta, reasonMessage)
  const eventType = normalizeKey(event?.event_type)
  const createdAt = event?.created_at || null

  return {
    id: event?.id || null,
    event_type: eventType || null,
    payment_method: paymentMethod || 'unknown',
    payment_method_label: getPaymentMethodLabel(paymentMethod),
    payment_status: statusMeta.payment_status,
    status_group: statusMeta.status_group,
    status_detail: normalizeKey(
      getPaymentResult(event)?.status_detail ||
      event?.status_detail ||
      event?.payload?.details?.status_detail
    ) || null,
    display_title: display.display_title,
    display_subtitle: display.display_subtitle,
    display_message: display.display_message,
    display_badge: {
      label: statusMeta.label,
      tone: statusMeta.tone,
    },
    created_at: createdAt,
    created_at_ms: toTimestamp(createdAt),
    reference_label: reference.label,
    reference_value: reference.value,
    reference_key: reference.key,
    gateway_event_id: event?.gateway_event_id || null,
    plan: event?.plan || null,
    billing_cycle: event?.billing_cycle || null,
    is_financial: FINANCIAL_EVENT_TYPES.has(eventType),
    is_card_attempt:
      paymentMethod === 'credit_card' &&
      ['payment_recovery_attempt', 'payment_failed', 'payment_pending', 'payment_recovered', 'payment_approved'].includes(eventType),
    resolves_attempt:
      paymentMethod === 'credit_card' &&
      ['payment_failed', 'payment_pending', 'payment_recovered'].includes(eventType),
    raw: event,
  }
}

function buildSubscriptionSummary({ subscriptionStatus, openPixEvent, latestCardAttempt } = {}) {
  const normalizedStatus = normalizeKey(subscriptionStatus)
  const latestCardRejected = latestCardAttempt?.status_group === 'rejected'

  if (openPixEvent && latestCardRejected) {
    return {
      title: 'Pendente de regularização',
      message: 'Há um PIX em aberto aguardando pagamento. A última tentativa com cartão de crédito não foi aprovada.',
    }
  }

  if (openPixEvent) {
    return {
      title: 'Pendente de regularização',
      message: 'Sua assinatura está aguardando a regularização do pagamento. Existe um PIX em aberto aguardando pagamento.',
    }
  }

  if (latestCardRejected) {
    return {
      title: 'Pendente de regularização',
      message: 'Sua assinatura está aguardando regularização do pagamento. A última tentativa com cartão de crédito não foi aprovada.',
    }
  }

  if (['pending_payment', 'pending_pix', 'past_due', 'unpaid', 'expired'].includes(normalizedStatus)) {
    return {
      title: 'Pendente de regularização',
      message: 'Sua assinatura está aguardando regularização do pagamento.',
    }
  }

  if (normalizedStatus === 'active') {
    return {
      title: 'Assinatura ativa',
      message: 'Não existe pendência financeira aberta no momento.',
    }
  }

  return {
    title: 'Status da assinatura',
    message: 'Acompanhe abaixo os Últimos eventos de cobrança por método de pagamento.',
  }
}

export function buildSubscriptionFinancialHistory(events = [], { subscriptionStatus = null } = {}) {
  const mapped = (Array.isArray(events) ? events : [])
    .map(mapSubscriptionFinancialEvent)
    .filter((item) => Boolean(item?.is_financial))
    .sort((a, b) => b.created_at_ms - a.created_at_ms)

  const resolvedAttemptKeys = new Set(
    mapped
      .filter((item) => item.resolves_attempt && item.reference_key)
      .map((item) => item.reference_key)
  )

  const timeline = mapped.filter((item) => {
    if (item.event_type !== 'payment_recovery_attempt') return true
    if (!item.reference_key) return true
    return !resolvedAttemptKeys.has(item.reference_key)
  })

  const resolvedPixKeys = new Set(
    timeline
      .filter((item) => ['pix_paid', 'pix_expired', 'pix_obsolete'].includes(item.event_type) && item.reference_key)
      .map((item) => item.reference_key)
  )

  const pixAwareTimeline = timeline.filter((item) => {
    if (item.event_type !== 'pix_generated') return true
    if (!item.reference_key) return true
    return !resolvedPixKeys.has(item.reference_key)
  })

  const openPixEvent = pixAwareTimeline.find((item) =>
    item.payment_method === 'pix' && item.status_group === 'pending'
  ) || null

  const latestCardAttempt = pixAwareTimeline.find((item) => item.is_card_attempt) || null
  const hasOpenPixAndRejectedCard = Boolean(
    openPixEvent &&
    latestCardAttempt &&
    latestCardAttempt.status_group === 'rejected'
  )

  return {
    timeline: pixAwareTimeline,
    open_pix_event: openPixEvent,
    latest_card_attempt: latestCardAttempt,
    has_open_pix_and_rejected_card: hasOpenPixAndRejectedCard,
    summary: buildSubscriptionSummary({
      subscriptionStatus,
      openPixEvent,
      latestCardAttempt,
    }),
  }
}
