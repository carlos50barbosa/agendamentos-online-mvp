import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectManualWhatsAppAccount,
  disconnectTenantWhatsAppAccount,
  validateManualWhatsAppAccount,
} from '../src/services/whatsappManualConnectService.js';

function graphError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.body = {
    error: {
      code,
      message,
    },
  };
  return err;
}

function createSuccessDeps() {
  return {
    fetchPhoneNumberDetails: async () => ({
      id: 'phone-1',
      display_phone_number: '+55 11 99999-0000',
      verified_name: 'Studio AO',
      name_status: 'APPROVED',
      quality_rating: 'GREEN',
    }),
    fetchWabaDetails: async () => ({
      id: 'waba-1',
      name: 'Studio AO WABA',
    }),
    getGraph: async (path) => {
      if (path === 'waba-1/phone_numbers') {
        return {
          data: [
            {
              id: 'phone-1',
              display_phone_number: '+55 11 99999-0000',
              verified_name: 'Studio AO',
            },
          ],
        };
      }
      if (path === 'biz-1') {
        return { id: 'biz-1', name: 'Studio AO LTDA' };
      }
      if (path === 'biz-1/owned_whatsapp_business_accounts') {
        return { data: [{ id: 'waba-1', name: 'Studio AO WABA' }] };
      }
      throw new Error(`unexpected path ${path}`);
    },
    fetchWabaAssets: async () => ({
      businessId: 'biz-1',
      businessName: 'Studio AO LTDA',
      wabaId: 'waba-1',
      trace: { sources: ['test'] },
    }),
  };
}

test('validateManualWhatsAppAccount rejects invalid token', async () => {
  await assert.rejects(
    () => validateManualWhatsAppAccount({
      estabelecimentoId: 10,
      payload: {
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        access_token: 'bad-token',
      },
    }, {
      fetchPhoneNumberDetails: async () => {
        throw graphError(401, 190, 'Invalid OAuth access token.');
      },
    }),
    (err) => err.code === 'wa_manual_token_invalid'
  );
});

test('validateManualWhatsAppAccount rejects invalid phone_number_id', async () => {
  await assert.rejects(
    () => validateManualWhatsAppAccount({
      estabelecimentoId: 10,
      payload: {
        waba_id: 'waba-1',
        phone_number_id: 'phone-missing',
        access_token: 'token-ok',
      },
    }, {
      fetchPhoneNumberDetails: async () => {
        throw graphError(404, 100, 'Unsupported get request.');
      },
    }),
    (err) => err.code === 'wa_manual_phone_not_found'
  );
});

test('validateManualWhatsAppAccount returns normalized preview on success', async () => {
  const result = await validateManualWhatsAppAccount({
    estabelecimentoId: 10,
    payload: {
      business_account_id: 'biz-1',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      access_token: 'token-12345678',
      descriptive_name: 'Recepcao principal',
    },
  }, createSuccessDeps());

  assert.equal(result.valid, true);
  assert.equal(result.preview.provider, 'meta_manual_cloud_api');
  assert.equal(result.preview.status, 'validating');
  assert.equal(result.preview.business_account_id, 'biz-1');
  assert.equal(result.preview.waba_id, 'waba-1');
  assert.equal(result.preview.phone_number_id, 'phone-1');
  assert.equal(result.preview.display_phone_number, '+55 11 99999-0000');
  assert.equal(result.preview.verified_name, 'Studio AO');
  assert.equal(result.preview.descriptive_name, 'Recepcao principal');
  assert.equal(result.preview.token_last4, '5678');
});

test('connectManualWhatsAppAccount persists a valid tenant account', async () => {
  let persistedPayload = null;
  const result = await connectManualWhatsAppAccount({
    estabelecimentoId: 22,
    payload: {
      business_account_id: 'biz-1',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      access_token: 'token-12345678',
      descriptive_name: 'Recepcao principal',
    },
  }, {
    ...createSuccessDeps(),
    getWaAccountByPhoneNumberId: async () => null,
    releaseWaPhoneNumberFromAccount: async () => ({ ok: true }),
    encryptAccessToken: () => ({ enc: 'enc-token', last4: '5678' }),
    upsertWaAccount: async (_estabelecimentoId, payload) => {
      persistedPayload = payload;
      return {
        id: 7,
        estabelecimento_id: 22,
        provider: payload.provider,
        waba_id: payload.waba_id,
        phone_number_id: payload.phone_number_id,
        display_phone_number: payload.display_phone_number,
        verified_name: payload.verified_name,
        business_id: payload.business_id,
        access_token_enc: payload.access_token_enc,
        status: payload.status,
        connected_at: payload.connected_at,
        disconnected_at: payload.disconnected_at,
        token_last_validated_at: payload.token_last_validated_at,
        last_sync_at: payload.last_sync_at,
        metadata_json: payload.metadata_json,
      };
    },
  });

  assert.equal(persistedPayload.provider, 'meta_manual_cloud_api');
  assert.equal(persistedPayload.status, 'connected');
  assert.equal(persistedPayload.access_token_enc, 'enc-token');
  assert.equal(persistedPayload.waba_id, 'waba-1');
  assert.equal(persistedPayload.phone_number_id, 'phone-1');
  assert.equal(result.connected, true);
  assert.equal(result.account.provider, 'meta_manual_cloud_api');
  assert.equal(result.account.business_account_id, 'biz-1');
});

test('disconnectTenantWhatsAppAccount returns the disconnected account state', async () => {
  let disconnectedId = null;
  const result = await disconnectTenantWhatsAppAccount(77, {
    disconnectWaAccount: async (estabelecimentoId) => {
      disconnectedId = estabelecimentoId;
      return { ok: true };
    },
    getWaAccountByEstabelecimentoId: async () => ({
      id: 3,
      estabelecimento_id: 77,
      provider: 'meta_manual_cloud_api',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      display_phone_number: '+55 11 99999-0000',
      verified_name: 'Studio AO',
      business_id: 'biz-1',
      access_token_enc: null,
      status: 'disconnected',
      disconnected_at: '2026-03-15T11:00:00.000Z',
      metadata_json: {
        business: { name: 'Studio AO LTDA' },
      },
    }),
  });

  assert.equal(disconnectedId, 77);
  assert.equal(result.connected, false);
  assert.equal(result.status, 'disconnected');
  assert.equal(result.account.provider, 'meta_manual_cloud_api');
});
