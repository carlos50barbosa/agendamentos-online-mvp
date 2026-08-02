import test from 'node:test';
import assert from 'node:assert/strict';
import { getTenantTemplateRow } from '../src/services/waTenantTemplates.js';

function espiao(rows = []) {
  const capturado = {};
  return {
    capturado,
    query: async (sql, params) => { capturado.sql = sql; capturado.params = params; return [rows]; },
  };
}

test('so considera o modelo quando a conta esta CONNECTED na MESMA waba', async () => {
  // As linhas sobrevivem a desconexao (sao historico). Sem estas duas condicoes, um
  // estabelecimento que desconectasse voltaria ao numero global — que TEM modelo aprovado — e
  // ainda assim teria todo envio ao cliente bloqueado para sempre por uma linha PENDING antiga.
  const e = espiao([{ kind: 'confirm_cli', name: 'x_t1', language: 'pt_BR', status: 'APPROVED' }]);
  await getTenantTemplateRow(186, 'confirm_cli', { deps: { query: e.query } });
  assert.match(e.capturado.sql, /JOIN\s+wa_accounts/i);
  assert.match(e.capturado.sql, /a\.status\s*=\s*'connected'/i);
  assert.match(e.capturado.sql, /a\.waba_id\s*=\s*t\.waba_id/i, 'reconectar com outra WABA nao pode reaproveitar modelo antigo');
  assert.deepEqual(e.capturado.params, [186, 'confirm_cli']);
});

test('sem linha correspondente devolve null — segue o caminho antigo', async () => {
  const e = espiao([]);
  assert.equal(await getTenantTemplateRow(186, 'confirm_cli', { deps: { query: e.query } }), null);
});

test('devolve a linha mesmo NAO aprovada — quem chama precisa distinguir os dois casos', async () => {
  const e = espiao([{ kind: 'reminder_cli', name: 'y_t1', language: 'pt_BR', status: 'PENDING' }]);
  const r = await getTenantTemplateRow(186, 'reminder_cli', { deps: { query: e.query } });
  assert.equal(r.status, 'PENDING');
});

test('parametros ausentes nem tocam o banco', async () => {
  let chamou = false;
  const query = async () => { chamou = true; return [[]]; };
  assert.equal(await getTenantTemplateRow(0, 'confirm_cli', { deps: { query } }), null);
  assert.equal(await getTenantTemplateRow(186, '', { deps: { query } }), null);
  assert.equal(chamou, false);
});
