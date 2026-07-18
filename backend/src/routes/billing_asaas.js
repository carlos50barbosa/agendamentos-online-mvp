// backend/src/routes/billing_asaas.js
// Rotas de assinatura do tenant via Asaas (checkout hospedado). Aditivo — não
// toca no billing.js/MP. Ativo quando ASAAS_API_KEY está configurada.
import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { config } from '../lib/config.js';
import { pool } from '../lib/db.js';
import { serializeSubscription } from '../lib/subscriptions.js';
import { createTenantAsaasSubscription, changeTenantAsaasPlan, resolveActiveSubscriptionChange, resolveBillingProvider } from '../lib/asaas_subscription.js';
import { createAsaasPayments } from '../services/asaas/payments.js';
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

    // Trava anti-duplicidade / ja-ativo / troca-de-plano (fix A). GET_LOCK por estabelecimento
    // serializa o check-then-create (fecha a race de cliques/abas simultaneos). A conexao DEDICADA e
    // obrigatoria: GET_LOCK e RELEASE_LOCK precisam rodar na MESMA conexao (pool.query pega conexoes
    // diferentes a cada chamada). Todas as queries do bloco correm nessa conexao.
    const lockKey = `asaas_sub:${req.user.id}`;
    const conn = await pool.getConnection();
    let lockAcquired = false;
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      try { if (lockAcquired) await conn.query('SELECT RELEASE_LOCK(?)', [lockKey]); } catch {}
      conn.release();
    };
    try {
      // GET_LOCK devolve 1 (adquiriu), 0 (timeout em 5s — outro pedido segura) ou NULL (erro).
      // Ignorar o retorno reabriria a race: no timeout seguiriamos SEM o lock. Falha fechado.
      const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [lockKey]);
      lockAcquired = Number(lockRow?.got) === 1;
      if (!lockAcquired) {
        return res.status(409).json({
          error: 'checkout_in_progress',
          message: 'Já há um pedido de assinatura em andamento. Aguarde alguns segundos e tente de novo.',
        });
      }

      // Estado atual das DUAS fontes: usuarios (autoritativo, setado no webhook) E a subscription
      // Asaas mais recente. Checar so usuarios deixaria uma janela: se o webhook grava subscriptions
      // 'active' mas falha antes de gravar usuarios, um novo checkout criaria uma 2a assinatura e o
      // supersede (que protege 'active' vigente) NAO cancelaria a antiga -> duas cobrando em paralelo.
      const [[uState]] = await conn.query(
        'SELECT plan_status, plan_active_until, plan, plan_cycle FROM usuarios WHERE id=? LIMIT 1',
        [req.user.id],
      );
      const [latestRows] = await conn.query(
        `SELECT id, gateway_subscription_id, status, plan, billing_cycle, current_period_end FROM subscriptions
           WHERE estabelecimento_id=? AND gateway='asaas' AND external_reference LIKE 'subscription:estab:%'
           ORDER BY created_at DESC LIMIT 1`,
        [req.user.id],
      );
      const latest = latestRows?.[0] || null;
      const nowMs = Date.now();
      const uActive = String(uState?.plan_status || '').toLowerCase() === 'active'
        && uState?.plan_active_until && new Date(uState.plan_active_until).getTime() > nowMs;
      const subActive = latest && String(latest.status) === 'active'
        && latest.current_period_end && new Date(latest.current_period_end).getTime() > nowMs;
      // Periodo PAGO vigente + JA existe uma assinatura Asaas deste tenant = estado pago-mas-baguncado
      // (a pendente orfa que corrompe plan_status; ver subscription_reconcile). NUNCA cria/reaproveita
      // uma 2a cobranca aqui — cai no ramo ativo, que devolve 409 (already_active / no_active_subscription)
      // e evita cobranca dupla. Sem `latest` (ex.: migracao MP->Asaas ainda no periodo pago) deixa criar.
      const hasPaidPeriod = Boolean(uState?.plan_active_until) && new Date(uState.plan_active_until).getTime() > nowMs;

      if (uActive || subActive || (hasPaidPeriod && latest)) {
        const currentPlan = String(uState?.plan || latest?.plan || '').toLowerCase();
        const currentCycle = normalizeBillingCycle(uState?.plan_cycle || latest?.billing_cycle || 'mensal');
        const activeUntil = uState?.plan_active_until ? new Date(uState.plan_active_until)
          : (latest?.current_period_end ? new Date(latest.current_period_end) : null);
        const untilLabel = activeUntil ? activeUntil.toLocaleDateString('pt-BR') : null;
        const activeUntilIso = activeUntil ? activeUntil.toISOString() : null;
        const activeSub = latest && String(latest.status) === 'active' && latest.gateway_subscription_id ? latest : null;
        // Decisao PURA (ordem: ja-ativo -> anual -> downgrade -> sem-gateway -> troca). Ver
        // resolveActiveSubscriptionChange (testado em asaas-subscription.test.js).
        const action = resolveActiveSubscriptionChange({
          currentPlan,
          currentCycle,
          requestedPlan: plan,
          requestedCycle: cycle,
          hasActiveGatewaySub: Boolean(activeSub),
        });
        if (action === 'already_active') {
          // Mesmo plano+ciclo: nada a fazer (renova sozinho) — o caso que o dono relatou.
          return res.status(409).json({
            error: 'subscription_already_active',
            message: untilLabel
              ? `Sua assinatura já está ativa até ${untilLabel} e renova automaticamente — não é necessário gerar um novo pagamento.`
              : 'Sua assinatura já está ativa — não é necessário gerar um novo pagamento.',
            active_until: activeUntilIso,
          });
        }
        if (action === 'annual_support') {
          // Periodo PAGO anual: janela nao expirada grande demais para dar acesso de graca (subir de
          // tier) ou converter em mensal sem proracao. Vai pro suporte (ajuste manual: Asaas + banco).
          return res.status(409).json({
            error: 'plan_change_annual_support',
            message: untilLabel
              ? `Sua assinatura anual está ativa até ${untilLabel}. Para trocar de plano antes disso, fale com o suporte — ajustamos sem você perder o período já pago.`
              : 'Para trocar de plano com uma assinatura anual ativa, fale com o suporte — ajustamos sem você perder o período já pago.',
            active_until: activeUntilIso,
          });
        }
        if (action === 'downgrade_unsupported') {
          // Downgrade (descer de tier) fica de fora do MVP — precisaria de troca AGENDADA p/ fim do ciclo.
          return res.status(409).json({
            error: 'plan_downgrade_unsupported',
            message: untilLabel
              ? `Sua assinatura está ativa até ${untilLabel}. Baixar de plano ainda não está disponível por aqui — fale com o suporte.`
              : 'Baixar de plano com uma assinatura ativa ainda não está disponível por aqui — fale com o suporte.',
            active_until: activeUntilIso,
          });
        }
        if (action === 'no_active_subscription') {
          return res.status(409).json({
            error: 'plan_change_no_active_subscription',
            message: 'Não encontramos sua assinatura ativa no gateway para trocar o plano. Tente novamente em instantes.',
          });
        }
        // action === 'change': TROCA (partindo do MENSAL) via update-in-place — muda o valor da MESMA
        // assinatura; o novo valor vale na proxima cobranca e o acesso ao novo tier sobe na hora.
        const changed = await changeTenantAsaasPlan({
          estabelecimentoId: req.user.id,
          subscription: { id: activeSub.id, gatewaySubscriptionId: activeSub.gateway_subscription_id },
          plan,
          cycle,
          db: conn,
        });
        return res.status(200).json({
          provider: 'asaas',
          plan_changed: true,
          plan: changed.plan,
          cycle: changed.cycle,
          active_until: activeUntilIso,
          message: untilLabel
            ? `Plano alterado para ${changed.planLabel}. O acesso já vale; a nova cobrança entra na próxima renovação (${untilLabel}).`
            : `Plano alterado para ${changed.planLabel}. O acesso já vale.`,
        });
      }

      // Reaproveita cobranca pendente PAGAVEL do MESMO plano+ciclo (nunca de outro plano — senao o
      // dono pagaria o plano/valor errado). Sem match, cai no create (o supersede cancela a pendente
      // antiga nao-ativa).
      const [pendRows] = await conn.query(
        `SELECT gateway_subscription_id FROM subscriptions
           WHERE estabelecimento_id=? AND gateway='asaas'
             AND external_reference LIKE 'subscription:estab:%'
             AND status IN ('pending_payment','pending_pix')
             AND plan=? AND billing_cycle=?
           ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, plan, cycle],
      );
      const pendingGatewayId = pendRows?.[0]?.gateway_subscription_id || null;
      if (pendingGatewayId) {
        try {
          const charges = await createAsaasPayments().getSubscriptionPayments(pendingGatewayId);
          const first = Array.isArray(charges) ? charges[0] : null;
          const payable = first && String(first.status || '').toUpperCase() === 'PENDING';
          const checkoutUrl = payable ? (first.invoiceUrl || first.bankSlipUrl || null) : null;
          if (checkoutUrl) {
            return res.status(200).json({
              provider: 'asaas',
              reused: true,
              init_point: checkoutUrl,
              checkout_url: checkoutUrl,
              asaas_subscription_id: pendingGatewayId,
              first_payment_id: first?.id ? String(first.id) : null,
            });
          }
        } catch (err) {
          console.warn('[billing/asaas][checkout-session] falha ao reaproveitar cobranca pendente', err?.message || err);
          // cai para criar uma nova
        }
      }

      const result = await createTenantAsaasSubscription({
        estabelecimentoId: req.user.id,
        plan,
        cycle,
        db: conn,
      });

      return res.status(201).json({
        provider: 'asaas',
        init_point: result.checkoutUrl,
        checkout_url: result.checkoutUrl,
        asaas_subscription_id: result.asaasSubscriptionId,
        first_payment_id: result.firstPaymentId,
        subscription: serializeSubscription(result.subscription),
      });
    } finally {
      await cleanup();
    }
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
