import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeResolvedAssets,
  normalizeEmbeddedSignupSessionInfo,
} from '../src/services/whatsappEmbeddedSignupService.js';

test('normalizeEmbeddedSignupSessionInfo parses Meta postMessage payload', () => {
  const info = normalizeEmbeddedSignupSessionInfo({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'finish',
    version: 3,
    origin: 'https://www.facebook.com',
    data: {
      waba_id: 'waba-123',
      phone_number_id: 'phone-456',
      business_id: 'biz-789',
      display_phone_number: '+55 11 99999-0000',
    },
  });

  assert.equal(info.type, 'WA_EMBEDDED_SIGNUP');
  assert.equal(info.event, 'FINISH');
  assert.equal(info.version, '3');
  assert.equal(info.waba_id, 'waba-123');
  assert.equal(info.phone_number_id, 'phone-456');
  assert.equal(info.business_account_id, 'biz-789');
  assert.equal(info.display_phone_number, '+55 11 99999-0000');
});

test('mergeResolvedAssets prefers Graph details and falls back to session info', () => {
  const merged = mergeResolvedAssets({
    graphAssets: {
      wabaId: 'waba-graph',
      phoneNumberId: 'phone-graph',
      businessId: 'biz-graph',
      displayPhoneNumber: '+55 11 90000-1000',
      verifiedName: 'Studio AO',
      wabaName: 'Studio AO WABA',
      businessName: 'Studio AO LTDA',
    },
    sessionInfo: {
      waba_id: 'waba-session',
      phone_number_id: 'phone-session',
      business_account_id: 'biz-session',
      display_phone_number: '+55 11 98888-7777',
    },
    phoneDetails: {
      display_phone_number: '+55 11 95555-4444',
      verified_name: 'Studio AO Verificado',
    },
    wabaDetails: {
      name: 'Studio AO Nome Final',
    },
  });

  assert.deepEqual(merged, {
    wabaId: 'waba-graph',
    phoneNumberId: 'phone-graph',
    businessId: 'biz-graph',
    displayPhoneNumber: '+55 11 95555-4444',
    verifiedName: 'Studio AO Verificado',
    businessName: 'Studio AO Nome Final',
  });
});

test('mergeResolvedAssets falls back to session info when Graph has no ids', () => {
  const merged = mergeResolvedAssets({
    graphAssets: {},
    sessionInfo: {
      waba_id: 'waba-session',
      phone_number_id: 'phone-session',
      business_account_id: 'biz-session',
      display_phone_number: '+55 21 97777-6666',
    },
  });

  assert.equal(merged.wabaId, 'waba-session');
  assert.equal(merged.phoneNumberId, 'phone-session');
  assert.equal(merged.businessId, 'biz-session');
  assert.equal(merged.displayPhoneNumber, '+55 21 97777-6666');
  assert.equal(merged.verifiedName, null);
});
