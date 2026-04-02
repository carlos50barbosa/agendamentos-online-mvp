function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesPublicDepositToken(payment, depositPayload) {
  const estabelecimentoId = toNumber(payment?.estabelecimento_id);
  const clienteId = toNumber(payment?.cliente_id);
  const agendamentoId = toNumber(payment?.agendamento_id);
  const paymentId = toNumber(payment?.id);
  const tokenPaymentId = toNumber(depositPayload?.payment_id);
  const tokenAgendamentoId = toNumber(depositPayload?.agendamento_id);
  const tokenClienteId = toNumber(depositPayload?.cliente_id);
  const tokenEstabelecimentoId = toNumber(depositPayload?.estabelecimento_id);

  const matchesPrimaryScope =
    tokenAgendamentoId != null &&
    tokenAgendamentoId === agendamentoId &&
    tokenEstabelecimentoId != null &&
    tokenEstabelecimentoId === estabelecimentoId &&
    tokenClienteId != null &&
    tokenClienteId === clienteId;

  if (!matchesPrimaryScope) return false;
  if (tokenPaymentId == null) return true;
  return paymentId != null && tokenPaymentId === paymentId;
}

export function canAccessPaymentStatus({ payment, user = null, depositPayload = null }) {
  const estabelecimentoId = toNumber(payment?.estabelecimento_id);
  const clienteId = toNumber(payment?.cliente_id);

  if (user) {
    const userId = toNumber(user.id);
    if (user?.tipo === 'estabelecimento' && userId != null && userId === estabelecimentoId) {
      return { ok: true, mode: 'authenticated_establishment' };
    }
    if (user?.tipo === 'cliente' && userId != null && userId === clienteId) {
      return { ok: true, mode: 'authenticated_client' };
    }
  }

  if (depositPayload && matchesPublicDepositToken(payment, depositPayload)) {
      return { ok: true, mode: 'public_deposit_token' };
  }

  if (depositPayload) {
    return { ok: false, reason: 'invalid_deposit_token_scope' };
  }

  if (user) {
    return { ok: false, reason: 'forbidden_user' };
  }

  return { ok: false, reason: 'missing_access' };
}

export function serializePaymentStatusResponse(payment, { includePrivate = false } = {}) {
  const normalized = String(payment?.status || '').trim().toLowerCase();
  const response = {
    ok: true,
    id: payment?.id ?? null,
    status: normalized,
    paid: normalized === 'paid',
    expired: ['expired', 'canceled', 'cancelled', 'failed', 'rejected'].includes(normalized),
    expires_at: payment?.expires_at ? new Date(payment.expires_at).toISOString() : null,
    paid_at: payment?.paid_at ? new Date(payment.paid_at).toISOString() : null,
  };
  if (includePrivate) {
    response.amount_centavos = payment?.amount_centavos ?? null;
    response.agendamento_id = payment?.agendamento_id ?? null;
  }
  return response;
}
