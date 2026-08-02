import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSendKindToCatalogKind } from '../src/lib/wa_template_catalog.js';
import { resolveWhatsAppTenantConfig } from '../src/services/waAccountResolver.js';

test('mapeia os kinds de CLIENTE para o catalogo', () => {
  assert.equal(mapSendKindToCatalogKind('confirm_cli'), 'confirm_cli');
  assert.equal(mapSendKindToCatalogKind('cancel_cli'), 'cancel_cli');
  assert.equal(mapSendKindToCatalogKind('reschedule_cli'), 'reschedule_cli');
  // O lembrete do cliente aparece com dois nomes no codigo.
  assert.equal(mapSendKindToCatalogKind('reminder_cli'), 'reminder_cli');
  assert.equal(mapSendKindToCatalogKind('reminder_8h'), 'reminder_cli');
});

test('kinds do DONO nao mapeiam — avisos dele saem do numero global', () => {
  assert.equal(mapSendKindToCatalogKind('confirm_est'), null);
  assert.equal(mapSendKindToCatalogKind('cancel_est'), null);
  assert.equal(mapSendKindToCatalogKind('estab_reminder_5h'), null);
});

test('kind desconhecido nao vira modelo de tenant', () => {
  assert.equal(mapSendKindToCatalogKind('optin_confirm'), null);
  assert.equal(mapSendKindToCatalogKind(''), null);
  assert.equal(mapSendKindToCatalogKind(undefined), null);
});

const depsComTenant = {
  getWaAccountByEstabelecimentoId: async () => ({
    status: 'connected', phone_number_id: 'PHONE_TENANT',
    access_token_enc: 'enc', estabelecimento_id: 7,
  }),
  getWaAccountByPhoneNumberId: async () => ({
    status: 'connected', phone_number_id: 'PHONE_TENANT',
    access_token_enc: 'enc', estabelecimento_id: 7,
  }),
  decryptAccessToken: () => 'tok_tenant',
  defaultToken: 'tok_global',
  defaultPhoneId: 'PHONE_GLOBAL',
};

test('sem forceGlobal, o tenant conectado ganha', async () => {
  const r = await resolveWhatsAppTenantConfig({ estabelecimentoId: 7 }, depsComTenant);
  assert.equal(r.phoneId, 'PHONE_TENANT');
  assert.equal(r.token, 'tok_tenant');
});

test('forceGlobal ignora o tenant e usa o numero da plataforma', async () => {
  // E' o que impede o salao de mandar aviso para si mesmo quando tem WABA propria.
  const r = await resolveWhatsAppTenantConfig({ estabelecimentoId: 7, forceGlobal: true }, depsComTenant);
  assert.equal(r.phoneId, 'PHONE_GLOBAL');
  assert.equal(r.token, 'tok_global');
});

test('forceGlobal tambem ignora a resolucao por phoneNumberId', async () => {
  const r = await resolveWhatsAppTenantConfig(
    { phoneNumberId: 'PHONE_TENANT', forceGlobal: true },
    depsComTenant
  );
  assert.equal(r.phoneId, 'PHONE_GLOBAL');
});
