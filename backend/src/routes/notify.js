// backend/src/routes/notify.js
import { Router } from 'express';
import { sendWhatsAppSmart } from '../lib/notifications.js';
import { waSendTemplate } from '../lib/whatsapp.js';

const router = Router();

// Texto livre
router.post('/whatsapp/text', async (req, res) => {
  try {
    const { to, message, text, templateNameFallback } = req.body || {};
    const fallbackName =
      templateNameFallback ||
      process.env.WA_TEMPLATE_NAME_FALLBACK ||
      process.env.WA_TEMPLATE_NAME ||
      'hello_world';
    const payloadText = message ?? text ?? 'Teste via Cloud API';
    const { result, meta } = await sendWhatsAppSmart({
      to,
      text: payloadText,
      templateNameFallback: fallbackName,
      returnMeta: true,
    });
    res.json({
      ok: true,
      decision: meta?.decision || null,
      window_open: meta?.window_open ?? null,
      force_template: meta?.force_template ?? false,
      wamid: meta?.wamid || null,
      data: result,
    });
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
