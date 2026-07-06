// backend/scripts/asaas-sandbox-split-smoke.mjs
// Valida o CONTRATO do split (campo `split` + `fixedValue`) e os métodos novos do
// gateway (getPayment/deletePayment) contra o Asaas SANDBOX real.
//   Uso (na pasta backend/):  node scripts/asaas-sandbox-split-smoke.mjs
process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'x'
process.env.DB_PASS ??= 'x'
process.env.DB_NAME ??= 'x'
process.env.JWT_SECRET ??= 'x'

const { createAsaasClient } = await import('../src/services/asaas/client.js')
const { createAsaasPayments } = await import('../src/services/asaas/payments.js')

const apiKey = process.env.ASAAS_API_KEY
const env = (process.env.ASAAS_ENV || 'sandbox').toLowerCase()
if (!apiKey) { console.error('❌ Defina ASAAS_API_KEY (sandbox).'); process.exit(1) }
if (env === 'production' || env === 'prod') { console.error('❌ ASAAS_ENV=production — abortando.'); process.exit(1) }

const client = createAsaasClient({ apiKey, env })
const pay = createAsaasPayments(client)
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)

try {
  console.log(`Base URL: ${client.baseUrl} (env=${env})\n`)

  const customer = await pay.createCustomer({
    name: 'Cliente Split (smoke)', cpfCnpj: '24971563792',
    email: `split-smoke-${Date.now()}@example.com`, phone: '11999998888',
  })
  console.log('✅ createCustomer:', customer.id)

  // 1) Tenta um walletId real de subconta existente (teste POSITIVO).
  let walletId = null
  try {
    const accounts = await client.get('/v3/accounts', { query: { limit: 20 } })
    const withWallet = (accounts?.data || []).find((a) => a.walletId)
    if (withWallet) { walletId = withWallet.walletId; console.log('ℹ️  walletId de subconta existente:', walletId) }
    else console.log('ℹ️  Nenhuma subconta com walletId no sandbox.')
  } catch (e) {
    console.log('ℹ️  GET /v3/accounts indisponível:', e?.message || e)
  }

  if (walletId) {
    // Teste POSITIVO: cobrança com split para uma wallet real.
    const charge = await pay.createPixCharge({
      customerId: customer.id, value: 5.0, dueDate: tomorrow,
      description: 'Split smoke (positivo)', externalReference: 'deposit:split-smoke',
      split: [{ walletId, fixedValue: 2.5 }],
    })
    console.log('✅ createPixCharge COM split:', charge.id, 'status', charge.status)
    const full = await pay.getPayment(charge.id)
    console.log('✅ getPayment.split =', JSON.stringify(full?.split))
    if (Array.isArray(full?.split) && full.split.length) {
      console.log('🎉 CONTRATO CONFIRMADO: Asaas aceitou o split e o refletiu na cobrança (campo `split`, `fixedValue`).')
    } else {
      console.log('⚠️  A cobrança não trouxe `split` — inspecionar o corpo:', JSON.stringify(full).slice(0, 400))
    }
    await pay.deletePayment(charge.id)
    console.log('✅ deletePayment OK (cobrança de teste removida).')
  } else {
    // Teste NEGATIVO de contrato: walletId inválido deve gerar erro de wallet
    // (o que prova que o Asaas PARSEOU o campo `split`/`fixedValue`).
    try {
      await pay.createPixCharge({
        customerId: customer.id, value: 5.0, dueDate: tomorrow,
        description: 'Split contract probe', externalReference: 'deposit:probe',
        split: [{ walletId: '00000000-0000-0000-0000-000000000000', fixedValue: 2.5 }],
      })
      console.log('⚠️  Asaas ACEITOU split com walletId inválido — o campo pode estar sendo IGNORADO. Revisar contrato!')
    } catch (e) {
      const blob = JSON.stringify(e?.body || e?.message || '').toLowerCase()
      if (blob.includes('wallet') || blob.includes('split') || blob.includes('carteira')) {
        console.log('🎉 CONTRATO CONFIRMADO: Asaas parseou `split`/`walletId` e rejeitou a wallet inválida.')
        console.log('   erro do Asaas:', JSON.stringify(e?.body))
      } else {
        console.log('❓ Erro não relacionado a wallet/split:', e?.message, JSON.stringify(e?.body))
      }
    }

    // getPayment + deletePayment num charge simples (valida os métodos novos).
    const plain = await pay.createPixCharge({
      customerId: customer.id, value: 5.0, dueDate: tomorrow,
      description: 'getPayment/deletePayment smoke', externalReference: 'deposit:methods',
    })
    const got = await pay.getPayment(plain.id)
    console.log('✅ getPayment OK:', got.id, 'status', got.status)
    await pay.deletePayment(plain.id)
    console.log('✅ deletePayment OK.')
  }

  console.log('\n🎉 Split smoke concluído (sandbox real; nenhum banco/produção tocado).')
} catch (e) {
  console.error('\n❌ FALHOU:', e?.message || e)
  if (e?.status) console.error('   HTTP:', e.status)
  if (e?.body) console.error('   corpo:', JSON.stringify(e.body).slice(0, 500))
  process.exit(1)
}
