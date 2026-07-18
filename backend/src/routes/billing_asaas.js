// backend/src/routes/billing_asaas.js
// Rotas de assinatura do tenant via Asaas (checkout hospedado). Aditivo — não
// toca no billing.js/MP. Ativo quando ASAAS_API_KEY está configurada.
import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { config } from '../lib/config.js';
import { pool } from '../lib/db.js';
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

    // Asaas exige CPF/CNPJ do pagador. Usa o do perfil; se faltar, aceita no body,
    // valida e persiste em usuarios.cpf_cnpj antes de criar a assinatura.
    const [urows] = await pool.query('SELECT cpf_cnpj FROM usuarios WHERE id=? LIMIT 1', [req.user.id]);
    let cpfDigits = String(urows?.[0]?.cpf_cnpj ?? '').replace(/\D/g, '');
    if (!cpfDigits) {
      const provided = String(req.body?.cpf_cnpj ?? req.body?.cpfCnpj ?? '').replace(/\D/g, '');
      if (!provided) {
        return res.status(400).json({ error: 'cpf_required', message: 'Informe seu CPF ou CNPJ para assinar.' });
      }
      if (![11, 14].includes(provided.length)) {
        return res.status(400).json({ error: 'cpf_cnpj_invalido', message: 'Informe um CPF ou CNPJ válido.' });
      }
      await pool.query(
        "UPDATE usuarios SET cpf_cnpj=? WHERE id=? AND (cpf_cnpj IS NULL OR cpf_cnpj='')",
        [provided, req.user.id],
      );
      cpfDigits = provided;
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
    // O 502 genérico escondia a causa: um AsaasError já traz a descrição do Asaas em .message,
    // além de .status e .body. Loga o payload completo para diagnóstico (antes só ia err.message).
    const asaasStatus = Number(err?.status) || null;
    console.error('[billing/asaas][checkout-session]', {
      estabelecimentoId: req.user?.id,
      message: err?.message || String(err),
      status: asaasStatus,
      body: err?.body ?? null,
    });
    // Quando é erro de VALIDAÇÃO do Asaas (400/422), devolve a mensagem dele ao dono: ela é sobre o
    // dado do próprio cadastro (CPF/CNPJ, telefone, e-mail) e é ACIONÁVEL. "Tente novamente" só faria
    // reenviar o mesmo dado inválido. Demais erros (auth, indisponibilidade, rede) seguem genéricos —
    // não são acionáveis pelo usuário e podem expor configuração.
    if (err?.name === 'AsaasError' && (asaasStatus === 400 || asaasStatus === 422)) {
      return res.status(400).json({
        error: 'asaas_validation_error',
        message: err.message || 'Revise seus dados de cobrança (CPF/CNPJ e telefone) e tente novamente.',
      });
    }
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
