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

let BASE_URL_OBJ = null;
try {
  BASE_URL_OBJ = new URL(BASE);
} catch {}

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
        const msg = (data && (data.message || data.error)) || 'Sua sessão expirou. Faça login novamente.';
        localStorage.setItem('session_message', String(msg).toLowerCase().includes('expir')
          ? 'Sua sessão expirou. Faça login novamente.'
          : 'Seu acesso não é mais válido. Faça login novamente.');
      } catch {}
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    throw err;
  }

  return isJson ? data : text || null;
}

function normalizeAssetPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function resolveAssetUrl(value) {
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  if (/^https?:\/\//i.test(value)) return value;

  const path = normalizeAssetPath(value);

  if (BASE_URL_OBJ) {
    const origin = BASE_URL_OBJ.origin;
    if (path.startsWith('/uploads/')) {
      return `${origin}/api${path}`;
    }
    if (path.startsWith('/api/uploads/')) {
      return `${origin}${path}`;
    }
    try {
      return new URL(path, BASE_URL_OBJ).toString();
    } catch {}
  }

  try {
    return new URL(path, BASE).toString();
  } catch {
    return path;
  }
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
  listEstablishments: (params = {}) => req(`/establishments${toQuery(params)}`),
  getEstablishment: (idOrSlug) => req(`/establishments/${idOrSlug}`),
  getEstablishmentClients: (id, params = {}) =>
    req(`/establishments/${id}/clients${toQuery(params)}`),
  getEstablishmentReviews: (id, params = {}) =>
    req(`/establishments/${id}/reviews${toQuery(params)}`),
  saveEstablishmentReview: (id, payload) =>
    req(`/establishments/${id}/review`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteEstablishmentReview: (id) => req(`/establishments/${id}/review`, { method: 'DELETE' }),
  favoriteEstablishment: (id) => req(`/establishments/${id}/favorite`, { method: 'POST' }),
  unfavoriteEstablishment: (id) => req(`/establishments/${id}/favorite`, { method: 'DELETE' }),
  listEstablishmentImages: (id) => req(`/establishments/${id}/images`),
  addEstablishmentImage: (id, payload) =>
    req(`/establishments/${id}/images`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteEstablishmentImage: (id, imageId) => req(`/establishments/${id}/images/${imageId}`, { method: 'DELETE' }),
  reorderEstablishmentImages: (id, order) =>
    req(`/establishments/${id}/images/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
  getEstablishmentMessages: (id) => req(`/establishments/${id}/messages`),
  updateEstablishmentMessages: (id, payload) => req(`/establishments/${id}/messages`, { method: 'PUT', body: JSON.stringify(payload) }),
  updateEstablishmentSlug: (id, slug) => req(`/establishments/${id}/slug`, { method: 'PUT', body: JSON.stringify({ slug }) }),
  updateEstablishmentPlan: (id, payload) => req(`/establishments/${id}/plan`, { method: 'PUT', body: JSON.stringify(payload) }),
  updateEstablishmentProfile: (id, payload) =>
    req(`/establishments/${id}/profile`, { method: 'PUT', body: JSON.stringify(payload) }),
  getEstablishmentStats: (id) => req(`/establishments/${id}/stats`),
  listServices: (establishmentId) => req(`/servicos${toQuery({ establishmentId })}`),

  // Billing (assinaturas Mercado Pago)
  billingSubscription: () => req('/billing/subscription'),
  billingPixPending: (params = {}) => req(`/billing/pix/pending${toQuery(params)}`),
  // PIX fallback (primeiro ciclo)
  billingPixCheckout: (payload) => {
    const body = { ...payload };
    if (body.billing_cycle == null) body.billing_cycle = 'mensal';
    return req('/billing/pix', { method: 'POST', body: JSON.stringify(body) });
  },
  billingStatus: () => req('/billing/status'),
  billingWhatsAppPacks: () => req('/billing/whatsapp/packs'),
  billingWhatsAppWallet: () => req('/billing/whatsapp/wallet'),
  billingWhatsAppPix: (payload) => req('/billing/whatsapp/pix', { method: 'POST', body: JSON.stringify(payload || {}) }),
  billingWhatsAppPixStatus: (paymentId) =>
    req(`/billing/whatsapp/pix/status${toQuery({ payment_id: paymentId })}`),

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
  agendarEstabelecimento: (payload, opts = {}) =>
    req('/agendamentos/estabelecimento', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: opts.idempotencyKey,
    }),
  meusAgendamentos: () => req('/agendamentos'),
  agendamentosEstabelecimento: (status) => req(`/agendamentos/estabelecimento${toQuery({ status })}`),
  cancelarAgendamento: (id) => req(`/agendamentos/${id}/cancel`, { method: 'PUT' }),
  cancelarAgendamentoEstab: (id) => req(`/agendamentos/${id}/cancel-estab`, { method: 'PUT' }),
  reagendarAgendamentoEstab: (id, payload) =>
    req(`/agendamentos/${id}/reschedule-estab`, { method: 'PUT', body: JSON.stringify(payload) }),

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
