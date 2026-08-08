// Janela de agendamento: ate onde no futuro o cliente pode marcar.
//
// Por que este arquivo existe: a agenda nao tinha horizonte nenhum — nem backend, nem front.
// O assinante marcava o mes inteiro e faltava em parte, e o horario ficava ocupado.
//
// O que estes testes seguram:
//   1. a VIRADA. E o unico comportamento que o dono realmente compra ("gostaria que ela so
//      abrisse aos domingos"): as 23:59 de sabado a semana seguinte esta fechada; as 00:00
//      de domingo ela abre inteira. Um erro de `<` vs `<=` aqui nasce a janela vazia;
//   2. o fuso. O limite e domingo 00:00 LOCAL (UTC-3), nao UTC — calcular em UTC abriria a
//      agenda sabado as 21h;
//   3. o clamp na grade do GET /slots, incluindo a precedencia sobre 'agendado' (semana
//      fechada renderiza uniforme e nao entrega a agenda do estabelecimento);
//   4. o default DESLIGADO: config ausente/corrompida nunca pode fechar a agenda de quem
//      nunca ligou o recurso.
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
  JANELA_MODO_LIVRE,
  JANELA_MODO_SEMANAL,
  computeJanela,
  isDentroDaJanela,
  normalizeJanelaConfig,
} = await import('../src/lib/janela_agendamento.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');

const ESTAB_ID = 1;
const localDate = (year, month, day, hour = 0, minute = 0) =>
  makeUtcFromLocalYMDHM(year, month, day, hour, minute, EST_TZ_OFFSET_MIN);

// 2099-01-04 e um DOMINGO; 2099-01-03, sabado. Ano distante de proposito: o GET /slots
// marca como indisponivel tudo que ja passou, entao data relativa a "hoje" faria o
// resultado mudar conforme o relogio anda.
const DOMINGO = { y: 2099, m: 1, d: 4 };
const SABADO = { y: 2099, m: 1, d: 3 };

const semanal = (over = {}) => normalizeJanelaConfig({
  janela_modo: 'semanal', janela_abre_dia: 0, janela_abre_hora: 0, janela_semanas: 1, ...over,
});

// ---------------------------------------------------------------------------------------
// 1. Calculo puro
// ---------------------------------------------------------------------------------------

test('modo livre nao tem limite algum', () => {
  const janela = computeJanela({ config: normalizeJanelaConfig(null), now: localDate(2099, 1, 1, 10) });
  assert.equal(janela.modo, JANELA_MODO_LIVRE);
  assert.equal(janela.limiteUtc, null);
  assert.equal(janela.abreEmUtc, null);
  // Sem limite, qualquer instante cabe — inclusive daqui a anos.
  assert.equal(isDentroDaJanela(localDate(2150, 6, 1, 9), janela), true);
});

test('config ausente, corrompida ou fora de faixa cai no default DESLIGADO', () => {
  for (const row of [null, undefined, {}, { janela_modo: 'lixo' }, { janela_modo: '' }]) {
    assert.equal(normalizeJanelaConfig(row).modo, JANELA_MODO_LIVRE, `row: ${JSON.stringify(row)}`);
  }
  // Valores fora de faixa nao derrubam o modo: caem no default de cada campo.
  const cfg = normalizeJanelaConfig({
    janela_modo: 'semanal', janela_abre_dia: 99, janela_abre_hora: -4, janela_semanas: 999,
  });
  assert.deepEqual(cfg, { modo: JANELA_MODO_SEMANAL, abreDia: 0, abreHora: 0, semanas: 1 });
});

test('no meio da semana o limite e o proximo domingo 00:00 LOCAL', () => {
  // Quarta-feira, 2099-01-07, 15h local.
  const janela = computeJanela({ config: semanal(), now: localDate(2099, 1, 7, 15) });
  const domingoSeguinte = localDate(2099, 1, 11, 0);
  assert.equal(janela.limiteUtc.getTime(), domingoSeguinte.getTime());
  assert.equal(janela.abreEmUtc.getTime(), domingoSeguinte.getTime());

  // Fuso: o limite e meia-noite local, que em UTC e 03:00 — nao 00:00.
  assert.equal(janela.limiteUtc.toISOString(), '2099-01-11T03:00:00.000Z');

  // Sabado 23h cabe; domingo 00:00 nao (comparacao exclusiva).
  assert.equal(isDentroDaJanela(localDate(2099, 1, 10, 23), janela), true);
  assert.equal(isDentroDaJanela(localDate(2099, 1, 11, 0), janela), false);
});

test('A VIRADA: 23:59 de sabado fecha a semana seguinte; 00:00 de domingo abre inteira', () => {
  const alvoQuarta = localDate(2099, 1, 7, 10); // dentro da semana que comeca no domingo 04

  const sabadoTarde = computeJanela({ config: semanal(), now: localDate(SABADO.y, SABADO.m, SABADO.d, 23, 59) });
  assert.equal(isDentroDaJanela(alvoQuarta, sabadoTarde), false, 'sabado 23:59 ainda nao ve a quarta');

  const domingoZero = computeJanela({ config: semanal(), now: localDate(DOMINGO.y, DOMINGO.m, DOMINGO.d, 0, 0) });
  assert.equal(isDentroDaJanela(alvoQuarta, domingoZero), true, 'domingo 00:00 ja ve a quarta');

  // E a semana abre INTEIRA de uma vez, ate o sabado seguinte.
  assert.equal(isDentroDaJanela(localDate(2099, 1, 10, 23, 30), domingoZero), true, 'sabado da mesma leva');
  assert.equal(isDentroDaJanela(localDate(2099, 1, 11, 0), domingoZero), false, 'o domingo seguinte segue fechado');
});

test('as 00:00 em ponto do dia de abrir o limite e o domingo SEGUINTE, nao hoje', () => {
  // Se a comparacao fosse `<` em vez de `<=`, o limite seria o proprio instante atual e a
  // janela nasceria vazia: nenhum horario da semana recem-aberta seria agendavel.
  const janela = computeJanela({ config: semanal(), now: localDate(DOMINGO.y, DOMINGO.m, DOMINGO.d, 0, 0) });
  assert.equal(janela.limiteUtc.getTime(), localDate(2099, 1, 11, 0).getTime());
});

test('janela_semanas = 2 abre uma leva a mais', () => {
  const janela = computeJanela({ config: semanal({ janela_semanas: 2 }), now: localDate(2099, 1, 7, 15) });
  assert.equal(janela.abreEmUtc.getTime(), localDate(2099, 1, 11, 0).getTime(), 'abertura nao muda');
  assert.equal(janela.limiteUtc.getTime(), localDate(2099, 1, 18, 0).getTime(), 'limite vai 7 dias alem');
});

test('abrir sabado ao meio-dia desloca a virada sem trocar o modelo', () => {
  const config = semanal({ janela_abre_dia: 6, janela_abre_hora: 12 });
  const antes = computeJanela({ config, now: localDate(SABADO.y, SABADO.m, SABADO.d, 11, 59) });
  const depois = computeJanela({ config, now: localDate(SABADO.y, SABADO.m, SABADO.d, 12, 0) });
  assert.equal(antes.limiteUtc.getTime(), localDate(2099, 1, 3, 12).getTime());
  assert.equal(depois.limiteUtc.getTime(), localDate(2099, 1, 10, 12).getTime());
});

test('instante invalido nao passa por engano quando ha limite', () => {
  const janela = computeJanela({ config: semanal(), now: localDate(2099, 1, 7, 15) });
  assert.equal(isDentroDaJanela(new Date('nao-e-data'), janela), false);
  // Mas no modo livre nao ha o que barrar.
  assert.equal(isDentroDaJanela(new Date('nao-e-data'), { limiteUtc: null }), true);
});

// ---------------------------------------------------------------------------------------
// 2. Clamp na grade do GET /slots
// ---------------------------------------------------------------------------------------

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// Mock minimo: expediente 08-18 todo dia, um agendamento cravado, e a config da janela.
function installPool({ janelaRow, agendamentos = [] }) {
  const original = pool.query;
  pool.query = async (sql, params) => {
    const text = normalizeSql(sql);
    if (text.includes('FROM establishment_settings')) return [janelaRow ? [janelaRow] : []];
    if (text.includes('FROM estabelecimento_perfis')) {
      const horarios = Array.from({ length: 7 }, (_, idx) => ({ day: idx, start: '08:00', end: '18:00' }));
      return [[{ horarios_json: JSON.stringify(horarios) }]];
    }
    if (text.includes('FROM agendamentos')) return [agendamentos];
    if (text.includes('FROM bloqueios')) return [[]];
    if (text.includes('FROM servicos')) return [[{ id: 10, duracao_min: 60, capacidade_por_horario: 1 }]];
    return [[]];
  };
  return () => { pool.query = original; };
}

async function withSlotsServer(fn) {
  const app = express();
  app.use('/slots', slotsRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET /slots fecha a semana alem do limite e devolve o metadado da janela', async () => {
  // Semana de 2099-01-11 (segunda) — toda ela DEPOIS do limite, que hoje e 2099-01-11 00:00
  // apenas quando "agora" e a semana anterior. Como o teste roda no presente, a janela
  // semanal do estabelecimento sempre fecha 2099 inteiro: e exatamente o que verificamos.
  const restore = installPool({
    janelaRow: { janela_modo: 'semanal', janela_abre_dia: 0, janela_abre_hora: 0, janela_semanas: 1 },
  });
  try {
    const body = await withSlotsServer(async (base) => {
      const resp = await fetch(`${base}/slots?establishmentId=${ESTAB_ID}&weekStart=2099-01-11`);
      assert.equal(resp.status, 200);
      return resp.json();
    });

    assert.ok(body.slots.length > 0, 'a grade continua sendo montada');
    assert.equal(
      body.slots.some((slot) => slot.status === 'free'), false,
      'nenhum slot de 2099 pode estar livre com janela semanal ligada'
    );
    assert.equal(body.janela.modo, 'semanal');
    assert.ok(body.janela.limite, 'o limite vai para o front');
    assert.ok(body.janela.abre_em, 'o "abre em" vai para o front dizer quando destrava');
  } finally {
    restore();
  }
});

test('fora da janela tem precedencia sobre "agendado" (nao vaza a agenda)', async () => {
  const inicio = localDate(2099, 1, 12, 9);
  const restore = installPool({
    janelaRow: { janela_modo: 'semanal', janela_abre_dia: 0, janela_abre_hora: 0, janela_semanas: 1 },
    agendamentos: [{
      servico_id: 10, profissional_id: null,
      inicio, fim: new Date(inicio.getTime() + 60 * 60_000),
    }],
  });
  try {
    const body = await withSlotsServer(async (base) => {
      const resp = await fetch(`${base}/slots?establishmentId=${ESTAB_ID}&weekStart=2099-01-11`);
      return resp.json();
    });
    const slot = body.slots.find((item) => item.datetime === inicio.toISOString());
    assert.ok(slot, 'o slot do agendamento existe na grade');
    assert.equal(slot.status, 'unavailable', 'fora da janela vence booked');
    assert.equal(slot.label, 'bloqueado', 'e nao revela que ha alguem marcado ali');
  } finally {
    restore();
  }
});

test('modo livre deixa a grade de 2099 intacta (nada muda para quem nao ligou)', async () => {
  const restore = installPool({ janelaRow: null });
  try {
    const body = await withSlotsServer(async (base) => {
      const resp = await fetch(`${base}/slots?establishmentId=${ESTAB_ID}&weekStart=2099-01-11`);
      return resp.json();
    });
    assert.ok(body.slots.some((slot) => slot.status === 'free'), 'segue havendo horario livre');
    assert.equal(body.janela.modo, 'livre');
    assert.equal(body.janela.limite, null);
  } finally {
    restore();
  }
});
