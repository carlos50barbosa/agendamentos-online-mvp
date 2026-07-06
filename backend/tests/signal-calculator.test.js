import test from 'node:test'
import assert from 'node:assert/strict'

const {
  computeSignalTotalCents,
  computeSplitCents,
  computeSignal,
  SignalTooLowError,
} = await import('../src/lib/signal_calculator.js')

test('PERCENT: arredonda pra cima (ceil) igual ao fluxo legado', () => {
  assert.equal(computeSignalTotalCents({ servicePriceCents: 10000, config: { type: 'PERCENT', percent: 30 } }), 3000)
  // 33% de 1001 = 330,33 -> 331
  assert.equal(computeSignalTotalCents({ servicePriceCents: 1001, config: { type: 'PERCENT', percent: 33 } }), 331)
})

test('PERCENT sem type explícito assume percentual', () => {
  assert.equal(computeSignalTotalCents({ servicePriceCents: 5000, config: { percent: 50 } }), 2500)
})

test('FIXED: usa o valor fixo (limitado ao preço do serviço)', () => {
  assert.equal(computeSignalTotalCents({ servicePriceCents: 99999, config: { type: 'FIXED', fixedCents: 500 } }), 500)
  // valor fixo acima do preço do serviço é limitado ao preço
  assert.equal(computeSignalTotalCents({ servicePriceCents: 100, config: { type: 'FIXED', fixedCents: 500 } }), 100)
})

test('piso (minCents) eleva o sinal', () => {
  // 10% de 3000 = 300, piso 500 -> 500
  assert.equal(
    computeSignalTotalCents({ servicePriceCents: 3000, config: { type: 'PERCENT', percent: 10, minCents: 500 } }),
    500,
  )
})

test('teto (maxCents) limita o sinal', () => {
  // 90% de 10000 = 9000, teto 3000 -> 3000
  assert.equal(
    computeSignalTotalCents({ servicePriceCents: 10000, config: { type: 'PERCENT', percent: 90, maxCents: 3000 } }),
    3000,
  )
})

test('systemMinCents (piso Asaas) eleva sinais baixos', () => {
  // 30% de 1000 = 300, piso do sistema 500 -> 500
  assert.equal(
    computeSignalTotalCents({ servicePriceCents: 1000, config: { type: 'PERCENT', percent: 30 }, systemMinCents: 500 }),
    500,
  )
})

test('o sinal nunca excede o preço do serviço (mesmo com piso)', () => {
  // 30% de 400 = 120, piso 500, mas serviço custa 400 -> 400
  assert.equal(
    computeSignalTotalCents({ servicePriceCents: 400, config: { type: 'PERCENT', percent: 30 }, systemMinCents: 500 }),
    400,
  )
})

test('sem systemMinCents (ex.: caminho MP) não há piso do sistema', () => {
  assert.equal(
    computeSignalTotalCents({ servicePriceCents: 1000, config: { type: 'PERCENT', percent: 30 } }),
    300,
  )
})

test('piso do sistema sobrepõe o teto do tenant, limitado pelo preço', () => {
  // 30% de 5000 = 1500; teto 400 -> 400; piso 500 -> 500; preço 5000 permite -> 500
  assert.equal(
    computeSignalTotalCents({
      servicePriceCents: 5000,
      config: { type: 'PERCENT', percent: 30, maxCents: 400 },
      systemMinCents: 500,
    }),
    500,
  )
})

test('split = total - platformFee - taxaAsaas', () => {
  assert.equal(computeSplitCents({ totalCents: 3000, platformFeeCents: 0, asaasFeeEstimateCents: 110 }), 2890)
  assert.equal(computeSplitCents({ totalCents: 3000, platformFeeCents: 200, asaasFeeEstimateCents: 110 }), 2690)
})

test('split rejeita sinal menor ou igual à taxa (antes de chamar o Asaas)', () => {
  assert.throws(
    () => computeSplitCents({ totalCents: 100, platformFeeCents: 0, asaasFeeEstimateCents: 110 }),
    (err) => err instanceof SignalTooLowError && err.code === 'signal_too_low',
  )
  // exatamente igual à taxa também é inválido (split = 0)
  assert.throws(() => computeSplitCents({ totalCents: 110, asaasFeeEstimateCents: 110 }), SignalTooLowError)
})

test('computeSignal devolve total, split e fee coerentes (100% ao estabelecimento)', () => {
  const r = computeSignal({
    servicePriceCents: 10000,
    config: { type: 'PERCENT', percent: 30 },
    platformFeeCents: 0,
    asaasFeeEstimateCents: 110,
  })
  assert.deepEqual(r, { totalCents: 3000, splitCents: 2890, platformFeeCents: 0 })
})
