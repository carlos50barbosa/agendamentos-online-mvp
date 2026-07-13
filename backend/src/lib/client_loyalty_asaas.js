// backend/src/lib/client_loyalty_asaas.js
// Camada de cobranca do PLANO RECORRENTE que o estabelecimento vende ao SEU cliente,
// via Asaas. Ver docs/PLANO-FIDELIDADE-ASAAS.md.
//
// Nao confundir com lib/asaas_subscription.js (o salao pagando a PLATAFORMA).
// Aqui o dinheiro vai do CLIENTE para o SALAO, e a plataforma so fica com a comissao —
// o Asaas divide na liquidacao, via split. O valor nunca passa pela conta da plataforma.
//
// Nao portamos o client_loyalty_billing.js (3.969 linhas de Mercado Pago): o Asaas nao tem
// preapproval nem authorized_payment, so /subscriptions + /payments + webhooks PAYMENT_*.
// O que se reaproveita e o que ja era agnostico: o motor de creditos (client_loyalty_credits)
// e o estado/CRUD da assinatura (client_loyalty_subscriptions).
import { pool } from './db.js';
import { config } from './config.js';
import { createAsaasPayments } from '../services/asaas/payments.js';
import { resolveAsaasCustomerId } from './deposit_provider.js';
import { getLoyaltyPlanById } from './loyalty_plans.js';
import { buildLoyaltySplit } from './loyalty_split.js';
import { toDatabaseDateTime } from './database_datetime.js';
import { ensureCreditsForCurrentCycle } from './client_loyalty_credits.js';
import {
  appendClientLoyaltySubscriptionEvent,
  computeClientLoyaltySubscriptionState,
  createClientLoyaltySubscription,
  getClientLoyaltySubscriptionById,
  getPreferredClientLoyaltySubscription,
  updateClientLoyaltySubscription,
} from './client_loyalty_subscriptions.js';

export const CLIENT_PLAN_REF_PREFIX = 'clientplan:';

/** Erro de negocio com codigo estavel — a rota mapeia direto para o status HTTP. */
export class ClientPlanError extends Error {
  constructor(code, message, { status = 400 } = {}) {
    super(message);
    this.name = 'ClientPlanError';
    this.code = code;
    this.status = status;
  }
}

const GRACE_DAYS = Number(process.env.CLIENT_LOYALTY_GRACE_DAYS || 3) || 3;

function addMonths(date, count = 1) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + count);
  // 31/01 + 1 mes = 28/02, e nao 03/03. Sem isto, um plano assinado dia 31 "pula" meses.
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function addDays(date, count) {
  const d = new Date(date);
  d.setDate(d.getDate() + count);
  return d;
}

/** Carteira Asaas do estabelecimento. Sem ela nao ha para onde repassar — logo, nao ha plano. */
async function loadWalletId(estabelecimentoId, db) {
  const [rows] = await db.query(
    'SELECT asaas_wallet_id FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1',
    [estabelecimentoId],
  );
  return String(rows?.[0]?.asaas_wallet_id || '').trim() || null;
}

async function loadPayer(clienteId, db) {
  const [rows] = await db.query(
    'SELECT nome, email, telefone, cpf_cnpj FROM usuarios WHERE id=? LIMIT 1',
    [clienteId],
  );
  const row = rows?.[0] || {};
  return { name: row.nome, email: row.email, phone: row.telefone, cpfCnpj: row.cpf_cnpj };
}

/**
 * Assina o cliente num plano do estabelecimento.
 *
 * A ordem importa: a linha local nasce ANTES da chamada ao Asaas, porque o
 * externalReference precisa do id dela (`clientplan:<id>`) — e é por esse prefixo que o
 * webhook reconhece a cobranca. Se o Asaas falhar depois, a linha e cancelada em vez de
 * ficar pendurada em pending_payment para sempre.
 */
export async function subscribeClientToPlan({
  clienteId,
  estabelecimentoId,
  loyaltyPlanId,
  creditCardToken,
  creditCard,
  creditCardHolderInfo,
  remoteIp,
  db = pool,
  payments = createAsaasPayments(),
  platformPercent = config.loyalty.platformPercent,
} = {}) {
  if (!clienteId) throw new ClientPlanError('cliente_required', 'Cliente não informado.');
  // O cartão é OPCIONAL de propósito — e o caminho padrão é NÃO enviá-lo.
  //
  // Medido no sandbox (2026-07-13): uma assinatura criada com billingType CREDIT_CARD e SEM
  // dados de cartão nasce ACTIVE e gera a 1ª cobrança com `invoiceUrl` (a página do Asaas).
  // Quando o cliente paga o cartão LÁ, o Asaas guarda o cartão na assinatura
  // (`creditCardToken`) e cobra os ciclos seguintes sozinho.
  //
  // Ou seja: dá para ter cartão recorrente sem o cartão passar pelo nosso servidor. A
  // tokenização do Asaas é server-side (não existe SDK de navegador), então o caminho com
  // `creditCard` nos jogaria no escopo PCI — e ainda exige aprovação prévia do Asaas para
  // produção. O caminho com token fica disponível para quem já tiver essa aprovação.
  if ((creditCard || creditCardToken) && !remoteIp) {
    throw new ClientPlanError('remote_ip_required', 'IP do cliente ausente (exigido pelo antifraude).');
  }

  const plan = await getLoyaltyPlanById(loyaltyPlanId, { db });
  if (!plan) throw new ClientPlanError('plan_not_found', 'Plano não encontrado.', { status: 404 });
  if (Number(plan.estabelecimento_id) !== Number(estabelecimentoId)) {
    throw new ClientPlanError('plan_not_found', 'Plano não encontrado.', { status: 404 });
  }
  if (String(plan.status) !== 'active') {
    throw new ClientPlanError('plan_not_active', 'Este plano não está disponível.', { status: 409 });
  }
  const priceCents = Math.max(0, Math.round(Number(plan.preco_centavos || 0)));
  if (priceCents <= 0) {
    throw new ClientPlanError('plan_price_invalid', 'Plano sem preço definido.', { status: 409 });
  }

  // Sem carteira nao existe repasse: a cobranca cairia inteira na conta da plataforma e o
  // salao nunca veria o dinheiro. Falha aqui, e nao depois de cobrar o cliente.
  const walletId = await loadWalletId(estabelecimentoId, db);
  if (!walletId) {
    throw new ClientPlanError(
      'wallet_not_configured',
      'O estabelecimento ainda não configurou a carteira Asaas para receber planos.',
      { status: 409 },
    );
  }

  // Já assina? Não cria a segunda: viraria cobrança dupla no cartão do cliente.
  const existing = await getPreferredClientLoyaltySubscription(clienteId, estabelecimentoId, { db });
  if (existing && computeClientLoyaltySubscriptionState(existing).benefitsActive) {
    throw new ClientPlanError('already_subscribed', 'Você já tem um plano ativo neste estabelecimento.', { status: 409 });
  }

  // ...e o "pendente" também conta. Uma assinatura recém-criada e ainda não paga NÃO tem
  // benefitsActive (não há ciclo aberto), então o guarda acima não a via: um duplo clique em
  // "Assinar" criava DUAS assinaturas no Asaas e o cliente seria cobrado duas vezes no cartão.
  // (Só apareceu ao exercitar o fluxo de verdade — com mock isso passa batido.)
  //
  // Em vez de recusar, devolvemos a assinatura pendente com o MESMO link de pagamento: quem
  // clicou duas vezes quer pagar, não quer um erro.
  if (existing && ['pending_payment', 'pending_pix'].includes(String(existing.status))) {
    let checkoutUrl = null;
    if (existing.gatewaySubscriptionId) {
      try {
        const charges = await payments.getSubscriptionPayments(existing.gatewaySubscriptionId);
        const first = Array.isArray(charges) ? charges[0] : null;
        checkoutUrl = first?.invoiceUrl || first?.bankSlipUrl || null;
      } catch { /* sem link: o front avisa e o cliente tenta de novo */ }
    }
    return {
      subscription: existing,
      gatewaySubscriptionId: existing.gatewaySubscriptionId,
      externalReference: existing.externalReference,
      checkoutUrl,
      reusedPending: true,
    };
  }

  const payer = await loadPayer(clienteId, db);
  const customerId = await resolveAsaasCustomerId({ payments, userId: clienteId, payer, db });
  if (!customerId) throw new ClientPlanError('asaas_customer_unresolved', 'Não foi possível identificar o pagador no Asaas.', { status: 502 });

  const localSub = await createClientLoyaltySubscription(
    {
      clienteId,
      estabelecimentoId,
      loyaltyPlanId: plan.id,
      gateway: 'asaas',
      gatewayCustomerId: customerId,
      paymentMethod: 'credit_card',
      status: 'pending_payment',
      autoRenew: 1,
    },
    { db },
  );

  const externalReference = `${CLIENT_PLAN_REF_PREFIX}${localSub.id}`;
  const split = buildLoyaltySplit({ walletId, platformPercent });

  try {
    const asaasSub = await payments.createSubscription({
      customerId,
      value: priceCents / 100,
      cycle: 'MONTHLY',
      nextDueDate: new Date(),
      billingType: 'CREDIT_CARD',
      description: `Plano ${plan.nome}`,
      externalReference,
      split,
      creditCardToken,
      creditCard,
      creditCardHolderInfo,
      remoteIp,
    });
    const gatewaySubscriptionId = asaasSub?.id ? String(asaasSub.id) : null;
    if (!gatewaySubscriptionId) throw new Error('asaas_subscription_missing_id');

    await updateClientLoyaltySubscription(
      localSub.id,
      { gatewaySubscriptionId, externalReference },
      { db },
    );
    await appendClientLoyaltySubscriptionEvent(
      localSub.id,
      { tipoEvento: 'subscription_created', actionTaken: 'created', estabelecimentoId, payload: asaasSub },
      { db },
    ).catch(() => {});

    // O id da 1ª cobrança não volta na criação da assinatura — tem que ser buscado. É dela
    // que sai o `invoiceUrl`: a página do Asaas onde o cliente digita o cartão. Sem cartão
    // enviado, é PARA LÁ que o front manda o cliente.
    let checkoutUrl = null;
    let gatewayPaymentId = null;
    if (!creditCardToken && !creditCard) {
      try {
        const charges = await payments.getSubscriptionPayments(gatewaySubscriptionId);
        const first = Array.isArray(charges) ? charges[0] : null;
        if (first) {
          gatewayPaymentId = first.id ? String(first.id) : null;
          checkoutUrl = first.invoiceUrl || first.bankSlipUrl || null;
          if (gatewayPaymentId) {
            await updateClientLoyaltySubscription(localSub.id, { gatewayPaymentId }, { db }).catch(() => {});
          }
        }
      } catch (err) {
        // A cobrança é gerada de forma assíncrona: se ainda não existe, o front consulta
        // depois. Não é motivo para desfazer a assinatura.
        console.error('[client-plan] não foi possível obter o link de pagamento', { error: err?.message });
      }
    }

    const subscription = await getClientLoyaltySubscriptionById(localSub.id, { db });
    return { subscription, gatewaySubscriptionId, externalReference, checkoutUrl, gatewayPaymentId };
  } catch (err) {
    // A linha local nasceu antes da chamada. Se o Asaas recusou (cartao negado, split
    // invalido, carteira errada), ela nao pode ficar viva: o cliente veria um plano
    // "pendente" que nunca vai ser cobrado.
    await updateClientLoyaltySubscription(
      localSub.id,
      { status: 'canceled', canceledAt: toDatabaseDateTime(new Date()) },
      { db },
    ).catch(() => {});
    await appendClientLoyaltySubscriptionEvent(
      localSub.id,
      { tipoEvento: 'subscription_failed', actionTaken: 'canceled', estabelecimentoId, ignoredReason: err?.message },
      { db },
    ).catch(() => {});
    throw err;
  }
}

/** Cancela o plano a pedido do cliente. Remove no Asaas (para de cobrar) e marca local. */
export async function cancelClientPlanSubscription({
  clienteId,
  subscriptionId,
  db = pool,
  payments = createAsaasPayments(),
} = {}) {
  const sub = await getClientLoyaltySubscriptionById(subscriptionId, { db });
  if (!sub || Number(sub.clienteId) !== Number(clienteId)) {
    throw new ClientPlanError('subscription_not_found', 'Assinatura não encontrada.', { status: 404 });
  }
  if (sub.status === 'canceled') return { subscription: sub, alreadyCanceled: true };

  if (sub.gatewaySubscriptionId) {
    // Best-effort: se o Asaas falhar, a assinatura local ainda e cancelada — melhor um
    // cancelamento que precisa de conserto manual no gateway do que um cliente preso.
    await payments.deleteSubscription(sub.gatewaySubscriptionId).catch((err) => {
      console.error('[client-plan] falha ao remover assinatura no Asaas', {
        subscriptionId, gatewaySubscriptionId: sub.gatewaySubscriptionId, error: err?.message,
      });
    });
  }

  // Cancelado NAO tira o beneficio do ciclo ja pago: computeClientLoyaltySubscriptionState
  // mantem benefitsActive enquanto estiver dentro do periodo. O cliente pagou o mes.
  await updateClientLoyaltySubscription(
    subscriptionId,
    { status: 'canceled', canceledAt: toDatabaseDateTime(new Date()), autoRenew: 0 },
    { db },
  );
  await appendClientLoyaltySubscriptionEvent(
    subscriptionId,
    { tipoEvento: 'subscription_canceled', actionTaken: 'canceled', estabelecimentoId: sub.estabelecimentoId },
    { db },
  ).catch(() => {});

  return { subscription: await getClientLoyaltySubscriptionById(subscriptionId, { db }) };
}

/**
 * Webhook, cobranca paga: abre o ciclo e materializa os creditos.
 * Idempotente — o Asaas entrega at least once, e reprocessar nao pode dobrar credito
 * (o ensureCreditsForCurrentCycle usa UPSERT por (assinatura, servico, ciclo)).
 */
export async function activateClientPlanCycle({ subscriptionId, paymentId, db = pool, rawPayload = null } = {}) {
  const sub = await getClientLoyaltySubscriptionById(subscriptionId, { db });
  if (!sub) return { handled: false, reason: 'client_plan_subscription_not_found' };

  const now = new Date();
  const periodStart = now;
  const periodEnd = addMonths(now, 1);

  await updateClientLoyaltySubscription(
    subscriptionId,
    {
      status: 'active',
      gatewayPaymentId: paymentId || sub.gatewayPaymentId || null,
      startedAt: sub.startedAt || toDatabaseDateTime(now),
      currentPeriodStart: toDatabaseDateTime(periodStart),
      currentPeriodEnd: toDatabaseDateTime(periodEnd),
      nextBillingAt: toDatabaseDateTime(periodEnd),
      lastPaymentAt: toDatabaseDateTime(now),
      graceUntil: null,
    },
    { db },
  );

  const updated = await getClientLoyaltySubscriptionById(subscriptionId, { db });
  const credits = await ensureCreditsForCurrentCycle(updated, { db });

  await appendClientLoyaltySubscriptionEvent(
    subscriptionId,
    {
      tipoEvento: 'cycle_activated',
      actionTaken: 'activated',
      estabelecimentoId: sub.estabelecimentoId,
      gatewayPaymentId: paymentId || null,
      payload: rawPayload,
    },
    { db },
  ).catch(() => {});

  return { handled: true, reason: 'client_plan_activated', subscriptionId, credits: credits?.length ?? 0 };
}

/** Webhook, cobranca vencida: entra em graca. O beneficio so cai quando o periodo termina. */
export async function markClientPlanPastDue({ subscriptionId, db = pool } = {}) {
  const sub = await getClientLoyaltySubscriptionById(subscriptionId, { db });
  if (!sub) return { handled: false, reason: 'client_plan_subscription_not_found' };
  if (sub.status === 'canceled') return { handled: false, reason: 'client_plan_already_canceled' };

  await updateClientLoyaltySubscription(
    subscriptionId,
    { status: 'past_due', graceUntil: toDatabaseDateTime(addDays(new Date(), GRACE_DAYS)) },
    { db },
  );
  await appendClientLoyaltySubscriptionEvent(
    subscriptionId,
    { tipoEvento: 'payment_overdue', actionTaken: 'past_due', estabelecimentoId: sub.estabelecimentoId },
    { db },
  ).catch(() => {});

  return { handled: true, reason: 'client_plan_past_due', subscriptionId };
}

/**
 * Webhook, cobranca estornada: o cliente recebeu o dinheiro de volta, entao o beneficio
 * acaba AGORA — nao no fim do ciclo. Encerrar o periodo (current_period_end = agora) e o
 * que desliga o benefitsActive; so mudar o status para 'canceled' NAO bastaria, porque
 * assinatura cancelada continua valendo dentro do periodo pago (e correto: o mes foi pago).
 */
export async function revokeClientPlanForRefund({ subscriptionId, db = pool } = {}) {
  const sub = await getClientLoyaltySubscriptionById(subscriptionId, { db });
  if (!sub) return { handled: false, reason: 'client_plan_subscription_not_found' };

  const now = toDatabaseDateTime(new Date());
  await updateClientLoyaltySubscription(
    subscriptionId,
    { status: 'canceled', canceledAt: now, currentPeriodEnd: now, autoRenew: 0 },
    { db },
  );
  await appendClientLoyaltySubscriptionEvent(
    subscriptionId,
    { tipoEvento: 'payment_refunded', actionTaken: 'revoked', estabelecimentoId: sub.estabelecimentoId },
    { db },
  ).catch(() => {});

  return { handled: true, reason: 'client_plan_revoked', subscriptionId };
}
