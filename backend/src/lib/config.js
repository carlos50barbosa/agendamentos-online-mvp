﻿// backend/src/config.js
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
      successUrl: getAny('MERCADOPAGO_SUCCESS_URL') || null,
      failureUrl: getAny('MERCADOPAGO_FAILURE_URL') || null,
      pendingUrl: getAny('MERCADOPAGO_PENDING_URL') || null,
      testPayerEmail: getAny('MERCADOPAGO_TEST_PAYER_EMAIL'),
    },
  },
}

export const env = { getAny, requireAny }
