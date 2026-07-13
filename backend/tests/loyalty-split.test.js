import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  buildLoyaltySplit,
  computeLoyaltySplitAmounts,
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

// ---------------------------------------------------------------------------
// Os quatro casos abaixo NAO sao suposicao: sao a resposta real do sandbox do Asaas,
// medida em 2026-07-13 com split de verdade para a carteira de uma segunda conta.
// Se algum dia o Asaas mudar a regra, e AQUI que a mudanca aparece — e nao em producao,
// com dinheiro de assinante no meio.
// ---------------------------------------------------------------------------

test('MEDIDO: o percentual incide sobre o LIQUIDO, nao sobre o bruto', () => {
  // bruto 100,00 | taxa 0,99 | liquido 99,01 | 95% => o Asaas repassou 94,05 (nao 95,00)
  const r = computeLoyaltySplitAmounts({ grossCents: 10000, asaasFeeCents: 99, platformPercent: 5 })
  assert.equal(r.netCents, 9901)
  assert.equal(r.establishmentCents, 9405, 'o Asaas repassou R$ 94,05')
  assert.notEqual(r.establishmentCents, 9500, 'se fosse sobre o bruto, seriam R$ 95,00')
  assert.equal(r.platformCents, 496) // a plataforma fica com 5% do LIQUIDO, nao do bruto
})

test('MEDIDO: o Asaas TRUNCA para centavos (nao arredonda)', () => {
  // bruto 10,00 | liquido 9,01 | 95% = 8,5595 => repassou 8,55. Arredondando seria 8,56.
  const r = computeLoyaltySplitAmounts({ grossCents: 1000, asaasFeeCents: 99, platformPercent: 5 })
  assert.equal(r.establishmentCents, 855)
  assert.notEqual(r.establishmentCents, 856, 'arredondar quebraria a paridade com o Asaas')
})

test('MEDIDO: plano de R$ 80 com 5% de comissao', () => {
  // bruto 80,00 | taxa 0,99 | liquido 79,01 | 95% = 75,0595 => repassou 75,05
  const r = computeLoyaltySplitAmounts({ grossCents: 8000, asaasFeeCents: 99, platformPercent: 5 })
  assert.equal(r.establishmentCents, 7505)
  assert.equal(r.platformCents, 396)
  // A soma fecha: ninguem some com centavo no caminho.
  assert.equal(r.establishmentCents + r.platformCents + r.asaasFeeCents, r.grossCents)
})

test('MEDIDO: comissao de 7,5% (o percentual decimal tambem confere)', () => {
  // bruto 80,00 | liquido 79,01 | 92,5% = 73,0842 => repassou 73,08
  const r = computeLoyaltySplitAmounts({ grossCents: 8000, asaasFeeCents: 99, platformPercent: 7.5 })
  assert.equal(r.establishmentCents, 7308)
})

test('a taxa do Asaas e RATEADA na proporcao do split, nao paga por um lado so', () => {
  const comTaxa = computeLoyaltySplitAmounts({ grossCents: 8000, asaasFeeCents: 288, platformPercent: 5 })
  const semTaxa = computeLoyaltySplitAmounts({ grossCents: 8000, asaasFeeCents: 0, platformPercent: 5 })
  // Sem taxa a plataforma ficaria com 400 (5% de 80,00). Com taxa de 2,88 ela fica com menos:
  // absorve 5% da taxa, e o estabelecimento absorve os outros 95%.
  assert.equal(semTaxa.platformCents, 400)
  assert.equal(comTaxa.platformCents, 386)
  assert.equal(semTaxa.establishmentCents - comTaxa.establishmentCents, 274) // 95% de 288
})

test('a taxa nunca deixa o liquido negativo', () => {
  const r = computeLoyaltySplitAmounts({ grossCents: 100, asaasFeeCents: 999, platformPercent: 5 })
  assert.equal(r.netCents, 0)
  assert.equal(r.establishmentCents, 0)
  assert.equal(r.platformCents, 0)
})
