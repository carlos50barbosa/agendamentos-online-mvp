// backend/src/routes/notifications.js
import { Router } from 'express';
import { notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';
import { auth as authRequired } from '../middleware/auth.js';
import { getPlanContext, isDelinquentStatus, resolvePlanConfig } from '../lib/plans.js';

const router = Router();

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
      message: 'Sua assinatura está em atraso. Regularize o pagamento para continuar enviando notificacões.',
    };
  }

  if (config && config.allowWhatsApp === false) {
    return {
      allowed: false,
      plan,
      status,
      message: 'Seu plano atual não inclui notificacões por WhatsApp.',
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

  try {
    const r = await notifyWhatsapp(message, to);
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

    const r = await scheduleWhatsApp({ to, scheduledAt, message, metadata });
    if (r && r.blocked) return res.status(202).json({ ok: true, blocked: true });
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[notifications/schedule] erro:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;




