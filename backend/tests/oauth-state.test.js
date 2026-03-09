import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
  buildOAuthState,
  describeOAuthStateError,
  verifyOAuthState,
} from '../src/lib/oauth_state.js';

test('buildOAuthState and verifyOAuthState roundtrip payload', () => {
  const token = buildOAuthState(
    { estabelecimentoId: 26 },
    { secret: 'wa-test-secret', expiresIn: '1h' },
  );
  const payload = verifyOAuthState(token, { secret: 'wa-test-secret' });

  assert.equal(payload.estabelecimentoId, 26);
  assert.equal(typeof payload.nonce, 'string');
  assert.equal(payload.nonce.length, 16);
  assert.equal(typeof payload.ts, 'number');
});

test('describeOAuthStateError classifies expired token', async () => {
  const token = buildOAuthState(
    { estabelecimentoId: 26 },
    { secret: 'wa-test-secret', expiresIn: '1ms' },
  );

  await new Promise((resolve) => setTimeout(resolve, 15));

  let err = null;
  try {
    verifyOAuthState(token, { secret: 'wa-test-secret' });
  } catch (error) {
    err = error;
  }

  assert.ok(err);
  assert.equal(describeOAuthStateError(err).reason, 'state_expired');
});

test('describeOAuthStateError classifies invalid signature', () => {
  const token = jwt.sign({ estabelecimentoId: 26 }, 'secret-a', { expiresIn: '1h' });

  let err = null;
  try {
    verifyOAuthState(token, { secret: 'secret-b' });
  } catch (error) {
    err = error;
  }

  assert.ok(err);
  assert.equal(describeOAuthStateError(err).reason, 'state_invalid_signature');
});

test('describeOAuthStateError classifies missing secret', () => {
  const err = new Error('oauth_state_secret_missing');
  const info = describeOAuthStateError(err);

  assert.equal(info.reason, 'state_secret_missing');
  assert.equal(info.responseMessage, 'State secret missing');
});
