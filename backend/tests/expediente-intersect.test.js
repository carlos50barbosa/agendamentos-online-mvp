// Horario por profissional: a INTERSECAO com o expediente do estabelecimento.
//
// Por que este arquivo existe: ate aqui expediente.js — 360 linhas de aritmetica de horario,
// que decide se um agendamento entra ou nao — nao tinha NENHUM teste. Um grep por
// getExpediente|resolveExpedienteForDay|buildWorkingRules|assertDentroExpediente em tests/
// dava zero. Toda invariante que os consumidores presumem podia ser violada sem que a suite
// acusasse nada.
//
// A direcao perigosa do erro aqui e UMA SO: permitir agendamento num horario em que a
// profissional NAO atende. Fechar demais e chato; abrir demais e cliente marcado com quem esta
// de folga. Os casos marcados AGENDA ABERTA sao os inegociaveis — cada um deles falha em cima
// de uma implementacao ingenua que "parece certa".
//
// O que estes testes seguram:
//   1. interseccao vazia NUNCA vira janela invertida. `startMinutes > endMinutes` ja significa
//      "vira a meia-noite" em todo o resto do codigo, entao max(start)/min(end) transforma
//      "ninguem trabalha" num turno de 23 horas que o enforcement ACEITA;
//   2. o horario proprio so ESTREITA, nunca amplia;
//   3. os dois pares de campos (abre/fecha strings e startMinutes/endMinutes numeros) saem
//      sempre consistentes — o enforcement le so as strings, a grade le so os numeros, e
//      divergencia entre eles e tela escondendo horario que o POST aceita;
//   4. `closed:true` vem com todos os campos de horario nulos. A flag sozinha nao protege nada:
//      assertDentroExpediente nem desestrutura `closed`, quem barra e toMin(null);
//   5. breaks CLIPADOS, nem crus nem filtrados — as duas alternativas abrem agenda, em
//      direcoes opostas;
//   6. profissional sem regra devolve o expediente do salao intacto, inclusive quando o JSON
//      esta torto. buildWorkingRules devolve null em seis situacoes diferentes e todas viram a
//      janela FABRICADA 07:00-22:00 — que, tratada como regra do profissional, estreitaria a
//      agenda de todo mundo no dia do deploy.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const {
  assertDentroExpediente,
  fmtMin,
  getExpediente,
  intersectExpediente,
  toMin,
} = await import('../src/lib/expediente.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM, weekDayIndexInTZ } = await import(
  '../src/lib/datetime_tz.js'
);

const DAY_MINUTES = 1440;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Expediente resolvido, no formato que resolveExpedienteForDay devolve.
const aberto = (abre, fecha, breaks = [], source = 'profile') => ({
  abre,
  fecha,
  startMinutes: toMin(abre),
  endMinutes: toMin(fecha),
  breaks,
  closed: false,
  source,
});

const fechado = (source = 'profile') => ({
  abre: null,
  fecha: null,
  startMinutes: null,
  endMinutes: null,
  breaks: [],
  closed: true,
  source,
});

// Roda em TODO resultado. E aqui que as invariantes de shape sao cobradas: se uma delas quebrar,
// quebra em cima do caso que a produziu, e nao num teste generico distante.
const assertContrato = (res, rotulo) => {
  assert.ok(res && typeof res === 'object', `${rotulo}: resultado precisa ser objeto`);
  assert.ok(Array.isArray(res.breaks), `${rotulo}: breaks precisa ser Array (nunca null)`);

  for (const tupla of res.breaks) {
    assert.ok(Array.isArray(tupla) && tupla.length === 2, `${rotulo}: break precisa ser [n,n]`);
    const [ini, fim] = tupla;
    assert.ok(Number.isInteger(ini) && Number.isInteger(fim), `${rotulo}: break com nao-inteiro`);
    assert.ok(ini < fim, `${rotulo}: break degenerado/invertido ${JSON.stringify(tupla)}`);
    assert.ok(ini >= 0 && fim <= DAY_MINUTES, `${rotulo}: break fora de [0,1440]`);
    // I7: os dois consumidores classificam break por `inicio < startMinutes` para decidir se ele
    // e da madrugada. Tupla atravessando a meia-noite quebra essa classificacao nos dois.
    assert.ok(ini <= fim, `${rotulo}: break atravessa a meia-noite`);
  }

  if (res.closed === true) {
    assert.equal(res.abre, null, `${rotulo}: closed exige abre null`);
    assert.equal(res.fecha, null, `${rotulo}: closed exige fecha null`);
    assert.equal(res.startMinutes, null, `${rotulo}: closed exige startMinutes null`);
    assert.equal(res.endMinutes, null, `${rotulo}: closed exige endMinutes null`);
    assert.deepEqual(res.breaks, [], `${rotulo}: closed exige breaks vazio`);
    return;
  }

  assert.ok(Number.isInteger(res.startMinutes), `${rotulo}: startMinutes precisa ser inteiro`);
  assert.ok(Number.isInteger(res.endMinutes), `${rotulo}: endMinutes precisa ser inteiro`);
  assert.ok(res.startMinutes >= 0 && res.startMinutes < DAY_MINUTES, `${rotulo}: startMinutes fora de [0,1439]`);
  // I4: meia-noite e 0, nunca 1440. toMin recusa hora 24, entao nenhum outro produtor do repo
  // emite 1440 — esta funcao nao pode ser a primeira.
  assert.ok(res.endMinutes >= 0 && res.endMinutes < DAY_MINUTES, `${rotulo}: endMinutes fora de [0,1439]`);
  // I3: abre === fecha faz assertDentroExpediente recusar TUDO e a grade nao emitir nada, com a
  // mensagem mentindo o horario.
  assert.notEqual(res.startMinutes, res.endMinutes, `${rotulo}: janela de largura zero`);
  // I1: os dois pares tem de sair do MESMO calculo.
  assert.equal(res.abre, fmtMin(res.startMinutes), `${rotulo}: abre divergiu de startMinutes`);
  assert.equal(res.fecha, fmtMin(res.endMinutes), `${rotulo}: fecha divergiu de endMinutes`);
};

const intersect = (estab, prof, rotulo) => {
  const res = intersectExpediente(estab, prof);
  assertContrato(res, rotulo);
  return res;
};

// Agendamento local no dia, em minutos, contra o expediente resultante. E o caminho REAL de
// enforcement: e assim que as quatro rotas de escrita perguntam.
const aceita = (expediente, iniMin, fimMin) => {
  const spansDays = fimMin >= DAY_MINUTES;
  return assertDentroExpediente({
    startMin: iniMin % DAY_MINUTES,
    endMin: fimMin % DAY_MINUTES,
    abre: expediente.abre,
    fecha: expediente.fecha,
    spansDays,
    breaks: expediente.breaks,
  });
};

const h = (hora, minuto = 0) => hora * 60 + minuto;

// ---------------------------------------------------------------------------
// 6.1 Nucleo — janela
// ---------------------------------------------------------------------------

test('T1: estreita nas duas pontas (E 08-18, P 09-17)', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('09:00', '17:00'), 'T1');
  assert.equal(res.abre, '09:00');
  assert.equal(res.fecha, '17:00');
  assert.deepEqual(res.breaks, []);
});

test('AGENDA ABERTA T2: horario proprio mais largo NAO amplia o do salao', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('07:00', '20:00'), 'T2');
  assert.equal(res.abre, '08:00');
  assert.equal(res.fecha, '18:00');
  assert.equal(aceita(res, h(7), h(8)), false, '07:00 esta fora do salao');
  assert.equal(aceita(res, h(18), h(19)), false, '19:00 esta fora do salao');
});

test('AGENDA ABERTA T3: interseccao vazia e FECHADO, nao janela invertida', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('19:00', '22:00'), 'T3');
  assert.equal(res.closed, true);
  // O modo de falha concreto: max/min produziria 19:00->18:00, que o enforcement le como turno
  // de 23 horas e ACEITA as 20:00 — horario em que nem o salao nem a profissional trabalham.
  assert.equal(aceita(res, h(20), h(21)), false);
});

test('AGENDA ABERTA T4: encostar na borda tem largura zero, e FECHADO', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('18:00', '22:00'), 'T4');
  assert.equal(res.closed, true);
});

test('AGENDA ABERTA T5: turno noturno x horario diurno disjunto e FECHADO', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('09:00', '18:00'), 'T5');
  assert.equal(res.closed, true);
  // max/min aqui devolveria o salao inteiro (22:00->06:00), ignorando a profissional em silencio.
  assert.equal(aceita(res, h(23), h(23, 30)), false);
});

test('T6: dentro do turno que vira a meia-noite (E 22-06, P 23-04)', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('23:00', '04:00'), 'T6');
  assert.equal(res.abre, '23:00');
  assert.equal(res.fecha, '04:00');
  assert.equal(aceita(res, h(23), h(23, 30)), true);
  assert.equal(aceita(res, h(22), h(22, 30)), false);
});

test('T7: so a madrugada do turno (E 22-06, P 00-03)', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('00:00', '03:00'), 'T7');
  assert.equal(res.abre, '00:00');
  assert.equal(res.fecha, '03:00');
});

test('AGENDA ABERTA T8: horario que vira x salao diurno recorta so a sobra da manha', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('22:00', '10:00'), 'T8');
  assert.equal(res.abre, '08:00');
  assert.equal(res.fecha, '10:00');
  // A aritmetica ingenua devolveria 22:00-10:00: AMPLIA o salao em 14 horas.
  assert.equal(aceita(res, h(22), h(23)), false);
  assert.equal(aceita(res, h(11), h(12)), false);
  assert.equal(aceita(res, h(9), h(9, 30)), true);
});

test('AGENDA ABERTA T9: horario que vira sem sobreposicao com o salao e FECHADO', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('19:00', '07:00'), 'T9');
  assert.equal(res.closed, true);
});

test('T10: os dois viram, com sobreposicao (E 22-06, P 23-05)', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('23:00', '05:00'), 'T10');
  assert.equal(res.abre, '23:00');
  assert.equal(res.fecha, '05:00');
});

test('T11: horario proprio maior que o turno nao amplia (E 22-06, P 21-07)', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('21:00', '07:00'), 'T11');
  assert.equal(res.abre, '22:00');
  assert.equal(res.fecha, '06:00');
});

test('T12: meia-noite sai como 0, nunca 1440 (E 22-00, P 23-02)', () => {
  const res = intersect(aberto('22:00', '00:00'), aberto('23:00', '02:00'), 'T12');
  assert.equal(res.startMinutes, 1380);
  assert.equal(res.endMinutes, 0);
  assert.equal(res.fecha, '00:00');
});

// ---------------------------------------------------------------------------
// 6.2 Interseccao que da DOIS arcos — o buraco vira break sintetico
// ---------------------------------------------------------------------------

test('AGENDA ABERTA T13: dois arcos viram janela + buraco (E 22-06, P 05-23)', () => {
  const res = intersect(aberto('22:00', '06:00'), aberto('05:00', '23:00'), 'T13');
  assert.equal(res.abre, '22:00');
  assert.equal(res.fecha, '06:00');
  // O buraco e o que impede a janela larga de virar permissao. Sem ele, max/min devolve
  // 22:00-06:00 limpo e a profissional fica agendavel a madrugada inteira.
  assert.deepEqual(res.breaks, [[1380, 1440], [0, 300]]);
  assert.equal(aceita(res, h(22), h(22, 45)), true, 'trabalha 22:00-23:00');
  assert.equal(aceita(res, h(1), h(2)), false, 'NAO trabalha na madrugada');
  assert.equal(aceita(res, h(5), h(5, 45)), true, 'trabalha 05:00-06:00');
});

test('AGENDA ABERTA T14: buraco no meio do dia (E 08-18, P 17-09)', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('17:00', '09:00'), 'T14');
  assert.equal(res.abre, '08:00');
  assert.equal(res.fecha, '18:00');
  assert.deepEqual(res.breaks, [[540, 1020]]);
  assert.equal(aceita(res, h(8), h(8, 45)), true);
  assert.equal(aceita(res, h(12), h(13)), false, 'o miolo do dia nao e dela');
  assert.equal(aceita(res, h(17), h(17, 45)), true);
});

// ---------------------------------------------------------------------------
// 6.3 Breaks
// ---------------------------------------------------------------------------

test('AGENDA ABERTA T15: breaks sao a UNIAO dos dois lados', () => {
  const res = intersect(
    aberto('08:00', '18:00', [[720, 780]]),
    aberto('09:00', '17:00', [[900, 960]]),
    'T15'
  );
  assert.equal(res.abre, '09:00');
  assert.equal(res.fecha, '17:00');
  assert.deepEqual(res.breaks.slice().sort((a, b) => a[0] - b[0]), [[720, 780], [900, 960]]);
  assert.equal(aceita(res, h(12), h(13)), false, 'almoco do salao vale');
  assert.equal(aceita(res, h(15), h(16)), false, 'almoco da profissional vale');
});

test('AGENDA ABERTA T16: break e CLIPADO, nao filtrado, quando a janela encolhe', () => {
  // buildWorkingRules DESCARTA break que nao cabe na janela, porque la a janela e a de origem.
  // Aqui ela encolheu: repetir aquele filtro jogaria fora o almoco inteiro e entregaria
  // 12:30-13:00 ao cliente.
  const res = intersect(
    aberto('12:30', '20:00'),
    aberto('09:00', '18:00', [[720, 780]]),
    'T16'
  );
  assert.equal(res.abre, '12:30');
  assert.equal(res.fecha, '18:00');
  assert.equal(aceita(res, h(12, 30), h(13)), false, 'o pedaco do almoco que sobrou ainda bloqueia');
  assert.equal(aceita(res, h(13), h(14)), true);
});

test('AGENDA ABERTA T17: break cru mentiria em janela que vira a meia-noite', () => {
  // Sem clipar, [1020,1140] cai no ramo `inicio < startMinutes` de hasBreakOverlap e e deslocado
  // para o dia seguinte — o almoco some do lugar certo e reaparece onde ninguem trabalha.
  const res = intersect(
    aberto('18:00', '04:00'),
    aberto('17:00', '04:00', [[1020, 1140]]),
    'T17'
  );
  assert.equal(res.abre, '18:00');
  assert.equal(res.fecha, '04:00');
  assert.equal(aceita(res, h(18), h(19)), false, '18:00-19:00 esta dentro do break clipado');
  assert.equal(aceita(res, h(20), h(21)), true);
});

test('T18: sem break de nenhum lado, breaks e Array vazio (nunca null)', () => {
  const res = intersect(aberto('08:00', '18:00'), aberto('09:00', '17:00'), 'T18');
  assert.ok(Array.isArray(res.breaks));
  assert.notEqual(res.breaks, null);
  assert.equal(res.breaks.length, 0);
});

test('T19: clip de largura zero descarta a tupla', () => {
  // Break do salao que encosta exatamente na abertura da profissional.
  const res = intersect(
    aberto('08:00', '18:00', [[480, 540]]),
    aberto('09:00', '17:00'),
    'T19'
  );
  assert.deepEqual(res.breaks, []);
});

test('AGENDA ABERTA T20: tupla invalida na entrada nao contamina a saida', () => {
  // {start,end} faria hasBreakOverlap lancar TypeError (ele desestrutura posicionalmente);
  // string passa por Number.isFinite e some sem erro; invertida cria faixa fantasma.
  const res = intersect(
    aberto('08:00', '18:00', [{ start: 720, end: 780 }, ['12:00', '13:00'], [780, 720], [720, 720]]),
    aberto('09:00', '17:00'),
    'T20'
  );
  assert.deepEqual(res.breaks, []);
});

// ---------------------------------------------------------------------------
// 6.4 Contrato de shape
// ---------------------------------------------------------------------------

test('AGENDA ABERTA T21: profissional de folga devolve FECHADO que o enforcement recusa', () => {
  const res = intersect(aberto('08:00', '18:00'), fechado(), 'T21');
  assert.equal(res.closed, true);
  // A flag nao e o que protege: assertDentroExpediente nem le `closed`. Quem barra e abre null.
  assert.equal(aceita(res, h(10), h(11)), false);
});

test('T22/T23/T24: as invariantes de shape valem para a matriz inteira', () => {
  const janelas = ['08:00', '09:30', '12:00', '17:00', '22:00', '23:30', '00:00'];
  let combinacoes = 0;
  for (const eAbre of janelas) {
    for (const eFecha of janelas) {
      if (eAbre === eFecha) continue;
      for (const pAbre of janelas) {
        for (const pFecha of janelas) {
          if (pAbre === pFecha) continue;
          const res = intersectExpediente(aberto(eAbre, eFecha), aberto(pAbre, pFecha));
          assertContrato(res, `E ${eAbre}-${eFecha} x P ${pAbre}-${pFecha}`);
          combinacoes += 1;
        }
      }
    }
  }
  assert.ok(combinacoes > 1000, 'a varredura precisa ser ampla de verdade');
});

test('T25: profissional null devolve o expediente do salao, com arrays proprios', () => {
  const estab = aberto('08:00', '18:00', [[720, 780]]);
  const res = intersect(estab, null, 'T25');
  assert.equal(res.abre, estab.abre);
  assert.equal(res.fecha, estab.fecha);
  assert.equal(res.startMinutes, estab.startMinutes);
  assert.equal(res.endMinutes, estab.endMinutes);
  assert.equal(res.closed, false);
  assert.deepEqual(res.breaks, estab.breaks);
  assert.notEqual(res.breaks, estab.breaks, 'nao pode ser a MESMA referencia');
  assert.notEqual(res.breaks[0], estab.breaks[0], 'as tuplas tambem precisam ser novas');
});

test('T26: mutar o resultado nao contamina a entrada', () => {
  // resolveExpedienteForDay devolve a MESMA referencia de breaks da regra, e slots.js resolve
  // 14x por request sobre o mesmo workingRules. Um push in-place vazaria para os outros dias.
  const estab = aberto('08:00', '18:00', [[720, 780]]);
  const res = intersect(estab, aberto('09:00', '17:00'), 'T26');
  res.breaks.push([0, 60]);
  res.breaks[0][0] = 999;
  assert.deepEqual(estab.breaks, [[720, 780]]);
});

test('AGENDA ABERTA: salao fechado manda, mesmo com profissional aberta', () => {
  const res = intersect(fechado(), aberto('09:00', '17:00'), 'salao-fechado');
  assert.equal(res.closed, true);
  assert.equal(aceita(res, h(10), h(11)), false);
});

test('AGENDA ABERTA T33: source fallback do profissional NAO e janela 07:00-22:00', () => {
  // O fallback e a janela FABRICADA para "nao ha regra nenhuma". Tratada como horario proprio,
  // ela estreitaria todo salao que abre fora de 07:00-22:00.
  const estab = aberto('06:00', '23:00');
  const res = intersect(estab, aberto('07:00', '22:00', [], 'fallback'), 'T33');
  assert.equal(res.abre, '06:00');
  assert.equal(res.fecha, '23:00');
});

// ---------------------------------------------------------------------------
// 6.5 getExpediente — entradas degeneradas vindas do banco
// ---------------------------------------------------------------------------

const ESTAB_ID = 1;
const PROF_ID = 7;

const criarDb = ({ estabHorarios = null, profHorarios = null, profErro = null } = {}) => {
  const sqlLog = [];
  return {
    sqlLog,
    query: async (sql, params) => {
      sqlLog.push(String(sql).replace(/\s+/g, ' ').trim());
      if (String(sql).includes('estabelecimento_perfis')) {
        return [[{ horarios_json: estabHorarios }]];
      }
      if (String(sql).includes('FROM profissionais')) {
        if (profErro) throw profErro;
        return [[{ horarios_json: profHorarios }]];
      }
      return [[]];
    },
  };
};

const HORARIO_SALAO = JSON.stringify(
  ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => ({
    day,
    start: '08:00',
    end: '20:00',
  }))
);

// Segunda-feira, ancorada no fuso do sistema (UTC-3 fixo). A assercao logo abaixo trava a
// premissa: se a data deixar de ser segunda, o teste acusa em vez de passar por acidente.
const SEGUNDA = makeUtcFromLocalYMDHM(2026, 8, 17, 12, 0, EST_TZ_OFFSET_MIN);
const TERCA = makeUtcFromLocalYMDHM(2026, 8, 18, 12, 0, EST_TZ_OFFSET_MIN);

test('premissa: as datas do arquivo sao mesmo segunda e terca', () => {
  assert.equal(weekDayIndexInTZ(SEGUNDA, EST_TZ_OFFSET_MIN), 1);
  assert.equal(weekDayIndexInTZ(TERCA, EST_TZ_OFFSET_MIN), 2);
});

test('getExpediente sem profissionalId nao consulta profissionais nem muda a saida', async () => {
  const db = criarDb({ estabHorarios: HORARIO_SALAO });
  const res = await getExpediente({ db, estabelecimentoId: ESTAB_ID, dateUtc: SEGUNDA });
  assert.equal(res.abre, '08:00');
  assert.equal(res.fecha, '20:00');
  assert.equal(db.sqlLog.length, 1, 'uma unica query, como antes');
  assert.ok(!db.sqlLog.some((sql) => sql.includes('FROM profissionais')));
});

test('getExpediente com profissionalId intersecta', async () => {
  const db = criarDb({
    estabHorarios: HORARIO_SALAO,
    profHorarios: JSON.stringify([{ day: 'monday', start: '09:00', end: '15:00' }]),
  });
  const res = await getExpediente({
    db,
    estabelecimentoId: ESTAB_ID,
    dateUtc: SEGUNDA,
    profissionalId: PROF_ID,
  });
  assertContrato(res, 'getExpediente-intersect');
  assert.equal(res.abre, '09:00');
  assert.equal(res.fecha, '15:00');
});

test('AGENDA ABERTA T34: dia nao declarado pela profissional e FECHADO para ela', async () => {
  const db = criarDb({
    estabHorarios: HORARIO_SALAO,
    profHorarios: JSON.stringify([{ day: 'monday', start: '09:00', end: '15:00' }]),
  });
  const res = await getExpediente({
    db,
    estabelecimentoId: ESTAB_ID,
    dateUtc: TERCA,
    profissionalId: PROF_ID,
  });
  assert.equal(res.closed, true, 'declarou so segunda, entao terca e folga');
});

for (const [rotulo, json] of [
  ['T27 null', null],
  ['T28 array vazio', '[]'],
  ['T29 json malformado', '{nao e json'],
  ['T30 "Fechado" sem dia', '[{"value":"Fechado"}]'],
  ['T31 sem slug de dia', '[{"label":"Atendimento","start":"09:00","end":"18:00"}]'],
  ['T32 dia numerico', '[{"day":0,"start":"08:00","end":"18:00"}]'],
]) {
  test(`AGENDA ABERTA ${rotulo}: horario ilegivel devolve o salao intacto, nunca 07:00-22:00`, async () => {
    const db = criarDb({ estabHorarios: HORARIO_SALAO, profHorarios: json });
    const res = await getExpediente({
      db,
      estabelecimentoId: ESTAB_ID,
      dateUtc: SEGUNDA,
      profissionalId: PROF_ID,
    });
    assertContrato(res, rotulo);
    // O erro que isto pega: buildWorkingRules devolve null nas SEIS situacoes acima, e
    // resolveExpedienteForDay(null) devolve a janela fabricada 07:00-22:00 — que estreitaria o
    // salao de 08:00-20:00 para 08:00-20:00 aqui, mas ARRUINARIA qualquer salao fora dessa faixa.
    assert.equal(res.abre, '08:00', `${rotulo}: nao pode ter estreitado`);
    assert.equal(res.fecha, '20:00', `${rotulo}: nao pode ter estreitado`);
    assert.equal(res.closed, false);
  });
}

test('AGENDA ABERTA T39: erro ao ler o horario do profissional NAO degrada para dia aberto', async () => {
  // O cenario real: codigo novo em producao antes do ALTER TABLE. Um catch vazio aqui
  // transformaria ER_BAD_FIELD_ERROR em "atende 07:00-22:00, sete dias".
  const erro = Object.assign(new Error("Unknown column 'horarios_json'"), {
    code: 'ER_BAD_FIELD_ERROR',
  });
  const db = criarDb({ estabHorarios: HORARIO_SALAO, profErro: erro });
  await assert.rejects(
    () =>
      getExpediente({
        db,
        estabelecimentoId: ESTAB_ID,
        dateUtc: SEGUNDA,
        profissionalId: PROF_ID,
      }),
    /Unknown column/
  );
});

test('getExpediente recusa profissionalId que nao seja inteiro positivo', async () => {
  // Number(true) e 1: sem esta guarda, um payload torto viraria "o profissional 1".
  const db = criarDb({ estabHorarios: HORARIO_SALAO });
  for (const invalido of [true, '7', 0, -3, 1.5, Number.NaN]) {
    await assert.rejects(
      () =>
        getExpediente({
          db,
          estabelecimentoId: ESTAB_ID,
          dateUtc: SEGUNDA,
          profissionalId: invalido,
        }),
      TypeError,
      `deveria recusar ${JSON.stringify(invalido)}`
    );
  }
});
