// backend/src/routes/notifications.js
import { Router } from 'express';
import { notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';
import { auth as authRequired } from '../middleware/auth.js';
import { pool } from '../lib/db.js';

const router = Router();

async function assertWhatsAppAllowed(user) {
  if (!user || user.tipo !== 'estabelecimento') {
    return { allowed: false, message: 'Apenas estabelecimentos podem usar este recurso.' };
  }
  const [rows] = await pool.query("SELECT plan FROM usuarios WHERE id=? LIMIT 1", [user.id]);
  const plan = rows?.[0]?.plan || 'starter';
  if (plan === 'starter') {
    return { allowed: false, plan, message: 'Disponível apenas para planos Pro e Premium.' };
  }
  return { allowed: true, plan };
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
