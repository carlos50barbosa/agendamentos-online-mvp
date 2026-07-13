// backend/src/config.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

function getAny(...names) {
  for (const n of names) {
    const value = process.env[n]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return undefined
}
function requireAny(...names) {
  const value = getAny(...names)
  if (!value) throw new Error('ENV ausente: ' + names.join(' | '))
  return value
}

function getAnyFromEnv(envObject, ...names) {
  for (const n of names) {
    const value = envObject?.[n]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return undefined
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function parseLowerString(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || fallback
}

function parseTrustProxy(value, fallback = 1) {
  if (value === undefined || value === null) return fallback
  const normalized = String(value).trim()
  if (!normalized) return fallback
  const lower = normalized.toLowerCase()
  if (['true', 'yes', 'on'].includes(lower)) return true
  if (['false', 'no', 'off'].includes(lower)) return false
  const numeric = Number(normalized)
  if (Number.isFinite(numeric) && numeric >= 0) return Math.round(numeric)
  return normalized
}

function parseNullableIsoDate(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export const config = {
  db: {
    host: requireAny('DB_HOST', 'MYSQL_HOST'),
    port: Number(getAny('DB_PORT', 'MYSQL_PORT') || 3306),
    user: requireAny('DB_USER', 'MYSQL_USER'),
    pass: requireAny('DB_PASS', 'MYSQL_PASSWORD'),
    name: requireAny('DB_NAME', 'MYSQL_DATABASE'),
  },
  app: {
    port: Number(getAny('PORT') || 3002),
    jwtSecret: requireAny('JWT_SECRET'),
  },
  security: {
    trustProxy: parseTrustProxy(getAny('TRUST_PROXY'), 1),
    rateLimit: {
      store: {
        driver: parseLowerString(getAny('RATE_LIMIT_STORE', 'RATE_LIMIT_DRIVER'), 'memory'),
        fallbackDriver: parseLowerString(getAny('RATE_LIMIT_FALLBACK_STORE'), 'memory'),
        mysqlTable: getAny('RATE_LIMIT_MYSQL_TABLE') || 'rate_limit_counters',
        mysqlPruneStrategy: parseLowerString(getAny('RATE_LIMIT_MYSQL_PRUNE_STRATEGY'), 'interval'),
        mysqlPruneIntervalMs: parsePositiveInt(getAny('RATE_LIMIT_MYSQL_PRUNE_INTERVAL_MS') || 300000, 300000),
        mysqlPruneBatchSize: parsePositiveInt(getAny('RATE_LIMIT_MYSQL_PRUNE_BATCH_SIZE') || 500, 500),
        mysqlPruneMaxBatchesPerRun: parsePositiveInt(getAny('RATE_LIMIT_MYSQL_PRUNE_MAX_BATCHES_PER_RUN') || 5, 5),
        redisUrl: getAny('RATE_LIMIT_REDIS_URL') || null,
        redisKeyPrefix: getAny('RATE_LIMIT_REDIS_KEY_PREFIX') || 'rate-limit:',
      },
      notify: {
        windowMs: parsePositiveInt(getAny('NOTIFY_RATE_LIMIT_WINDOW_MS') || 60000, 60000),
        max: parsePositiveInt(getAny('NOTIFY_RATE_LIMIT_MAX') || 20, 20),
      },
      paymentStatusPublic: {
        windowMs: parsePositiveInt(getAny('PAYMENT_STATUS_RATE_LIMIT_WINDOW_MS') || 60000, 60000),
        max: parsePositiveInt(getAny('PAYMENT_STATUS_RATE_LIMIT_MAX') || 60, 60),
      },
      auth: {
        login: {
          windowMs: parsePositiveInt(getAny('AUTH_LOGIN_RATE_LIMIT_WINDOW_MS') || 600000, 600000),
          max: parsePositiveInt(getAny('AUTH_LOGIN_RATE_LIMIT_MAX') || 10, 10),
          accountWindowMs: parsePositiveInt(getAny('AUTH_LOGIN_ACCOUNT_RATE_LIMIT_WINDOW_MS') || 600000, 600000),
          accountMax: parsePositiveInt(getAny('AUTH_LOGIN_ACCOUNT_RATE_LIMIT_MAX') || 5, 5),
        },
        forgot: {
          windowMs: parsePositiveInt(getAny('AUTH_FORGOT_RATE_LIMIT_WINDOW_MS') || 900000, 900000),
          max: parsePositiveInt(getAny('AUTH_FORGOT_RATE_LIMIT_MAX') || 5, 5),
          accountWindowMs: parsePositiveInt(getAny('AUTH_FORGOT_ACCOUNT_RATE_LIMIT_WINDOW_MS') || 3600000, 3600000),
          accountMax: parsePositiveInt(getAny('AUTH_FORGOT_ACCOUNT_RATE_LIMIT_MAX') || 3, 3),
        },
        reset: {
          windowMs: parsePositiveInt(getAny('AUTH_RESET_RATE_LIMIT_WINDOW_MS') || 900000, 900000),
          max: parsePositiveInt(getAny('AUTH_RESET_RATE_LIMIT_MAX') || 10, 10),
        },
      },
      publicApi: {
        windowMs: parsePositiveInt(getAny('PUBLIC_API_RATE_LIMIT_WINDOW_MS') || 60000, 60000),
        max: parsePositiveInt(getAny('PUBLIC_API_RATE_LIMIT_MAX') || 240, 240),
      },
    },
    telemetry: {
      webhookInvalidSignature: {
        windowMs: parsePositiveInt(getAny('WEBHOOK_INVALID_SIGNATURE_ALERT_WINDOW_MS') || 60000, 60000),
        threshold: parsePositiveInt(getAny('WEBHOOK_INVALID_SIGNATURE_ALERT_THRESHOLD') || 20, 20),
      },
      legacyWebhookHits: {
        windowMs: parsePositiveInt(getAny('LEGACY_WEBHOOK_HIT_ALERT_WINDOW_MS') || 60000, 60000),
        threshold: parsePositiveInt(getAny('LEGACY_WEBHOOK_HIT_ALERT_THRESHOLD') || 120, 120),
      },
    },
    payments: {
      legacyQueryToken: {
        enabled: parseBool(getAny('PAYMENTS_LEGACY_QUERY_TOKEN_ENABLED'), true),
        sunsetAt: parseNullableIsoDate(getAny('PAYMENTS_LEGACY_QUERY_TOKEN_SUNSET_AT')),
        deprecationUrl: getAny('PAYMENTS_LEGACY_QUERY_TOKEN_DEPRECATION_URL') || null,
      },
    },
    logging: {
      fullIp: parseBool(getAny('LOG_FULL_IP'), false),
    },
  },
  billing: {
    provider: getAny('BILLING_PROVIDER', 'PAYMENT_PROVIDER') || 'mercadopago',
    currency: getAny('BILLING_CURRENCY') || 'BRL',
    // Controla se devemos reutilizar um checkout/Plano pendente existente
    // BILLING_REUSE_PENDING=false para sempre gerar um novo link
    reusePending: (() => {
      const v = String(getAny('BILLING_REUSE_PENDING') ?? 'true').toLowerCase()
      return !(v === '0' || v === 'false' || v === 'no')
    })(),
    mercadopago: {
      accessToken: getAny('MERCADOPAGO_ACCESS_TOKEN', 'MP_ACCESS_TOKEN'),
      publicKey: getAny('MERCADOPAGO_PUBLIC_KEY', 'MP_PUBLIC_KEY'),
      webhookSecret: getAny('MERCADOPAGO_WEBHOOK_SECRET', 'MP_WEBHOOK_SECRET'),
      webhookSecret2: getAny('MERCADOPAGO_WEBHOOK_SECRET_2', 'MP_WEBHOOK_SECRET_2'),
      allowUnsigned: (() => {
        const v = String(getAny('MERCADOPAGO_ALLOW_UNSIGNED', 'BILLING_ALLOW_UNSIGNED') || '0').toLowerCase()
        return v === '1' || v === 'true' || v === 'yes'
      })(),
      successUrl: getAny('MERCADOPAGO_SUCCESS_URL') || null,
      failureUrl: getAny('MERCADOPAGO_FAILURE_URL') || null,
      pendingUrl: getAny('MERCADOPAGO_PENDING_URL') || null,
      testPayerEmail: getAny('MERCADOPAGO_TEST_PAYER_EMAIL'),
    },
    reminders: {
      warnDays: Number(getAny('BILLING_WARN_DAYS', 'BILLING_REMINDER_WARN_DAYS') || 3) || 3,
      graceDays: Number(getAny('SUBSCRIPTION_GRACE_DAYS', 'BILLING_GRACE_DAYS', 'BILLING_REMINDER_GRACE_DAYS') || 3) || 3,
      intervalMs: Number(getAny('BILLING_MONITOR_INTERVAL_MS', 'BILLING_REMINDER_INTERVAL_MS') || 30 * 60 * 1000) || 30 * 60 * 1000,
      disabled: parseBool(getAny('BILLING_REMINDERS_DISABLED', 'BILLING_MONITOR_DISABLED'), false),
      paymentUrl: getAny('BILLING_PAYMENT_URL', 'BILLING_REMINDER_PAYMENT_URL') || null,
    },
  },
  // Asaas (migração gradual do Mercado Pago). env define a base URL:
  //   sandbox -> https://api-sandbox.asaas.com | production -> https://api.asaas.com
  asaas: {
    apiKey: getAny('ASAAS_API_KEY'),
    env: parseLowerString(getAny('ASAAS_ENV'), 'sandbox'),
    webhookToken: getAny('ASAAS_WEBHOOK_TOKEN'),
  },
  // Sinal (depósito) via Asaas com split para o estabelecimento.
  // splitCents = totalCents - platformFeeCents - asaasPixFeeCents. O fee da plataforma
  // (>0) é o próprio buffer: se a taxa real do Asaas vier maior que a estimada, ela
  // reduz o resíduo da plataforma antes de estourar o líquido da cobrança.
  signal: {
    ttlMinutes: Number(getAny('SIGNAL_PAYMENT_TTL_MINUTES') || 0) || null,
    platformFeeCents: Number(getAny('PLATFORM_FEE_CENTS') || 0) || 0,
    asaasPixFeeCents: Number(getAny('ASAAS_PIX_FEE_CENTS') || 0) || 0,
    // Piso mínimo do sinal Asaas (centavos). Garante split viável e evita cobranças
    // irrisórias; só se aplica ao provider asaas e nunca excede o preço do serviço.
    minCents: Number(getAny('SIGNAL_MIN_CENTS') || 500) || 500,
    // Fallback de conta única: cobra o sinal na conta da plataforma SEM split (sem
    // exigir walletId). Útil quando o estabelecimento ainda não configurou a wallet.
    splitDisabled: parseBool(getAny('ASAAS_SPLIT_DISABLED'), false),
  },
  // Plano recorrente que o ESTABELECIMENTO vende ao SEU cliente (fidelidade), cobrado no
  // cartão e repassado por split. Diferente do `signal` (avulso, fixedValue): aqui o split
  // é PERCENTUAL, porque a taxa do Asaas varia com o meio de pagamento e uma estimativa
  // fixa erraria a cada troca de cartão para PIX. Ver docs/PLANO-FIDELIDADE-ASAAS.md.
  loyalty: {
    // Comissão da plataforma sobre o valor do plano (%). O restante vai ao estabelecimento.
    platformPercent: Number(getAny('LOYALTY_PLATFORM_PERCENT') || 5) || 5,
    // Taxas do cartão no Asaas — SÓ para estimar o líquido exibido ao dono no painel.
    // Não entram no split (o Asaas desconta a taxa real por conta dele). Confirmar os
    // valores no painel da conta antes de exibir número para o usuário.
    cardFeePercent: Number(getAny('ASAAS_CARD_FEE_PERCENT') || 0) || 0,
    cardFeeFixedCents: Number(getAny('ASAAS_CARD_FEE_FIXED_CENTS') || 0) || 0,
  },
}

export function getOperationalHardeningWarnings(env = process.env, cfg = config) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase()
  const severity = nodeEnv === 'production' ? 'error' : 'warn'
  const warnings = []
  const waAppSecret = getAnyFromEnv(env, 'WA_APP_SECRET', 'WHATSAPP_APP_SECRET', 'META_APP_SECRET') || ''
  const waAllowUnsigned = parseBool(getAnyFromEnv(env, 'WA_WEBHOOK_ALLOW_UNSIGNED', 'WHATSAPP_WEBHOOK_ALLOW_UNSIGNED'), false)

  if (!waAppSecret) {
    warnings.push({
      code: 'wa_app_secret_missing',
      severity,
      message: '[security][wa/webhook] WA_APP_SECRET ausente; POSTs do webhook oficial aceitam payloads sem assinatura válida.',
    })
  }
  if (waAllowUnsigned) {
    warnings.push({
      code: 'wa_allow_unsigned_enabled',
      severity,
      message: '[security][wa/webhook] WA_WEBHOOK_ALLOW_UNSIGNED=true; assinatura do webhook oficial está em modo permissivo.',
    })
  }
  if (cfg.billing?.mercadopago?.allowUnsigned) {
    warnings.push({
      code: 'mercadopago_allow_unsigned_enabled',
      severity,
      message: '[security][mercadopago] MERCADOPAGO_ALLOW_UNSIGNED/BILLING_ALLOW_UNSIGNED habilitado; webhooks sem assinatura serão aceitos.',
    })
  }
  if (
    cfg.security?.rateLimit?.store?.driver === 'memory' &&
    nodeEnv === 'production'
  ) {
    warnings.push({
      code: 'rate_limit_memory_store',
      severity: 'warn',
      message: '[security][rate-limit] RATE_LIMIT_STORE=memory; múltiplas instâncias não compartilharão contadores de abuso.',
    })
  }
  if (nodeEnv === 'production' && cfg.security?.trustProxy === false) {
    warnings.push({
      code: 'trust_proxy_disabled',
      severity: 'warn',
      message: '[security][http] TRUST_PROXY=false em produção; IP real e limites por cliente podem ficar incorretos atrás de proxy reverso.',
    })
  }
  if (
    cfg.security?.rateLimit?.store?.driver === 'mysql' &&
    String(cfg.security?.rateLimit?.store?.mysqlPruneStrategy || '').toLowerCase() === 'write_fallback'
  ) {
    warnings.push({
      code: 'rate_limit_mysql_write_prune_enabled',
      severity: 'warn',
      message: '[security][rate-limit] RATE_LIMIT_MYSQL_PRUNE_STRATEGY=write_fallback adiciona deletes no write path; prefira prune em intervalo para reduzir custo operacional.',
    })
  }
  if (
    cfg.security?.rateLimit?.store?.driver === 'mysql' &&
    String(cfg.security?.rateLimit?.store?.mysqlPruneStrategy || '').toLowerCase() === 'off'
  ) {
    warnings.push({
      code: 'rate_limit_mysql_prune_disabled',
      severity: 'warn',
      message: '[security][rate-limit] RATE_LIMIT_MYSQL_PRUNE_STRATEGY=off desliga a limpeza da store MySQL; contadores expirados vao se acumular.',
    })
  }
  if (cfg.security?.rateLimit?.store?.driver === 'redis' && !cfg.security?.rateLimit?.store?.redisUrl) {
    warnings.push({
      code: 'rate_limit_redis_url_missing',
      severity: 'warn',
      message: '[security][rate-limit] RATE_LIMIT_STORE=redis sem RATE_LIMIT_REDIS_URL; o bootstrap precisa injetar um client Redis compatível ou o store fará fallback.',
    })
  }
  if (nodeEnv === 'production' && parseBool(getAnyFromEnv(env, 'LOG_FULL_IP'), cfg.security?.logging?.fullIp === true)) {
    warnings.push({
      code: 'log_full_ip_enabled',
      severity: 'warn',
      message: '[security][http] LOG_FULL_IP=true em produção; use apenas temporariamente para diagnóstico e proteja o destino dos logs.',
    })
  }
  const legacyQueryTokenSunsetAt = cfg.security?.payments?.legacyQueryToken?.sunsetAt
  if (cfg.security?.payments?.legacyQueryToken?.enabled === false) {
    warnings.push({
      code: 'payments_legacy_query_token_disabled',
      severity: 'warn',
      message: '[security][payments] PAYMENTS_LEGACY_QUERY_TOKEN_ENABLED=false; chamadas públicas com ?token= vão ser negadas e devem migrar para X-Deposit-Token.',
    })
  }
  if (legacyQueryTokenSunsetAt) {
    const sunsetAtMs = new Date(legacyQueryTokenSunsetAt).getTime()
    if (Number.isFinite(sunsetAtMs) && sunsetAtMs <= Date.now()) {
      warnings.push({
        code: 'payments_legacy_query_token_sunset_elapsed',
        severity: 'warn',
        message: '[security][payments] PAYMENTS_LEGACY_QUERY_TOKEN_SUNSET_AT já passou; monitore o uso legado antes de remover o fallback ?token=.',
      })
    }
  }
  return warnings
}

export const env = { getAny, requireAny }
