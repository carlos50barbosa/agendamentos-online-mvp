import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addBillingCycles,
  calculateProratedCreditCents,
} from '../src/lib/subscription_credits.js'

test('calculateProratedCreditCents returns half-cycle credit with cent rounding', () => {
  const credit = calculateProratedCreditCents({
    amountCents: 1990,
    cycleStart: '2026-04-01T00:00:00.000Z',
    cycleEnd: '2026-05-01T00:00:00.000Z',
    changedAt: '2026-04-16T00:00:00.000Z',
  })

  assert.equal(credit, 995)
})

test('calculateProratedCreditCents rounds proportionally for the final day of a 30-day cycle', () => {
  const credit = calculateProratedCreditCents({
    amountCents: 1990,
    cycleStart: '2026-04-01T00:00:00.000Z',
    cycleEnd: '2026-05-01T00:00:00.000Z',
    changedAt: '2026-04-30T00:00:00.000Z',
  })

  assert.equal(credit, 66)
})

test('calculateProratedCreditCents returns zero when there is no remaining time', () => {
  const credit = calculateProratedCreditCents({
    amountCents: 1990,
    cycleStart: '2026-04-01T00:00:00.000Z',
    cycleEnd: '2026-05-01T00:00:00.000Z',
    changedAt: '2026-05-01T00:00:00.000Z',
  })

  assert.equal(credit, 0)
})

test('addBillingCycles preserves month-end safely for mensal cycle', () => {
  const result = addBillingCycles('2026-01-31T12:00:00.000Z', 'mensal', 1)

  assert.ok(result instanceof Date)
  assert.equal(result.toISOString(), '2026-02-28T12:00:00.000Z')
})

test('addBillingCycles advances annual cycle by full years', () => {
  const result = addBillingCycles('2026-04-22T10:00:00.000Z', 'anual', 2)

  assert.ok(result instanceof Date)
  assert.equal(result.toISOString(), '2028-04-22T10:00:00.000Z')
})
