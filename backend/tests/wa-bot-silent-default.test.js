import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureTenantBotSilentByDefault,
  evaluateTenantPolicy,
} from '../src/bot/storage/settingsStore.js';

function espiao(afetadas = 1) {
  const capturado = {};
  return {
    capturado,
    query: async (sql, params) => {
      capturado.sql = String(sql).replace(/\s+/g, ' ').trim();
      capturado.params = params;
      return [{ affectedRows: afetadas }];
    },
  };
}

test('conectar o proprio numero deixa o atendimento automatico em SILENCIO', async () => {
  const e = espiao();
  const r = await ensureTenantBotSilentByDefault(26, { deps: { query: e.query } });
  assert.equal(r.criado, true);
  assert.match(e.capturado.sql, /INSERT INTO wa_bot_settings/i);
  assert.match(e.capturado.sql, /VALUES \(\?, 0, 'human_only', 0, 1, NOW\(\)\)/i,
    'enabled=0 nao basta; e o kill_switch=1 que cala a plataforma por completo');
  assert.deepEqual(e.capturado.params, [26]);
});

test('reconectar NAO desfaz a escolha de quem ja ligou o atendimento', async () => {
  // O ON DUPLICATE KEY nao pode sobrescrever: quem ligou de proposito perderia a configuracao a
  // cada reconexao, sem aviso.
  const e = espiao(0);
  const r = await ensureTenantBotSilentByDefault(26, { deps: { query: e.query } });
  assert.match(e.capturado.sql, /ON DUPLICATE KEY UPDATE tenant_id = tenant_id/i);
  assert.equal(r.criado, false);
});

test('tenant invalido nem toca o banco', async () => {
  let tocou = false;
  const query = async () => { tocou = true; return [{ affectedRows: 1 }]; };
  assert.equal((await ensureTenantBotSilentByDefault(0, { deps: { query } })).ok, false);
  assert.equal((await ensureTenantBotSilentByDefault(null, { deps: { query } })).ok, false);
  assert.equal(tocou, false);
});

// ─── o que a linha gravada PRODUZ na politica ─────────────────────────────────────────────────
// Este e o teste que importa de verdade: gravar a linha certa e inutil se a politica resultante
// ainda deixar a plataforma falar por cima da dona.

test('a linha gravada produz silencio TOTAL — nem motor, nem auto-resposta, nem handoff', () => {
  const p = evaluateTenantPolicy({
    settings: { enabled: false, mode: 'human_only', rolloutPercent: 0, killSwitch: true },
    fromPhone: '5511999990000',
  });
  assert.equal(p.allowEngine, false);
  assert.equal(p.allowAutoReply, false, 'auto-resposta no numero do salao e a plataforma se metendo na conversa');
  assert.equal(p.openHandoff, false, 'abrir handoff dispara a mensagem de pausa a cada mensagem da cliente');
  assert.equal(p.reason, 'KILL_SWITCH');
});

test('so `enabled: false` NAO cala a plataforma — por isso o kill_switch', () => {
  // Registra o motivo da escolha: sem o kill_switch, desligar o bot ainda deixa sair auto-resposta
  // e abre handoff. Se alguem "simplificar" para enabled=0 no futuro, este teste explica o custo.
  const p = evaluateTenantPolicy({
    settings: { enabled: false, mode: 'human_only', rolloutPercent: 0, killSwitch: false },
    fromPhone: '5511999990000',
  });
  assert.equal(p.allowEngine, false);
  assert.equal(p.allowAutoReply, true);
  assert.equal(p.openHandoff, true);
});

test('o numero GLOBAL da plataforma segue com o bot ligado — nada muda para os 93', () => {
  // A mudanca precisa ser cirurgica: quem nao conectou numero proprio continua exatamente como
  // estava, atendido pelo bot no numero da plataforma.
  const p = evaluateTenantPolicy({
    settings: { enabled: true, mode: 'hybrid', rolloutPercent: 100, killSwitch: false },
    fromPhone: '5511999990000',
  });
  assert.equal(p.allowEngine, true);
  assert.equal(p.reason, 'ENABLED');
});

// ─── o interruptor do dono ────────────────────────────────────────────────────────────────────

test('desligar grava o MESMO estado de silencio do padrao', async () => {
  const { setTenantAutoService } = await import('../src/bot/storage/settingsStore.js');
  const e = espiao();
  await setTenantAutoService({ tenantId: 26, ligado: false }, { deps: { query: e.query } });
  // enabled=0, mode=human_only, rollout=0, kill_switch=1 — a mesma linha do ensureTenantBotSilent.
  assert.deepEqual(e.capturado.params, [26, 0, 'human_only', 0, 1]);
});

test('ligar libera o motor de verdade — inclusive tirando o kill_switch', async () => {
  // Sem zerar o kill_switch, o interruptor nao faria nada e o dono acharia que esta quebrado.
  const { setTenantAutoService } = await import('../src/bot/storage/settingsStore.js');
  const e = espiao();
  await setTenantAutoService({ tenantId: 26, ligado: true }, { deps: { query: e.query } });
  assert.deepEqual(e.capturado.params, [26, 1, 'hybrid', 100, 0]);
});

test('o interruptor recusa valor que nao seja booleano', async () => {
  const { setTenantAutoService } = await import('../src/bot/storage/settingsStore.js');
  let tocou = false;
  const query = async () => { tocou = true; return [{ affectedRows: 1 }]; };
  assert.equal((await setTenantAutoService({ tenantId: 0, ligado: true }, { deps: { query } })).ok, false);
  assert.equal(tocou, false);
});
