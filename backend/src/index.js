// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

import authRouter from './routes/auth.js';
import servicosRouter from './routes/servicos.js';
import agendamentosRouter from './routes/agendamentos.js';
import slotsRouter from './routes/slots.js';
import estabelecimentosRoutes from './routes/estabelecimentos.js';
import notificationsRouter from './routes/notifications.js'; // opcional
import notifyRouter from './routes/notify.js'; // rota de teste de notificações
import adminRouter from './routes/admin.js';
import relatoriosRouter from './routes/relatorios.js';
import billingRouter from './routes/billing.js';
import waWebhookRouter from './routes/whatsapp_webhook.js';
import publicAgendamentosRouter from './routes/agendamentos_public.js';
import otpPublicRouter from './routes/otp_public.js';
import profissionaisRouter from './routes/profissionais.js';
import { pool } from './lib/db.js';
import { startMaintenance } from './lib/maintenance.js';
import { mountWebhooks } from './routes/webhooks.js';
import { startBillingMonitor } from './lib/billing_monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

const app = express();

// Se hoje o Nginx mantém /api até o Node, passe withApiPrefix=true (mas aceitamos ambos):
mountWebhooks(app, true);

app.set('trust proxy', 1);
app.use(morgan('dev'));
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    // Vite dev server
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Admin-Token', 'X-Admin-Allow-Write', 'X-OTP-Token'],
}));
app.options('*', cors());
app.use(express.json({ limit: '5mb' }));

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
app.use('/api/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// Health
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/health', (_req, res) => res.status(200).send('ok'));

// Raiz
app.get('/', (_req, res) =>
  res.json({ ok: true, msg: 'Backend rodando. Use as rotas da API.' })
);

// Redireciona rotas de SPA do front quando acessadas pelo domínio do backend (útil para back_url)
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
function redirectToFront(path) {
  return (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = `${FRONTEND_BASE}${path || req.path}${qs}`;
    res.redirect(302, target);
  };
}

// Ajuste mínimo: rota usada pelo back_url do Mercado Pago
app.get('/configuracoes', redirectToFront('/configuracoes'));

// Rotas “sem /api”
app.use('/auth', authRouter);
app.use('/servicos', servicosRouter);
app.use('/agendamentos', agendamentosRouter);
app.use('/slots', slotsRouter);
app.use('/notifications', notificationsRouter);
app.use('/establishments', estabelecimentosRoutes);
app.use('/estabelecimentos', estabelecimentosRoutes);
app.use('/profissionais', profissionaisRouter);
app.use('/notify', notifyRouter);
app.use('/public/otp', otpPublicRouter);
app.use('/public/agendamentos', publicAgendamentosRouter);
app.use('/admin', adminRouter);
app.use('/relatorios', relatoriosRouter);
app.use('/billing', billingRouter);
app.use('/webhooks/whatsapp', waWebhookRouter);

// Aliases “/api/*” (seu Nginx usa /api)
app.use('/api/auth', authRouter);
app.use('/api/servicos', servicosRouter);
app.use('/api/agendamentos', agendamentosRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/establishments', estabelecimentosRoutes);
app.use('/api/estabelecimentos', estabelecimentosRoutes);
app.use('/api/profissionais', profissionaisRouter);
app.use('/api/notify', notifyRouter);
app.use('/api/public/otp', otpPublicRouter);
app.use('/api/public/agendamentos', publicAgendamentosRouter);
app.use('/api/admin', adminRouter);
app.use('/api/relatorios', relatoriosRouter);
app.use('/api/billing', billingRouter);
app.use('/api/webhooks/whatsapp', waWebhookRouter);

// Middleware final de erro
app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED]', err);
  res.status(err.status || 500).json({ error: 'internal_error', detail: err.message });
});

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3002);

app.listen(PORT, HOST, () => {
  console.log(`✅ Backend ouvindo em http://${HOST}:${PORT}`);
});

// Tarefas de manutencao: limpeza de tokens expirados e lembretes de cobranca
startMaintenance(pool);
startBillingMonitor();
