import test from 'node:test';
import assert from 'node:assert/strict';

// As constantes do servico sao avaliadas no import, entao o env precisa existir ANTES dele.
process.env.WA_APP_ID = process.env.WA_APP_ID || 'app-teste';
process.env.WA_APP_SECRET = process.env.WA_APP_SECRET || 'segredo-teste';
process.env.WA_EMBEDDED_SIGNUP_CONFIG_ID = process.env.WA_EMBEDDED_SIGNUP_CONFIG_ID || 'config-teste';

const { getEmbeddedSignupPublicConfig } = await import('../src/services/whatsappEmbeddedSignupService.js');

// Este arquivo existe por causa de UM caractere de diferenca que custou uma tarde inteira.
//
// Mandavamos `feature: 'whatsapp_embedded_signup'`. A Meta roteia essa chave — de uma versao
// antiga do fluxo — para um caminho reservado a BSP/Tech Provider, e o popup morria em
// "Embedded signup is only available for BSPs or TPs". A chave certa e `featureType`.
//
// Nada disso aparece em teste de integracao nosso: o veredito vem do dialogo da Meta, no navegador.
// O que da para travar aqui e o FORMATO do que sai daqui, e e o que estes testes fazem.
test('extras nao pode conter a chave `feature` — e ela que joga o fluxo no caminho de BSP/TP', () => {
  const { extras } = getEmbeddedSignupPublicConfig();
  assert.equal('feature' in extras, false, 'presenca de `feature` quebra o Embedded Signup em producao');
});

test('extras precisa mandar `featureType`, mesmo vazio', () => {
  const { extras } = getEmbeddedSignupPublicConfig();
  assert.equal('featureType' in extras, true, 'a chave precisa existir; vazio e o padrao documentado');
  assert.equal(typeof extras.featureType, 'string');
});

test('extras mantem setup e sessionInfoVersion no formato que o SDK espera', () => {
  const { extras } = getEmbeddedSignupPublicConfig();
  assert.deepEqual(extras.setup, {}, 'o SDK espera um objeto, ainda que vazio');
  assert.equal(extras.sessionInfoVersion, '3', 'string, nao numero — e o que a Meta documenta');
});

test('a config publica leva o que o FB.login precisa, sem vazar segredo', () => {
  const cfg = getEmbeddedSignupPublicConfig();
  assert.equal(cfg.response_type, 'code');
  assert.equal(cfg.override_default_response_type, true);
  assert.ok(cfg.app_id, 'sem app_id o SDK nem inicializa');
  assert.ok(cfg.config_id, 'sem config_id o FB.login abre o fluxo errado');
  // O app secret assina a troca do code no BACKEND; se aparecesse aqui, iria para o navegador.
  assert.equal(JSON.stringify(cfg).includes(process.env.WA_APP_SECRET), false);
});
