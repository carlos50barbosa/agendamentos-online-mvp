import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPauseEngine } from '../src/bot/runtime/handoffPolicy.js';

test('bot pausado bloqueia engine quando handoff ativo', () => {
  const decision = shouldPauseEngine({
    mode: 'hybrid',
    botPaused: true,
    hasActiveHandoff: true,
    text: 'quero agendar',
  });
  assert.equal(decision.blockEngine, true);
  assert.equal(decision.reason, 'HANDOFF_OPEN');
});

test('comando "voltar bot" retoma em modo hybrid', () => {
  const decision = shouldPauseEngine({
    mode: 'hybrid',
    botPaused: true,
    hasActiveHandoff: true,
    text: 'voltar bot',
  });
  assert.equal(decision.blockEngine, false);
  assert.equal(decision.canResume, true);
});

test('modo human_only nao permite retomar bot com menu', () => {
  const decision = shouldPauseEngine({
    mode: 'human_only',
    botPaused: true,
    hasActiveHandoff: true,
    text: 'menu',
  });
  assert.equal(decision.blockEngine, true);
  assert.equal(decision.canResume, false);
});
