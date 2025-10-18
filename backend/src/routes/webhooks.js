// backend/src/routes/webhooks.js
import express from 'express';
import { syncMercadoPagoPreapproval } from '../lib/billing.js';
export const router = express.Router();

// se você for validar assinatura do MP, salve o raw body:
function rawSaver(req, res, buf) { req.rawBody = buf; }

export function mountWebhooks(app, withApiPrefix = false) {
  app.use(express.json({ verify: rawSaver }));
  app.use(express.urlencoded({ extended: true, verify: rawSaver }));

  const paths = withApiPrefix
    ? ['/api/webhook/mercadopago', '/webhook/mercadopago'] // aceita ambos
    : ['/webhook/mercadopago', '/api/webhook/mercadopago'];

  app.post(paths, async (req, res) => {
    try {
      // Mercado Pago envia identificadores por query e/ou body
      const q = req.query || {};
      const b = req.body || {};
      const resourceId =
        q['data.id'] ||
        b?.data?.id ||
        q.id ||
        b.id ||
        b.resource ||
        null;

      console.log('[MP] webhook hit', { path: paths, query: q, headers: req.headers });

      if (!resourceId) {
        console.warn('[MP] webhook without resource id; skipping sync');
        return res.status(200).send('OK');
      }

      // Sincroniza imediatamente a assinatura/preapproval.
      // Observação: a verificação de assinatura completa existe em /billing/webhook.
      try {
        await syncMercadoPagoPreapproval(String(resourceId), b && Object.keys(b).length ? b : { action: 'mp_webhook' });
        console.log('[MP] webhook synced', resourceId);
      } catch (e) {
        console.error('[MP] webhook sync failed', resourceId, e?.message || e);
      }

      // Responda rápido para evitar retries agressivos do MP
      res.status(200).send('OK');
    } catch (e) {
      console.error('[MP] webhook error', e);
      // Ainda devolva 200 para o MP não retentar sem fim
      res.status(200).send('OK');
    }
  });

  // opcional, para testes manuais por GET:
  app.get(paths, (req, res) => res.status(200).send('OK'));
}
