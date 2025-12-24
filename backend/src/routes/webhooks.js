// backend/src/routes/webhooks.js
import express from 'express';
export const router = express.Router();

// se você for validar assinatura do MP, salve o raw body:
function rawSaver(req, res, buf) { req.rawBody = buf; }

export function mountWebhooks(app, withApiPrefix = false) {
  const paths = withApiPrefix
    ? ['/api/webhook/mercadopago', '/webhook/mercadopago'] // aceita ambos
    : ['/webhook/mercadopago', '/api/webhook/mercadopago'];

  app.use(paths, express.json({ verify: rawSaver, limit: '5mb' }));
  app.use(paths, express.urlencoded({ extended: true, verify: rawSaver, limit: '5mb' }));

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

      // Apenas registra e responde rápido para evitar retries agressivos do MP
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
