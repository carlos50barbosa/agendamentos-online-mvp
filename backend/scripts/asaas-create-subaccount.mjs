// backend/scripts/asaas-create-subaccount.mjs — cria uma subconta no SANDBOX e devolve o walletId.
// Uso: node scripts/asaas-create-subaccount.mjs
process.env.DB_HOST ??= 'x'; process.env.DB_USER ??= 'x'; process.env.DB_PASS ??= 'x'
process.env.DB_NAME ??= 'x'; process.env.JWT_SECRET ??= 'x'
const { createAsaasClient } = await import('../src/services/asaas/client.js')
const client = createAsaasClient({ apiKey: process.env.ASAAS_API_KEY, env: (process.env.ASAAS_ENV || 'sandbox').toLowerCase() })

const rand = Math.floor(Math.random() * 1e6)
const body = {
  name: 'Estabelecimento Teste (subconta sinal)',
  email: `estab-sub-${rand}@example.com`,
  loginEmail: `estab-sub-${rand}@example.com`,
  cpfCnpj: '11144477735', // CPF de teste válido
  birthDate: '1990-01-01',
  mobilePhone: '11999990000',
  incomeValue: 5000,
  address: 'Rua Teste',
  addressNumber: '100',
  province: 'Centro',
  postalCode: '01001000',
}

try {
  const acc = await client.post('/v3/accounts', { body })
  console.log('✅ Subconta criada.')
  console.log('   walletId :', acc.walletId)
  console.log('   accountId:', acc.id)
  console.log('   apiKey   :', acc.apiKey ? String(acc.apiKey).slice(0, 12) + '… (não usar/mostrar)' : '(sem apiKey no retorno)')
  console.log('\nUSE ESTE walletId no seed:', acc.walletId)
} catch (e) {
  console.error('❌ Falha ao criar subconta:', e?.message)
  if (e?.body) console.error('   corpo:', JSON.stringify(e.body).slice(0, 500))
}
