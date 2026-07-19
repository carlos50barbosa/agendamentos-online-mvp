import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import { hashEndpoint, normalizeSubscription, pushEnabled, pushPublicKey } from '../src/lib/web_push.js';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

// Chaves com os tamanhos que um navegador real produz (RFC 8291): ponto EC
// P-256 nao comprimido de 65 bytes e segredo de 16 bytes.
const P256DH = crypto.randomBytes(65).toString('base64url');
const AUTH = crypto.randomBytes(16).toString('base64url');
const KEYS = { p256dh: P256DH, auth: AUTH };

test('normalizeSubscription aceita o formato cru do PushSubscription.toJSON()', () => {
  const sub = normalizeSubscription({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS });
  assert.deepEqual(sub, { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH });
});

test('normalizeSubscription aceita o formato ja achatado', () => {
  const sub = normalizeSubscription({ endpoint: ENDPOINT, ...KEYS });
  assert.equal(sub.endpoint, ENDPOINT);
});

test('normalizeSubscription rejeita assinatura sem as chaves', () => {
  assert.equal(normalizeSubscription({ endpoint: ENDPOINT }), null);
  assert.equal(normalizeSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH } }), null);
  assert.equal(normalizeSubscription({ keys: KEYS }), null);
  assert.equal(normalizeSubscription(null), null);
});

test('normalizeSubscription rejeita endpoint que nao e https', () => {
  assert.equal(normalizeSubscription({ endpoint: 'http://fcm.googleapis.com/fcm/send/abc', keys: KEYS }), null);
});

test('normalizeSubscription rejeita endpoint maior que a coluna VARCHAR(512)', () => {
  // Sem isto o INSERT estoura no banco em vez de devolver 400 na rota.
  assert.equal(normalizeSubscription({ endpoint: `https://ex.com/${'a'.repeat(600)}`, keys: KEYS }), null);
});

test('normalizeSubscription rejeita chave de tamanho errado', () => {
  // Descoberto ao dirigir o fluxo: a lib so valida o tamanho na hora de CIFRAR.
  // Sem esta checagem, uma chave torta entra no banco e falha em todo envio
  // futuro — e como o erro e local, nunca chega o 410 que limparia a linha.
  assert.equal(normalizeSubscription({ endpoint: ENDPOINT, p256dh: 'BKxQ', auth: AUTH }), null);
  assert.equal(normalizeSubscription({ endpoint: ENDPOINT, p256dh: P256DH, auth: 'aUtH' }), null);
  assert.equal(
    normalizeSubscription({ endpoint: ENDPOINT, p256dh: crypto.randomBytes(64).toString('base64url'), auth: AUTH }),
    null,
  );
});

test('hashEndpoint e estavel e bate com o SHA-256 do endpoint', () => {
  const esperado = crypto.createHash('sha256').update(ENDPOINT).digest('hex');
  assert.equal(hashEndpoint(ENDPOINT), esperado);
  assert.equal(hashEndpoint(ENDPOINT), hashEndpoint(ENDPOINT));
  assert.equal(hashEndpoint(ENDPOINT).length, 64);
  assert.notEqual(hashEndpoint(ENDPOINT), hashEndpoint(`${ENDPOINT}x`));
});

test('sem VAPID no ambiente, push fica desligado e nao expoe chave', () => {
  // O teste roda sem VAPID_* definido — o modulo tem de degradar para no-op em
  // vez de quebrar o boot. E o que permite a VPS subir sem as chaves.
  assert.equal(pushEnabled(), false);
  assert.equal(pushPublicKey(), null);
});
