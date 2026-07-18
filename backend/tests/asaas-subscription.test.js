import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createTenantAsaasSubscription, setTenantAsaasSubscriptionStatus, changeTenantAsaasPlan, resolveActiveSubscriptionChange, resolveBillingProvider } = await import('../src/lib/asaas_subscription.js')

function fakeDb(handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      for (const h of handlers) if (h.match.test(sql)) return h.result
      return [[]]
    },
  }
}

// payments mock (nível alto): registra chamadas.
function fakePayments(overrides = {}) {
  const calls = []
  const wrap = (name, fn) => async (...args) => {
    calls.push({ name, args })
    return fn ? fn(...args) : {}
  }
  return {
    calls,
    createCustomer: wrap('createCustomer', overrides.createCustomer || (() => ({ id: 'cus_new' }))),
    createSubscription: wrap('createSubscription', overrides.createSubscription || (() => ({ id: 'sub_asaas_1' }))),
    updateSubscription: wrap('updateSubscription', overrides.updateSubscription || (() => ({ id: 'sub_asaas_1' }))),
    getSubscriptionPayments: wrap('getSubscriptionPayments', overrides.getSubscriptionPayments || (() => [{ id: 'pay_1', invoiceUrl: 'https://asaas/checkout/1' }])),
    setSubscriptionStatus: wrap('setSubscriptionStatus', overrides.setSubscriptionStatus || (() => ({ status: 'INACTIVE' }))),
    createPixCharge: wrap('createPixCharge'),
    getPixQrCode: wrap('getPixQrCode'),
  }
}

const SUB_ROW = {
  id: 10,
  estabelecimento_id: 9,
  plan: 'pro',
  gateway: 'asaas',
  payment_method: 'pix',
  gateway_customer_id: 'cus_estab',
  gateway_subscription_id: 'sub_asaas_1',
  external_reference: 'subscription:estab:9',
  status: 'pending_pix',
  amount_cents: 2990,
  currency: 'BRL',
  billing_cycle: 'mensal',
}

test('resolveBillingProvider respeita BILLING_PROVIDER', () => {
  const prev = process.env.BILLING_PROVIDER
  process.env.BILLING_PROVIDER = 'asaas'
  assert.equal(resolveBillingProvider(), 'asaas')
  process.env.BILLING_PROVIDER = 'mercadopago'
  assert.equal(resolveBillingProvider(), 'mercadopago')
  if (prev === undefined) delete process.env.BILLING_PROVIDER
  else process.env.BILLING_PROVIDER = prev
})

test('cria assinatura Asaas, persiste (gateway=asaas) e devolve link hospedado', async () => {
  const db = fakeDb([
    { match: /SELECT nome, email, telefone, cpf_cnpj FROM usuarios/, result: [[{ nome: 'Barbearia', email: 'b@x.com', telefone: '1130000000', cpf_cnpj: '12345678000199' }]] },
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[{ asaas_customer_id: 'cus_estab' }]] },
    { match: /INSERT INTO subscriptions/, result: [{ insertId: 10 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[SUB_ROW]] },
    { match: /UPDATE usuarios SET plan_subscription_id/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  const result = await createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'pro', cycle: 'mensal', db, payments })

  assert.equal(result.asaasSubscriptionId, 'sub_asaas_1')
  assert.equal(result.checkoutUrl, 'https://asaas/checkout/1')
  assert.equal(result.firstPaymentId, 'pay_1')
  assert.equal(result.subscription.gatewaySubscriptionId, 'sub_asaas_1')
  assert.equal(result.subscription.gateway, 'asaas')

  const subCall = payments.calls.find((c) => c.name === 'createSubscription')
  assert.equal(subCall.args[0].customerId, 'cus_estab')
  assert.equal(subCall.args[0].value, 29.9) // pro mensal = 2990 centavos
  assert.equal(subCall.args[0].cycle, 'MONTHLY')
  // INSERT persistiu gateway='asaas'
  const insert = db.calls.find((c) => /INSERT INTO subscriptions/.test(c.sql))
  assert.ok(insert.params.includes('asaas'))
  assert.ok(insert.params.includes('sub_asaas_1'))
})

test('assinatura ANUAL cobra o preço anual e recorrência YEARLY (não mensal)', async () => {
  const db = fakeDb([
    { match: /SELECT nome, email, telefone, cpf_cnpj FROM usuarios/, result: [[{ nome: 'Barbearia', email: 'b@x.com', telefone: '11999998888', cpf_cnpj: '12345678000199' }]] },
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[{ asaas_customer_id: 'cus_estab' }]] },
    { match: /INSERT INTO subscriptions/, result: [{ insertId: 11 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[{ ...SUB_ROW, id: 11, billing_cycle: 'anual', amount_cents: 29900 }]] },
    { match: /UPDATE usuarios SET plan_subscription_id/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  const result = await createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'pro', cycle: 'anual', db, payments })

  // O que vai pro Asaas: valor ANUAL (pro 29900 = R$ 299,00) e recorrência YEARLY — o bug clássico
  // aqui seria cobrar o preço mensal (29.9) ou mandar MONTHLY para um plano anual.
  const subCall = payments.calls.find((c) => c.name === 'createSubscription')
  assert.equal(subCall.args[0].value, 299)
  assert.equal(subCall.args[0].cycle, 'YEARLY')

  // Persistiu o ciclo anual e o valor anual localmente (billing_cycle / amount_cents).
  const insert = db.calls.find((c) => /INSERT INTO subscriptions/.test(c.sql))
  assert.ok(insert.params.includes('anual'))
  assert.ok(insert.params.includes(29900))

  // E o retorno reflete o ciclo anual.
  assert.equal(result.subscription.billingCycle, 'anual')
})

test('todo plano tem preço anual > mensal — anual nunca cai no fallback do mensal', async () => {
  // Guarda getPlanPriceCents: se annualPriceCents sumir de um plano, o anual cairia
  // silenciosamente no preço MENSAL. Aqui isso vira teste vermelho.
  const { getPlanPriceCents, PLAN_TIERS } = await import('../src/lib/plans.js')
  for (const plan of PLAN_TIERS) {
    const mensal = getPlanPriceCents(plan, 'mensal')
    const anual = getPlanPriceCents(plan, 'anual')
    assert.ok(anual > mensal, `${plan}: anual (${anual}) deveria ser > mensal (${mensal})`)
  }
})

test('criacao nasce pending_payment (nao pending_pix) e o supersede protege assinatura ativa vigente (fix B/C)', async () => {
  const db = fakeDb([
    { match: /SELECT nome, email, telefone, cpf_cnpj FROM usuarios/, result: [[{ nome: 'Barbearia', email: 'b@x.com', telefone: '11999998888', cpf_cnpj: '12345678000199' }]] },
    { match: /SELECT asaas_customer_id FROM usuarios/, result: [[{ asaas_customer_id: 'cus_estab' }]] },
    { match: /INSERT INTO subscriptions/, result: [{ insertId: 12 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[{ ...SUB_ROW, id: 12, status: 'pending_payment' }]] },
    { match: /UPDATE usuarios SET plan_subscription_id/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  await createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'pro', cycle: 'mensal', db, payments })

  // Fix C: a assinatura nasce com status generico 'pending_payment' (nao 'pending'/'pending_pix'),
  // para a UI nao mostrar "PIX pendente" antes de o cliente escolher o metodo no checkout Asaas.
  const insert = db.calls.find((c) => /INSERT INTO subscriptions/.test(c.sql))
  assert.ok(insert.params.includes('pending_payment'), 'status inicial deve ser pending_payment')

  // Fix B: os DOIS WHERE do supersede (SELECT no gateway + UPDATE local) devem excluir assinatura
  // 'active' com periodo vigente — senao um novo checkout mataria uma assinatura JA PAGA.
  const supersedeSelect = db.calls.find((c) => /SELECT id, gateway_subscription_id FROM subscriptions/.test(c.sql))
  const supersedeUpdate = db.calls.find((c) => /UPDATE subscriptions SET status='canceled'/.test(c.sql))
  assert.ok(supersedeSelect, 'o SELECT do supersede deve rodar')
  assert.ok(supersedeUpdate, 'o UPDATE do supersede deve rodar')
  for (const call of [supersedeSelect, supersedeUpdate]) {
    assert.match(call.sql, /NOT \(status='active'/, 'supersede precisa do guard de status active')
    assert.match(call.sql, /current_period_end > NOW\(\)/, 'supersede precisa checar periodo vigente')
  }
})

test('plano inválido é rejeitado', async () => {
  await assert.rejects(
    () => createTenantAsaasSubscription({ estabelecimentoId: 9, plan: 'ouro', db: fakeDb(), payments: fakePayments() }),
    (e) => /invalid_plan/.test(e.message),
  )
})

test('troca de plano (upgrade) faz update-in-place: novo valor no gateway + linha local + usuarios, sem 2a assinatura', async () => {
  const db = fakeDb([
    { match: /UPDATE subscriptions SET plan=/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE usuarios SET plan=/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  const res = await changeTenantAsaasPlan({
    estabelecimentoId: 9,
    subscription: { id: 10, gatewaySubscriptionId: 'sub_asaas_1' },
    plan: 'premium',
    cycle: 'mensal',
    db,
    payments,
  })

  // Gateway: MESMA assinatura muda de valor (premium mensal = 9990 -> 99.9) e reescreve a cobranca
  // pendente. NUNCA cria uma 2a assinatura (nada de cobrar em paralelo).
  assert.equal(payments.calls.filter((c) => c.name === 'createSubscription').length, 0)
  const upd = payments.calls.find((c) => c.name === 'updateSubscription')
  assert.equal(upd.args[0], 'sub_asaas_1')
  assert.equal(upd.args[1].value, 99.9)
  assert.equal(upd.args[1].cycle, 'MONTHLY')
  assert.equal(upd.args[1].updatePendingPayments, true)

  // Linha local: plan/amount/billing_cycle no novo tier.
  const subUpdate = db.calls.find((c) => /UPDATE subscriptions SET plan=/.test(c.sql))
  assert.ok(subUpdate.params.includes('premium'))
  assert.ok(subUpdate.params.includes(9990))
  // usuarios: acesso ao novo tier ja.
  const userUpdate = db.calls.find((c) => /UPDATE usuarios SET plan=/.test(c.sql))
  assert.ok(userUpdate.params.includes('premium'))

  assert.deepEqual(
    { ok: res.ok, plan: res.plan, cycle: res.cycle, amountCents: res.amountCents, subscriptionId: res.subscriptionId },
    { ok: true, plan: 'premium', cycle: 'mensal', amountCents: 9990, subscriptionId: 10 },
  )
})

test('troca para ciclo ANUAL manda valor anual + YEARLY (nao o mensal)', async () => {
  const db = fakeDb([
    { match: /UPDATE subscriptions SET plan=/, result: [{ affectedRows: 1 }] },
    { match: /UPDATE usuarios SET plan=/, result: [{ affectedRows: 1 }] },
  ])
  const payments = fakePayments()

  await changeTenantAsaasPlan({
    estabelecimentoId: 9,
    subscription: { id: 10, gatewaySubscriptionId: 'sub_asaas_1' },
    plan: 'pro',
    cycle: 'anual',
    db,
    payments,
  })

  const upd = payments.calls.find((c) => c.name === 'updateSubscription')
  assert.equal(upd.args[1].value, 299) // pro anual = 29900
  assert.equal(upd.args[1].cycle, 'YEARLY')
})

const decide = (o) => resolveActiveSubscriptionChange({ hasActiveGatewaySub: true, ...o })

test('decisao da troca: mesmo plano+ciclo = already_active (mensal e anual)', () => {
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'mensal', requestedPlan: 'pro', requestedCycle: 'mensal' }), 'already_active')
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'anual', requestedPlan: 'pro', requestedCycle: 'anual' }), 'already_active')
})

test('decisao da troca: periodo pago ANUAL manda QUALQUER troca pro suporte (precede downgrade)', () => {
  // upgrade de tier no anual
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'anual', requestedPlan: 'premium', requestedCycle: 'anual' }), 'annual_support')
  // anual -> mensal (mesmo tier): NAO e downgrade de tier, mas o periodo anual pago barra
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'anual', requestedPlan: 'pro', requestedCycle: 'mensal' }), 'annual_support')
  // ORDEM: anual precede o ramo de downgrade — descer de tier no anual tambem vai pro suporte (nao
  // 'downgrade_unsupported'), senao a mensagem/tratamento seria o errado.
  assert.equal(decide({ currentPlan: 'premium', currentCycle: 'anual', requestedPlan: 'pro', requestedCycle: 'anual' }), 'annual_support')
})

test('decisao da troca: partindo do MENSAL, descer de tier = downgrade_unsupported', () => {
  assert.equal(decide({ currentPlan: 'premium', currentCycle: 'mensal', requestedPlan: 'pro', requestedCycle: 'mensal' }), 'downgrade_unsupported')
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'mensal', requestedPlan: 'starter', requestedCycle: 'mensal' }), 'downgrade_unsupported')
})

test('decisao da troca: upgrade/ciclo no MENSAL = change (com assinatura no gateway)', () => {
  // subir de tier
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'mensal', requestedPlan: 'premium', requestedCycle: 'mensal' }), 'change')
  // mensal -> anual (mesmo tier): sobe o compromisso, e permitido
  assert.equal(decide({ currentPlan: 'pro', currentCycle: 'mensal', requestedPlan: 'pro', requestedCycle: 'anual' }), 'change')
})

test('decisao da troca: sem assinatura ativa no gateway = no_active_subscription (fail-safe)', () => {
  assert.equal(
    resolveActiveSubscriptionChange({ currentPlan: 'pro', currentCycle: 'mensal', requestedPlan: 'premium', requestedCycle: 'mensal', hasActiveGatewaySub: false }),
    'no_active_subscription',
  )
})

function fakeTxDb(handlers = [], { failOnLocal = false } = {}) {
  const base = fakeDb(handlers)
  const tx = []
  return {
    calls: base.calls,
    tx,
    beginTransaction: async () => { tx.push('begin') },
    commit: async () => { tx.push('commit') },
    rollback: async () => { tx.push('rollback') },
    query: async (sql, params) => {
      if (failOnLocal && /UPDATE usuarios SET plan=/.test(sql)) throw new Error('db_down')
      return base.query(sql, params)
    },
  }
}

test('quando a conexao suporta transacao, os dois writes locais entram na MESMA transacao e commitam', async () => {
  const db = fakeTxDb()
  const payments = fakePayments()
  await changeTenantAsaasPlan({
    estabelecimentoId: 9,
    subscription: { id: 10, gatewaySubscriptionId: 'sub_asaas_1' },
    plan: 'premium',
    cycle: 'mensal',
    db,
    payments,
  })
  // begin antes dos UPDATEs, commit depois, sem rollback.
  assert.deepEqual(db.tx, ['begin', 'commit'])
})

test('se um write local falha dentro da transacao, faz rollback e propaga o erro (nao commita pela metade)', async () => {
  const db = fakeTxDb([], { failOnLocal: true })
  const payments = fakePayments()
  await assert.rejects(
    () => changeTenantAsaasPlan({
      estabelecimentoId: 9,
      subscription: { id: 10, gatewaySubscriptionId: 'sub_asaas_1' },
      plan: 'premium',
      cycle: 'mensal',
      db,
      payments,
    }),
    (e) => /db_down/.test(e.message),
  )
  assert.deepEqual(db.tx, ['begin', 'rollback'])
  assert.ok(!db.tx.includes('commit'), 'nao pode commitar quando o write local falhou')
})

test('troca de plano exige assinatura ativa com id + gatewaySubscriptionId', async () => {
  await assert.rejects(
    () => changeTenantAsaasPlan({ estabelecimentoId: 9, subscription: { id: 10 }, plan: 'premium', db: fakeDb(), payments: fakePayments() }),
    (e) => /no_active_asaas_subscription/.test(e.message),
  )
})

test('troca de plano rejeita plano invalido', async () => {
  await assert.rejects(
    () => changeTenantAsaasPlan({ estabelecimentoId: 9, subscription: { id: 10, gatewaySubscriptionId: 'sub_asaas_1' }, plan: 'ouro', db: fakeDb(), payments: fakePayments() }),
    (e) => /invalid_plan/.test(e.message),
  )
})

test('suspende via INACTIVE chamando o gateway', async () => {
  const db = fakeDb([
    { match: /SELECT \* FROM subscriptions WHERE estabelecimento_id=/, result: [[SUB_ROW]] },
    { match: /UPDATE subscriptions SET/, result: [{ affectedRows: 1 }] },
    { match: /SELECT \* FROM subscriptions WHERE id=/, result: [[{ ...SUB_ROW, status: 'canceled' }]] },
  ])
  const payments = fakePayments()

  const res = await setTenantAsaasSubscriptionStatus(9, 'INACTIVE', { db, payments })
  assert.equal(res.ok, true)
  const call = payments.calls.find((c) => c.name === 'setSubscriptionStatus')
  assert.deepEqual(call.args, ['sub_asaas_1', 'INACTIVE'])
})
