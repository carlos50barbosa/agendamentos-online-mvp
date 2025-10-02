// src/utils/api.js
import { getToken, logout } from './auth';

// Base robusta:
// 1) Usa VITE_API_URL (produÃ§Ã£o recomendada)
// 2) Em dev, cai para http://localhost:3002
// 3) Em produÃ§Ã£o sem VITE_API_URL, usa o mesmo domÃ­nio do front (window.location.origin)
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

  // extra (nÃ£o vai para fetch): idempotencyKey
  const { idempotencyKey, ...fetchOpt } = opt;

  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOpt.headers || {}),
  };

  // Evita enviar "Bearer null" nos endpoints pÃºblicos (/auth/login, /auth/register)
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
    // corpo vazio/invalid â€” segue com null/texto vazio
  }

  if (!res.ok) {
    const detail =
      (data && (data.message || data.error)) ||
      text ||
      '';
    const err = new Error(detail ? `${detail}` : `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    err.text = text;
    err.url = join(BASE, path);

    // Se o token expirou (ou outro 401), limpa sessÃ£o e redireciona para login
    const tokenStillPresent = !!token;
    const isAuthRoute = isPublicAuth;
    if (res.status === 401 && tokenStillPresent && !isAuthRoute) {
      try { logout(); } catch {}
      try {
        const msg = (data && (data.message || data.error)) || 'Sua sessÃ£o expirou. FaÃ§a login novamente.';
        localStorage.setItem('session_message', String(msg).toLowerCase().includes('expir')
          ? 'Sua sessÃ£o expirou. FaÃ§a login novamente.'
          : 'Seu acesso nÃ£o Ã© mais vÃ¡lido. FaÃ§a login novamente.');
      } catch {}
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    throw err;
  }

  return isJson ? data : text || null;
}

export const Api = {
  // Auth
  register: (payload) => req('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email, senha) => req('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) }),
  me: () => req('/auth/me'),
  updateProfile: (payload) => req('/auth/me', { method: 'PUT', body: JSON.stringify(payload) }),
  confirmEmailChange: (payload) => req('/auth/me/email-confirm', { method: 'POST', body: JSON.stringify(payload) }),
  requestPasswordReset: (email) => req('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, senha) => req('/auth/reset', { method: 'POST', body: JSON.stringify({ token, senha }) }),
  linkPhone: (token) => req('/auth/link-phone', { method: 'POST', body: JSON.stringify({ token }) }),

  // Estabelecimentos + ServiÃ§os (NOVOS)
  listEstablishments: () => req('/establishments'),
  getEstablishment: (idOrSlug) => req(`/establishments/${idOrSlug}`),
  getEstablishmentMessages: (id) => req(`/establishments/${id}/messages`),
  updateEstablishmentMessages: (id, payload) => req(`/establishments/${id}/messages`, { method: 'PUT', body: JSON.stringify(payload) }),
  updateEstablishmentSlug: (id, slug) => req(`/establishments/${id}/slug`, { method: 'PUT', body: JSON.stringify({ slug }) }),
  updateEstablishmentPlan: (id, payload) => req(`/establishments/${id}/plan`, { method: 'PUT', body: JSON.stringify(payload) }),
  getEstablishmentStats: (id) => req(`/establishments/${id}/stats`),
  listServices: (establishmentId) => req(`/servicos${toQuery({ establishmentId })}`),

  // Billing (assinaturas Mercado Pago)
  billingCreateCheckout: (payload) => {
    const body = { ...payload };
    if (body.billing_cycle == null) body.billing_cycle = 'mensal';
    return req('/billing/checkout-session', { method: 'POST', body: JSON.stringify(body) });
  },
  billingSubscription: () => req('/billing/subscription'),
  billingSync: (preapproval_id) => req(`/billing/sync${toQuery({ preapproval_id })}`),
  billingChangeCheckout: (target_plan, billing_cycle) => {
    const payload = { target_plan };
    if (billing_cycle) payload.billing_cycle = billing_cycle;
    return req('/billing/change', { method: 'POST', body: JSON.stringify(payload) });
  },

  // ServiÃ§os (rotas existentes)
  servicosList: () => req('/servicos'),
  servicosCreate: (payload) => req('/servicos', { method: 'POST', body: JSON.stringify(payload) }),
  servicosUpdate: (id, payload) => req(`/servicos/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  servicosDelete: (id) => req(`/servicos/${id}`, { method: 'DELETE' }),

  // Slots
  // Obs.: includeBusy Ã© opcional; se o backend suportar, retorna tambÃ©m ocupados/bloqueados.
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
  agendamentosEstabelecimento: (status) => req(`/agendamentos/estabelecimento${toQuery({ status })}`),
  cancelarAgendamento: (id) => req(`/agendamentos/${id}/cancel`, { method: 'PUT' }),

  // NotificaÃ§Ãµes (NOVO)
  scheduleWhatsApp: (payload) =>
    req('/notifications/whatsapp/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin (manutenÃ§Ã£o)
  adminCleanup: (adminToken) =>
    req('/admin/cleanup', {
      method: 'POST',
      headers: { 'X-Admin-Token': String(adminToken || '') },
    }),

  // PÃºblico (sem login)
  publicAgendar: (payload, opts = {}) =>
    req('/public/agendamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: opts.idempotencyKey,
    }),

  relatoriosEstabelecimento: (params = {}) => req(`/relatorios/estabelecimento${toQuery(params)}`),
  downloadRelatorio: async (type, params = {}) => {
    const search = { ...params, download: type };
    const token = getToken();
    const url = join(BASE, `/relatorios/estabelecimento${toQuery(search)}`);
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(url, { headers });
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
      let detail = '';
      if (contentType.includes('application/json')) {
        try {
          const data = await res.json();
          detail = data?.message || data?.error || '';

        } catch {}
      } else {
        try {
          detail = await res.text();
        } catch {}
      }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      err.url = url;
      err.text = detail;
      throw err;
    }

    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const rawName = filenameMatch ? filenameMatch[1] : `relatorio-${type}.csv`;
    let filename = rawName;
    try {
      filename = decodeURIComponent(rawName);
    } catch {}
    const blob = await res.blob();
    return { blob, filename };
  },
  requestOtp: (channel, value) => req('/public/otp/request', { method: 'POST', body: JSON.stringify({ channel, value }) }),
  verifyOtp: (request_id, code) => req('/public/otp/verify', { method: 'POST', body: JSON.stringify({ request_id, code }) }),
  
  // Profissionais
  profissionaisPublicList: (establishmentId) => req(`/profissionais${toQuery({ establishmentId })}`),
  profissionaisList: () => req('/profissionais'),
  profissionaisCreate: (payload) => req('/profissionais', { method: 'POST', body: JSON.stringify(payload) }),
  profissionaisUpdate: (id, payload) => req(`/profissionais/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  profissionaisDelete: (id) => req(`/profissionais/${id}`, { method: 'DELETE' }),
};

// Exporta para depuraÃ§Ã£o no console do navegador
export const API_BASE_URL = BASE;




