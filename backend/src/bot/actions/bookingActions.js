import { pool } from '../../lib/db.js';
import { requestJson } from './internalApiClient.js';

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneBR(value) {
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function formatDateLabel(isoDate) {
  try {
    const dt = new Date(`${isoDate}T12:00:00`);
    return dt.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return isoDate;
  }
}

function formatHourLabel(isoDateTime) {
  try {
    return new Date(isoDateTime).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return isoDateTime;
  }
}

function formatDateTimeLabel(isoDateTime) {
  try {
    return new Date(isoDateTime).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return isoDateTime;
  }
}

function normalizeServiceIdsInput(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0);
  }
  const single = Number(value);
  if (Number.isFinite(single) && single > 0) return [single];
  return [];
}

function toDateKey(isoDateTime) {
  const dt = new Date(isoDateTime);
  if (!Number.isFinite(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!lookup.year || !lookup.month || !lookup.day) return null;
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function todayDateKey() {
  return toDateKey(new Date().toISOString());
}

function addDays(dateKey, days) {
  const base = new Date(`${dateKey}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

async function listServicos(tenantId) {
  const endpoint = '/servicos';
  const response = await requestJson(endpoint, {
    query: { establishmentId: tenantId },
  });
  const services = Array.isArray(response.data) ? response.data : [];
  return {
    ok: response.ok,
    status: response.status,
    endpoint: response.url,
    elapsedMs: response.elapsedMs || null,
    botErrorCode: response.botErrorCode || response.data?.error_code || null,
    services: services.map((item) => ({
      id: Number(item.id),
      nome: String(item.nome || item.title || ''),
      descricao: item.descricao || null,
      duracao_min: Number(item.duracao_min || 0),
      preco_centavos: Number(item.preco_centavos || 0),
      professionals: Array.isArray(item.professionals) ? item.professionals : [],
    })),
    raw: response.data,
  };
}

async function listProfissionaisPorServico(tenantId, servicoId) {
  const servicesResult = await listServicos(tenantId);
  if (!servicesResult.ok) {
    return {
      ok: false,
      status: servicesResult.status,
      endpoint: servicesResult.endpoint,
      elapsedMs: servicesResult.elapsedMs || null,
      botErrorCode: servicesResult.botErrorCode || null,
      profissionais: [],
      raw: servicesResult.raw,
    };
  }
  const serviceIdNum = Number(servicoId);
  const selected = servicesResult.services.find((svc) => Number(svc.id) === serviceIdNum);
  if (!selected) {
    return {
      ok: false,
      status: 404,
      endpoint: servicesResult.endpoint,
      elapsedMs: servicesResult.elapsedMs || null,
      botErrorCode: null,
      profissionais: [],
      raw: { error: 'servico_invalido' },
    };
  }
  const profissionais = (selected.professionals || []).map((prof) => ({
    id: Number(prof.id),
    nome: String(prof.nome || ''),
    descricao: prof.descricao || null,
    avatar_url: prof.avatar_url || null,
  }));
  return {
    ok: true,
    status: 200,
    endpoint: servicesResult.endpoint,
    elapsedMs: servicesResult.elapsedMs || null,
    botErrorCode: servicesResult.botErrorCode || null,
    profissionais,
    service: selected,
    raw: { serviceId: selected.id, total: profissionais.length },
  };
}

function extractFreeSlots(slotsPayload, minDateKey = null) {
  const slots = Array.isArray(slotsPayload?.slots) ? slotsPayload.slots : [];
  return slots
    .filter((slot) => String(slot?.status || '').toLowerCase() === 'free' && slot?.datetime)
    .map((slot) => {
      const datetime = new Date(slot.datetime).toISOString();
      const dateKey = toDateKey(datetime);
      return {
        datetime,
        dateKey,
        hourLabel: formatHourLabel(datetime),
      };
    })
    .filter((slot) => slot.dateKey && (!minDateKey || slot.dateKey >= minDateKey))
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

async function getSlots(tenantId, servicoIds, profissionalId, dateRange = {}) {
  const startDate = String(dateRange.startDate || todayDateKey());
  const serviceIds = normalizeServiceIdsInput(servicoIds);
  const endpoint = '/slots';
  const response = await requestJson(endpoint, {
    query: {
      establishmentId: tenantId,
      weekStart: startDate,
      servico_ids: serviceIds.join(','),
      profissional_id: profissionalId || undefined,
    },
  });
  const freeSlots = response.ok ? extractFreeSlots(response.data, startDate) : [];
  const grouped = new Map();
  freeSlots.forEach((slot) => {
    if (!grouped.has(slot.dateKey)) grouped.set(slot.dateKey, []);
    grouped.get(slot.dateKey).push(slot);
  });
  const days = Array.from(grouped.entries()).map(([dateKey, daySlots]) => ({
    dateKey,
    label: formatDateLabel(dateKey),
    slots: daySlots,
  }));
  return {
    ok: response.ok,
    status: response.status,
    endpoint: response.url,
    elapsedMs: response.elapsedMs || null,
    botErrorCode: response.botErrorCode || response.data?.error_code || null,
    days,
    freeSlots,
    raw: response.data,
  };
}

async function findClientesByPhone(fromPhone) {
  const normalized = normalizePhoneBR(fromPhone);
  if (!normalized) return [];
  const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  const candidates = Array.from(new Set([normalized, local].filter(Boolean)));
  const placeholders = candidates.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, nome, email, telefone
       FROM usuarios
      WHERE tipo='cliente' AND telefone IN (${placeholders})
      ORDER BY id DESC`,
    candidates
  );
  return rows || [];
}

function buildFallbackEmail(phone) {
  const digits = normalizePhoneBR(phone);
  if (!digits) return `wa-${Date.now()}@agendamentos.local`;
  return `wa-${digits}@agendamentos.local`;
}

async function resolveClientForTenant(tenantId, fromPhone) {
  const clientes = await findClientesByPhone(fromPhone);
  if (!clientes.length) return null;
  for (const cliente of clientes) {
    const resp = await requestJson('/agendamentos', {
      authUserId: cliente.id,
    });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    const hasTenantAppointment = rows.some((item) => Number(item.estabelecimento_id) === Number(tenantId));
    if (hasTenantAppointment) {
      return { cliente, appointments: rows, endpoint: resp.url, status: resp.status, elapsedMs: resp.elapsedMs || null };
    }
  }
  // fallback: first candidate, even without appointment in this tenant yet
  return { cliente: clientes[0], appointments: [], endpoint: null, status: 200, elapsedMs: null };
}

function isFutureAppointment(item) {
  const startTs = item?.inicio ? new Date(item.inicio).getTime() : NaN;
  return Number.isFinite(startTs) && startTs > Date.now();
}

function mapAppointment(item, clienteId) {
  const serviceNames = Array.isArray(item?.servicos) && item.servicos.length
    ? item.servicos.map((srv) => String(srv.nome || '')).filter(Boolean)
    : [];
  const serviceLabel = String(item?.servico_nome || serviceNames.join(' + ') || 'Servico');
  const serviceIds = Array.isArray(item?.servico_ids)
    ? item.servico_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : (Number(item?.servico_id) > 0 ? [Number(item.servico_id)] : []);
  return {
    id: Number(item.id),
    clienteId: Number(clienteId),
    estabelecimentoId: Number(item.estabelecimento_id),
    status: String(item.status || ''),
    inicio: item.inicio ? new Date(item.inicio).toISOString() : null,
    fim: item.fim ? new Date(item.fim).toISOString() : null,
    servicoId: serviceIds[0] || null,
    servicoIds: serviceIds,
    servicoNome: serviceLabel,
    profissionalId: Number(item?.profissional_id || 0) || null,
    profissionalNome: item?.profissional_nome || null,
    label: `${serviceLabel} - ${formatDateTimeLabel(item.inicio)}`,
  };
}

function filterRemarcaveis(appointments, tenantId) {
  return (appointments || [])
    .filter((item) => Number(item.estabelecimento_id) === Number(tenantId))
    .filter((item) => isFutureAppointment(item))
    .filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return !['cancelado', 'concluido'].includes(status);
    });
}

function filterCancelaveis(appointments, tenantId) {
  return (appointments || [])
    .filter((item) => Number(item.estabelecimento_id) === Number(tenantId))
    .filter((item) => isFutureAppointment(item))
    .filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return !['cancelado', 'concluido'].includes(status);
    });
}

async function listAgendamentosRemarcaveis(tenantId, fromPhone) {
  const resolved = await resolveClientForTenant(tenantId, fromPhone);
  if (!resolved?.cliente) {
    return {
      ok: false,
      status: 404,
      endpoint: null,
      elapsedMs: null,
      botErrorCode: null,
      agendamentos: [],
      raw: { error: 'cliente_not_found' },
    };
  }
  const filtered = filterRemarcaveis(resolved.appointments, tenantId);
  return {
    ok: true,
    status: 200,
    endpoint: resolved.endpoint,
    elapsedMs: resolved.elapsedMs || null,
    botErrorCode: null,
    clienteId: Number(resolved.cliente.id),
    agendamentos: filtered.map((item) => mapAppointment(item, resolved.cliente.id)),
    raw: { total: filtered.length },
  };
}

async function listAgendamentosCancelaveis(tenantId, fromPhone) {
  const resolved = await resolveClientForTenant(tenantId, fromPhone);
  if (!resolved?.cliente) {
    return {
      ok: false,
      status: 404,
      endpoint: null,
      elapsedMs: null,
      botErrorCode: null,
      agendamentos: [],
      raw: { error: 'cliente_not_found' },
    };
  }
  const filtered = filterCancelaveis(resolved.appointments, tenantId);
  return {
    ok: true,
    status: 200,
    endpoint: resolved.endpoint,
    elapsedMs: resolved.elapsedMs || null,
    botErrorCode: null,
    clienteId: Number(resolved.cliente.id),
    agendamentos: filtered.map((item) => mapAppointment(item, resolved.cliente.id)),
    raw: { total: filtered.length },
  };
}

async function createAgendamento(tenantId, fromPhone, servicoId, profissionalId, datetimeISO, options = {}) {
  const resolved = await resolveClientForTenant(tenantId, fromPhone);
  const cliente = resolved?.cliente || null;
  const nome = String(options?.nome || cliente?.nome || `Cliente ${normalizePhoneBR(fromPhone).slice(-4) || 'WhatsApp'}`).trim();
  const email = String(options?.email || cliente?.email || buildFallbackEmail(fromPhone)).trim().toLowerCase();
  const telefone = normalizePhoneBR(fromPhone);
  const payload = {
    estabelecimento_id: Number(tenantId),
    servico_ids: [Number(servicoId)],
    profissional_id: profissionalId != null ? Number(profissionalId) : undefined,
    inicio: datetimeISO,
    nome,
    email,
    telefone,
    origem: 'whatsapp_bot',
  };

  const response = await requestJson('/public/agendamentos', {
    method: 'POST',
    body: payload,
  });

  return {
    ok: response.ok,
    status: response.status,
    endpoint: response.url,
    elapsedMs: response.elapsedMs || null,
    botErrorCode: response.botErrorCode || response.data?.error_code || null,
    data: response.data,
    payloadSummary: {
      estabelecimento_id: payload.estabelecimento_id,
      servico_ids: payload.servico_ids,
      profissional_id: payload.profissional_id || null,
      inicio: payload.inicio,
      telefone: payload.telefone ? `***${String(payload.telefone).slice(-4)}` : null,
      cliente_known: Boolean(cliente),
    },
  };
}

async function remarcarAgendamento(tenantId, agendamentoId, newDatetimeISO) {
  const id = Number(agendamentoId);
  const payload = { inicio: newDatetimeISO };
  const response = await requestJson(`/agendamentos/${id}/reschedule-estab`, {
    method: 'PUT',
    authUserId: Number(tenantId),
    body: payload,
  });
  return {
    ok: response.ok,
    status: response.status,
    endpoint: response.url,
    elapsedMs: response.elapsedMs || null,
    botErrorCode: response.botErrorCode || response.data?.error_code || null,
    data: response.data,
    payloadSummary: { id, inicio: newDatetimeISO },
  };
}

async function cancelarAgendamento(tenantId, agendamentoId, options = {}) {
  const id = Number(agendamentoId);
  let clienteId = Number(options?.clienteId || 0);
  if (!Number.isFinite(clienteId) || clienteId <= 0) {
    const [[row]] = await pool.query(
      'SELECT cliente_id FROM agendamentos WHERE id=? AND estabelecimento_id=? LIMIT 1',
      [id, Number(tenantId)]
    );
    clienteId = Number(row?.cliente_id || 0);
  }
  if (!Number.isFinite(clienteId) || clienteId <= 0) {
    return {
      ok: false,
      status: 404,
      endpoint: null,
      elapsedMs: null,
      botErrorCode: null,
      data: { error: 'not_found', message: 'Agendamento nao encontrado para este estabelecimento.' },
    };
  }
  const response = await requestJson(`/agendamentos/${id}/cancel`, {
    method: 'PUT',
    authUserId: clienteId,
  });
  return {
    ok: response.ok,
    status: response.status,
    endpoint: response.url,
    elapsedMs: response.elapsedMs || null,
    botErrorCode: response.botErrorCode || response.data?.error_code || null,
    data: response.data,
    payloadSummary: { id, clienteId },
  };
}

function collectNextAvailableDays(slotsResult, limit = 3) {
  const items = Array.isArray(slotsResult?.days) ? slotsResult.days : [];
  return items.slice(0, Math.max(1, Number(limit) || 3)).map((day) => ({
    dateKey: day.dateKey,
    label: day.label,
    totalSlots: Array.isArray(day.slots) ? day.slots.length : 0,
  }));
}

function collectHoursForDay(slotsResult, dateKey) {
  const day = Array.isArray(slotsResult?.days)
    ? slotsResult.days.find((entry) => entry.dateKey === dateKey)
    : null;
  const slots = Array.isArray(day?.slots) ? day.slots : [];
  return slots.map((slot) => ({
    datetime: slot.datetime,
    label: slot.hourLabel,
  }));
}

async function getNextDaysWithAvailability(tenantId, servicoIds, profissionalId, limit = 3) {
  const firstWeekStart = todayDateKey();
  const firstWeek = await getSlots(tenantId, servicoIds, profissionalId, { startDate: firstWeekStart });
  let days = collectNextAvailableDays(firstWeek, limit);
  let endpoint = firstWeek.endpoint;
  let raw = firstWeek.raw;
  if (days.length < limit) {
    const secondWeekStart = addDays(firstWeekStart, 7);
    const secondWeek = await getSlots(tenantId, servicoIds, profissionalId, { startDate: secondWeekStart });
    endpoint = `${firstWeek.endpoint};${secondWeek.endpoint}`;
    raw = { firstWeek: firstWeek.raw, secondWeek: secondWeek.raw };
    const merged = [...(firstWeek.days || []), ...(secondWeek.days || [])];
    const dedup = new Map();
    merged.forEach((entry) => {
      if (!entry?.dateKey || dedup.has(entry.dateKey)) return;
      dedup.set(entry.dateKey, entry);
    });
    days = collectNextAvailableDays({ days: Array.from(dedup.values()) }, limit);
  }
  return {
    ok: firstWeek.ok,
    status: firstWeek.status,
    endpoint,
    elapsedMs: firstWeek.elapsedMs || null,
    botErrorCode: firstWeek.botErrorCode || null,
    days,
    raw,
  };
}

export {
  listServicos,
  listProfissionaisPorServico,
  getSlots,
  createAgendamento,
  getNextDaysWithAvailability,
  collectHoursForDay,
  normalizePhoneBR,
  toDateKey,
  todayDateKey,
  listAgendamentosRemarcaveis,
  listAgendamentosCancelaveis,
  remarcarAgendamento,
  cancelarAgendamento,
};
