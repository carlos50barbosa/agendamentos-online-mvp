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
  const frontBase = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'https://agenda0.com.br').replace(/\/$/, '');
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
      // Placeholder: o checkout e HOSPEDADO (billingType UNDEFINED); o metodo real (pix/cartao) so
      // e conhecido na confirmacao — o webhook sobrescreve via COALESCE. A coluna e NOT NULL
      // DEFAULT 'pix', entao mantemos 'pix' aqui apenas como default (nao dita o rotulo exibido).
      paymentMethod: 'pix',
      gatewayCustomerId: customerId,
      gatewaySubscriptionId: asaasSubscriptionId,
      externalReference: `subscription:estab:${estabelecimentoId}`,
      // 'pending_payment' (generico), NAO 'pending' — que, com paymentMethod!='credit_card',
      // normalizaria para 'pending_pix' e a UI mostraria "PIX pendente" ANTES de o cliente escolher
      // o metodo na tela do Asaas. Ver subscription_normalization.js:31-33.
      status: 'pending_payment',
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
  // PROTEÇÃO (fix B): NÃO cancela uma assinatura 'active' com período vigente (current_period_end no
  //     futuro) — senão um novo checkout mataria a recorrência de uma assinatura já PAGA. A trava do
  //     checkout (billing_asaas.js) já impede criar nova enquanto ativo; isto é defesa em profundidade.
  //     Os DOIS WHERE (SELECT do gateway + UPDATE local) precisam do mesmo guard para não divergir.
  try {
    const [oldAsaas] = await db.query(
      `SELECT id, gateway_subscription_id FROM subscriptions
        WHERE estabelecimento_id=? AND id<>? AND gateway='asaas'
          AND status NOT IN ('canceled') AND gateway_subscription_id IS NOT NULL
          AND external_reference LIKE 'subscription:estab:%'
          AND NOT (status='active' AND current_period_end IS NOT NULL AND current_period_end > NOW())`,
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
          AND status NOT IN ('canceled') AND external_reference LIKE 'subscription:estab:%'
          AND NOT (status='active' AND current_period_end IS NOT NULL AND current_period_end > NOW())`,
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
 * Troca de plano/ciclo de uma assinatura Asaas JA ATIVA, via update-in-place (nao cancela+cria).
 *
 * Politica (MVP): o novo valor vale a partir da PROXIMA cobranca. updatePendingPayments=true reescreve
 * so a cobranca PENDENTE (nao paga) para o novo valor; a cobranca ja paga do ciclo corrente nao e
 * tocada (sem cobranca nem estorno imediato). O ACESSO ao novo tier sobe na hora (usuarios.plan), e o
 * periodo ja pago (plan_active_until) fica inalterado — o resto do ciclo atual nao e recobrado.
 *
 * OBRIGATORIO atualizar a linha LOCAL (plan/amount_cents/billing_cycle): o webhook do tenant le o plano
 * do banco LOCAL, nao do evento — sem isto a renovacao reativaria o tier ANTIGO.
 *
 * @param {object} subscription  assinatura ativa: precisa de { id, gatewaySubscriptionId }.
 * @returns {{ ok, plan, planLabel, cycle, amountCents, subscriptionId }}
 */
export async function changeTenantAsaasPlan({
  estabelecimentoId,
  subscription,
  plan,
  cycle = 'mensal',
  client,
  db = pool,
  payments = createAsaasPayments(client),
} = {}) {
  if (!estabelecimentoId) throw new Error('estabelecimento_required');
  const planKey = String(plan || '').toLowerCase();
  if (!PLAN_TIERS.includes(planKey)) throw new Error('invalid_plan');
  if (!subscription?.id || !subscription?.gatewaySubscriptionId) throw new Error('no_active_asaas_subscription');

  const cycleKey = normalizeBillingCycle(cycle);
  const amountCents = getPlanPriceCents(planKey, cycleKey);
  const value = Math.max(0, Math.round(Number(amountCents || 0))) / 100;
  const planLabel = resolvePlanConfig(planKey).label;

  // 1) Gateway PRIMEIRO: muda valor/ciclo da MESMA assinatura. updatePendingPayments reescreve a
  //    cobranca PENDENTE (nao paga) para o novo valor; a cobranca ja paga do ciclo corrente nao e
  //    tocada. Se falhar, nada local foi alterado -> estado consistente (antigo em todo lugar).
  await payments.updateSubscription(subscription.gatewaySubscriptionId, {
    value,
    cycle: asaasCycle(cycleKey),
    description: `Assinatura ${planLabel} (${cycleKey})`,
    updatePendingPayments: true,
  });

  // 2) Linhas LOCAIS de forma ATOMICA: subscriptions (plan lido pelo webhook na renovacao) e usuarios
  //    (acesso imediato ao novo tier; plan_active_until inalterado — o periodo pago continua). As duas
  //    PRECISAM cair juntas: se divergissem, o guard de downgrade (que le usuarios.plan) poderia
  //    reclassificar um downgrade real como upgrade. Sem suporte a transacao (ex.: testes), sequencial.
  const applyLocal = async (runner) => {
    await runner.query(
      'UPDATE subscriptions SET plan=?, amount_cents=?, billing_cycle=?, updated_at=NOW() WHERE id=?',
      [planKey, amountCents, cycleKey, subscription.id],
    );
    await runner.query(
      "UPDATE usuarios SET plan=?, plan_cycle=? WHERE id=? AND tipo='estabelecimento'",
      [planKey, cycleKey, estabelecimentoId],
    );
  };
  if (typeof db.beginTransaction === 'function') {
    await db.beginTransaction();
    try {
      await applyLocal(db);
      await db.commit();
    } catch (err) {
      try { await db.rollback(); } catch {}
      throw err;
    }
  } else {
    await applyLocal(db);
  }

  return { ok: true, plan: planKey, planLabel, cycle: cycleKey, amountCents, subscriptionId: subscription.id };
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
