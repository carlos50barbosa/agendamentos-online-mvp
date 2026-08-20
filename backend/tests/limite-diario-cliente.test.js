// Trava opcional: N agendamentos do mesmo cliente no mesmo dia.
//
// Por que este arquivo existe: cliente que marca varios horarios do mesmo dia "para garantir" e
// comparece a um. O dono ve agenda cheia e dia vazio.
//
// O que estes testes seguram:
//   1. o DEFAULT DESLIGADO. Config ausente, coluna ausente ou valor corrompido nunca podem
//      ligar a trava sozinhos — quem nunca pediu o recurso nao pode descobri-lo por um cliente
//      reclamando que nao consegue marcar;
//   2. a COMPARACAO. `usados >= max` bloqueia e `usados < max` passa. Um `>` no lugar do `>=`
//      deixa passar exatamente um agendamento a mais do que o dono configurou;
//   3. a FRONTEIRA DO DIA em hora LOCAL. `agendamentos.inicio` e hora de parede (UTC-3), entao
//      o dia de um agendamento das 22:00 do dia 31 vai ate 00:00 do dia 1 do mes seguinte.
//      Calcular em UTC cortaria o dia as 21:00 e a trava bloquearia o dia errado;
//   4. o SQL. Que a contagem nao usa CONVERT_TZ nem DATE(inicio)=CURDATE() (os dois deslocam o
//      dia em 3h), que trava as linhas com FOR UPDATE (sem isso dois cliques simultaneos passam
//      juntos) e que NAO herda a folga de expiracao do activeAppointmentStatusWhere;
//   5. o ESCOPO. A contagem e por estabelecimento E por cliente, e o remarcar nao conta a si
//      mesmo.
//
// Tudo logica pura: nenhum teste aqui abre conexao com o MySQL, entao rodam iguais no CI e na
// maquina do dev (o `db` das checagens transacionais e um objeto falso que so registra o SQL).
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const {
  LIMITE_DIARIO_MAX_PADRAO,
  LIMITE_DIARIO_MAX_TETO,
  buildContagemSql,
  checkLimiteDiarioClienteTx,
  decideLimiteDiario,
  diaLocalRange,
  mensagemLimiteDiario,
  normalizeLimiteDiarioConfig,
} = await import('../src/lib/limite_diario_cliente.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');

const localDate = (year, month, day, hour = 0, minute = 0) =>
  makeUtcFromLocalYMDHM(year, month, day, hour, minute, EST_TZ_OFFSET_MIN);

/** `db` falso: registra o SQL e devolve tantas linhas quantas o teste pedir. */
const fakeDb = (linhas = 0) => {
  const log = [];
  return {
    log,
    async query(sql, params) {
      log.push({ sql, params });
      if (/FROM establishment_settings/.test(sql)) return [[]];
      return [Array.from({ length: linhas }, (_, i) => ({ id: i + 1 }))];
    },
  };
};

// ─── 1. Default desligado ──────────────────────────────────────────────────────────────────

test('config ausente ou corrompida nasce DESLIGADA', () => {
  for (const row of [null, undefined, {}, { limite_diario_ativo: 'lixo' }, { limite_diario_max: 3 }]) {
    assert.equal(normalizeLimiteDiarioConfig(row).ativo, false, `row=${JSON.stringify(row)}`);
  }
});

test('desligada libera qualquer quantidade', () => {
  const config = normalizeLimiteDiarioConfig(null);
  for (const usados of [0, 1, 5, 99]) {
    assert.equal(decideLimiteDiario({ config, usados }).ok, true);
  }
});

test('max invalido cai no padrao, e o teto e respeitado', () => {
  assert.equal(normalizeLimiteDiarioConfig({ limite_diario_ativo: 1 }).max, LIMITE_DIARIO_MAX_PADRAO);
  assert.equal(normalizeLimiteDiarioConfig({ limite_diario_ativo: 1, limite_diario_max: 0 }).max, LIMITE_DIARIO_MAX_PADRAO);
  assert.equal(normalizeLimiteDiarioConfig({ limite_diario_ativo: 1, limite_diario_max: -3 }).max, LIMITE_DIARIO_MAX_PADRAO);
  assert.equal(
    normalizeLimiteDiarioConfig({ limite_diario_ativo: 1, limite_diario_max: 9999 }).max,
    LIMITE_DIARIO_MAX_TETO
  );
});

// ─── 2. A comparacao ───────────────────────────────────────────────────────────────────────

test('ligada com max=1 bloqueia o segundo', () => {
  const config = { ativo: true, max: 1 };
  assert.equal(decideLimiteDiario({ config, usados: 0 }).ok, true);
  assert.equal(decideLimiteDiario({ config, usados: 1 }).ok, false);
  assert.equal(decideLimiteDiario({ config, usados: 2 }).ok, false);
});

test('ligada com max=2 bloqueia o terceiro, nao o segundo', () => {
  const config = { ativo: true, max: 2 };
  assert.equal(decideLimiteDiario({ config, usados: 0 }).ok, true);
  assert.equal(decideLimiteDiario({ config, usados: 1 }).ok, true);
  assert.equal(decideLimiteDiario({ config, usados: 2 }).ok, false);
  assert.equal(decideLimiteDiario({ config, usados: 3 }).ok, false);
});

// ─── 3. A fronteira do dia, em hora LOCAL ──────────────────────────────────────────────────

test('o dia local de um agendamento as 22:00 vai da meia-noite a meia-noite', () => {
  const range = diaLocalRange(localDate(2026, 8, 31, 22, 0));
  assert.deepEqual(range, {
    inicioDia: '2026-08-31 00:00:00',
    fimDia: '2026-09-01 00:00:00',
  });
});

test('as 23:00 locais continuam no MESMO dia (o erro de UTC cortaria as 21:00)', () => {
  const cedo = diaLocalRange(localDate(2026, 8, 20, 0, 30));
  const tarde = diaLocalRange(localDate(2026, 8, 20, 23, 30));
  assert.equal(cedo.inicioDia, tarde.inicioDia);
  assert.equal(cedo.inicioDia, '2026-08-20 00:00:00');
});

test('a virada do ano nao quebra o range', () => {
  const range = diaLocalRange(localDate(2026, 12, 31, 20, 0));
  assert.equal(range.inicioDia, '2026-12-31 00:00:00');
  assert.equal(range.fimDia, '2027-01-01 00:00:00');
});

// ─── 4. O SQL da contagem ──────────────────────────────────────────────────────────────────

test('a contagem nao usa relogio de banco nem CONVERT_TZ', () => {
  const sql = buildContagemSql();
  assert.ok(!/CONVERT_TZ/i.test(sql), 'CONVERT_TZ desloca o dia em 3h');
  assert.ok(!/UTC_TIMESTAMP/i.test(sql), 'UTC_TIMESTAMP compara relogios diferentes');
  assert.ok(!/CURDATE|DATE\(inicio\)/i.test(sql), 'DATE(inicio)=CURDATE() usa o dia do servidor');
  assert.ok(/inicio >= \?/.test(sql) && /inicio < \?/.test(sql), 'faixa meio-aberta por parametro');
});

test('a contagem trava as linhas com FOR UPDATE', () => {
  assert.ok(/FOR UPDATE\s*$/.test(buildContagemSql().trim()));
});

test('a contagem NAO herda a folga de expiracao da capacidade', () => {
  const sql = buildContagemSql();
  // Um pendente_pagamento com hold vencido some da CAPACIDADE (o slot tem de liberar), mas
  // ainda pode virar confirmado por webhook atrasado — entao aqui ele conta.
  assert.ok(!/deposit_expires_at/i.test(sql));
  assert.ok(!/public_confirm_expires_at/i.test(sql));
  assert.ok(/status IN \('confirmado','pendente','pendente_pagamento','concluido'\)/.test(sql));
});

test('remarcar nao conta a si mesmo', () => {
  assert.ok(!/id <> \?/.test(buildContagemSql()));
  assert.ok(/id <> \?/.test(buildContagemSql({ excludeAppointmentId: 42 })));
});

// ─── 5. O guard transacional ───────────────────────────────────────────────────────────────

test('desligada nao chega a consultar agendamentos', async () => {
  const db = fakeDb(5);
  const r = await checkLimiteDiarioClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: localDate(2026, 8, 20, 16, 0),
    config: { ativo: false, max: 1 },
  });
  assert.equal(r.ok, true);
  assert.equal(db.log.length, 0, 'sem config ligada, nem SELECT deve sair');
});

test('a contagem e escopada a estabelecimento E cliente, no dia local', async () => {
  const db = fakeDb(0);
  await checkLimiteDiarioClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: localDate(2026, 8, 20, 16, 0),
    config: { ativo: true, max: 1 },
  });
  const { params } = db.log[0];
  assert.deepEqual(params, [194, 264, '2026-08-20 00:00:00', '2026-08-21 00:00:00']);
});

test('bloqueia quando o cliente ja tem o maximo naquele dia', async () => {
  const r = await checkLimiteDiarioClienteTx({
    db: fakeDb(1),
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: localDate(2026, 8, 20, 16, 30),
    config: { ativo: true, max: 1 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.usados, 1);
  assert.equal(r.max, 1);
  assert.equal(r.dia, '2026-08-20');
});

test('cliente sem id (fluxo anonimo) nunca e barrado', async () => {
  const db = fakeDb(9);
  const r = await checkLimiteDiarioClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: null,
    inicioDate: localDate(2026, 8, 20, 16, 0),
    config: { ativo: true, max: 1 },
  });
  assert.equal(r.ok, true);
  assert.equal(db.log.length, 0);
});

// ─── Mensagem ao cliente ───────────────────────────────────────────────────────────────────

test('a mensagem concorda em numero com o limite', () => {
  assert.match(mensagemLimiteDiario(1), /já tem um agendamento neste dia/);
  assert.match(mensagemLimiteDiario(2), /já tem 2 agendamentos neste dia/);
});
