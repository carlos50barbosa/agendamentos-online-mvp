// backend/src/index.js
import dotenv from 'dotenv';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';


import authRouter from './routes/auth.js';
import servicosRouter from './routes/servicos.js';
import agendamentosRouter from './routes/agendamentos.js';
import slotsRouter from './routes/slots.js';
import estabelecimentosRoutes from './routes/estabelecimentos.js';
import notificationsRouter from './routes/notifications.js'; // ✅ caminho correto
import { initNotifications } from './lib/notifications.js'; // ✅ inicia scheduler

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) =>
  res.json({ ok: true, msg: 'Backend rodando. Use as rotas da API.' })
);

// Rotas
app.use('/auth', authRouter);
app.use('/servicos', servicosRouter);
app.use('/agendamentos', agendamentosRouter);
app.use('/slots', slotsRouter);
app.use('/notifications', notificationsRouter); // ✅ app.use (não router.use)

// Estabelecimentos (público)
app.use('/establishments', estabelecimentosRoutes);
app.use('/estabelecimentos', estabelecimentosRoutes);

// Scheduler de notificações (in-memory para o MVP)
initNotifications();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend ouvindo na porta ${PORT}`);
});
