import jwt from 'jsonwebtoken';

// Token de LEITURA de um agendamento público, entregue a quem acabou de marcar.
//
// Por que não reusar o `public_deposit`: aquele nasce só no caminho do sinal (é a credencial do
// PIX) e carrega `payment_id`. Um agendamento sem sinal não gera nenhum, e era por isso que a
// convidada terminava o fluxo sem nenhuma forma de reabrir o próprio horário. Escopos separados
// também impedem que um token de leitura vire chave de pagamento por descuido de refactor.
//
// ESCOPO DELIBERADAMENTE ESTREITO: um agendamento, o que a pessoa acabou de fazer nesta tela.
// Não lista o histórico dela. O telefone digitado no wizard NUNCA é verificado (não há OTP no
// fluxo padrão — ver PUBLIC_BOOKING_REQUIRE_OTP em agendamentos_public.js), então um token que
// listasse tudo daquele número deixaria qualquer pessoa digitar o celular de um estranho, marcar
// qualquer horário e ler a agenda inteira dele. Para a LISTA existe o caminho com OTP, que exige
// posse comprovada do número.

function resolveSecret(env = process.env) {
  return String(env.JWT_SECRET || '').trim();
}

function resolveTokenTtlDays(env = process.env) {
  const raw = Number(env.PUBLIC_APPOINTMENT_TOKEN_DAYS || 30);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 30;
}

export function buildPublicAppointmentToken({
  agendamentoId,
  clienteId,
  estabelecimentoId,
}, env = process.env) {
  const secret = resolveSecret(env);
  if (!secret) return null;
  const payload = {
    scope: 'public_appointment',
    agendamento_id: Number(agendamentoId),
    cliente_id: Number(clienteId),
    estabelecimento_id: Number(estabelecimentoId),
  };
  try {
    return jwt.sign(payload, secret, { expiresIn: `${resolveTokenTtlDays(env)}d` });
  } catch {
    return null;
  }
}

export function verifyPublicAppointmentToken(rawToken, env = process.env) {
  const token = String(rawToken || '').trim();
  if (!token) return { ok: false, reason: 'missing_token' };
  const secret = resolveSecret(env);
  if (!secret) return { ok: false, reason: 'missing_secret' };
  try {
    const payload = jwt.verify(token, secret);
    if (payload?.scope !== 'public_appointment') {
      return { ok: false, reason: 'invalid_scope' };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, reason: err?.name || 'invalid_token', error: err };
  }
}
