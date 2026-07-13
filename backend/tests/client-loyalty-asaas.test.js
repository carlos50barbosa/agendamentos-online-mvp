import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'
process.env.LOYALTY_PLATFORM_PERCENT = '5'

const {
  ClientPlanError,
  subscribeClientToPlan,
  cancelClientPlanSubscription,
  activateClientPlanCycle,
  markClientPlanPastDue,
  revokeClientPlanForRefund,
  CLIENT_PLAN_REF_PREFIX,
} = await import('../src/lib/client_loyalty_asaas.js')

// Fake db: casa a SQL por regex e devolve o resultado canned. Registra os UPDATEs para as
// asserções (é onde a regra de negócio aparece).
function fakeDb(handlers = []) {
  const calls = []
  return {
    calls,
    query: async (sql, params = []) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: flat, params })
      for (const h of handlers) {
        if (h.match.test(flat)) return typeof h.result === 'function' ? h.result(params) : h.result
      }
      return [[]]
    },
  }
}

function stubPayments(overrides = {}) {
  const calls = []
  return {
    calls,
    createCustomer: async (p) => { calls.push(['createCustomer', p]); return { id: 'cus_1' } },
    getCustomerByCpfCnpj: async () => null,
    updateCustomer: async () => ({}),
    createSubscription: async (p) => { calls.push(['createSubscription', p]); return { id: 'sub_asaas_1' } },
    deleteSubscription: async (id) => { calls.push(['deleteSubscription', id]); return { deleted: true } },
    ...overrides,
  }
}

const PLANO_ATIVO = [{ id: 7, estabelecimento_id: 20, nome: 'Plano Corte', preco_centavos: 8000, status: 'active' }]

// Handlers comuns: plano ativo, carteira configurada, cliente com CPF, sem assinatura previa.
function baseHandlers({ wallet = 'wal_salao', plano = PLANO_ATIVO, assinaturaExistente = [] } = {}) {
  return [
    { match: /FROM loyalty_plans WHERE id=/i, result: [plano] },
    { match: /asaas_wallet_id FROM establishment_settings/i, result: [[{ asaas_wallet_id: wallet }]] },
    { match: /FROM client_loyalty_subscriptions WHERE cliente_id=\? AND estabelecimento_id=/i, result: [assinaturaExistente] },
    { match: /nome, email, telefone, cpf_cnpj FROM usuarios/i, result: [[{ nome: 'Cliente', email: 'c@x.com', telefone: '11999990000', cpf_cnpj: '12345678909' }]] },
    { match: /SELECT asaas_customer_id FROM usuarios/i, result: [[{ asaas_customer_id: 'cus_1' }]] },
    { match: /INSERT INTO client_loyalty_subscriptions/i, result: [{ insertId: 77 }] },
    // A releitura pos-UPDATE traz o ciclo ja gravado — como o banco real traria. Sem
    // current_period_start/end, o ensureCreditsForCurrentCycle sai cedo (e esta certo:
    // sem ciclo nao ha o que creditar).
    { match: /FROM client_loyalty_subscriptions WHERE id=/i, result: [[{
      id: 77, cliente_id: 5, estabelecimento_id: 20, loyalty_plan_id: 7,
      status: 'pending_payment', gateway: 'asaas', gateway_subscription_id: 'sub_asaas_1',
      current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * 86400000),
    }]] },
    { match: /^UPDATE client_loyalty_subscriptions/i, result: [{ affectedRows: 1 }] },
    { match: /INSERT INTO client_loyalty_subscription_events/i, result: [{ insertId: 1 }] },
    { match: /FROM loyalty_plan_items/i, result: [[{ servico_id: 9, quantidade_por_ciclo: 2 }]] },
    { match: /INSERT INTO client_loyalty_subscription_credits/i, result: [{ insertId: 1 }] },
  ]
}

test('assinar: manda split percentual + cartao tokenizado e amarra o externalReference no id local', async () => {
  const db = fakeDb(baseHandlers())
  const payments = stubPayments()
  const r = await subscribeClientToPlan({
    clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7,
    creditCardToken: 'tok_1', remoteIp: '203.0.113.9', db, payments,
  })

  const [, body] = payments.calls.find(([m]) => m === 'createSubscription')
  assert.equal(body.billingType, 'CREDIT_CARD')
  assert.equal(body.creditCardToken, 'tok_1')
  assert.equal(body.value, 80) // 8000 centavos
  assert.deepEqual(body.split, [{ walletId: 'wal_salao', percentualValue: 95 }])
  // O webhook so reconhece a cobranca por este prefixo — se ele quebrar, o dinheiro entra e
  // o credito nunca e liberado.
  assert.equal(body.externalReference, `${CLIENT_PLAN_REF_PREFIX}77`)
  assert.equal(r.gatewaySubscriptionId, 'sub_asaas_1')
})

test('assinar SEM carteira do salao falha ANTES de cobrar o cliente', async () => {
  const db = fakeDb(baseHandlers({ wallet: null }))
  const payments = stubPayments()
  await assert.rejects(
    () => subscribeClientToPlan({ clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, creditCardToken: 'tok_1', remoteIp: '1.2.3.4', db, payments }),
    (err) => err instanceof ClientPlanError && err.code === 'wallet_not_configured',
  )
  // Sem carteira, a cobranca cairia inteira na conta da plataforma e o salao nunca veria o
  // dinheiro. Nada pode ter sido enviado ao Asaas.
  assert.equal(payments.calls.filter(([m]) => m === 'createSubscription').length, 0)
})

test('assinar SEM cartao e o caminho padrao: devolve o checkout do Asaas (zero PCI)', async () => {
  // Medido em sandbox: assinatura CREDIT_CARD sem cartao nasce ACTIVE, gera a 1a cobranca com
  // invoiceUrl, e quando o cliente paga o cartao LA, o Asaas guarda o cartao e cobra os ciclos
  // seguintes sozinho. Cartao nenhum passa por este servidor.
  const db = fakeDb(baseHandlers())
  const payments = stubPayments({
    getSubscriptionPayments: async () => [{ id: 'pay_1', invoiceUrl: 'https://asaas.com/i/pay_1' }],
  })
  const r = await subscribeClientToPlan({
    clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, remoteIp: '1.2.3.4', db, payments,
  })
  const [, body] = payments.calls.find(([m]) => m === 'createSubscription')
  assert.equal(body.billingType, 'CREDIT_CARD')
  assert.equal(body.creditCard, undefined, 'o cartao NAO pode ser enviado por aqui')
  assert.equal(body.creditCardToken, undefined)
  assert.equal(r.checkoutUrl, 'https://asaas.com/i/pay_1', 'sem o link, o cliente nao tem onde pagar')
})

test('assinar plano inativo e recusado', async () => {
  const db = fakeDb(baseHandlers({ plano: [{ ...PLANO_ATIVO[0], status: 'inactive' }] }))
  await assert.rejects(
    () => subscribeClientToPlan({ clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, creditCardToken: 'tok_1', remoteIp: '1.2.3.4', db, payments: stubPayments() }),
    (err) => err.code === 'plan_not_active',
  )
})

test('quem ja tem plano ativo nao assina de novo (cobranca dupla no cartao)', async () => {
  const futuro = new Date(Date.now() + 20 * 86400000)
  const db = fakeDb(baseHandlers({
    assinaturaExistente: [{
      id: 70, cliente_id: 5, estabelecimento_id: 20, loyalty_plan_id: 7, status: 'active',
      current_period_start: new Date(Date.now() - 86400000), current_period_end: futuro,
    }],
  }))
  const payments = stubPayments()
  await assert.rejects(
    () => subscribeClientToPlan({ clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, creditCardToken: 'tok_1', remoteIp: '1.2.3.4', db, payments }),
    (err) => err.code === 'already_subscribed',
  )
  assert.equal(payments.calls.filter(([m]) => m === 'createSubscription').length, 0)
})

test('se o Asaas recusar, a assinatura local NAO fica pendurada em pending_payment', async () => {
  const db = fakeDb(baseHandlers())
  const payments = stubPayments({
    createSubscription: async () => { throw new Error('cartao recusado') },
  })
  await assert.rejects(
    () => subscribeClientToPlan({ clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, creditCardToken: 'tok_1', remoteIp: '1.2.3.4', db, payments }),
  )
  const cancelou = db.calls.some((c) => /^UPDATE client_loyalty_subscriptions/i.test(c.sql) && c.params.includes('canceled'))
  assert.ok(cancelou, 'a linha local precisa ser cancelada — senao o cliente ve um plano que nunca sera cobrado')
})

test('webhook pago: ativa o ciclo e materializa os creditos do plano', async () => {
  const db = fakeDb(baseHandlers())
  const r = await activateClientPlanCycle({ subscriptionId: 77, paymentId: 'pay_1', db })
  assert.equal(r.handled, true)
  assert.equal(r.reason, 'client_plan_activated')
  const up = db.calls.find((c) => /^UPDATE client_loyalty_subscriptions/i.test(c.sql))
  assert.ok(up.params.includes('active'))
  // O ciclo precisa ser gravado, senao nao ha do que gerar credito.
  assert.ok(up.sql.includes('current_period_start') && up.sql.includes('current_period_end'))
  // Os creditos do ciclo vem de loyalty_plan_items, via UPSERT (idempotente): o Asaas
  // entrega o webhook at least once, e reprocessar nao pode dobrar credito.
  const gerouCredito = db.calls.some((c) => /INSERT INTO client_loyalty_subscription_credits/i.test(c.sql))
  assert.ok(gerouCredito, 'sem credito materializado, o cliente paga e nao ganha nada')
  const upsert = db.calls.find((c) => /INSERT INTO client_loyalty_subscription_credits/i.test(c.sql))
  assert.ok(/ON DUPLICATE KEY UPDATE/i.test(upsert.sql), 'sem UPSERT, o reenvio do webhook dobraria o credito')
})

test('webhook vencido: entra em graca, mas o beneficio do ciclo pago continua', async () => {
  const db = fakeDb(baseHandlers())
  const r = await markClientPlanPastDue({ subscriptionId: 77, db })
  assert.equal(r.handled, true)
  const up = db.calls.find((c) => /^UPDATE client_loyalty_subscriptions/i.test(c.sql))
  assert.ok(up.params.includes('past_due'))
  // past_due continua com benefitsActive dentro do periodo: o mes foi pago.
})

test('webhook estornado: encerra o PERIODO, nao so o status', async () => {
  const db = fakeDb(baseHandlers())
  const r = await revokeClientPlanForRefund({ subscriptionId: 77, db })
  assert.equal(r.handled, true)
  const up = db.calls.find((c) => /^UPDATE client_loyalty_subscriptions/i.test(c.sql))
  assert.ok(up.sql.includes('current_period_end'),
    'so marcar canceled nao basta: assinatura cancelada CONTINUA valendo dentro do periodo pago. ' +
    'No estorno o cliente recebeu o dinheiro de volta — o beneficio tem de cair AGORA.')
})

test('cancelar remove a assinatura no Asaas (para de cobrar) e marca local', async () => {
  const db = fakeDb(baseHandlers())
  const payments = stubPayments()
  await cancelClientPlanSubscription({ clienteId: 5, subscriptionId: 77, db, payments })
  assert.ok(payments.calls.some(([m, id]) => m === 'deleteSubscription' && id === 'sub_asaas_1'))
  const up = db.calls.find((c) => /^UPDATE client_loyalty_subscriptions/i.test(c.sql))
  assert.ok(up.params.includes('canceled'))
})

test('cancelar assinatura de OUTRO cliente e 404', async () => {
  const db = fakeDb(baseHandlers())
  await assert.rejects(
    () => cancelClientPlanSubscription({ clienteId: 999, subscriptionId: 77, db, payments: stubPayments() }),
    (err) => err.code === 'subscription_not_found' && err.status === 404,
  )
})

test('duplo clique em Assinar NAO cria duas assinaturas (cobranca dupla no cartao)', async () => {
  // Este bug so apareceu exercitando o fluxo de verdade: a assinatura recem-criada esta em
  // pending_payment e NAO tem benefitsActive (nao ha ciclo aberto), entao o guarda de
  // "ja assina" nao a via. Com mock, passa batido.
  const db = fakeDb(baseHandlers({
    assinaturaExistente: [{
      id: 70, cliente_id: 5, estabelecimento_id: 20, loyalty_plan_id: 7,
      status: 'pending_payment', gateway_subscription_id: 'sub_asaas_antiga',
    }],
  }))
  const payments = stubPayments({
    getSubscriptionPayments: async () => [{ id: 'pay_1', invoiceUrl: 'https://asaas.com/i/ja_existente' }],
  })
  const r = await subscribeClientToPlan({
    clienteId: 5, estabelecimentoId: 20, loyaltyPlanId: 7, remoteIp: '1.2.3.4', db, payments,
  })
  assert.equal(payments.calls.filter(([m]) => m === 'createSubscription').length, 0,
    'nao pode criar uma SEGUNDA assinatura no Asaas')
  assert.equal(r.reusedPending, true)
  // Quem clicou duas vezes quer pagar, nao quer um erro: devolve o MESMO link.
  assert.equal(r.checkoutUrl, 'https://asaas.com/i/ja_existente')
})
