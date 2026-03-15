import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWabaAssets } from '../src/services/waGraph.js';

test('fetchWabaAssets resolves phone via me/whatsapp_business_accounts when me/businesses is empty', async () => {
  const calls = [];
  const graphGet = async (path) => {
    calls.push(path);
    if (path === 'me/businesses') return { data: [] };
    if (path === 'me') return { id: 'user-123', whatsapp_business_accounts: { data: [] } };
    if (path === 'me/whatsapp_business_accounts') {
      return {
        data: [
          {
            id: 'waba-1',
            phone_numbers: {
              data: [
                {
                  id: 'phone-1',
                  display_phone_number: '+55 11 99999-0000',
                },
              ],
            },
          },
        ],
      };
    }
    throw new Error(`unexpected path ${path}`);
  };

  const result = await fetchWabaAssets('token', { graphGet });

  assert.equal(result.businessId, null);
  assert.equal(result.wabaId, 'waba-1');
  assert.equal(result.phoneNumberId, 'phone-1');
  assert.equal(result.displayPhoneNumber, '+55 11 99999-0000');
  assert.equal(result.trace.meId, 'user-123');
  assert.deepEqual(calls, ['me/businesses', 'me', 'me/whatsapp_business_accounts']);
});

test('fetchWabaAssets keeps scanning WABAs until it finds a phone number', async () => {
  const calls = [];
  const graphGet = async (path) => {
    calls.push(path);
    if (path === 'me/businesses') return { data: [{ id: 'biz-1' }] };
    if (path === 'me') return { id: 'user-123', whatsapp_business_accounts: { data: [] } };
    if (path === 'me/whatsapp_business_accounts') return { data: [] };
    if (path === 'biz-1/owned_whatsapp_business_accounts') {
      return {
        data: [
          { id: 'waba-empty' },
          { id: 'waba-ok' },
        ],
      };
    }
    if (path === 'waba-empty/phone_numbers') return { data: [] };
    if (path === 'waba-ok/phone_numbers') {
      return {
        data: [
          {
            id: 'phone-77',
            display_phone_number: '+55 21 98888-7777',
          },
        ],
      };
    }
    throw new Error(`unexpected path ${path}`);
  };

  const result = await fetchWabaAssets('token', { graphGet });

  assert.equal(result.businessId, 'biz-1');
  assert.equal(result.wabaId, 'waba-ok');
  assert.equal(result.phoneNumberId, 'phone-77');
  assert.equal(result.displayPhoneNumber, '+55 21 98888-7777');
  assert.equal(result.trace.wabaCount, 2);
  assert.equal(result.trace.phoneNumbersCount, 1);
  assert.deepEqual(calls, [
    'me/businesses',
    'me',
    'me/whatsapp_business_accounts',
    'biz-1/owned_whatsapp_business_accounts',
    'waba-empty/phone_numbers',
    'waba-ok/phone_numbers',
  ]);
});
