// Fidelidade é recurso do Premium. Este teste existe porque o gate do SINAL já viveu como
// quatro `new Set(['pro','premium'])` copiados por aí, e porque em 02/08/2026 o flag do sinal
// virou e desvirou no mesmo dia deixando a vitrine mentindo. O que trava o produto e o que a
// vitrine anuncia têm de sair da MESMA fonte — é isso que se verifica aqui.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TRIAL_PLAN,
  PLAN_TIERS,
  getPublicPlanCatalog,
  planAllowsLoyalty,
  planAllowsTrial,
  resolvePlanConfig,
} from '../src/lib/plans.js';

test('fidelidade: só o Premium permite', () => {
  assert.equal(planAllowsLoyalty('starter'), false);
  assert.equal(planAllowsLoyalty('pro'), false);
  assert.equal(planAllowsLoyalty('premium'), true);
});

test('fidelidade: plano desconhecido não ganha o recurso por acidente', () => {
  // resolvePlanConfig cai no starter quando não reconhece — o padrão precisa ser NEGAR.
  assert.equal(planAllowsLoyalty(''), false);
  assert.equal(planAllowsLoyalty(null), false);
  assert.equal(planAllowsLoyalty('plano_que_nao_existe'), false);
});

test('teste grátis: Starter e Pro sim, Premium não', () => {
  assert.equal(planAllowsTrial('starter'), true);
  assert.equal(planAllowsTrial('pro'), true);
  // Premium fora porque a fidelidade dele cria cobrança recorrente no cartão de clientes
  // reais, e nada cancela isso quando o teste acaba. Se este assert cair, confira antes o
  // que acontece com as assinaturas no dia 8.
  assert.equal(planAllowsTrial('premium'), false);
});

test('o plano padrão do teste é, ele mesmo, testável', () => {
  // Sem isto, um pedido inválido cairia num plano que não pode ser testado — e o cadastro
  // concederia trial de um plano que a vitrine nunca ofereceu.
  assert.equal(planAllowsTrial(DEFAULT_TRIAL_PLAN), true);
});

test('a vitrine anuncia exatamente o que o gate libera', () => {
  const { plans } = getPublicPlanCatalog();
  assert.equal(plans.length, PLAN_TIERS.length);
  for (const plan of plans) {
    assert.equal(
      plan.allow_loyalty,
      planAllowsLoyalty(plan.code),
      `catálogo e gate divergem em "${plan.code}" — é assim que a página de preços passa a mentir`,
    );
    assert.equal(
      plan.allow_trial,
      planAllowsTrial(plan.code),
      `catálogo e teste grátis divergem em "${plan.code}"`,
    );
    assert.equal(plan.allow_deposit, resolvePlanConfig(plan.code).allowDeposit);
  }
});
