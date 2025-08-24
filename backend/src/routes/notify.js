// backend/src/routes/notify.js
import { Router } from 'express';
import { waSendText, waSendTemplate } from '../lib/whatsapp.js';

const router = Router();

// Texto livre
router.post('/whatsapp/text', async (req, res) => {
  try {
    const { to, message } = req.body || {};
    const data = await waSendText({ to, body: message || 'Teste via Cloud API' });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[notify/text]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Template hello_world
router.post('/whatsapp/template', async (req, res) => {
  try {
    const { to, name, lang } = req.body || {};
    const data = await waSendTemplate({ to, name, lang });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[notify/template]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
