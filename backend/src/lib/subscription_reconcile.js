// backend/src/lib/subscription_reconcile.js
// Reconcilia o estado de assinatura de UM tenant preso no bug do "PIX pendente apesar de pago": ele
// pagou (linha 'active' + last_payment_at + period_end futuro), mas ANTES da trava/supersede-protegido
// entrar em producao, um novo clique no "Assinar" criou uma pending_pix nova E o supersede antigo
// CANCELOU a paga (local + INATIVOU no gateway). Resultado: a efetiva vira a pendente orfa (UI mostra
// "PIX pendente"), a renovacao futura seria ignorada pelo webhook (guard status<>'canceled') e a orfa
// ainda tem uma cobranca PIX aberta que, se paga, viraria cobranca dupla.
//
// IMPORTANTE (nao usar usuarios.plan_status como gatilho): loadEffectiveSubscriptionContext SINCRONIZA
// usuarios.plan_status com a assinatura EFETIVA (a orfa) — ou seja, esse campo ja foi corrompido para
// 'pending_pix'. O sinal CONFIAVEL de "pagou ate uma data futura" e o period_end da linha PAGA (ou o
// usuarios.plan_active_until, que a sincronizacao preserva), nao o plan_status.
import { pool } from './db.js';
import { createAsaasPayments } from '../services/asaas/payments.js';
import { listSubscriptionsForEstabelecimento, updateSubscription } from './subscriptions.js';
import { pickEffectiveSubscription } from './subscription_state.js';
import { toDatabaseDateTime } from './database_datetime.js';

const PENDING_STATES = new Set(['pending_pix', 'pending_payment']);

function toMs(value) {
  if (!value) return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * PURO (sem I/O). Decide o plano de reconciliacao a partir do usuario + assinaturas ja carregadas.
 *
 * Gatilho (needsFix): existe uma linha REALMENTE paga (canonica = maior last_payment_at) COM periodo
 * pago VIGENTE (period_end da canonica OU usuarios.plan_active_until no futuro) E a assinatura efetiva
 * NAO e 'active'. Nao depende de plan_status (corrompido pela sincronizacao com a efetiva orfa).
 *
 * @returns {{ action:'noop'|'reconcile'|'manual_review', effectiveStatus, paidThrough:Date|null,
 *   canonical:{id,status,gatewaySubscriptionId}|null, canonicalNeedsRestore, orphans:Array }}
 */
export function planTenantReconciliation({ user, subscriptions, now = new Date() } = {}) {
  const nowMs = toMs(now) || Date.now();

  // So assinaturas Asaas do TENANT (nao topups de WhatsApp, nao MP).
  const tenantSubs = (Array.isArray(subscriptions) ? subscriptions : []).filter(
    (s) => s && s.gateway === 'asaas' && String(s.externalReference || '').startsWith('subscription:estab:'),
  );

  const effective = pickEffectiveSubscription(tenantSubs);
  const effectiveStatus = effective ? String(effective.status) : null;
  const effectiveActive = effectiveStatus === 'active';

  // Canonica = a linha REALMENTE paga: maior last_payment_at (o webhook grava no confirm).
  let canonical = null;
  for (const s of tenantSubs) {
    if (!s.lastPaymentAt) continue;
    if (!canonical || toMs(s.lastPaymentAt) > toMs(canonical.lastPaymentAt)) canonical = s;
  }

  // "Pago ate": o MAIOR entre o period_end da canonica e o plan_active_until do usuario (preservado).
  const paidThroughMs = Math.max(
    canonical ? toMs(canonical.currentPeriodEnd) : 0,
    toMs(user?.plan_active_until),
  );
  const hasFuturePaidPeriod = paidThroughMs > nowMs;
  const paidThrough = paidThroughMs ? new Date(paidThroughMs) : null;

  const base = { effectiveStatus, paidThrough, canonical: null, canonicalNeedsRestore: false, orphans: [] };

  // Fora do bug: efetiva ja ativa, ou sem periodo pago vigente -> nao mexe (arriscado).
  if (effectiveActive || !hasFuturePaidPeriod) {
    return { action: 'noop', ...base, canonical: canonical ? summarize(canonical) : null };
  }
  // Periodo pago vigente mas sem linha paga identificavel -> revisao manual (nao auto-cancela pendentes
  // sem saber qual sustenta o tenant).
  if (!canonical) {
    return { action: 'manual_review', ...base };
  }

  const orphans = tenantSubs
    .filter((s) => PENDING_STATES.has(String(s.status)) && s.id !== canonical.id)
    .map(summarize);

  return {
    action: 'reconcile',
    effectiveStatus,
    paidThrough,
    canonical: summarize(canonical),
    canonicalNeedsRestore: String(canonical.status) !== 'active',
    orphans,
  };
}

function summarize(s) {
  return { id: s.id, status: String(s.status), plan: s.plan, billingCycle: s.billingCycle, gatewaySubscriptionId: s.gatewaySubscriptionId || null };
}

/**
 * Carrega o estado e reconcilia UM tenant. DRY-RUN por padrao (apply=false) — devolve o plano sem mexer
 * em nada. Com apply=true:
 *   - orfas: apaga a cobranca PIX aberta (evita cobranca dupla) + INATIVA no gateway + cancela local;
 *   - canonica: restaura para 'active' (period_end = periodo pago) + REATIVA no gateway (o supersede
 *     antigo a inativou, senao a renovacao nunca mais aconteceria) + realinha usuarios.
 * cancelGateway=false faz reconciliacao SO local (nao toca o Asaas).
 *
 * @returns {object} relatorio detalhado.
 */
export async function reconcileTenantSubscription(estabelecimentoId, {
  apply = false,
  cancelGateway = true,
  db = pool,
  payments = createAsaasPayments(),
  now = new Date(),
} = {}) {
  if (!estabelecimentoId) throw new Error('estabelecimento_required');

  const [urows] = await db.query(
    "SELECT plan_status, plan_active_until, plan, plan_cycle, plan_subscription_id FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
    [estabelecimentoId],
  );
  const user = urows?.[0];
  if (!user) throw new Error('estabelecimento_not_found');

  const subscriptions = await listSubscriptionsForEstabelecimento(estabelecimentoId, { db });
  const plan = planTenantReconciliation({ user, subscriptions, now });

  const paidThrough = plan.paidThrough || (user.plan_active_until ? new Date(user.plan_active_until) : null);
  const report = {
    estabelecimentoId,
    applied: false,
    action: plan.action,
    effectiveStatusBefore: plan.effectiveStatus,
    paidThrough: paidThrough ? paidThrough.toISOString() : null,
    canonical: plan.canonical,
    canonicalNeedsRestore: plan.canonicalNeedsRestore,
    orphans: plan.orphans,
    deletedCharges: [],
    gatewayOps: [],
    restored: false,
    canonicalReactivated: false,
    userRealigned: false,
  };

  if (plan.action !== 'reconcile' || !apply) {
    return report; // noop / manual_review / dry-run: nada e alterado
  }

  const canonicalGwId = plan.canonical?.gatewaySubscriptionId || null;

  // 1) Orfas: primeiro PARA de cobrar no gateway (apaga cobranca aberta + INATIVA), depois cancela
  //    local. Gateway-antes-de-local evita "cancelada local mas viva no gateway" (continuaria cobrando).
  for (const orphan of plan.orphans) {
    const gwId = orphan.gatewaySubscriptionId;
    if (cancelGateway && gwId && gwId !== canonicalGwId) {
      // Apaga as cobrancas PENDENTES da orfa (a paga que a UI mostrava) — senao, se o dono pagasse, o
      // webhook ignoraria (linha canceled) e viraria cobranca dupla.
      try {
        const charges = await payments.getSubscriptionPayments(gwId);
        for (const ch of (Array.isArray(charges) ? charges : [])) {
          if (String(ch?.status || '').toUpperCase() !== 'PENDING' || !ch?.id) continue;
          try {
            await payments.deletePayment(ch.id);
            report.deletedCharges.push({ subscriptionId: orphan.id, paymentId: String(ch.id), ok: true });
          } catch (err) {
            report.deletedCharges.push({ subscriptionId: orphan.id, paymentId: String(ch.id), ok: false, error: err?.message || String(err) });
          }
        }
      } catch (err) {
        report.deletedCharges.push({ subscriptionId: orphan.id, paymentId: null, ok: false, error: err?.message || String(err) });
      }
      try {
        await payments.setSubscriptionStatus(gwId, 'INACTIVE');
        report.gatewayOps.push({ subscriptionId: orphan.id, gatewaySubscriptionId: gwId, op: 'INACTIVE', ok: true });
      } catch (err) {
        report.gatewayOps.push({ subscriptionId: orphan.id, gatewaySubscriptionId: gwId, op: 'INACTIVE', ok: false, error: err?.message || String(err) });
      }
    }
    await updateSubscription(orphan.id, { status: 'canceled', canceledAt: now }, { db });
  }

  // 2) Canonica: restaura local para 'active' com o period_end pago, e REATIVA no gateway (o supersede
  //    antigo a inativou; sem reativar, a renovacao nunca mais viria e o tenant lapsaria no vencimento).
  if (plan.canonical && plan.canonicalNeedsRestore) {
    await updateSubscription(plan.canonical.id, { status: 'active', currentPeriodEnd: paidThrough }, { db });
    report.restored = true;
  }
  if (cancelGateway && canonicalGwId) {
    try {
      // Reativa E ancora o proximo vencimento no fim do periodo pago (paidThrough). Sem fixar
      // nextDueDate, se o schedule guardado no Asaas estiver no passado (ex.: plan_active_until
      // estendido manualmente), a reativacao geraria cobranca IMEDIATA. paidThrough e a data correta
      // da proxima renovacao, entao a cobranca so nasce la.
      await payments.updateSubscription(canonicalGwId, { status: 'ACTIVE', nextDueDate: paidThrough });
      report.canonicalReactivated = true;
      report.gatewayOps.push({ subscriptionId: plan.canonical.id, gatewaySubscriptionId: canonicalGwId, op: 'ACTIVE', nextDueDate: paidThrough ? paidThrough.toISOString() : null, ok: true });
    } catch (err) {
      report.gatewayOps.push({ subscriptionId: plan.canonical.id, gatewaySubscriptionId: canonicalGwId, op: 'ACTIVE', ok: false, error: err?.message || String(err) });
    }
  }

  // 3) usuarios: realinha explicitamente ao estado pago (o plan_status pode estar corrompido pela
  //    sincronizacao com a orfa). Deixa consistente ja, sem depender do proximo load.
  await db.query(
    `UPDATE usuarios SET plan=?, plan_status='active', plan_cycle=?, plan_active_until=?, plan_subscription_id=?
       WHERE id=? AND tipo='estabelecimento'`,
    [
      plan.canonical.plan || user.plan || 'starter',
      plan.canonical.billingCycle || user.plan_cycle || 'mensal',
      // Mesma convencao de data do resto do codigo (UTC via toDatabaseDateTime) — senao plan_active_until
      // (raw Date, tz local do mysql2) divergiria do current_period_end da assinatura em host nao-UTC.
      toDatabaseDateTime(paidThrough),
      String(plan.canonical.id),
      estabelecimentoId,
    ],
  );
  report.userRealigned = true;

  // Consistencia do gateway num flag de topo: um operador que le so os flags de cima nao pode achar
  // que o Asaas ficou consistente se uma op de gateway (delete/INACTIVE/ACTIVE) falhou.
  report.gatewayConsistent = report.gatewayOps.every((o) => o.ok) && report.deletedCharges.every((c) => c.ok);

  report.applied = true;
  return report;
}
