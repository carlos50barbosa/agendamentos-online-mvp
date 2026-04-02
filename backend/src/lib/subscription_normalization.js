export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'pending_payment',
  'pending_pix',
  'past_due',
  'unpaid',
  'expired',
  'canceled',
]

export const BILLING_WARNING_STATUSES = new Set(['pending_payment', 'pending_pix', 'past_due'])
export const BILLING_BLOCKED_STATUSES = new Set(['unpaid', 'expired', 'canceled'])
export const BILLING_ACTIVE_STATUSES = new Set(['trialing', 'active'])

export function normalizePaymentMethod(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (['credit_card', 'credit-card', 'card', 'credit'].includes(raw)) return 'credit_card'
  if (['pix', 'pix_manual', 'manual_pix'].includes(raw)) return 'pix'
  return raw
}

export function normalizeSubscriptionStatus(value, { paymentMethod = null } = {}) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'trialing'

  if (SUBSCRIPTION_STATUSES.includes(raw)) return raw

  if (['authorized'].includes(raw)) return 'active'
  if (['pending', 'initiated', 'in_process', 'inprocess'].includes(raw)) {
    return normalizePaymentMethod(paymentMethod) === 'credit_card' ? 'pending_payment' : 'pending_pix'
  }
  if (['paused', 'halted', 'rejected', 'charged_back', 'delinquent', 'blocked', 'overdue'].includes(raw)) {
    return 'past_due'
  }
  if (['cancelled', 'cancelled_by_collector', 'cancelled_by_merchant'].includes(raw)) return 'canceled'

  return 'trialing'
}

