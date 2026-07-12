import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocalDate,
  shiftLocalDate,
  fillDailySeries,
  normalizeLeadTimeRows,
  buildServiceItemJoin,
  buildCustomerMixQuery,
  summarizeTotals,
  buildInsights,
  LEAD_TIME_BUCKETS,
} from '../src/lib/reporting.js';

const countPlaceholders = (sql) => (sql.match(/\?/g) || []).length;

test('parseLocalDate parses YYYY-MM-DD', () => {
  const parsed = parseLocalDate('2026-02-11');
  assert.deepEqual(parsed, { year: 2026, month: 2, day: 11 });
  assert.equal(parseLocalDate('2026-2-11'), null);
});

test('shiftLocalDate keeps sequence', () => {
  const base = { year: 2026, month: 2, day: 11 };
  const next = shiftLocalDate(base, 2);
  assert.deepEqual(next, { year: 2026, month: 2, day: 13 });
});

test('fillDailySeries fills missing days with zeros', () => {
  const start = { year: 2026, month: 2, day: 10 };
  const end = { year: 2026, month: 2, day: 12 };
  const rows = [
    { dia: '2026-02-10', confirmados: 1, cancelados: 0, concluidos: 1, no_show: 0, receita_prevista: 1000, receita_concluida: 1000 },
    { dia: '2026-02-12', confirmados: 2, cancelados: 1, concluidos: 1, no_show: 0, receita_prevista: 500, receita_concluida: 0 },
  ];
  const filled = fillDailySeries(rows, start, end);
  assert.equal(filled.length, 3);
  assert.deepEqual(filled[1], {
    date: '2026-02-11',
    confirmados: 0,
    cancelados: 0,
    concluidos: 0,
    no_show: 0,
    receita_prevista: 0,
    receita_concluida: 0,
  });
  assert.equal(filled[2].receita_prevista, 500);
  assert.equal(filled[2].receita_concluida, 0);
});

test('normalizeLeadTimeRows returns all buckets', () => {
  const rows = [{ bucket: '0-1d', total: 2 }];
  const normalized = normalizeLeadTimeRows(rows);
  assert.equal(normalized.length, LEAD_TIME_BUCKETS.length);
  assert.equal(normalized[0].total, 2);
  assert.equal(normalized[normalized.length - 1].total, 0);
});

test('buildServiceItemJoin restringe os itens aos servicos filtrados', () => {
  const semFiltro = buildServiceItemJoin([]);
  assert.equal(countPlaceholders(semFiltro.sql), 0);
  assert.deepEqual(semFiltro.params, []);
  assert.ok(!semFiltro.sql.includes('servico_id'));

  const comFiltro = buildServiceItemJoin([10, 11]);
  assert.ok(comFiltro.sql.includes('ai.servico_id IN (?, ?)'));
  assert.equal(countPlaceholders(comFiltro.sql), comFiltro.params.length);
  assert.deepEqual(comFiltro.params, [10, 11]);
});

// Regressao: os '?' eram ligados fora de ordem e o mysql2 nao acusa quando a CONTAGEM bate.
// O estabelecimento_id do subquery first_seen aparece por ULTIMO no texto do SQL.
test('buildCustomerMixQuery liga os parametros na ordem do texto do SQL', () => {
  const startUtc = '2026-06-13 03:00:00';
  const endUtc = '2026-07-13 02:59:59';
  const { sql, params } = buildCustomerMixQuery({
    estId: 7,
    startUtc,
    endUtc,
    whereClause: 'a.estabelecimento_id = ? AND a.inicio BETWEEN ? AND ?',
    whereParams: [7, startUtc, endUtc],
  });

  assert.equal(countPlaceholders(sql), params.length);
  assert.deepEqual(params, [
    startUtc, endUtc, // janela de "cliente novo"
    startUtc,         // corte de "cliente recorrente"
    7, startUtc, endUtc, // subquery current_clients (whereParams)
    7,                // subquery first_seen: vem por ultimo no texto
  ]);
  assert.equal(params[params.length - 1], 7);
});

// A formula antiga trocava o denominador conforme existisse ou nao no-show: com zero no-show
// usava `confirmados` (que inclui agendamentos futuros), com um no-show passava para
// `concluidos + no_show`. Um unico no-show fazia a taxa saltar de 40% para 97,5%.
test('taxa de comparecimento nao salta ao aparecer o primeiro no-show', () => {
  // 100 confirmados, 60 ainda no futuro. Dos 40 que ja aconteceram, todos compareceram.
  const semNoShow = summarizeTotals({
    agendados_total: 140, confirmados_total: 100, concluidos_total: 40, no_show_total: 0,
  });
  // Mesmo cenario, mas um dos 40 faltou.
  const comNoShow = summarizeTotals({
    agendados_total: 140, confirmados_total: 100, concluidos_total: 39, no_show_total: 1,
  });

  assert.equal(semNoShow.rates.taxa_comparecimento, 1);
  assert.equal(comNoShow.rates.taxa_comparecimento, 39 / 40);
  assert.ok(
    Math.abs(semNoShow.rates.taxa_comparecimento - comNoShow.rates.taxa_comparecimento) < 0.03,
    'um no-show a mais move a taxa alguns pontos, nao dezenas'
  );
});

test('ticket medio usa a receita realizada, nao a prevista', () => {
  const { revenue } = summarizeTotals({
    confirmados_total: 100, concluidos_total: 40,
    receita_prevista: 1200000, receita_concluida: 400000,
  });
  // 400000 / 40 = R$ 100,00. A formula antiga fazia 1200000/100 = R$ 120,00, inflando o
  // numerador com futuros e pendentes que nao entravam no denominador.
  assert.equal(revenue.ticket_medio, 10000);
});

test('ticket medio zera sem atendimento concluido', () => {
  const { revenue } = summarizeTotals({ concluidos_total: 0, receita_prevista: 500000 });
  assert.equal(revenue.ticket_medio, 0);
});

test('buildInsights compara volume com o periodo anterior', () => {
  const insights = buildInsights({
    totals: { agendados_total: 40 },
    revenue: { concluida: 0, perdida: 0 },
    previous: { totals: { agendados_total: 32 }, revenue: { concluida: 0 } },
    rangeDays: 30,
  });
  const volume = insights.find((item) => item.id === 'volume');
  assert.equal(volume.tone, 'positive');
  assert.match(volume.text, /25% a mais/);
  assert.match(volume.text, /30 dias anteriores/);
});

test('buildInsights chama de estavel uma variacao pequena', () => {
  const insights = buildInsights({
    totals: { agendados_total: 41 },
    revenue: { concluida: 0, perdida: 0 },
    previous: { totals: { agendados_total: 40 }, revenue: { concluida: 0 } },
    rangeDays: 7,
  });
  const volume = insights.find((item) => item.id === 'volume');
  assert.equal(volume.tone, 'neutral');
  assert.match(volume.text, /estável/);
});

test('buildInsights nao chama de dia mais fraco um dia sem movimento', () => {
  const insights = buildInsights({
    totals: { agendados_total: 17 },
    revenue: { concluida: 0, perdida: 0 },
    topDaysOfWeek: [{ dow: 0, total: 0 }, { dow: 1, total: 3 }, { dow: 6, total: 14 }],
  });
  const dia = insights.find((item) => item.id === 'dia_semana');
  assert.match(dia.text, /^Sábado é seu dia mais forte/);
  assert.match(dia.text, /segunda-feira é o mais fraco/);
  // Domingo fechado nao pode virar "seu dia mais fraco".
  assert.ok(!dia.text.includes('domingo'));
});

test('buildInsights limita a 4 e nao compara sem periodo anterior', () => {
  const insights = buildInsights({
    totals: { agendados_total: 40, cancelados_total: 4, no_show_total: 2 },
    revenue: { concluida: 300000, perdida: 60000 },
    topDaysOfWeek: [{ dow: 1, total: 3 }, { dow: 6, total: 14 }],
    leadTime: [{ key: '0-1d', total: 8 }, { key: '15+d', total: 2 }],
    topServices: [{ nome: 'Corte', receita_concluida: 200000 }],
    customerMix: { new_clients: 4, recurring_clients: 12 },
    rangeDays: 30,
  });
  assert.equal(insights.length, 4);
  assert.ok(!insights.some((item) => item.id === 'volume'), 'sem periodo anterior nao ha comparacao');
  assert.equal(insights[0].id, 'perdas');
  assert.match(insights[0].text, /R\$\s?600,00/);
});

test('buildCustomerMixQuery mantem a ordem com filtros extras no where', () => {
  const startUtc = '2026-06-13 03:00:00';
  const endUtc = '2026-07-13 02:59:59';
  const { sql, params } = buildCustomerMixQuery({
    estId: 7,
    startUtc,
    endUtc,
    whereClause: 'a.estabelecimento_id = ? AND a.inicio BETWEEN ? AND ? AND a.profissional_id = ?',
    whereParams: [7, startUtc, endUtc, 42],
  });

  assert.equal(countPlaceholders(sql), params.length);
  assert.equal(params[6], 42, 'o filtro extra fica dentro do bloco do where');
  assert.equal(params[params.length - 1], 7, 'o estabelecimento_id do first_seen continua por ultimo');
});
