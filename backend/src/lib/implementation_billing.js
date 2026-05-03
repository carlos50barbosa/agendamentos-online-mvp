import { randomUUID } from 'node:crypto'
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago'
import { config } from './config.js'
import { pool } from './db.js'

export const IMPLEMENTATION_PRODUCT = 'implantacao_agenda_online'
export const IMPLEMENTATION_AMOUNT_CENTS = 19700
export const IMPLEMENTATION_KIND = 'implementation_setup'

const BILLING_CURRENCY = (config.billing?.currency || 'BRL').toUpperCase()
const MOCK_MP = (() => {
  const raw = String(process.env.MERCADOPAGO_MOCK || process.env.BILLING_MOCK_MERCADOPAGO || '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
})()

let mpClient = null
let mpPreference = null
let mpPayment = null
let tableReadyPromise = null
const mockPreferences = new Map()
const mockPayments = new Map()

function ensureMercadoPagoClient() {
  if (mpClient) return mpClient
  const accessToken = config.billing?.mercadopago?.accessToken
  if (!accessToken) throw new Error('Mercado Pago access token is not configured')
  mpClient = new MercadoPagoConfig({ accessToken })
  return mpClient
}

function ensureMercadoPagoPreference() {
  if (MOCK_MP) {
    return {
      async create({ body }) {
        const id = `mock-pref-implementation-${mockPreferences.size + 1}`
        const paymentId = `mock-pay-implementation-${mockPayments.size + 1}`
        const initPoint = `https://example.test/checkout/${id}`
        const preference = {
          id,
          init_point: initPoint,
          sandbox_init_point: initPoint,
          external_reference: body?.external_reference || null,
          metadata: body?.metadata || null,
        }
        const payment = {
          id: paymentId,
          status: 'pending',
          transaction_amount: Number(body?.items?.[0]?.unit_price || 0),
          payment_method_id: 'pix',
          payment_type_id: 'bank_transfer',
          external_reference: body?.external_reference || null,
          metadata: body?.metadata || null,
        }
        mockPreferences.set(id, preference)
        mockPayments.set(paymentId, payment)
        return preference
      },
    }
  }

  if (mpPreference) return mpPreference
  mpPreference = new Preference(ensureMercadoPagoClient())
  return mpPreference
}

function ensureMercadoPagoPayment() {
  if (MOCK_MP) {
    return {
      async get({ id }) {
        return mockPayments.get(String(id)) || null
      },
    }
  }

  if (mpPayment) return mpPayment
  mpPayment = new Payment(ensureMercadoPagoClient())
  return mpPayment
}

function getFrontendBase() {
  return String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
}

function getApiBase(frontendBase = getFrontendBase()) {
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(frontendBase)
  const defaultApiBase = isDevFront ? 'http://localhost:3002' : `${frontendBase}/api`
  return String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || defaultApiBase).replace(/\/$/, '')
}

function safeJson(value) {
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function mapPaymentStatus(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'approved') return 'approved'
  if (['pending', 'in_process', 'authorized'].includes(normalized)) return 'pending'
  if (['rejected', 'cancelled', 'canceled', 'refunded', 'charged_back'].includes(normalized)) return 'failed'
  return normalized ? 'failed' : 'pending'
}

function normalizeOptionalText(value, maxLength = 255) {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function normalizeEmail(value) {
  const email = normalizeOptionalText(value, 160)
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function normalizePublicId(value) {
  const text = String(value || '').trim()
  return /^[0-9a-f-]{20,80}$/i.test(text) ? text : null
}

function publicIdFromExternalReference(value) {
  const text = String(value || '').trim()
  const match = text.match(/^implementation:agenda_online:([0-9a-f-]{20,80})$/i)
  return normalizePublicId(match?.[1])
}

function isImplementationPayment(payment = {}) {
  const metadataKind = String(payment?.metadata?.kind || payment?.metadata?.type || '').toLowerCase()
  const product = String(payment?.metadata?.produto || payment?.metadata?.product || '').toLowerCase()
  const externalReference = String(payment?.external_reference || payment?.externalReference || '').toLowerCase()
  return (
    metadataKind === IMPLEMENTATION_KIND ||
    product === IMPLEMENTATION_PRODUCT ||
    externalReference.startsWith('implementation:agenda_online:')
  )
}

export async function ensureImplementationPaymentsTable({ db = pool } = {}) {
  if (!tableReadyPromise) {
    tableReadyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS implementation_payments (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        public_id VARCHAR(64) NOT NULL UNIQUE,
        user_id INT NULL,
        nome VARCHAR(160) NULL,
        email VARCHAR(160) NULL,
        telefone VARCHAR(32) NULL,
        produto VARCHAR(80) NOT NULL DEFAULT 'implantacao_agenda_online',
        tipo VARCHAR(40) NOT NULL DEFAULT 'one_time',
        valor_centavos INT NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'BRL',
        status ENUM('pending','approved','failed','canceled','refunded') NOT NULL DEFAULT 'pending',
        provider VARCHAR(32) NOT NULL DEFAULT 'mercadopago',
        provider_preference_id VARCHAR(120) NULL,
        provider_payment_id VARCHAR(120) NULL,
        external_reference VARCHAR(191) NOT NULL,
        checkout_url TEXT NULL,
        plan_hint ENUM('starter','pro','premium') NULL,
        paid_at DATETIME NULL,
        raw_payload LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_implementation_payments_external_reference (external_reference),
        INDEX idx_implementation_payments_user (user_id),
        INDEX idx_implementation_payments_provider_payment (provider, provider_payment_id),
        INDEX idx_implementation_payments_status (status, created_at),
        CONSTRAINT fk_implementation_payments_user FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `)
  }
  await tableReadyPromise
}

export async function createImplementationCheckout({
  user = null,
  payer = {},
  planHint = null,
} = {}) {
  await ensureImplementationPaymentsTable()

  const publicId = randomUUID()
  const externalReference = `implementation:agenda_online:${publicId}`
  const frontendBase = getFrontendBase()
  const apiBase = getApiBase(frontendBase)
  const normalizedPlanHint = ['starter', 'pro', 'premium'].includes(String(planHint || '').toLowerCase())
    ? String(planHint).toLowerCase()
    : null
  const payerName = normalizeOptionalText(payer?.nome || payer?.name || user?.nome, 160)
  const payerEmail = normalizeEmail(payer?.email || user?.email)
  const payerPhone = normalizeOptionalText(payer?.telefone || payer?.phone || user?.telefone, 32)

  const metadata = {
    kind: IMPLEMENTATION_KIND,
    produto: IMPLEMENTATION_PRODUCT,
    tipo: 'one_time',
    valor_centavos: IMPLEMENTATION_AMOUNT_CENTS,
    public_id: publicId,
    user_id: user?.id ? String(user.id) : undefined,
    plan_hint: normalizedPlanHint || undefined,
  }

  const preferenceBody = {
    items: [
      {
        id: IMPLEMENTATION_PRODUCT,
        title: 'Implantação completa da agenda online',
        description: 'Configuração assistida do Agendamentos Online',
        quantity: 1,
        unit_price: Number((IMPLEMENTATION_AMOUNT_CENTS / 100).toFixed(2)),
        currency_id: BILLING_CURRENCY,
      },
    ],
    external_reference: externalReference,
    metadata,
    notification_url: `${apiBase}/billing/webhook`,
    back_urls: {
      success: `${frontendBase}/cadastro?tipo=estabelecimento&implantacao=paid&implementation_order=${encodeURIComponent(publicId)}`,
      pending: `${frontendBase}/implantacao?checkout=pending&implementation_order=${encodeURIComponent(publicId)}`,
      failure: `${frontendBase}/implantacao?checkout=failure&implementation_order=${encodeURIComponent(publicId)}`,
    },
    auto_return: 'approved',
    statement_descriptor: 'AGEND ONLINE',
    payment_methods: {
      installments: 1,
      default_installments: 1,
    },
    payer: payerEmail
      ? {
          email: payerEmail,
          name: payerName || undefined,
          phone: payerPhone ? { number: payerPhone } : undefined,
        }
      : undefined,
  }

  const preference = await ensureMercadoPagoPreference().create({ body: preferenceBody })
  const checkoutUrl = preference?.init_point || preference?.sandbox_init_point || null
  if (!checkoutUrl) throw new Error('mercadopago_preference_without_checkout_url')

  await pool.query(
    `INSERT INTO implementation_payments
      (public_id, user_id, nome, email, telefone, produto, tipo, valor_centavos, currency,
       status, provider, provider_preference_id, external_reference, checkout_url, plan_hint, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, 'one_time', ?, ?, 'pending', 'mercadopago', ?, ?, ?, ?, ?)`,
    [
      publicId,
      user?.id || null,
      payerName,
      payerEmail,
      payerPhone,
      IMPLEMENTATION_PRODUCT,
      IMPLEMENTATION_AMOUNT_CENTS,
      BILLING_CURRENCY,
      preference?.id ? String(preference.id) : null,
      externalReference,
      checkoutUrl,
      normalizedPlanHint,
      safeJson({ preference }),
    ]
  )

  return {
    checkout_url: checkoutUrl,
    public_id: publicId,
    external_reference: externalReference,
    preference_id: preference?.id ? String(preference.id) : null,
    amount_cents: IMPLEMENTATION_AMOUNT_CENTS,
    produto: IMPLEMENTATION_PRODUCT,
    tipo: 'one_time',
  }
}

export async function getImplementationPaymentByPublicId(publicId, { db = pool } = {}) {
  const normalized = normalizePublicId(publicId)
  if (!normalized) return null
  await ensureImplementationPaymentsTable({ db })
  const [rows] = await db.query(
    `SELECT * FROM implementation_payments WHERE public_id=? LIMIT 1`,
    [normalized]
  )
  return rows?.[0] || null
}

export async function syncImplementationPaymentFromGateway(paymentId, {
  prefetchedPayment = null,
  event = null,
  db = pool,
} = {}) {
  if (!paymentId) return { ok: false, handled: false, reason: 'missing_payment_id' }
  await ensureImplementationPaymentsTable({ db })

  const payment = prefetchedPayment || await ensureMercadoPagoPayment().get({ id: String(paymentId) })
  if (!payment?.id) return { ok: false, handled: false, reason: 'payment_not_found' }
  if (!isImplementationPayment(payment)) {
    return { ok: false, handled: false, reason: 'not_implementation_payment', payment }
  }

  const externalReference = String(payment.external_reference || payment.externalReference || '').trim() || null
  const status = mapPaymentStatus(payment.status)
  const paidAt = status === 'approved'
    ? (payment.date_approved ? new Date(payment.date_approved) : new Date())
    : null
  const amountCents = Number.isFinite(Number(payment.transaction_amount))
    ? Math.round(Number(payment.transaction_amount || 0) * 100)
    : IMPLEMENTATION_AMOUNT_CENTS

  const [existingRows] = await db.query(
    `SELECT * FROM implementation_payments
      WHERE provider_payment_id=? OR external_reference=?
      ORDER BY id DESC
      LIMIT 1`,
    [String(payment.id), externalReference || '']
  )
  const existing = existingRows?.[0] || null

  if (existing?.id) {
    await db.query(
      `UPDATE implementation_payments
          SET status=?,
              provider_payment_id=?,
              valor_centavos=?,
              paid_at=CASE WHEN ? IS NOT NULL THEN ? ELSE paid_at END,
              raw_payload=?,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=?
        LIMIT 1`,
      [
        status,
        String(payment.id),
        amountCents,
        paidAt,
        paidAt,
        safeJson({ event, payment }),
        existing.id,
      ]
    )
    return {
      ok: true,
      handled: true,
      payment,
      status,
      paid: status === 'approved',
      implementation_payment_id: existing.id,
      public_id: existing.public_id,
    }
  }

  const publicId =
    normalizePublicId(payment?.metadata?.public_id) ||
    publicIdFromExternalReference(externalReference) ||
    randomUUID()
  await db.query(
    `INSERT INTO implementation_payments
      (public_id, produto, tipo, valor_centavos, currency, status, provider,
       provider_payment_id, external_reference, plan_hint, paid_at, raw_payload)
     VALUES (?, ?, 'one_time', ?, ?, ?, 'mercadopago', ?, ?, ?, ?, ?)`,
    [
      publicId,
      IMPLEMENTATION_PRODUCT,
      amountCents,
      String(payment.currency_id || BILLING_CURRENCY).toUpperCase().slice(0, 3),
      status,
      String(payment.id),
      externalReference || `implementation:agenda_online:${publicId}`,
      ['starter', 'pro', 'premium'].includes(String(payment?.metadata?.plan_hint || '').toLowerCase())
        ? String(payment.metadata.plan_hint).toLowerCase()
        : null,
      paidAt,
      safeJson({ event, payment, created_from_webhook: true }),
    ]
  )

  return {
    ok: true,
    handled: true,
    payment,
    status,
    paid: status === 'approved',
    public_id: publicId,
  }
}
