// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import authRouter from './routes/auth.js';
import servicosRouter from './routes/servicos.js';
import agendamentosRouter from './routes/agendamentos.js';
import slotsRouter from './routes/slots.js';
import estabelecimentosRoutes from './routes/estabelecimentos.js';
import notificationsRouter from './routes/notifications.js'; // opcional
import pushRouter from './routes/push.js';
import notifyRouter from './routes/notify.js'; // rota de teste de notificações
import adminRouter from './routes/admin.js';
import relatoriosRouter from './routes/relatorios.js';
import clientLoyaltyRouter from './routes/client_loyalty.js';
import billingRouter from './routes/billing.js';
import paymentsRouter from './routes/payments.js';
import whatsappWebhookRouter from './routes/whatsapp_webhook.js';
import waConnectRouter from './routes/waConnect.js';
import waTenantWebhookRouter from './routes/waWebhook.js';
import mercadoPagoRouter from './routes/mercadopago.js';
import asaasWebhookRouter from './routes/webhooks_asaas.js';
import billingAsaasRouter from './routes/billing_asaas.js';
import publicAgendamentosRouter from './routes/agendamentos_public.js';
import publicConfigRouter from './routes/public_config.js';
import otpPublicRouter from './routes/otp_public.js';
import profissionaisRouter from './routes/profissionais.js';
import estabelecimentoSettingsRouter from './routes/estabelecimento_settings.js';
import onboardingRouter from './routes/onboarding.js';
import { pool } from './lib/db.js';
import { config, getOperationalHardeningWarnings } from './lib/config.js';
import { buildRateLimitClientKey, consumeRateLimit, getRateLimitMaintenanceInfo, initializeRateLimitStore, setRateLimitHeaders, startRateLimitStoreMaintenance } from './lib/request_rate_limit.js';
import { startMaintenance, startPublicPendingCleanup, startAppointmentPaymentCleanup } from './lib/maintenance.js';
import { mountWebhooks } from './routes/webhooks.js';
import { startBillingMonitor } from './lib/billing_monitor.js';
import { startAppointmentReminders } from './lib/appointment_reminders.js';
import { startEstabReminders } from './lib/estab_reminders.js';
import { classifySuspiciousRequest, getRequestAccessLogContext, logSecurityEvent, normalizeRequestId } from './lib/route_access.js';
import { log } from './lib/logger.js';
import { auditRequest } from './lib/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

const app = express();
const whatsappWebhookPaths = [
  '/wa/webhook',
  '/api/wa/webhook',
  '/webhooks/whatsapp',
  '/api/webhooks/whatsapp',
];
const MP_NOTIFICATION_URL = String(process.env.MP_NOTIFICATION_URL || '').trim();
const BILLING_ROUTES_ENABLED = (() => {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  if (env === 'production' && MP_NOTIFICATION_URL.toLowerCase().includes('ngrok')) {
    console.error('[billing] FATAL: MP_NOTIFICATION_URL aponta para ngrok em produção. Rotas de billing desativadas.');
    return false;
  }
  return true;
})();

function parseBooleanEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

// O IP completo é dado pessoal: só sai por escolha explícita (LOG_FULL_IP=true) ou em ambiente
// declaradamente não-produtivo. NODE_ENV ausente NÃO é motivo para vazar IP — antes, um servidor
// que esquecesse de setar NODE_ENV escrevia o IP inteiro de cada visitante no disco.
function shouldLogFullIpDiagnostics() {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (parseBooleanEnv(process.env.LOG_FULL_IP, false)) return true;
  return ['development', 'dev', 'test'].includes(nodeEnv);
}

// Health-checks de monitor (UptimeRobot e afins) batem de minuto em minuto e afogam o log. Só
// aparecem quando falham — ou com LOG_HEALTH=true.
const HEALTH_PATHS = new Set(['/health', '/api/health', '/billing/status', '/api/billing/status']);
const LOG_HEALTH = parseBooleanEnv(process.env.LOG_HEALTH, false);

function isHealthNoise(req, statusCode) {
  if (LOG_HEALTH) return false;
  if (statusCode >= 400) return false;
  const path = String(req?.originalUrl || req?.path || '').split('?')[0];
  return HEALTH_PATHS.has(path);
}

// Se hoje o Nginx mantém /api até o Node, passe withApiPrefix=true (mas aceitamos ambos):
mountWebhooks(app, true);

app.disable('x-powered-by');
app.set('trust proxy', config.security?.trustProxy ?? 1);
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    // Vite dev server
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Admin-Token', 'X-Admin-Allow-Write', 'X-OTP-Token', 'X-Deposit-Token', 'X-Notify-Token', 'X-Billing-Health-Token'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After', 'Deprecation', 'Warning', 'Sunset', 'X-Legacy-Token-Fallback', 'X-Deprecated-Replacement', 'X-Legacy-Token-Phase'],
}));
app.options('*', cors());
app.use((req, res, next) => {
  const requestId = normalizeRequestId(req.headers['x-request-id']) || randomUUID();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
});
app.use((req, res, next) => {
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const context = getRequestAccessLogContext(req);
    const suspiciousSignals = res.statusCode === 404 ? classifySuspiciousRequest(req) : [];
    const logFullIp = shouldLogFullIpDiagnostics();
    const ip = logFullIp ? context.ip : (context.ip_masked || context.ip || null);

    // A trilha de auditoria persiste as mutações; roda mesmo quando o access log é silenciado.
    auditRequest(req, res, { ip, user_agent: context.user_agent });

    if (isHealthNoise(req, res.statusCode)) return;

    const payload = {
      request_id: req.requestId || context.request_id || null,
      method: context.method,
      path: context.path,
      // Rota-padrão do Express ('/servicos/:id'), que agrupa o que a URL concreta separa.
      route: req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null,
      query: context.url && context.url.includes('?') ? context.url.split('?').slice(1).join('?') : null,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      bytes: Number(res.getHeader('content-length')) || 0,
      // Quem fez: o que faltava para o log responder "quem".
      user_id: req.user?.id || null,
      user_tipo: req.user?.tipo || null,
      ip,
      ip_source: context.ip_source || null,
      user_agent: context.user_agent,
      referer: context.referer || null,
      host: context.host || null,
    };
    if (logFullIp) {
      payload.ip_diagnostics = {
        req_ip: context.req_ip || null,
        x_forwarded_for: context.x_forwarded_for || null,
        x_real_ip: context.x_real_ip || null,
        cf_connecting_ip: context.cf_connecting_ip || null,
        socket_remote_address: context.socket_remote_address || null,
        trusted_proxy: context.ip_trusted_proxy,
      };
    }
    if (suspiciousSignals.length) {
      payload.scan_signals = suspiciousSignals;
    }

    if (res.statusCode >= 500) log.error('http_request', payload);
    else if (suspiciousSignals.length || res.statusCode >= 400) log.warn('http_request', payload);
    else log.info('http_request', payload);
  });
  next();
});
app.use(whatsappWebhookPaths, express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));
app.use(['/webhooks/mercadopago/sellers', '/api/webhooks/mercadopago/sellers'], express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (payload) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    return json(payload);
  };
  const send = res.send.bind(res);
  res.send = (body) => {
    const contentType = res.get('Content-Type') || '';
    if (!contentType && typeof body === 'string') {
      res.set('Content-Type', 'text/plain; charset=utf-8');
    } else if (contentType.startsWith('text/') && !contentType.includes('charset')) {
      res.set('Content-Type', `${contentType}; charset=utf-8`);
    }
    return send(body);
  };
  next();
});
app.use((req, res, next) => {
  const path = String(req.path || '').toLowerCase();
  const method = String(req.method || '').toUpperCase();
  const hasAuthHeader = Boolean(String(req.headers.authorization || '').trim());
  const isWebhookPath =
    path.startsWith('/wa/webhook') ||
    path.startsWith('/api/wa/webhook') ||
    path.startsWith('/webhooks/whatsapp') ||
    path.startsWith('/api/webhooks/whatsapp') ||
    path.startsWith('/billing/webhook') ||
    path.startsWith('/api/billing/webhook') ||
    path.startsWith('/webhooks/mercadopago/sellers') ||
    path.startsWith('/api/webhooks/mercadopago/sellers') ||
    path.startsWith('/webhook/mercadopago') ||
    path.startsWith('/api/webhook/mercadopago');
  const isExcluded =
    method === 'OPTIONS' ||
    path === '/health' ||
    path === '/api/health' ||
    path.startsWith('/uploads/') ||
    path.startsWith('/api/uploads/') ||
    path.startsWith('/payments/') ||
    path.startsWith('/api/payments/') ||
    path.startsWith('/notify/') ||
    path.startsWith('/api/notify/') ||
    isWebhookPath;
  const isPublicApiRoute =
    path.startsWith('/api/') ||
    path.startsWith('/auth/') ||
    path.startsWith('/public/') ||
    path.startsWith('/establishments/') ||
    path === '/auth' ||
    path === '/public' ||
    path === '/establishments';

  if (isExcluded || hasAuthHeader || !isPublicApiRoute) {
    return next();
  }

  Promise.resolve().then(async () => {
    const result = await consumeRateLimit({
      bucketKey: `public-api:${buildRateLimitClientKey(req)}`,
      windowMs: config.security?.rateLimit?.publicApi?.windowMs,
      max: config.security?.rateLimit?.publicApi?.max,
    });
    setRateLimitHeaders(res, result);
    if (!result.limited) return next();

    logSecurityEvent('public-api:rate-limit', req, {
      limit: result.limit,
      retry_after_sec: result.retryAfterSec,
      store_driver: result.storeDriver || null,
    }, { level: 'warn' });
    return res.status(429).json({ error: 'rate_limited', request_id: req.requestId || null });
  }).catch(next);
});

// Em producao o nginx serve os dois prefixos direto do disco e estas rotas nunca sao
// alcancadas (o proxy so' encaminha /api, e /api/uploads e' interceptado antes).
// Ficam como fallback para dev/local e para o caso de o bloco do nginx sair do ar.
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
app.use('/push', pushRouter);
app.use('/establishments', estabelecimentosRoutes);
app.use('/estabelecimentos', estabelecimentosRoutes);
app.use('/estabelecimento/onboarding', onboardingRouter);
app.use('/estabelecimento', estabelecimentoSettingsRouter);
app.use('/profissionais', profissionaisRouter);
app.use('/notify', notifyRouter);
app.use('/public/otp', otpPublicRouter);
app.use('/public/agendamentos', publicAgendamentosRouter);
app.use('/public', publicConfigRouter);
app.use('/admin', adminRouter);
app.use('/relatorios', relatoriosRouter);
// Planos de fidelidade (cliente -> estabelecimento). O router ja traz os prefixos completos
// (/loyalty, /cliente/loyalty, /public/estabelecimentos/:id/loyalty-plans) e vive atras da
// flag LOYALTY_ENABLED. Ver docs/PLANO-FIDELIDADE-ASAAS.md.
app.use(clientLoyaltyRouter);
if (BILLING_ROUTES_ENABLED) {
  app.use('/billing', billingRouter);
}
app.use('/payments', paymentsRouter);
app.use('/wa', waConnectRouter);
app.use('/whatsapp', waConnectRouter);
app.use('/marketplace/mp', mercadoPagoRouter);
app.use('/mercadopago', mercadoPagoRouter);
app.use('/webhooks/asaas', asaasWebhookRouter);
app.use('/billing/asaas', billingAsaasRouter);
app.use('/wa/webhook', waTenantWebhookRouter);
app.use('/webhooks/whatsapp', whatsappWebhookRouter);

// Aliases “/api/*” (seu Nginx usa /api)
app.use('/api/auth', authRouter);
app.use('/api/servicos', servicosRouter);
app.use('/api/agendamentos', agendamentosRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/push', pushRouter);
app.use('/api/establishments', estabelecimentosRoutes);
app.use('/api/estabelecimentos', estabelecimentosRoutes);
app.use('/api/estabelecimento/onboarding', onboardingRouter);
app.use('/api/estabelecimento', estabelecimentoSettingsRouter);
app.use('/api/profissionais', profissionaisRouter);
app.use('/api/notify', notifyRouter);
app.use('/api/public/otp', otpPublicRouter);
app.use('/api/public/agendamentos', publicAgendamentosRouter);
app.use('/api/public', publicConfigRouter);
app.use('/api/admin', adminRouter);
app.use('/api/relatorios', relatoriosRouter);
app.use('/api', clientLoyaltyRouter);
if (BILLING_ROUTES_ENABLED) {
  app.use('/api/billing', billingRouter);
}
app.use('/api/payments', paymentsRouter);
app.use('/api/wa', waConnectRouter);
app.use('/api/whatsapp', waConnectRouter);
app.use('/api/marketplace/mp', mercadoPagoRouter);
app.use('/api/mercadopago', mercadoPagoRouter);
app.use('/api/webhooks/asaas', asaasWebhookRouter);
app.use('/api/billing/asaas', billingAsaasRouter);
app.use('/api/wa/webhook', waTenantWebhookRouter);
app.use('/api/webhooks/whatsapp', whatsappWebhookRouter);

app.use((req, res) => {
  const suspiciousSignals = classifySuspiciousRequest(req);
  if (suspiciousSignals.length) {
    logSecurityEvent('http:suspicious-not-found', req, {
      request_id: req.requestId || null,
      status: 404,
      scan_signals: suspiciousSignals,
    }, { level: 'warn' });
  }
  return res.status(404).json({ error: 'not_found', request_id: req.requestId || null });
});

// Middleware final de erro
app.use((err, req, res, _next) => {
  const requestId = req?.requestId || null;
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    const path = req?.path || '';
    const isServiceRoute = path.startsWith('/servicos') || path.startsWith('/api/servicos');
    if (isServiceRoute) {
      return res.status(413).json({ error: 'imagem_grande', message: 'Imagem maior que 2MB.', request_id: requestId });
    }
    return res.status(413).json({ error: 'payload_too_large', message: 'Payload muito grande.', request_id: requestId });
  }
  const isInvalidJson =
    err?.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && err?.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body'));
  if (isInvalidJson) {
    console.warn('[http][invalid-json]', {
      request_id: requestId,
      path: req?.originalUrl || req?.url || null,
      message: err?.message || null,
    });
    return res.status(400).json({ error: 'invalid_json', request_id: requestId });
  }

  const context = getRequestAccessLogContext(req);
  console.error('[UNHANDLED]', {
    request_id: requestId,
    method: context.method,
    path: context.path,
    ip: context.ip_masked || context.ip || null,
    error: err?.message || String(err),
  });

  const status = Number(err?.status || 500);
  if (status >= 400 && status < 500 && err?.expose === true) {
    return res.status(status).json({
      error: err?.code || 'request_error',
      message: err?.message || 'Requisição inválida.',
      request_id: requestId,
    });
  }

  return res.status(status).json({ error: 'internal_error', request_id: requestId });
});

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3002);

for (const warning of getOperationalHardeningWarnings(process.env, config)) {
  const logger = warning.severity === 'error' ? console.error : console.warn;
  logger(warning.message, { code: warning.code, severity: warning.severity });
}

const rateLimitStoreInfo = await initializeRateLimitStore({ cfg: config, dbPool: pool, logger: console });
console.log('[security][rate-limit] store_ready', rateLimitStoreInfo);
const rateLimitMaintenanceInfo = startRateLimitStoreMaintenance({ cfg: config, dbPool: pool, logger: console });
console.log('[security][rate-limit] maintenance_ready', rateLimitMaintenanceInfo);
if (rateLimitStoreInfo.fallbackReason === 'rate_limit_mysql_table_missing') {
  console.warn(
    '[security][rate-limit] mysql store fallback ativo; aplique a migracao backend/sql/2026-03-26-add-rate-limit-counters.sql para habilitar contadores compartilhados.'
  );
}
if (rateLimitStoreInfo.fallbackReason === 'rate_limit_redis_client_missing') {
  console.warn(
    '[security][rate-limit] redis configurado sem client compatível no bootstrap; mantendo fallback seguro no store configurado.'
  );
}
if (
  rateLimitStoreInfo.driver === 'mysql' &&
  !getRateLimitMaintenanceInfo().enabled &&
  String(rateLimitStoreInfo.pruneStrategy || '') !== 'write_fallback'
) {
  console.warn(
    '[security][rate-limit] store mysql ativo sem prune agendado; revise RATE_LIMIT_MYSQL_PRUNE_STRATEGY para evitar acumulacao de contadores expirados.'
  );
}

app.listen(PORT, HOST, () => {
  console.log(`✅ Backend ouvindo em http://${HOST}:${PORT}`);
  console.log('[routes] whatsapp oficial: /api/webhooks/whatsapp (aliases: /webhooks/whatsapp, /wa/webhook, /api/wa/webhook)');
});

// Tarefas de manutencao: limpeza de tokens expirados e lembretes de cobrança
startMaintenance(pool);
startPublicPendingCleanup(pool);
startAppointmentPaymentCleanup(pool);
if (BILLING_ROUTES_ENABLED) {
  startBillingMonitor();
}
startAppointmentReminders(pool);
startEstabReminders(pool);
