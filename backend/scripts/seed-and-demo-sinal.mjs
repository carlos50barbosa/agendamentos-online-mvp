// backend/scripts/seed-and-demo-sinal.mjs
// Semeia estabelecimento (pro) + cliente + serviço + horários + config do sinal,
// cria um agendamento pendente com sinal Asaas e DISPARA o webhook real no backend
// (deve estar rodando em :3002) para confirmar. Re-executável (limpa pelos emails).
import bcrypt from 'bcryptjs'
import { pool } from '../src/lib/db.js'
import { config } from '../src/lib/config.js'
import { computeSignal } from '../src/lib/signal_calculator.js'

const ESTAB_EMAIL = 'estab.sinal@teste.local'
const CLIENT_EMAIL = 'cliente.sinal@teste.local'
const PASSWORD = 'Teste@123'
const WALLET = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' // placeholder (sandbox PF não gera subconta)
const BACKEND = 'http://127.0.0.1:3002'
const q = (sql, params) => pool.query(sql, params)

try {
  const hash = await bcrypt.hash(PASSWORD, 10)

  // --- limpeza idempotente ---
  const [estabOld] = await q('SELECT id FROM usuarios WHERE email=?', [ESTAB_EMAIL])
  if (estabOld[0]) {
    const oldId = estabOld[0].id
    await q('DELETE FROM agendamentos WHERE estabelecimento_id=?', [oldId]) // cascata -> appointment_payments
    await q('DELETE FROM servicos WHERE estabelecimento_id=?', [oldId])
    await q('DELETE FROM establishment_settings WHERE estabelecimento_id=?', [oldId])
    await q('DELETE FROM estabelecimento_perfis WHERE estabelecimento_id=?', [oldId])
  }
  await q('DELETE FROM usuarios WHERE email IN (?,?)', [ESTAB_EMAIL, CLIENT_EMAIL])

  // --- estabelecimento (pro, ativo, onboarding concluído) ---
  const [estIns] = await q(
    `INSERT INTO usuarios (nome, email, senha_hash, tipo, cpf_cnpj, telefone, plan, plan_status, onboarding_concluido, onboarding_etapa)
     VALUES (?,?,?,'estabelecimento',?,?,'pro','active',1,'concluido')`,
    ['Barbearia Teste', ESTAB_EMAIL, hash, '12345678000199', '11988887777'],
  )
  const estId = estIns.insertId

  // --- cliente ---
  const [cliIns] = await q(
    `INSERT INTO usuarios (nome, email, senha_hash, tipo, cpf_cnpj, telefone, plan, plan_status)
     VALUES (?,?,?,'cliente',?,?,'starter','active')`,
    ['Cliente Teste', CLIENT_EMAIL, hash, '24971563792', '11977776666'],
  )
  const cliId = cliIns.insertId

  // --- serviço R$100 / 30min ---
  const [svcIns] = await q(
    `INSERT INTO servicos (estabelecimento_id, nome, descricao, duracao_min, preco_centavos, capacidade_por_horario, ativo)
     VALUES (?,?,?,30,10000,1,1)`,
    [estId, 'Corte Masculino', 'Corte + acabamento'],
  )
  const svcId = svcIns.insertId

  // --- horários (todos os dias 08:00-20:00) ---
  const horarios = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ weekday: i, start: '08:00', end: '20:00' })))
  await q('INSERT INTO estabelecimento_perfis (estabelecimento_id, horarios_json) VALUES (?,?)', [estId, horarios])

  // --- config do sinal (30%, wallet placeholder) ---
  await q(
    `INSERT INTO establishment_settings
       (estabelecimento_id, deposit_enabled, deposit_percent, deposit_hold_minutes, deposit_type, refund_window_hours, retain_on_no_show, asaas_wallet_id)
     VALUES (?,1,30,15,'PERCENT',24,1,?)`,
    [estId, WALLET],
  )

  // --- cálculo do sinal (usa a mesma calculadora do app) ---
  const sig = computeSignal({
    servicePriceCents: 10000,
    config: { type: 'PERCENT', percent: 30 },
    systemMinCents: config.signal.minCents,
    platformFeeCents: config.signal.platformFeeCents,
    asaasFeeEstimateCents: config.signal.asaasPixFeeCents,
  })

  // --- agendamento pendente_pagamento (amanhã 10:00) ---
  const inicio = new Date(Date.now() + 24 * 3600 * 1000); inicio.setHours(10, 0, 0, 0)
  const fim = new Date(inicio.getTime() + 30 * 60000)
  const expires = new Date(Date.now() + 15 * 60000)
  const [agIns] = await q(
    `INSERT INTO agendamentos
       (cliente_id, estabelecimento_id, servico_id, inicio, fim, status, total_centavos, deposit_required, deposit_percent, deposit_centavos, deposit_expires_at)
     VALUES (?,?,?,?,?,'pendente_pagamento',10000,1,30,?,?)`,
    [cliId, estId, svcId, inicio, fim, sig.totalCents, expires],
  )
  const agId = agIns.insertId

  // --- appointment_payment pendente (asaas + split) ---
  const providerPaymentId = 'pay_seed_' + agId
  const [payIns] = await q(
    `INSERT INTO appointment_payments
       (agendamento_id, estabelecimento_id, type, status, amount_centavos, percent, split_centavos, platform_fee_centavos, provider, provider_payment_id, provider_reference, expires_at)
     VALUES (?,?,'deposit','pending',?,30,?,?,'asaas',?,?,?)`,
    [agId, estId, sig.totalCents, sig.splitCents, config.signal.platformFeeCents, providerPaymentId, 'deposit:tmp', expires],
  )
  const payId = payIns.insertId
  await q('UPDATE appointment_payments SET provider_reference=? WHERE id=?', ['deposit:' + payId, payId])

  console.log('=== SEED ===')
  console.log('estabelecimento_id:', estId, '| cliente_id:', cliId, '| servico_id:', svcId)
  console.log('agendamento_id:', agId, '| appointment_payment_id:', payId, '| externalReference: deposit:' + payId)
  console.log('sinal:', { totalCents: sig.totalCents, splitCents: sig.splitCents, platformFeeCents: sig.platformFeeCents })

  // --- ANTES ---
  const [[before]] = await pool.query(
    'SELECT ap.status AS pay_status, ap.asaas_fee_centavos, a.status AS ag_status FROM appointment_payments ap JOIN agendamentos a ON a.id=ap.agendamento_id WHERE ap.id=?',
    [payId],
  )
  console.log('\nANTES do webhook:', before)

  // --- DISPARA O WEBHOOK REAL (backend em :3002) ---
  const evt = {
    id: 'evt_seed_' + payId,
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: providerPaymentId,
      externalReference: 'deposit:' + payId,
      value: sig.totalCents / 100,
      netValue: (sig.totalCents - config.signal.asaasPixFeeCents) / 100,
    },
  }
  const resp = await fetch(BACKEND + '/webhooks/asaas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': config.asaas.webhookToken },
    body: JSON.stringify(evt),
  })
  console.log('\nPOST /webhooks/asaas ->', resp.status, JSON.stringify(await resp.json().catch(() => ({}))))

  // --- DEPOIS ---
  await new Promise((r) => setTimeout(r, 300))
  const [[after]] = await pool.query(
    'SELECT ap.status AS pay_status, ap.paid_at, ap.asaas_fee_centavos, ap.split_centavos, a.status AS ag_status, a.deposit_paid_at FROM appointment_payments ap JOIN agendamentos a ON a.id=ap.agendamento_id WHERE ap.id=?',
    [payId],
  )
  console.log('DEPOIS do webhook :', after)

  console.log('\n=== CREDENCIAIS (para explorar no navegador :3003) ===')
  console.log('Estabelecimento: ', ESTAB_EMAIL, '/', PASSWORD)
  console.log('Cliente:         ', CLIENT_EMAIL, '/', PASSWORD)
} catch (e) {
  console.error('❌ Erro no seed/demo:', e?.message || e)
  process.exitCode = 1
} finally {
  await pool.end()
}
