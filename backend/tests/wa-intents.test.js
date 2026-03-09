import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, normalizeIntentText } from '../src/bot/engine/intents.js';

test('normalizeIntentText removes accents and trims', () => {
  assert.equal(normalizeIntentText('  Início  '), 'inicio');
  assert.equal(normalizeIntentText('Horário'), 'horario');
});

test('detectIntent recognizes menu/humano/agendar', () => {
  assert.equal(detectIntent('menu'), 'MENU');
  assert.equal(detectIntent('início'), 'MENU');
  assert.equal(detectIntent('humano'), 'HUMANO');
  assert.equal(detectIntent('agendar'), 'AGENDAR');
  assert.equal(detectIntent('horário'), 'AGENDAR');
});

test('detectIntent returns stubs and unknown', () => {
  assert.equal(detectIntent('reagendar'), 'REMARCAR');
  assert.equal(detectIntent('cancelar'), 'CANCELAR');
  assert.equal(detectIntent('blabla'), 'UNKNOWN');
});
