function mapEngineResultToMetrics({ engineResult, replyType, replyMode, handoffOpened = false, errorCode = null }) {
  const increments = {
    inbound_count: 1,
    started_agendar: 0,
    completed_agendar: 0,
    started_remarcar: 0,
    completed_remarcar: 0,
    started_cancelar: 0,
    completed_cancelar: 0,
    conflicts_409: 0,
    handoff_opened: 0,
    outside_window_template_sent: 0,
    errors_count: 0,
  };

  const action = String(engineResult?.action || '');
  const intent = String(engineResult?.intent || '');
  const endpointStatus = Number(engineResult?.endpointResult?.status || 0);

  if (action === 'LIST_SERVICOS' || (intent === 'AGENDAR' && String(engineResult?.prevState || '') === 'START')) {
    increments.started_agendar = 1;
  }
  if (action === 'CREATE_OK') {
    increments.completed_agendar = 1;
  }
  if (action === 'LIST_REMARCAR' || (intent === 'REMARCAR' && String(engineResult?.prevState || '') === 'START')) {
    increments.started_remarcar = 1;
  }
  if (action === 'REMARCAR_OK') {
    increments.completed_remarcar = 1;
  }
  if (action === 'LIST_CANCELAR' || (intent === 'CANCELAR' && String(engineResult?.prevState || '') === 'START')) {
    increments.started_cancelar = 1;
  }
  if (action === 'CANCEL_OK') {
    increments.completed_cancelar = 1;
  }
  if (action === 'CONFLICT' || endpointStatus === 409) {
    increments.conflicts_409 = 1;
  }
  if (handoffOpened) {
    increments.handoff_opened = 1;
  }
  if (replyType === 'template' && replyMode === 'template') {
    increments.outside_window_template_sent = 1;
  }
  if (errorCode || action === 'BOT_ERROR' || action.endsWith('_FAIL')) {
    increments.errors_count = 1;
  }
  return increments;
}

export { mapEngineResultToMetrics };
