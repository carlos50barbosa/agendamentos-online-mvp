import { createHmac, timingSafeEqual } from 'node:crypto';

function normalizeSecret(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeHeaderValue(value) {
  if (!value) return '';
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value).trim();
}

function safeTimingCompareHex(expectedHex, receivedHex) {
  const expectedBuffer = Buffer.from(String(expectedHex || ''), 'hex');
  const receivedBuffer = Buffer.from(String(receivedHex || ''), 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) {
    const maxLength = Math.max(expectedBuffer.length, receivedBuffer.length);
    const paddedExpected = Buffer.alloc(maxLength);
    const paddedReceived = Buffer.alloc(maxLength);
    expectedBuffer.copy(paddedExpected);
    receivedBuffer.copy(paddedReceived);
    timingSafeEqual(paddedExpected, paddedReceived);
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function verifyWhatsAppWebhookSignature(req, env = process.env) {
  const allowUnsigned = parseBool(
    env.WA_WEBHOOK_ALLOW_UNSIGNED ?? env.WHATSAPP_WEBHOOK_ALLOW_UNSIGNED,
    false
  );
  const appSecret = normalizeSecret(env.WA_APP_SECRET || env.WHATSAPP_APP_SECRET || env.META_APP_SECRET);
  const signatureHeader = normalizeHeaderValue(req?.headers?.['x-hub-signature-256']);
  const rawBody = Buffer.isBuffer(req?.rawBody)
    ? req.rawBody
    : (typeof req?.rawBody === 'string' ? Buffer.from(req.rawBody) : null);

  if (allowUnsigned) {
    return { ok: true, skipped: 'allow_unsigned' };
  }
  if (!appSecret) {
    return { ok: true, skipped: 'missing_secret' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'missing_signature' };
  }
  if (!rawBody?.length) {
    return { ok: false, reason: 'missing_raw_body' };
  }

  const match = signatureHeader.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) {
    return { ok: false, reason: 'invalid_signature_header' };
  }

  const received = match[1].toLowerCase();
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  if (!safeTimingCompareHex(expected, received)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, reason: 'ok' };
}
