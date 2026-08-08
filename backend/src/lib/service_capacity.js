import { checkBlockConflictTx } from './bloqueios.js';

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

function minuteWindow(date) {
  const ms = new Date(date).getTime();
  if (!Number.isFinite(ms)) return null;
  const start = Math.floor(ms / 60_000) * 60_000;
  return {
    start: new Date(start),
    end: new Date(start + 60_000),
  };
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
  const sameStartWindow = minuteWindow(inicioDate);
  let capacity = 1;

  // Bloqueio vem ANTES de tudo, por dois motivos.
  //
  // (1) Enforcement: esta funcao e o unico gargalo dos 4 caminhos de criacao/remarcacao, entao
  // checar aqui fecha todos de uma vez — antes disso o bloqueio era so cosmetico (escondia o
  // slot na grade, mas um POST direto gravava por cima).
  //
  // (2) Corrida com POST /slots/bloqueios: la o bloqueio e INSERIDO antes do guard, entao a
  // linha nova ja esta com lock de registro quando este SELECT ... FOR UPDATE varre a faixa.
  // Ler `bloqueios` aqui, antes de qualquer lock em `agendamentos`, e o que garante que a
  // transacao perdedora pare com as maos vazias — ela ainda nao segura nada que o outro lado
  // queira, entao nao ha ciclo. Se esta leitura fosse depois do INSERT em `agendamentos`, as
  // duas transacoes ficariam se esperando e o InnoDB mataria uma (500 para quem agenda).
  // Nota: o caminho de REMARCAR ja trava a linha do agendamento antes de chegar aqui, entao
  // la o ciclo continua possivel — por isso POST /slots/bloqueios roda com retry de deadlock.
  //
  // NAO depende de requiresProfessional: o bloqueio vale mesmo quando o servico nao exige
  // profissional. E nao entra na excecao de capacidade abaixo — servico com capacidade > 1
  // nao fura bloqueio.
  const blockCheck = await checkBlockConflictTx({
    db,
    estabelecimentoId,
    profissionalId: professionalParam,
    inicioDate,
    fimDate,
  });
  if (!blockCheck.ok) {
    return {
      ok: false,
      error: blockCheck.error,
      message: blockCheck.message,
      capacity: 1,
      remaining: 0,
    };
  }

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

  if (canUseServiceCapacity && serviceId > 0 && sameStartWindow) {
    blockingSql += ' AND NOT (servico_id=? AND inicio>=? AND inicio<? AND (profissional_id <=> ?))';
    blockingParams.push(serviceId, sameStartWindow.start, sameStartWindow.end, professionalParam);
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
        AND inicio>=?
        AND inicio<?
        AND (profissional_id <=> ?)
        ${excludeAppointmentId != null ? 'AND id<>?' : ''}
        AND ${activeAppointmentStatusWhere()}
      FOR UPDATE`,
    excludeAppointmentId != null
      ? [estabelecimentoId, serviceId, sameStartWindow.start, sameStartWindow.end, professionalParam, excludeAppointmentId]
      : [estabelecimentoId, serviceId, sameStartWindow.start, sameStartWindow.end, professionalParam]
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
