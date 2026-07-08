// backend/scripts/asaas-wallet-discover.mjs — descobre um walletId utilizável no sandbox.
process.env.DB_HOST ??= '127.0.0.1'; process.env.DB_USER ??= 'x'; process.env.DB_PASS ??= 'x'
process.env.DB_NAME ??= 'x'; process.env.JWT_SECRET ??= 'x'
const { createAsaasClient } = await import('../src/services/asaas/client.js')
const apiKey = process.env.ASAAS_API_KEY
const client = createAsaasClient({ apiKey, env: (process.env.ASAAS_ENV || 'sandbox').toLowerCase() })

async function tryIt(label, fn) {
  try { const r = await fn(); console.log(`✅ ${label}:`, JSON.stringify(r).slice(0, 300)) }
  catch (e) { console.log(`❌ ${label}:`, e?.message, JSON.stringify(e?.body || '').slice(0, 200)) }
}

// 1) walletId da própria conta da plataforma
await tryIt('GET /v3/wallets', () => client.get('/v3/wallets'))
// 2) subcontas existentes
await tryIt('GET /v3/accounts', () => client.get('/v3/accounts', { query: { limit: 10 } }))
