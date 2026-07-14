// backend/src/routes/client_loyalty.js
// Superfície HTTP do plano recorrente cliente -> estabelecimento (fidelidade), via Asaas.
// Ver docs/PLANO-FIDELIDADE-ASAAS.md.
//
// O contrato dos endpoints não foi inventado aqui: ele já existia em
// frontend/src/utils/api.js (bloco "Loyalty / Fidelidade"), apontando para rotas que davam
// 404 desde que o módulo Mercado Pago foi removido. Estas são as rotas que faltavam.
import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { config } from '../lib/config.js';
import { pool } from '../lib/db.js';
import {
  archiveLoyaltyPlan,
  createLoyaltyPlan,
  getLoyaltyPlanForEstablishment,
  getPublicLoyaltyPlansForEstablishment,
  listLoyaltyPlansForEstablishment,
  listLoyaltySubscribersForEstablishment,
  updateLoyaltyPlan,
  updateLoyaltyPlanStatus,
} from '../lib/loyalty_plans.js';
import {
  ClientPlanError,
  cancelClientPlanSubscription,
  subscribeClientToPlan,
} from '../lib/client_loyalty_asaas.js';
import {
  getPreferredClientLoyaltySubscription,
  listClientLoyaltySubscriptionEvents,
  serializeClientLoyaltySubscription,
} from '../lib/client_loyalty_subscriptions.js';
import { getClientLoyaltyBenefitContext } from '../lib/client_loyalty_credits.js';
import { computeLoyaltySplitAmounts } from '../lib/loyalty_split.js';

const router = Router();

/** O recurso inteiro atrás de uma flag: dá para ligar num salão piloto. */
function ensureLoyaltyEnabled(_req, res, next) {
  if (!config.loyalty.enabled) {
    return res.status(503).json({ error: 'loyalty_disabled', message: 'Planos de fidelidade não estão habilitados.' });
  }
  next();
}

function isCliente(req, res, next) {
  if (req.user?.tipo !== 'cliente') return res.status(403).json({ error: 'forbidden' });
  next();
}

/**
 * Erros de VALIDAÇÃO precisam chegar ao dono com o texto que explica o que fazer.
 * O `lib/loyalty_plans.js` lança `Error` com `.status` e `.code` (ex.: 400
 * `loyalty_plan_items_required` — "Adicione ao menos um serviço ao plano"), e o
 * `ClientPlanError` faz o mesmo. Engolir isso num 502 genérico ("erro no gateway") seria
 * transformar um problema de preenchimento numa mensagem que não ajuda ninguém.
 * Só o que NÃO tem status vira 502 — aí sim é falha nossa ou do Asaas.
 */
function sendError(res, err, contexto) {
  const status = Number(err?.status);
  if (err instanceof ClientPlanError || (Number.isFinite(status) && status >= 400 && status < 500)) {
    return res.status(status || 400).json({ error: err.code || 'invalid_request', message: err.message });
  }
  console.error(`[client-loyalty][${contexto}]`, err?.message || err);
  return res.status(502).json({ error: 'loyalty_gateway_error', message: 'Não foi possível concluir a operação agora.' });
}

/** A lib usa `items`; o front histórico manda `itens`. Aceita os dois. */
function withItems(body = {}) {
  return { ...body, items: body.items || body.itens || [] };
}

// ---------------------------------------------------------------------------
// DONO: CRUD dos planos. As funções já existiam em lib/loyalty_plans.js e estavam órfãs —
// nenhuma rota as importava desde a remoção do módulo Mercado Pago.
// ---------------------------------------------------------------------------

router.get('/loyalty/plans', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const plans = await listLoyaltyPlansForEstablishment(req.user.id, { includeArchived: false });
    res.json({ items: plans });
  } catch (err) { sendError(res, err, 'plans_list'); }
});

router.get('/loyalty/plans/:id', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const plan = await getLoyaltyPlanForEstablishment(req.user.id, req.params.id);
    if (!plan) return res.status(404).json({ error: 'plan_not_found' });
    res.json(plan);
  } catch (err) { sendError(res, err, 'plan_get'); }
});

router.post('/loyalty/plans', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const plan = await createLoyaltyPlan(req.user.id, withItems(req.body));
    res.status(201).json(plan);
  } catch (err) { sendError(res, err, 'plan_create'); }
});

router.put('/loyalty/plans/:id', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const plan = await updateLoyaltyPlan(req.user.id, req.params.id, withItems(req.body));
    if (!plan) return res.status(404).json({ error: 'plan_not_found' });
    res.json(plan);
  } catch (err) { sendError(res, err, 'plan_update'); }
});

router.patch('/loyalty/plans/:id/status', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const plan = await updateLoyaltyPlanStatus(req.user.id, req.params.id, String(req.body?.status || ''));
    if (!plan) return res.status(404).json({ error: 'plan_not_found' });
    res.json(plan);
  } catch (err) { sendError(res, err, 'plan_status'); }
});

router.delete('/loyalty/plans/:id', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const ok = await archiveLoyaltyPlan(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'plan_not_found' });
    res.json({ ok: true });
  } catch (err) { sendError(res, err, 'plan_archive'); }
});

router.get('/loyalty/subscribers', auth, isEstabelecimento, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const items = await listLoyaltySubscribersForEstablishment(req.user.id, { status: String(req.query?.status || '') });
    res.json({ items });
  } catch (err) { sendError(res, err, 'subscribers'); }
});

/**
 * Quanto o dono recebe de fato. O percentual do Asaas incide sobre o LÍQUIDO e trunca
 * (medido em sandbox — ver lib/loyalty_split.js), então exibir "R$ 80 menos 5%" seria
 * mentira. Aqui sai o número real.
 */
router.get('/loyalty/split-preview', auth, isEstabelecimento, ensureLoyaltyEnabled, (req, res) => {
  const priceCents = Math.max(0, Math.round(Number(req.query?.price_cents || 0)));
  const cardFeeCents = Math.round(
    (priceCents * config.loyalty.cardFeePercent) / 100 + config.loyalty.cardFeeFixedCents,
  );
  const amounts = computeLoyaltySplitAmounts({
    grossCents: priceCents,
    asaasFeeCents: cardFeeCents,
    platformPercent: config.loyalty.platformPercent,
  });
  res.json({
    ...amounts,
    platform_percent: config.loyalty.platformPercent,
    // A taxa é ESTIMADA: o Asaas desconta a real por conta dele. Sem as envs de taxa
    // configuradas, isto vem 0 e o líquido exibido é teto, não realidade.
    card_fee_estimated: config.loyalty.cardFeePercent > 0 || config.loyalty.cardFeeFixedCents > 0,
  });
});

// ---------------------------------------------------------------------------
// PÚBLICO: a vitrine de planos do estabelecimento.
// ---------------------------------------------------------------------------

/**
 * A vitrine NÃO usa o `ensureLoyaltyEnabled`: com a flag desligada ela responde 200 com lista
 * vazia, e não 503.
 *
 * Por quê: esta rota é chamada em TODA abertura da página pública do estabelecimento. Com o
 * 503, cada visitante real virava uma linha `level: "error"` no log de produção — vi isso
 * acontecendo com um salão que recebe tráfego do Instagram. Log de erro que não é erro é pior
 * do que inútil: é onde o erro de verdade se esconde.
 *
 * E, para quem está só olhando a página, "sem planos" é a verdade — não uma falha. O 503
 * continua valendo onde faz sentido: para o DONO (que precisa saber que o recurso não está
 * habilitado) e para o CLIENTE que tenta assinar.
 */
router.get('/public/estabelecimentos/:idOrSlug/loyalty-plans', async (req, res) => {
  try {
    if (!config.loyalty.enabled) return res.json({ items: [] });
    const key = String(req.params.idOrSlug || '').trim();
    const [rows] = await pool.query(
      'SELECT id FROM usuarios WHERE tipo=\'estabelecimento\' AND (id=? OR slug=?) LIMIT 1',
      [Number(key) || 0, key],
    );
    const estabId = rows?.[0]?.id;
    if (!estabId) return res.status(404).json({ error: 'not_found' });
    const plans = await getPublicLoyaltyPlansForEstablishment(estabId);
    res.json({ items: plans });
  } catch (err) { sendError(res, err, 'public_plans'); }
});

// ---------------------------------------------------------------------------
// CLIENTE: assinar, ver, cancelar.
//
// Não existe rota de pagar por PIX: a decisão de produto é cartão recorrente (Fase 0). Uma
// fatura por ciclo, que o cliente precisa abrir e pagar todo mês, mata o plano no segundo
// mês — e é justamente o que a tokenização evita.
// ---------------------------------------------------------------------------

router.get('/cliente/loyalty/subscription', auth, isCliente, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.query?.estabelecimento_id || req.query?.establishmentId || 0);
    if (!estabelecimentoId) return res.status(400).json({ error: 'establishment_required' });
    const sub = await getPreferredClientLoyaltySubscription(req.user.id, estabelecimentoId);
    res.json({ subscription: sub ? serializeClientLoyaltySubscription(sub) : null });
  } catch (err) { sendError(res, err, 'client_subscription'); }
});

/** Contexto para a tela de agendamento: plano, créditos restantes por serviço. */
router.get('/cliente/loyalty/context', auth, isCliente, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const estabelecimentoId = Number(req.query?.estabelecimento_id || req.query?.establishmentId || 0);
    if (!estabelecimentoId) return res.status(400).json({ error: 'establishment_required' });
    const ctx = await getClientLoyaltyBenefitContext({
      clienteId: req.user.id,
      estabelecimentoId,
      appointmentAt: new Date(),
    });
    res.json(ctx || {});
  } catch (err) { sendError(res, err, 'client_context'); }
});

/**
 * Assina. O corpo NÃO precisa de cartão: a assinatura nasce sem ele e o cliente digita o
 * cartão na página do Asaas (`checkout_url`). O Asaas guarda o cartão e cobra os ciclos
 * seguintes sozinho — medido em sandbox. Assim o cartão nunca passa por este servidor, o
 * que nos mantém fora do escopo PCI e dispensa a aprovação de tokenização do Asaas.
 *
 * O caminho com `credit_card_token` continua aceito, para quem já tenha essa aprovação e
 * queira o formulário dentro do app.
 */
router.post('/cliente/loyalty/subscribe', auth, isCliente, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const result = await subscribeClientToPlan({
      clienteId: req.user.id,
      estabelecimentoId: Number(req.body?.estabelecimento_id || req.body?.establishmentId || 0),
      loyaltyPlanId: req.body?.loyalty_plan_id || req.body?.planId,
      creditCardToken: req.body?.credit_card_token || req.body?.creditCardToken,
      creditCard: req.body?.credit_card || req.body?.creditCard,
      creditCardHolderInfo: req.body?.credit_card_holder_info || req.body?.creditCardHolderInfo,
      // O antifraude do Asaas exige o IP do CLIENTE, não o do servidor.
      remoteIp: req.ip,
    });
    res.status(201).json({
      subscription: serializeClientLoyaltySubscription(result.subscription),
      checkout_url: result.checkoutUrl,
    });
  } catch (err) { sendError(res, err, 'client_subscribe'); }
});

router.post('/cliente/loyalty/cancel', auth, isCliente, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const result = await cancelClientPlanSubscription({
      clienteId: req.user.id,
      subscriptionId: req.body?.subscription_id || req.body?.subscriptionId,
    });
    res.json({ subscription: serializeClientLoyaltySubscription(result.subscription) });
  } catch (err) { sendError(res, err, 'client_cancel'); }
});

router.get('/cliente/loyalty/history', auth, isCliente, ensureLoyaltyEnabled, async (req, res) => {
  try {
    const subscriptionId = Number(req.query?.subscription_id || req.query?.subscriptionId || 0);
    if (!subscriptionId) return res.status(400).json({ error: 'subscription_required' });
    const events = await listClientLoyaltySubscriptionEvents(subscriptionId, { limit: 50 });
    res.json({ items: events });
  } catch (err) { sendError(res, err, 'client_history'); }
});

export default router;
