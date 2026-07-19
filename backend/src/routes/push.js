// backend/src/routes/push.js
// Inscricao e cancelamento de Web Push do usuario logado.
//
// O navegador gera a assinatura (endpoint + chaves) e manda para ca; a partir
// dai o backend consegue empurrar notificacao para aquele aparelho mesmo com o
// app fechado. Nao ha nada de segredo do servidor no que trafega: a assinatura
// so vale para o par de chaves VAPID desta aplicacao.
//
// Uma assinatura pertence ao usuario logado NO MOMENTO da inscricao. Se outra
// pessoa logar no mesmo navegador e se inscrever, o ON DUPLICATE KEY em
// saveSubscription reatribui a linha — e nao ficam duas pessoas recebendo o
// agendamento uma da outra.
import { Router } from 'express';
import { auth as authRequired } from '../middleware/auth.js';
import { pushEnabled, saveSubscription, removeSubscription, sendPushToUser } from '../lib/web_push.js';

const router = Router();

router.post('/subscribe', authRequired, async (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'push_disabled' });
  try {
    const r = await saveSubscription(req.user.id, req.body?.subscription || req.body, req.get('user-agent'));
    if (!r.ok) {
      const status = r.error === 'invalid_subscription' ? 400 : 500;
      return res.status(status).json({ error: r.error });
    }
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[push/subscribe] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/subscribe', authRequired, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' });
    const r = await removeSubscription(req.user.id, endpoint);
    if (!r.ok) return res.status(500).json({ error: r.error });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[push/subscribe:delete] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Envia para o proprio usuario logado. Existe para o botao "enviar teste" da
// tela de configuracoes: sem ele, a unica forma de saber se a permissao pegou
// de verdade seria esperar um agendamento real acontecer.
router.post('/test', authRequired, async (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'push_disabled' });
  try {
    const r = await sendPushToUser(req.user.id, {
      title: 'Notificações ativadas',
      body: 'É assim que você vai receber um novo agendamento.',
      url: '/estab',
      tag: 'push-test',
    });
    if (!r.sent) return res.status(404).json({ error: 'no_subscriptions' });
    return res.json({ ok: true, sent: r.sent });
  } catch (e) {
    console.error('[push/test] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
