import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRM_DEFAULT_DORMANT_DAYS,
  classifyRelationship,
  computeAverageReturnDays,
  computeBirthdayInfo,
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

test('computeBirthdayInfo returns next birthday data', () => {
  const info = computeBirthdayInfo('1990-03-20', new Date('2026-03-15T12:00:00Z'));
  assert.equal(info.month, 3);
  assert.equal(info.day, 20);
  assert.equal(info.days_until_birthday, 5);
  assert.equal(info.is_birthday_month, true);
});
