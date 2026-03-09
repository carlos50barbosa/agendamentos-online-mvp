import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplyMode, resolveTemplateFallbackConfig } from '../src/bot/engine/replyPolicy.js';

test('fora da janela de 24h usa template', () => {
  const now = new Date('2026-02-24T12:00:00.000Z');
  const lastInteractionAt = new Date('2026-02-23T10:59:59.000Z').toISOString();
  const mode = resolveReplyMode({ lastInteractionAt, now });
  assert.equal(mode, 'template');
});

test('dentro da janela de 24h usa texto', () => {
  const now = new Date('2026-02-24T12:00:00.000Z');
  const lastInteractionAt = new Date('2026-02-24T10:00:00.000Z').toISOString();
  const mode = resolveReplyMode({ lastInteractionAt, now });
  assert.equal(mode, 'text');
});

test('sem template configurado retorna erro de template ausente', () => {
  const previousNameMenu = process.env.WA_TEMPLATE_NAME_MENU;
  const previousNameReminder = process.env.WA_TEMPLATE_NAME_REMINDER;
  const previousName = process.env.WA_TEMPLATE_NAME;
  try {
    delete process.env.WA_TEMPLATE_NAME_MENU;
    delete process.env.WA_TEMPLATE_NAME_REMINDER;
    delete process.env.WA_TEMPLATE_NAME;
    const cfg = resolveTemplateFallbackConfig('menu');
    assert.equal(cfg.ok, false);
    assert.equal(cfg.reason, 'template_missing');
    assert.equal(cfg.template, null);
  } finally {
    if (previousNameMenu === undefined) delete process.env.WA_TEMPLATE_NAME_MENU;
    else process.env.WA_TEMPLATE_NAME_MENU = previousNameMenu;
    if (previousNameReminder === undefined) delete process.env.WA_TEMPLATE_NAME_REMINDER;
    else process.env.WA_TEMPLATE_NAME_REMINDER = previousNameReminder;
    if (previousName === undefined) delete process.env.WA_TEMPLATE_NAME;
    else process.env.WA_TEMPLATE_NAME = previousName;
  }
});
