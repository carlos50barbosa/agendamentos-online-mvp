import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTenantPolicy, rolloutBucket } from '../src/bot/storage/settingsStore.js';

test('kill switch desativa processamento imediatamente', () => {
  const policy = evaluateTenantPolicy({
    settings: {
      enabled: true,
      mode: 'hybrid',
      rolloutPercent: 100,
      killSwitch: true,
    },
    fromPhone: '5511999999999',
  });
  assert.equal(policy.allowEngine, false);
  assert.equal(policy.allowAutoReply, false);
  assert.equal(policy.reason, 'KILL_SWITCH');
});

test('enabled=false envia para handoff sem engine', () => {
  const policy = evaluateTenantPolicy({
    settings: {
      enabled: false,
      mode: 'hybrid',
      rolloutPercent: 100,
      killSwitch: false,
    },
    fromPhone: '5511888877777',
  });
  assert.equal(policy.allowEngine, false);
  assert.equal(policy.openHandoff, true);
  assert.equal(policy.reason, 'DISABLED');
});

test('rollout percentual aplica bucket deterministico por telefone', () => {
  const fromPhone = '5511777766666';
  const bucket = rolloutBucket(fromPhone);
  const policy10 = evaluateTenantPolicy({
    settings: {
      enabled: true,
      mode: 'hybrid',
      rolloutPercent: 10,
      killSwitch: false,
    },
    fromPhone,
  });
  assert.equal(policy10.inRollout, bucket < 10);
  const policy100 = evaluateTenantPolicy({
    settings: {
      enabled: true,
      mode: 'hybrid',
      rolloutPercent: 100,
      killSwitch: false,
    },
    fromPhone,
  });
  assert.equal(policy100.allowEngine, true);
  assert.equal(policy100.reason, 'ENABLED');
});
