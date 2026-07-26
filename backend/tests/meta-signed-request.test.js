import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseMetaSignedRequest, getSignedRequestUserId } from '../src/lib/meta_signed_request.js';

const SECRET = 'app-secret-de-teste';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function assinar(payload, secret = SECRET) {
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${b64url(sig)}.${payloadB64}`;
}

test('aceita signed_request valido e devolve o payload', () => {
  const signed = assinar({ algorithm: 'HMAC-SHA256', issued_at: 1770000000, user_id: '12345' });
  const r = parseMetaSignedRequest(signed, SECRET);
  assert.equal(r.ok, true);
  assert.equal(r.data.user_id, '12345');
  assert.equal(getSignedRequestUserId(r.data), '12345');
});

test('rejeita assinatura feita com outro segredo', () => {
  const signed = assinar({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'segredo-do-atacante');
  const r = parseMetaSignedRequest(signed, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_signature');
});

test('rejeita payload adulterado com a assinatura original', () => {
  const original = assinar({ algorithm: 'HMAC-SHA256', user_id: '1' });
  const [sig] = original.split('.');
  const forjado = `${sig}.${b64url(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '999' }))}`;
  const r = parseMetaSignedRequest(forjado, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_signature');
});

test('rejeita "algorithm: none" mesmo com assinatura correta', () => {
  // O payload e' assinado de verdade, mas declara outro algoritmo. Confiar no campo `algorithm`
  // do proprio payload e' a falha classica de JWT/signed_request.
  const signed = assinar({ algorithm: 'none', user_id: '1' });
  const r = parseMetaSignedRequest(signed, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported_algorithm');
});

test('SEM app secret configurado, rejeita — falha fechada', () => {
  const signed = assinar({ algorithm: 'HMAC-SHA256', user_id: '1' });
  const r = parseMetaSignedRequest(signed, '');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'app_secret_not_configured');
});

test('rejeita formato malformado e entrada vazia', () => {
  assert.equal(parseMetaSignedRequest('', SECRET).error, 'missing_signed_request');
  assert.equal(parseMetaSignedRequest('semponto', SECRET).error, 'malformed_signed_request');
  assert.equal(parseMetaSignedRequest('a.b.c', SECRET).error, 'malformed_signed_request');
});

test('assinatura de tamanho errado nao explode no timingSafeEqual', () => {
  // timingSafeEqual LANCA se os buffers tiverem tamanhos diferentes — por isso o tamanho e'
  // conferido antes. Sem isso, um sig curto derrubaria o endpoint com 500 em vez de 401.
  const payloadB64 = b64url(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1' }));
  const r = parseMetaSignedRequest(`${b64url('curto')}.${payloadB64}`, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_signature');
});
