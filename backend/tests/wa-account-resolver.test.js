import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWhatsAppTenantConfig } from '../src/services/waAccountResolver.js';

test('resolveWhatsAppTenantConfig falls back to global credentials when tenant has no account', async () => {
  const result = await resolveWhatsAppTenantConfig({ estabelecimentoId: 15 }, {
    getWaAccountByEstabelecimentoId: async () => null,
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.deepEqual(result, {
    token: 'fallback-token',
    phoneId: 'fallback-phone',
    estabelecimentoId: 15,
    fallback: true,
  });
});

test('resolveWhatsAppTenantConfig prioritizes a connected tenant account', async () => {
  const result = await resolveWhatsAppTenantConfig({ estabelecimentoId: 42 }, {
    getWaAccountByEstabelecimentoId: async () => ({
      estabelecimento_id: 42,
      status: 'connected',
      phone_number_id: 'tenant-phone',
      access_token_enc: 'encrypted-token',
    }),
    decryptAccessToken: () => 'tenant-token',
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.deepEqual(result, {
    token: 'tenant-token',
    phoneId: 'tenant-phone',
    estabelecimentoId: 42,
    fallback: false,
  });
});
