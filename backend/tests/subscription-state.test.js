import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSubscriptionState, pickEffectiveSubscription } from '../src/lib/subscription_state.js';

test('pickEffectiveSubscription prefers the most recent billing anchor when statuses tie', () => {
  const stalePremium = {
    id: 208,
    plan: 'premium',
    paymentMethod: 'pix',
    status: 'expired',
    currentPeriodEnd: null,
    createdAt: new Date('2025-12-19T03:31:08.000Z'),
    updatedAt: new Date('2026-04-15T13:07:34.000Z'),
  };
  const latestPro = {
    id: 266,
    plan: 'pro',
    paymentMethod: 'pix',
    status: 'expired',
    currentPeriodEnd: new Date('2026-04-13T15:40:30.000Z'),
    createdAt: new Date('2026-03-13T15:38:18.000Z'),
    updatedAt: new Date('2026-04-15T12:59:26.000Z'),
  };

  const effective = pickEffectiveSubscription([stalePremium, latestPro]);

  assert.equal(effective?.id, 266);
  assert.equal(effective?.plan, 'pro');
});

test('pickEffectiveSubscription still prefers stronger statuses before recency', () => {
  const activeStarter = {
    id: 301,
    plan: 'starter',
    paymentMethod: 'credit_card',
    status: 'active',
    currentPeriodEnd: new Date('2026-04-20T10:00:00.000Z'),
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
  };
  const expiredPro = {
    id: 302,
    plan: 'pro',
    paymentMethod: 'pix',
    status: 'expired',
    currentPeriodEnd: new Date('2026-04-25T10:00:00.000Z'),
    createdAt: new Date('2026-04-02T10:00:00.000Z'),
  };

  const effective = pickEffectiveSubscription([expiredPro, activeStarter]);

  assert.equal(effective?.id, 301);
  assert.equal(effective?.status, 'active');
});

test('computeSubscriptionState keeps pending PIX outside the warning window out of due_soon', () => {
  const now = new Date('2026-04-21T12:00:00.000Z');
  const state = computeSubscriptionState({
    subscription: {
      status: 'pending_pix',
      paymentMethod: 'pix',
      currentPeriodEnd: new Date('2026-05-15T12:00:00.000Z'),
    },
    warnDays: 3,
    now,
  });

  assert.equal(state.state, 'pending');
  assert.equal(state.daysToDue, 24);
  assert.equal(state.accessState, 'partial');
  assert.equal(state.coreFeaturesAllowed, true);
});

test('computeSubscriptionState promotes pending PIX to due_soon inside the warning window', () => {
  const now = new Date('2026-05-12T12:00:00.000Z');
  const state = computeSubscriptionState({
    subscription: {
      status: 'pending_pix',
      paymentMethod: 'pix',
      currentPeriodEnd: new Date('2026-05-15T12:00:00.000Z'),
    },
    warnDays: 3,
    now,
  });

  assert.equal(state.state, 'due_soon');
  assert.equal(state.daysToDue, 3);
});

// Caso real (18/07/2026): um estabelecimento (Studio Dihcampos) gerou um PIX durante o trial para
// TESTAR o pagamento e nao pagou. A subscription virou pending_pix SEM um current_period_end que
// cobrisse o trial, e o compute passou a usar o status da subscription — ignorando o trial que
// ainda tinha dias. Resultado: bloqueado na hora, so por ter testado o pagamento. O fix faz o trial
// ativo cobrir o acesso mesmo com pagamento pendente.
test('computeSubscriptionState: pending_pix durante o trial NAO bloqueia', () => {
  const now = new Date('2026-04-21T12:00:00.000Z');
  const state = computeSubscriptionState({
    subscription: { status: 'pending_pix', paymentMethod: 'pix' }, // sem current_period_end
    planContext: { status: 'pending_pix', trialEndsAt: new Date('2026-05-10T12:00:00.000Z') }, // trial ainda tem dias
    now,
  });

  assert.equal(state.coreFeaturesAllowed, true, 'trial ativo cobre o acesso mesmo com PIX pendente');
  assert.equal(state.state, 'trial');
});

test('computeSubscriptionState: pending_pix com o trial JA EXPIRADO continua bloqueando (sem regressao)', () => {
  const now = new Date('2026-06-21T12:00:00.000Z'); // depois do fim do trial
  const state = computeSubscriptionState({
    subscription: { status: 'pending_pix', paymentMethod: 'pix' },
    planContext: { status: 'pending_pix', trialEndsAt: new Date('2026-05-10T12:00:00.000Z') },
    now,
  });

  assert.equal(state.coreFeaturesAllowed, false, 'sem trial ativo e sem periodo/graca, PIX nao pago bloqueia');
  assert.equal(state.state, 'blocked');
});
