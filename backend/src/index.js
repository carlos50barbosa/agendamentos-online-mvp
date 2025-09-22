// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import authRouter from './routes/auth.js';
import servicosRouter from './routes/servicos.js';
import agendamentosRouter from './routes/agendamentos.js';
import slotsRouter from './routes/slots.js';
import estabelecimentosRoutes from './routes/estabelecimentos.js';
import notificationsRouter from './routes/notifications.js'; // opcional
import notifyRouter from './routes/notify.js'; // rota de teste de notificações
import adminRouter from './routes/admin.js';
import relatoriosRouter from './routes/relatorios.js';
import waWebhookRouter from './routes/whatsapp_webhook.js';
import publicAgendamentosRouter from './routes/agendamentos_public.js';
import otpPublicRouter from './routes/otp_public.js';
import { pool } from './lib/db.js';
import { startMaintenance } from './lib/maintenance.js';


const app = express();

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
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Admin-Token', 'X-OTP-Token'],
}));
app.options('*', cors());
app.use(express.json());

// Health
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/health', (_req, res) => res.status(200).send('ok'));

// Raiz
app.get('/', (_req, res) =>
  res.json({ ok: true, msg: 'Backend rodando. Use as rotas da API.' })
);

// Rotas “sem /api”
app.use('/auth', authRouter);
app.use('/servicos', servicosRouter);
app.use('/agendamentos', agendamentosRouter);
app.use('/slots', slotsRouter);
app.use('/notifications', notificationsRouter);
app.use('/establishments', estabelecimentosRoutes);
app.use('/estabelecimentos', estabelecimentosRoutes);
app.use('/notify', notifyRouter);
app.use('/public/otp', otpPublicRouter);
app.use('/public/agendamentos', publicAgendamentosRouter);
app.use('/admin', adminRouter);
app.use('/relatorios', relatoriosRouter);
app.use('/webhooks/whatsapp', waWebhookRouter);

// Aliases “/api/*” (seu Nginx usa /api)
app.use('/api/auth', authRouter);
app.use('/api/servicos', servicosRouter);
app.use('/api/agendamentos', agendamentosRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/establishments', estabelecimentosRoutes);
app.use('/api/estabelecimentos', estabelecimentosRoutes);
app.use('/api/notify', notifyRouter);
app.use('/api/public/otp', otpPublicRouter);
app.use('/api/public/agendamentos', publicAgendamentosRouter);
app.use('/api/admin', adminRouter);
app.use('/api/relatorios', relatoriosRouter);
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

// Tarefas de manutenção periódicas (limpeza de tokens expirados, etc.)
startMaintenance(pool);


