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

// ─── Resolução pelo número que RECEBEU a mensagem ───────────────────────────────────────────────
//
// As respostas de webhook (AUTORIZO, PARAR, "veio errado") só conhecem o `phoneNumberId` — não têm
// `estabelecimentoId`. Antes ele era carregado no contexto e ignorado aqui, então a resposta saía
// sempre pelo número da plataforma: quem escrevia para o número de um estabelecimento receberia
// resposta de OUTRO número. E para esse outro número a janela de 24h não está aberta na visão da
// Meta — o texto falharia, cairia para template e o envio morreria em silêncio.

const CONNECTED_TENANT = {
  estabelecimento_id: 9,
  status: 'connected',
  phone_number_id: 'tenant-phone-id',
  access_token_enc: 'encrypted-token',
};

test('resolveWhatsAppTenantConfig responde pelo número que recebeu a mensagem', async () => {
  const lookups = [];
  const result = await resolveWhatsAppTenantConfig({ kind: 'optout_confirm', phoneNumberId: 'tenant-phone-id' }, {
    getWaAccountByPhoneNumberId: async (phoneNumberId) => {
      lookups.push(phoneNumberId);
      return CONNECTED_TENANT;
    },
    decryptAccessToken: () => 'tenant-token',
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.deepEqual(lookups, ['tenant-phone-id']);
  assert.deepEqual(result, {
    token: 'tenant-token',
    phoneId: 'tenant-phone-id',
    estabelecimentoId: 9,
    fallback: false,
  });
});

test('resolveWhatsAppTenantConfig aceita phone_number_id em snake_case', async () => {
  // Os chamadores divergem na grafia: o auto-reply institucional monta `phone_number_id`, os
  // handlers de opt-in/opt-out montam `phoneNumberId`. Aceitar só uma silenciaria metade deles.
  const result = await resolveWhatsAppTenantConfig({ phone_number_id: 'tenant-phone-id' }, {
    getWaAccountByPhoneNumberId: async () => CONNECTED_TENANT,
    decryptAccessToken: () => 'tenant-token',
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.equal(result.phoneId, 'tenant-phone-id');
  assert.equal(result.fallback, false);
});

test('resolveWhatsAppTenantConfig ignora conta desconectada e cai no fallback', async () => {
  // Responder pelo número da plataforma não é o ideal, mas é melhor que não responder: confirmação
  // de saída não entregue é o que a Meta trata como violação.
  const result = await resolveWhatsAppTenantConfig({ phoneNumberId: 'tenant-phone-id' }, {
    getWaAccountByPhoneNumberId: async () => ({ ...CONNECTED_TENANT, status: 'disconnected' }),
    decryptAccessToken: () => 'tenant-token',
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.equal(result.token, 'fallback-token');
  assert.equal(result.phoneId, 'fallback-phone');
  assert.equal(result.fallback, true);
});

test('resolveWhatsAppTenantConfig prefere o tenant explícito ao número do webhook', async () => {
  // Envio deliberado (lembrete, confirmação) traz `estabelecimentoId` e essa é a rota escolhida.
  // O `phoneNumberId` só entra quando não há tenant — senão um webhook mudaria o remetente de um
  // envio que já sabia por onde deveria sair.
  let phoneLookupCount = 0;
  const result = await resolveWhatsAppTenantConfig({ estabelecimentoId: 42, phoneNumberId: 'tenant-phone-id' }, {
    getWaAccountByEstabelecimentoId: async () => ({
      estabelecimento_id: 42,
      status: 'connected',
      phone_number_id: 'explicit-phone',
      access_token_enc: 'encrypted-token',
    }),
    getWaAccountByPhoneNumberId: async () => {
      phoneLookupCount += 1;
      return CONNECTED_TENANT;
    },
    decryptAccessToken: () => 'tenant-token',
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.equal(result.phoneId, 'explicit-phone');
  assert.equal(result.estabelecimentoId, 42);
  assert.equal(phoneLookupCount, 0, 'nem deve consultar por phone_number_id quando há tenant');
});

test('resolveWhatsAppTenantConfig sobrevive a falha na consulta por phone_number_id', async () => {
  const result = await resolveWhatsAppTenantConfig({ phoneNumberId: 'tenant-phone-id' }, {
    getWaAccountByPhoneNumberId: async () => {
      throw new Error('db offline');
    },
    defaultToken: 'fallback-token',
    defaultPhoneId: 'fallback-phone',
  });

  assert.equal(result.fallback, true);
  assert.equal(result.token, 'fallback-token');
});
