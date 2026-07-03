// backend/src/lib/deposit_provider.js
// Adaptador de provider para o SINAL (depósito) do agendamento.
// Objetivo: quando DEPOSIT_PROVIDER=asaas, gerar o PIX via Asaas devolvendo o
// MESMO shape do Mercado Pago (payment.point_of_interaction.transaction_data),
// para que todo o código a jusante (armazenamento em raw_payload, refresh do
// PIX, extractPixPayloadFromRaw, resposta) permaneça inalterado.
//
// Modelo atual: conta única da plataforma (sem split/subconta por estabelecimento).
import { pool } from './db.js';
import { createAsaasPayments } from '../services/asaas/payments.js';

/** Provider ativo para o sinal (independente do provider da assinatura). */
export function resolveDepositProvider() {
  const v = String(process.env.DEPOSIT_PROVIDER || 'mercadopago').trim().toLowerCase();
  return v === 'asaas' ? 'asaas' : 'mercadopago';
}

function onlyDigits(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  return d || undefined;
}

/** Resolve (ou cria) o cliente Asaas do usuário, cacheando em usuarios.asaas_customer_id. */
export async function resolveAsaasCustomerId({ payments, userId, payer, db = pool }) {
  if (userId) {
    const [rows] = await db.query('SELECT asaas_customer_id FROM usuarios WHERE id=? LIMIT 1', [userId]);
    const existing = rows?.[0]?.asaas_customer_id;
    if (existing) return existing;
  }
  const customer = await payments.createCustomer({
    name: payer?.name || 'Cliente',
    cpfCnpj: onlyDigits(payer?.cpfCnpj),
    email: payer?.email ? String(payer.email).trim().toLowerCase() : undefined,
    phone: onlyDigits(payer?.phone),
  });
  const customerId = customer?.id ? String(customer.id) : null;
  if (userId && customerId) {
    await db
      .query(
        "UPDATE usuarios SET asaas_customer_id=? WHERE id=? AND (asaas_customer_id IS NULL OR asaas_customer_id='')",
        [customerId, userId],
      )
      .catch(() => {});
  }
  return customerId;
}

/**
 * Cria a cobrança PIX do sinal no Asaas e devolve { payment, pix, providerPaymentId }
 * no shape compatível com o Mercado Pago.
 * `client`/`db` são injetáveis para testes.
 */
export async function createAsaasDepositPixPayment({
  amountCents,
  description,
  externalReference,
  payer,
  userId,
  expiresAt,
  client,
  db = pool,
} = {}) {
  const payments = createAsaasPayments(client);
  const customerId = await resolveAsaasCustomerId({ payments, userId, payer, db });
  if (!customerId) throw new Error('asaas_customer_unresolved');

  const value = Math.max(0, Math.round(Number(amountCents || 0))) / 100; // Asaas usa reais
  const charge = await payments.createPixCharge({
    customerId,
    value,
    dueDate: expiresAt || new Date(),
    description,
    externalReference,
  });
  const chargeId = charge?.id ? String(charge.id) : null;
  if (!chargeId) throw new Error('asaas_charge_missing_id');

  const qr = await payments.getPixQrCode(chargeId);
  const ticketUrl = charge.invoiceUrl || charge.bankSlipUrl || null;

  // Shape compatível com MP para reuso de extractPixPayloadFromRaw / refresh.
  const payment = {
    id: chargeId,
    status: charge.status || 'PENDING',
    transaction_amount: value,
    date_of_expiration: qr.expirationDate || null,
    external_reference: externalReference,
    __provider: 'asaas',
    point_of_interaction: {
      transaction_data: {
        qr_code: qr.payload || null,
        qr_code_base64: qr.encodedImage || null,
        copia_e_cola: qr.payload || null,
        ticket_url: ticketUrl,
        expires_at: qr.expirationDate || null,
      },
    },
  };

  const pix = {
    payment_id: chargeId,
    qr_code: qr.payload || null,
    qr_code_base64: qr.encodedImage || null,
    copia_e_cola: qr.payload || null,
    ticket_url: ticketUrl,
    expires_at: qr.expirationDate || null,
    amount_cents: Math.round(value * 100),
  };

  return { payment, pix, providerPaymentId: chargeId };
}
