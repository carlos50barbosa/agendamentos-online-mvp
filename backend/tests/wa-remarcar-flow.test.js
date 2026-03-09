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

function buildRemarcarActions({ conflict = false } = {}) {
  const day = '2026-02-25';
  const slot = '2026-02-25T14:00:00.000Z';
  return {
    async listAgendamentosRemarcaveis() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/agendamentos',
        agendamentos: [
          {
            id: 701,
            clienteId: 901,
            inicio: '2026-02-24T13:00:00.000Z',
            servicoId: 10,
            servicoIds: [10],
            servicoNome: 'Corte',
            profissionalId: 30,
            profissionalNome: 'Ana',
          },
        ],
      };
    },
    async getNextDaysWithAvailability() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/slots',
        days: [{ dateKey: day, label: 'qua, 25/02', totalSlots: 1 }],
      };
    },
    async getSlots() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/slots',
        days: [{ dateKey: day, slots: [{ datetime: slot, hourLabel: '11:00' }] }],
      };
    },
    collectHoursForDay(slotsResult, dateKey) {
      const dayEntry = (slotsResult.days || []).find((entry) => entry.dateKey === dateKey);
      return (dayEntry?.slots || []).map((entry) => ({ datetime: entry.datetime, label: entry.hourLabel }));
    },
    async remarcarAgendamento() {
      if (conflict) {
        return { ok: false, status: 409, endpoint: '/api/agendamentos/701/reschedule-estab', data: { error: 'slot_ocupado' } };
      }
      return { ok: true, status: 200, endpoint: '/api/agendamentos/701/reschedule-estab', data: { ok: true } };
    },
  };
}

test('remarcar flow success', async () => {
  const engine = new BotEngine({
    actions: buildRemarcarActions({ conflict: false }),
    sessionStore: createMemorySessionStore(),
  });
  const tenantId = 27;
  const fromPhone = '5511999999999';

  let result = await engine.handleInbound({ tenantId, fromPhone, text: 'remarcar' });
  assert.equal(result.nextState, 'REMARCAR_ESCOLHER_AGENDAMENTO');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'REMARCAR_ESCOLHER_DIA');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'REMARCAR_ESCOLHER_HORA');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'REMARCAR_CONFIRMAR');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'DONE');
  assert.equal(result.action, 'REMARCAR_OK');
});

test('remarcar flow handles slot conflict (409)', async () => {
  const engine = new BotEngine({
    actions: buildRemarcarActions({ conflict: true }),
    sessionStore: createMemorySessionStore(),
  });
  const tenantId = 27;
  const fromPhone = '5511888877777';

  await engine.handleInbound({ tenantId, fromPhone, text: 'remarcar' });
  await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  const result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });

  assert.equal(result.nextState, 'REMARCAR_ESCOLHER_HORA');
  assert.equal(result.action, 'CONFLICT');
});
