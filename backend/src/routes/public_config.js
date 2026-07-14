// backend/src/routes/public_config.js
// Config pública do frontend. Só o que a TELA precisa saber para não mentir para o usuário.
//
// Existe porque o frontend é estático: sem isto, mudar o estado do WhatsApp exigiria rebuild +
// deploy do bundle. Aqui, o dono liga/desliga no .env da VPS, reinicia o PM2, e os avisos aparecem
// ou somem sozinhos.
//
// Regra de ouro deste arquivo: NADA de segredo, nada de dado de tenant, nada que dependa de quem
// está pedindo. É rota pública, sem auth, servida a qualquer visitante anônimo — e tudo que entrar
// aqui é, na prática, público para sempre.
import { Router } from 'express';
import { whatsappAvailable } from '../lib/whatsapp_availability.js';

const router = Router();

router.get('/config', (_req, res) => {
  // Cache curto: a flag muda uma vez a cada seis meses, mas quando muda (a conta voltou!) a gente
  // não quer esperar um cache longo expirar em cada navegador.
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    whatsapp: {
      available: whatsappAvailable(),
    },
  });
});

export default router;
