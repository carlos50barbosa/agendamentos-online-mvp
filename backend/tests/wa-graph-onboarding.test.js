import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerWhatsAppPhoneNumber,
  subscribeAppToWaba,
  listWabaSubscribedApps,
} from '../src/services/waGraph.js';

// Sem token/id nao ha o que chamar: falhar aqui e' melhor que montar uma URL invalida e receber um
// erro generico da Graph, que nao diz qual dos dois faltou.
test('subscribeAppToWaba exige token e waba', async () => {
  await assert.rejects(() => subscribeAppToWaba({ accessToken: '', wabaId: '123' }),
    /wa_missing_token_or_waba/);
  await assert.rejects(() => subscribeAppToWaba({ accessToken: 'tok', wabaId: '' }),
    /wa_missing_token_or_waba/);
});

test('listWabaSubscribedApps devolve null sem parametros, em vez de chamar a Graph', async () => {
  assert.equal(await listWabaSubscribedApps({ accessToken: '', wabaId: '1' }), null);
  assert.equal(await listWabaSubscribedApps({ accessToken: 'tok', wabaId: '' }), null);
});

test('registerWhatsAppPhoneNumber exige token e phone number id', async () => {
  await assert.rejects(() => registerWhatsAppPhoneNumber({ accessToken: '', phoneNumberId: '1', pin: '123456' }),
    /wa_missing_token_or_phone/);
  await assert.rejects(() => registerWhatsAppPhoneNumber({ accessToken: 'tok', phoneNumberId: '', pin: '123456' }),
    /wa_missing_token_or_phone/);
});

test('registerWhatsAppPhoneNumber recusa PIN que nao seja 6 digitos', async () => {
  const invalidos = ['', '12345', '1234567', 'abcdef', '12 34 56', null, undefined];
  for (const pin of invalidos) {
    await assert.rejects(
      () => registerWhatsAppPhoneNumber({ accessToken: 'tok', phoneNumberId: '9', pin }),
      /wa_invalid_pin/,
      `PIN ${JSON.stringify(pin)} deveria ser recusado antes de sair da nossa maquina`
    );
  }
});
