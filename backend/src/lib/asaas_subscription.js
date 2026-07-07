// backend/src/lib/asaas_subscription.js
// Assinatura recorrente do tenant (plano SaaS) via Asaas — autocontido, atrás
// de BILLING_PROVIDER=asaas. Usa checkout HOSPEDADO (billingType UNDEFINED),
// sem captura de cartão na interface (sem PCI). Persiste em `subscriptions`
// reusando os helpers gateway-agnósticos (gateway='asaas').
import { pool } from './db.js';
import { createAsaasPayments } from '../services/asaas/payments.js';
import { resolveAsaasCustomerId } from './deposit_provider.js';
import { createSubscription as persistSubscription, updateSubscription, getLatestSubscriptionForEstabelecimento } from './subscriptions.js';
import { getPlanPriceCents, normalizeBillingCycle, resolvePlanConfig, PLAN_TIERS } from './plans.js';

/** Provider ativo para a assinatura do tenant (independente do sinal). */
export function resolveBillingProvider() {
  const v = String(process.env.BILLING_PROVIDER || process.env.PAYMENT_PROVIDER || 'mercadopago')
    .trim()
    .toLowerCase();
  return v === 'asaas' ? 'asaas' : 'mercadopago';
}

function asaasCycle(cycle) {
  return normalizeBillingCycle(cycle) === 'anual' ? 'YEARLY' : 'MONTHLY';
}

async function loadEstabPayer(estabelecimentoId, db) {
  const [rows] = await db.query(
    'SELECT nome, email, telefone, cpf_cnpj FROM usuarios WHERE id=? LIMIT 1',
    [estabelecimentoId],
  );
  const row = rows?.[0] || {};
  return { name: row.nome, email: row.email, cpfCnpj: row.cpf_cnpj, phone: row.telefone };
}

/**
 * Cria a assinatura do tenant no Asaas e persiste localmente (gateway='asaas').
 * Retorna { subscription (serializável), checkoutUrl, asaasSubscriptionId, firstPaymentId }.
 */
export async function createTenantAsaasSubscription({
  estabelecimentoId,
  plan,
  cycle = 'mensal',
  billingType = process.env.ASAAS_SUBSCRIPTION_BILLING_TYPE || 'UNDEFINED',
  client,
  db = pool,
  payments = createAsaasPayments(client),
} = {}) {
  if (!estabelecimentoId) throw new Error('estabelecimento_required');
  const planKey = String(plan || '').toLowerCase();
  if (!PLAN_TIERS.includes(planKey)) throw new Error('invalid_plan');

  const cycleKey = normalizeBillingCycle(cycle);
  const amountCents = getPlanPriceCents(planKey, cycleKey);
  const value = Math.max(0, Math.round(Number(amountCents || 0))) / 100;
  const planLabel = resolvePlanConfig(planKey).label;
  // Após pagar no checkout hospedado do Asaas, redireciona o cliente de volta ao app.
  const frontBase = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'https://agendamentosonline.com').replace(/\/$/, '');
  const successUrl = `${frontBase}/assinatura?assinatura=sucesso`;

  const payer = await loadEstabPayer(estabelecimentoId, db);
  const customerId = await resolveAsaasCustomerId({ payments, userId: estabelecimentoId, payer, db });
  if (!customerId) throw new Error('asaas_customer_unresolved');

  const asaasSub = await payments.createSubscription({
    customerId,
    value,
    cycle: asaasCycle(cycleKey),
    nextDueDate: new Date(),
    billingType,
    description: `Assinatura ${planLabel} (${cycleKey})`,
    externalReference: `subscription:estab:${estabelecimentoId}`,
    callback: { successUrl, autoRedirect: true },
  });
  const asaasSubscriptionId = asaasSub?.id ? String(asaasSub.id) : null;
  if (!asaasSubscriptionId) throw new Error('asaas_subscription_missing_id');

  const localSub = await persistSubscription(
    {
      estabelecimentoId,
      plan: planKey,
      gateway: 'asaas',
      paymentMethod: 'pix',
      gatewayCustomerId: customerId,
      gatewaySubscriptionId: asaasSubscriptionId,
      externalReference: `subscription:estab:${estabelecimentoId}`,
      status: 'pending',
      amountCents,
      currency: 'BRL',
      billingCycle: cycleKey,
    },
    { db },
  );

  // Supersede: uma nova assinatura de PLANO substitui as ANTERIORES do estabelecimento no Asaas.
  // (1) desativa no GATEWAY as assinaturas Asaas antigas — senão viram "zumbi" cobrando em paralelo
  //     (cobrança dupla) e podem reverter usuarios.plan via webhook; (2) cancela localmente com
  //     canceled_at. Escopo positivo em 'subscription:estab:%' para NÃO tocar topups de WhatsApp
  //     (pending_pix/active) nem assinaturas MP históricas (que, com o período setado no webhook,
  //     já não brigam com esta).
  try {
    const [oldAsaas] = await db.query(
      `SELECT id, gateway_subscription_id FROM subscriptions
        WHERE estabelecimento_id=? AND id<>? AND gateway='asaas'
          AND status NOT IN ('canceled') AND gateway_subscription_id IS NOT NULL
          AND external_reference LIKE 'subscription:estab:%'`,
      [estabelecimentoId, localSub.id],
    );
    for (const old of oldAsaas || []) {
      try {
        await payments.setSubscriptionStatus(old.gateway_subscription_id, 'INACTIVE');
      } catch (err) {
        console.error('[asaas-sub] falha ao desativar assinatura antiga no gateway', {
          estabelecimentoId,
          subscriptionId: old.id,
          gatewaySubscriptionId: old.gateway_subscription_id,
          error: err?.message || err,
        });
      }
    }
    await db.query(
      `UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW()
        WHERE estabelecimento_id=? AND id<>? AND gateway='asaas'
          AND status NOT IN ('canceled') AND external_reference LIKE 'subscription:estab:%'`,
      [estabelecimentoId, localSub.id],
    );
  } catch (err) {
    console.error('[asaas-sub] supersede falhou', { estabelecimentoId, error: err?.message || err });
  }

  // Espelha ponteiros no usuarios (sem ativar o plano — isso é no webhook).
  await db
    .query('UPDATE usuarios SET plan_subscription_id=?, plan_cycle=? WHERE id=?', [
      String(localSub.id),
      cycleKey,
      estabelecimentoId,
    ])
    .catch((err) => console.error('[asaas-sub] falha ao espelhar ponteiro no usuario', { estabelecimentoId, error: err?.message || err }));

  // O id da 1ª cobrança NÃO volta na criação — busca para pegar o link hospedado.
  let checkoutUrl = null;
  let firstPaymentId = null;
  try {
    const charges = await payments.getSubscriptionPayments(asaasSubscriptionId);
    const first = Array.isArray(charges) ? charges[0] : null;
    if (first) {
      firstPaymentId = first.id ? String(first.id) : null;
      checkoutUrl = first.invoiceUrl || first.bankSlipUrl || null;
    }
  } catch {
    // sem cobrança ainda (assíncrono) — o front pode consultar depois.
  }

  return { subscription: localSub, checkoutUrl, asaasSubscriptionId, firstPaymentId };
}

/**
 * Suspende (INACTIVE) ou reativa (ACTIVE) a assinatura Asaas do tenant.
 * Reflete o estado local mínimo; a rotina de billing decide o restante.
 */
export async function setTenantAsaasSubscriptionStatus(estabelecimentoId, status, { client, db = pool, payments = createAsaasPayments(client) } = {}) {
  const sub = await getLatestSubscriptionForEstabelecimento(estabelecimentoId, { db });
  if (!sub || sub.gateway !== 'asaas' || !sub.gatewaySubscriptionId) {
    return { ok: false, reason: 'no_asaas_subscription' };
  }
  const normalized = String(status || '').trim().toUpperCase();
  await payments.setSubscriptionStatus(sub.gatewaySubscriptionId, normalized);
  // Reflete localmente: INACTIVE (suspenso) -> canceled; ACTIVE -> active.
  const localStatus = normalized === 'INACTIVE' ? 'canceled' : 'active';
  await updateSubscription(sub.id, { status: localStatus }, { db });
  return { ok: true, subscriptionId: sub.id, gatewaySubscriptionId: sub.gatewaySubscriptionId, status: normalized };
}
