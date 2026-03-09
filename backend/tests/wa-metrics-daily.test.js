import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEngineResultToMetrics } from '../src/bot/metrics/metricsMapper.js';

test('metricas incrementam inicio e conclusao de agendar', () => {
  const started = mapEngineResultToMetrics({
    engineResult: { intent: 'AGENDAR', action: 'LIST_SERVICOS', prevState: 'START' },
    replyType: 'text',
    replyMode: 'text',
  });
  assert.equal(started.inbound_count, 1);
  assert.equal(started.started_agendar, 1);
  assert.equal(started.completed_agendar, 0);

  const completed = mapEngineResultToMetrics({
    engineResult: { intent: 'AGENDAR', action: 'CREATE_OK', prevState: 'AGENDAR_CONFIRMAR' },
    replyType: 'text',
    replyMode: 'text',
  });
  assert.equal(completed.completed_agendar, 1);
});

test('metricas contam conflito, handoff, template fora da janela e erro', () => {
  const metrics = mapEngineResultToMetrics({
    engineResult: {
      intent: 'REMARCAR',
      action: 'CONFLICT',
      endpointResult: { status: 409 },
    },
    replyType: 'template',
    replyMode: 'template',
    handoffOpened: true,
    errorCode: 'BOT_UPSTREAM_TIMEOUT',
  });
  assert.equal(metrics.conflicts_409, 1);
  assert.equal(metrics.handoff_opened, 1);
  assert.equal(metrics.outside_window_template_sent, 1);
  assert.equal(metrics.errors_count, 1);
});
