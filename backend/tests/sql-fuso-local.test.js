import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EST_TZ_OFFSET_MIN,
  SQL_NOW_LOCAL,
  SQL_TODAY_LOCAL,
  formatLocalSqlDateTime,
  makeUtcFromLocalYMDHM,
} from '../src/lib/datetime_tz.js';
import { buildCrmPeriodSql, buildCrmPreviousPeriodSql } from '../src/lib/crm.js';

// As colunas de agendamento sao DATETIME gravadas por Date do JS com o pool do mysql2 sem a
// opcao `timezone` (default 'local'), num servidor em America/Sao_Paulo: elas guardam HORA
// LOCAL DE PAREDE. Comparar com UTC_TIMESTAMP() errava 3h, sempre dando o evento por passado
// cedo demais. Estes testes existem para que ninguem "conserte" isso de volta.

test('SQL_NOW_LOCAL desloca o relogio UTC pelo offset local, e nao usa UTC_TIMESTAMP cru', () => {
  assert.equal(EST_TZ_OFFSET_MIN, -180);
  assert.equal(SQL_NOW_LOCAL, 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL -180 MINUTE)');
  assert.equal(SQL_TODAY_LOCAL, 'DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -180 MINUTE))');
});

// A regressao real: o teto da janela deixava entrar o que ainda ia acontecer nas proximas 3h,
// e o KPI do dia subia de manha sem ninguem ter sido atendido.
test('a janela de periodo do CRM nao compara com UTC_TIMESTAMP cru', () => {
  const atual = buildCrmPeriodSql(30);
  const anterior = buildCrmPreviousPeriodSql(30);
  for (const sql of [atual, anterior]) {
    assert.ok(sql.includes(SQL_NOW_LOCAL), `deve usar o relogio local: ${sql}`);
    assert.ok(
      !/UTC_TIMESTAMP\(\)(?!, INTERVAL -180 MINUTE)/.test(sql.replaceAll(SQL_NOW_LOCAL, '')),
      `nao pode sobrar UTC_TIMESTAMP() solto: ${sql}`
    );
  }
  // O comportamento que ja existia continua: janela fechada dos dois lados, sem sobreposicao.
  assert.match(atual, /a\.inicio >= DATE_SUB\(/);
  assert.match(atual, /a\.inicio <= /);
  assert.equal(buildCrmPeriodSql(null), '1=1');
  assert.equal(buildCrmPreviousPeriodSql(null), '1=0');
});

// O erro no sentido inverso: formatar o limite do intervalo com os getters UTC cortava o dia
// as 03:00 em vez de 00:00, e todo relatorio perdia a madrugada do primeiro dia.
test('formatLocalSqlDateTime devolve a hora de PAREDE, nao a UTC', () => {
  // Meia-noite local de 01/08 e o instante 03:00Z — o formato certo e o local.
  const meiaNoiteLocal = makeUtcFromLocalYMDHM(2026, 8, 1, 0, 0, EST_TZ_OFFSET_MIN);
  assert.equal(meiaNoiteLocal.toISOString(), '2026-08-01T03:00:00.000Z');
  assert.equal(formatLocalSqlDateTime(meiaNoiteLocal), '2026-08-01 00:00:00');

  const fimDoDia = makeUtcFromLocalYMDHM(2026, 8, 31, 23, 59, EST_TZ_OFFSET_MIN);
  assert.equal(formatLocalSqlDateTime(fimDoDia), '2026-08-31 23:59:00');

  // Virada de dia: 22:00 local de 31/08 ja e 01/09 em UTC. Formatar em UTC trocava o dia.
  const noite = makeUtcFromLocalYMDHM(2026, 8, 31, 22, 0, EST_TZ_OFFSET_MIN);
  assert.equal(noite.toISOString(), '2026-09-01T01:00:00.000Z');
  assert.equal(formatLocalSqlDateTime(noite), '2026-08-31 22:00:00');

  assert.equal(formatLocalSqlDateTime(null), null);
  assert.equal(formatLocalSqlDateTime(new Date('nao-e-data')), null);
});
