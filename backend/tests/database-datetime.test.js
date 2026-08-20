import test from 'node:test';
import assert from 'node:assert/strict';
import { toDatabaseDateTime } from '../src/lib/database_datetime.js';
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } from '../src/lib/datetime_tz.js';

// Este modulo nao tinha teste nenhum, e era o unico ponto do backend que gravava data num fuso
// diferente do resto: ele fazia `toISOString()` (UTC) enquanto o mysql2 — que grava todas as
// outras datas do sistema — serializa Date no fuso LOCAL do processo. Duas convencoes na mesma
// coluna, e o valor pulava 3h dependendo de qual caminho tinha escrito por ultimo.

test('Date e gravado no relogio LOCAL, igual ao que o mysql2 faria', () => {
  // 09:00 da recepcao = instante 12:00Z. O que tem de ir para a coluna e "09:00:00".
  const noveDaManha = makeUtcFromLocalYMDHM(2026, 8, 22, 9, 0, EST_TZ_OFFSET_MIN);
  assert.equal(noveDaManha.toISOString(), '2026-08-22T12:00:00.000Z');
  assert.equal(toDatabaseDateTime(noveDaManha), '2026-08-22 09:00:00');
});

// A regressao concreta: plan_trial_ends_at tinha dois gravadores. routes/auth.js passa um Date
// cru (mysql2 => local) e subscription_state.js passava por aqui (=> UTC). O fim do teste
// gratuito pulava 3h para frente na primeira sincronizacao, sem ninguem ter mudado nada.
test('o mesmo instante grava igual pelos dois caminhos', () => {
  const instante = new Date('2026-08-22T12:00:00.000Z');
  // O que o mysql2 produz para um Date, com o processo em America/Sao_Paulo, e a hora de
  // parede local. Reproduzido aqui sem depender do TZ da maquina que roda o teste.
  const local = new Date(instante.getTime() + EST_TZ_OFFSET_MIN * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const comoOMysql2Gravaria = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} `
    + `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  assert.equal(toDatabaseDateTime(instante), comoOMysql2Gravaria);
});

// Virada de dia: 22:00 local de 31/08 ja e 01/09 em UTC. Gravar em UTC trocava ate a DATA.
test('nao troca o dia na virada', () => {
  const noite = makeUtcFromLocalYMDHM(2026, 8, 31, 22, 0, EST_TZ_OFFSET_MIN);
  assert.equal(noite.toISOString(), '2026-09-01T01:00:00.000Z');
  assert.equal(toDatabaseDateTime(noite), '2026-08-31 22:00:00');
});

test('string ja no formato do MySQL passa intacta', () => {
  // Aqui nao ha o que converter: quem passou a string ja decidiu o fuso. Comportamento antigo,
  // mantido de proposito — mudar isso reinterpretaria valor que veio pronto do banco.
  assert.equal(toDatabaseDateTime('2026-08-22 09:00:00'), '2026-08-22 09:00:00');
});

test('string ISO com fuso e convertida para o relogio local', () => {
  assert.equal(toDatabaseDateTime('2026-08-22T12:00:00.000Z'), '2026-08-22 09:00:00');
  assert.equal(toDatabaseDateTime('2026-08-22T09:00:00-03:00'), '2026-08-22 09:00:00');
});

test('vazio vira null e invalido levanta erro', () => {
  assert.equal(toDatabaseDateTime(null), null);
  assert.equal(toDatabaseDateTime(undefined), null);
  assert.equal(toDatabaseDateTime(''), null);
  assert.equal(toDatabaseDateTime('   '), null);
  assert.throws(() => toDatabaseDateTime(new Date('nao-e-data')), /invalid_database_datetime/);
  assert.throws(() => toDatabaseDateTime('banana'), /invalid_database_datetime/);
});
