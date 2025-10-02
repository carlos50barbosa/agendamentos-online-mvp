// backend/src/routes/webhooks.js
import express from 'express';
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
      // Mercado Pago manda query params (data.id, type, etc.)
      const { 'data.id': dataId, type } = req.query;
      console.log('[MP] query:', req.query);
      console.log('[MP] headers:', req.headers);
      console.log('[MP] body:', req.body);

      // TODO: validar assinatura (x-signature/x-request-id) aqui se habilitado

      // TODO: enfileirar/confirmar processamento de dataId
      res.status(200).send('OK'); // responda rápido para evitar retries
    } catch (e) {
      console.error('[MP] webhook error', e);
      res.status(200).send('OK'); // ainda devolva 200 para o MP não retentar sem fim
    }
  });

  // opcional, para testes manuais por GET:
  app.get(paths, (req, res) => res.status(200).send('OK'));
}
