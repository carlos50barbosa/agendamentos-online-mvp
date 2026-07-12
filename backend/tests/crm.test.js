import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRM_DEFAULT_DORMANT_DAYS,
  CRM_INACTIVE_DAYS,
  buildCrmPeriodSql,
  buildCrmPreviousPeriodSql,
  buildCrmRelationshipSql,
  buildCrmRiskSql,
  classifyRelationship,
  computeAverageReturnDays,
  computeBirthdayInfo,
  isAtRisk,
  normalizeCrmTags,
} from '../src/lib/crm.js';

test('computeAverageReturnDays returns rounded average gap', () => {
  const avg = computeAverageReturnDays([
    '2026-01-01T10:00:00Z',
    '2026-01-11T10:00:00Z',
    '2026-01-21T10:00:00Z',
  ]);
  assert.equal(avg, 10);
});

test('classifyRelationship prioritizes VIP and inactivity', () => {
  assert.equal(classifyRelationship({ totalAppointments: 8, daysSinceLastVisit: 5, isVip: true }).code, 'vip');
  assert.equal(classifyRelationship({ totalAppointments: 4, daysSinceLastVisit: 120 }).code, 'inativo');
  assert.equal(classifyRelationship({ totalAppointments: 4, daysSinceLastVisit: CRM_DEFAULT_DORMANT_DAYS + 2 }).code, 'sumido');
  assert.equal(classifyRelationship({ totalAppointments: 2, daysSinceLastVisit: 10 }).code, 'recorrente');
  assert.equal(classifyRelationship({ totalAppointments: 1, daysSinceLastVisit: 10 }).code, 'novo');
});

test('normalizeCrmTags keeps unique sanitized values', () => {
  assert.deepEqual(normalizeCrmTags([' VIP ', 'vip', 'Promocao', '', null]), ['VIP', 'Promocao']);
});

// Regressao: "em risco" existia duas vezes — no JS sobre a taxa ARREDONDADA e no SQL sobre
// a taxa crua. Com 34,5% o JS arredondava para 35 e marcava a linha; o SQL nao contava.
test('isAtRisk nao diverge na fronteira de 35% de cancelamento', () => {
  // 69/200 = 34,5% — arredondar aqui era o que fazia o KPI e a linha discordarem.
  assert.equal(isAtRisk({ daysSinceLastVisit: 10, lifetimeTotal: 200, lifetimeCancelled: 69 }), false);
  assert.equal(isAtRisk({ daysSinceLastVisit: 10, lifetimeTotal: 200, lifetimeCancelled: 70 }), true);
});

test('isAtRisk exige amostra minima antes de acusar cancelador', () => {
  // 1 de 1 cancelado da 100% e antes bastava para marcar o cliente.
  assert.equal(isAtRisk({ daysSinceLastVisit: null, lifetimeTotal: 1, lifetimeCancelled: 1 }), false);
  assert.equal(isAtRisk({ daysSinceLastVisit: null, lifetimeTotal: 3, lifetimeCancelled: 3 }), true);
});

test('isAtRisk marca quem sumiu, independente de cancelamento', () => {
  assert.equal(isAtRisk({ daysSinceLastVisit: CRM_DEFAULT_DORMANT_DAYS, lifetimeTotal: 10, lifetimeCancelled: 0 }), true);
  assert.equal(isAtRisk({ daysSinceLastVisit: CRM_DEFAULT_DORMANT_DAYS - 1, lifetimeTotal: 10, lifetimeCancelled: 0 }), false);
  // Quem nunca visitou nao e "sumido" — nao ha visita da qual sumir.
  assert.equal(isAtRisk({ daysSinceLastVisit: null, lifetimeTotal: 0, lifetimeCancelled: 0 }), false);
});

test('buildCrmRiskSql usa as mesmas constantes da regra em JS', () => {
  const sql = buildCrmRiskSql('base').replace(/\s+/g, ' ');
  assert.match(sql, new RegExp(`days_since_last_visit, 0\\) >= ${CRM_DEFAULT_DORMANT_DAYS}`));
  assert.match(sql, /base\.lifetime_total >= 3/);
  assert.match(sql, /base\.lifetime_cancelled \/ base\.lifetime_total\) >= 0\.35/);
});

// A janela antiga so tinha piso: "ultimos 30 dias" deixava passar todo o futuro junto.
test('buildCrmPeriodSql fecha a janela dos dois lados e usa UTC', () => {
  const sql = buildCrmPeriodSql(30);
  assert.match(sql, /a\.inicio >= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 30 DAY\)/);
  assert.match(sql, /a\.inicio <= UTC_TIMESTAMP\(\)/);
  assert.ok(!/\bNOW\(\)/.test(sql), 'nao usa NOW() (fuso do MySQL)');
});

test('buildCrmPeriodSql vira no-op quando nao ha periodo', () => {
  assert.equal(buildCrmPeriodSql(null), '1=1');
  assert.equal(buildCrmPeriodSql(0), '1=1');
  // periodDays vem de um mapa congelado; qualquer coisa fora disso nao pode virar SQL.
  assert.equal(buildCrmPeriodSql('30; DROP TABLE agendamentos'), '1=1');
});

// Regressao: "novo" testava days < 90, mas classifyRelationship ja chama de "sumido" quem
// passa de 45. Um cliente com 50 dias era contado como NOVO e como SUMIDO ao mesmo tempo,
// e o filtro "Novos" trazia gente sumida junto.
test('buildCrmRelationshipSql: novo e recorrente cortam em 45 dias, nao em 90', () => {
  const novo = buildCrmRelationshipSql('novo');
  const recorrente = buildCrmRelationshipSql('recorrente');

  assert.match(novo, new RegExp(`days_since_last_visit < ${CRM_DEFAULT_DORMANT_DAYS}`));
  assert.match(recorrente, new RegExp(`days_since_last_visit < ${CRM_DEFAULT_DORMANT_DAYS}`));
  assert.ok(!novo.includes(`< ${CRM_INACTIVE_DAYS}`), 'novo nao pode mais ir ate 90 dias');
  // A cascata do JS concorda: 50 dias e "sumido", nao "novo".
  assert.equal(classifyRelationship({ totalAppointments: 1, daysSinceLastVisit: 50 }).code, 'sumido');
});

test('buildCrmRelationshipSql cobre a mesma cascata do classifyRelationship', () => {
  assert.equal(buildCrmRelationshipSql('vip'), 'base.is_vip = 1');
  assert.match(buildCrmRelationshipSql('inativo'), new RegExp(`>= ${CRM_INACTIVE_DAYS}`));
  const sumido = buildCrmRelationshipSql('sumido');
  assert.match(sumido, new RegExp(`>= ${CRM_DEFAULT_DORMANT_DAYS}`));
  assert.match(sumido, new RegExp(`< ${CRM_INACTIVE_DAYS}`));
  // Sem visita registrada nao ha de quando sumir: cai para novo/recorrente, como no JS.
  assert.match(buildCrmRelationshipSql('novo'), /days_since_last_visit IS NULL OR/);
  assert.equal(buildCrmRelationshipSql('inexistente'), null);
  // O alias e parametrizavel: a contagem usa a mesma funcao do filtro.
  assert.match(buildCrmRelationshipSql('vip', 'b2'), /b2\.is_vip = 1/);
});

test('buildCrmPreviousPeriodSql desloca a janela sem sobrepor a atual', () => {
  const sql = buildCrmPreviousPeriodSql(30);
  assert.match(sql, /a\.inicio >= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 60 DAY\)/);
  // Estritamente MENOR que o inicio da janela atual: nenhum agendamento cai nas duas.
  assert.match(sql, /a\.inicio < DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 30 DAY\)/);
  // period=all nao tem "anterior": o predicado precisa ser sempre falso, nao sempre verdadeiro.
  assert.equal(buildCrmPreviousPeriodSql(null), '1=0');
});

test('computeBirthdayInfo returns next birthday data', () => {
  const info = computeBirthdayInfo('1990-03-20', new Date('2026-03-15T12:00:00Z'));
  assert.equal(info.month, 3);
  assert.equal(info.day, 20);
  assert.equal(info.days_until_birthday, 5);
  assert.equal(info.is_birthday_month, true);
});
