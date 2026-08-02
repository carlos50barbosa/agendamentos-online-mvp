// Fidelidade é recurso do Premium. Este teste existe porque o gate do SINAL já viveu como
// quatro `new Set(['pro','premium'])` copiados por aí, e porque em 02/08/2026 o flag do sinal
// virou e desvirou no mesmo dia deixando a vitrine mentindo. O que trava o produto e o que a
// vitrine anuncia têm de sair da MESMA fonte — é isso que se verifica aqui.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_TIERS,
  getPublicPlanCatalog,
  planAllowsLoyalty,
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

test('a vitrine anuncia exatamente o que o gate libera', () => {
  const { plans } = getPublicPlanCatalog();
  assert.equal(plans.length, PLAN_TIERS.length);
  for (const plan of plans) {
    assert.equal(
      plan.allow_loyalty,
      planAllowsLoyalty(plan.code),
      `catálogo e gate divergem em "${plan.code}" — é assim que a página de preços passa a mentir`,
    );
    assert.equal(plan.allow_deposit, resolvePlanConfig(plan.code).allowDeposit);
  }
});
