// Bloqueio de horarios: da REGRA para o ENFORCEMENT.
//
// Por que este arquivo existe: ate aqui o bloqueio era COSMETICO. A tabela `bloqueios` so
// era lida pelo GET /slots (a grade da tela) e nenhum dos 4 caminhos de escrita de
// agendamento a consultava. O dono bloqueava, o horario sumia da tela, e um POST direto —
// ou uma corrida entre carregar a grade e confirmar — gravava por cima assim mesmo.
//
// O que estes testes seguram:
//   1. a REGRA CENTRAL de escopo: bloqueio SEM profissional fecha o salao inteiro; bloqueio
//      de um profissional derruba SO os agendamentos daquele profissional (nem os de outro,
//      nem os que nao tem profissional). Errar isso fecha a agenda do salao inteiro por
//      causa da folga de uma pessoa — o pior estrago possivel aqui;
//   2. o enforcement dentro de checkAppointmentSlotCapacityTx, que e o unico gargalo dos 4
//      caminhos de criacao/remarcacao (cliente, painel, remarcar, publico/bot);
//   3. o anti-vazamento: `motivo` e nota interna do dono ("dentista", "viagem") e NUNCA pode
//      chegar a quem esta agendando;
//   4. o guard de conflito no POST (bloquear por cima de agendamento vivo criava bloqueio
//      fantasma: na grade o rotulo 'agendado' ganha e o bloqueio some da tela);
//   5. o isolamento entre estabelecimentos no DELETE.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const { pool } = await import('../src/lib/db.js');
const slotsRouter = (await import('../src/routes/slots.js')).default;
const {
  MAX_BLOCK_DAYS,
  checkBlockConflictTx,
  findBlocksOverlappingTx,
  normalizeBlockInput,
} = await import('../src/lib/bloqueios.js');
const { checkAppointmentSlotCapacityTx } = await import('../src/lib/service_capacity.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');

const ESTAB_ID = 1;
const OUTRO_ESTAB_ID = 2;
const PRO_A = 77;
const PRO_B = 88;

// Semana futura fixa: o GET /slots marca como indisponivel tudo que ja passou, entao uma
// data relativa a "hoje" faria o teste mudar de resultado conforme o relogio anda.
const FUTURE_WEEK_START = '2099-01-05';

const localDate = (year, month, day, hour = 0, minute = 0) =>
  makeUtcFromLocalYMDHM(year, month, day, hour, minute, EST_TZ_OFFSET_MIN);

const toMs = (value) => (value instanceof Date ? value.getTime() : new Date(value).getTime());

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------
// Mock de SQL por POSICAO DE PLACEHOLDER.
//
// O mock nao adivinha a ordem dos parametros: ele liga cada `?` ao trecho de SQL que vem
// imediatamente antes dele. Assim a assercao vale para qualquer formatacao do WHERE (com ou
// sem alias, com ou sem espaco no `=`), em vez de so passar com a unica string que o autor
// do teste imaginou. E o que permite reproduzir aqui a logica de 3 valores do MySQL:
// `profissional_id = NULL` nao casa com nada — so `IS NULL` casa.
// ---------------------------------------------------------------------------------------
function bindParams(statement, params = []) {
  const chunks = String(statement).split('?');
  return (params || []).map((value, index) => ({
    before: String(chunks[index] || '').toLowerCase(),
    value,
  }));
}

function findBind(binds, pattern) {
  return binds.find((bind) => pattern.test(bind.before)) || null;
}

const P_ESTAB = /estabelecimento_id\s*=\s*$/;
const P_INICIO_LT = /\binicio\s*<\s*$/;
const P_FIM_GT = /\bfim\s*>\s*$/;
const P_INICIO_EQ = /\binicio\s*=\s*$/;
const P_FIM_EQ = /\bfim\s*=\s*$/;
const P_PROF_EQ = /profissional_id\s*=\s*$/;
const P_ID_EQ = /\bid\s*=\s*$/;
const P_ID_NEQ = /\bid\s*(<>|!=)\s*$/;

// Reproduz um SELECT em `bloqueios`: overlap por instante + a REGRA CENTRAL de escopo.
function selectBloqueios(statement, params, { blocks, professionals = [] }) {
  const binds = bindParams(statement, params);
  const estabBind = findBind(binds, P_ESTAB);
  if (!estabBind) {
    throw new Error(`consulta de bloqueios sem filtro por estabelecimento: ${statement}`);
  }
  const estabelecimentoId = Number(estabBind.value);

  const nomePorProfissional = new Map(
    professionals.map((pro) => [Number(pro.id), pro.nome ?? null])
  );

  let candidates = blocks.filter(
    (row) => Number(row.estabelecimento_id ?? ESTAB_ID) === estabelecimentoId
  );

  const fimBind = findBind(binds, P_INICIO_LT); // inicio < fimDate
  const inicioBind = findBind(binds, P_FIM_GT); // fim > inicioDate
  const inicioEqBind = findBind(binds, P_INICIO_EQ);
  const fimEqBind = findBind(binds, P_FIM_EQ);
  const idBind = findBind(binds, P_ID_EQ);

  if (fimBind && inicioBind) {
    const fimMs = toMs(fimBind.value);
    const inicioMs = toMs(inicioBind.value);
    candidates = candidates.filter((row) => toMs(row.inicio) < fimMs && toMs(row.fim) > inicioMs);
  } else if (inicioEqBind && fimEqBind) {
    // Forma do POST /toggle legado: casa o intervalo EXATO, nao sobreposicao.
    candidates = candidates.filter((row) => (
      toMs(row.inicio) === toMs(inicioEqBind.value) && toMs(row.fim) === toMs(fimEqBind.value)
    ));
  } else if (idBind) {
    candidates = candidates.filter((row) => Number(row.id) === Number(idBind.value));
  } else {
    throw new Error(
      `consulta de bloqueios sem overlap (inicio < ? AND fim > ?) nem busca por id: ${statement}`
    );
  }

  // Escopo por profissional. Tres formas aceitas, todas avaliadas como o MySQL avaliaria:
  //  (a) "(profissional_id IS NULL OR profissional_id = ?)" -> NULL sempre casa; o resto so
  //      casa com o parametro (e se o parametro for NULL, so o NULL casa);
  //  (b) "profissional_id IS NULL" sozinho -> so bloqueio do estabelecimento inteiro;
  //  (c) nenhuma clausula -> o filtro ficou para o JS da rota, entao devolvemos tudo.
  const profBind = findBind(binds, P_PROF_EQ);
  const onlyNullScope = !profBind && /profissional_id\s+is\s+null/i.test(statement);
  if (profBind) {
    const profissionalParam = profBind.value == null ? null : Number(profBind.value);
    candidates = candidates.filter((row) => (
      row.profissional_id == null ||
      (profissionalParam != null && Number(row.profissional_id) === profissionalParam)
    ));
  } else if (onlyNullScope) {
    candidates = candidates.filter((row) => row.profissional_id == null);
  }

  const excludeBind = findBind(binds, P_ID_NEQ);
  if (excludeBind) {
    candidates = candidates.filter((row) => Number(row.id) !== Number(excludeBind.value));
  }

  return candidates.map((row) => ({
    id: row.id,
    inicio: row.inicio,
    fim: row.fim,
    profissional_id: row.profissional_id ?? null,
    profissional_nome:
      row.profissional_id == null ? null : nomePorProfissional.get(Number(row.profissional_id)) ?? null,
    motivo: row.motivo ?? null,
    dia_inteiro: row.dia_inteiro ?? 0,
  }));
}

// Reproduz o SELECT de agendamentos ativos sobrepostos usado pelo guard do POST.
function selectAgendamentos(statement, params, { appointments }) {
  const binds = bindParams(statement, params);
  const estabBind = findBind(binds, P_ESTAB);
  const fimBind = findBind(binds, P_INICIO_LT);
  const inicioBind = findBind(binds, P_FIM_GT);
  if (!estabBind || !fimBind || !inicioBind) {
    throw new Error(`consulta de agendamentos sem estabelecimento/overlap: ${statement}`);
  }

  const fimMs = toMs(fimBind.value);
  const inicioMs = toMs(inicioBind.value);
  let rows = appointments
    .filter((row) => Number(row.estabelecimento_id ?? ESTAB_ID) === Number(estabBind.value))
    .filter((row) => toMs(row.inicio) < fimMs && toMs(row.fim) > inicioMs);

  const profBind = findBind(binds, P_PROF_EQ);
  if (profBind) {
    const profissionalParam = profBind.value == null ? null : Number(profBind.value);
    // Se o SQL abriu a excecao do NULL, o NULL casa; senao e igualdade pura — que e o que a
    // REGRA CENTRAL pede quando o bloqueio e de um profissional especifico.
    const nullTambemCasa = /profissional_id\s+is\s+null\s+or/i.test(statement);
    rows = rows.filter((row) => {
      if (row.profissional_id == null) return nullTambemCasa;
      return profissionalParam != null && Number(row.profissional_id) === profissionalParam;
    });
  }

  return rows.map((row) => ({
    id: row.id,
    inicio: row.inicio,
    fim: row.fim,
    cliente_nome: row.cliente_nome ?? null,
    profissional_id: row.profissional_id ?? null,
  }));
}

// =======================================================================================
// 1) normalizeBlockInput
// =======================================================================================

test('MAX_BLOCK_DAYS e o teto declarado no contrato (366 dias)', () => {
  assert.equal(MAX_BLOCK_DAYS, 366);
});

test('normalizeBlockInput: dia inteiro expande para o DIA LOCAL, nao para o dia UTC', () => {
  // 22:00 em Brasilia ja e o dia SEGUINTE em UTC. Se a expansao usar getters UTC, o dono
  // pede "bloquear o dia 10" e o sistema bloqueia o dia 11 — erro invisivel em dev e certo
  // em producao, porque o offset e fixo -180.
  const result = normalizeBlockInput({
    inicio: localDate(2099, 3, 10, 22, 0).toISOString(),
    fim: localDate(2099, 3, 10, 23, 0).toISOString(),
    dia_inteiro: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.diaInteiro, true);
  assert.equal(result.inicioDate.getTime(), localDate(2099, 3, 10, 0, 0).getTime());
  assert.equal(result.fimDate.getTime(), localDate(2099, 3, 11, 0, 0).getTime());
});

test('normalizeBlockInput: dia inteiro em varios dias vai de 00:00 do primeiro ate 00:00 do dia seguinte ao ultimo', () => {
  const result = normalizeBlockInput({
    inicio: localDate(2099, 3, 10, 14, 30).toISOString(),
    fim: localDate(2099, 3, 12, 9, 0).toISOString(),
    dia_inteiro: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.inicioDate.getTime(), localDate(2099, 3, 10, 0, 0).getTime());
  assert.equal(result.fimDate.getTime(), localDate(2099, 3, 13, 0, 0).getTime());
});

test('normalizeBlockInput: sem dia inteiro, preserva os instantes recebidos', () => {
  const inicio = localDate(2099, 3, 10, 12, 0);
  const fim = localDate(2099, 3, 10, 14, 0);
  const result = normalizeBlockInput({ inicio: inicio.toISOString(), fim: fim.toISOString() });

  assert.equal(result.ok, true);
  assert.equal(result.diaInteiro, false);
  assert.equal(result.inicioDate.getTime(), inicio.getTime());
  assert.equal(result.fimDate.getTime(), fim.getTime());
  assert.equal(result.profissionalId, null);
  assert.equal(result.motivo, null);
});

test('normalizeBlockInput: fim <= inicio e intervalo_invalido', () => {
  const inicio = localDate(2099, 3, 10, 14, 0);

  const igual = normalizeBlockInput({
    inicio: inicio.toISOString(),
    fim: inicio.toISOString(),
  });
  assert.equal(igual.ok, false);
  assert.equal(igual.error, 'intervalo_invalido');

  const invertido = normalizeBlockInput({
    inicio: inicio.toISOString(),
    fim: localDate(2099, 3, 10, 13, 0).toISOString(),
  });
  assert.equal(invertido.ok, false);
  assert.equal(invertido.error, 'intervalo_invalido');
});

test('normalizeBlockInput: datas ilegiveis viram inicio_invalido / fim_invalido', () => {
  const semInicio = normalizeBlockInput({
    inicio: 'nao-e-data',
    fim: localDate(2099, 3, 10, 14, 0).toISOString(),
  });
  assert.equal(semInicio.ok, false);
  assert.equal(semInicio.error, 'inicio_invalido');

  const semFim = normalizeBlockInput({
    inicio: localDate(2099, 3, 10, 12, 0).toISOString(),
    fim: 'nao-e-data',
  });
  assert.equal(semFim.ok, false);
  assert.equal(semFim.error, 'fim_invalido');
});

test('normalizeBlockInput: range absurdo e intervalo_muito_longo, mas alguns meses passam', () => {
  const inicio = localDate(2099, 1, 5, 0, 0);

  const absurdo = normalizeBlockInput({
    inicio: inicio.toISOString(),
    fim: new Date(inicio.getTime() + 400 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(absurdo.ok, false);
  assert.equal(absurdo.error, 'intervalo_muito_longo');

  const razoavel = normalizeBlockInput({
    inicio: inicio.toISOString(),
    fim: new Date(inicio.getTime() + 300 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(razoavel.ok, true);
});

test('normalizeBlockInput: motivo e aparado, cortado em 180 chars e vazio vira null', () => {
  const base = {
    inicio: localDate(2099, 3, 10, 12, 0).toISOString(),
    fim: localDate(2099, 3, 10, 14, 0).toISOString(),
  };

  const longo = normalizeBlockInput({ ...base, motivo: 'x'.repeat(200) });
  assert.equal(longo.ok, true);
  assert.equal(longo.motivo.length, 180);

  const comEspacos = normalizeBlockInput({ ...base, motivo: '   Dentista   ' });
  assert.equal(comEspacos.motivo, 'Dentista');

  const vazio = normalizeBlockInput({ ...base, motivo: '   ' });
  assert.equal(vazio.motivo, null);
});

test('normalizeBlockInput: profissional_id lixo e profissional_invalido; ausente vira null', () => {
  const base = {
    inicio: localDate(2099, 3, 10, 12, 0).toISOString(),
    fim: localDate(2099, 3, 10, 14, 0).toISOString(),
  };

  const lixo = normalizeBlockInput({ ...base, profissional_id: 'abc' });
  assert.equal(lixo.ok, false);
  assert.equal(lixo.error, 'profissional_invalido');

  const ausente = normalizeBlockInput({ ...base, profissional_id: '' });
  assert.equal(ausente.ok, true);
  assert.equal(ausente.profissionalId, null);

  const informado = normalizeBlockInput({ ...base, profissional_id: '77' });
  assert.equal(informado.ok, true);
  assert.equal(informado.profissionalId, 77);
});

// =======================================================================================
// 2) findBlocksOverlappingTx / checkBlockConflictTx — a REGRA CENTRAL
// =======================================================================================

function createBlocksDb({ blocks = [], professionals = [] } = {}) {
  const sqlLog = [];
  const db = {
    async query(sql, params = []) {
      const statement = normalizeSql(sql);
      sqlLog.push({ statement, params });
      if (/from\s+bloqueios/i.test(statement)) {
        return [selectBloqueios(statement, params, { blocks, professionals }), []];
      }
      throw new Error(`SQL inesperado no teste de bloqueios: ${statement}`);
    },
  };
  return { db, sqlLog };
}

const bloqueio = ({
  id,
  profissionalId = null,
  inicio,
  fim,
  motivo = null,
  estabelecimentoId = ESTAB_ID,
}) => ({
  id,
  estabelecimento_id: estabelecimentoId,
  profissional_id: profissionalId,
  inicio,
  fim,
  motivo,
  dia_inteiro: 0,
});

const BLOCO_10_11 = {
  inicio: localDate(2099, 1, 5, 10, 0),
  fim: localDate(2099, 1, 5, 11, 0),
};

async function conflito({ blocks, profissionalId, inicioDate, fimDate }) {
  const { db, sqlLog } = createBlocksDb({ blocks });
  const result = await checkBlockConflictTx({
    db,
    estabelecimentoId: ESTAB_ID,
    profissionalId,
    inicioDate,
    fimDate,
  });
  return { result, sqlLog };
}

test('checkBlockConflictTx: bloqueio do estabelecimento derruba agendamento COM profissional', async () => {
  const { result } = await conflito({
    blocks: [bloqueio({ id: 10, profissionalId: null, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_bloqueado');
  assert.equal(result.message, 'Horário bloqueado na agenda.');
  assert.equal(result.bloqueio.id, 10);
  assert.equal(toMs(result.bloqueio.inicio), BLOCO_10_11.inicio.getTime());
  assert.equal(toMs(result.bloqueio.fim), BLOCO_10_11.fim.getTime());
});

test('checkBlockConflictTx: bloqueio do estabelecimento derruba agendamento SEM profissional', async () => {
  const { result } = await conflito({
    blocks: [bloqueio({ id: 11, profissionalId: null, ...BLOCO_10_11 })],
    profissionalId: null,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_bloqueado');
});

test('checkBlockConflictTx: bloqueio do profissional X derruba o agendamento de X', async () => {
  const { result } = await conflito({
    blocks: [bloqueio({ id: 12, profissionalId: PRO_A, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_bloqueado');
  assert.equal(result.bloqueio.id, 12);
});

test('checkBlockConflictTx: bloqueio do profissional X NAO derruba o agendamento de Y', async () => {
  // Este e o teste que impede o pior estrago da feature: a folga de uma pessoa fechando a
  // agenda do salao inteiro.
  const { result } = await conflito({
    blocks: [bloqueio({ id: 13, profissionalId: PRO_A, ...BLOCO_10_11 })],
    profissionalId: PRO_B,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, true);
});

test('checkBlockConflictTx: bloqueio do profissional X NAO derruba agendamento sem profissional', async () => {
  const { result } = await conflito({
    blocks: [bloqueio({ id: 14, profissionalId: PRO_A, ...BLOCO_10_11 })],
    profissionalId: null,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, true);
});

test('checkBlockConflictTx: encosto exato nao conflita (10:00-11:00 vs 11:00-11:30)', async () => {
  const depois = await conflito({
    blocks: [bloqueio({ id: 15, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 11, 0),
    fimDate: localDate(2099, 1, 5, 11, 30),
  });
  assert.equal(depois.result.ok, true);

  const antes = await conflito({
    blocks: [bloqueio({ id: 15, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 9, 30),
    fimDate: localDate(2099, 1, 5, 10, 0),
  });
  assert.equal(antes.result.ok, true);
});

test('checkBlockConflictTx: sobreposicao parcial conflita nas duas pontas', async () => {
  const cauda = await conflito({
    blocks: [bloqueio({ id: 16, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 10, 45),
    fimDate: localDate(2099, 1, 5, 11, 30),
  });
  assert.equal(cauda.result.ok, false);
  assert.equal(cauda.result.error, 'slot_bloqueado');

  // Servico longo que comeca ANTES do bloqueio e o atravessa: e por isso que a condicao
  // tem de ser overlap, e nao igualdade de inicio.
  const atravessa = await conflito({
    blocks: [bloqueio({ id: 16, ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 9, 0),
    fimDate: localDate(2099, 1, 5, 12, 0),
  });
  assert.equal(atravessa.result.ok, false);
});

test('checkBlockConflictTx roda com FOR UPDATE e NAO devolve o motivo do bloqueio', async () => {
  const { result, sqlLog } = await conflito({
    blocks: [bloqueio({ id: 17, motivo: 'dentista', ...BLOCO_10_11 })],
    profissionalId: PRO_A,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  // A checagem roda dentro da transacao de criacao do agendamento: sem o lock, um bloqueio
  // criado no meio do caminho passaria despercebido.
  assert.ok(
    sqlLog.some(({ statement }) => /for update/i.test(statement)),
    'a checagem de bloqueio precisa travar as linhas (FOR UPDATE)'
  );
  // `motivo` e nota interna do dono. Quem esta agendando nunca pode ler "dentista".
  assert.ok(
    !JSON.stringify(result).includes('dentista'),
    'o motivo do bloqueio nao pode sair no retorno da checagem'
  );
});

test('findBlocksOverlappingTx: devolve as linhas sobrepostas, honra excludeBlockId e so trava com forUpdate', async () => {
  const blocks = [
    bloqueio({ id: 20, ...BLOCO_10_11 }),
    bloqueio({
      id: 21,
      inicio: localDate(2099, 1, 5, 15, 0),
      fim: localDate(2099, 1, 5, 16, 0),
    }),
  ];

  const { db, sqlLog } = createBlocksDb({ blocks });
  const rows = await findBlocksOverlappingTx({
    db,
    estabelecimentoId: ESTAB_ID,
    inicioDate: localDate(2099, 1, 5, 9, 0),
    fimDate: localDate(2099, 1, 5, 12, 0),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 20);
  assert.ok(
    !sqlLog.some(({ statement }) => /for update/i.test(statement)),
    'sem forUpdate a leitura nao deve serializar as criacoes concorrentes do estabelecimento'
  );

  const { db: db2 } = createBlocksDb({ blocks });
  const semEle = await findBlocksOverlappingTx({
    db: db2,
    estabelecimentoId: ESTAB_ID,
    inicioDate: localDate(2099, 1, 5, 9, 0),
    fimDate: localDate(2099, 1, 5, 12, 0),
    excludeBlockId: 20,
  });
  assert.equal(semEle.length, 0);
});

// =======================================================================================
// 3) Enforcement: checkAppointmentSlotCapacityTx
// =======================================================================================

function createCapacityDbWithBlocks({ blocks = [], capacity = 2 } = {}) {
  const sqlLog = [];
  const db = {
    async query(sql, params = []) {
      const statement = normalizeSql(sql);
      sqlLog.push({ statement, params });
      if (/from\s+bloqueios/i.test(statement)) {
        return [selectBloqueios(statement, params, { blocks }), []];
      }
      if (/from\s+servicos/i.test(statement)) {
        return [[{ capacidade_por_horario: capacity }], []];
      }
      if (/from\s+agendamentos/i.test(statement)) {
        return [[], []];
      }
      throw new Error(`SQL inesperado no teste de capacidade: ${statement}`);
    },
  };
  return { db, sqlLog };
}

test('checkAppointmentSlotCapacityTx recusa com slot_bloqueado antes de tocar em agendamentos', async () => {
  const { db, sqlLog } = createCapacityDbWithBlocks({
    blocks: [bloqueio({ id: 30, motivo: 'dentista', ...BLOCO_10_11 })],
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: ESTAB_ID,
    serviceItems: [{ id: 10 }],
    profissionalId: PRO_A,
    requiresProfessional: true,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_bloqueado');
  assert.equal(result.message, 'Horário bloqueado na agenda.');
  assert.equal(result.capacity, 1);
  assert.equal(result.remaining, 0);

  // O bloqueio vale ANTES da capacidade: um servico com capacidade > 1 nao pode furar.
  assert.ok(
    !sqlLog.some(({ statement }) => /from\s+agendamentos/i.test(statement)),
    'a checagem de bloqueio precisa vir antes de qualquer query em agendamentos'
  );
  // Anti-vazamento: quem esta agendando ve o codigo e a mensagem — nunca a nota do dono.
  assert.ok(
    !JSON.stringify(result).includes('dentista'),
    'o motivo do bloqueio nao pode vazar para quem esta agendando'
  );
});

test('checkAppointmentSlotCapacityTx leva o profissional DO AGENDAMENTO para a checagem de bloqueio', async () => {
  const { db, sqlLog } = createCapacityDbWithBlocks({
    blocks: [bloqueio({ id: 31, profissionalId: PRO_A, ...BLOCO_10_11 })],
  });

  await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: ESTAB_ID,
    serviceItems: [{ id: 10 }],
    profissionalId: PRO_A,
    requiresProfessional: true,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  const consulta = sqlLog.find(({ statement }) => /from\s+bloqueios/i.test(statement));
  assert.ok(consulta, 'nenhuma consulta em bloqueios foi feita');
  const profBind = findBind(bindParams(consulta.statement, consulta.params), P_PROF_EQ);
  assert.ok(profBind, 'a consulta de bloqueios precisa escopar por profissional');
  assert.equal(Number(profBind.value), PRO_A);
});

test('checkAppointmentSlotCapacityTx aplica o bloqueio mesmo quando o servico nao exige profissional', async () => {
  // O bloqueio nao pode ficar pendurado no requiresProfessional: servico sem profissional
  // vinculado tambem tem de respeitar a folga do salao.
  const { db } = createCapacityDbWithBlocks({
    blocks: [bloqueio({ id: 32, profissionalId: null, ...BLOCO_10_11 })],
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: ESTAB_ID,
    serviceItems: [{ id: 10 }],
    profissionalId: null,
    requiresProfessional: false,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'slot_bloqueado');
});

test('checkAppointmentSlotCapacityTx segue o fluxo normal quando o bloqueio e de outro profissional', async () => {
  const { db } = createCapacityDbWithBlocks({
    blocks: [bloqueio({ id: 33, profissionalId: PRO_A, ...BLOCO_10_11 })],
  });

  const result = await checkAppointmentSlotCapacityTx({
    db,
    estabelecimentoId: ESTAB_ID,
    serviceItems: [{ id: 10 }],
    profissionalId: PRO_B,
    requiresProfessional: true,
    inicioDate: localDate(2099, 1, 5, 10, 0),
    fimDate: localDate(2099, 1, 5, 10, 30),
  });

  assert.equal(result.ok, true);
});

// =======================================================================================
// 4) GET /slots — a grade publica
// =======================================================================================

async function startSlotsServer() {
  const app = express();
  app.use(express.json());
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

function installGridPoolMock({ blocks = [], professionals = [] } = {}) {
  const originalQuery = pool.query;
  pool.query = async (sql, params = []) => {
    const statement = normalizeSql(sql);

    if (/from\s+bloqueios/i.test(statement)) {
      return [selectBloqueios(statement, params, { blocks, professionals }), []];
    }
    if (statement.startsWith('SELECT id, duracao_min, capacidade_por_horario FROM servicos')) {
      return [[{ id: 10, duracao_min: 30, capacidade_por_horario: 1 }], []];
    }
    if (/from\s+agendamentos/i.test(statement)) {
      return [[], []];
    }
    if (/from\s+estabelecimento_perfis/i.test(statement)) {
      return [[], []];
    }

    throw new Error(`SQL inesperado no teste da grade: ${statement}`);
  };

  return () => {
    pool.query = originalQuery;
  };
}

async function fetchSlot({ baseUrl, professionalId, start }) {
  const params = new URLSearchParams({
    establishmentId: String(ESTAB_ID),
    weekStart: FUTURE_WEEK_START,
    servico_id: '10',
  });
  if (professionalId != null) params.set('profissional_id', String(professionalId));
  const response = await fetch(`${baseUrl}/slots?${params.toString()}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const slot = payload.slots.find((item) => new Date(item.datetime).getTime() === start.getTime());
  assert.ok(slot, 'slot esperado nao veio na grade');
  return slot;
}

test('GET /slots: bloqueio do estabelecimento derruba o slot', async () => {
  const restore = installGridPoolMock({
    blocks: [bloqueio({ id: 40, profissionalId: null, ...BLOCO_10_11 })],
  });
  const server = await startSlotsServer();

  try {
    const slot = await fetchSlot({ baseUrl: server.baseUrl, start: BLOCO_10_11.inicio });
    assert.equal(slot.status, 'unavailable');
    assert.equal(slot.label, 'bloqueado');
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots: bloqueio de UM profissional NAO derruba o slot na visao "qualquer profissional"', async () => {
  // Sem isto, a folga de uma pessoa apagaria a agenda do salao inteiro para quem nao
  // escolheu profissional — e o cliente veria "sem horario" num dia com o salao aberto.
  const restore = installGridPoolMock({
    blocks: [bloqueio({ id: 41, profissionalId: PRO_A, ...BLOCO_10_11 })],
  });
  const server = await startSlotsServer();

  try {
    const slot = await fetchSlot({ baseUrl: server.baseUrl, start: BLOCO_10_11.inicio });
    assert.equal(slot.status, 'free');
    assert.equal(slot.label, 'disponivel');
  } finally {
    await server.close();
    restore();
  }
});

test('GET /slots: bloqueio de um profissional derruba o slot so para ele', async () => {
  const restore = installGridPoolMock({
    blocks: [bloqueio({ id: 42, profissionalId: PRO_A, ...BLOCO_10_11 })],
  });
  const server = await startSlotsServer();

  try {
    const doBloqueado = await fetchSlot({
      baseUrl: server.baseUrl,
      professionalId: PRO_A,
      start: BLOCO_10_11.inicio,
    });
    assert.equal(doBloqueado.status, 'unavailable');

    const doOutro = await fetchSlot({
      baseUrl: server.baseUrl,
      professionalId: PRO_B,
      start: BLOCO_10_11.inicio,
    });
    assert.equal(doOutro.status, 'free');
  } finally {
    await server.close();
    restore();
  }
});

// =======================================================================================
// 5) Rotas do dono: GET / POST / DELETE /slots/bloqueios
// =======================================================================================

function usuarioEstabelecimento(id) {
  return {
    id,
    nome: `Salao ${id}`,
    email: `salao${id}@test.local`,
    telefone: '11999990000',
    tipo: 'estabelecimento',
    plan: 'premium',
    plan_status: 'active',
    plan_trial_ends_at: null,
    plan_active_until: new Date('2099-12-31T00:00:00.000Z'),
    plan_subscription_id: null,
    plan_cycle: 'mensal',
    onboarding_concluido: 1,
    onboarding_etapa: 'concluido',
  };
}

// `deadlockAttempts`: quantas das primeiras transacoes morrem com ER_LOCK_DEADLOCK, para
// reproduzir o InnoDB escolhendo esta transacao como vitima de um ciclo de locks.
function installOwnerPoolMock({
  blocks = [],
  appointments = [],
  professionals = [],
  nextInsertId = 4242,
  deadlockAttempts = 0,
} = {}) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  const sqlLog = [];
  const tx = { begin: 0, commit: 0, rollback: 0, release: 0 };
  const store = { blocks: blocks.map((row) => ({ ...row })), insertId: nextInsertId };
  let connectionsAbertas = 0;

  const handle = async (sql, params = [], journal = null) => {
    const statement = normalizeSql(sql);
    sqlLog.push({ statement, params });

    if (statement.startsWith('SELECT plan,')) {
      const [row] = [usuarioEstabelecimento(Number(params[0]))];
      return [[row], []];
    }
    if (/insert\s+into\s+bloqueios/i.test(statement)) {
      const columns = String(statement.match(/insert\s+into\s+bloqueios\s*\(([^)]*)\)/i)?.[1] || '')
        .split(',')
        .map((part) => part.trim().replace(/`/g, ''));
      const row = { id: store.insertId };
      columns.forEach((column, index) => {
        row[column] = params[index];
      });
      store.blocks.push(row);
      // O journal existe para o rollback desfazer de verdade: a rota grava o bloqueio ANTES
      // do guard (para travar `bloqueios` na mesma ordem da transacao de agendamento) e
      // desfaz se houver conflito. Sem isto o teste nao conseguiria distinguir "gravou e
      // desfez" de "gravou e ficou" — que e justamente o que importa.
      if (journal) journal.push(row);
      const insertId = store.insertId;
      store.insertId += 1;
      return [{ insertId, affectedRows: 1 }, []];
    }
    if (/delete\s+from\s+bloqueios/i.test(statement)) {
      const binds = bindParams(statement, params);
      const idBind = findBind(binds, P_ID_EQ);
      const estabBind = findBind(binds, P_ESTAB);
      const before = store.blocks.length;
      store.blocks = store.blocks.filter((row) => {
        const mesmoId = idBind ? Number(row.id) === Number(idBind.value) : false;
        const mesmoEstab = estabBind
          ? Number(row.estabelecimento_id ?? ESTAB_ID) === Number(estabBind.value)
          : true;
        return !(mesmoId && mesmoEstab);
      });
      return [{ affectedRows: before - store.blocks.length }, []];
    }
    if (/from\s+bloqueios/i.test(statement)) {
      return [selectBloqueios(statement, params, { blocks: store.blocks, professionals }), []];
    }
    if (/from\s+agendamentos/i.test(statement)) {
      return [selectAgendamentos(statement, params, { appointments }), []];
    }
    if (/from\s+profissionais/i.test(statement)) {
      const binds = bindParams(statement, params);
      const idBind = findBind(binds, P_ID_EQ);
      const estabBind = findBind(binds, P_ESTAB);
      const rows = professionals.filter((pro) => (
        (!idBind || Number(pro.id) === Number(idBind.value)) &&
        (!estabBind || Number(pro.estabelecimento_id ?? ESTAB_ID) === Number(estabBind.value))
      ));
      return [rows.map((pro) => ({ id: pro.id, nome: pro.nome })), []];
    }
    if (/from\s+subscriptions/i.test(statement)) {
      return [[], []];
    }
    if (/from\s+usuarios/i.test(statement)) {
      return [[usuarioEstabelecimento(Number(params[0]))], []];
    }
    if (/from\s+estabelecimento_perfis/i.test(statement)) {
      return [[], []];
    }

    throw new Error(`SQL inesperado no teste das rotas de bloqueio: ${statement}`);
  };

  pool.query = (sql, params) => handle(sql, params, null);
  pool.getConnection = async () => {
    const journal = [];
    connectionsAbertas += 1;
    const tentativa = connectionsAbertas;
    return {
      async query(sql, params) {
        if (tentativa <= deadlockAttempts && /insert\s+into\s+bloqueios/i.test(normalizeSql(sql))) {
          const err = new Error('Deadlock found when trying to get lock; try restarting transaction');
          err.code = 'ER_LOCK_DEADLOCK';
          err.errno = 1213;
          throw err;
        }
        return handle(sql, params, journal);
      },
      async beginTransaction() { tx.begin += 1; journal.length = 0; },
      async commit() { tx.commit += 1; journal.length = 0; },
      async rollback() {
        tx.rollback += 1;
        store.blocks = store.blocks.filter((row) => !journal.includes(row));
        journal.length = 0;
      },
      release() { tx.release += 1; },
    };
  };

  return {
    sqlLog,
    tx,
    store,
    restore() {
      pool.query = originalQuery;
      pool.getConnection = originalGetConnection;
    },
  };
}

const tokenDe = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15m' });

async function callOwner(baseUrl, path, { method = 'GET', body, userId = ESTAB_ID } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDe(userId)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload, text };
}

test('GET /slots/bloqueios devolve a janela local pedida, com nome do profissional e ISO em UTC', async () => {
  const mock = installOwnerPoolMock({
    blocks: [
      bloqueio({ id: 50, profissionalId: PRO_A, motivo: 'dentista', ...BLOCO_10_11 }),
      // Fora da janela: comeca na semana seguinte.
      bloqueio({
        id: 51,
        inicio: localDate(2099, 1, 20, 10, 0),
        fim: localDate(2099, 1, 20, 11, 0),
      }),
    ],
    professionals: [{ id: PRO_A, estabelecimento_id: ESTAB_ID, nome: 'Bruna' }],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(
      server.baseUrl,
      '/slots/bloqueios?from=2099-01-05&to=2099-01-05'
    );

    assert.equal(status, 200);
    assert.equal(payload.bloqueios.length, 1);
    const [item] = payload.bloqueios;
    assert.equal(item.id, 50);
    assert.equal(item.inicio, BLOCO_10_11.inicio.toISOString());
    assert.equal(item.fim, BLOCO_10_11.fim.toISOString());
    assert.equal(item.profissional_id, PRO_A);
    assert.equal(item.profissional_nome, 'Bruna');
    // Aqui o motivo PODE aparecer: quem le e o dono, dono do proprio recado.
    assert.equal(item.motivo, 'dentista');
    assert.ok('dia_inteiro' in item);
  } finally {
    await server.close();
    mock.restore();
  }
});

test('GET /slots/bloqueios recusa janela maior que 186 dias', async () => {
  const mock = installOwnerPoolMock();
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(
      server.baseUrl,
      '/slots/bloqueios?from=2099-01-05&to=2099-12-31'
    );
    assert.equal(status, 400);
    assert.equal(payload.error, 'intervalo_muito_longo');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios: 409 conflito_agendamentos quando ha agendamento ativo sobreposto', async () => {
  // O bloqueio fantasma: antes dava para bloquear por cima de um agendamento confirmado, e
  // o bloqueio sumia da grade (o rotulo 'agendado' ganha). O dono achava que tinha fechado
  // o horario e continuava recebendo cliente.
  const mock = installOwnerPoolMock({
    appointments: [{
      id: 501,
      estabelecimento_id: ESTAB_ID,
      profissional_id: PRO_A,
      cliente_nome: 'Ana',
      inicio: localDate(2099, 1, 5, 10, 30),
      fim: localDate(2099, 1, 5, 11, 0),
    }],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
        motivo: 'dentista',
      },
    });

    assert.equal(status, 409);
    assert.equal(payload.error, 'conflito_agendamentos');
    assert.equal(payload.agendamentos.length, 1);
    assert.equal(payload.agendamentos[0].id, 501);
    assert.equal(payload.agendamentos[0].cliente_nome, 'Ana');

    // A rota grava ANTES de checar (a ordem que evita o deadlock — ver o teste
    // "grava o bloqueio ANTES de varrer agendamentos"), entao o que este teste segura e o
    // desfazer: nao pode sobrar bloqueio depois de um 409.
    assert.equal(mock.tx.rollback, 1, 'o 409 tem de desfazer a transacao');
    assert.equal(mock.tx.commit, 0);
    assert.equal(mock.store.blocks.length, 0, 'sem force nao pode sobrar bloqueio gravado');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios com force: cria mesmo assim e NAO cancela os agendamentos existentes', async () => {
  const mock = installOwnerPoolMock({
    appointments: [{
      id: 501,
      estabelecimento_id: ESTAB_ID,
      profissional_id: PRO_A,
      cliente_nome: 'Ana',
      inicio: localDate(2099, 1, 5, 10, 30),
      fim: localDate(2099, 1, 5, 11, 0),
    }],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
        motivo: 'dentista',
        force: true,
      },
    });

    assert.equal(status, 201);
    assert.equal(payload.bloqueio.id, 4242);
    assert.equal(payload.bloqueio.inicio, BLOCO_10_11.inicio.toISOString());
    assert.equal(payload.bloqueio.fim, BLOCO_10_11.fim.toISOString());
    assert.equal(payload.bloqueio.motivo, 'dentista');
    assert.equal(payload.bloqueio.profissional_id, null);

    // O dono resolve o conflito com o cliente; o sistema nao cancela nada por conta propria.
    assert.ok(
      !mock.sqlLog.some(({ statement }) => /update\s+agendamentos/i.test(statement)),
      'forcar o bloqueio nao pode cancelar agendamento de ninguem'
    );
    // O guard precisa rodar dentro da transacao, senao ele corre com um booking concorrente.
    assert.equal(mock.tx.begin, 1);
    assert.equal(mock.tx.commit, 1);
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios: bloqueio de um profissional ignora agendamento de outro (e de quem nao tem profissional)', async () => {
  const mock = installOwnerPoolMock({
    appointments: [
      {
        id: 601,
        estabelecimento_id: ESTAB_ID,
        profissional_id: PRO_B,
        cliente_nome: 'Bia',
        inicio: localDate(2099, 1, 5, 10, 30),
        fim: localDate(2099, 1, 5, 11, 0),
      },
      {
        id: 602,
        estabelecimento_id: ESTAB_ID,
        profissional_id: null,
        cliente_nome: 'Caio',
        inicio: localDate(2099, 1, 5, 10, 0),
        fim: localDate(2099, 1, 5, 10, 30),
      },
    ],
    professionals: [{ id: PRO_A, estabelecimento_id: ESTAB_ID, nome: 'Bruna' }],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload, text } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
        profissional_id: PRO_A,
      },
    });

    assert.equal(status, 201, `esperado 201, veio ${status}: ${text.slice(0, 200)}`);
    assert.equal(payload.bloqueio.profissional_id, PRO_A);
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios: profissional de outro estabelecimento e recusado', async () => {
  const mock = installOwnerPoolMock({
    professionals: [{ id: PRO_A, estabelecimento_id: OUTRO_ESTAB_ID, nome: 'Bruna' }],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
        profissional_id: PRO_A,
      },
    });

    assert.equal(status, 400);
    assert.equal(payload.error, 'profissional_invalido');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios: fim <= inicio devolve 400 intervalo_invalido', async () => {
  const mock = installOwnerPoolMock();
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.fim.toISOString(),
        fim: BLOCO_10_11.inicio.toISOString(),
      },
    });

    assert.equal(status, 400);
    assert.equal(payload.error, 'intervalo_invalido');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios grava o bloqueio ANTES de varrer agendamentos (ordem = anti-deadlock)', async () => {
  // Esta ordem parece errada e e de proposito, entao vale um teste explicito para ninguem
  // "arrumar" no futuro.
  //
  // Esta transacao e a de criar agendamento tocam as mesmas duas tabelas em direcoes opostas.
  // Ler `bloqueios` antes de `agendamentos` NAO resolve: as duas leituras acham faixa vazia e
  // tiram gap lock, e gap locks sao mutuamente compativeis — ninguem espera ninguem. O ciclo
  // so fecha no INSERT final de cada uma, na tabela que a outra gap-lockou, e o InnoDB mata
  // uma (500 para quem estava agendando). Com o INSERT na frente, quem decide a corrida e o
  // lock de REGISTRO da linha nova, que e exclusivo: o perdedor trava na PRIMEIRA aquisicao,
  // sem segurar nada, e nao ha ciclo.
  const mock = installOwnerPoolMock();
  const server = await startSlotsServer();

  try {
    const { status } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
      },
    });
    assert.equal(status, 201);

    const posInsert = mock.sqlLog.findIndex(({ statement }) => (
      /insert\s+into\s+bloqueios/i.test(statement)
    ));
    const posGuard = mock.sqlLog.findIndex(({ statement }) => (
      /from\s+agendamentos/i.test(statement) && /for update/i.test(statement)
    ));

    assert.ok(posInsert >= 0, 'o bloqueio tem de ser gravado');
    assert.ok(posGuard >= 0, 'o guard de conflito tem de rodar com FOR UPDATE');
    assert.ok(
      posInsert < posGuard,
      'o INSERT em bloqueios tem de vir ANTES do SELECT de agendamentos, senao o deadlock volta'
    );
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios refaz a transacao quando o InnoDB mata por deadlock', async () => {
  // O caminho de REMARCAR trava a linha do agendamento antes de olhar bloqueios, entao o
  // ciclo ainda e possivel ali. Sem retry o dono leva 500 ("Nao foi possivel bloquear este
  // horario") por contencao de milissegundos, numa acao que so precisava ser refeita.
  const mock = installOwnerPoolMock({ deadlockAttempts: 1 });
  const server = await startSlotsServer();

  try {
    const { status, payload, text } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
        motivo: 'dentista',
      },
    });

    assert.equal(status, 201, `esperado 201 apos o retry, veio ${status}: ${text.slice(0, 200)}`);
    assert.equal(payload.bloqueio.motivo, 'dentista');
    assert.equal(mock.tx.begin, 2, 'a segunda tentativa tem de abrir uma transacao nova');
    assert.equal(mock.tx.rollback, 1, 'a tentativa morta tem de ser desfeita antes de repetir');
    assert.equal(mock.tx.commit, 1);
    assert.equal(mock.store.blocks.length, 1, 'o retry nao pode gravar o bloqueio duas vezes');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/bloqueios nao repete quando o erro nao e de lock', async () => {
  // Retry so vale para contencao. Repetir erro de dado (coluna faltando, FK invalida) so
  // multiplica o estrago e atrasa o 500 que o dono precisa ver.
  const mock = installOwnerPoolMock();
  const server = await startSlotsServer();
  const originalGetConnection = pool.getConnection;
  let tentativas = 0;

  pool.getConnection = async () => {
    tentativas += 1;
    return {
      async query() {
        const err = new Error("Unknown column 'motivo' in 'field list'");
        err.code = 'ER_BAD_FIELD_ERROR';
        err.errno = 1054;
        throw err;
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    };
  };

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios', {
      method: 'POST',
      body: {
        inicio: BLOCO_10_11.inicio.toISOString(),
        fim: BLOCO_10_11.fim.toISOString(),
      },
    });

    assert.equal(status, 500);
    assert.equal(payload.error, 'bloqueio_create_failed');
    assert.equal(tentativas, 1, 'erro de dado nao pode ser tentado de novo');
  } finally {
    pool.getConnection = originalGetConnection;
    await server.close();
    mock.restore();
  }
});

test('DELETE /slots/bloqueios/:id remove o bloqueio do proprio estabelecimento', async () => {
  const mock = installOwnerPoolMock({
    blocks: [bloqueio({ id: 901, estabelecimentoId: ESTAB_ID, ...BLOCO_10_11 })],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios/901', {
      method: 'DELETE',
    });

    assert.equal(status, 200);
    assert.equal(payload.ok, true);
    assert.equal(mock.store.blocks.length, 0);
  } finally {
    await server.close();
    mock.restore();
  }
});

test('DELETE /slots/bloqueios/:id de OUTRO estabelecimento devolve 404 e nao apaga nada', async () => {
  // Isolamento entre tenants: o id e sequencial e global, entao adivinhar o id do vizinho e
  // trivial. Sem o filtro por estabelecimento, qualquer dono apagaria a agenda alheia.
  const mock = installOwnerPoolMock({
    blocks: [bloqueio({ id: 900, estabelecimentoId: OUTRO_ESTAB_ID, ...BLOCO_10_11 })],
  });
  const server = await startSlotsServer();

  try {
    const { status, payload } = await callOwner(server.baseUrl, '/slots/bloqueios/900', {
      method: 'DELETE',
    });

    assert.equal(status, 404);
    assert.equal(payload.error, 'nao_encontrado');
    assert.equal(mock.store.blocks.length, 1, 'o bloqueio do vizinho tem de continuar la');
  } finally {
    await server.close();
    mock.restore();
  }
});

test('POST /slots/toggle continua funcionando para o cliente antigo', async () => {
  const mock = installOwnerPoolMock();
  const server = await startSlotsServer();

  try {
    const bloqueado = await callOwner(server.baseUrl, '/slots/toggle', {
      method: 'POST',
      body: { slotDatetime: BLOCO_10_11.inicio.toISOString() },
    });
    assert.equal(bloqueado.status, 200);
    assert.equal(bloqueado.payload.ok, true);
    assert.equal(bloqueado.payload.action, 'bloqueado');

    const liberado = await callOwner(server.baseUrl, '/slots/toggle', {
      method: 'POST',
      body: { slotDatetime: BLOCO_10_11.inicio.toISOString() },
    });
    assert.equal(liberado.status, 200);
    assert.equal(liberado.payload.action, 'liberado');
  } finally {
    await server.close();
    mock.restore();
  }
});
