// A grade de duração e o rótulo que o estabelecimento lê.
//
// Dois problemas que existiam: o onboarding oferecia no máximo 180 min (quem tem
// progressiva/mechas não conseguia cadastrar o serviço e só descobria depois, em /servicos)
// e o rótulo era sempre em minutos — "195 min" não se lê como 3h15 sem fazer conta.
//
// Rodar: node --test frontend/src/utils/__tests__/service-duration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SERVICE_DURATION_OPTIONS,
  SERVICE_DURATION_MAX,
  SERVICE_DURATION_MIN,
  SERVICE_DURATION_STEP,
  formatServiceDuration,
  parseServiceDuration,
} from '../serviceDuration.js';

test('a grade vai de 15 min até 8h, de 15 em 15', () => {
  assert.equal(SERVICE_DURATION_OPTIONS[0], SERVICE_DURATION_STEP);
  assert.equal(SERVICE_DURATION_OPTIONS.at(-1), SERVICE_DURATION_MAX);
  assert.equal(SERVICE_DURATION_OPTIONS.length, SERVICE_DURATION_MAX / SERVICE_DURATION_STEP);
  SERVICE_DURATION_OPTIONS.forEach((minutes, index) => {
    assert.equal(minutes, (index + 1) * SERVICE_DURATION_STEP);
  });
});

test('o onboarding não para mais em 180 min', () => {
  assert.ok(SERVICE_DURATION_OPTIONS.includes(240), 'serviço de 4h precisa caber');
  assert.ok(SERVICE_DURATION_OPTIONS.some((m) => m > 180));
});

test('abaixo de 1h continua em minutos', () => {
  assert.equal(formatServiceDuration(15), '15 min');
  assert.equal(formatServiceDuration(45), '45 min');
});

test('hora cheia não arrasta "00" atrás', () => {
  assert.equal(formatServiceDuration(60), '1h');
  assert.equal(formatServiceDuration(480), '8h');
});

test('hora quebrada vira 1h15, não 75 min', () => {
  assert.equal(formatServiceDuration(75), '1h15');
  assert.equal(formatServiceDuration(90), '1h30');
  assert.equal(formatServiceDuration(195), '3h15');
  assert.equal(formatServiceDuration(65), '1h05', 'sem o zero à esquerda "1h5" viraria 1h50 na leitura');
});

test('serviço sem duração não quebra a tela', () => {
  assert.equal(formatServiceDuration(null), '0 min');
  assert.equal(formatServiceDuration(undefined), '0 min');
  assert.equal(formatServiceDuration('abc'), '0 min');
  assert.equal(formatServiceDuration(-30), '0 min');
});

test('duração fora da grade (legado no banco) ainda é legível', () => {
  assert.equal(formatServiceDuration(100), '1h40');
  assert.equal(formatServiceDuration('90'), '1h30');
});

// --- digitar a duração à mão (campo "Outro") ---

test('número puro é lido como minutos', () => {
  assert.equal(parseServiceDuration('100'), 100);
  assert.equal(parseServiceDuration(' 20 '), 20);
  assert.equal(parseServiceDuration('100 min'), 100);
  assert.equal(parseServiceDuration('100min'), 100);
  assert.equal(parseServiceDuration('100 minutos'), 100);
});

test('hora escrita do jeito que se fala', () => {
  assert.equal(parseServiceDuration('1h40'), 100);
  assert.equal(parseServiceDuration('1h 40'), 100);
  assert.equal(parseServiceDuration('1 h 40 min'), 100);
  assert.equal(parseServiceDuration('1:40'), 100);
  assert.equal(parseServiceDuration('2h'), 120);
  assert.equal(parseServiceDuration('5h20'), 320);
});

test('a unidade por extenso vale no número inteiro, não só no decimal', () => {
  // Era o defeito: "2,0 horas" passava e "2 horas" era recusado na MESMA caixa, com a dica
  // do campo dizendo "aceita horas" — só o ramo decimal conhecia a unidade por extenso.
  assert.equal(parseServiceDuration('2 horas'), 120);
  assert.equal(parseServiceDuration('1 hora'), 60);
  assert.equal(parseServiceDuration('2horas'), 120);
  assert.equal(parseServiceDuration('2hs'), 120);
  assert.equal(parseServiceDuration('3 h'), 180);
});

test('o "e" que a pessoa fala também entra', () => {
  assert.equal(parseServiceDuration('1h e 30'), 90);
  assert.equal(parseServiceDuration('1 hora e 15'), 75);
  assert.equal(parseServiceDuration('2 horas e 30 min'), 150);
});

test('hora quebrada em decimal, com UM dígito', () => {
  assert.equal(parseServiceDuration('1,5h'), 90);
  assert.equal(parseServiceDuration('1.5 h'), 90);
  assert.equal(parseServiceDuration('0,5 hora'), 30);
  assert.equal(parseServiceDuration('2,0 horas'), 120);
});

test('decimal de dois dígitos é AMBÍGUO e é recusado — nunca chutado', () => {
  // "1,30h" vale 78 min lido como decimal e 90 min lido como relógio. Chutar grava 1h18 calado
  // e a agenda encavala o cliente seguinte; recusar faz a tela pedir "1h30" e o dado sai certo.
  assert.equal(parseServiceDuration('1,30h'), null);
  assert.equal(parseServiceDuration('2,30h'), null);
  assert.equal(parseServiceDuration('1.30h'), null);
  assert.equal(parseServiceDuration('2,25 horas'), null);
  // e a forma sem ambiguidade nenhuma continua valendo
  assert.equal(parseServiceDuration('1h30'), 90);
  assert.equal(parseServiceDuration('2:30'), 150);
});

test('o que sai da tela volta igual (o campo abre preenchido com o valor atual)', () => {
  [20, 45, 60, 100, 195, 320, 480].forEach((minutes) => {
    assert.equal(parseServiceDuration(formatServiceDuration(minutes)), minutes);
  });
});

test('digitação sem sentido vira null — a tela bloqueia o salvar em vez de gravar lixo', () => {
  assert.equal(parseServiceDuration(''), null);
  assert.equal(parseServiceDuration('   '), null);
  assert.equal(parseServiceDuration(null), null);
  assert.equal(parseServiceDuration('abc'), null);
  assert.equal(parseServiceDuration('1h30m20'), null);
  assert.equal(parseServiceDuration('-30'), null);
  assert.equal(parseServiceDuration('1h70'), null, '"1h70" é dedo errado, não 2h10');
});

test('a faixa aceita cobre o que a grade cobre', () => {
  assert.ok(SERVICE_DURATION_MIN < SERVICE_DURATION_OPTIONS[0]);
  assert.equal(SERVICE_DURATION_MAX, SERVICE_DURATION_OPTIONS.at(-1));
  // fora da faixa continua sendo lido — quem chama é que barra, com mensagem própria
  assert.equal(parseServiceDuration('600'), 600);
});
