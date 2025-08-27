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

function toQuery(params = {}) {
  const esc = encodeURIComponent;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${esc(k)}=${esc(v)}`).join('&');
}

async function req(path, opt = {}) {
  const token = getToken();

  // extra (não vai para fetch): idempotencyKey
  const { idempotencyKey, ...fetchOpt } = opt;

  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOpt.headers || {}),
  };

  // Evita enviar "Bearer null" nos endpoints públicos (/auth/login, /auth/register)
  const isPublicAuth = /^\/?auth\/(login|register)/i.test(path);
  if (token && !isPublicAuth) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = String(idempotencyKey);
  }

  const res = await fetch(join(BASE, path), {
    method: fetchOpt.method || 'GET',
    body: fetchOpt.body,
    headers,
    ...fetchOpt,
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data = null;
  let text = '';

  try {
    if (isJson) data = await res.json();
    else text = await res.text();
  } catch {
    // corpo vazio/invalid — segue com null/texto vazio
  }

  if (!res.ok) {
    const detail =
      (data && (data.error || data.message)) ||
      text ||
      '';
    const err = new Error(detail ? `${detail}` : `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    err.text = text;
    err.url = join(BASE, path);
    throw err;
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
  listServices: (establishmentId) => req(`/servicos${toQuery({ establishmentId })}`),

  // Serviços (rotas existentes)
  servicosList: () => req('/servicos'),
  servicosCreate: (payload) => req('/servicos', { method: 'POST', body: JSON.stringify(payload) }),
  servicosUpdate: (id, payload) => req(`/servicos/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  servicosDelete: (id) => req(`/servicos/${id}`, { method: 'DELETE' }),

  // Slots
  // Obs.: includeBusy é opcional; se o backend suportar, retorna também ocupados/bloqueados.
  getSlots: (establishmentId, weekStart, { includeBusy } = {}) =>
    req(`/slots${toQuery({ establishmentId, weekStart, includeBusy: includeBusy ? 1 : undefined })}`),

  toggleSlot: (slotDatetime) => req('/slots/toggle', { method: 'POST', body: JSON.stringify({ slotDatetime }) }),

  // Agendamentos
  // Agora aceita opcional { idempotencyKey }
  agendar: (payload, opts = {}) =>
    req('/agendamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: opts.idempotencyKey,
    }),
  meusAgendamentos: () => req('/agendamentos'),
  agendamentosEstabelecimento: () => req('/agendamentos/estabelecimento'),
  cancelarAgendamento: (id) => req(`/agendamentos/${id}/cancel`, { method: 'PUT' }),

  // Notificações (NOVO)
  scheduleWhatsApp: (payload) =>
    req('/notifications/whatsapp/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// Exporta para depuração no console do navegador
export const API_BASE_URL = BASE;
