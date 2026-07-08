import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const { pool } = await import('../src/lib/db.js');
const slotsRouter = (await import('../src/routes/slots.js')).default;
const {
  checkAppointmentSlotCapacityTx,
} = await import('../src/lib/service_capacity.js');
const {
  EST_TZ_OFFSET_MIN,
  makeUtcFromLocalYMDHM,
} = await import('../src/lib/datetime_tz.js');

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

async function startSlotsServer() {
  const app = express();
  app.use('/slots', slotsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function installSlotsPoolMock({
  appointments = [],
  capacity = 2,
  durationMin = 30,
  serviceId = 10,
  establishmentId = 1,
} = {}) {
  const originalQuery = pool.query;
  pool.query = async (sql, params = []) => {
    const statement = normalizeSql(sql);

    if (statement.startsWith('SELECT id, duracao_min, capacidade_por_horario FROM servicos')) {
      return [[{
        id: serviceId,
        duracao_min: durationMin,
        capacidade_por_horario: capacity,
      }], []];
    }

    if (statement.startsWith('SELECT servico_id, profissional_id, inicio, fim FROM agendamentos')) {
      const professionalFilter = statement.includes('profissional_id IS NULL OR profissional_id=?')
        ? Number(params[3])
        : null;
      const rows = appointments
        .filter((appt) => Number(appt.estabelecimento_id ?? establishmentId) === Number(establishmentId))
        .filter((appt) => (
          professionalFilter == null ||
          appt.profissional_id == null ||
          Number(appt.profissional_id) === professionalFilter
        ))
        .map((appt) => ({
          servico_id: appt.servico_id,
          profissional_id: appt.profissional_id,
          inicio: appt.inicio,
          fim: appt.fim,
        }));
      return [rows, []];
    }

    if (statement.startsWith('SELECT inicio, fim FROM bloqueios')) {
      return [[], []];
    }

    if (statement.startsWith('SELECT horarios_json FROM estabelecimento_perfis')) {
      return [[], []];
    }

    throw new Error(`Unexpected SQL in slots test: ${statement}`);
  };

  return () => {
    pool.query = originalQuery;
  };
}

function makeAppointment({
  serviceId = 10,
  professionalId = 77,
  start,
  durationMin = 30,
} = {}) {
  return {
    estabelecimento_id: 1,
    servico_id: serviceId,
    profissional_id: professionalId,
    inicio: start,
    fim: new Date(start.getTime() + durationMin * 60_000),
  };
}

// Data futura fixa: evita que o filtro de "horário passado" do slots.js afete os
// testes de capacidade conforme o tempo real avança.
const FUTURE_WEEK_START = '2099-01-05';

async function fetchSlots({ baseUrl, professionalId, weekStart = FUTURE_WEEK_START } = {}) {
  const params = new URLSearchParams({
    establishmentId: '1',
    weekStart,
    servico_id: '10',
  });
  if (professionalId != null) {
    params.set('profissional_id', String(professionalId));
  }
  const response = await fetch(`${baseUrl}/slots?${params.toString()}`);
  assert.equal(response.status, 200);
  return response.json();
}

function findSlot(payload, start) {
  return payload.slots.find((slot) => new Date(slot.datetime).getTime() === start.getTime());
}

test('GET /slots keeps same-service slot available until capacity is reached', async () => {
  const start = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({
    appointments: [makeAppointment({ start })],
    capacity: 2,
  });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl, professionalId: 77 });
    const slot = findSlot(payload, start);
    assert.ok(slot, 'expected 10:00 slot');
    assert.equal(slot.status, 'free');
    assert.equal(slot.label, 'disponivel');
    assert.equal(slot.capacidade, 2);
    assert.equal(slot.vagas_restantes, 1);
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots applies capacity when professional is not provided', async () => {
  const start = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({
    appointments: [makeAppointment({ start })],
    capacity: 2,
  });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl });
    const slot = findSlot(payload, start);
    assert.ok(slot, 'expected 10:00 slot');
    assert.equal(slot.status, 'free');
    assert.equal(slot.vagas_restantes, 1);
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots marks slot booked when service capacity is reached', async () => {
  const start = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({
    appointments: [
      makeAppointment({ start }),
      makeAppointment({ start }),
    ],
    capacity: 2,
  });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl, professionalId: 77 });
    const slot = findSlot(payload, start);
    assert.ok(slot, 'expected 10:00 slot');
    assert.equal(slot.status, 'booked');
    assert.equal(slot.label, 'agendado');
    assert.equal(slot.vagas_restantes, 0);
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots still blocks different overlapping starts', async () => {
  const slotStart = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const overlappingStart = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 15, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({
    appointments: [makeAppointment({ start: overlappingStart })],
    capacity: 2,
  });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl, professionalId: 77 });
    const slot = findSlot(payload, slotStart);
    assert.ok(slot, 'expected 10:00 slot');
    assert.equal(slot.status, 'booked');
    assert.equal(slot.vagas_restantes, 0);
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots marca horários já passados como indisponíveis', async () => {
  // Semana bem no passado -> todos os slots já decorreram (agora >> início).
  const pastWeekStart = '2020-01-06';
  const pastStart = makeUtcFromLocalYMDHM(2020, 1, 6, 10, 0, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({ appointments: [], capacity: 2 });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl, weekStart: pastWeekStart });
    const slot = findSlot(payload, pastStart);
    assert.ok(slot, 'expected 10:00 slot on past date');
    assert.equal(slot.status, 'unavailable');
    assert.equal(slot.label, 'bloqueado');
    assert.equal(slot.vagas_restantes, 0);
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots mantém horários futuros como disponíveis', async () => {
  const futureStart = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const restore = installSlotsPoolMock({ appointments: [], capacity: 2 });
  const server = await startSlotsServer();

  try {
    const payload = await fetchSlots({ baseUrl: server.baseUrl });
    const slot = findSlot(payload, futureStart);
    assert.ok(slot, 'expected 10:00 slot on future date');
    assert.equal(slot.status, 'free');
    assert.equal(slot.label, 'disponivel');
  } finally {
    await server.close();
    restore();
  }
});

function createCapacityDb({ blockingRows = [], sameSlotRows = [], capacity = 2 } = {}) {
  const sqlLog = [];
  const db = {
    async query(sql, params = []) {
      const statement = normalizeSql(sql);
      sqlLog.push({ statement, params });

      if (statement.startsWith('SELECT capacidade_por_horario FROM servicos')) {
        return [[{ capacidade_por_horario: capacity }], []];
      }

      if (
        statement.startsWith('SELECT id FROM agendamentos WHERE estabelecimento_id=?') &&
        statement.includes('AND (inicio < ? AND fim > ?)')
      ) {
        return [blockingRows, []];
      }

      if (
        statement.startsWith('SELECT id FROM agendamentos WHERE estabelecimento_id=?') &&
        statement.includes('AND servico_id=?') &&
        statement.includes('AND inicio>=?') &&
        statement.includes('AND inicio<?')
      ) {
        return [sameSlotRows, []];
      }

      throw new Error(`Unexpected SQL in capacity test: ${statement}`);
    },
  };

  return { db, sqlLog };
}

test('capacity transaction permits another booking in the same minute below capacity', async () => {
  const inicioDate = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const fimDate = new Date(inicioDate.getTime() + 30 * 60_000);
  const { db, sqlLog } = createCapacityDb({
    sameSlotRows: [{ id: 1 }],
    capacity: 2,
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: 1,
    serviceItems: [{ id: 10 }],
    profissionalId: 77,
    requiresProfessional: true,
    inicioDate: new Date(inicioDate.getTime() + 30_000),
    fimDate,
  });

  assert.equal(result.ok, true);
  assert.equal(result.capacity, 2);
  assert.equal(result.remaining, 1);
  assert.ok(sqlLog.some(({ statement }) => statement.includes('inicio>=? AND inicio<?')));
  assert.ok(!sqlLog.some(({ statement }) => statement.includes('AND inicio=?')));
});

test('capacity transaction rejects when capacity is reached', async () => {
  const inicioDate = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const fimDate = new Date(inicioDate.getTime() + 30 * 60_000);
  const { db } = createCapacityDb({
    sameSlotRows: [{ id: 1 }, { id: 2 }],
    capacity: 2,
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: 1,
    serviceItems: [{ id: 10 }],
    profissionalId: 77,
    requiresProfessional: true,
    inicioDate,
    fimDate,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_lotado');
  assert.equal(result.message, 'Hor\u00e1rio lotado para este servi\u00e7o.');
});

test('capacity transaction preserves blocking for other overlapping appointments', async () => {
  const inicioDate = makeUtcFromLocalYMDHM(2099, 1, 5, 10, 0, EST_TZ_OFFSET_MIN);
  const fimDate = new Date(inicioDate.getTime() + 30 * 60_000);
  const { db } = createCapacityDb({
    blockingRows: [{ id: 99 }],
    sameSlotRows: [{ id: 1 }],
    capacity: 2,
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: 1,
    serviceItems: [{ id: 10 }],
    profissionalId: 77,
    requiresProfessional: true,
    inicioDate,
    fimDate,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_ocupado');
  assert.equal(result.message, 'Hor\u00e1rio indispon\u00edvel.');
});
