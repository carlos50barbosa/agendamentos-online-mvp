// backend/src/routes/notifications.js
import { Router } from 'express';
import { notifyWhatsapp, scheduleWhatsApp } from '../lib/notifications.js';
import { auth as authRequired } from '../middleware/auth.js'; // se quiser exigir auth para testar, deixe


const router = Router();

// Inicia o scheduler ao carregar o módulo
// startWhatsAppScheduler();

// Envio imediato (teste)
// POST /notifications/whatsapp/send  { to, message }
router.post('/whatsapp/send', /* authRequired, */ async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: 'missing_fields' });
  const r = await notifyWhatsapp(message, to);
  if (!r.ok) return res.status(502).json({ ok: false, ...r });
  res.json({ ok: true });
});

// Agendamento persistente
// POST /notifications/whatsapp/schedule  { to, scheduledAt, message, metadata? }
router.post('/whatsapp/schedule', /* authRequired, */ async (req, res) => {
  try {
    const { to, scheduledAt, message, metadata } = req.body || {};
    if (!to || !scheduledAt || !message) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const r = await scheduleWhatsApp({ to, scheduledAt, message, metadata });
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e) {
    console.error('[notifications/schedule] erro:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
