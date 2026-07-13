import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  buildLoyaltySplit,
  estimateLoyaltyCycleAmounts,
  resolveEstablishmentPercent,
  InvalidPlatformPercentError,
} = await import('../src/lib/loyalty_split.js')

test('o estabelecimento fica com o complemento da comissao da plataforma', () => {
  assert.equal(resolveEstablishmentPercent(5), 95)
  assert.equal(resolveEstablishmentPercent(0), 100)
  assert.equal(resolveEstablishmentPercent(7.5), 92.5)
})

test('percentual invalido falha ANTES de chamar o Asaas', () => {
  // 100% para a plataforma = 0% para o salao: o Asaas rejeita, e o erro dele e generico.
  assert.throws(() => resolveEstablishmentPercent(100), InvalidPlatformPercentError)
  assert.throws(() => resolveEstablishmentPercent(-1), InvalidPlatformPercentError)
  assert.throws(() => resolveEstablishmentPercent('abc'), InvalidPlatformPercentError)
  assert.throws(() => resolveEstablishmentPercent(undefined), InvalidPlatformPercentError)
})

test('buildLoyaltySplit monta o array percentual do Asaas', () => {
  assert.deepEqual(
    buildLoyaltySplit({ walletId: 'wal_123', platformPercent: 5 }),
    [{ walletId: 'wal_123', percentualValue: 95 }],
  )
})

test('sem walletId nao ha split (o chamador decide se e erro)', () => {
  assert.equal(buildLoyaltySplit({ walletId: '', platformPercent: 5 }), null)
  assert.equal(buildLoyaltySplit({ platformPercent: 5 }), null)
})

test('estimativa do ciclo: plano de R$ 80 com 5% de comissao e cartao 2,99% + R$ 0,49', () => {
  const r = estimateLoyaltyCycleAmounts({
    priceCents: 8000,
    platformPercent: 5,
    cardFeePercent: 2.99,
    cardFeeFixedCents: 49,
  })
  assert.equal(r.priceCents, 8000)
  assert.equal(r.platformFeeCents, 400) // 5% de 80,00
  assert.equal(r.asaasFeeCents, 288) // 2,99% de 80,00 = 239 + 49
  assert.equal(r.establishmentNetCents, 7312) // o salao recebe R$ 73,12
  assert.equal(r.establishmentPercent, 95)
})

test('sem taxa de cartao configurada, a estimativa nao inventa numero', () => {
  const r = estimateLoyaltyCycleAmounts({ priceCents: 8000, platformPercent: 5 })
  assert.equal(r.asaasFeeCents, 0)
  assert.equal(r.establishmentNetCents, 7600)
})
