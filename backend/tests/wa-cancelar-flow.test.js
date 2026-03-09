import test from 'node:test';
import assert from 'node:assert/strict';
import { BotEngine } from '../src/bot/engine/BotEngine.js';

function createMemorySessionStore() {
  const map = new Map();
  return {
    async getSession({ tenantId, fromPhone }) {
      const key = `${tenantId}:${fromPhone}`;
      return map.get(key) || { state: 'START', context: {}, expiresAt: null, lastInteractionAt: null };
    },
    async saveSession({ tenantId, fromPhone, state, context }) {
      const key = `${tenantId}:${fromPhone}`;
      map.set(key, { state, context, expiresAt: null, lastInteractionAt: null });
      return { ok: true };
    },
  };
}

function buildCancelarActions({ denied = false } = {}) {
  return {
    async listAgendamentosCancelaveis() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/agendamentos',
        agendamentos: [
          {
            id: 702,
            clienteId: 902,
            inicio: '2026-02-26T18:00:00.000Z',
            servicoNome: 'Barba',
          },
        ],
      };
    },
    async cancelarAgendamento() {
      if (denied) {
        return {
          ok: false,
          status: 409,
          endpoint: '/api/agendamentos/702/cancel',
          data: {
            error: 'cancel_forbidden_time_limit',
            message: 'Cancelamento permitido apenas ate 2 horas antes.',
          },
        };
      }
      return {
        ok: true,
        status: 200,
        endpoint: '/api/agendamentos/702/cancel',
        data: { ok: true },
      };
    },
  };
}

test('cancelar flow success', async () => {
  const engine = new BotEngine({
    actions: buildCancelarActions({ denied: false }),
    sessionStore: createMemorySessionStore(),
  });
  const tenantId = 27;
  const fromPhone = '5511777788888';

  let result = await engine.handleInbound({ tenantId, fromPhone, text: 'cancelar' });
  assert.equal(result.nextState, 'CANCELAR_ESCOLHER_AGENDAMENTO');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'CANCELAR_CONFIRMAR');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'DONE');
  assert.equal(result.action, 'CANCEL_OK');
});

test('cancelar flow handles backend denial', async () => {
  const engine = new BotEngine({
    actions: buildCancelarActions({ denied: true }),
    sessionStore: createMemorySessionStore(),
  });
  const tenantId = 27;
  const fromPhone = '5511666677777';

  await engine.handleInbound({ tenantId, fromPhone, text: 'cancelar' });
  await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  const result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });

  assert.equal(result.nextState, 'CANCELAR_CONFIRMAR');
  assert.equal(result.action, 'CANCEL_FAIL');
  assert.match(result.replyText, /humano|menu/i);
});
