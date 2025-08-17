// src/utils/api.js
import { getToken } from './auth';

const BASE = 'http://localhost:3001';

async function req(path, opt = {}) {
  const r = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + getToken()
    },
    ...opt
  });
  if (!r.ok) {
    let e = 'api_error';
    try { e = (await r.json()).error; } catch {}
    throw new Error(e);
  }
  return r.json();
}

export const Api = {
  // Auth
  register: (payload) => req('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email, senha) => req('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) }),
  me: () => req('/auth/me'),

  // Estabelecimentos + Serviços (NOVOS)
  listEstablishments: () => req('/establishments'),
  listServices: (establishmentId) => req(`/servicos?establishmentId=${establishmentId}`),

  // Serviços (rotas existentes)
  servicosList: () => req('/servicos'),
  servicosCreate: (payload) => req('/servicos', { method: 'POST', body: JSON.stringify(payload) }),
  servicosUpdate: (id, payload) => req('/servicos/' + id, { method: 'PUT', body: JSON.stringify(payload) }),
  servicosDelete: (id) => req('/servicos/' + id, { method: 'DELETE' }),

  // Slots
  getSlots: (establishmentId, weekStart) => req(`/slots?establishmentId=${establishmentId}&weekStart=${weekStart}`),
  toggleSlot: (slotDatetime) => req('/slots/toggle', { method: 'POST', body: JSON.stringify({ slotDatetime }) }),

  // Agendamentos
  agendar: (payload) => req('/agendamentos', { method: 'POST', body: JSON.stringify(payload) }),
  meusAgendamentos: () => req('/agendamentos'),
  agendamentosEstabelecimento: () => req('/agendamentos/estabelecimento'),
  cancelarAgendamento: (id) => req('/agendamentos/' + id + '/cancel', { method: 'PUT' }),

  // Notificações (NOVO)
  // Usado pelo NovoAgendamento.jsx para programar lembretes de WhatsApp
  // payload esperado: { to, scheduledAt, message, metadata? }
  scheduleWhatsApp: (payload) =>
    req('/notifications/whatsapp/schedule', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
};
