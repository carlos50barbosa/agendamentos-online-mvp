// backend/src/routes/webhooks_asaas.js
// Webhook ÚNICO do Asaas: POST /webhooks/asaas
//  - Autenticação: header `asaas-access-token` == ASAAS_WEBHOOK_TOKEN (senão 401).
//  - Idempotência: a entrega é at least once; deduplicamos pelo id do evento
//    na tabela asaas_webhook_events.
//  - Resposta: 200 rápido; em erro de processamento respondemos 500 para o
//    Asaas reenviar (as operações são idempotentes). Auth/duplicado nunca 500.
//
// Distinção assinatura (tenant) x sinal (cliente) segue o brief:
//   - payment.subscription presente  -> cobrança de ASSINATURA (tenant)
//   - externalReference "deposit:<id>" -> cobrança de SINAL (appointment_payments.id)
import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../lib/db.js';
import { config } from '../lib/config.js';

const DEPOSIT_REF_PREFIX = 'deposit:';
const SUBSCRIPTION_REF_PREFIX = 'subscription:';

function safeJson(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

/** Comparação em tempo ~constante de dois tokens. */
export function isAuthorizedAsaasWebhook(headers = {}, expectedToken = config.asaas.webhookToken) {
  const provided = String(headers['asaas-access-token'] || headers['asaas_access_token'] || '');
  const expected = String(expectedToken || '');
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Normaliza o corpo do webhook Asaas para um descritor de ação.
 * @returns {{eventId:string|null, event:string, paymentId:string|null,
 *   subscriptionId:string|null, externalReference:string|null,
 *   kind:'subscription'|'deposit'|'unknown', internalId:number|null,
 *   action:'confirm'|'past_due'|'refunded'|'ignore'}}
 */
export function mapAsaasEvent(body = {}) {
  const event = String(body?.event || '').trim().toUpperCase();
  const payment = body?.payment || {};
  const eventId = body?.id ? String(body.id) : null;
  const paymentId = payment?.id ? String(payment.id) : null;
  const subscriptionId = payment?.subscription ? String(payment.subscription) : null;
  const externalReference = payment?.externalReference ? String(payment.externalReference) : null;

  let kind = 'unknown';
  let internalId = null;
  if (subscriptionId || externalReference?.startsWith(SUBSCRIPTION_REF_PREFIX)) {
    kind = 'subscription';
  } else if (externalReference?.startsWith(DEPOSIT_REF_PREFIX)) {
    kind = 'deposit';
    const parsed = Number(externalReference.slice(DEPOSIT_REF_PREFIX.length));
    internalId = Number.isFinite(parsed) ? parsed : null;
  }

  let action = 'ignore';
  if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') {
    action = 'refunded';
  } else if (event === 'PAYMENT_OVERDUE') {
    action = 'past_due';
  } else if (event === 'PAYMENT_RECEIVED') {
    // Saldo disponível: confirma sinal (brief) e também assinatura.
    action = 'confirm';
  } else if (event === 'PAYMENT_CONFIRMED') {
    // Pago mas saldo ainda não disponível: ativa assinatura; sinal aguarda RECEIVED.
    action = kind === 'subscription' ? 'confirm' : 'ignore';
  }

  return { eventId, event, paymentId, subscriptionId, externalReference, kind, internalId, action };
}

/**
 * Aplica a ação no banco. Idempotente (guardas por status na cláusula WHERE).
 * `db` é injetável para testes.
 */
export async function applyAsaasWebhookAction(descriptor, { db = pool, rawPayload = null } = {}) {
  const { kind, action, internalId, subscriptionId, paymentId, event, eventId } = descriptor;
  if (action === 'ignore' || kind === 'unknown') {
    return { handled: false, reason: 'ignored' };
  }

  if (kind === 'deposit') {
    if (internalId == null) return { handled: false, reason: 'missing_internal_id' };
    if (action === 'confirm') {
      const [r] = await db.query(
        `UPDATE appointment_payments
            SET status='paid', paid_at=NOW(), provider='asaas',
                provider_payment_id=COALESCE(provider_payment_id, ?),
                provider_reference=COALESCE(provider_reference, ?),
                raw_payload=?
          WHERE id=? AND provider='asaas' AND status='pending'`,
        [paymentId, paymentId, rawPayload, internalId],
      );
      const matched = (r?.affectedRows || 0) > 0;
      if (matched) {
        await db.query(
          `UPDATE agendamentos
              SET status='confirmado', deposit_paid_at=NOW()
            WHERE id=(SELECT agendamento_id FROM appointment_payments WHERE id=?)
              AND status='pendente_pagamento'`,
          [internalId],
        );
      }
      return { handled: true, kind, action, matched };
    }
    if (action === 'refunded') {
      const [r] = await db.query(
        `UPDATE appointment_payments SET status='refunded', raw_payload=?
          WHERE id=? AND provider='asaas' AND status IN ('paid','pending')`,
        [rawPayload, internalId],
      );
      return { handled: true, kind, action, matched: (r?.affectedRows || 0) > 0 };
    }
    // past_due não se aplica a PIX à vista do sinal.
    return { handled: false, reason: 'noop_deposit' };
  }

  // kind === 'subscription' (tenant)
  const [subRows] = await db.query(
    `SELECT id, estabelecimento_id, plan FROM subscriptions
      WHERE gateway='asaas' AND gateway_subscription_id=? LIMIT 1`,
    [subscriptionId],
  );
  const sub = subRows?.[0];
  if (!sub) return { handled: false, reason: 'subscription_not_found' };

  if (action === 'confirm') {
    await db.query(
      `UPDATE subscriptions
          SET status='active', last_payment_at=NOW(),
              gateway_payment_id=COALESCE(gateway_payment_id, ?), updated_at=NOW()
        WHERE id=?`,
      [paymentId, sub.id],
    );
    // Ativa o plano do estabelecimento (plano + ponteiro + status).
    await db.query(
      `UPDATE usuarios SET plan_status='active', plan=COALESCE(?, plan), plan_subscription_id=? WHERE id=?`,
      [sub.plan || null, String(sub.id), sub.estabelecimento_id],
    );
  } else {
    // past_due | refunded -> reverter para past_due (bloqueio suave; a rotina de
    // billing decide expiração/graça).
    await db.query(`UPDATE subscriptions SET status='past_due', updated_at=NOW() WHERE id=?`, [sub.id]);
    await db.query(`UPDATE usuarios SET plan_status='past_due' WHERE id=?`, [sub.estabelecimento_id]);
  }

  await db.query(
    `INSERT INTO subscription_events (subscription_id, event_type, gateway_event_id, payload)
     VALUES (?,?,?,?)`,
    [sub.id, event, eventId, rawPayload],
  );
  return { handled: true, kind, action, matched: true };
}

const router = Router();

// Reachability/health simples (o painel do Asaas pode testar a URL).
router.get('/', (_req, res) => res.status(200).json({ ok: true, provider: 'asaas' }));

router.post('/', async (req, res) => {
  if (!isAuthorizedAsaasWebhook(req.headers)) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const body = req.body || {};
  const descriptor = mapAsaasEvent(body);
  const rawPayload = safeJson(body);

  // Idempotência: registra o id do evento; duplicado -> no-op 200.
  if (descriptor.eventId) {
    try {
      await pool.query(
        `INSERT INTO asaas_webhook_events (id, event, payment_id) VALUES (?,?,?)`,
        [descriptor.eventId, descriptor.event, descriptor.paymentId],
      );
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(200).json({ received: true, duplicate: true });
      }
      // Falha ao registrar (ex.: DB indisponível) -> 500 para reenvio.
      console.error('[asaas/webhook] falha ao registrar evento', err?.message || err);
      return res.status(500).json({ error: 'persist_failed' });
    }
  }

  try {
    const result = await applyAsaasWebhookAction(descriptor, { rawPayload });
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    // Libera o dedupe para permitir reprocessamento no reenvio do Asaas.
    if (descriptor.eventId) {
      try {
        await pool.query(`DELETE FROM asaas_webhook_events WHERE id=?`, [descriptor.eventId]);
      } catch {}
    }
    console.error('[asaas/webhook] falha ao processar evento', err?.message || err);
    return res.status(500).json({ error: 'processing_failed' });
  }
});

export default router;
