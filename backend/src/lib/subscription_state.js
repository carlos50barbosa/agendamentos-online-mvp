import { pool } from './db.js'
import { config } from './config.js'
import { toDatabaseDateTime } from './database_datetime.js'
import { getPlanContext } from './plans.js'
import {
  appendSubscriptionEvent,
  listSubscriptionsForEstabelecimento,
  updateSubscription,
} from './subscriptions.js'
import {
  BILLING_ACTIVE_STATUSES,
  BILLING_BLOCKED_STATUSES,
  BILLING_WARNING_STATUSES,
  SUBSCRIPTION_STATUSES,
  normalizePaymentMethod,
  normalizeSubscriptionStatus,
} from './subscription_normalization.js'

const DAY_MS = 86400000
const DEFAULT_GRACE_DAYS = Number(config.billing?.reminders?.graceDays ?? process.env.SUBSCRIPTION_GRACE_DAYS ?? 3) || 3
const DEFAULT_WARN_DAYS = Number(config.billing?.reminders?.warnDays ?? 3) || 3

export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function isTopupSubscription(subscription) {
  const ref = String(subscription?.externalReference || subscription?.external_reference || '')
  return ref.startsWith('wallet:whatsapp_topup')
}

function statusPriority(status) {
  switch (normalizeSubscriptionStatus(status)) {
    case 'active':
      return 80
    case 'trialing':
      return 75
    case 'past_due':
      return 60
    case 'pending_payment':
      return 50
    case 'pending_pix':
      return 45
    case 'unpaid':
      return 30
    case 'expired':
      return 20
    case 'canceled':
      return 10
    default:
      return 0
  }
}

function subscriptionAnchorTime(subscription) {
  const candidates = [
    subscription?.currentPeriodEnd,
    subscription?.current_period_end,
    subscription?.nextBillingAt,
    subscription?.next_billing_at,
    subscription?.currentPeriodStart,
    subscription?.current_period_start,
    subscription?.lastPaymentAt,
    subscription?.last_payment_at,
    subscription?.trialEndsAt,
    subscription?.trial_ends_at,
    subscription?.createdAt,
    subscription?.created_at,
    subscription?.updatedAt,
    subscription?.updated_at,
  ]

  for (const candidate of candidates) {
    const date = toDate(candidate)
    if (date) return date.getTime()
  }
  return 0
}

export function pickEffectiveSubscription(subscriptions = []) {
  const candidates = Array.isArray(subscriptions)
    ? subscriptions.filter((item) => item && !isTopupSubscription(item))
    : []
  if (!candidates.length) return null

  return candidates.reduce((best, current) => {
    if (!best) return current
    const currentPriority = statusPriority(current.status)
    const bestPriority = statusPriority(best.status)
    if (currentPriority !== bestPriority) return currentPriority > bestPriority ? current : best

    const currentAnchor = subscriptionAnchorTime(current)
    const bestAnchor = subscriptionAnchorTime(best)
    if (currentAnchor !== bestAnchor) return currentAnchor > bestAnchor ? current : best

    const currentUpdatedAt = toDate(current.updatedAt || current.updated_at || current.createdAt || current.created_at)?.getTime() || 0
    const bestUpdatedAt = toDate(best.updatedAt || best.updated_at || best.createdAt || best.created_at)?.getTime() || 0
    if (currentUpdatedAt !== bestUpdatedAt) return currentUpdatedAt > bestUpdatedAt ? current : best

    return Number(current.id || 0) > Number(best.id || 0) ? current : best
  }, null)
}

function calcDayDiff(targetDate, now) {
  if (!targetDate) return null
  const diff = targetDate.getTime() - now.getTime()
  if (diff >= 0) return Math.ceil(diff / DAY_MS)
  return -Math.floor(Math.abs(diff) / DAY_MS)
}

export function computeSubscriptionState({
  subscription = null,
  planContext = null,
  graceDays = DEFAULT_GRACE_DAYS,
  warnDays = DEFAULT_WARN_DAYS,
  now = new Date(),
} = {}) {
  const paymentMethod = normalizePaymentMethod(subscription?.paymentMethod || subscription?.payment_method || null)
  const originalStatus = normalizeSubscriptionStatus(
    subscription?.status || planContext?.status || 'trialing',
    { paymentMethod }
  )
  const currentPeriodEnd = toDate(subscription?.currentPeriodEnd || subscription?.current_period_end || planContext?.activeUntil)
  const trialEndsAt = toDate(subscription?.trialEndsAt || subscription?.trial_ends_at || planContext?.trialEndsAt)
  const nextBillingAt = toDate(subscription?.nextBillingAt || subscription?.next_billing_at || currentPeriodEnd)
  const storedGraceUntil = toDate(subscription?.graceUntil || subscription?.grace_until)
  const dueAt = currentPeriodEnd || trialEndsAt || nextBillingAt || null

  let graceUntil = storedGraceUntil
  if (!graceUntil && originalStatus === 'past_due' && dueAt) {
    graceUntil = new Date(dueAt.getTime() + Math.max(graceDays, 0) * DAY_MS)
  }

  let resolvedStatus = originalStatus
  let accessState = 'full'
  let state = 'ok'
  let coreFeaturesAllowed = true

  if (resolvedStatus === 'trialing') {
    const trialActive = !trialEndsAt || trialEndsAt.getTime() > now.getTime()
    if (!trialActive) {
      resolvedStatus = 'expired'
      accessState = 'blocked'
      state = 'blocked'
      coreFeaturesAllowed = false
    } else {
      const daysToDue = calcDayDiff(trialEndsAt, now)
      state = daysToDue != null && daysToDue <= warnDays ? 'due_soon' : 'trial'
    }
  } else if (resolvedStatus === 'active') {
    if (dueAt && dueAt.getTime() <= now.getTime()) {
      resolvedStatus = paymentMethod === 'credit_card' ? 'past_due' : 'expired'
    }
  }

  if (resolvedStatus === 'active') {
    const daysToDue = calcDayDiff(dueAt, now)
    accessState = 'full'
    state = daysToDue != null && daysToDue <= warnDays ? 'due_soon' : 'ok'
    coreFeaturesAllowed = true
  } else if (resolvedStatus === 'pending_payment' || resolvedStatus === 'pending_pix' || resolvedStatus === 'past_due') {
    const withinDueWindow = currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime()
    const withinGraceWindow = graceUntil && graceUntil.getTime() > now.getTime()
    const daysUntilDue = withinDueWindow ? calcDayDiff(currentPeriodEnd, now) : null
    coreFeaturesAllowed = Boolean(withinDueWindow || withinGraceWindow)
    accessState = 'partial'
    state = withinDueWindow
      ? (daysUntilDue != null && daysUntilDue <= warnDays ? 'due_soon' : 'pending')
      : withinGraceWindow
        ? 'overdue'
        : 'blocked'

    if (!coreFeaturesAllowed) {
      resolvedStatus = resolvedStatus === 'pending_pix' ? 'expired' : 'unpaid'
      accessState = 'blocked'
      state = 'blocked'
    }
  } else if (BILLING_BLOCKED_STATUSES.has(resolvedStatus)) {
    accessState = 'blocked'
    state = 'blocked'
    coreFeaturesAllowed = false
  }

  const daysToDueRaw = calcDayDiff(dueAt, now)
  const daysToDue = daysToDueRaw == null ? null : Math.max(daysToDueRaw, 0)
  const daysOverdue = daysToDueRaw == null || daysToDueRaw >= 0 ? null : Math.abs(daysToDueRaw)
  let graceDaysRemaining = 0
  if (graceUntil) {
    const rawRemaining = calcDayDiff(graceUntil, now)
    graceDaysRemaining = rawRemaining == null ? 0 : Math.max(rawRemaining, 0)
  }

  return {
    originalStatus,
    resolvedStatus,
    paymentMethod,
    accessState,
    state,
    coreFeaturesAllowed,
    dueAt,
    currentPeriodEnd,
    trialEndsAt,
    nextBillingAt,
    graceUntil,
    graceDays,
    warnDays,
    daysToDue,
    daysOverdue,
    graceDaysRemaining,
  }
}

export async function syncUserPlanContextFromSubscription(estabelecimentoId, {
  plan,
  status,
  billingCycle = 'mensal',
  trialEndsAt = null,
  activeUntil = null,
  subscriptionId = null,
} = {}) {
  if (!estabelecimentoId) return
  await pool.query(
    `UPDATE usuarios
        SET plan=?,
            plan_status=?,
            plan_cycle=?,
            plan_trial_ends_at=?,
            plan_active_until=?,
            plan_subscription_id=?
      WHERE id=?
        AND tipo='estabelecimento'
      LIMIT 1`,
    [
      plan || 'starter',
      normalizeSubscriptionStatus(status || 'trialing'),
      billingCycle || 'mensal',
      toDatabaseDateTime(trialEndsAt),
      toDatabaseDateTime(activeUntil),
      subscriptionId == null ? null : String(subscriptionId),
      estabelecimentoId,
    ]
  )
}

function shouldSyncUserPlanContext(planContext, subscription, computedState) {
  if (!planContext) return false
  const nextPlan = subscription?.plan || planContext.plan || 'starter'
  const nextStatus = computedState.resolvedStatus
  const nextCycle = subscription?.billingCycle || subscription?.billing_cycle || planContext.cycle || 'mensal'
  const nextActiveUntil = computedState.currentPeriodEnd ? computedState.currentPeriodEnd.toISOString() : null
  const currentActiveUntil = planContext.activeUntil ? planContext.activeUntil.toISOString() : null
  const nextSubscriptionId = subscription?.id == null ? null : String(subscription.id)

  return (
    String(planContext.plan || 'starter') !== String(nextPlan || 'starter') ||
    normalizeSubscriptionStatus(planContext.status || 'trialing') !== nextStatus ||
    String(planContext.cycle || 'mensal') !== String(nextCycle || 'mensal') ||
    currentActiveUntil !== nextActiveUntil ||
    String(planContext.subscriptionId || '') !== String(nextSubscriptionId || '')
  )
}

export async function loadEffectiveSubscriptionContext(estabelecimentoId, { refresh = true } = {}) {
  let planContext = await getPlanContext(estabelecimentoId)
  const subscriptions = await listSubscriptionsForEstabelecimento(estabelecimentoId)
  let subscription = pickEffectiveSubscription(subscriptions)
  let computedState = computeSubscriptionState({ subscription, planContext })

  if (refresh && subscription?.id && computedState.resolvedStatus !== normalizeSubscriptionStatus(subscription.status, { paymentMethod: computedState.paymentMethod })) {
    const previousStatus = normalizeSubscriptionStatus(subscription.status, { paymentMethod: computedState.paymentMethod })
    subscription = await updateSubscription(subscription.id, {
      status: computedState.resolvedStatus,
      graceUntil: computedState.graceUntil,
      canceledAt: computedState.resolvedStatus === 'canceled' ? new Date() : subscription.canceledAt || null,
    })
    await appendSubscriptionEvent(subscription.id, {
      eventType: computedState.resolvedStatus === 'unpaid' || computedState.resolvedStatus === 'expired'
        ? 'subscription_blocked'
        : 'subscription_state_corrected',
      gatewayEventId: `internal:${subscription.id}:${previousStatus}:${computedState.resolvedStatus}`,
      payload: {
        previous_status: previousStatus,
        next_status: computedState.resolvedStatus,
        reason: 'time_window_elapsed',
      },
    })
    computedState = computeSubscriptionState({ subscription, planContext })
  }

  if (planContext && shouldSyncUserPlanContext(planContext, subscription, computedState)) {
    await syncUserPlanContextFromSubscription(estabelecimentoId, {
      plan: subscription?.plan || planContext.plan,
      status: computedState.resolvedStatus || planContext.status,
      billingCycle: subscription?.billingCycle || subscription?.billing_cycle || planContext.cycle,
      trialEndsAt: computedState.trialEndsAt || planContext.trialEndsAt,
      activeUntil: computedState.currentPeriodEnd,
      subscriptionId: subscription?.id || null,
    })
    planContext = await getPlanContext(estabelecimentoId)
    computedState = computeSubscriptionState({ subscription, planContext })
  }

  return {
    planContext,
    subscriptions,
    subscription,
    computedState,
  }
}
