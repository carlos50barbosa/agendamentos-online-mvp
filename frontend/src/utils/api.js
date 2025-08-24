// src/utils/api.js
import { getToken } from './auth';

// Base robusta:
// 1) Usa VITE_API_URL (produção recomendada)
// 2) Em dev, cai para http://localhost:3002
// 3) Em produção sem VITE_API_URL, usa o mesmo domínio do front (window.location.origin)
const BASE = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3002' : window.location.origin)
).replace(/\/$/, '');

function join(base, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function req(path, opt = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(opt.headers || {}),
  };
  // Evita enviar "Bearer null" nos endpoints públicos (/auth/login, /auth/register)
  const isPublicAuth = /^\/?auth\/(login|register)/i.test(path);
  if (token && !isPublicAuth) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(join(BASE, path), {
    method: opt.method || 'GET',
    body: opt.body,
    headers,
    // Se usar cookies/sessão no backend, habilite:
    // credentials: 'include',
    ...opt,
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data = null;
  let text = '';

  try {
    if (isJson) data = await res.json();
    else text = await res.text();
  } catch {
    // corpo vazio ou inválido — segue com null/texto vazio
  }

  if (!res.ok) {
    const detail =
      (data && (data.error || data.message)) ||
      text ||
      '';
    throw new Error(`HTTP ${res.status}${detail ? ` - ${detail}` : ''}`);
  }

  return isJson ? data : text || null;
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
  // payload esperado: { to, scheduledAt, message, metadata? }
  scheduleWhatsApp: (payload) =>
    req('/notifications/whatsapp/schedule', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
};

// Exporta para depuração no console do navegador, se precisar conferir a base ativa
export const API_BASE_URL = BASE;