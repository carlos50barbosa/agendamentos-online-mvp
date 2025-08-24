// backend/src/routes/notifications.js
import express from "express";
import { auth } from "../middleware/auth.js";
import { scheduleWhatsApp } from "../lib/notifications.js";

const router = express.Router();

/**
 * 📅 Agenda envio de WhatsApp para o futuro.
 * Body:
 *  - to: string (telefone com DDI, ex: 55XXXXXXXXXXX)
 *  - scheduledAt: ISO string (data futura)
 *  - message?: string
 *  - template?: { name: string, lang?: 'pt_BR', params?: [{type:'text', text:string}] }
 *  - metadata?: any
 */
router.post("/whatsapp/schedule", auth, async (req, res) => {
  try {
    const { to, scheduledAt, message, template, metadata } = req.body || {};
    if (!to) return res.status(400).json({ error: "invalid_phone" });
    if (!scheduledAt) return res.status(400).json({ error: "invalid_scheduledAt" });
    if (!message && !template) return res.status(400).json({ error: "missing_message_or_template" });

    const result = await scheduleWhatsApp({ to, scheduledAt, message, template, metadata });
    return res.json(result);
  } catch (e) {
    return res.status(400).json({ error: e.message || "api_error" });
  }
});

/**
 * ⚡ Envio imediato (sem agendamento) — ideal para testes rápidos.
 * Body:
 *  - to: string (telefone com DDI, ex: 55XXXXXXXXXXX)
 *  - message?: string
 *  - template?: { name, lang?: 'pt_BR', params?: [{type:'text', text:string}] }
 *
 * Observações:
 *  - Se enviar apenas "message", fora da janela de 24h a Meta pode bloquear.
 *  - Para garantir entrega fora da janela, use "template" aprovado.
 */
router.post("/whatsapp/send", auth, async (req, res) => {
  try {
    const { to, message, template } = req.body || {};
    if (!to) return res.status(400).json({ error: "invalid_phone" });
    if (!message && !template) return res.status(400).json({ error: "missing_message_or_template" });

    // normaliza telefone simples (E.164 sem '+')
    const phone = String(to).replace(/\D/g, "");

    const result = await sendWhatsAppDirect({ to: phone, message, template });
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(400).json({ error: e.message || "api_error" });
  }
});

export default router;
