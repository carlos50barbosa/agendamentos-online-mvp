import test from 'node:test';
import assert from 'node:assert/strict';
import { BotEngine } from '../src/bot/engine/BotEngine.js';

function createMemorySessionStore() {
  const map = new Map();
  return {
    async getSession({ tenantId, fromPhone }) {
      const key = `${tenantId}:${fromPhone}`;
      return map.get(key) || { state: 'START', context: {}, expiresAt: null };
    },
    async saveSession({ tenantId, fromPhone, state, context }) {
      const key = `${tenantId}:${fromPhone}`;
      map.set(key, { state, context, expiresAt: null });
      return { ok: true };
    },
  };
}

function createStubActions() {
  const day = '2026-02-24';
  const slot = '2026-02-24T15:00:00.000Z';
  return {
    async listServicos() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/servicos?establishmentId=27',
        services: [{ id: 10, nome: 'Corte' }],
      };
    },
    async listProfissionaisPorServico() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/servicos?establishmentId=27',
        profissionais: [{ id: 30, nome: 'Ana' }],
      };
    },
    async getNextDaysWithAvailability() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/slots?establishmentId=27',
        days: [{ dateKey: day, label: 'ter, 24/02', totalSlots: 1 }],
      };
    },
    async getSlots() {
      return {
        ok: true,
        status: 200,
        endpoint: '/api/slots?establishmentId=27',
        days: [{
          dateKey: day,
          slots: [{ datetime: slot, hourLabel: '12:00' }],
        }],
      };
    },
    collectHoursForDay(slotsResult, dateKey) {
      const dayEntry = (slotsResult.days || []).find((entry) => entry.dateKey === dateKey);
      return (dayEntry?.slots || []).map((slotEntry) => ({
        datetime: slotEntry.datetime,
        label: slotEntry.hourLabel,
      }));
    },
    async createAgendamento() {
      return {
        ok: true,
        status: 201,
        endpoint: '/api/public/agendamentos',
        data: { id: 1234, status: 'confirmado' },
      };
    },
  };
}

test('BotEngine runs main agendar state transitions', async () => {
  const engine = new BotEngine({
    actions: createStubActions(),
    sessionStore: createMemorySessionStore(),
  });

  const tenantId = 27;
  const fromPhone = '5511999999999';

  let result = await engine.handleInbound({ tenantId, fromPhone, text: 'agendar' });
  assert.equal(result.nextState, 'AGENDAR_SERVICO');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'AGENDAR_PROFISSIONAL');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'AGENDAR_DIA');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'AGENDAR_HORA');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'AGENDAR_CONFIRMAR');

  result = await engine.handleInbound({ tenantId, fromPhone, text: '1' });
  assert.equal(result.nextState, 'DONE');
  assert.match(result.replyText, /Agendamento criado com sucesso/i);
});
