// backend/src/routes/webhooks_asaas.js
// Webhook ÚNICO do Asaas: POST /webhooks/asaas
//  - Autenticação: header `asaas-access-token` == ASAAS_WEBHOOK_TOKEN (senão 401).
//  - Idempotência: a entrega é at least once; deduplicamos pelo id do evento
//    na tabela asaas_webhook_events (guardando payload + processed_at + error).
//  - Resposta: 200 sempre que o evento foi registrado — inclusive em erro de
//    processamento (processed_at fica NULL + error persistido p/ reprocesso), para
//    NÃO pausar a fila do Asaas. Só 401 (auth) e 500 (falha ao persistir o evento).
//
// Distinção assinatura (tenant) x sinal (cliente) segue o brief:
//   - payment.subscription presente  -> cobrança de ASSINATURA (tenant)
//   - externalReference "deposit:<id>" -> cobrança de SINAL (appointment_payments.id)
import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { cancelPendingPaymentAppointmentTx } from '../lib/appointment_loyalty.js';
import { notifyAppointmentConfirmed } from '../lib/appointment_confirmation.js';
import { confirmAsaasTopupByChargeId, expireAsaasTopupByChargeId } from '../lib/billing.js';
import { toDatabaseDateTime } from '../lib/database_datetime.js';
import {
  activateClientPlanCycle,
  markClientPlanPastDue,
  revokeClientPlanForRefund,
} from '../lib/client_loyalty_asaas.js';

const DEPOSIT_REF_PREFIX = 'deposit:';
const SUBSCRIPTION_REF_PREFIX = 'subscription:';
const TOPUP_REF_PREFIX = 'topup:';
// Plano recorrente do CLIENTE no estabelecimento (fidelidade). Ver docs/PLANO-FIDELIDADE-ASAAS.md.
const CLIENT_PLAN_REF_PREFIX = 'clientplan:';

/** Avança a data em 1 ciclo (mensal por padrão; anual quando billing_cycle='anual'). */
function addCycle(base, billingCycle) {
  const d = new Date(base);
  if (String(billingCycle || '').toLowerCase() === 'anual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** billingType do Asaas -> payment_method (enum credit_card|pix). null = não sobrescreve. */
function normalizeAsaasPaymentMethod(billingType) {
  const t = String(billingType || '').trim().toUpperCase();
  if (t === 'CREDIT_CARD') return 'credit_card';
  if (t === 'PIX') return 'pix';
  return null;
}

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
 *   action:'confirm'|'past_due'|'refunded'|'fail_release'|'ignore',
 *   valueCents:number|null, netValueCents:number|null}}
 */
export function mapAsaasEvent(body = {}) {
  const event = String(body?.event || '').trim().toUpperCase();
  const payment = body?.payment || {};
  const eventId = body?.id ? String(body.id) : null;
  const paymentId = payment?.id ? String(payment.id) : null;
  const subscriptionId = payment?.subscription ? String(payment.subscription) : null;
  const externalReference = payment?.externalReference ? String(payment.externalReference) : null;
  const dueDate = payment?.dueDate ? String(payment.dueDate) : null;
  const billingType = payment?.billingType ? String(payment.billingType) : null;

  let kind = 'unknown';
  let internalId = null;
  // O plano do CLIENTE é testado PRIMEIRO, e isso não é estilo — é correção.
  // Toda cobrança gerada por uma assinatura Asaas traz `payment.subscription` preenchido,
  // inclusive a do plano do cliente. Se o teste de `subscriptionId` viesse antes, ela cairia
  // no ramo da assinatura do TENANT, iria procurar em `subscriptions WHERE gateway='asaas'`
  // e morreria em subscription_not_found — com dinheiro real no meio e sem crédito liberado.
  if (externalReference?.startsWith(CLIENT_PLAN_REF_PREFIX)) {
    kind = 'client_plan';
    const parsed = Number(externalReference.slice(CLIENT_PLAN_REF_PREFIX.length));
    internalId = Number.isFinite(parsed) ? parsed : null;
  } else if (subscriptionId || externalReference?.startsWith(SUBSCRIPTION_REF_PREFIX)) {
    kind = 'subscription';
  } else if (externalReference?.startsWith(DEPOSIT_REF_PREFIX)) {
    kind = 'deposit';
    const parsed = Number(externalReference.slice(DEPOSIT_REF_PREFIX.length));
    internalId = Number.isFinite(parsed) ? parsed : null;
  } else if (externalReference?.startsWith(TOPUP_REF_PREFIX)) {
    // Topup (recarga WhatsApp): a subscription é localizada pelo paymentId (== gateway_payment_id).
    kind = 'topup';
  }

  // Pago -> confirma (RECEIVED = saldo disponível; CONFIRMED = pago mas saldo ainda
  // pendente, cobre bloqueio cautelar de conta PF). Vencido/removido -> libera o sinal.
  let action = 'ignore';
  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    action = 'confirm';
  } else if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') {
    action = 'refunded';
  } else if (event === 'PAYMENT_OVERDUE') {
    action = (kind === 'deposit' || kind === 'topup') ? 'fail_release' : 'past_due';
  } else if (event === 'PAYMENT_DELETED') {
    action = (kind === 'deposit' || kind === 'topup') ? 'fail_release' : 'ignore';
  }

  const valueCents = Number.isFinite(Number(payment?.value)) ? Math.round(Number(payment.value) * 100) : null;
  const netValueCents = Number.isFinite(Number(payment?.netValue)) ? Math.round(Number(payment.netValue) * 100) : null;

  return {
    eventId, event, paymentId, subscriptionId, externalReference,
    kind, internalId, action, valueCents, netValueCents, dueDate, billingType,
  };
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

  if (kind === 'client_plan') {
    // Plano recorrente do cliente no estabelecimento. O id vem do externalReference
    // (`clientplan:<client_loyalty_subscriptions.id>`), e NÃO do payment.subscription — ver
    // o comentário do roteamento em mapAsaasEvent.
    if (internalId == null) return { handled: false, reason: 'missing_internal_id' };
    if (action === 'confirm') {
      return activateClientPlanCycle({ subscriptionId: internalId, paymentId, db, rawPayload });
    }
    if (action === 'past_due') {
      return markClientPlanPastDue({ subscriptionId: internalId, db });
    }
    if (action === 'refunded') {
      return revokeClientPlanForRefund({ subscriptionId: internalId, db });
    }
    return { handled: false, reason: 'noop_client_plan' };
  }

  if (kind === 'topup') {
    // Topup (recarga WhatsApp): confirma credita a carteira; overdue/deleted expira o pendente.
    if (action === 'confirm') return confirmAsaasTopupByChargeId(paymentId, { db });
    if (action === 'fail_release') return expireAsaasTopupByChargeId(paymentId, { db });
    return { handled: false, reason: 'noop_topup' };
  }

  if (kind === 'deposit') {
    if (internalId == null) return { handled: false, reason: 'missing_internal_id' };

    // Carrega a linha do sinal (agendamento + split + origem do estorno) numa só leitura.
    const [payRows] = await db.query(
      `SELECT agendamento_id, split_centavos, refund_initiated_by_cancellation
         FROM appointment_payments WHERE id=? AND provider='asaas' LIMIT 1`,
      [internalId],
    );
    const payRow = payRows?.[0] || null;
    const agendamentoId = payRow?.agendamento_id ?? null;

    if (action === 'confirm') {
      // Taxa real do Asaas = value - netValue (quando presentes no evento).
      const { valueCents, netValueCents } = descriptor;
      const asaasFeeCents =
        valueCents != null && netValueCents != null ? Math.max(0, valueCents - netValueCents) : null;
      const [r] = await db.query(
        `UPDATE appointment_payments
            SET status='paid', paid_at=NOW(), provider='asaas',
                asaas_fee_centavos=COALESCE(?, asaas_fee_centavos),
                provider_payment_id=COALESCE(provider_payment_id, ?),
                provider_reference=COALESCE(provider_reference, ?),
                raw_payload=?
          WHERE id=? AND provider='asaas' AND status='pending'`,
        [asaasFeeCents, paymentId, paymentId, rawPayload, internalId],
      );
      const matched = (r?.affectedRows || 0) > 0;
      if (matched && agendamentoId != null) {
        await db.query(
          `UPDATE agendamentos SET status='confirmado', deposit_paid_at=NOW()
            WHERE id=? AND status='pendente_pagamento'`,
          [agendamentoId],
        );
      }
      return { handled: true, kind, action, matched, agendamentoId, notify: matched ? 'confirmed' : null };
    }

    if (action === 'refunded') {
      const [r] = await db.query(
        `UPDATE appointment_payments SET status='refunded', refunded_at=NOW(), raw_payload=?
          WHERE id=? AND provider='asaas' AND status IN ('paid','pending')`,
        [rawPayload, internalId],
      );
      const matched = (r?.affectedRows || 0) > 0;
      if (matched && agendamentoId != null) {
        await db.query(
          `UPDATE agendamentos SET status='cancelado'
            WHERE id=? AND status NOT IN ('cancelado','concluido')`,
          [agendamentoId],
        );
      }
      // Estorno não originado de um cancelamento nosso -> avisar o estabelecimento.
      const unexpectedRefund = matched && !payRow?.refund_initiated_by_cancellation;
      return { handled: true, kind, action, matched, agendamentoId, unexpectedRefund };
    }

    if (action === 'fail_release') {
      const [r] = await db.query(
        `UPDATE appointment_payments SET status='failed', raw_payload=?
          WHERE id=? AND provider='asaas' AND status='pending'`,
        [rawPayload, internalId],
      );
      const matched = (r?.affectedRows || 0) > 0;
      if (matched && agendamentoId != null) {
        await cancelPendingPaymentAppointmentTx(agendamentoId, { db });
      }
      return { handled: true, kind, action, matched, agendamentoId };
    }

    return { handled: false, reason: 'noop_deposit' };
  }

  // kind === 'subscription' (tenant)
  const [subRows] = await db.query(
    `SELECT id, estabelecimento_id, plan, billing_cycle FROM subscriptions
      WHERE gateway='asaas' AND gateway_subscription_id=? LIMIT 1`,
    [subscriptionId],
  );
  const sub = subRows?.[0];
  if (!sub) return { handled: false, reason: 'subscription_not_found' };

  let matched = false;
  if (action === 'confirm') {
    // Grava o PERIODO pago (fim do ciclo = vencimento da cobranca, ou agora, + 1 ciclo). Sem isso o
    // motor de billing reverte a ativacao (dueAt no passado -> expired) e nao ha janela de carencia.
    const periodEnd = toDatabaseDateTime(addCycle(descriptor.dueDate ? new Date(descriptor.dueDate) : new Date(), sub.billing_cycle));
    const paymentMethod = normalizeAsaasPaymentMethod(descriptor.billingType); // real (credit_card|pix), nao 'pix' fixo
    // Guard status<>'canceled': nao reativa/repointa a partir de uma sub cancelada (zumbi de gateway).
    const [r] = await db.query(
      `UPDATE subscriptions
          SET status='active', last_payment_at=NOW(),
              gateway_payment_id=COALESCE(gateway_payment_id, ?),
              current_period_end=?, next_billing_at=?,
              payment_method=COALESCE(?, payment_method), updated_at=NOW()
        WHERE id=? AND status<>'canceled'`,
      [paymentId, periodEnd, periodEnd, paymentMethod, sub.id],
    );
    matched = (r?.affectedRows || 0) > 0;
    if (matched) {
      // Ativa: status + ponteiro + plan_active_until (fim do ciclo) e limpa plan_trial_ends_at residual
      // (um trial vencido tambem rebaixaria active->expired em computeSubscriptionState).
      await db.query(
        `UPDATE usuarios
            SET plan_status='active', plan=COALESCE(?, plan),
                plan_subscription_id=?, plan_active_until=?,
                plan_cycle=COALESCE(?, plan_cycle), plan_trial_ends_at=NULL
          WHERE id=?`,
        [sub.plan || null, String(sub.id), periodEnd, sub.billing_cycle || null, sub.estabelecimento_id],
      );
    }
  } else {
    // past_due | refunded -> bloqueio suave. Guard status<>'canceled' (nao mexe em sub cancelada).
    const [r] = await db.query(
      `UPDATE subscriptions SET status='past_due', updated_at=NOW() WHERE id=? AND status<>'canceled'`,
      [sub.id],
    );
    matched = (r?.affectedRows || 0) > 0;
    // So rebaixa o usuario se ele aponta para ESTA sub (nao derruba tenant sadio por evento de sub antiga/zumbi).
    if (matched) {
      await db.query(
        `UPDATE usuarios SET plan_status='past_due' WHERE id=? AND plan_subscription_id=?`,
        [sub.estabelecimento_id, String(sub.id)],
      );
    }
  }

  await db.query(
    `INSERT INTO subscription_events (subscription_id, event_type, gateway_event_id, payload)
     VALUES (?,?,?,?)`,
    [sub.id, event, eventId, rawPayload],
  );
  return { handled: true, kind, action, matched };
}

const router = Router();

// Reachability/health simples (o painel do Asaas pode testar a URL).
router.get('/', (_req, res) => res.status(200).json({ ok: true, provider: 'asaas' }));

/** Dispara efeitos colaterais (notificações/alertas) a partir do resultado. Best-effort. */
function fireWebhookSideEffects(result) {
  if (!result) return;
  if (result.notify === 'confirmed' && result.agendamentoId != null) {
    notifyAppointmentConfirmed(result.agendamentoId).catch(() => {});
  }
  if (result.unexpectedRefund && result.agendamentoId != null) {
    console.warn('[asaas/webhook] estorno inesperado (não originado de cancelamento)', {
      agendamentoId: result.agendamentoId,
    });
  }
}

router.post('/', async (req, res) => {
  if (!isAuthorizedAsaasWebhook(req.headers)) {
    return res.sendStatus(401);
  }

  const body = req.body || {};
  const descriptor = mapAsaasEvent(body);
  const rawPayload = safeJson(body);

  // Sem eventId não há como deduplicar: processa best-effort e responde 200.
  if (!descriptor.eventId) {
    try {
      const result = await applyAsaasWebhookAction(descriptor, { rawPayload });
      fireWebhookSideEffects(result);
      return res.status(200).json({ received: true, noId: true, ...result });
    } catch (err) {
      console.error('[asaas/webhook] processamento sem eventId falhou', err?.message || err);
      return res.status(200).json({ received: true, noId: true, deferred: true });
    }
  }

  // Idempotência: registra o evento (com payload para reprocesso). Duplicado já
  // processado -> ack; duplicado ainda não processado -> reprocessa (cura entregas que
  // registraram mas não concluíram, sem depender de DELETE do dedupe).
  try {
    await pool.query(
      `INSERT INTO asaas_webhook_events (id, event, payment_id, payload) VALUES (?,?,?,?)`,
      [descriptor.eventId, descriptor.event, descriptor.paymentId, rawPayload],
    );
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      const [rows] = await pool.query(
        `SELECT processed_at FROM asaas_webhook_events WHERE id=? LIMIT 1`,
        [descriptor.eventId],
      );
      if (rows?.[0]?.processed_at) {
        return res.status(200).json({ received: true, duplicate: true, processed: true });
      }
      // segue para reprocessar
    } else {
      // DB indisponível: 500 para o Asaas reenviar (não perder o evento).
      console.error('[asaas/webhook] falha ao registrar evento', err?.message || err);
      return res.status(500).json({ error: 'persist_failed' });
    }
  }

  try {
    const result = await applyAsaasWebhookAction(descriptor, { rawPayload });
    await pool.query(
      `UPDATE asaas_webhook_events SET processed_at=NOW(), error=NULL WHERE id=?`,
      [descriptor.eventId],
    );
    fireWebhookSideEffects(result);
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    // 200-always: um evento com erro NÃO pode pausar a fila do Asaas. Persistimos o erro
    // (processed_at fica NULL) para reprocessar depois; o evento nunca é perdido.
    console.error('[asaas/webhook] falha ao processar evento', err?.message || err);
    try {
      await pool.query(
        `UPDATE asaas_webhook_events SET error=? WHERE id=?`,
        [String(err?.message || err).slice(0, 1000), descriptor.eventId],
      );
    } catch {}
    return res.status(200).json({ received: true, deferred: true });
  }
});

export default router;
