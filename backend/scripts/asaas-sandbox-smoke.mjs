// backend/scripts/asaas-sandbox-smoke.mjs
// Smoke test do Asaas contra a API REAL (use SEMPRE sandbox).
// Exercita client.js + payments.js: createCustomer -> createPixCharge ->
// getPixQrCode -> createSubscription -> getSubscriptionPayments.
//
// Uso (na pasta backend/):
//   PowerShell:  $env:ASAAS_API_KEY="<key_sandbox>"; $env:ASAAS_ENV="sandbox"; node scripts/asaas-sandbox-smoke.mjs
//   bash:        ASAAS_API_KEY=<key_sandbox> ASAAS_ENV=sandbox node scripts/asaas-sandbox-smoke.mjs
// (ou coloque ASAAS_API_KEY/ASAAS_ENV no backend/.env e rode: node scripts/asaas-sandbox-smoke.mjs)

// stubs de DB só para o config.js não exigir banco (o script não toca no banco)
process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'x'
process.env.DB_PASS ??= 'x'
process.env.DB_NAME ??= 'x'
process.env.JWT_SECRET ??= 'x'

const { createAsaasClient } = await import('../src/services/asaas/client.js')
const { createAsaasPayments } = await import('../src/services/asaas/payments.js')

const apiKey = process.env.ASAAS_API_KEY
const env = (process.env.ASAAS_ENV || 'sandbox').toLowerCase()

if (!apiKey) {
  console.error('❌ Defina ASAAS_API_KEY (chave de SANDBOX).')
  process.exit(1)
}
if (env === 'production' || env === 'prod') {
  console.error('❌ ASAAS_ENV=production — este smoke test é só para sandbox. Abortando por segurança.')
  process.exit(1)
}

const client = createAsaasClient({ apiKey, env })
const pay = createAsaasPayments(client)

const ok = (s, d) => console.log(`\n✅ ${s}\n`, d)
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)

try {
  console.log(`Base URL: ${client.baseUrl}  (env=${env})`)

  const customer = await pay.createCustomer({
    name: 'Cliente Sandbox (smoke)',
    cpfCnpj: '24971563792', // CPF de teste válido; troque se precisar
    email: 'sandbox-smoke@example.com',
    phone: '11999998888',
  })
  ok('createCustomer', { id: customer.id, name: customer.name })

  const charge = await pay.createPixCharge({
    customerId: customer.id,
    value: 5.0,
    dueDate: tomorrow,
    description: 'Sinal - smoke test',
    externalReference: 'deposit:smoke',
  })
  ok('createPixCharge (sinal)', { id: charge.id, status: charge.status, invoiceUrl: charge.invoiceUrl })

  const qr = await pay.getPixQrCode(charge.id)
  ok('getPixQrCode', {
    tem_QR_base64: Boolean(qr.encodedImage),
    payload_inicio: (qr.payload || '').slice(0, 40) + '…',
    expirationDate: qr.expirationDate,
  })

  const sub = await pay.createSubscription({
    customerId: customer.id,
    value: 29.9,
    cycle: 'MONTHLY',
    nextDueDate: new Date(),
    billingType: 'UNDEFINED',
    description: 'Assinatura Pro - smoke test',
    externalReference: 'subscription:smoke',
  })
  ok('createSubscription (tenant)', { id: sub.id, status: sub.status })

  const charges = await pay.getSubscriptionPayments(sub.id)
  ok('getSubscriptionPayments', {
    quantidade: charges.length,
    primeira_cobranca_id: charges[0]?.id || null,
    checkout_hospedado: charges[0]?.invoiceUrl || null,
  })

  console.log('\n🎉 SANDBOX OK — client + payments funcionando contra o Asaas real.')
  console.log('   (nenhum banco/produção foi tocado; foram criados registros de teste no sandbox)')
} catch (e) {
  console.error('\n❌ FALHOU:', e?.message || e)
  if (e?.status) console.error('   HTTP:', e.status)
  if (e?.body) console.error('   corpo:', JSON.stringify(e.body).slice(0, 400))
  process.exit(1)
}
