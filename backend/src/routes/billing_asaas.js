// backend/src/routes/billing_asaas.js
// Rotas de assinatura do tenant via Asaas (checkout hospedado). Aditivo — não
// toca no billing.js/MP. Ativo quando ASAAS_API_KEY está configurada.
import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { config } from '../lib/config.js';
import { serializeSubscription } from '../lib/subscriptions.js';
import { createTenantAsaasSubscription, resolveBillingProvider } from '../lib/asaas_subscription.js';
import { PLAN_TIERS, normalizeBillingCycle } from '../lib/plans.js';

const router = Router();

function ensureAsaasConfigured(req, res, next) {
  if (!config.asaas.apiKey) {
    return res.status(503).json({ error: 'asaas_not_configured' });
  }
  next();
}

// Cria a sessão de pagamento (assinatura recorrente) e devolve o init_point.
router.post('/checkout-session', auth, isEstabelecimento, ensureAsaasConfigured, async (req, res) => {
  try {
    const plan = String(req.body?.plan || '').toLowerCase();
    const cycle = normalizeBillingCycle(req.body?.billing_cycle || req.body?.cycle);
    if (!PLAN_TIERS.includes(plan)) {
      return res.status(400).json({ error: 'invalid_plan' });
    }

    const result = await createTenantAsaasSubscription({
      estabelecimentoId: req.user.id,
      plan,
      cycle,
    });

    return res.status(201).json({
      provider: 'asaas',
      init_point: result.checkoutUrl,
      checkout_url: result.checkoutUrl,
      asaas_subscription_id: result.asaasSubscriptionId,
      first_payment_id: result.firstPaymentId,
      subscription: serializeSubscription(result.subscription),
    });
  } catch (err) {
    console.error('[billing/asaas][checkout-session]', err?.message || err);
    return res.status(502).json({
      error: 'asaas_subscription_failed',
      message: 'Não foi possível iniciar a assinatura no Asaas. Tente novamente.',
    });
  }
});

// Diagnóstico simples do provider ativo.
router.get('/provider', auth, isEstabelecimento, (_req, res) => {
  res.status(200).json({ billing_provider: resolveBillingProvider(), asaas_configured: Boolean(config.asaas.apiKey) });
});

export default router;
