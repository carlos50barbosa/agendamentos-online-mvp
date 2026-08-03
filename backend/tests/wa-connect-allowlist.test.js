import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWhatsAppConnectAllowlist,
  isWhatsAppConnectEnabled,
  isWhatsAppConnectFeatureOn,
  getWhatsAppConnectFeatureState,
} from '../src/lib/featureFlags.js';

// A lista existe porque conectar HOJE significa migrar o numero para a Cloud API — o dono perde o
// aplicativo WhatsApp Business, que e onde ele conversa com as clientes. Enquanto a coexistencia
// nao esta de pe, so o estabelecimento de teste da Meta deve enxergar a tela.
//
// O erro caro aqui e liberar para quem nao devia. Por isso os testes cobrem principalmente isso.

const ligado = (extra = {}) => ({ WHATSAPP_CONNECT_ENABLED: 'true', ...extra });

test('sem lista, o comportamento e o de antes: todos liberados', () => {
  // Critico para a implantacao: subir esta versao NAO pode fechar a porta de quem ja usava.
  assert.equal(isWhatsAppConnectEnabled(26, ligado()), true);
  assert.equal(isWhatsAppConnectEnabled(999, ligado()), true);
  assert.equal(isWhatsAppConnectEnabled(26, ligado({ WHATSAPP_CONNECT_ALLOWLIST: '' })), true);
  assert.equal(isWhatsAppConnectEnabled(26, ligado({ WHATSAPP_CONNECT_ALLOWLIST: '   ' })), true);
});

test('com lista, so quem esta nela passa', () => {
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  assert.equal(isWhatsAppConnectEnabled(186, env), true);
  assert.equal(isWhatsAppConnectEnabled(26, env), false);
  assert.equal(isWhatsAppConnectEnabled(1, env), false);
});

test('aceita varios ids, com espaco e lixo no meio', () => {
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: ' 186 , 26 ,, abc, 0, -5 ' });
  assert.deepEqual(getWhatsAppConnectAllowlist(env), [186, 26]);
  assert.equal(isWhatsAppConnectEnabled(186, env), true);
  assert.equal(isWhatsAppConnectEnabled(26, env), true);
  assert.equal(isWhatsAppConnectEnabled(99, env), false);
});

test('com lista e SEM saber de quem se trata: fail-closed', () => {
  // Sem identificar o estabelecimento nao da para consultar a lista, e liberar seria o erro caro.
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  assert.equal(isWhatsAppConnectEnabled(null, env), false);
  assert.equal(isWhatsAppConnectEnabled(undefined, env), false);
  assert.equal(isWhatsAppConnectEnabled('abc', env), false);
  assert.equal(isWhatsAppConnectEnabled(0, env), false);
});

test('a flag desligada vence a lista', () => {
  const env = { WHATSAPP_CONNECT_ENABLED: 'false', WHATSAPP_CONNECT_ALLOWLIST: '186' };
  assert.equal(isWhatsAppConnectEnabled(186, env), false);
  assert.equal(isWhatsAppConnectFeatureOn(env), false);
});

test('isWhatsAppConnectFeatureOn IGNORA a lista — e so para a rota sem autenticacao', () => {
  // O callback do OAuth nao tem estabelecimento para consultar; ele so redireciona ao painel.
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  assert.equal(isWhatsAppConnectFeatureOn(env), true);
  assert.equal(isWhatsAppConnectEnabled(26, env), false);
});

test('quem esta fora da lista ve o MESMO que veria com a feature desligada', () => {
  // A existencia da lista nao e assunto do estabelecimento: nada na resposta pode denunciar que
  // ha um grupo privilegiado.
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  const fora = getWhatsAppConnectFeatureState(26, env);
  const desligada = getWhatsAppConnectFeatureState(26, { WHATSAPP_CONNECT_ENABLED: 'false' });
  assert.deepEqual(fora, desligada);
  assert.equal(fora.mode, 'coming_soon');
});

test('quem esta na lista recebe o estado habilitado', () => {
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  const dentro = getWhatsAppConnectFeatureState(186, env);
  assert.equal(dentro.feature_enabled, true);
  assert.equal(dentro.mode, 'enabled');
});

test('a lista e lida a cada chamada, nao no carregamento do modulo', () => {
  // E o que permite adicionar um estabelecimento com uma linha no .env e um reload do PM2, sem
  // rebuild e sem deploy do frontend.
  const env = ligado({ WHATSAPP_CONNECT_ALLOWLIST: '186' });
  assert.equal(isWhatsAppConnectEnabled(26, env), false);
  env.WHATSAPP_CONNECT_ALLOWLIST = '186,26';
  assert.equal(isWhatsAppConnectEnabled(26, env), true);
});
