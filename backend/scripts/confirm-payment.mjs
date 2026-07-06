// backend/scripts/confirm-payment.mjs — simula o webhook PAYMENT_RECEIVED para confirmar
// um sinal local (o Asaas sandbox não alcança o localhost). Uso: node scripts/confirm-payment.mjs <appointment_payment_id>
import { pool } from '../src/lib/db.js'
import { config } from '../src/lib/config.js'

const payId = Number(process.argv[2])
const BACKEND = 'http://127.0.0.1:3002'
if (!Number.isFinite(payId)) { console.error('informe o appointment_payment_id'); process.exit(1) }

try {
  const [[pay]] = await pool.query(
    'SELECT id, provider, provider_payment_id, amount_centavos, status, agendamento_id FROM appointment_payments WHERE id=?',
    [payId],
  )
  if (!pay) { console.error('pagamento', payId, 'não encontrado'); process.exit(1) }
  console.log('ANTES  :', { pay_status: pay.status, provider: pay.provider, provider_payment_id: pay.provider_payment_id })

  const value = pay.amount_centavos / 100
  const evt = {
    id: 'evt_confirm_' + payId + '_' + pay.provider_payment_id,
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: pay.provider_payment_id,
      externalReference: 'deposit:' + payId,
      value,
      netValue: value - config.signal.asaasPixFeeCents / 100,
    },
  }
  const resp = await fetch(BACKEND + '/webhooks/asaas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': config.asaas.webhookToken },
    body: JSON.stringify(evt),
  })
  console.log('WEBHOOK:', resp.status, JSON.stringify(await resp.json().catch(() => ({}))))

  await new Promise((r) => setTimeout(r, 300))
  const [[after]] = await pool.query(
    'SELECT ap.status AS pay_status, ap.paid_at, ap.asaas_fee_centavos, a.status AS ag_status FROM appointment_payments ap JOIN agendamentos a ON a.id=ap.agendamento_id WHERE ap.id=?',
    [payId],
  )
  console.log('DEPOIS :', after)
} catch (e) {
  console.error('erro:', e?.message || e)
  process.exitCode = 1
} finally {
  await pool.end()
}
