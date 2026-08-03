// O plano com que um cadastro nasce.
//
// Em 02/08/2026 o guard do cadastro trocou um Set (`TRIAL_PLANS.has(plano)`) por
// `planAllowsTrial(plano)`. Parecia a mesma pergunta e não era: o Set testava PERTINÊNCIA e
// barrava a string vazia; `planAllowsTrial` testa CAPACIDADE e resolve plano desconhecido como
// starter, que permite teste. Resultado: `''` passou, virou `SET plan=''`, o ENUM da coluna
// recusou (1265) e derrubou junto o `plan_trial_ends_at` — estabelecimento com teste que nunca
// vence e aviso de fim que nunca dispara. Uma pessoa real (id 191) nasceu assim.
//
// Este teste fixa as duas perguntas separadas, para que ninguém volte a usar uma no lugar da outra.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TRIAL_PLAN,
  isKnownPlan,
  planAllowsTrial,
} from '../src/lib/plans.js';

// A mesma expressão do cadastro (routes/auth.js), isolada para ser verificável.
const planoDoCadastro = (pedido) => {
  const normalizado = String(pedido ?? '').trim().toLowerCase();
  return isKnownPlan(normalizado) && planAllowsTrial(normalizado) ? normalizado : DEFAULT_TRIAL_PLAN;
};

test('isKnownPlan: só reconhece plano do catálogo', () => {
  assert.equal(isKnownPlan('starter'), true);
  assert.equal(isKnownPlan('pro'), true);
  assert.equal(isKnownPlan('premium'), true);
  assert.equal(isKnownPlan('PRO'), true, 'caixa alta é o mesmo plano');
  assert.equal(isKnownPlan(''), false);
  assert.equal(isKnownPlan('   '), false);
  assert.equal(isKnownPlan('xyz'), false);
  assert.equal(isKnownPlan(null), false);
  assert.equal(isKnownPlan(undefined), false);
});

test('planAllowsTrial sozinho NÃO valida entrada — é a armadilha que quebrou o cadastro', () => {
  // Não é bug desta função: ela responde pelo starter, que é o fallback do resolvePlanConfig.
  // Está aqui gravado para que a próxima pessoa veja por que a validação precisa vir antes.
  assert.equal(planAllowsTrial(''), true);
  assert.equal(planAllowsTrial('xyz'), true);
});

test('cadastro: pedido vazio ou desconhecido cai no plano padrão, nunca no vazio', () => {
  assert.equal(planoDoCadastro(''), DEFAULT_TRIAL_PLAN);
  assert.equal(planoDoCadastro(undefined), DEFAULT_TRIAL_PLAN);
  assert.equal(planoDoCadastro(null), DEFAULT_TRIAL_PLAN);
  assert.equal(planoDoCadastro('   '), DEFAULT_TRIAL_PLAN);
  assert.equal(planoDoCadastro('xyz'), DEFAULT_TRIAL_PLAN);
});

test('cadastro: o plano que sai é sempre gravável no ENUM da coluna', () => {
  // ENUM('starter','pro','premium') — qualquer outra coisa é erro 1265 no INSERT.
  const gravaveis = ['starter', 'pro', 'premium'];
  for (const pedido of ['', '  ', 'xyz', 'premium', 'PRO', 'starter', null, undefined, 123]) {
    assert.ok(
      gravaveis.includes(planoDoCadastro(pedido)),
      `pedido ${JSON.stringify(pedido)} produziu plano não-gravável`
    );
  }
});

test('cadastro: plano do catálogo que permite teste é respeitado', () => {
  assert.equal(planoDoCadastro('pro'), 'pro');
  assert.equal(planoDoCadastro('PRO'), 'pro');
  assert.equal(planoDoCadastro('starter'), 'starter');
});

test('cadastro: Premium não é testável e cai no padrão', () => {
  // O Premium fica fora do teste porque a fidelidade dele enfileira cobrança recorrente no cartão
  // de clientes reais — teste não pode deixar dívida com terceiro para trás.
  assert.equal(planAllowsTrial('premium'), false);
  assert.equal(planoDoCadastro('premium'), DEFAULT_TRIAL_PLAN);
});
