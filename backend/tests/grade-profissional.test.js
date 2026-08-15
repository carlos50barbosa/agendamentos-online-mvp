// A GRADE por profissional: GET /slots passa a intersectar o horario proprio.
//
// Por que este arquivo existe: as Fases 1 (interseccao), 2 (enforcement nas 4 escritas) e 3
// (coluna + writer) ja fecham a GRAVACAO. A grade nao. Sem a Fase 4 a dona marca a folga da
// profissional, o POST recusa corretamente com 400 outside_business_hours, e a TELA continua
// oferecendo o horario — o cliente escolhe, clica e leva erro no fim do funil. E o mesmo
// desfecho cosmetico que os cabecalhos de agenda-bloqueios.test.js e de
// expediente-profissional-enforcement.test.js ja descrevem, agora do lado da leitura.
//
// OS DOIS PONTOS. slots.js resolve expediente DUAS vezes por dia do laco:
//   :306  o expediente do DIA               -> o arco visivel do proprio dia
//   :308  o expediente do dia ANTERIOR      -> o rabo pos-meia-noite de um turno que vira
// Intersectar so o :306 corrige a sexta e deixa o sabado de madrugada intacto, porque aquele
// rabo nasce da regra de SEXTA. MEDIDO: com salao 22:00-04:00 todo dia e a profissional de
// folga na sexta, a Fase 4 pela metade devolve sabado 00:00..03:30 identico a hoje.
//
// ASSINATURA DA CAUSA. Nesta rota, expediente e a UNICA coisa que APAGA o slot do array:
// bloqueio, capacidade, janela e passado so mudam o LABEL (slots.js:405-432), porque o laco so
// emite minutos que caem dentro de `intervals`, e `intervals` sai exclusivamente de
// expediente/prevExpediente (slots.js:309-359). Por isso os testes aqui asseram AUSENCIA, e o
// caso 7 prova que a ausencia nao tem outra causa possivel.

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';
// Viram CONSTANTE DE MODULO no load de slots.js (:16-21 e :25-30) e deslocam a borda do arco.
// Nenhum outro teste da grade pina isto; sem os dois, um buffer configurado na maquina de quem
// roda muda o resultado esperado de todos os deepEqual abaixo.
process.env.AGENDAMENTO_BUFFER_MIN = '0';
process.env.AGENDAMENTO_MIN_LEAD_MIN = '0';

const { pool } = await import('../src/lib/db.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');
const slotsRouter = (await import('../src/routes/slots.js')).default;

const ESTAB_ID = 77;
const SERVICO_ID = 10;
const PRO_A = 5;

// 2099-01-04 e DOMINGO — a plataforma inteira abre a semana no domingo
// (currentLocalWeekStart, slots.js:133-137). Semana FIXA e no futuro por dois motivos:
// slots.js:410 marca isPast tudo que ja comecou, e o expediente e resolvido por dayIndex
// (slots.js:305) — uma semana movel trocaria o dia da semana de cada fixture.
const WEEK_START = '2099-01-04';
const DIAS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DATA = {
  dom: { y: 2099, m: 1, d: 4 },
  seg: { y: 2099, m: 1, d: 5 },
  sex: { y: 2099, m: 1, d: 9 },
  sab: { y: 2099, m: 1, d: 10 },
};

// ---------------------------------------------------------------- fixtures de horario
// Dia AUSENTE do JSON = folga (buildWorkingRules -> enabled:false -> resolveExpedienteForDay
// devolve closed:true). E a mesma forma que o writer da Fase 3 grava para `{"day":"friday"}`.
const horariosDe = (mapa) =>
  JSON.stringify(
    DIAS.filter((d) => mapa[d]).map((d) => ({
      day: d,
      start: mapa[d][0],
      end: mapa[d][1],
      ...(mapa[d][2] ? { blocks: [{ start: mapa[d][2][0], end: mapa[d][2][1] }] } : {}),
    }))
  );
const semanaToda = (start, end, pausa) =>
  Object.fromEntries(DIAS.map((d) => [d, pausa ? [start, end, pausa] : [start, end]]));
const semSexta = (mapa) => Object.fromEntries(Object.entries(mapa).filter(([d]) => d !== 'friday'));

const SALAO_DIURNO = horariosDe(semanaToda('08:00', '18:00'));
const PROF_MANHA = horariosDe(semanaToda('08:00', '12:00'));
// Turno que VIRA A MEIA-NOITE nos sete dias: e o unico jeito de o ramo de slots.js:311-317
// (que exige startMinutes > endMinutes) disparar e o prevExpediente existir.
const SALAO_NOTURNO = horariosDe(semanaToda('22:00', '04:00'));
// Sai as 02:00 na sexta enquanto o salao vai ate as 04:00. Discriminador de TRES vias: separa
// "hoje/Fase 4 pela metade" (8 slots) de "indice trocado" (0) da Fase 4 completa (4).
const PROF_SEXTA_CURTA = horariosDe({ ...semanaToda('22:00', '04:00'), friday: ['22:00', '02:00'] });
const PROF_FOLGA_SEXTA = horariosDe(semSexta(semanaToda('22:00', '04:00')));

// ---------------------------------------------------------------- infra
const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// Mock ESTRITO: `throw` no SQL nao previsto, como installGridPoolMock de
// agenda-bloqueios.test.js:807. E o que impede uma causa NOVA de fechamento (uma query que
// alguem acrescente antes da montagem da grade) de virar `[]` silencioso e a grade fechar
// "sozinha" com o teste verde.
function installGridPoolMock({
  salao,
  profissional = null,
  blocks = [],
  appointments = [],
  janelaRow = null,
  capacity = 1,
  duracaoMin = 30,
} = {}) {
  const originalQuery = pool.query;
  const contadores = { horariosProfissional: 0, perfilEstabelecimento: 0 };
  pool.query = async (sql, params = []) => {
    const statement = normalizeSql(sql);
    if (/from\s+servicos/i.test(statement)) {
      return [[{ id: SERVICO_ID, duracao_min: duracaoMin, capacidade_por_horario: capacity }], []];
    }
    if (/from\s+agendamentos/i.test(statement)) {
      // O escopo por profissional e concatenado so quando ha profissional (slots.js:241-244),
      // e o parametro dele e sempre o ULTIMO.
      const escopo = /profissional_id IS NULL OR profissional_id=\?/i.test(statement)
        ? Number(params[params.length - 1])
        : null;
      return [
        appointments.filter((a) => escopo == null || a.profissional_id == null || Number(a.profissional_id) === escopo),
        [],
      ];
    }
    // Sem escopo por profissional no SQL: o filtro dos bloqueios e em JS (slots.js:285-289).
    if (/from\s+bloqueios/i.test(statement)) return [blocks, []];
    if (/from\s+estabelecimento_perfis/i.test(statement)) {
      contadores.perfilEstabelecimento += 1;
      return [[{ horarios_json: salao }], []];
    }
    if (/from\s+profissionais/i.test(statement) && /horarios_json/i.test(statement)) {
      contadores.horariosProfissional += 1;
      // O `AND estabelecimento_id=?` NAO e decoracao: e o isolamento de tenant do unico
      // parametro desta rota que vem cru da querystring. Se ele cair, um id de outro salao
      // passa a estreitar a grade deste — por isso o mock so responde quando ele esta la.
      assert.match(statement, /estabelecimento_id\s*=\s*\?/i, 'a query do horario do profissional precisa filtrar por estabelecimento_id');
      const [idPedido, estabPedido] = params;
      if (String(estabPedido) !== String(ESTAB_ID)) return [[], []];
      if (Number(idPedido) !== PRO_A) return [[], []];
      return [[{ horarios_json: profissional }], []];
    }
    // Linha ausente = modo 'livre' = sem horizonte (janela_agendamento.js:144).
    if (/from\s+establishment_settings/i.test(statement)) return [janelaRow ? [janelaRow] : [], []];
    throw new Error(`SQL inesperado no teste da grade por profissional: ${statement}`);
  };
  return { contadores, restore() { pool.query = originalQuery; } };
}

async function startSlotsServer() {
  const app = express();
  app.use('/slots', slotsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))); },
  };
}

async function comGrade(fixture, fn) {
  const mock = installGridPoolMock(fixture);
  const server = await startSlotsServer();
  try {
    const grade = async (professionalId, { raw } = {}) => {
      const params = new URLSearchParams({
        establishmentId: String(ESTAB_ID),
        weekStart: WEEK_START,
        servico_id: String(SERVICO_ID),
      });
      if (raw !== undefined) params.set('profissional_id', raw);
      else if (professionalId != null) params.set('profissional_id', String(professionalId));
      const response = await fetch(`${server.baseUrl}/slots?${params}`);
      const payload = await response.json();
      if (response.status === 200) {
        // Se a janela clampar por acidente, o sintoma e identico ao do expediente. Asserir aqui
        // faz o teste acusar a JANELA em vez de culpar o expediente. (janela-agendamento.test.js:229-232)
        assert.equal(payload.janela?.modo, 'livre');
        assert.equal(payload.janela?.limite, null);
      }
      return { status: response.status, payload };
    };
    await fn({ grade, contadores: mock.contadores });
  } finally {
    await server.close();
    mock.restore();
  }
}

const instante = ({ y, m, d }, hh, mm) => makeUtcFromLocalYMDHM(y, m, d, hh, mm, EST_TZ_OFFSET_MIN);
const slotEm = (payload, date) => payload.slots.find((s) => s.datetime === date.toISOString());

// 'HH:MM' LOCAIS e livres de um dia de calendario. Lista, nao contagem: o que a Fase 4 muda e
// a FORMA do arco, e so a borda exata distingue "estreitou certo" de "estreitou errado".
function livresDoDia(payload, { y, m, d }) {
  return payload.slots
    .filter((s) => s.status === 'free')
    .map((s) => new Date(new Date(s.datetime).getTime() + EST_TZ_OFFSET_MIN * 60_000))
    .filter((l) => l.getUTCFullYear() === y && l.getUTCMonth() + 1 === m && l.getUTCDate() === d)
    .map((l) => `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`)
    .sort();
}
const madrugada = (horas) => horas.filter((h) => h < '08:00');

// =======================================================================================
// 1) O arco do dia
// =======================================================================================
test('grade filtrada: o horario proprio da profissional estreita o arco do dia', async () => {
  await comGrade({ salao: SALAO_DIURNO, profissional: PROF_MANHA }, async ({ grade, contadores }) => {
    const { payload } = await grade(PRO_A);
    assert.deepEqual(
      livresDoDia(payload, DATA.seg),
      ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30']
    );
    // CONTROLE POSITIVO NA MESMA REQUISICAO: bloqueio, janela e antecedencia sao cegos ao
    // horario-do-dia; qualquer um deles derrubaria as 10:00 junto com as 14:00.
    assert.equal(slotEm(payload, instante(DATA.seg, 10, 0)).status, 'free');
    assert.equal(slotEm(payload, instante(DATA.seg, 14, 0)), undefined);
    // Sem esta leitura o slot nao pode ter sumido por horario proprio.
    assert.equal(contadores.horariosProfissional, 1);
  });
});

// =======================================================================================
// 2) O rabo pos-meia-noite  (slots.js:308) — o discriminador de tres vias
// =======================================================================================
test('grade filtrada: o rabo pos-meia-noite de sexta tambem e estreitado no sabado', async () => {
  await comGrade({ salao: SALAO_NOTURNO, profissional: PROF_SEXTA_CURTA }, async ({ grade }) => {
    const { payload } = await grade(PRO_A);
    // Ela entra as 22:00 de sexta e sai as 02:00 de sabado. O salao so fecha as 04:00.
    assert.deepEqual(madrugada(livresDoDia(payload, DATA.sab)), ['00:00', '00:30', '01:00', '01:30']);
    // A noite de sexta dela continua inteira: o teste nao pode passar por ter fechado tudo.
    assert.deepEqual(
      livresDoDia(payload, DATA.sex).filter((h) => h >= '22:00'),
      ['22:00', '22:30', '23:00', '23:30']
    );
  });
});

// =======================================================================================
// 3) A folga — o caso literal do brief
// =======================================================================================
test('grade filtrada: folga na sexta nao deixa slot de madrugada no sabado', async () => {
  await comGrade({ salao: SALAO_NOTURNO, profissional: PROF_FOLGA_SEXTA }, async ({ grade }) => {
    const { payload } = await grade(PRO_A);
    assert.deepEqual(madrugada(livresDoDia(payload, DATA.sab)), []);
    // A sexta dela some da noite (nao trabalha) mas a madrugada de sexta e o rabo de QUINTA,
    // dia em que ela trabalha: continua la. E o contrafactual que separa "estreitou" de "apagou".
    assert.deepEqual(livresDoDia(payload, DATA.sex).filter((h) => h >= '22:00'), []);
    assert.deepEqual(
      madrugada(livresDoDia(payload, DATA.sex)),
      ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30']
    );
    // E o sabado a noite dela, que ela trabalha, fica inteiro.
    assert.deepEqual(livresDoDia(payload, DATA.sab), ['22:00', '22:30', '23:00', '23:30']);
  });
});

// =======================================================================================
// 4) A visao "qualquer profissional" — VERDE HOJE, TEM DE CONTINUAR VERDE
// =======================================================================================
test('visao "qualquer profissional": a grade nao muda e a coluna nem e lida', async () => {
  // Precedente do proprio arquivo, slots.js:281-284: na visao nao filtrada so os bloqueios do
  // estabelecimento inteiro valem, "senao a ausencia de uma manicure fecharia a agenda do salao
  // todo". Horario proprio e a mesma classe de fato — e sem nem precisar de linha em bloqueios.
  await comGrade({ salao: SALAO_NOTURNO, profissional: PROF_FOLGA_SEXTA }, async ({ grade, contadores }) => {
    const { payload } = await grade(null);
    assert.deepEqual(
      madrugada(livresDoDia(payload, DATA.sab)),
      ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30']
    );
    assert.deepEqual(livresDoDia(payload, DATA.sex).filter((h) => h >= '22:00'), ['22:00', '22:30', '23:00', '23:30']);
    assert.equal(contadores.horariosProfissional, 0, 'sem profissional_id a query nova nem deve ser disparada');
  });
});

// =======================================================================================
// 5) horarios_json NULL — o dia do deploy
// =======================================================================================
test('horarios_json NULL herda o salao: grade identica com e sem profissional_id', async () => {
  // A coluna da Fase 3 sobe 100% NULL. Se a Fase 4 passar resolveExpedienteForDay(null, dia)
  // adiante, o valor NAO e "sem regra" e sim a janela FABRICADA 07:00-22:00 (expediente.js:252-263).
  // intersectExpediente hoje se defende disso pelo `prof.source === 'fallback'` (expediente.js:375),
  // entao este caso e REGRESSAO daquela defesa, nao deteccao do deslize — escreva a chamada como
  // `profRules ? resolveExpedienteForDay(profRules, di) : null` mesmo assim (espelho de expediente.js:530).
  await comGrade({ salao: horariosDe(semanaToda('08:00', '18:00', ['12:00', '13:00'])), profissional: null }, async ({ grade }) => {
    const semProf = await grade(null);
    const comProf = await grade(PRO_A);
    assert.deepEqual(comProf.payload.slots, semProf.payload.slots);
    assert.deepEqual(
      livresDoDia(comProf.payload, DATA.seg),
      ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
       '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
    );
  });
});

// =======================================================================================
// 6) Invariante anti-"fechou tudo" — VERDE HOJE E DEPOIS
// =======================================================================================
test('INVARIANTE: a manha da profissional nunca some, em nenhum dia', async () => {
  // Por SUBCONJUNTO de proposito. E verdade hoje (a grade devolve o dia inteiro) e depois da
  // Fase 4 (devolve so a manha), entao o unico jeito de quebra-la e FECHAR DEMAIS. Uma igualdade
  // aqui repetiria o caso 1 e ficaria vermelha pelo motivo oposto, deixando a base sem nenhuma
  // guarda VIVA contra fechamento indevido durante o desenvolvimento.
  await comGrade({ salao: SALAO_DIURNO, profissional: PROF_MANHA }, async ({ grade }) => {
    const { payload } = await grade(PRO_A);
    const manha = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
    for (const dia of [DATA.dom, DATA.seg, DATA.sex, DATA.sab]) {
      const livres = new Set(livresDoDia(payload, dia));
      for (const hora of manha) {
        assert.ok(livres.has(hora), `${hora} sumiu de ${dia.d}/${dia.m} — a grade fechou demais`);
      }
    }
  });
});

// =======================================================================================
// 7) A ASSINATURA DA CAUSA — VERDE HOJE E DEPOIS
// =======================================================================================
test('ASSINATURA: so o expediente APAGA o slot; bloqueio e ocupacao so mudam o label', async () => {
  const dez = instante(DATA.seg, 10, 0);
  await comGrade({
    salao: SALAO_DIURNO,
    profissional: PROF_MANHA,
    blocks: [{ inicio: instante(DATA.seg, 9, 0), fim: instante(DATA.seg, 9, 30), profissional_id: null }],
    appointments: [{ servico_id: SERVICO_ID, profissional_id: PRO_A, inicio: dez, fim: instante(DATA.seg, 10, 30) }],
  }, async ({ grade }) => {
    const { payload } = await grade(PRO_A);
    const bloqueado = slotEm(payload, instante(DATA.seg, 9, 0));
    assert.equal(bloqueado.status, 'unavailable');
    assert.equal(bloqueado.label, 'bloqueado');
    const ocupado = slotEm(payload, dez);
    assert.equal(ocupado.status, 'booked');
    assert.equal(ocupado.label, 'agendado');
    // Fora do expediente NAO tem rotulo: o slot simplesmente nao vem. Uso o horario do SALAO
    // (20:00, fora de 08-18) e nao o da profissional, para este caso ficar VERDE tambem antes
    // da Fase 4 — a asseracao aqui e sobre o MECANISMO da rota, nao sobre a feature.
    assert.equal(slotEm(payload, instante(DATA.seg, 20, 0)), undefined);
  });
});

// =======================================================================================
// 8) O CUSTO — a leitura e UMA por request, fora do laco
// =======================================================================================
test('CUSTO: o horario do profissional e lido UMA vez por request, nao por dia', async () => {
  // Resolver dentro do laco dos 7 dias daria 7 (ou 14, se cada ponto reler). E a rota publica
  // mais quente do sistema: o wizard pede a semana inteira a cada dia clicado
  // (BookingPublic.jsx:162-166).
  await comGrade({ salao: SALAO_DIURNO, profissional: PROF_MANHA }, async ({ grade, contadores }) => {
    await grade(PRO_A);
    assert.equal(contadores.horariosProfissional, 1);
    assert.equal(contadores.perfilEstabelecimento, 1);
  });
});

// =======================================================================================
// 9) profissional_id nao-inteiro
// =======================================================================================
test('profissional_id nao-inteiro devolve 400, nunca 200 com a grade do salao', async () => {
  // extractProfessionalId (slots.js:116-126) so exige Number.isFinite && > 0. Hoje 3.5 e
  // inofensivo (o valor so entra em comparacoes de escopo que nao casam). Com a Fase 4 ele vira
  // parametro de uma query que nao casa linha nenhuma, e a grade devolve 200 com o salao INTEIRO
  // — a tela mostra horario de todo mundo enquanto o POST responde 400 profissional_invalido
  // (agendamentos_public.js:789-791). Fecha com Number.isInteger no :125.
  await comGrade({ salao: SALAO_DIURNO, profissional: PROF_MANHA }, async ({ grade }) => {
    for (const torto of ['3.5', '0.5', '10.000001']) {
      const { status, payload } = await grade(null, { raw: torto });
      assert.equal(status, 400, `?profissional_id=${torto} deveria ser 400`);
      assert.equal(payload.error, 'profissional_invalido');
    }
    // `1e1` NAO entra na lista: Number('1e1') === 10 e um inteiro de verdade, e e o valor
    // inteiro que vai para a query. Notacao nao e o problema; nao-inteiro e.
    for (const bom of [String(PRO_A), '1e1']) {
      const { status } = await grade(null, { raw: bom });
      assert.equal(status, 200, `?profissional_id=${bom} deveria ser 200`);
    }
  });
});

// =======================================================================================
// 10) GUARDA ESTATICA — os dois pontos saem da mesma funcao
// =======================================================================================
test('GUARDA: o expediente do dia e o do dia ANTERIOR saem da mesma expressao', async () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(aqui, '../src/routes/slots.js'), 'utf8');
  assert.match(source, /intersectExpediente/, 'GET /slots nao intersecta o horario do profissional em lugar nenhum');

  // NAO conta ocorrencias: a implementacao natural chama resolveExpedienteForDay duas vezes
  // (salao e profissional) para UMA interseccao, e um contador pareado reprovaria o codigo certo.
  // Compara o PRODUTOR de cada um dos dois expedientes.
  const produtorDe = (nome) =>
    source.match(new RegExp(`const ${nome}\\s*=\\s*(?:await\\s+)?([A-Za-z_$][\\w$]*)\\s*[([]`))?.[1] ?? null;
  const doDia = produtorDe('expediente');
  const doAnterior = produtorDe('prevExpediente');
  assert.ok(doDia && doAnterior, 'nao achei as duas atribuicoes em slots.js');
  assert.equal(
    doAnterior,
    doDia,
    'o rabo pos-meia-noite (prevExpediente) precisa sair da MESMA fonte que o expediente do dia — ' +
      'intersectar so um dos dois deixa a folga de sexta vendendo a madrugada de sabado'
  );
});

// =======================================================================================
// 11) LIMITACAO CONHECIDA — nao e o comportamento desejado, e o comportamento MEDIDO
// =======================================================================================
test('LIMITACAO CONHECIDA: arco do profissional inteiro na madrugada e RELOCADO de dia', async () => {
  // intersectExpediente projeta de volta com wall() (expediente.js:473-474) e PERDE o "dia
  // seguinte". Salao fechado no domingo e 22:00-04:00 de segunda a sabado; profissional so na
  // segunda 01:00-03:00 (que, pelo docblock de expediente.js:336-341, significa TERCA de
  // madrugada). O efetivo sai 01:00-03:00 NAO-overnight, o ramo de slots.js:311-317 nao dispara,
  // e a grade emite SEGUNDA 01:00-02:30 — horario em que o salao esta FECHADO — perdendo a terca.
  // O enforcement da Fase 2 aceita os mesmos instantes, entao grade e POST concordam, os dois
  // errados. A causa e da Fase 1; a Fase 4 e onde vira horario clicavel. Se este teste ficar
  // VERMELHO, alguem consertou expediente.js — apague o teste e comemore.
  const salao = horariosDe(semSexta({ ...semanaToda('22:00', '04:00'), sunday: undefined, friday: ['22:00', '04:00'] }));
  await comGrade({ salao, profissional: horariosDe({ monday: ['01:00', '03:00'] }) }, async ({ grade }) => {
    const { payload } = await grade(PRO_A);
    assert.deepEqual(livresDoDia(payload, DATA.seg), ['01:00', '01:30', '02:00', '02:30']);
  });
});
