import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocalDate,
  shiftLocalDate,
  fillDailySeries,
  normalizeLeadTimeRows,
  LEAD_TIME_BUCKETS,
} from '../src/lib/reporting.js';

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
    { dia: '2026-02-10', confirmados: 1, cancelados: 0, concluidos: 1, no_show: 0, receita_centavos: 1000 },
    { dia: '2026-02-12', confirmados: 2, cancelados: 1, concluidos: 1, no_show: 0, receita_centavos: 500 },
  ];
  const filled = fillDailySeries(rows, start, end);
  assert.equal(filled.length, 3);
  assert.deepEqual(filled[1], {
    date: '2026-02-11',
    confirmados: 0,
    cancelados: 0,
    concluidos: 0,
    no_show: 0,
    receita_dia: 0,
  });
});

test('normalizeLeadTimeRows returns all buckets', () => {
  const rows = [{ bucket: '0-1d', total: 2 }];
  const normalized = normalizeLeadTimeRows(rows);
  assert.equal(normalized.length, LEAD_TIME_BUCKETS.length);
  assert.equal(normalized[0].total, 2);
  assert.equal(normalized[normalized.length - 1].total, 0);
});
