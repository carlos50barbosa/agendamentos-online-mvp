// O LINK DO CONVITE — a regra que decide para QUEM a cliente manda AUTORIZO.
//
// Errar aqui não dá erro: manda o AUTORIZO para o número errado (ou para nenhum), a pessoa vê o
// WhatsApp abrir, acha que autorizou, e o envio do salão continua bloqueado por `no_optin`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTenantOptInLink, OPTIN_KEYWORD } from '../src/lib/wa_optin_link.js';

test('monta o link com o numero do salao e a palavra AUTORIZO', () => {
  assert.equal(
    buildTenantOptInLink('+55 11 91515-5349'),
    'https://wa.me/5511915155349?text=AUTORIZO'
  );
});

test('a palavra e a mesma que o webhook reconhece', () => {
  assert.equal(OPTIN_KEYWORD, 'AUTORIZO');
});

test('sem numero NAO devolve meio-link', () => {
  // `wa.me/?text=AUTORIZO` abre o WhatsApp sem destinatario: a mensagem nao vai para lugar nenhum
  // e ninguem fica sabendo. Melhor a tela nao oferecer o botao.
  for (const vazio of [null, undefined, '', '   ', 'sem digitos']) {
    assert.equal(buildTenantOptInLink(vazio), null, `deveria recusar: ${JSON.stringify(vazio)}`);
  }
});

test('numero curto demais e recusado', () => {
  // 12 digitos e o piso: celular BR sem o nono digito com DDI (55 + DDD + 8). Abaixo disso nao ha
  // numero internacional plausivel, e um link torto some em silencio.
  assert.equal(buildTenantOptInLink('+55 11 9999'), null);
  assert.equal(buildTenantOptInLink('551199873664'), 'https://wa.me/551199873664?text=AUTORIZO');
});
