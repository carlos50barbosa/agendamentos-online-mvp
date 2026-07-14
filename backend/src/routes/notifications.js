// backend/src/routes/notifications.js
import { Router } from 'express';
import { notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';
import { auth as authRequired } from '../middleware/auth.js';
import { getPlanContext, isDelinquentStatus, resolvePlanConfig } from '../lib/plans.js';
import { hasWhatsAppConsent } from '../lib/whatsapp_consent.js';

const router = Router();

/**
 * Estas duas rotas mandam TEXTO LIVRE para um número ARBITRÁRIO pela WABA da plataforma — é a
 * arma mais carregada do backend. Bastava um token de estabelecimento para disparar o que quisesse
 * para quem quisesse, sem opt-in e sem passar pela carteira. Não sei se foi por aqui que a conta
 * caiu, mas era por aqui que dava para derrubá-la.
 *
 * Agora vale a mesma regra de todo o resto: sem consentimento registrado do destinatário, não sai.
 */
async function assertRecipientConsent(to) {
  const consented = await hasWhatsAppConsent(to);
  if (consented) return { allowed: true };
  return {
    allowed: false,
    message: 'Este número não autorizou receber mensagens no WhatsApp. Envie por outro canal.',
  };
}

async function assertWhatsAppAllowed(user) {
  if (!user || user.tipo !== 'estabelecimento') {
    return { allowed: false, message: 'Apenas estabelecimentos podem usar este recurso.' };
  }

  const context = await getPlanContext(user.id);
  const plan = context?.plan || 'starter';
  const status = context?.status || null;
  const config = context?.config || resolvePlanConfig(plan);

  if (isDelinquentStatus(status)) {
    return {
      allowed: false,
      plan,
      status,
      message: 'Sua assinatura está em atraso. Regularize o pagamento para continuar enviando notificações.',
    };
  }

  if (config && config.allowWhatsApp === false) {
    return {
      allowed: false,
      plan,
      status,
      message: 'Seu plano atual não inclui notificações por WhatsApp.',
    };
  }

  return {
    allowed: true,
    plan,
    status,
  };
}

// Envio imediato (teste)
// POST /notifications/whatsapp/send  { to, message }
router.post('/whatsapp/send', authRequired, async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: 'missing_fields' });

  const planCheck = await assertWhatsAppAllowed(req.user);
  if (!planCheck.allowed) {
    return res.status(403).json({ error: 'plan_restricted', message: planCheck.message });
  }

  const consentCheck = await assertRecipientConsent(to);
  if (!consentCheck.allowed) {
    return res.status(403).json({ error: 'no_optin', message: consentCheck.message });
  }

  try {
    const r = await notifyWhatsapp(message, to, { estabelecimentoId: req.user.id });
    if (r && r.blocked) return res.status(202).json({ ok: true, blocked: true });
    return res.json({ ok: true, result: r });
  } catch (e) {
    console.error('[notifications/send] erro:', e);
    return res.status(502).json({ ok: false, error: 'send_failed', detail: e?.message || '' });
  }
});

// Agendamento persistente
// POST /notifications/whatsapp/schedule  { to, scheduledAt, message, metadata? }
router.post('/whatsapp/schedule', authRequired, async (req, res) => {
  try {
    const { to, scheduledAt, message, metadata } = req.body || {};
    if (!to || !scheduledAt || !message) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const planCheck = await assertWhatsAppAllowed(req.user);
    if (!planCheck.allowed) {
      return res.status(403).json({ error: 'plan_restricted', message: planCheck.message });
    }

    const consentCheck = await assertRecipientConsent(to);
    if (!consentCheck.allowed) {
      return res.status(403).json({ error: 'no_optin', message: consentCheck.message });
    }

    const r = await scheduleWhatsApp({ to, scheduledAt, message, metadata, estabelecimentoId: req.user.id });
    if (r && r.blocked) return res.status(202).json({ ok: true, blocked: true });
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[notifications/schedule] erro:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;




