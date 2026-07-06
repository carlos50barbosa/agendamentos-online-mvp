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
  const doc = onlyDigits(payer?.cpfCnpj);
  if (userId) {
    const [rows] = await db.query('SELECT asaas_customer_id FROM usuarios WHERE id=? LIMIT 1', [userId]);
    const existing = rows?.[0]?.asaas_customer_id;
    if (existing) {
      // O cliente pode ter sido criado antes SEM CPF (ex.: tentativa de assinatura
      // anterior). Se agora temos um CPF, atualiza (best-effort) para o Asaas aceitar
      // cobranças/assinaturas — senão volta "necessário preencher o CPF ou CNPJ".
      if (doc) {
        try {
          await payments.updateCustomer(existing, {
            cpfCnpj: doc,
            name: payer?.name || undefined,
            email: payer?.email ? String(payer.email).trim().toLowerCase() : undefined,
            phone: onlyDigits(payer?.phone),
          });
        } catch {
          // best-effort: se a atualização falhar, segue com o cliente em cache
        }
      }
      return existing;
    }
  }
  // Dedupe: cliente sem cache local (ex.: guest sem userId) pode já existir no Asaas.
  // Busca por CPF/CNPJ antes de criar para não duplicar.
  if (doc) {
    try {
      const found = await payments.getCustomerByCpfCnpj(doc);
      const foundId = found?.id ? String(found.id) : null;
      if (foundId) {
        if (userId) {
          await db
            .query(
              "UPDATE usuarios SET asaas_customer_id=? WHERE id=? AND (asaas_customer_id IS NULL OR asaas_customer_id='')",
              [foundId, userId],
            )
            .catch(() => {});
        }
        return foundId;
      }
    } catch {
      // busca best-effort; segue para criação
    }
  }
  const customer = await payments.createCustomer({
    name: payer?.name || 'Cliente',
    cpfCnpj: doc,
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
  walletId,
  splitCents,
  client,
  db = pool,
} = {}) {
  const payments = createAsaasPayments(client);
  const customerId = await resolveAsaasCustomerId({ payments, userId, payer, db });
  if (!customerId) throw new Error('asaas_customer_unresolved');

  const value = Math.max(0, Math.round(Number(amountCents || 0))) / 100; // Asaas usa reais
  // Split: repassa o valor do sinal para o walletId do estabelecimento (fixedValue em reais).
  const splitAmount = Math.max(0, Math.round(Number(splitCents || 0)));
  const split = walletId && splitAmount > 0
    ? [{ walletId: String(walletId), fixedValue: splitAmount / 100 }]
    : undefined;
  const charge = await payments.createPixCharge({
    customerId,
    value,
    dueDate: expiresAt || new Date(),
    description,
    externalReference,
    split,
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

/**
 * Estorna o sinal Asaas de um agendamento cancelado, se dentro da janela de reembolso
 * (refund_window_hours antes do início). Marca a origem (refund_initiated_by_cancellation)
 * ANTES de chamar o refund, pois o webhook PAYMENT_REFUNDED lê essa flag para não tratar o
 * estorno como inesperado. O estorno reverte o split automaticamente. Best-effort.
 * `client`/`db` são injetáveis para testes.
 */
export async function refundAsaasDepositForCancellation(appointmentId, { db = pool, client, ignoreWindow = false } = {}) {
  const [rows] = await db.query(
    `SELECT ap.id, ap.provider_payment_id, ap.status, a.inicio,
            COALESCE(es.refund_window_hours, 24) AS refund_window_hours
       FROM appointment_payments ap
       JOIN agendamentos a ON a.id = ap.agendamento_id
       LEFT JOIN establishment_settings es ON es.estabelecimento_id = ap.estabelecimento_id
      WHERE ap.agendamento_id=? AND ap.provider='asaas' AND ap.type='deposit'
      ORDER BY ap.id DESC LIMIT 1`,
    [appointmentId],
  );
  const row = rows?.[0];
  if (!row) return { refunded: false, reason: 'no_asaas_deposit' };
  if (String(row.status) !== 'paid') return { refunded: false, reason: 'not_paid' };
  if (!row.provider_payment_id) return { refunded: false, reason: 'missing_payment_id' };

  // `ignoreWindow` (ex.: estorno por no-show, quando o horário já passou) pula a janela.
  if (!ignoreWindow) {
    const windowHours = Number(row.refund_window_hours ?? 24) || 24;
    const inicioMs = row.inicio ? new Date(row.inicio).getTime() : null;
    // Dentro da janela = ainda falta pelo menos `windowHours` para o início do atendimento.
    const withinWindow = inicioMs != null ? inicioMs - Date.now() >= windowHours * 3_600_000 : true;
    if (!withinWindow) return { refunded: false, reason: 'outside_refund_window' };
  }

  await db.query(
    'UPDATE appointment_payments SET refund_initiated_by_cancellation=1 WHERE id=?',
    [row.id],
  );
  try {
    const payments = createAsaasPayments(client);
    await payments.refundPayment(row.provider_payment_id);
    return { refunded: true, paymentId: row.id };
  } catch (err) {
    console.error('[deposit][refund] falha ao estornar', row.id, err?.message || err);
    return { refunded: false, reason: 'refund_failed', error: err?.message || String(err) };
  }
}
