// Duas regras sobre a agenda do mesmo cliente: mesmo servico no mesmo dia, e sobreposicao.
//
// Por que este arquivo existe: as duas descrevem impossibilidade fisica (ninguem faz o mesmo
// servico duas vezes no mesmo dia por acidente, e ninguem esta em duas cadeiras ao mesmo tempo),
// entao valem SEMPRE nos caminhos do cliente. Uma regra sempre ligada que erra por um sinal de
// comparacao trava agenda boa — o custo de errar aqui e maior que o de uma opcao desligada.
//
// O que estes testes seguram:
//   1. ENCOSTAR NAO E CRUZAR. 10:00-11:00 e 11:00-12:00 tem de PASSAR. Um `<=` no lugar do `<`
//      transformaria toda agenda sequencial (que e o caso normal de um salao) em agenda travada;
//   2. os quatro formatos de cruzamento: parcial pela frente, parcial por tras, contido e
//      englobante;
//   3. a REGRA A le os ITENS, nao a coluna `agendamentos.servico_id` — que guarda so o PRIMEIRO
//      servico do pedido e por isso enxerga menos do que existe num combo;
//   4. a leitura dos itens NAO trava. Travar (medido em MySQL 8.4) pega o gap ate o fim do
//      indice e faz o INSERT de itens de QUALQUER estabelecimento esperar ate 50s. A frescura
//      vem da ordem das leituras, e o servico primario entra sempre como rede;
//   5. o diferencial do remarcar: recusa o cruzamento NOVO, permite mover um par que ja nascia
//      sobreposto (a agenda de hoje tem esses pares, produzidos pela capacidade que so olha
//      profissional).
//
// Tudo logica pura: o `db` e um objeto falso que registra SQL e devolve o que o teste mandar.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const {
  ERRO_SERVICO_REPETIDO,
  ERRO_SOBREPOSICAO,
  buildAgendamentosDoDiaSql,
  buildItensSql,
  buildSobreposicaoSql,
  checkServicoRepetidoNoDiaTx,
  checkSobreposicaoClienteTx,
  checkSobreposicaoNoRemarcarTx,
  intervalosSeCruzam,
  normalizeRegrasClienteConfig,
} = await import('../src/lib/conflito_cliente.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');

const local = (y, m, d, h = 0, min = 0) =>
  makeUtcFromLocalYMDHM(y, m, d, h, min, EST_TZ_OFFSET_MIN);

/**
 * `db` falso. `respostas` e uma lista consumida em ordem, uma por query — assim o teste controla
 * o que a etapa 1 e a etapa 2 devolvem separadamente.
 */
const fakeDb = (respostas = []) => {
  const log = [];
  const fila = [...respostas];
  return {
    log,
    async query(sql, params) {
      // A leitura da config nao entra na fila nem no log: ela e' respondida VAZIA de proposito,
      // para os testes exercitarem o padrao (sem linha em establishment_settings = a REGRA A
      // vale). Quem quiser testar a chave ligada passa `config` direto no guard.
      if (/FROM establishment_settings/i.test(sql)) return [[]];
      log.push({ sql, params });
      return [fila.shift() ?? []];
    },
  };
};

// ─── 1 e 2. A aritmetica do intervalo ──────────────────────────────────────────────────────

test('encostar NAO e cruzar, dos dois lados', () => {
  const a = [local(2026, 8, 20, 10), local(2026, 8, 20, 11)];
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 11), local(2026, 8, 20, 12)), false);
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 9), local(2026, 8, 20, 10)), false);
});

test('um minuto de cruzamento ja e cruzamento', () => {
  const a = [local(2026, 8, 20, 10), local(2026, 8, 20, 11)];
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 10, 59), local(2026, 8, 20, 12)), true);
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 9), local(2026, 8, 20, 10, 1)), true);
});

test('contido e englobante contam como cruzamento', () => {
  const a = [local(2026, 8, 20, 10), local(2026, 8, 20, 12)];
  // contido
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 10, 30), local(2026, 8, 20, 11)), true);
  // englobante
  assert.equal(intervalosSeCruzam(...a, local(2026, 8, 20, 9), local(2026, 8, 20, 13)), true);
  // identico
  assert.equal(intervalosSeCruzam(...a, ...a), true);
});

test('data invalida nunca vira cruzamento', () => {
  assert.equal(intervalosSeCruzam('lixo', 'lixo', local(2026, 8, 20, 10), local(2026, 8, 20, 11)), false);
});

test('o SQL de sobreposicao usa os dois sinais ESTRITOS', () => {
  const sql = buildSobreposicaoSql();
  assert.ok(/inicio < \?/.test(sql), 'inicio tem de ser < fimNovo, nao <=');
  assert.ok(/fim > \?/.test(sql), 'fim tem de ser > inicioNovo, nao >=');
  assert.ok(!/<=|>=/.test(sql), 'nenhum sinal frouxo: encostar viraria conflito');
  assert.ok(/FOR UPDATE\s*$/.test(sql.trim()));
});

test('o SQL de sobreposicao nao tem piso de tempo inventado', () => {
  // Um piso do tipo `inicio >= novoInicio - 1 DAY` so seria seguro se nenhum agendamento
  // pudesse durar mais de 24h — e o sistema nao garante isso.
  assert.ok(!/INTERVAL/i.test(buildSobreposicaoSql()));
});

// ─── 3 e 4. A REGRA A le os itens, com lock ────────────────────────────────────────────────

test('a leitura dos itens NAO trava — travar bloqueia a base inteira', () => {
  const sql = buildItensSql(2);
  // Medido em MySQL 8.4: `IN (...)` sobre um indice nao-unico pega next-key lock, e o gap depois
  // do ultimo id vai ate o fim do indice — onde cai o INSERT de itens de todo agendamento novo,
  // de qualquer estabelecimento. A frescura vem da ordem das leituras, nao do lock.
  assert.ok(!/LOCK IN SHARE MODE/i.test(sql));
  assert.ok(!/FOR SHARE/i.test(sql));
  assert.ok(!/FOR UPDATE/i.test(sql));
  assert.ok(/agendamento_id IN \(\?,\?\)/.test(sql));
});

test('o servico PRIMARIO conta sempre, mesmo com itens visiveis', async () => {
  // Rede de seguranca para quando a leitura de itens vier de um read view mais velho: o
  // servico_id da coluna e sempre um dos servicos do agendamento, entao inclui-lo nao cria falso
  // positivo e cobre o combo concorrente cujos itens ainda nao aparecem.
  const db = fakeDb([
    [{ id: 502, servico_id: 7 }],
    [{ agendamento_id: 502, servico_id: 9 }], // itens sem o 7
  ]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
  });
  assert.equal(r.ok, false, 'o primario 7 tem de ser detectado mesmo fora dos itens lidos');
});

test('a etapa 1 trava a faixa do dia', () => {
  const sql = buildAgendamentosDoDiaSql();
  assert.ok(/FOR UPDATE\s*$/.test(sql.trim()));
  assert.ok(/inicio >= \?/.test(sql) && /inicio < \?/.test(sql));
  // Ancorado so em `inicio`: um agendamento 23:00->01:00 pertence ao dia em que comecou.
  assert.ok(!/fim >=|fim </.test(sql));
});

test('o servico repetido e detectado pelos ITENS, nao pela coluna primaria', async () => {
  // O agendamento 500 tem servico_id=7 (o primario) mas os itens dizem [7, 9].
  // Pedir o 9 tem de dar conflito, mesmo o 9 nao estando na coluna.
  const db = fakeDb([
    [{ id: 500, servico_id: 7 }],
    [{ agendamento_id: 500, servico_id: 7 }, { agendamento_id: 500, servico_id: 9 }],
  ]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [9],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.servicosEmConflito, [9]);
  assert.equal(r.agendamentoId, 500);
});

test('servico diferente no mesmo dia passa', async () => {
  const db = fakeDb([
    [{ id: 500, servico_id: 7 }],
    [{ agendamento_id: 500, servico_id: 7 }],
  ]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [9],
  });
  assert.equal(r.ok, true);
});

test('linha SEM item nenhum cai no fallback da coluna', async () => {
  const db = fakeDb([[{ id: 501, servico_id: 7 }], []]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
  });
  assert.equal(r.ok, false);
});

test('dia vazio nem consulta os itens', async () => {
  const db = fakeDb([[]]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
  });
  assert.equal(r.ok, true);
  assert.equal(db.log.length, 1, 'sem linhas no dia, a etapa 2 nao deve rodar');
});

test('a etapa 1 e escopada a estabelecimento, cliente e dia local', async () => {
  const db = fakeDb([[], []]);
  await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
  });
  assert.deepEqual(db.log[0].params, [194, 264, '2026-08-20 00:00:00', '2026-08-21 00:00:00']);
});

test('sem servicos pedidos, a regra nao roda', async () => {
  const db = fakeDb([[{ id: 1, servico_id: 1 }]]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [],
  });
  assert.equal(r.ok, true);
  assert.equal(db.log.length, 0);
});

// ─── A REGRA B na criacao ──────────────────────────────────────────────────────────────────

test('criacao: qualquer cruzamento recusa', async () => {
  const db = fakeDb([[{ id: 700, inicio: '2026-08-20 10:00:00', fim: '2026-08-20 11:00:00' }]]);
  const r = await checkSobreposicaoClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 10, 30),
    fimDate: local(2026, 8, 20, 11, 30),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflitos, [700]);
});

test('criacao: os limites vao como hora de parede, na ordem fim/inicio', async () => {
  const db = fakeDb([[]]);
  await checkSobreposicaoClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 10, 0),
    fimDate: local(2026, 8, 20, 11, 0),
  });
  // A ordem importa: o SQL e `inicio < ?fim AND fim > ?inicio`.
  assert.deepEqual(db.log[0].params, [194, 264, '2026-08-20 11:00:00', '2026-08-20 10:00:00']);
});

// ─── 5. O diferencial do remarcar ──────────────────────────────────────────────────────────

test('remarcar: mover um par que JA nascia sobreposto continua permitido', async () => {
  // Antes cruzava o 800; depois continua cruzando so' o 800. Nada novo -> passa.
  const db = fakeDb([
    [{ id: 800, inicio: '2026-08-20 10:00:00', fim: '2026-08-20 11:00:00' }],
    [{ id: 800, inicio: '2026-08-20 10:00:00', fim: '2026-08-20 11:00:00' }],
  ]);
  const r = await checkSobreposicaoNoRemarcarTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioAtual: local(2026, 8, 20, 10, 15),
    fimAtual: local(2026, 8, 20, 11, 15),
    inicioNovo: local(2026, 8, 20, 10, 30),
    fimNovo: local(2026, 8, 20, 11, 30),
    excludeAppointmentId: 999,
  });
  assert.equal(r.ok, true);
});

test('remarcar: arrastar por cima de um agendamento NOVO recusa', async () => {
  const db = fakeDb([
    [], // antes nao cruzava ninguem
    [{ id: 801, inicio: '2026-08-20 14:00:00', fim: '2026-08-20 15:00:00' }],
  ]);
  const r = await checkSobreposicaoNoRemarcarTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioAtual: local(2026, 8, 20, 9),
    fimAtual: local(2026, 8, 20, 10),
    inicioNovo: local(2026, 8, 20, 14, 30),
    fimNovo: local(2026, 8, 20, 15, 30),
    excludeAppointmentId: 999,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflitos, [801]);
});

test('remarcar: o proprio agendamento nunca conta contra si mesmo', async () => {
  const db = fakeDb([[], []]);
  await checkSobreposicaoNoRemarcarTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioAtual: local(2026, 8, 20, 9),
    fimAtual: local(2026, 8, 20, 10),
    inicioNovo: local(2026, 8, 20, 14),
    fimNovo: local(2026, 8, 20, 15),
    excludeAppointmentId: 999,
  });
  for (const chamada of db.log) {
    assert.ok(/id <> \?/.test(chamada.sql));
    assert.equal(chamada.params[chamada.params.length - 1], 999);
  }
});

// ─── A chave da REGRA A ────────────────────────────────────────────────────────────────────

test('sem config, a REGRA A VALE — dado desconhecido nao desliga protecao', () => {
  // Oposto do criterio da trava diaria de proposito: la o desconhecido nao pode LIGAR uma trava
  // que ninguem pediu; aqui nao pode DESLIGAR uma que ninguem abriu mao.
  for (const row of [null, undefined, {}, { permite_servico_repetido_dia: 'lixo' }, { permite_servico_repetido_dia: 0 }]) {
    assert.equal(normalizeRegrasClienteConfig(row).permiteServicoRepetido, false, `row=${JSON.stringify(row)}`);
  }
  assert.equal(normalizeRegrasClienteConfig({ permite_servico_repetido_dia: 1 }).permiteServicoRepetido, true);
});

test('com a chave ligada, a REGRA A nem consulta o banco', async () => {
  const db = fakeDb([[{ id: 500, servico_id: 7 }], [{ agendamento_id: 500, servico_id: 7 }]]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
    config: { permiteServicoRepetido: true },
  });
  assert.equal(r.ok, true);
  assert.equal(db.log.length, 0, 'liberado significa nem perguntar');
});

test('com a chave desligada, a REGRA A continua barrando', async () => {
  const db = fakeDb([[{ id: 500, servico_id: 7 }], [{ agendamento_id: 500, servico_id: 7 }]]);
  const r = await checkServicoRepetidoNoDiaTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 16),
    serviceIds: [7],
    config: { permiteServicoRepetido: false },
  });
  assert.equal(r.ok, false);
});

test('a chave NAO afeta a sobreposicao — ela nao tem chave', async () => {
  const db = fakeDb([[{ id: 700, inicio: '2026-08-20 10:00:00', fim: '2026-08-20 11:00:00' }]]);
  const r = await checkSobreposicaoClienteTx({
    db,
    estabelecimentoId: 194,
    clienteId: 264,
    inicioDate: local(2026, 8, 20, 10, 30),
    fimDate: local(2026, 8, 20, 11, 30),
    config: { permiteServicoRepetido: true },
  });
  assert.equal(r.ok, false, 'liberar servico repetido nao pode liberar horario impossivel');
});

// ─── Codigos de erro ───────────────────────────────────────────────────────────────────────

test('os codigos de erro sao estaveis (o bot e o front dependem deles)', () => {
  assert.equal(ERRO_SERVICO_REPETIDO, 'servico_repetido_no_dia');
  assert.equal(ERRO_SOBREPOSICAO, 'sobreposicao_cliente');
});
