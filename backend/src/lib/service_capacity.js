export function normalizeServiceSlotCapacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.floor(parsed));
}

export function activeAppointmentStatusWhere(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}status IN ('confirmado','pendente','pendente_pagamento')
    AND (
      ${prefix}status = 'confirmado'
      OR (${prefix}status = 'pendente' AND (${prefix}public_confirm_expires_at IS NULL OR ${prefix}public_confirm_expires_at >= NOW()))
      OR (${prefix}status = 'pendente_pagamento' AND (${prefix}deposit_expires_at IS NULL OR ${prefix}deposit_expires_at >= NOW()))
    )`;
}

export async function checkAppointmentSlotCapacityTx({
  db,
  estabelecimentoId,
  serviceItems,
  profissionalId = null,
  requiresProfessional = false,
  inicioDate,
  fimDate,
  excludeAppointmentId = null,
}) {
  const services = Array.isArray(serviceItems) ? serviceItems : [];
  const canUseServiceCapacity = services.length === 1;
  const serviceId = Number(services[0]?.id || 0);
  const professionalParam = profissionalId == null ? null : Number(profissionalId);
  let capacity = 1;

  if (canUseServiceCapacity && serviceId > 0) {
    const [[serviceRow]] = await db.query(
      `SELECT capacidade_por_horario
         FROM servicos
        WHERE id=? AND estabelecimento_id=? AND ativo=1
        FOR UPDATE`,
      [serviceId, estabelecimentoId]
    );
    capacity = normalizeServiceSlotCapacity(serviceRow?.capacidade_por_horario);
  }

  let blockingSql = `SELECT id
       FROM agendamentos
      WHERE estabelecimento_id=?
        AND ${activeAppointmentStatusWhere()}
        AND (inicio < ? AND fim > ?)`;
  const blockingParams = [estabelecimentoId, fimDate, inicioDate];

  if (excludeAppointmentId != null) {
    blockingSql += ' AND id<>?';
    blockingParams.push(excludeAppointmentId);
  }

  if (professionalParam != null && requiresProfessional) {
    blockingSql += ' AND (profissional_id IS NULL OR profissional_id=?)';
    blockingParams.push(professionalParam);
  }

  if (canUseServiceCapacity && serviceId > 0) {
    blockingSql += ' AND NOT (servico_id=? AND inicio=? AND (profissional_id <=> ?))';
    blockingParams.push(serviceId, inicioDate, professionalParam);
  }

  blockingSql += ' FOR UPDATE';

  const [blockingRows] = await db.query(blockingSql, blockingParams);
  if (blockingRows.length) {
    return {
      ok: false,
      error: 'slot_ocupado',
      message: 'Horário indisponível.',
      capacity,
      remaining: 0,
    };
  }

  if (!canUseServiceCapacity || serviceId <= 0) {
    return { ok: true, capacity: 1, remaining: 1 };
  }

  const [sameSlotRows] = await db.query(
    `SELECT id
       FROM agendamentos
      WHERE estabelecimento_id=?
        AND servico_id=?
        AND inicio=?
        AND (profissional_id <=> ?)
        ${excludeAppointmentId != null ? 'AND id<>?' : ''}
        AND ${activeAppointmentStatusWhere()}
      FOR UPDATE`,
    excludeAppointmentId != null
      ? [estabelecimentoId, serviceId, inicioDate, professionalParam, excludeAppointmentId]
      : [estabelecimentoId, serviceId, inicioDate, professionalParam]
  );

  const used = sameSlotRows.length;
  if (used >= capacity) {
    return {
      ok: false,
      error: 'slot_lotado',
      message: 'Horário lotado para este serviço.',
      capacity,
      remaining: 0,
    };
  }

  return {
    ok: true,
    capacity,
    remaining: Math.max(0, capacity - used),
  };
}
