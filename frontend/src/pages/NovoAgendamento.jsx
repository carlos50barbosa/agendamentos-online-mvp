// src/pages/NovoAgendamento.jsx

import React, { Suspense, useEffect, useMemo, useState, useCallback, useRef } from "react";

import { Link, useSearchParams, useLocation, useParams } from "react-router-dom";

import { Api, resolveAssetUrl } from "../utils/api";

import { getUser } from "../utils/auth";

import AppointmentDiscoveryHero from "../components/AppointmentDiscoveryHero.jsx";

import { IconMapPin, IconList, IconStar, IconGear } from "../components/Icons.jsx";



const LazyModals = React.lazy(() => import("./NovoAgendamentoModals.jsx"));

const FAVORITES_CACHE_KEY = 'ao:favorites_local';

const ESTABLISHMENTS_PAGE_SIZE_MOBILE = 8;

const ESTABLISHMENTS_PAGE_SIZE_DESKTOP = 20;

const ESTABLISHMENTS_PAGE_SIZE_BREAKPOINT = 768;

const getEstablishmentsPageSize = () => {

  if (typeof window === 'undefined') return ESTABLISHMENTS_PAGE_SIZE_DESKTOP;

  return window.innerWidth < ESTABLISHMENTS_PAGE_SIZE_BREAKPOINT

     ? ESTABLISHMENTS_PAGE_SIZE_MOBILE

    : ESTABLISHMENTS_PAGE_SIZE_DESKTOP;

};

const QUERY_DEBOUNCE_MS = 180;

const PUBLIC_PAGE_THEME_DEFAULTS = Object.freeze({
  accent: "#0f766e",
  accentStrong: "#164e63",
});

const APPOINTMENT_FLOW_STEPS = Object.freeze([
  "Estabelecimento",
  "Servico",
  "Horario",
  "Confirmacao",
]);

const APPOINTMENT_FLOW_STEP_SHORT_LABELS = Object.freeze({
  Estabelecimento: "Local",
  Servico: "Servico",
  Horario: "Horario",
  Confirmacao: "Confirmar",
});

const DISCOVERY_SORT_OPTIONS = Object.freeze([
  { value: "relevance", label: "Relevancia" },
  { value: "proximity", label: "Proximidade" },
  { value: "rating", label: "Melhor avaliacao" },
  { value: "availability", label: "Disponibilidade", disabled: true },
]);

const DISCOVERY_CATEGORY_FILTERS = Object.freeze([
  { value: "barbearia", label: "Barbearia" },
  { value: "salao", label: "Salao" },
  { value: "clinica", label: "Clinica" },
]);

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(prefixed)) return "";
  if (prefixed.length === 4) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  return prefixed.toLowerCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

function mixColors(hexA, hexB, weight = 0.5) {
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  if (!colorA || !colorB) return normalizeHexColor(hexA) || normalizeHexColor(hexB) || "";

  const safeWeight = Math.max(0, Math.min(1, weight));
  const mixChannel = (channel) => Math.round((colorA[channel] * safeWeight) + (colorB[channel] * (1 - safeWeight)));
  const mixed = [mixChannel("r"), mixChannel("g"), mixChannel("b")]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return `#${mixed}`;
}

/* =================== Helpers de Data =================== */

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

const DateHelpers = {

  // Parse de 'YYYY-MM-DD' como data local (evita UTC)

  parseLocal: (dateish) => {

    if (dateish instanceof Date) return new Date(dateish);

    if (typeof dateish === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateish)){

      const [y,m,d] = dateish.split('-').map(Number);

      return new Date(y, m-1, d, 0, 0, 0, 0);

    }

    return new Date(dateish);

  },

  formatLocalISO: (date) => {

    const y = date.getFullYear();

    const m = String(date.getMonth()+1).padStart(2,'0');

    const d = String(date.getDate()).padStart(2,'0');

    return `${y}-${m}-${d}`;

  },

  weekStartISO: (d = new Date()) => {

    const date = DateHelpers.parseLocal(d);

    const day = date.getDay(); // 0=Dom

    const diff = (day + 6) % 7; // 1=Seg

    date.setHours(0, 0, 0, 0);

    date.setDate(date.getDate() - diff);

    return DateHelpers.formatLocalISO(date);

  },

  toISODate: (d) => {

    const date = DateHelpers.parseLocal(d);

    date.setHours(0, 0, 0, 0);

    return DateHelpers.formatLocalISO(date);

  },

  addDays: (d, n) => {

    const date = DateHelpers.parseLocal(d);

    date.setDate(date.getDate() + n);

    return date;

  },

  addMinutes: (d, n) => {

    const date = new Date(d);

    date.setMinutes(date.getMinutes() + n);

    return date;

  },

  addWeeksISO: (iso, n) => DateHelpers.toISODate(DateHelpers.addDays(DateHelpers.parseLocal(iso), n * 7)),

  sameYMD: (a, b) => a.slice(0, 10) === b.slice(0, 10),

  weekDays: (isoMonday) => {

    const base = DateHelpers.parseLocal(isoMonday);

    return Array.from({ length: 7 }).map((_, i) => {

      const d = DateHelpers.addDays(base, i);

      return { iso: DateHelpers.toISODate(d), date: d };

    });

  },

  firstOfMonthISO: (d = new Date()) => {

    const dt = DateHelpers.parseLocal(d);

    dt.setDate(1);

    dt.setHours(0,0,0,0);

    return DateHelpers.formatLocalISO(dt);

  },

  addMonths: (d, n) => {

    const dt = DateHelpers.parseLocal(d);

    const day = dt.getDate();

    dt.setDate(1);

    dt.setMonth(dt.getMonth() + n);

    const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();

    dt.setDate(Math.min(day, lastDay));

    return dt;

  },

  monthGrid: (monthStartIso) => {

    // Retorna 6 linhas x 7 colunas começando na segunda-feira

    const first = DateHelpers.parseLocal(monthStartIso);

    first.setDate(1);

    const firstWeekday = (first.getDay() + 6) % 7; // 0=Seg

    const start = DateHelpers.addDays(first, -firstWeekday);

    const cells = [];

    for(let i=0;i<42;i++){

      const d = DateHelpers.addDays(start, i);

      const iso = DateHelpers.toISODate(d);

      const inMonth = d.getMonth() === first.getMonth();

      cells.push({ iso, inMonth, date: d });

    }

    return cells;

  },

  isSameMonth: (isoA, isoB) => {

    const a = DateHelpers.parseLocal(isoA);

    const b = DateHelpers.parseLocal(isoB);

    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

  },

  formatWeekLabel: (isoMonday) => {

    const days = DateHelpers.weekDays(isoMonday);

    const start = days[0].date;

    const end = days[6].date;

    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

    const s1 = fmt.format(start);

    const s2 = fmt.format(end);

    return `${s1} • ${s2}`.replace(/\./g, "");

  },

  formatTime: (datetime) => {

    const dt = new Date(datetime);

    const hh = String(dt.getHours()).padStart(2, "0");

    const mm = String(dt.getMinutes()).padStart(2, "0");

    return `${hh}:${mm}`;

  },

  isPastSlot: (datetime) => new Date(datetime).getTime() < Date.now(),

  formatDateFull: (date) =>

    new Date(date).toLocaleDateString("pt-BR", {

      weekday: "long",

      day: "2-digit",

      month: "long",

      year: "numeric",

    }),

};

const ratingNumberFormatter = new Intl.NumberFormat('pt-BR', {

  minimumFractionDigits: 1,

  maximumFractionDigits: 1,

});

// Semana [Monday 00:00, next Monday 00:00)

const weekRangeMs = (isoMonday) => {

  const start = DateHelpers.parseLocal(isoMonday); start.setHours(0,0,0,0);

  const end = new Date(start); end.setDate(end.getDate() + 7);

  return { start: +start, end: +end };

};

// Chave do overlay persistido por estabelecimento + semana

const fbKey = (establishmentId, isoMonday) => `fb:${establishmentId}:${isoMonday}`;

/* =================== Helpers de Serviço =================== */

const ServiceHelpers = {

  title: (s) => s?.title || s?.nome || `Serviço #${s?.id ?? ""}`,

  duration: (s) => Number(s?.duracao_min ?? s?.duration ?? 0),

  price: (s) => Number(s?.preco_centavos ?? s?.preco ?? s?.price_centavos ?? 0),

  description: (s) => (s?.descricao || s?.description || '').trim(),

  formatPrice: (centavos) =>

    (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),

};

const summarizeServices = (list = []) => {

  const names = list.map((svc) => ServiceHelpers.title(svc)).filter(Boolean);

  const duration = list.reduce((sum, svc) => sum + ServiceHelpers.duration(svc), 0);

  const price = list.reduce((sum, svc) => sum + ServiceHelpers.price(svc), 0);

  return {

    names,

    label: names.join(" + "),

    duration,

    price,

  };

};

const SOCIAL_LINK_FIELDS = [

  { key: "site_url", label: "Site" },

  { key: "instagram_url", label: "Instagram" },

  { key: "facebook_url", label: "Facebook" },

  { key: "linkedin_url", label: "LinkedIn" },

  { key: "youtube_url", label: "YouTube" },

  { key: "tiktok_url", label: "TikTok" },

];

const ensureExternalUrl = (value) => {

  if (!value) return "";

  const trimmed = String(value || "").trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  return `https://${trimmed.replace(/^https?:\/\//i, "")}`;

};

const formatPhoneDisplay = (value = "") => {

  let digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.length > 11 && digits.startsWith("55")) {

    digits = digits.slice(2);

  }

  if (digits.length > 11) {

    digits = digits.slice(-11);

  }

  if (digits.length <= 2) return digits;

  const ddd = digits.slice(0, 2);

  const rest = digits.slice(2);

  if (!rest) return `(${ddd})`;

  if (rest.length <= 4) return `(${ddd}) ${rest}`;

  if (rest.length === 7) return `(${ddd}) ${rest.slice(0, 3)}-${rest.slice(3)}`;

  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;

  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;

  return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;

};

const normalizePhoneDigits = (value = "") => {

  let digits = String(value || "").replace(/\D/g, "");

  if (digits.length > 11 && digits.startsWith("55")) {

    digits = digits.slice(2);

  }

  if (digits.length > 11) {

    digits = digits.slice(-11);

  }

  return digits;

};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (value = "") => EMAIL_REGEX.test(String(value || "").trim().toLowerCase());

const genIdempotencyKey = () => `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createGuestModalState = () => ({
  open: false,
  loading: false,
  step: "form", // form|otp|success

  name: "",

  email: "",

  phone: "",

  data_nascimento: "",

  cep: "",

  endereco: "",

  numero: "",

  complemento: "",

  bairro: "",

  cidade: "",

  estado: "",

  otpReqId: "",

  otpCode: "",

  otpToken: "",

  error: "",
  info: "",
});
const createDepositModalState = () => ({
  open: false,
  status: "pending",
  paymentId: null,
  appointmentId: null,
  expiresAt: null,
  amountCents: null,
  pix: null,
  depositToken: null,
  appointmentInfo: null,
});
const formatCountdown = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};
const extractDepositPayload = (response) => {
  if (!response || typeof response !== "object") return null;
  const paymentId =
    response.paymentId ||
    response.payment_id ||
    response?.deposit?.payment_id ||
    response?.payment?.id ||
    null;
  if (!paymentId) return null;
  const pix = response.pix || response.deposit?.pix || {};
  const depositToken =
    response.deposit_token ||
    response?.deposit?.token ||
    response?.deposit?.deposit_token ||
    response?.token ||
    null;
  const appointmentId = response.agendamentoId || response.id || response.agendamento_id || null;
  const expiresAt =
    response.expiresAt ||
    response.expires_at ||
    response.deposit_expires_at ||
    response.deposit?.expires_at ||
    pix?.expires_at ||
    null;
  const amountCents =
    response.amount_centavos ||
    response.deposit_centavos ||
    response.deposit?.amount_centavos ||
    pix?.amount_cents ||
    null;
  const qrCodeBase64 = response.pix_qr || pix?.qr_code_base64 || null;
  const qrCodeRaw = response.pix_qr_raw || pix?.qr_code || null;
  const copiaECola = response.pix_copia_cola || pix?.copia_e_cola || qrCodeRaw || null;
  const ticketUrl = response.pix_ticket_url || pix?.ticket_url || null;
  return {
    paymentId,
    appointmentId,
    expiresAt,
    amountCents,
    depositToken,
    pix: {
      qr_code_base64: qrCodeBase64,
      qr_code: qrCodeRaw,
      copia_e_cola: copiaECola,
      ticket_url: ticketUrl,
      expires_at: pix?.expires_at || null,
      amount_cents: pix?.amount_cents || null,
    },
  };
};
/* =================== Janela 07•22 =================== */

const DEFAULT_BUSINESS_HOURS = { start: 7, end: 22 };

const normalizeText = (value) =>

  String(value || '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase();

const toSlug = (value = '') => {

  const normalized = String(value || '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, '-')

    .replace(/^-+|-+$/g, '');

  return normalized || 'estabelecimento';

};

const normalizeDayToken = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '');

const DAY_TOKEN_MAP = Object.freeze({

  sunday: ['domingo', 'dom', 'domingo-feira', 'sun', 'sunday'],

  monday: ['segunda', 'segunda-feira', 'seg', '2a', 'mon', 'monday'],

  tuesday: ['terça', 'terca', 'terça-feira', 'terca-feira', 'ter', 'tue', 'tuesday'],

  wednesday: ['quarta', 'quarta-feira', 'qua', 'wed', 'wednesday'],

  thursday: ['quinta', 'quinta-feira', 'qui', 'thu', 'thursday'],

  friday: ['sexta', 'sexta-feira', 'sex', 'fri', 'friday'],

  saturday: ['sábado', 'sabado', 'sábado-feira', 'sab', 'sat', 'saturday'],

});

const DAY_SLUG_TO_INDEX = Object.freeze({

  sunday: 0,

  monday: 1,

  tuesday: 2,

  wednesday: 3,

  thursday: 4,

  friday: 5,

  saturday: 6,

});

const DAY_TOKEN_LOOKUP = (() => {

  const map = new Map();

  Object.entries(DAY_TOKEN_MAP).forEach(([slug, tokens]) => {

    tokens.forEach((token) => {

      const normalized = normalizeDayToken(token);

      if (normalized) map.set(normalized, slug);

    });

  });

  return map;

})();

const TIME_VALUE_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const ensureTimeValue = (value) => {

  if (value == null) return '';

  const text = String(value).trim();

  if (!text) return '';

  const direct = text.match(/^(\d{1,2})(?:[:h](\d{2}))?$/i);

  if (direct) {

    const hours = Number(direct[1]);

    const minutes = Number(direct[2] ?? '00');

    if (

      Number.isInteger(hours) &&

      hours >= 0 &&

      hours <= 23 &&

      Number.isInteger(minutes) &&

      minutes >= 0 &&

      minutes <= 59

    ) {

      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    }

  }

  const digits = text.replace(/\D/g, '');

  if (!digits) return '';

  if (digits.length <= 2) {

    const hours = Number(digits);

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return '';

    return `${String(hours).padStart(2, '0')}:00`;

  }

  const hoursNum = Number(digits.slice(0, -2));

  const minutesNum = Number(digits.slice(-2));

  if (

    !Number.isInteger(hoursNum) ||

    hoursNum < 0 ||

    hoursNum > 23 ||

    !Number.isInteger(minutesNum) ||

    minutesNum < 0 ||

    minutesNum > 59

  ) {

    return '';

  }

  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;

};

const toMinutes = (value) => {

  if (!TIME_VALUE_REGEX.test(String(value || ''))) return null;

  const [hours, minutes] = String(value).split(':').map(Number);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;

  return hours * 60 + minutes;

};

const parseTimeRangeHint = (label) => {

  if (!label) return { start: '', end: '' };

  const matches = Array.from(String(label).matchAll(/(\d{1,2})(?:[:h](\d{2}))?/gi));

  if (!matches.length) return { start: '', end: '' };

  const times = matches

    .map(([_, hh, mm]) => ensureTimeValue(`${hh}${mm ?? ''}`))

    .filter(Boolean);

  if (!times.length) return { start: '', end: '' };

  const [start, end] = times;

  return { start: start || '', end: end || '' };

};

const resolveDayIndex = (entry) => {

  if (!entry) return null;

  const explicitSlug =

    entry.day ||

    entry.weekday ||

    entry.week_day ||

    entry.key ||

    entry.dia ||

    null;

  if (explicitSlug && DAY_SLUG_TO_INDEX.hasOwnProperty(explicitSlug)) {

    return DAY_SLUG_TO_INDEX[explicitSlug];

  }

  const labelToken = normalizeDayToken(entry.label || '');

  if (labelToken && DAY_TOKEN_LOOKUP.has(labelToken)) {

    return DAY_SLUG_TO_INDEX[DAY_TOKEN_LOOKUP.get(labelToken)];

  }

  if (entry.value) {

    const firstPart = String(entry.value).split(/[:\-]/)[0];

    const normalized = normalizeDayToken(firstPart || '');

    if (normalized && DAY_TOKEN_LOOKUP.has(normalized)) {

      return DAY_SLUG_TO_INDEX[DAY_TOKEN_LOOKUP.get(normalized)];

    }

  }

  return null;

};

const buildWorkingSchedule = (entries) => {

  if (!Array.isArray(entries) || !entries.length) return null;

  const rules = Array.from({ length: 7 }, () => ({

    enabled: false,

    isClosed: false,

    start: '',

    end: '',

    startMinutes: null,

    endMinutes: null,

    blocks: [],

    breaks: [],

    blockMinutes: [],

  }));

  const recognized = new Set();

  entries.forEach((item) => {

    const dayIndex = resolveDayIndex(item);

    if (dayIndex == null) return;

    recognized.add(dayIndex);

    const valueText = normalizeText(item.value || '');

    if (/fechado|sem atendimento|nao atende/.test(valueText)) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      };

      return;

    }

    let start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? '');

    let end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? '');

    if ((!start || !end) && item.value) {

      const parsed = parseTimeRangeHint(item.value);

      if (!start && parsed.start) start = parsed.start;

      if (!end && parsed.end) end = parsed.end;

    }

    if (!start || !end) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      };

      return;

    }

    const startMinutes = toMinutes(start);

    const endMinutes = toMinutes(end);

    if (

      startMinutes == null ||

      endMinutes == null ||

      startMinutes >= endMinutes

    ) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      };

      return;

    }

    const rawBlocks = Array.isArray(item.blocks)

      ? item.blocks

      : Array.isArray(item.breaks)

        ? item.breaks

        : item.block_start || item.blockStart || item.block_end || item.blockEnd

          ? [{

            start: item.block_start ?? item.blockStart ?? null,

            end: item.block_end ?? item.blockEnd ?? null,

          }]

          : [];

    const sanitizedBlocks = [];

    rawBlocks.forEach((block) => {

      if (!block) return;

      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? '');

      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? '');

      if (!blockStart || !blockEnd) return;

      const blockStartMinutes = toMinutes(blockStart);

      const blockEndMinutes = toMinutes(blockEnd);

      if (

        blockStartMinutes == null ||

        blockEndMinutes == null ||

        blockStartMinutes >= blockEndMinutes

      ) {

        return;

      }

      if (blockStartMinutes < startMinutes || blockEndMinutes > endMinutes) {

        return;

      }

      sanitizedBlocks.push({

        start: blockStart,

        end: blockEnd,

        startMinutes: blockStartMinutes,

        endMinutes: blockEndMinutes,

      });

    });

    rules[dayIndex] = {

      enabled: true,

      isClosed: false,

      start,

      end,

      startMinutes,

      endMinutes,

      blocks: sanitizedBlocks.map(({ start: bStart, end: bEnd }) => ({ start: bStart, end: bEnd })),

      breaks: sanitizedBlocks.map(({ start: bStart, end: bEnd }) => ({ start: bStart, end: bEnd })),

      blockMinutes: sanitizedBlocks.map(({ startMinutes: bStart, endMinutes: bEnd }) => [bStart, bEnd]),

    };

  });

  if (!recognized.size) return null;

  return rules;

};

const getScheduleRuleForDate = (dateish, schedule) => {

  if (!schedule) return null;

  try {

    const date = DateHelpers.parseLocal(dateish);

    if (!date || Number.isNaN(date.getTime())) return null;

    const dayIdx = date.getDay();

    return schedule[dayIdx] || null;

  } catch {

    return null;

  }

};

const inBusinessHours = (isoDatetime, schedule = null, durationMinutes = 0) => {

  const d = new Date(isoDatetime);

  if (Number.isNaN(d.getTime())) return false;

  const duration = Number(durationMinutes) || 0;

  const endDate = duration > 0 ? new Date(d.getTime() + duration * 60_000) : d;

  const isSameDay =

    endDate.getFullYear() === d.getFullYear() &&

    endDate.getMonth() === d.getMonth() &&

    endDate.getDate() === d.getDate();

  const startMinutes = d.getHours() * 60 + d.getMinutes();

  const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();

  if (schedule) {

    const rule = schedule[d.getDay()];

    if (!rule || !rule.enabled) return false;

    if (Array.isArray(rule.blockMinutes) && rule.blockMinutes.some(([start, end]) => startMinutes >= start && startMinutes < end)) {

      return false;

    }

    if (!isSameDay) return false;

    return startMinutes >= rule.startMinutes && endMinutes <= rule.endMinutes;

  }

  if (!isSameDay) return false;

  const openMinutes = DEFAULT_BUSINESS_HOURS.start * 60;

  const closeMinutes = DEFAULT_BUSINESS_HOURS.end * 60;

  return startMinutes >= openMinutes && endMinutes <= closeMinutes;

};

/* =================== Grade 07•22 =================== */

const pad2 = (n) => String(n).padStart(2, "0");

const localKey = (dateish) => {

  const d = new Date(dateish);

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(

    d.getMinutes()

  )}`;

};

// Considere como "ativo/ocupado" apenas esses status

const isActiveStatus = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "pendente" || v === "pendente_pagamento") return true;
  return v.includes("confirm") || v.includes("book"); // confirmado/confirmed/booked
  // se quiser, adicione outras variantes que seu backend usa, ex. "ativo", "scheduled"
};
// Normaliza para o minuto (ignora segundos/ms) e padroniza ISO

const minuteISO = (dt) => {

  const d = new Date(dt);

  d.setSeconds(0, 0);

  return d.toISOString();

};

function fillBusinessGrid({ currentWeek, slots, stepMinutes = 30, workingSchedule = null }) {

  const { days } = (function getDays(iso) {

    const ds = DateHelpers.weekDays(iso);

    return { days: ds };

  })(currentWeek);

  const byKey = new Map();

  (slots || []).forEach((s) => byKey.set(localKey(s.datetime), s));

  const filled = [];

  for (const { date } of days) {

    const dayRule = workingSchedule ? workingSchedule[date.getDay()] : null;

    if (workingSchedule && (!dayRule || !dayRule.enabled)) continue;

    const start = new Date(date);

    const end = new Date(date);

    if (dayRule && dayRule.enabled) {

      const [startHour, startMinute] = dayRule.start.split(':').map(Number);

      const [endHour, endMinute] = dayRule.end.split(':').map(Number);

      start.setHours(startHour, startMinute, 0, 0);

      end.setHours(endHour, endMinute, 0, 0);

    } else {

      start.setHours(DEFAULT_BUSINESS_HOURS.start, 0, 0, 0);

      end.setHours(DEFAULT_BUSINESS_HOURS.end, 0, 0, 0);

    }

    for (let t = start.getTime(); t <= end.getTime(); t += stepMinutes * 60_000) {

      const k = localKey(t);

      const existing = byKey.get(k);

      const slotDate = new Date(t);

      const minutesOfDay = slotDate.getHours() * 60 + slotDate.getMinutes();

      const blockedByRule =

        dayRule &&

        Array.isArray(dayRule.blockMinutes) &&

        dayRule.blockMinutes.some(([startMin, endMin]) => minutesOfDay >= startMin && minutesOfDay < endMin);

      const normalizedLabel = existing ? normalizeSlotLabel(existing.label) : '';

      const baseSlot = existing

         ? { ...existing }

        : { datetime: slotDate.toISOString(), label: "disponivel", status: "available" };

      if (blockedByRule && normalizedLabel !== 'agendado') {

        baseSlot.label = "bloqueado";

        baseSlot.status = "blocked";

      } else if (!baseSlot.status) {

        baseSlot.status = normalizedLabel === 'agendado' ? 'booked' : 'available';

      }

      filled.push(baseSlot);

    }

  }

  return filled;

}

const normalizeSlotLabel = (value) => {

  if (value === null || value === undefined) return '';

  return String(value)

    .toLowerCase()

    .normalize('NFD')

    .replace(/[^a-z0-9:/-]/g, '');

};

const isAvailableLabel = (value) => {

  const normalized = normalizeSlotLabel(value);

  return normalized === 'disponivel' || normalized === 'available';

};

const slotStatusClass = (label) => {

  const normalized = normalizeSlotLabel(label);

  if (normalized === 'agendado' || normalized === 'ocupado') return 'busy';

  if (normalized === 'bloqueado') return 'block';

  return 'ok';

};

const STORAGE_KEY = 'ao:lastLocation';

const buildEstablishmentSearchText = (est) =>

  normalizeText(

    [

      est?.nome,

      est?.name,

      est?.fantasia,

      est?.razao_social,

      est?.endereco,

      est?.numero,

      est?.bairro,

      est?.cidade,

      est?.estado,

      est?.cep,

    ]

      .filter(Boolean)

      .join(' ')

  );

const formatAddress = (est) => {

  const street = [est?.endereco, est?.numero].filter(Boolean).join(', ');

  const district = est?.bairro ? est.bairro : '';

  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');

  const parts = [street, district, cityState].filter(Boolean);

  if (est?.cep) parts.push(`CEP ${est.cep}`);

  return parts.join(', ');

};

const fallbackAvatar = (label) => {

  const initials = String(label || 'AO')

    .trim()

    .split(/\s+/)

    .filter(Boolean)

    .slice(0, 2)

    .map((word) => word.charAt(0).toUpperCase())

    .join('') || 'AO';

  const svg = `

    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">

      <rect width="128" height="128" rx="36" fill="url(#g)" />

      <defs>

        <linearGradient id="g" x1="8" y1="10" x2="118" y2="120" gradientUnits="userSpaceOnUse">

          <stop stop-color="#0f766e" />

          <stop offset="1" stop-color="#164e63" />

        </linearGradient>

      </defs>

      <text

        x="50%"

        y="52%"

        text-anchor="middle"

        dominant-baseline="middle"

        fill="#ffffff"

        font-family="Arial, sans-serif"

        font-size="40"

        font-weight="700"

      >

        ${initials}

      </text>

    </svg>

  `.replace(/\s+/g, ' ').trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

};

const haversineDistance = (origin, point) => {

  if (!origin || !point) return null;

  const toRad = (value) => (value * Math.PI) / 180;

  const R = 6371;

  const dLat = toRad(point.lat - origin.lat);

  const dLon = toRad(point.lng - origin.lng);

  const lat1 = toRad(origin.lat);

  const lat2 = toRad(point.lat);

  const a =

    Math.sin(dLat / 2) ** 2 +

    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;

};

const parseCoord = (value) => {

  if (value == null) return null;

  const text = String(value).trim().replace(',', '.');

  const num = Number(text);

  return Number.isFinite(num) ? num : null;

};

const geocodeEstablishment = async (est) => {

  const lat = parseCoord(est?.latitude ?? est?.lat ?? null);

  const lng = parseCoord(est?.longitude ?? est?.lng ?? null);

  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const parts = [];

  const street = [est?.endereco, est?.numero].filter(Boolean).join(' ');

  if (street) parts.push(street);

  if (est?.bairro) parts.push(est.bairro);

  if (est?.cidade) parts.push(est.cidade);

  if (est?.estado) parts.push(est.estado);

  if (est?.cep) parts.push(est.cep);

  if (!parts.length) return null;

  parts.push('Brasil');

  const query = encodeURIComponent(parts.join(', '));

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&countrycodes=br&q=${query}&email=contato@agendamentos.app`;

  try {

    const response = await fetch(url, {

      headers: { 'Accept-Language': 'pt-BR' },

    });

    if (!response.ok) return null;

    const data = await response.json();

    if (!Array.isArray(data) || !data.length) return null;

    const { lat: resLat, lon } = data[0] || {};

    const latNum = Number(resLat);

    const lonNum = Number(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;

    return { lat: latNum, lng: lonNum };

  } catch {

    return null;

  }

};

const professionalInitials = (name) => {

  const parts = String(name || '')

    .trim()

    .split(/\s+/)

    .filter(Boolean)

    .slice(0, 2);

  if (!parts.length) return '?';

  return parts.map((word) => word.charAt(0).toUpperCase()).join('');

};

const displayEstablishmentName = (est) => {

  return est?.nome || est?.name || est?.fantasia || est?.razao_social || '';

};

const displayEstablishmentAddress = (est) => {

  if (!est) return '';

  const parts = [

    [est?.endereco, est?.numero].filter(Boolean).join(', '),

    est?.bairro,

    [est?.cidade, est?.estado].filter(Boolean).join(' - '),

  ].filter(Boolean);

  return parts.join(' • ');

};

const getEstablishmentCategoryLabel = (est) => {

  const raw = String(

    est?.categoria ||

    est?.category ||

    est?.segmento ||

    est?.segment ||

    est?.tipo_estabelecimento ||

    est?.tipo ||

    est?.business_type ||

    est?.businessType ||

    est?.nicho ||

    ''

  ).trim();

  if (!raw) return '';

  return raw

    .split(/\s+/)

    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())

    .join(' ');

};

const matchesDiscoveryCategory = (est, filterValue) => {

  if (!filterValue || filterValue === 'all') return true;

  const haystack = normalizeText(

    [

      getEstablishmentCategoryLabel(est),

      est?.categoria,

      est?.category,

      est?.segmento,

      est?.segment,

      est?.tipo_estabelecimento,

      est?.tipo,

      est?.business_type,

      est?.businessType,

      est?.nicho,

    ]

      .filter(Boolean)

      .join(' ')

  );

  if (!haystack) return false;

  if (filterValue === 'barbearia') {

    return haystack.includes('barbear') || haystack.includes('barber');

  }

  if (filterValue === 'salao') {

    return haystack.includes('salao') || haystack.includes('beleza') || haystack.includes('cabelo');

  }

  if (filterValue === 'clinica') {

    return haystack.includes('clinica') || haystack.includes('estetica') || haystack.includes('saude');

  }

  return false;

};

const formatDistanceLabel = (distanceKm) => {

  if (!Number.isFinite(distanceKm)) return '';

  return `${distanceKm.toLocaleString('pt-BR', {

    minimumFractionDigits: distanceKm < 10 ? 1 : 0,

    maximumFractionDigits: 1,

  })} km`;

};

/* =================== UI Components =================== */

const Toast = ({ type, message, onDismiss }) => (

  <div className={`toast ${type}`} role="status" aria-live="polite">

    <div className="toast-content">

      <span className="toast-icon">{type === "success" ? "✔" : type === "error" ? "✘" : "ℹ"}</span>

      {message}

    </div>

    <button className="toast-close" onClick={onDismiss} aria-label="Fechar">

      &times;

    </button>

  </div>

);

const Chip = ({ active, onClick, children, title }) => (

  <button className={`chip ${active ? "chip--active" : ""}`} onClick={onClick} title={title}>

    {children}

  </button>

);

const AppointmentFlowStepper = ({ currentStep = 1, compact = false, className = '' }) => (

  <ol
    className={`appointment-stepper${compact ? ' appointment-stepper--compact' : ''}${className ? ` ${className}` : ''}`}
    aria-label="Etapas do agendamento"
  >

    {APPOINTMENT_FLOW_STEPS.map((label, index) => {

      const stepNumber = index + 1;
      const shortLabel = APPOINTMENT_FLOW_STEP_SHORT_LABELS[label] || label;

      const status =

        stepNumber < currentStep

          ? 'done'

          : stepNumber === currentStep

            ? 'current'

            : 'upcoming';

      return (

        <li key={label} className={`appointment-stepper__item is-${status}`}>

          <span className="appointment-stepper__marker" aria-hidden="true">

            {stepNumber}

          </span>

          <span className="appointment-stepper__label appointment-stepper__label--full">{label}</span>

          <span className="appointment-stepper__label appointment-stepper__label--short">{shortLabel}</span>

        </li>

      );

    })}

  </ol>

);

const AppointmentServiceDock = ({
  currentStep = 2,
  selectedCount = 0,
  duration = 0,
  priceLabel = '',
  onContinue = () => {},
  dockRef = null,
}) => {
  const countLabel =
    selectedCount === 1
      ? '1 servico selecionado'
      : selectedCount > 1
        ? `${selectedCount} servicos selecionados`
        : 'Nenhum servico selecionado';

  const hasSelection = selectedCount > 0;
  const metaItems = [];

  if (hasSelection && duration > 0) metaItems.push(`${duration} min`);
  if (hasSelection && priceLabel) metaItems.push(priceLabel);

  return (
    <div
      ref={dockRef}
      className={`novo-agendamento__service-dock${hasSelection ? ' is-active' : ''}`}
    >
      <div className="novo-agendamento__service-dock-inner">
        <div
          className="novo-agendamento__service-dock-bar"
          role="region"
          aria-label="Resumo da selecao de servicos"
        >
          <div className="novo-agendamento__service-dock-copy" aria-live="polite">
            <span className="novo-agendamento__service-dock-kicker">Resumo da selecao</span>
            <strong className="novo-agendamento__service-dock-title">{countLabel}</strong>
            {hasSelection ? (
              <div className="novo-agendamento__service-dock-meta">
                {metaItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : (
              <p className="novo-agendamento__service-dock-hint">
                Escolha um ou mais servicos para continuar para horarios.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary novo-agendamento__service-dock-button"
            disabled={!hasSelection}
            onClick={onContinue}
          >
            Continuar
          </button>
        </div>
        <div className="novo-agendamento__service-dock-stepper">
          <AppointmentFlowStepper
            currentStep={currentStep}
            compact
            className="appointment-stepper--dock"
          />
        </div>
      </div>
    </div>
  );
};

const DiscoveryFilterChip = ({ active, disabled = false, note = '', onClick, children }) => (

  <button

    type="button"

    className={`discovery-filter-chip${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}

    onClick={onClick}

    disabled={disabled}

    title={note || undefined}

  >

    <span>{children}</span>

    {note ? <small>{note}</small> : null}

  </button>

);

const DiscoveryEmptyState = ({ title, description, action = null, tone = 'default' }) => (

  <div className={`discovery-empty-state discovery-empty-state--${tone}`}>

    <div className="discovery-empty-state__icon" aria-hidden="true">

      {tone === 'error' ? '!' : '...'}

    </div>

    <div className="discovery-empty-state__body">

      <h3>{title}</h3>

      <p>{description}</p>

    </div>

    {action ? <div className="discovery-empty-state__action">{action}</div> : null}

  </div>

);

const EstablishmentCardSkeleton = () => (

  <div className="establishment-card establishment-card--skeleton" aria-hidden="true">

    <div className="establishment-card__top">

      <div className="establishment-card__avatar shimmer" />

      <div className="establishment-card__header">

        <div className="establishment-card__heading">

          <span className="establishment-card__skeleton-chip shimmer" />

          <span className="establishment-card__skeleton-line establishment-card__skeleton-line--title shimmer" />

        </div>

        <span className="establishment-card__skeleton-chip establishment-card__skeleton-chip--rating shimmer" />

      </div>

    </div>

    <span className="establishment-card__skeleton-line establishment-card__skeleton-line--body shimmer" />

    <span className="establishment-card__skeleton-line establishment-card__skeleton-line--body-short shimmer" />

    <div className="establishment-card__footer">

      <span className="establishment-card__skeleton-link shimmer" />

      <span className="establishment-card__skeleton-button shimmer" />

    </div>

  </div>

);

const SlotButton = ({ slot, isSelected, onClick, density = "compact" }) => {

  const isPast = DateHelpers.isPastSlot(slot.datetime);

  const statusClass = slotStatusClass(slot.label);

  const disabledReason = isPast || !isAvailableLabel(slot.label);

  const tooltipLabel = slot?.label ?? 'disponível';

  const className = [

    "slot-btn",

    statusClass,

    isSelected ? "is-selected" : "",

    isPast ? "is-past" : "",

    density === "compact" ? "slot-btn--compact" : "slot-btn--comfortable",

  ].join(" ");

  return (

    <button

      className={className}

      title={`${new Date(slot.datetime).toLocaleString("pt-BR")} – ${tooltipLabel}${isPast ? " (passado)" : ""}`}

      onClick={onClick}

      disabled={disabledReason}

      aria-disabled={disabledReason}

      tabIndex={disabledReason ? -1 : 0}

      aria-pressed={isSelected}

      data-datetime={slot.datetime}

    >

      {DateHelpers.formatTime(slot.datetime)}

    </button>

  );

};

const ServiceCard = ({ service, selected, onSelect }) => {

  const duration = ServiceHelpers.duration(service);

  const price = ServiceHelpers.formatPrice(ServiceHelpers.price(service));

  const description = ServiceHelpers.description(service);

  const imageRaw = service?.imagem_url || service?.image_url || service?.imagem || service?.image || service?.foto_url || '';

  const imageUrl = resolveAssetUrl(imageRaw);

  const showPrice = price !== 'R$ 0,00';

  const showDuration = duration > 0;

  const cardClass = ['mini-card', selected ? 'mini-card--selected' : ''].filter(Boolean).join(' ');

  return (

    <div className={cardClass} onClick={() => onSelect(service)}>

      <div className="mini-card__content">

        {imageUrl && (

          <div className="mini-card__media">

            <img src={imageUrl} alt={`Imagem do servico ${ServiceHelpers.title(service)}`} />

          </div>

        )}

        <div className="mini-card__main">

          <div className="mini-card__title">{ServiceHelpers.title(service)}</div>

          {description && <div className="mini-card__description">{description}</div>}

        </div>

        {(showPrice || showDuration) && (

          <div className="mini-card__side">

            {showPrice && <div className="mini-card__price">{price}</div>}

            {showDuration && <div className="mini-card__duration">{duration} min</div>}

          </div>

        )}

      </div>

    </div>

  );

};

const ProfessionalTile = ({ professional, selected, onSelect }) => {

  const avatar = resolveAssetUrl(professional?.avatar_url || '');

  const initials = useMemo(() => professionalInitials(professional?.nome), [professional?.nome]);

  return (

    <button

      type="button"

      onClick={onSelect}

      style={{

        display: 'flex',

        alignItems: 'center',

        gap: 8,

        width: '100%',

        padding: '6px 8px',

        borderRadius: 8,

        border: 'none',

        background: selected ? 'var(--primary-bg, rgba(11,94,215,0.12))' : 'transparent',

        color: 'var(--text-primary)',

        cursor: 'pointer',

        textAlign: 'left',

      }}

    >

      {avatar ? (

        <img

          src={avatar}

          alt={`Foto de ${professional?.nome || ''}`}

          style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}

        />

      ) : (

        <div

          style={{

            width: 36,

            height: 36,

            borderRadius: '50%',

            display: 'flex',

            alignItems: 'center',

            justifyContent: 'center',

            background: 'var(--border)',

            color: 'var(--text-primary)',

            fontWeight: 600,

            fontSize: 12,

          }}

        >

          {initials}

        </div>

      )}

      <span style={{ fontSize: 13, fontWeight: selected ? 600 : 500 }}>

        {professional?.nome || 'Profissional'}

      </span>

    </button>

  );

};

const EstablishmentCardLegacy = ({ est, selected, onSelect }) => {

  const name = est?.nome || est?.name || est?.fantasia || est?.razao_social || `Estabelecimento #${est?.id || ''}`;

  const address = formatAddress(est);

  const avatarSource = est?.foto_url || est?.avatar_url || '';

  const ratingAverageRaw = Number(est?.rating_average ?? est?.ratingAverage ?? NaN);

  const ratingCount = Number(est?.rating_count ?? est?.ratingCount ?? 0);

  const hasRatings = Number.isFinite(ratingAverageRaw) && ratingCount > 0;

  const ratingLabel = hasRatings ? ratingNumberFormatter.format(ratingAverageRaw) : null;

  const coords = (() => {

    const lat = Number(est?.latitude ?? est?.lat ?? est?.coord_lat ?? null);

    const lng = Number(est?.longitude ?? est?.lng ?? est?.coord_lng ?? null);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    if (lat === 0 && lng === 0) return null;

    return { lat, lng };

  })();

  const mapLink = (() => {

    if (coords) return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;

    if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

    return '';

  })();

  const handleKeyDown = (event) => {

    if (event.key === 'Enter' || event.key === ' ') {

      event.preventDefault();

      onSelect(est);

    }

  };

  return (

    <div

      className={`establishment-card ${selected ? 'establishment-card--selected' : ''}`}

      role="button"

      tabIndex={0}

      aria-pressed={selected}

      onClick={() => onSelect(est)}

      onKeyDown={handleKeyDown}

    >

      <div className="establishment-card__avatar">

        <img

          src={avatarSource ? resolveAssetUrl(avatarSource) : fallbackAvatar(name)}

          alt={`Foto do estabelecimento ${name}`}

          onError={(event) => {

            const target = event.currentTarget;

            if (!target.dataset.fallback) {

              target.dataset.fallback = '1';

              target.src = fallbackAvatar(name);

            }

          }}

        />

      </div>

      <div className="establishment-card__info">

        <h3 className="establishment-card__name">{name}</h3>

        <p className="establishment-card__address">{address || 'Endereço não informado'}</p>

        <div className="establishment-card__meta-row">

          {mapLink ? (

            <button

              type="button"

              className="establishment-card__distance establishment-card__distance--btn"

              onClick={(event) => {

                event.preventDefault();

                event.stopPropagation();

                try {

                  window.open(mapLink, '_blank', 'noopener,noreferrer');

                } catch {

                  window.location.href = mapLink;

                }

              }}

            >

              <IconMapPin aria-hidden style={{ width: 14, height: 14 }} /> Ver no mapa

            </button>

          ) : (

            <span className="establishment-card__distance">Mapa indisponivel</span>

          )}

          <span

            className={`establishment-card__rating${hasRatings ? '' : ' establishment-card__rating--muted'}`}

            aria-label={

              hasRatings

                 ? `Avaliação ${ratingLabel} de 5, com ${ratingCount} ${ratingCount === 1 ? 'avaliação' : 'avaliações'}`

                : 'Estabelecimento ainda sem avaliações'

            }

          >

            <span aria-hidden>★</span>

            {hasRatings ? `${ratingLabel} (${ratingCount})` : 'Sem avaliações'}

          </span>

        </div>

      </div>

    </div>

  );

};

/* =================== Página Principal =================== */

const EstablishmentCard = ({ est, selected, onSelect, distanceKm = null }) => {

  const name = displayEstablishmentName(est) || `Estabelecimento #${est?.id || ''}`;

  const address = formatAddress(est);

  const avatarSource = resolveAssetUrl(est?.foto_url || est?.avatar_url || est?.logo_url || '');

  const ratingAverageRaw = Number(est?.rating_average ?? est?.ratingAverage ?? NaN);

  const ratingCount = Number(est?.rating_count ?? est?.ratingCount ?? 0);

  const hasRatings = Number.isFinite(ratingAverageRaw) && ratingCount > 0;

  const ratingLabel = hasRatings ? ratingNumberFormatter.format(ratingAverageRaw) : 'Sem avaliacoes';

  const categoryLabel = getEstablishmentCategoryLabel(est);

  const distanceLabel = formatDistanceLabel(distanceKm);

  const isFavorite = Boolean(est?.is_favorite || est?.isFavorite);

  const coords = (() => {

    const lat = Number(est?.latitude ?? est?.lat ?? est?.coord_lat ?? null);

    const lng = Number(est?.longitude ?? est?.lng ?? est?.coord_lng ?? null);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    if (lat === 0 && lng === 0) return null;

    return { lat, lng };

  })();

  const mapLink = (() => {

    if (coords) return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;

    if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

    return '';

  })();

  const badges = [];

  if (isFavorite) {

    badges.push({ label: 'Favorito', tone: 'highlight' });

  }

  if (Number.isFinite(distanceKm) && distanceKm <= 3) {

    badges.push({ label: 'Perto de voce', tone: 'neutral' });

  }

  if (hasRatings && ratingAverageRaw >= 4.7 && ratingCount >= 5) {

    badges.push({ label: 'Bem avaliado', tone: 'success' });

  }

  const handleKeyDown = (event) => {

    if (event.key === 'Enter' || event.key === ' ') {

      event.preventDefault();

      onSelect(est);

    }

  };

  const handleMapClick = (event) => {

    event.preventDefault();

    event.stopPropagation();

    if (!mapLink) return;

    try {

      window.open(mapLink, '_blank', 'noopener,noreferrer');

    } catch {

      window.location.href = mapLink;

    }

  };

  const handlePrimaryAction = (event) => {

    event.preventDefault();

    event.stopPropagation();

    onSelect(est);

  };

  return (

    <article

      className={`establishment-card${selected ? ' establishment-card--selected' : ''}`}

      role="button"

      tabIndex={0}

      aria-pressed={selected}

      onClick={() => onSelect(est)}

      onKeyDown={handleKeyDown}

    >

      <div className="establishment-card__top">

        <div className={`establishment-card__avatar${avatarSource ? '' : ' establishment-card__avatar--fallback'}`}>

          {avatarSource ? (

            <img

              src={avatarSource}

              alt={`Foto do estabelecimento ${name}`}

              onError={(event) => {

                const target = event.currentTarget;

                if (!target.dataset.fallback) {

                  target.dataset.fallback = '1';

                  target.src = fallbackAvatar(name);

                }

              }}

            />

          ) : (

            <span>{professionalInitials(name)}</span>

          )}

        </div>

        <div className="establishment-card__header">

          <div className="establishment-card__heading">

            <div className="establishment-card__eyebrow-row">

              <span className={`establishment-card__category${categoryLabel ? '' : ' establishment-card__category--muted'}`}>

                {categoryLabel || 'Agendamento online'}

              </span>

              {distanceLabel ? (

                <span className="establishment-card__distance-pill">

                  <IconMapPin aria-hidden style={{ width: 14, height: 14 }} />

                  {distanceLabel}

                </span>

              ) : null}

            </div>

            <div className="establishment-card__title-row">

              <h3 className="establishment-card__name">{name}</h3>

              <span

                className={`establishment-card__rating${hasRatings ? '' : ' establishment-card__rating--muted'}`}

                aria-label={

                  hasRatings

                    ? `Avaliacao ${ratingLabel} de 5, com ${ratingCount} ${ratingCount === 1 ? 'avaliacao' : 'avaliacoes'}`

                    : 'Estabelecimento ainda sem avaliacoes'

                }

              >

                <span aria-hidden>★</span>

                {hasRatings ? ratingLabel : 'Sem avaliacoes'}

              </span>

            </div>

          </div>

          {badges.length ? (

            <div className="establishment-card__badges">

              {badges.slice(0, 2).map((badge) => (

                <span key={badge.label} className={`establishment-card__badge establishment-card__badge--${badge.tone}`}>

                  {badge.label}

                </span>

              ))}

            </div>

          ) : null}

        </div>

      </div>

      <p className="establishment-card__address">{address || 'Endereco nao informado'}</p>

      <div className="establishment-card__footer">

        {mapLink ? (

          <button type="button" className="establishment-card__map-link" onClick={handleMapClick}>

            <IconMapPin aria-hidden style={{ width: 14, height: 14 }} />

            Ver no mapa

          </button>

        ) : (

          <span className="establishment-card__map-link establishment-card__map-link--muted">

            Mapa indisponivel

          </span>

        )}

        <button type="button" className="btn btn--primary establishment-card__cta" onClick={handlePrimaryAction}>

          Ver horarios

        </button>

      </div>

    </article>

  );

};

export default function NovoAgendamento() {

  const user = getUser();
  const { estabelecimentoSlug = "" } = useParams();

  const isAuthenticated = Boolean(user?.id);

  const isClientUser = user?.tipo === 'cliente';

  const liveRef = useRef(null);

  const toastTimeoutRef = useRef(null);
  const slugBootstrapRef = useRef("");

  const location = useLocation();
  const routeSlug = useMemo(() => String(estabelecimentoSlug || "").trim(), [estabelecimentoSlug]);

  const loginHref = useMemo(() => {

    const path = `${location.pathname}${location.search}` || '/';

    return `/login?next=${encodeURIComponent(path)}`;

  }, [location.pathname, location.search]);

  useEffect(() => {

    if (isAuthenticated) return;

    if (typeof window === 'undefined') return;

    try {

      const path = `${location.pathname}${location.search}` || '/';

      sessionStorage.setItem('next_after_login', path);

    } catch {}

  }, [isAuthenticated, location.pathname, location.search]);

  const [state, setState] = useState({

    establishments: [],

    services: [],

    establishmentId: "",

    serviceIds: [],

    serviceSelectionConfirmed: false,

    professionalId: "",

    currentWeek: DateHelpers.weekStartISO(),

    slots: [],

    loading: false,

    error: "",

    selectedSlot: null,

    filters: { onlyAvailable: false, hidePast: true, timeRange: "all" }, // all|morning|afternoon|evening

    density: "compact",

    forceBusy: [], // overlay para casos que o backend Não devolve ainda

  });

  const [estQuery, setEstQuery] = useState("");

  const [debouncedEstQuery, setDebouncedEstQuery] = useState("");

  const [searchParams, setSearchParams] = useSearchParams();

  const [userLocation, setUserLocation] = useState(null);

  const [locating, setLocating] = useState(false);

  const [geoError, setGeoError] = useState('');

  const [geocoding, setGeocoding] = useState(false);

  const coordsCacheRef = useRef(new Map());

  const estSearchInputRef = useRef(null);

  const servicesSectionRef = useRef(null);
  const serviceDockRef = useRef(null);

  const ensureEstParamPendingRef = useRef(false);
  const establishmentsCacheRef = useRef(new Map());

  const [distanceMap, setDistanceMap] = useState({});
  const [serviceDockHeight, setServiceDockHeight] = useState(0);

  const [favoriteIds, setFavoriteIds] = useState(() => {

    try {

      const raw = localStorage.getItem(FAVORITES_CACHE_KEY);

      if (!raw) return new Set();

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) return new Set();

      return new Set(parsed.map((v) => String(v)));

    } catch {

      return new Set();

    }

  });

  const [establishmentsLoading, setEstablishmentsLoading] = useState(true);

  const [establishmentsLoadingMore, setEstablishmentsLoadingMore] = useState(false);

  const [establishmentsHasMore, setEstablishmentsHasMore] = useState(false);

  const [establishmentsPage, setEstablishmentsPage] = useState(1);

  const [establishmentsPageSize, setEstablishmentsPageSize] = useState(getEstablishmentsPageSize);

  const [establishmentsError, setEstablishmentsError] = useState('');

  const [establishmentExtras, setEstablishmentExtras] = useState({});

  const [professionalsByEstab, setProfessionalsByEstab] = useState({});

  const [infoModalOpen, setInfoModalOpen] = useState(false);

  const [galleryModalOpen, setGalleryModalOpen] = useState(false);

  const [profileImageModalOpen, setProfileImageModalOpen] = useState(false);

  const [galleryViewIndex, setGalleryViewIndex] = useState(0);

  const [infoModalError, setInfoModalError] = useState('');

  const [infoActiveTab, setInfoActiveTab] = useState('about');

  const [ratingModal, setRatingModal] = useState({ open: false, nota: 0, comentario: '', saving: false, error: '' });

  const [planLimitModal, setPlanLimitModal] = useState({ open: false, message: '', details: null });

  const [guestModal, setGuestModal] = useState(() => createGuestModalState());

  const [showGuestOptional, setShowGuestOptional] = useState(false);

  // Inicializa estQuery a partir de ?q= da URL e reage a mudanças no histórico

  useEffect(() => {

    const q = (searchParams.get('q') || '').trim();

    setEstQuery(q);

    setDebouncedEstQuery(q);

  }, [searchParams]);



  useEffect(() => {

    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {

      setEstablishmentsPageSize((prev) => {

        const next = getEstablishmentsPageSize();

        return next === prev ? prev : next;

      });

    };

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);

  }, []);

  useEffect(() => {

    const timer = setTimeout(() => {

      setDebouncedEstQuery(estQuery.trim());

    }, QUERY_DEBOUNCE_MS);

    return () => clearTimeout(timer);

  }, [estQuery]);

  useEffect(() => {

    const current = (searchParams.get('q') || '').trim();

    if (debouncedEstQuery === current) return;

    const sp = new URLSearchParams(searchParams);

    if (debouncedEstQuery) sp.set('q', debouncedEstQuery);

    else sp.delete('q');

    setSearchParams(sp, { replace: true });

  }, [debouncedEstQuery, searchParams, setSearchParams]);

  useEffect(() => {

    setEstablishmentsPage(1);

  }, [debouncedEstQuery, establishmentsPageSize]);

  useEffect(() => {

    try {

      const stored = sessionStorage.getItem(STORAGE_KEY);

      if (!stored) return;

      const parsed = JSON.parse(stored);

      if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {

        setUserLocation(parsed);

      }

    } catch {}

  }, []);

  useEffect(() => {

    try {

      if (userLocation) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userLocation));

      else sessionStorage.removeItem(STORAGE_KEY);

    } catch {}

  }, [userLocation]);

  // Inicializa/normaliza a semana a partir de ?week=YYYY-MM-DD

  // Sempre força a segunda-feira correspondente

  useEffect(() => {

    const w = (searchParams.get('week') || '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {

      let norm = w;

      try { norm = DateHelpers.weekStartISO(new Date(w)); } catch {}

      if (norm !== state.currentWeek) {

        setState((p) => ({ ...p, currentWeek: norm }));

      }

    }

  }, [searchParams, state.currentWeek]);
  const [modal, setModal] = useState({ isOpen: false, isSaving: false });
  const [depositModal, setDepositModal] = useState(createDepositModalState());
  const [depositCountdown, setDepositCountdown] = useState("");
  const depositHandledRef = useRef({ paid: false, expired: false });
  const [toast, setToast] = useState(null);
  const [viewMode] = useState('month'); // por ora, Mês é o padrão

  const [monthStart, setMonthStart] = useState(() => DateHelpers.firstOfMonthISO(new Date()));

  const [selectedDate, setSelectedDate] = useState(null); // YYYY-MM-DD

  const [professionalMenuOpen, setProfessionalMenuOpen] = useState(false);

  const professionalMenuRef = useRef(null);

  useEffect(() => {

    if (!professionalMenuOpen) return;

    const handleOutside = (event) => {

      const node = professionalMenuRef.current;

      if (node && !node.contains(event.target)) {

        setProfessionalMenuOpen(false);

      }

    };

    document.addEventListener('pointerdown', handleOutside);

    return () => document.removeEventListener('pointerdown', handleOutside);

  }, [professionalMenuOpen]);

  const {

    establishments, services, establishmentId, serviceIds,

    currentWeek, slots, loading, error, selectedSlot, filters, density, forceBusy,

  } = state;

  const isOwnerViewing = Boolean(

    user?.tipo === 'estabelecimento' &&

    establishmentId &&

    String(user?.id) === String(establishmentId)

  );

  const selectedSlotNow = useMemo(

    () => slots.find((s) => s.datetime === selectedSlot?.datetime),

    [slots, selectedSlot]

  );

  // Derivados

  const normalizedServiceIds = useMemo(

    () => (Array.isArray(serviceIds) ? serviceIds.map((id) => String(id)).filter(Boolean) : []),

    [serviceIds]

  );

  const selectedServices = useMemo(() => {

    if (!normalizedServiceIds.length) return [];

    const byId = new Map(services.map((svc) => [String(svc.id), svc]));

    return normalizedServiceIds.map((id) => byId.get(String(id))).filter(Boolean);

  }, [services, normalizedServiceIds]);

  const selectedService = selectedServices[0] || null;

  const serviceSummary = useMemo(() => summarizeServices(selectedServices), [selectedServices]);

  const serviceDuration = serviceSummary.duration;

  const servicePrice = ServiceHelpers.formatPrice(serviceSummary.price);

  const serviceLabel = serviceSummary.label || (selectedService ? ServiceHelpers.title(selectedService) : '');

  const serviceProfessionalSets = useMemo(

    () =>

      selectedServices

        .map((svc) => (Array.isArray(svc?.professionals) ? svc.professionals : []))

        .filter((list) => list.length),

    [selectedServices]

  );

  const serviceProfessionals = useMemo(() => {

    if (!serviceProfessionalSets.length) return [];

    let map = new Map(serviceProfessionalSets[0].map((p) => [String(p.id), p]));

    for (const list of serviceProfessionalSets.slice(1)) {

      const next = new Map();

      list.forEach((p) => {

        const key = String(p.id);

        if (map.has(key)) next.set(key, map.get(key));

      });

      map = next;

    }

    return Array.from(map.values());

  }, [serviceProfessionalSets]);

  const requiresProfessional = serviceProfessionalSets.length > 0;

  const selectedProfessional = useMemo(() => {

    if (!serviceProfessionals.length || !state.professionalId) return null;

    return serviceProfessionals.find((p) => String(p.id) === String(state.professionalId)) || null;

  }, [serviceProfessionals, state.professionalId]);

  useEffect(() => {

    if (!serviceProfessionals.length && state.professionalId) {

      setState((p) => ({ ...p, professionalId: "" }));

      setProfessionalMenuOpen(false);

      return;

    }

    if (serviceProfessionals.length === 1) {

      const only = String(serviceProfessionals[0]?.id || "");

      if (state.professionalId !== only) {

        setState((p) => ({ ...p, professionalId: only }));

      }

      setProfessionalMenuOpen(false);

      return;

    }

    if (state.professionalId && !selectedProfessional) {

      setState((p) => ({ ...p, professionalId: "" }));

      setProfessionalMenuOpen(false);

    }

  }, [serviceProfessionals, selectedProfessional, state.professionalId]);

  const selectedEstablishment = useMemo(

    () => establishments.find((e) => String(e.id) === establishmentId),

    [establishments, establishmentId]

  );

  const selectedEstablishmentName = useMemo(() => displayEstablishmentName(selectedEstablishment), [selectedEstablishment]);

  const selectedEstablishmentAddress = useMemo(() => displayEstablishmentAddress(selectedEstablishment), [selectedEstablishment]);

  const selectedEstablishmentId = selectedEstablishment ? String(selectedEstablishment.id) : null;

  useEffect(() => {

    if (!selectedEstablishmentId) return;

    import("./NovoAgendamentoModals.jsx");

  }, [selectedEstablishmentId]);

  const selectedExtras = selectedEstablishmentId ? establishmentExtras[selectedEstablishmentId] : null;

  const selectedProfessionals = selectedEstablishmentId ? professionalsByEstab[selectedEstablishmentId] : null;

  const profileData = selectedExtras?.profile || null;

  const publicPageThemeStyle = useMemo(() => {
    const accent =
      normalizeHexColor(
        searchParams.get("accent") ||
        searchParams.get("cor") ||
        profileData?.accent_color ||
        profileData?.brand_color ||
        profileData?.cor_primaria
      ) || PUBLIC_PAGE_THEME_DEFAULTS.accent;

    const accentStrong =
      normalizeHexColor(
        searchParams.get("accentStrong") ||
        searchParams.get("corStrong") ||
        profileData?.accent_strong_color ||
        profileData?.secondary_color ||
        profileData?.cor_secundaria
      ) || mixColors(accent, PUBLIC_PAGE_THEME_DEFAULTS.accentStrong, 0.46);

    const accentSoft = toRgba(accent, 0.1);
    const accentSoftStrong = toRgba(accent, 0.18);
    const accentBorder = toRgba(accent, 0.22);
    const accentRing = toRgba(accent, 0.18);
    const accentShadow = toRgba(accentStrong, 0.18);

    return {
      "--brand": accent,
      "--brand-100": mixColors(accent, "#ffffff", 0.12),
      "--brand-200": mixColors(accent, "#ffffff", 0.24),
      "--primary-50": accentSoft,
      "--primary-100": toRgba(accent, 0.14),
      "--primary-200": accentBorder,
      "--primary-500": accent,
      "--primary-600": accentStrong,
      "--primary-700": mixColors(accentStrong, "#0f172a", 0.72),
      "--booking-accent": accent,
      "--booking-accent-strong": accentStrong,
      "--booking-accent-soft": accentSoft,
      "--booking-accent-soft-strong": accentSoftStrong,
      "--booking-accent-border": accentBorder,
      "--booking-accent-ring": accentRing,
      "--booking-accent-shadow": accentShadow,
      "--booking-surface-top": mixColors(accent, "#ffffff", 0.1),
      "--booking-surface-bottom": mixColors(accentStrong, "#ffffff", 0.06),
      "--booking-page-bg":
        `radial-gradient(circle at top right, ${accentSoftStrong}, transparent 28%), ` +
        `radial-gradient(circle at bottom left, ${toRgba(accentStrong, 0.14)}, transparent 30%)`,
      "--booking-card-shadow": `0 24px 56px ${accentShadow}`,
    };
  }, [profileData, searchParams]);

  const hasPublicPageTheme = Boolean(
    routeSlug ||
    selectedEstablishmentId ||
    searchParams.get("accent") ||
    searchParams.get("cor")
  );

  const galleryImages = Array.isArray(selectedExtras?.gallery) ? selectedExtras.gallery : [];

  const publicShareLink = useMemo(() => {

    if (!isOwnerViewing) return '';

    const id = selectedEstablishmentId || (user?.id ? String(user.id) : '');

    if (!id) return '';

    let origin = 'https://agendamentosonline.com';

    if (typeof window !== 'undefined') {

      const currentOrigin = window.location?.origin || '';

      if (currentOrigin.includes('agendamentosonline.com')) origin = currentOrigin;

    }

    const slugSource =

      selectedEstablishment?.slug ||

      user?.slug ||

      selectedEstablishmentName ||

      user?.nome ||

      '';

    const targetSlug = toSlug(slugSource || `estabelecimento-${id}`);

    try {

      const url = new URL(`/novo/${targetSlug}`, origin);

      url.searchParams.set('estabelecimento', id);
      ['accent', 'accentStrong', 'cor', 'corStrong'].forEach((key) => {
        const value = searchParams.get(key);
        if (value) url.searchParams.set(key, value);
      });

      return url.toString();

    } catch {

      return '';

    }

  }, [

    isOwnerViewing,

    selectedEstablishmentId,

    selectedEstablishment?.slug,

    selectedEstablishmentName,

    searchParams,

    user?.id,

    user?.nome,

    user?.slug,

  ]);

  const rawHorarios = useMemo(

    () => (Array.isArray(profileData?.horarios) ? profileData.horarios : []),

    [profileData?.horarios]

  );

  const horariosList = useMemo(() => {

    return rawHorarios.filter((item) => {

      if (!item) return false;

      const label = String(item.label || '').trim();

      const value = String(item.value || '').trim();

      const combined = (label || value || '').trim();

      if (!combined) return false;

      if (/^\s*[\[{]/.test(combined)) return false; // ignora linhas JSON cruas

      const lowered = value.toLowerCase();

      if (/fechado|sem atendimento|nao atende/.test(lowered)) return false;

      return true;

    });

  }, [rawHorarios]);

  const workingSchedule = useMemo(() => buildWorkingSchedule(horariosList), [horariosList]);

  const reviewsState = selectedExtras?.reviews || { items: [], page: 0, hasNext: true, loading: false, loaded: false, error: '' };

  const reviewsItems = Array.isArray(reviewsState.items) ? reviewsState.items : [];

  const reviewsLoading = Boolean(reviewsState.loading);

  const reviewsError = reviewsState.error || '';

  const reviewsHasNext = reviewsState.hasNext !== false;

  const todayScheduleInfo = useMemo(() => {

    const closeSoonThreshold = 120;

    const now = new Date();

    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todayIndex = now.getDay();

    const defaultStartMinutes = DEFAULT_BUSINESS_HOURS.start * 60;

    const defaultEndMinutes = DEFAULT_BUSINESS_HOURS.end * 60;

    const formatMinutes = (value) => `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;

    const formatRange = (start, end) => `${formatMinutes(start)} - ${formatMinutes(end)}`;

    const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });



    const getRuleForDay = (dayIndex) => {

      if (workingSchedule) return workingSchedule[dayIndex] || null;

      return {

        enabled: true,

        isClosed: false,

        startMinutes: defaultStartMinutes,

        endMinutes: defaultEndMinutes,

        blockMinutes: [],

      };

    };



    const buildIntervals = (rule) => {

      if (!rule || rule.isClosed || !rule.enabled) return [];

      const startMinutes = Number.isFinite(rule.startMinutes) ? rule.startMinutes : toMinutes(rule.start);

      const endMinutes = Number.isFinite(rule.endMinutes) ? rule.endMinutes : toMinutes(rule.end);

      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes) {

        return [];

      }

      let intervals = [[startMinutes, endMinutes]];

      const blocks = Array.isArray(rule.blockMinutes) ? [...rule.blockMinutes] : [];

      blocks.sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));

      blocks.forEach(([blockStart, blockEnd]) => {

        if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockStart >= blockEnd) return;

        const next = [];

        intervals.forEach(([start, end]) => {

          if (blockEnd <= start || blockStart >= end) {

            next.push([start, end]);

            return;

          }

          if (blockStart > start) next.push([start, blockStart]);

          if (blockEnd < end) next.push([blockEnd, end]);

        });

        intervals = next;

      });

      return intervals.filter(([start, end]) => end > start);

    };



    const resolveCloseMinutes = (rule, fallback) => {

      const endMinutes = Number.isFinite(rule?.endMinutes) ? rule.endMinutes : toMinutes(rule?.end);

      return Number.isFinite(endMinutes) ? endMinutes : fallback;

    };



    const todayRule = getRuleForDay(todayIndex);

    const todayIntervals = buildIntervals(todayRule);

    const currentInterval = todayIntervals.find(([start, end]) => nowMinutes >= start && nowMinutes < end);



    if (currentInterval) {

      const [start, end] = currentInterval;

      const closeMinutes = resolveCloseMinutes(todayRule, end);

      const minutesLeft = closeMinutes - nowMinutes;

      return {

        prefix: minutesLeft <= closeSoonThreshold ? 'Fecha em breve' : 'Aberto',

        detail: formatRange(start, end),

        status: minutesLeft <= closeSoonThreshold ? 'soon' : 'open',

      };

    }



    const laterToday = todayIntervals.find(([start]) => start > nowMinutes);

    if (laterToday) {

      const [start] = laterToday;

      return {

        prefix: 'Fechado',

        detail: `Abre hoje às ${formatMinutes(start)}`,

        status: 'closed',

      };

    }



    for (let offset = 1; offset <= 7; offset += 1) {

      const dayIndex = (todayIndex + offset) % 7;

      const rule = getRuleForDay(dayIndex);

      const intervals = buildIntervals(rule);

      if (!intervals.length) continue;

      const [start] = intervals[0];

      const openTime = formatMinutes(start);

      if (offset === 1) {

        return {

          prefix: 'Fechado',

          detail: `Abre amanhã às ${openTime}`,

          status: 'closed',

        };

      }

      const nextDate = new Date(now);

      nextDate.setDate(now.getDate() + offset);

      const weekday = weekdayFormatter.format(nextDate);

      return {

        prefix: 'Fechado',

        detail: `Abre ${weekday} às ${openTime}`,

        status: 'closed',

      };

    }



    return { prefix: 'Fechado', detail: '', status: 'closed' };

  }, [workingSchedule]);

  const establishmentAvatar = useMemo(() => {

    const source = selectedEstablishment?.avatar_url || selectedEstablishment?.logo_url || selectedEstablishment?.foto_url;

    return resolveAssetUrl(source || '');

  }, [selectedEstablishment]);

  const normalizedQuery = useMemo(() => normalizeText(estQuery.trim()), [estQuery]);

  const queryTokens = useMemo(

    () => (normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : []),

    [normalizedQuery]

  );

  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [discoverySort, setDiscoverySort] = useState('relevance');

  const [discoveryCategory, setDiscoveryCategory] = useState('all');

  const [establishmentsReloadTick, setEstablishmentsReloadTick] = useState(0);

  const filteredEstablishments = useMemo(() => {

    return establishments.filter((est) => {

      const isFavorite = favoriteIds.has(String(est?.id)) || Boolean(est?.is_favorite || est?.isFavorite);

      est.is_favorite = isFavorite;

      if (favoritesOnly && !isFavorite) return false;

      if (!queryTokens.length) return true;

      const haystack = buildEstablishmentSearchText(est);

      return queryTokens.every((token) => haystack.includes(token));

    });

  }, [establishments, queryTokens, favoritesOnly, favoriteIds]);

  const ratingFormatter = useMemo(

    () => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),

    []

  );

  const reviewDateFormatter = useMemo(

    () => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),

    []

  );

  const planContext = selectedExtras?.plan_context || null;

  const planStatus = String(planContext?.status || '').toLowerCase();

  const subscriptionStatus = String(

    planContext?.subscription_status ||

    planContext?.subscription?.status ||

    ''

  ).toLowerCase();

  const trialEndsAt = planContext?.trial?.ends_at || null;

  const trialDaysLeft = typeof planContext?.trial?.days_left === 'number' ? planContext.trial.days_left : null;

  const trialExpired =

    planStatus === 'trialing' &&

    ((trialDaysLeft != null && trialDaysLeft < 0) ||

      (trialEndsAt && new Date(trialEndsAt).getTime() < Date.now()));

  const planExpired = planStatus === 'expired';

  const subscriptionActive =

    planStatus === 'active' ||

    subscriptionStatus === 'active' ||

    subscriptionStatus === 'authorized';

  const bookingBlocked = !subscriptionActive && (planExpired || trialExpired);

  const bookingBlockedMessage = 'Agendamentos indisponíveis no momento. Entre em contato com o estabelecimento.';

  useEffect(() => {

    const cache = coordsCacheRef.current;

    let changed = false;

    establishments.forEach((est) => {

      const lat = Number(est?.latitude ?? est?.lat ?? null);

      const lng = Number(est?.longitude ?? est?.lng ?? null);

      const key = String(est.id);

      if (Number.isFinite(lat) && Number.isFinite(lng) && !cache.has(key)) {

        cache.set(key, { lat, lng });

        changed = true;

      }

    });

    if (changed && userLocation) {

      const next = {};

      cache.forEach((coords, id) => {

        next[id] = haversineDistance(userLocation, coords);

      });

      setDistanceMap(next);

    }

  }, [establishments, userLocation]);

  useEffect(() => {

    if (!userLocation) {

      setDistanceMap({});

      return;

    }

    const next = {};

    coordsCacheRef.current.forEach((coords, id) => {

      next[id] = coords ? haversineDistance(userLocation, coords) : null;

    });

    setDistanceMap(next);

  }, [userLocation]);

  useEffect(() => {

    if (!userLocation) {

      setGeocoding(false);

      return;

    }

    const pending = filteredEstablishments.filter((est) => !coordsCacheRef.current.has(String(est.id)));

    if (!pending.length) {

      setGeocoding(false);

      return;

    }

    let cancelled = false;

    setGeocoding(true);

    (async () => {

      for (const est of pending) {

        if (cancelled) break;

        const coords = await geocodeEstablishment(est);

        if (cancelled) break;

        coordsCacheRef.current.set(est.id, coords);

        if (coords) {

          setDistanceMap((prev) => ({

            ...prev,

            [String(est.id)]: haversineDistance(userLocation, coords),

          }));

        }

      }

      if (!cancelled) setGeocoding(false);

    })();

    return () => {

      cancelled = true;

    };

  }, [filteredEstablishments, userLocation]);

  const discoveryCategoryCounts = useMemo(() => (

    DISCOVERY_CATEGORY_FILTERS.reduce((acc, filter) => {

      acc[filter.value] = filteredEstablishments.filter((est) => matchesDiscoveryCategory(est, filter.value)).length;

      return acc;

    }, {})

  ), [filteredEstablishments]);

  const establishmentResults = useMemo(() => {

    const mapped = filteredEstablishments.map((est) => {

      const id = String(est?.id || '');

      const distanceKm = Number(distanceMap[id]);

      return {

        est,

        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,

        ratingAverage: Number(est?.rating_average ?? est?.ratingAverage ?? NaN),

        ratingCount: Number(est?.rating_count ?? est?.ratingCount ?? 0),

        categoryLabel: getEstablishmentCategoryLabel(est),

      };

    });

    const filtered = discoveryCategory === 'all'

      ? mapped

      : mapped.filter(({ est }) => matchesDiscoveryCategory(est, discoveryCategory));

    const compareByName = (a, b) =>

      normalizeText(displayEstablishmentName(a.est) || `est-${a.est?.id || ''}`).localeCompare(

        normalizeText(displayEstablishmentName(b.est) || `est-${b.est?.id || ''}`)

      );

    const compareByQueryRelevance = (a, b) => {

      if (!normalizedQuery) return compareByName(a, b);

      const aName = normalizeText(displayEstablishmentName(a.est));

      const bName = normalizeText(displayEstablishmentName(b.est));

      const aStarts = aName.startsWith(normalizedQuery) ? 1 : 0;

      const bStarts = bName.startsWith(normalizedQuery) ? 1 : 0;

      if (aStarts !== bStarts) return bStarts - aStarts;

      const aContains = buildEstablishmentSearchText(a.est).includes(normalizedQuery) ? 1 : 0;

      const bContains = buildEstablishmentSearchText(b.est).includes(normalizedQuery) ? 1 : 0;

      if (aContains !== bContains) return bContains - aContains;

      return compareByName(a, b);

    };

    const compareByRating = (a, b) => {

      const aHasRating = Number.isFinite(a.ratingAverage) && a.ratingCount > 0 ? 1 : 0;

      const bHasRating = Number.isFinite(b.ratingAverage) && b.ratingCount > 0 ? 1 : 0;

      if (aHasRating !== bHasRating) return bHasRating - aHasRating;

      if (aHasRating && bHasRating && a.ratingAverage !== b.ratingAverage) {

        return b.ratingAverage - a.ratingAverage;

      }

      if (a.ratingCount !== b.ratingCount) {

        return b.ratingCount - a.ratingCount;

      }

      return compareByName(a, b);

    };

    const compareByDistance = (a, b) => {

      const aDistance = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY;

      const bDistance = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY;

      if (aDistance !== bDistance) return aDistance - bDistance;

      return compareByName(a, b);

    };

    const next = [...filtered];

    if (discoverySort === 'rating') {

      next.sort(compareByRating);

      return next;

    }

    if (discoverySort === 'proximity') {

      next.sort(compareByDistance);

      return next;

    }

    next.sort(compareByQueryRelevance);

    return next;

  }, [filteredEstablishments, distanceMap, discoveryCategory, discoverySort, normalizedQuery]);

  // Passo da grade

  const stepMinutes = useMemo(() => {

    const d = Number(serviceDuration || 0);

    if (d && d % 5 === 0) return Math.max(15, Math.min(480, d));

    return 30;

  }, [serviceDuration]);

  // Persistência leve (filtros/densidade)

  useEffect(() => {

    try {

      const saved = JSON.parse(localStorage.getItem("novo-agendamento-ui") || "{}");

      setState((p) => ({

        ...p,

        filters: { ...p.filters, ...saved.filters, onlyAvailable: false }, // força exibir ocupados

        density: saved.density || p.density

      }));

    } catch {}

  }, []);

  useEffect(() => {

    try {

      localStorage.setItem("novo-agendamento-ui", JSON.stringify({ filters }));

    } catch {}

  }, [filters]);

  // Toast helper

  const showToast = useCallback((type, message, duration = 5000) => {

    setToast({ type, message });

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);

    toastTimeoutRef.current = setTimeout(() => {

      setToast(null);

      toastTimeoutRef.current = null;

    }, duration);

  }, []);

  useEffect(() => () => {

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);

  }, []);

  const handleSharePublicPage = useCallback(async () => {
    if (!publicShareLink) return;
    const shareTitle = selectedEstablishmentName || 'Meu estabelecimento';

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {

      try {

        await navigator.share({

          title: shareTitle,

          text: `Agende com ${shareTitle}.`,

          url: publicShareLink,

        });

        showToast('success', 'Link compartilhado.');

        return;

      } catch (err) {

        if (err?.name === 'AbortError') return;

      }

    }

    try {

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {

        await navigator.clipboard.writeText(publicShareLink);

        showToast('success', 'Link copiado para a área de transferência.');

        return;

      }

      showToast('info', 'Copie o link da barra de endereços para compartilhar.');

    } catch (err) {

      showToast('error', 'Não foi possível copiar o link agora.');

    }

  }, [publicShareLink, selectedEstablishmentName, showToast]);
  const openDepositModal = useCallback((payload, appointmentInfo) => {
    if (!payload?.paymentId) return;
    depositHandledRef.current = { paid: false, expired: false };
    setDepositModal({
      open: true,
      status: "pending",
      paymentId: payload.paymentId,
      appointmentId: payload.appointmentId || null,
      expiresAt: payload.expiresAt || null,
      amountCents: payload.amountCents ?? null,
      pix: payload.pix || null,
      depositToken: payload.depositToken || null,
      appointmentInfo: appointmentInfo || null,
    });
  }, []);
  const buildDepositAppointmentInfo = useCallback(() => ({
    inicioISO: selectedSlot?.datetime || null,
    servicoNome: serviceLabel || "servico",
    estabelecimentoNome: selectedEstablishmentName || selectedEstablishment?.name || "seu estabelecimento",
    profissionalNome: selectedProfessional?.nome || selectedProfessional?.name || "",
    duracaoMin: serviceDuration || 0,
    precoLabel: servicePrice || "",
  }), [
    selectedEstablishment,
    selectedEstablishmentName,
    selectedProfessional,
    selectedSlot,
    serviceDuration,
    serviceLabel,
    servicePrice,
  ]);
  const closeDepositModal = useCallback(() => {
    setDepositModal(createDepositModalState());
    setDepositCountdown("");
  }, []);
  const handleCopyPixCode = useCallback(async (code) => {
    if (!code) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        showToast("success", "Chave PIX copiada.");
      } else {
        showToast("info", "Copie o código PIX manualmente.");
      }
    } catch {
      showToast("error", "Não foi possível copiar o código PIX.");
    }
  }, [showToast]);
  /* ====== Carregar Estabelecimentos ====== */

  useEffect(() => {

    let cancelled = false;
    const controller = new AbortController();

    const isFirstPage = establishmentsPage === 1;
    const requestKey = `${debouncedEstQuery}::${establishmentsPage}::${establishmentsPageSize}::${establishmentsReloadTick}`;
    const cachedEntry = establishmentsCacheRef.current.get(requestKey);

    if (cachedEntry) {

      setState((prev) => ({

        ...prev,

        establishments: isFirstPage ? cachedEntry.list : [...prev.establishments, ...cachedEntry.list],

      }));

      setEstablishmentsHasMore(cachedEntry.hasMore);

      setEstablishmentsError('');

      setEstablishmentsLoading(false);

      setEstablishmentsLoadingMore(false);

      return () => {

        cancelled = true;

        controller.abort();

      };

    }

    if (isFirstPage) {

      setEstablishmentsLoading(true);

      setEstablishmentsError('');

      setEstablishmentsLoadingMore(false);

      setEstablishmentsHasMore(false);

    } else {

      setEstablishmentsLoadingMore(true);

    }

    (async () => {

      try {

        const response = await Api.listEstablishments({

          q: debouncedEstQuery,

          page: establishmentsPage,

          limit: establishmentsPageSize,

        }, { signal: controller.signal });

        if (cancelled) return;

        const list = Array.isArray(response) ? response : response?.items || [];

        const nextHasMore = Array.isArray(response)

           ? false

          : Boolean(response?.has_more ?? list.length > establishmentsPageSize);

        const cache = establishmentsCacheRef.current;
        cache.set(requestKey, { list, hasMore: nextHasMore });
        if (cache.size > 40) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey && oldestKey !== requestKey) cache.delete(oldestKey);
        }

        setState((prev) => ({

          ...prev,

          establishments: isFirstPage ? list : [...prev.establishments, ...list],

        }));

        setEstablishmentsHasMore(nextHasMore);

      } catch (err) {

        if (cancelled || controller.signal.aborted || err?.name === 'AbortError') return;

        if (isFirstPage) {

          setEstablishmentsError('Não foi possível carregar estabelecimentos.');

        }

        showToast('error', 'Não foi possível carregar estabelecimentos.');

      } finally {

        if (!cancelled && !controller.signal.aborted) {

          setEstablishmentsLoading(false);

          setEstablishmentsLoadingMore(false);

        }

      }

    })();

    return () => {

      cancelled = true;

      controller.abort();

    };

  }, [debouncedEstQuery, establishmentsPage, establishmentsPageSize, establishmentsReloadTick, showToast]);

  useEffect(() => {
    const estParam = (searchParams.get('estabelecimento') || searchParams.get('estabelecimentoId') || '').trim();
    if (!estParam) return;
    if (establishments.some((est) => String(est.id) === estParam)) return;

    if (ensureEstParamPendingRef.current) return;

    ensureEstParamPendingRef.current = true;

    let cancelled = false;

    (async () => {

      try {

        const response = await Api.listEstablishments({ ids: estParam, limit: 1 });

        if (cancelled) return;

        const list = Array.isArray(response) ? response : response?.items || [];

        if (!list.length) return;

        setState((prev) => ({

          ...prev,

          establishments: [

            ...list,

            ...prev.establishments.filter((est) => String(est.id) !== estParam),

          ],

        }));

      } catch {

        // mantém silencioso; o fluxo principal já mostra erro se necessário

      } finally {

        if (!cancelled) ensureEstParamPendingRef.current = false;

      }

    })();

    return () => {

      cancelled = true;

      ensureEstParamPendingRef.current = false;

    };

  }, [establishments, searchParams]);

  useEffect(() => {
    const slug = String(routeSlug || '').trim().toLowerCase();
    if (!slug) return;

    const explicitEstParam = (searchParams.get('estabelecimento') || searchParams.get('estabelecimentoId') || '').trim();
    const matched = establishments.find((est) => String(est?.slug || '').trim().toLowerCase() === slug);

    if (matched?.id) {
      const matchedId = String(matched.id);

      if (state.establishmentId !== matchedId) {
        setState((prev) => ({
          ...prev,
          establishmentId: matchedId,
          serviceIds: [],
          serviceSelectionConfirmed: false,
          professionalId: "",
          slots: [],
          selectedSlot: null,
        }));
      }

      if (!explicitEstParam) {
        const sp = new URLSearchParams(searchParams);
        sp.set('estabelecimento', matchedId);
        setSearchParams(sp, { replace: true });
      }
      return;
    }

    if (explicitEstParam || slugBootstrapRef.current === slug) return;

    slugBootstrapRef.current = slug;

    let cancelled = false;

    (async () => {
      try {
        const data = await Api.getEstablishment(slug);
        if (cancelled || !data?.id) return;

        const nextId = String(data.id);

        setState((prev) => ({
          ...prev,
          establishments: [
            data,
            ...prev.establishments.filter((est) => String(est.id) !== nextId),
          ],
          establishmentId: nextId,
          serviceIds: [],
          serviceSelectionConfirmed: false,
          professionalId: "",
          slots: [],
          selectedSlot: null,
        }));

        const sp = new URLSearchParams(searchParams);
        sp.set('estabelecimento', nextId);
        setSearchParams(sp, { replace: true });
      } catch {
        if (!cancelled) {
          showToast('error', 'Nao foi possivel carregar a pagina do estabelecimento.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [establishments, routeSlug, searchParams, setSearchParams, showToast, state.establishmentId]);

  // Se vier estabelecimento= ou estabelecimentoId= na URL, seleciona automaticamente apos carregar a lista
  useEffect(() => {
    const estParam = (searchParams.get('estabelecimento') || searchParams.get('estabelecimentoId') || '').trim();
    if (establishments.length && estParam && estParam !== state.establishmentId) {
      setState((p) => ({
        ...p,

        establishmentId: estParam,

        serviceIds: [],

        serviceSelectionConfirmed: false,

        professionalId: "",

        slots: [],

        selectedSlot: null

      }));

    }

  }, [establishments, searchParams, state.establishmentId]);

  /* ====== Carregar Serviços quando escolher Estabelecimento ====== */

  useEffect(() => {

    (async () => {

      if (!establishmentId) {

        setState((p) => ({

          ...p,

          services: [],

          serviceIds: [],

          serviceSelectionConfirmed: false,

          professionalId: "",

          slots: [],

          selectedSlot: null,

        }));

        try{

          const sp = new URLSearchParams(searchParams);

          sp.delete('servico');

          setSearchParams(sp, { replace: true });

        }catch{}

        return;

      }

      try {

        const list = await Api.listServices(establishmentId);

        setState((p) => ({

          ...p,

          services: list || [],

          serviceIds: [],

          serviceSelectionConfirmed: false,

          professionalId: "", // aguarda o clique do usuário

          slots: [],

          selectedSlot: null,

        }));

        // Se veio ?servico= na URL e existir na lista, seleciona automaticamente

        try{

          const svcParam = (searchParams.get('servico') || '').trim();

          if (svcParam && Array.isArray(list)) {

            const available = new Set(list.map((s) => String(s.id)));

            const parsed = svcParam

              .split(',')

              .map((part) => part.trim())

              .filter(Boolean)

              .filter((id) => available.has(String(id)));

            if (parsed.length) {

              setState((p) => ({ ...p, serviceIds: parsed, serviceSelectionConfirmed: false }));

            } else {

              const sp = new URLSearchParams(searchParams);

              sp.delete('servico');

              setSearchParams(sp, { replace: true });

            }

          } else if (svcParam) {

            const sp = new URLSearchParams(searchParams);

            sp.delete('servico');

            setSearchParams(sp, { replace: true });

          }

        }catch{}

      } catch {

        setState((p) => ({

          ...p,

          services: [],

          serviceIds: [],

          serviceSelectionConfirmed: false,

          professionalId: "",

          slots: [],

          selectedSlot: null,

        }));

        showToast("error", "Não foi possível carregar os serviços.");

      }

    })();

  }, [establishmentId, showToast, searchParams, setSearchParams]);

  const extrasLoaded = Boolean(selectedExtras?.loaded);

  useEffect(() => {

    if (!selectedEstablishmentId || !selectedEstablishment?.id) return;

    if (extrasLoaded) return;

    let cancelled = false;

    const estId = selectedEstablishment.id;

    setEstablishmentExtras((prev) => ({

      ...prev,

      [selectedEstablishmentId]: { ...(prev[selectedEstablishmentId] || {}), loading: true, error: '' },

    }));

    (async () => {

      try {

        const data = await Api.getEstablishment(estId);

        if (cancelled) return;

        setEstablishmentExtras((prev) => ({

          ...prev,

          [selectedEstablishmentId]: {

            ...(prev[selectedEstablishmentId] || {}),

            loading: false,

            loaded: true,

            profile: data?.profile || null,

            rating: data?.rating || { average: null, count: 0, distribution: null },

            user_review: data?.user_review || null,

            is_favorite: Boolean(data?.is_favorite),

            gallery: Array.isArray(data?.gallery) ? data.gallery : [],

            gallery_limit:

              data?.gallery_limit ??

              data?.plan_context?.limits?.maxGalleryImages ??

              null,

            plan_context: data?.plan_context || null,

          },

        }));

      } catch (err) {

        if (cancelled) return;

        setEstablishmentExtras((prev) => ({

          ...prev,

          [selectedEstablishmentId]: {

            ...(prev[selectedEstablishmentId] || {}),

            loading: false,

            loaded: true,

            error: 'Detalhes indisponíveis.',

          },

        }));

        showToast('error', 'Não foi possível carregar detalhes do estabelecimento.');

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [selectedEstablishmentId, selectedEstablishment?.id, extrasLoaded]);

  useEffect(() => {

    if (!selectedEstablishmentId) return;

    setInfoModalOpen(false);

  setGalleryModalOpen(false);

  setProfileImageModalOpen(false);

  setInfoModalError('');

  setInfoActiveTab('about');

  setRatingModal((prev) => (prev.open ? { open: false, nota: 0, comentario: '', saving: false, error: '' } : prev));

}, [selectedEstablishmentId]);

useEffect(() => {

  if (galleryModalOpen) {

    setGalleryViewIndex(0);

  }

}, [galleryModalOpen, selectedEstablishmentId]);

useEffect(() => {

  if (!galleryImages.length) {

    setGalleryViewIndex(0);

    return;

  }

  if (galleryViewIndex >= galleryImages.length) {

    setGalleryViewIndex(0);

  }

}, [galleryImages.length, galleryViewIndex]);

  /* ====== Normalização de slots ====== */

  const normalizeSlots = useCallback((data) => {

    const arr = Array.isArray(data) ? data : data?.slots || [];

    return arr.map((slot) => {

      const datetime = slot.datetime || slot.slot_datetime;

      const raw = String(slot.status ?? slot.label ?? "").toLowerCase().trim();

      let label =

        raw.includes("book") || raw.includes("busy") || raw.includes("occupied") || raw.includes("agend")

           ? "agendado"

          : raw.includes("unavail") || raw.includes("block") || raw.includes("bloq")

           ? "bloqueado"

          : "disponível";

      if ((["agendado", "bloqueado"].includes(normalizeSlotLabel(slot.label)) || isAvailableLabel(slot.label))) {

        label = String(slot.label).toLowerCase();

      }

      return { ...slot, datetime, label };

    });

  }, []);

  /* ====== Hidratar ocupados por agendamentos (contagem por minuto) ====== */

  const getBusyFromAppointments = useCallback(async () => {

    const counts = new Map();

    const { start, end } = weekRangeMs(currentWeek);

    const add = (iso) => {

      const key = minuteISO(iso);

      counts.set(key, (counts.get(key) || 0) + 1);

    };

    const matchesSelectedServices = (appt) => {

      if (!normalizedServiceIds.length) return true;

      const apptServiceIds = Array.isArray(appt?.servico_ids)

         ? appt.servico_ids

        : Array.isArray(appt?.servicos)

         ? appt.servicos.map((svc) => svc?.id).filter(Boolean)

        : appt?.servico_id

         ? [appt.servico_id]

        : [];

      return apptServiceIds.some((id) => normalizedServiceIds.includes(String(id)));

    };

    try {

      if (isAuthenticated && typeof Api.meusAgendamentos === 'function') {

        const mine = await Api.meusAgendamentos();

        (mine || []).forEach((a) => {

          if (!isActiveStatus(a.status)) return;

          if (!matchesSelectedServices(a)) return;

          if (state.professionalId && a.profissional_id != null && String(a.profissional_id) !== String(state.professionalId)) return;

          const t = +new Date(a.inicio);

          if (t >= start && t < end) add(a.inicio);

        });

      }

    } catch {}

    try {

      if (isOwnerViewing && typeof Api.agendamentosEstabelecimento === 'function') {

        const est = await Api.agendamentosEstabelecimento();

        (est || []).forEach((a) => {

          if (!isActiveStatus(a.status)) return;

          if (!matchesSelectedServices(a)) return;

          if (state.professionalId && a.profissional_id != null && String(a.profissional_id) !== String(state.professionalId)) return;

          const t = +new Date(a.inicio);

          if (t >= start && t < end) add(a.inicio);

        });

      }

    } catch {}

    return counts;

  }, [currentWeek, isOwnerViewing, normalizedServiceIds, state.professionalId]);

  /* ====== Carregar Slots ====== */

  const loadSlots = useCallback(async () => {

    if (!establishmentId || !selectedServices.length) {

      setState((p) => ({ ...p, slots: [], selectedSlot: null }));

      return;

    }

    try {

      setState((p) => ({ ...p, loading: true, error: "" }));

      // A) slots reais (pedindo ocupados/bloqueados)

      const slotsData = await Api.getSlots(establishmentId, currentWeek, {

        includeBusy: true,

        serviceIds: selectedServices.map((svc) => svc.id),

      });

      const normalized = normalizeSlots(slotsData);

      // B) grade completa

      const grid = fillBusinessGrid({ currentWeek, slots: normalized, stepMinutes, workingSchedule });

      // C) conjuntos/contagens de ocupados por fonte

      const busyFromApiCount = new Map();

      const blockedSet = new Set();

      for (const s of normalized) {

        const k = minuteISO(s.datetime);

        if (!isAvailableLabel(s.label)) {

          if (normalizeSlotLabel(s.label) === 'bloqueado') {

            blockedSet.add(k);

          } else {

            busyFromApiCount.set(k, (busyFromApiCount.get(k) || 0) + 1);

          }

        }

      }

      let persisted = [];

      try {

        persisted = JSON.parse(localStorage.getItem(fbKey(establishmentId, currentWeek)) || "[]");

        if (!Array.isArray(persisted)) persisted = [];

      } catch {}

      const apptCounts = await getBusyFromAppointments();

      // D) aplica overlay considerando capacidade por profissional/serviço

      setState((prev) => {

        const rawForced = Array.from(new Set([...prev.forceBusy, ...persisted]));

        const filteredForced = rawForced.filter(

          (k) => busyFromApiCount.has(k) || (apptCounts && typeof apptCounts.has === 'function' && apptCounts.has(k))

        );

        const forcedSet = new Set(filteredForced);

        const capacity = state.professionalId

           ? 1

          : Math.max(1, serviceProfessionals.length || 0);

        const overlayed = grid.map((s) => {

          const k = minuteISO(s.datetime);

          if (normalizeSlotLabel(s.label) === 'bloqueado') {

            return { ...s, label: 'bloqueado' };

          }

          if (blockedSet.has(k)) return { ...s, label: 'bloqueado' };

          const countApi = state.professionalId ? 0 : busyFromApiCount.get(k) || 0;

          const countAppt = apptCounts && typeof apptCounts.get === 'function' ? apptCounts.get(k) || 0 : 0;

          const countForced = forcedSet.has(k) ? capacity : 0;

          const total = countApi + countAppt + countForced;

          if (total >= capacity) return { ...s, label: 'agendado' };

          return { ...s, label: 'disponivel' };

        });

        try {

          localStorage.setItem(fbKey(establishmentId, currentWeek), JSON.stringify(filteredForced));

        } catch {}

        const previousSelected = prev.selectedSlot
          ? overlayed.find(
            (s) =>
              s.datetime === prev.selectedSlot.datetime &&
              isAvailableLabel(s.label) &&
              !DateHelpers.isPastSlot(s.datetime) &&
              inBusinessHours(s.datetime, workingSchedule, serviceDuration)
          )
          : null;

        return {

          ...prev,

          slots: overlayed,

          selectedSlot: previousSelected || null,

          loading: false,

          forceBusy: filteredForced,

        };

      });

    } catch {

      setState((p) => ({

        ...p,

        slots: [],

        selectedSlot: null,

        loading: false,

        error: "Não foi possível carregar os horários.",

      }));

    }

  }, [establishmentId, selectedServices, currentWeek, normalizeSlots, stepMinutes, getBusyFromAppointments, serviceProfessionals.length, state.professionalId, workingSchedule, serviceDuration]);

  useEffect(() => {

    loadSlots();

  }, [loadSlots]);

  useEffect(() => {

    if (!selectedSlot) return;

    if (!inBusinessHours(selectedSlot.datetime, workingSchedule, serviceDuration)) {

      setState((p) => ({ ...p, selectedSlot: null }));

    }

  }, [selectedSlot, workingSchedule, serviceDuration]);

  useEffect(() => {

    setProfessionalMenuOpen(false);

  }, [serviceIds]);

  // Teclas semana

  useEffect(() => {

    const onKey = (e) => {

      if (e.defaultPrevented) return;

      const target = e.target;

      if (target?.closest?.('.modal')) return;

      const tag = target?.tagName ? target.tagName.toLowerCase() : '';

      if (target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {

        return;

      }

      if (e.key === "ArrowLeft") setState((p) => ({ ...p, currentWeek: DateHelpers.addWeeksISO(p.currentWeek, -1) }));

      if (e.key === "ArrowRight") setState((p) => ({ ...p, currentWeek: DateHelpers.addWeeksISO(p.currentWeek, 1) }));

    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, []);

  // Filtros

  const timeRangeCheck = useCallback(

    (dt) => {

      if (filters.timeRange === "all") return true;

      const h = new Date(dt).getHours();

      if (filters.timeRange === "morning") return h >= 7 && h < 12;

      if (filters.timeRange === "afternoon") return h >= 12 && h < 18;

      if (filters.timeRange === "evening") return h >= 18 && h <= 22;

      return true;

    },

    [filters.timeRange]

  );

  const isSlotVisible = useCallback(

    (slot) => {

      if (!inBusinessHours(slot.datetime, workingSchedule, serviceDuration)) return false;

      if (filters.onlyAvailable && !isAvailableLabel(slot.label)) return false;

      if (filters.hidePast && DateHelpers.isPastSlot(slot.datetime)) return false;

      if (!timeRangeCheck(slot.datetime)) return false;

      return true;

    },

    [filters, timeRangeCheck, workingSchedule, serviceDuration]

  );

  // Agrupar por dia

  const groupedSlots = useMemo(() => {

    const days = DateHelpers.weekDays(currentWeek);

    const grouped = {};

    days.forEach(({ iso }) => (grouped[iso] = []));

    slots.forEach((slot) => {

      const iso = DateHelpers.toISODate(new Date(slot.datetime));

      if (grouped[iso]) grouped[iso].push(slot);

    });

    Object.values(grouped).forEach((daySlots) => daySlots.sort((a, b) => new Date(a.datetime) - new Date(b.datetime)));

    return { days, grouped };

  }, [currentWeek, slots]);

  const selectedDayRule = useMemo(() => {

    if (!selectedDate) return null;

    return getScheduleRuleForDate(selectedDate, workingSchedule);

  }, [selectedDate, workingSchedule]);

  // announce seleção (a11y)

  useEffect(() => {

    if (!selectedSlot || !liveRef.current) return;

    const dt = new Date(selectedSlot.datetime);

    liveRef.current.textContent = `Selecionado ${dt.toLocaleDateString("pt-BR")} às ${DateHelpers.formatTime(

      selectedSlot.datetime

    )}`;

  }, [selectedSlot]);

  // WhatsApp (opcional no front)

  const FRONT_SCHEDULE_WHATSAPP = import.meta.env.VITE_FRONT_SCHEDULE_WHATSAPP === "true";

  const scheduleWhatsAppReminders = useCallback(
    async ({ inicioISO, servicoNome, estabelecimentoNome }) => {
      if (!FRONT_SCHEDULE_WHATSAPP) {

        showToast("success", "Agendado com sucesso! Os lembretes serão enviados automaticamente.");

        return;

      }

      const toPhone =

        user?.whatsapp || user?.telefone || user?.phone || user?.celular || user?.mobile;

      if (!toPhone) {

        showToast("info", "Agendado! Cadastre seu WhatsApp no perfil para receber lembretes.");

        return;

      }

      const start = new Date(inicioISO);

      const inMs = start.getTime();

      const now = Date.now();

      const reminderTime = new Date(inMs - 8 * 60 * 60 * 1000);

      const dataBR = start.toLocaleDateString("pt-BR");

      const horaBR = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      const msgReminder = `⏰ Lembrete: faltam 8 horas para o seu ${servicoNome} em ${estabelecimentoNome} (${horaBR} de ${dataBR}).`;

      const tasks = [];

      if (reminderTime.getTime() > now)

        tasks.push(Api.scheduleWhatsApp?.({ to: toPhone, scheduledAt: reminderTime.toISOString(), message: msgReminder, metadata: { kind: "reminder_8h", appointmentAt: start.toISOString() } }));

      if (!tasks.length) {

        showToast("info", "Agendado! Sem lembrete porque o horário está muito próximo.");

        return;

      }

      const results = await Promise.allSettled(tasks);

      const failed = results.some((r) => r.status === "rejected");

      showToast(failed ? "error" : "success", failed ? "Agendado! Falha ao programar o lembrete." : "Agendado com sucesso! Lembrete programado.");

    },
    [showToast, user]
  );
  useEffect(() => {
    if (!depositModal.open || !depositModal.expiresAt || depositModal.status !== "pending") {
      setDepositCountdown("");
      return;
    }
    let active = true;
    const updateCountdown = () => {
      if (!active) return;
      const expiresAt = new Date(depositModal.expiresAt);
      const diff = expiresAt.getTime() - Date.now();
      setDepositCountdown(formatCountdown(diff));
      if (diff <= 0 && depositModal.status === "pending") {
        setDepositModal((prev) => (prev.status === "pending" ? { ...prev, status: "expired" } : prev));
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [depositModal.open, depositModal.expiresAt, depositModal.status]);

  useEffect(() => {
    if (!depositModal.open || !depositModal.paymentId || depositModal.status !== "pending") return;
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const data = await Api.getPaymentStatus(depositModal.paymentId);
        if (cancelled || !data) return;
        const status = String(data.status || "").toLowerCase();
        if (status === "paid") {
          setDepositModal((prev) => ({ ...prev, status: "paid", expiresAt: data.expires_at || prev.expiresAt }));
        } else if (data.expired || status === "expired" || status === "canceled" || status === "failed") {
          setDepositModal((prev) => ({ ...prev, status: "expired", expiresAt: data.expires_at || prev.expiresAt }));
        } else if (data.expires_at) {
          setDepositModal((prev) => ({ ...prev, expiresAt: data.expires_at || prev.expiresAt }));
        }
      } catch {}
    };
    pollStatus();
    const timer = setInterval(pollStatus, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [depositModal.open, depositModal.paymentId, depositModal.status]);

  useEffect(() => {
    if (!depositModal.open) return;
    if (depositModal.status === "paid" && !depositHandledRef.current.paid) {
      depositHandledRef.current.paid = true;
      if (isAuthenticated && depositModal.appointmentInfo) {
        scheduleWhatsAppReminders({
          inicioISO: depositModal.appointmentInfo.inicioISO,
          servicoNome: depositModal.appointmentInfo.servicoNome,
          estabelecimentoNome: depositModal.appointmentInfo.estabelecimentoNome,
        }).catch(() => {});
      }
      loadSlots();
      showToast("success", "Agendamento confirmado!");
    }
    if (depositModal.status === "expired" && !depositHandledRef.current.expired) {
      depositHandledRef.current.expired = true;
      loadSlots();
      showToast("error", "Tempo esgotado, agendamento cancelado.");
    }
  }, [
    depositModal.open,
    depositModal.status,
    depositModal.appointmentInfo,
    isAuthenticated,
    scheduleWhatsAppReminders,
    loadSlots,
    showToast,
  ]);
  // Verifica se o agendamento existe mesmo após um erro

  const verifyBookingCreated = useCallback(

    async (slotIso) => {

      const sameStart = (a, b) =>

        Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;

      let slotIndisponivel = false;

      let meu = false;

      try {

        const slotsData = await Api.getSlots(establishmentId, currentWeek, { includeBusy: true });

        const normalized = normalizeSlots(slotsData);

        const found = normalized.find((s) => sameStart(s.datetime, slotIso));

        slotIndisponivel = !!(found && !isAvailableLabel(found.label));

      } catch {}

      try {

        if (isAuthenticated && typeof Api.meusAgendamentos === "function") {

          const mine = await Api.meusAgendamentos();

          meu =

            Array.isArray(mine) &&

            mine.some((a) => isActiveStatus(a.status) && sameStart(a.inicio, slotIso));

        }

      } catch {}

      if (!slotIndisponivel && isOwnerViewing && typeof Api.agendamentosEstabelecimento === "function") {

        try {

          const est = await Api.agendamentosEstabelecimento();

          slotIndisponivel =

            Array.isArray(est) && est.some((a) => isActiveStatus(a.status) && sameStart(a.inicio, slotIso));

        } catch {}

      }

      return { slotIndisponivel, meu };

    },

    [establishmentId, currentWeek, isOwnerViewing, normalizeSlots]

  );



  const validateBookingSelection = useCallback(() => {

    if (!selectedServices.length) {

      return "Selecione os servicos para continuar.";

    }

    if (!selectedSlot) {

      return "Selecione um horá­rio para continuar.";

    }

    if (bookingBlocked) {

      return bookingBlockedMessage || "Agendamentos temporariamente indisponíveis.";

    }

    if (DateHelpers.isPastSlot(selectedSlot.datetime)) {

      return "Não foi possível agendar no passado.";

    }

    if (!inBusinessHours(selectedSlot.datetime, workingSchedule, serviceDuration)) {

      return workingSchedule

         ? "Este horário está fora do horário de atendimento do estabelecimento."

        : "Este horário está fora do período de 07:00-22:00.";

    }

    if (requiresProfessional && !serviceProfessionals.length) {

      return "Nenhum profissional atende todos os servicos selecionados.";

    }

    if (requiresProfessional && !state.professionalId) {

      return "Selecione um profissional para continuar.";

    }

    return "";

  }, [

    bookingBlocked,

    bookingBlockedMessage,

    selectedServices.length,

    selectedSlot,

    workingSchedule,

    serviceDuration,

    requiresProfessional,

    serviceProfessionals.length,

    state.professionalId,

  ]);

  // Confirmar

  const confirmBooking = useCallback(async () => {

    const selectionError = validateBookingSelection();

    if (selectionError) {

      showToast("error", selectionError);

      return;

    }

    setModal((p) => ({ ...p, isSaving: true }));

    let success = false;

    try {

      const payload = {

        estabelecimento_id: Number(establishmentId),

        servico_ids: selectedServices.map((svc) => Number(svc.id)),

        inicio: selectedSlot.datetime,

      };

      if (requiresProfessional && state.professionalId) {

        payload.profissional_id = Number(state.professionalId);

      }

      const response = await Api.agendar(payload);
      const depositPayload = extractDepositPayload(response);
      const depositRequired =
        response?.status === "pendente_pagamento" ||
        Number(response?.deposit_required || 0) === 1;
      success = true;
      setModal((p) => ({ ...p, isOpen: false }));
      if (depositPayload) {
        openDepositModal(depositPayload, buildDepositAppointmentInfo());
        showToast("info", "Agendamento pendente do pagamento do sinal.");
      } else if (depositRequired) {
        showToast("error", "Não foi possível carregar o PIX do sinal.");
      } else {
        await scheduleWhatsAppReminders({
          inicioISO: selectedSlot.datetime,
          servicoNome: serviceLabel || "servico",
          estabelecimentoNome: selectedEstablishment?.name || "seu estabelecimento",
        });
        showToast("success", "Agendado com sucesso!");
      }
    } catch (e) {
      if (e?.data?.error === 'mp_not_connected' || e?.data?.error === 'mp_not_connected_for_deposit') {
        showToast('error', 'Estabelecimento ainda não configurou recebimento do sinal.');
      } else if (e?.data?.error === 'plan_limit_agendamentos') {
        const details = e?.data?.details || {};
        const message = e?.data?.message || 'Limite de agendamentos do plano atingido.';
        setPlanLimitModal({
          open: true,
          message,
          details: {

            limit: details.limit ?? null,

            total: details.total ?? null,

            month: details.month ?? null,

          },

        });

        showToast('error', message);

      } else {

        const code =

          e?.status || e?.data?.status || (/\b(409|500)\b/.exec(String(e?.message))?.[1] | 0);

        const { slotIndisponivel, meu } = await verifyBookingCreated(selectedSlot.datetime);

        if (Number(code) === 409) {

          if (meu) {

            success = true;

            setModal((p) => ({ ...p, isOpen: false }));

            showToast("success", "Seu agendamento ja existia e foi confirmado.");

            {

              const key = fbKey(establishmentId, currentWeek);

              setState((p) => {

                const list = Array.from(new Set([...p.forceBusy, minuteISO(selectedSlot.datetime)]));

                try { localStorage.setItem(key, JSON.stringify(list)); } catch {}

                return { ...p, forceBusy: list };

              });

            }

          } else {

            showToast("error", "Este horário acabou de ficar indisponível. Escolha outro.");

          }

        } else if (Number(code) === 500) {

          if (slotIndisponivel || meu) {

            success = true;

            setModal((p) => ({ ...p, isOpen: false }));

            showToast("success", "Agendado com sucesso! (o servidor retornou 500)");

            if (!slotIndisponivel) {

              const key = fbKey(establishmentId, currentWeek);

              setState((p) => {

                const list = Array.from(new Set([...p.forceBusy, minuteISO(selectedSlot.datetime)]));

                try { localStorage.setItem(key, JSON.stringify(list)); } catch {}

                return { ...p, forceBusy: list };

              });

            }

          } else {

            showToast("error", "Erro no servidor ao agendar. Tente novamente.");

          }

        } else {

          showToast("error", e?.message || "Falha ao agendar.");

        }

      }

    } finally {

      await loadSlots();

      if (success) setState((p) => ({ ...p, selectedSlot: null }));

      setModal((p) => ({ ...p, isSaving: false }));

    }

  }, [

    validateBookingSelection,

    selectedServices,

    serviceLabel,

    selectedSlot,

    selectedEstablishment,
    establishmentId,
    scheduleWhatsAppReminders,
    buildDepositAppointmentInfo,
    openDepositModal,
    loadSlots,
    showToast,

    verifyBookingCreated,

    requiresProfessional,

    serviceProfessionals.length,

    state.professionalId,

    currentWeek,

  ]);



  const resetGuestModal = useCallback(() => {

    setGuestModal(createGuestModalState());

    setShowGuestOptional(false);

  }, []);



  const openGuestModal = useCallback(() => {

    setShowGuestOptional(false);

    setGuestModal((prev) => ({

      ...createGuestModalState(),

      open: true,

      name: prev.name || "",

      email: prev.email || "",

      phone: prev.phone || "",

      data_nascimento: prev.data_nascimento || "",

      cep: prev.cep || "",

      endereco: prev.endereco || "",

      numero: prev.numero || "",

      complemento: prev.complemento || "",

      bairro: prev.bairro || "",

      cidade: prev.cidade || "",

      estado: prev.estado || "",

    }));

  }, []);



  const performGuestBooking = useCallback(

    async ({ otpToken, manageLoading = true } = {}) => {

      const selectionError = validateBookingSelection();

      if (selectionError) {

        setGuestModal((prev) => ({ ...prev, error: selectionError }));

        return;

      }

      const name = (guestModal.name || "").trim();

      const email = (guestModal.email || "").trim();

      const phoneDigits = normalizePhoneDigits(guestModal.phone);

      if (!name) {

        setGuestModal((prev) => ({ ...prev, error: "Informe seu nome para concluir." }));

        return;

      }

      if (!email) {

        setGuestModal((prev) => ({ ...prev, error: "Informe um email válido para confirmar o agendamento." }));

        return;

      }

      if (!isValidEmail(email)) {

        setGuestModal((prev) => ({ ...prev, error: "Informe um email válido." }));

        return;

      }

      if (phoneDigits.length < 10) {

        setGuestModal((prev) => ({ ...prev, error: "Informe um telefone com DDD para contato." }));

        return;

      }

      const cepDigitsRaw = String(guestModal.cep || "").replace(/\D/g, "");

      if (cepDigitsRaw && cepDigitsRaw.length !== 8) {

        setGuestModal((prev) => ({ ...prev, error: "Informe um CEP válido com 8 dígitos." }));

        return;

      }

      const estadoTrim = String(guestModal.estado || "").trim().toUpperCase();

      if (estadoTrim && estadoTrim.length !== 2) {

        setGuestModal((prev) => ({ ...prev, error: "Informe a UF com 2 letras." }));

        return;

      }

      if (manageLoading) setGuestModal((prev) => ({ ...prev, loading: true, error: "", info: "" }));

      try {

        const payload = {

          estabelecimento_id: Number(establishmentId),

          servico_ids: selectedServices.map((svc) => Number(svc.id)),

          inicio: selectedSlot.datetime,

          nome: name,

          email,

          telefone: phoneDigits,

        };

        const dataNascimento = (guestModal.data_nascimento || "").trim();

        if (dataNascimento) payload.data_nascimento = dataNascimento;

        const cepDigits = cepDigitsRaw.slice(0, 8);

        if (cepDigits) payload.cep = cepDigits;

        const enderecoTrim = (guestModal.endereco || "").trim();

        if (enderecoTrim) payload.endereco = enderecoTrim;

        const numeroTrim = (guestModal.numero || "").trim();

        if (numeroTrim) payload.numero = numeroTrim;

        const complementoTrim = (guestModal.complemento || "").trim();

        if (complementoTrim) payload.complemento = complementoTrim;

        const bairroTrim = (guestModal.bairro || "").trim();

        if (bairroTrim) payload.bairro = bairroTrim;

        const cidadeTrim = (guestModal.cidade || "").trim();

        if (cidadeTrim) payload.cidade = cidadeTrim;

        if (estadoTrim) payload.estado = estadoTrim;

        if (requiresProfessional && state.professionalId) {

          payload.profissional_id = Number(state.professionalId);

        }

        if (otpToken) payload.otp_token = otpToken;

        const response = await Api.publicAgendar(payload, { idempotencyKey: genIdempotencyKey() });
        const depositPayload = extractDepositPayload(response);
        await loadSlots();
        setState((p) => ({ ...p, selectedSlot: null }));
        if (depositPayload) {
          setGuestModal((prev) => ({
            ...prev,
            open: false,
            loading: false,
            step: "form",
            error: "",
            info: "",
          }));
          openDepositModal(depositPayload, buildDepositAppointmentInfo());
          showToast("info", "Agendamento pendente do pagamento do sinal.");
          return;
        }
        setGuestModal((prev) => ({
          ...prev,
          loading: false,
          step: "success",
          error: "",
          info: "Enviamos um email de confirmação. Confirme em até 10 minutos, senão o agendamento será cancelado automaticamente.",
        }));
        showToast("success", "Agendamento realizado! Confira seu email e confirme em até 10 minutos para evitar o cancelamento automático.");
      } catch (e) {

        if (e?.data?.error === 'plan_limit_agendamentos') {

          const message = e?.data?.message || 'Limite de agendamentos do plano atingido.';

          setPlanLimitModal({

            open: true,

            message,

            details: e?.data?.details || null,

          });

          setGuestModal((prev) => ({ ...prev, loading: false, step: "form", error: message }));

          return;

        }

        if (e?.data?.error === 'otp_required') {

          try {

            const resp = await Api.requestOtp('email', email);

            setGuestModal((prev) => ({

              ...prev,

              loading: false,

              step: "otp",

              otpReqId: resp?.request_id || "",

              otpCode: "",

              otpToken: "",

              error: "",

              info: "Enviamos um código para seu email. Digite para confirmar.",

            }));

          } catch {

            setGuestModal((prev) => ({

              ...prev,

              loading: false,

              step: "form",

              error: "Não foi possível enviar o código agora. Tente novamente.",

            }));

          }

          return;

        }

        const msg =
          e?.data?.error === 'mp_not_connected' || e?.data?.error === 'mp_not_connected_for_deposit'
            ? 'Estabelecimento ainda não configurou recebimento do sinal.'
            : e?.data?.message || e?.message || "Falha ao agendar.";
        setGuestModal((prev) => ({ ...prev, loading: false, error: msg }));
      } finally {

        if (manageLoading) {

          setGuestModal((prev) => ({ ...prev, loading: false }));

        }

      }

    },

    [

      validateBookingSelection,

      guestModal.name,

      guestModal.email,

      guestModal.phone,

      guestModal.data_nascimento,

      guestModal.cep,

      guestModal.endereco,

      guestModal.numero,

      guestModal.complemento,

      guestModal.bairro,

      guestModal.cidade,

      guestModal.estado,

      establishmentId,

      selectedServices,

      selectedSlot,

      requiresProfessional,

      serviceProfessionals.length,

      state.professionalId,
      loadSlots,
      buildDepositAppointmentInfo,
      openDepositModal,
      selectedEstablishment,
      serviceLabel,
      showToast,
    ]
  );


  const handleGuestFormSubmit = useCallback(() => {

    performGuestBooking();

  }, [performGuestBooking]);



  const handleGuestOtpSubmit = useCallback(async () => {

    if (!guestModal.otpReqId) {

      setGuestModal((prev) => ({ ...prev, error: "Solicite o envio do código para confirmar." }));

      return;

    }

    if (!guestModal.otpCode || !guestModal.otpCode.trim()) {

      setGuestModal((prev) => ({ ...prev, error: "Informe o código recebido por email." }));

      return;

    }

    setGuestModal((prev) => ({ ...prev, loading: true, error: "", info: "" }));

    try {

      const resp = await Api.verifyOtp(guestModal.otpReqId, guestModal.otpCode.trim());

      const token = resp?.otp_token;

      if (!token) throw new Error("Código inválido ou expirado.");

      setGuestModal((prev) => ({ ...prev, loading: false, otpToken: token, info: "Contato verificado." }));

      await performGuestBooking({ otpToken: token });

    } catch (err) {

      const msg = err?.data?.message || err?.message || "Código inválido ou expirado.";

      setGuestModal((prev) => ({ ...prev, loading: false, error: msg }));

    }

  }, [guestModal.otpCode, guestModal.otpReqId, performGuestBooking]);



  const handleGuestResendOtp = useCallback(async () => {

    const email = (guestModal.email || "").trim();

    if (!email) {

      setGuestModal((prev) => ({ ...prev, error: "Informe o email para reenviar o código." }));

      return;

    }

    if (!isValidEmail(email)) {

      setGuestModal((prev) => ({ ...prev, error: "Informe um email válido." }));

      return;

    }

    try {

      setGuestModal((prev) => ({ ...prev, loading: true, error: "" }));

      const resp = await Api.requestOtp('email', email);

      setGuestModal((prev) => ({

        ...prev,

        loading: false,

        otpReqId: resp?.request_id || prev.otpReqId || "",

        info: "Código reenviado para seu email.",

        step: "otp",

      }));

    } catch {

      setGuestModal((prev) => ({ ...prev, loading: false, error: "Não foi possível reenviar o código agora." }));

    }

  }, [guestModal.email]);



  const handleCloseGuestModal = useCallback(() => {

    resetGuestModal();

  }, [resetGuestModal]);



  /* ====== Handlers ====== */

  const handleQueryChange = useCallback((value) => {

    setEstQuery(value);

  }, []);

  const handleSearchSubmit = useCallback((event) => {

    if (event?.preventDefault) event.preventDefault();

    setDebouncedEstQuery(estQuery.trim());

    setEstablishmentsPage(1);

  }, [estQuery]);

  const handleUseLocation = useCallback(() => {

    if (!navigator?.geolocation) {

      setGeoError('Geolocalizacao nao esta disponível neste dispositivo.');

      return;

    }

    setGeoError('');

    setLocating(true);

    navigator.geolocation.getCurrentPosition(

      (pos) => {

        setLocating(false);

        const coords = {

          lat: pos.coords.latitude,

          lng: pos.coords.longitude,

        };

        setUserLocation(coords);

      },

      () => {

        setLocating(false);

        setGeoError('Não foi possível obter sua localizacao.');

      },

      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }

    );

  }, []);

  const handleRetryEstablishments = useCallback(() => {

    establishmentsCacheRef.current.clear();

    setEstablishmentsReloadTick((value) => value + 1);

  }, []);

  const handleDiscoverySortChange = useCallback((nextValue) => {

    setDiscoverySort(nextValue);

    if (nextValue === 'proximity' && !userLocation && !locating) {

      handleUseLocation();

    }

  }, [handleUseLocation, locating, userLocation]);

  const handleDiscoveryCategoryToggle = useCallback((nextValue) => {

    setDiscoveryCategory((current) => (current === nextValue ? 'all' : nextValue));

  }, []);

  const handleEstablishmentClick = (est) => {

    setState((p) => ({

      ...p,

      establishmentId: String(est.id),

      serviceIds: [],

      serviceSelectionConfirmed: false,

      professionalId: "",

      slots: [],

      selectedSlot: null

    }));

    try{

      const sp = new URLSearchParams(searchParams);

      sp.set('estabelecimento', String(est.id));

      setSearchParams(sp, { replace: true });

    }catch{}

  };

  const handleChangeService = () => {

    setState((p) => ({

      ...p,

      serviceIds: [],

      serviceSelectionConfirmed: false,

      professionalId: '',

      slots: [],

      selectedSlot: null,

    }));

    setProfessionalMenuOpen(false);

    try {

      const sp = new URLSearchParams(searchParams);

      sp.delete('servico');

      setSearchParams(sp, { replace: true });

    } catch {}

    const el = servicesSectionRef.current;

    if (typeof window !== 'undefined' && el) {

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    }

  };

  const handleServiceClick = (svc) => {

    const nextId = String(svc.id);

    setState((p) => {

      const current = Array.isArray(p.serviceIds) ? p.serviceIds.map((id) => String(id)) : [];

      const exists = current.includes(nextId);

      const next = exists ? current.filter((id) => id !== nextId) : [...current, nextId];

      return {

        ...p,

        serviceIds: next,

        serviceSelectionConfirmed: false,

        professionalId: "",

        slots: [],

        selectedSlot: null,

      };

    });

    setProfessionalMenuOpen(false);

    try{

      const sp = new URLSearchParams(searchParams);

      const current = Array.isArray(state.serviceIds) ? state.serviceIds.map((id) => String(id)) : [];

      const exists = current.includes(nextId);

      const next = exists ? current.filter((id) => id !== nextId) : [...current, nextId];

      if (next.length) sp.set('servico', next.join(','));

      else sp.delete('servico');

      setSearchParams(sp, { replace: true });

    }catch{}

  };

  const handleContinueFromServices = () => {

    if (!selectedServices.length) return;

    setState((p) => ({ ...p, serviceSelectionConfirmed: true }));

  };

  const handleWeekChange = (newWeek) => {

    let norm = newWeek;

    try { norm = DateHelpers.weekStartISO(new Date(newWeek)); } catch {}

    setState((p) => ({ ...p, currentWeek: norm, selectedSlot: null }));

    try{

      const sp = new URLSearchParams(searchParams);

      if (norm) sp.set('week', String(norm)); else sp.delete('week');

      setSearchParams(sp, { replace: true });

    }catch{}

  };

  const handleSlotSelect = (slot) =>

    setState((p) => ({ ...p, selectedSlot: slot }));

  const handleConfirmClick = useCallback(() => {

    const selectionError = validateBookingSelection();

    if (selectionError) {

      showToast('error', selectionError);

      return;

    }

    if (!isAuthenticated) {

      openGuestModal();

      return;

    }

    setModal((m) => ({ ...m, isOpen: true }));

  }, [isAuthenticated, openGuestModal, showToast, validateBookingSelection]);

  const handleFilterToggle = (filter) =>

    setState((p) => ({ ...p, filters: { ...p.filters, [filter]: !p.filters[filter] } }));

  const handleTimeRange = (value) =>

    setState((p) => ({ ...p, filters: { ...p.filters, timeRange: value } }));

  const ensureProfessionalsLoaded = async (estId) => {

    const key = String(estId);

    const entry = professionalsByEstab[key];

    if (entry && (entry.loading || entry.loaded)) return entry;

    setProfessionalsByEstab((prev) => ({

      ...prev,

      [key]: { ...(prev[key] || {}), loading: true, error: '' },

    }));

    try {

      const list = await Api.profissionaisPublicList(estId);

      const payload = { loading: false, loaded: true, items: Array.isArray(list) ? list : [] };

      setProfessionalsByEstab((prev) => ({ ...prev, [key]: payload }));

      return payload;

    } catch (err) {

      const msg = err?.data?.message || 'Não foi possível carregar profissionais.';

      const payload = { loading: false, loaded: true, items: [], error: msg };

      setProfessionalsByEstab((prev) => ({ ...prev, [key]: payload }));

      return payload;

    }

  };

  const loadReviews = useCallback(

    async ({ reset = false } = {}) => {

      if (!selectedEstablishment || !selectedEstablishmentId) return null;

      const key = selectedEstablishmentId;

      const currentState = reset

         ? { items: [], page: 0, hasNext: true, loaded: false, loading: false, error: '' }

        : selectedExtras?.reviews || {

            items: [],

            page: 0,

            hasNext: true,

            loaded: false,

            loading: false,

            error: '',

          };

      if (!reset) {

        if (currentState.loading) return currentState;

        if (currentState.loaded && currentState.hasNext === false) return currentState;

      }

      const nextPage = reset ? 1 : (currentState.page || 0) + 1;

      setEstablishmentExtras((prev) => {

        const base = prev[key] || {};

        const prevReviews = base.reviews || {

          items: [],

          page: 0,

          hasNext: true,

          loaded: false,

          loading: false,

          error: '',

        };

        return {

          ...prev,

          [key]: {

            ...base,

            reviews: {

              ...prevReviews,

              items: reset ? [] : prevReviews.items,

              page: reset ? 0 : prevReviews.page,

              hasNext: reset ? true : prevReviews.hasNext,

              loading: true,

              loaded: reset ? false : prevReviews.loaded,

              error: '',

            },

          },

        };

      });

      try {

        const response = await Api.getEstablishmentReviews(selectedEstablishment.id, {

          page: nextPage,

          limit: 10,

        });

        const items = Array.isArray(response?.items) ? response.items : [];

        const pagination = response?.pagination || {};

        const mergedItems = reset ? items : [...(currentState.items || []), ...items];

        setEstablishmentExtras((prev) => ({

          ...prev,

          [key]: {

            ...(prev[key] || {}),

            reviews: {

              items: mergedItems,

              page: pagination.page || nextPage,

              perPage: pagination.per_page || 10,

              total: pagination.total ?? null,

              hasNext: Boolean(pagination.has_next),

              loading: false,

              loaded: true,

              error: '',

            },

          },

        }));

        return response;

      } catch (err) {

        const msg =

          err?.data?.message || err?.message || 'Não foi possível carregar avaliações.';

        setEstablishmentExtras((prev) => ({

          ...prev,

          [key]: {

            ...(prev[key] || {}),

            reviews: {

              ...(prev[key]?.reviews || {}),

              loading: false,

              loaded: true,

              error: msg,

            },

          },

        }));

        return null;

      }

    },

    [selectedEstablishment, selectedEstablishmentId, selectedExtras, setEstablishmentExtras]

  );

  useEffect(() => {

    if (infoModalOpen && infoActiveTab === 'reviews') {

      loadReviews({ reset: false });

    }

  }, [infoModalOpen, infoActiveTab, loadReviews]);

  const handleOpenInfo = async () => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    setInfoModalError('');

    setInfoActiveTab('about');

    setInfoModalOpen(true);

    const entry = professionalsByEstab[selectedEstablishmentId];

    if (!entry || (!entry.loaded && !entry.loading)) {

      const result = await ensureProfessionalsLoaded(selectedEstablishment.id);

      if (result?.error) setInfoModalError(result.error);

    } else if (entry?.error) {

      setInfoModalError(entry.error);

    }

  };

  const handleCloseInfo = () => {

    setInfoModalOpen(false);

    setInfoModalError('');

    setInfoActiveTab('about');

  };

  const handleInfoTabChange = (tab) => {

    if (infoActiveTab === tab) return;

    setInfoActiveTab(tab);

    if (tab === 'reviews') {

      loadReviews({ reset: false });

    }

  };

  const handleReviewsRetry = () => {

    loadReviews({ reset: true });

  };

  const handleReviewsLoadMore = () => {

    loadReviews({ reset: false });

  };

  const handleOpenGalleryModal = useCallback(() => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    setGalleryModalOpen(true);

  }, [selectedEstablishment, selectedEstablishmentId]);

  const handleCloseGalleryModal = useCallback(() => {

    setGalleryModalOpen(false);

  }, []);

  const handleOpenProfileImage = useCallback(() => {

    if (!establishmentAvatar) return;

    setProfileImageModalOpen(true);

  }, [establishmentAvatar]);

  const handleCloseProfileImage = useCallback(() => {

    setProfileImageModalOpen(false);

  }, []);

  const handleGalleryPrev = useCallback(() => {

    setGalleryViewIndex((prev) => {

      if (!galleryImages.length) return 0;

      return prev === 0 ? galleryImages.length - 1 : prev - 1;

    });

  }, [galleryImages.length]);

  const handleGalleryNext = useCallback(() => {

    setGalleryViewIndex((prev) => {

      if (!galleryImages.length) return 0;

      return prev === galleryImages.length - 1 ? 0 : prev + 1;

    });

  }, [galleryImages.length]);

  const handleToggleFavorite = async () => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    if (!user || user.tipo !== 'cliente') {

      showToast('info', 'Faça login como cliente para favoritar.');

      return;

    }

    if (selectedExtras?.favoriteUpdating) return;

    const key = selectedEstablishmentId;

    const nextState = !selectedExtras?.is_favorite;

    setEstablishmentExtras((prev) => ({

      ...prev,

      [key]: { ...(prev[key] || {}), is_favorite: nextState, favoriteUpdating: true },

    }));

    setFavoriteIds((prev) => {

      const next = new Set(prev);

      if (nextState) next.add(String(selectedEstablishment.id));

      else next.delete(String(selectedEstablishment.id));

      try { localStorage.setItem(FAVORITES_CACHE_KEY, JSON.stringify([...next])); } catch {}

      return next;

    });

    try {

      const response = nextState

         ? await Api.favoriteEstablishment(selectedEstablishment.id)

        : await Api.unfavoriteEstablishment(selectedEstablishment.id);

      setEstablishmentExtras((prev) => ({

        ...prev,

        [key]: {

          ...(prev[key] || {}),

          is_favorite: response?.is_favorite ?? nextState,

          favoriteUpdating: false,

        },

      }));

      showToast('success', nextState ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');

    } catch (err) {

      setEstablishmentExtras((prev) => ({

        ...prev,

        [key]: { ...(prev[key] || {}), is_favorite: !nextState, favoriteUpdating: false },

      }));

      const msg = err?.data?.message || err?.message || 'Não foi possível atualizar favorito.';

      showToast('error', msg);

    }

  };

  const handleOpenRatingModal = () => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    if (!user || user.tipo !== 'cliente') {

      showToast('info', 'Faça login como cliente para avaliar.');

      return;

    }

    const existing = selectedExtras?.user_review;

    setRatingModal({

      open: true,

      nota: existing?.nota || 0,

      comentario: existing?.comentario || '',

      saving: false,

      error: '',

    });

  };

  const handleCloseRatingModal = () => {

    setRatingModal({ open: false, nota: 0, comentario: '', saving: false, error: '' });

  };

  const handleRatingStar = (nota) => {

    setRatingModal((prev) => ({ ...prev, nota, error: '' }));

  };

  const handleRatingCommentChange = (event) => {

    const value = event.target.value.slice(0, 600);

    setRatingModal((prev) => ({ ...prev, comentario: value }));

  };

  const handleSaveRating = async () => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    if (!user || user.tipo !== 'cliente') {

      showToast('info', 'Faça login como cliente para avaliar.');

      return;

    }

    if (!ratingModal.nota || ratingModal.nota < 1) {

      setRatingModal((prev) => ({ ...prev, error: 'Selecione uma nota de 1 a 5.' }));

      return;

    }

    setRatingModal((prev) => ({ ...prev, saving: true, error: '' }));

    try {

      const payload = {

        nota: ratingModal.nota,

        comentario: ratingModal.comentario.trim() ? ratingModal.comentario.trim() : undefined,

      };

      const response = await Api.saveEstablishmentReview(selectedEstablishment.id, payload);

      setEstablishmentExtras((prev) => {

        const current = prev[selectedEstablishmentId] || {};

        return {

          ...prev,

          [selectedEstablishmentId]: {

            ...current,

            loading: false,

            loaded: true,

            rating: response?.rating || current.rating || { average: null, count: 0, distribution: null },

            user_review: response?.user_review || {

              nota: ratingModal.nota,

              comentario: payload.comentario ?? null,

            },

          },

        };

      });

      setRatingModal({ open: false, nota: 0, comentario: '', saving: false, error: '' });

      showToast('success', 'Avaliação registrada.');

    } catch (err) {

      const msg = err?.data?.message || err?.message || 'Não foi possível salvar a avaliação.';

      setRatingModal((prev) => ({ ...prev, saving: false, error: msg }));

    }

  };

  const handleDeleteRating = async () => {

    if (!selectedEstablishment || !selectedEstablishmentId) return;

    if (!user || user.tipo !== 'cliente') {

      showToast('info', 'Faça login como cliente para avaliar.');

      return;

    }

    if (!selectedExtras?.user_review) {

      handleCloseRatingModal();

      return;

    }

    setRatingModal((prev) => ({ ...prev, saving: true, error: '' }));

    try {

      const response = await Api.deleteEstablishmentReview(selectedEstablishment.id);

      setEstablishmentExtras((prev) => {

        const current = prev[selectedEstablishmentId] || {};

        return {

          ...prev,

          [selectedEstablishmentId]: {

            ...current,

            rating: response?.rating || current.rating || { average: null, count: 0, distribution: null },

            user_review: null,

          },

        };

      });

      setRatingModal({ open: false, nota: 0, comentario: '', saving: false, error: '' });

      showToast('success', 'Avaliação removida.');

    } catch (err) {

      const msg = err?.data?.message || err?.message || 'Não foi possível remover a avaliação.';

      setRatingModal((prev) => ({ ...prev, saving: false, error: msg }));

    }

  };

  const ratingSummary = selectedExtras?.rating || null;

  const ratingCount = Number(ratingSummary?.count || 0);

  const ratingAverageValue = ratingSummary?.average != null ? Number(ratingSummary.average) : null;

  const ratingAverageLabel = ratingAverageValue != null && Number.isFinite(ratingAverageValue)

     ? ratingFormatter.format(ratingAverageValue)

    : null;

  const ratingButtonLabel = selectedExtras?.loading

     ? 'Carregando...'

    : ratingCount > 0

     ? `${ratingAverageLabel ?? ratingFormatter.format(0)} (${ratingCount})`

    : 'Sem avaliações';

  const favoriteUpdating = Boolean(selectedExtras?.favoriteUpdating);

  const socialLinks = SOCIAL_LINK_FIELDS

    .map(({ key, label }) => {

      const value = profileData ? profileData[key] : null;

      if (!value) return null;

      const url = ensureExternalUrl(value);

      if (!url) return null;

      return { key, label, url };

    })

    .filter(Boolean);

  const contactPhone = profileData?.contato_telefone || selectedEstablishment?.telefone || null;

  const infoLoading = Boolean(selectedExtras?.loading);

  const professionalsError = selectedProfessionals?.error || infoModalError || '';

  const endTimeLabel = useMemo(() => {

    if (!selectedSlot || !serviceDuration) return null;

    const end = DateHelpers.addMinutes(new Date(selectedSlot.datetime), serviceDuration);

    return DateHelpers.formatTime(end.toISOString());

  }, [selectedSlot, serviceDuration]);

  const confirmModalOpen = modal.isOpen && selectedSlot && selectedServices.length;
  const depositConfirmationOpen = depositModal.open && depositModal.status === "paid";

  const shouldRenderModals =
    infoModalOpen ||
    galleryModalOpen ||
    profileImageModalOpen ||
    ratingModal.open ||
    guestModal.open ||
    planLimitModal.open ||
    confirmModalOpen ||
    depositModal.open;
  const weekLabel = DateHelpers.formatWeekLabel(currentWeek);

  // Reordenar colunas da semana para começar pelo dia atual (se pertencer à semana atual)

  const daysToRender = useMemo(() => {

    const list = DateHelpers.weekDays(currentWeek);

    const todayIso = DateHelpers.toISODate(new Date());

    const idx = list.findIndex(({ iso }) => DateHelpers.sameYMD(iso, todayIso));

    return idx > 0 ? [...list.slice(idx), ...list.slice(0, idx)] : list;

  }, [currentWeek]);

  /* ====== UI por passos ====== */

  const step = !establishmentId

     ? 1

    : !selectedServices.length || !state.serviceSelectionConfirmed

     ? 2

    : 3;

  // Ao clicar num dia do Mês, define a semana correspondente e marca o dia

  const flowStepIndicator = confirmModalOpen || guestModal.open || depositConfirmationOpen ? 4 : step;

  useEffect(() => {

    if (typeof window === 'undefined') return undefined;

    if (step !== 2) {

      setServiceDockHeight(0);

      return undefined;

    }

    const node = serviceDockRef.current;

    if (!node) return undefined;

    const updateDockHeight = () => {

      const nextHeight = Math.ceil(node.getBoundingClientRect().height || 0);

      setServiceDockHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));

    };

    updateDockHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateDockHeight) : null;

    resizeObserver?.observe(node);

    window.addEventListener('resize', updateDockHeight);

    return () => {

      resizeObserver?.disconnect();

      window.removeEventListener('resize', updateDockHeight);

    };

  }, [step, selectedServices.length, serviceDuration, servicePrice]);

  const appointmentPageStyle = useMemo(() => {

    const style = hasPublicPageTheme ? { ...publicPageThemeStyle } : {};

    if (step === 2 && serviceDockHeight > 0) {

      style["--novo-agendamento-dock-space"] = `${serviceDockHeight}px`;

    }

    return Object.keys(style).length ? style : undefined;

  }, [hasPublicPageTheme, publicPageThemeStyle, serviceDockHeight, step]);

  const handlePickDay = useCallback((isoDay) => {

    setSelectedDate(isoDay);

    const wk = DateHelpers.weekStartISO(isoDay);

    if (wk !== currentWeek) setState((p) => ({ ...p, currentWeek: wk }));

  }, [currentWeek]);

  // Quando o mês visível contém hoje, pré-seleciona o dia atual se nada estiver selecionado

  useEffect(() => {

    const todayIso = DateHelpers.toISODate(new Date());

    if (DateHelpers.isSameMonth(todayIso, monthStart)) {

      if (!selectedDate || !DateHelpers.isSameMonth(selectedDate, monthStart)) {

        setSelectedDate(todayIso);

        const wk = DateHelpers.weekStartISO(todayIso);

        if (wk !== currentWeek) setState((p) => ({ ...p, currentWeek: wk }));

      }

    }

  }, [monthStart, selectedDate, currentWeek]);

  const flowHeading =

    step === 2

      ? 'Defina os servicos do atendimento'

      : 'Escolha o melhor horario';

  const flowSubtitle =

    step === 2

      ? 'Selecione os servicos para liberar profissionais e disponibilidade.'

      : 'Revise o estabelecimento, escolha o profissional e confirme o melhor horario disponivel.';

  const hasDiscoveryCategoryData = useMemo(

    () => Object.values(discoveryCategoryCounts).some((count) => count > 0),

    [discoveryCategoryCounts]

  );

  const activeDiscoveryCategoryLabel =

    DISCOVERY_CATEGORY_FILTERS.find((item) => item.value === discoveryCategory)?.label || '';

  const discoveryResultsCountLabel =

    establishmentsLoading && !establishmentResults.length

      ? 'Carregando estabelecimentos'

      : `${establishmentResults.length} ${establishmentResults.length === 1 ? 'estabelecimento encontrado' : 'estabelecimentos encontrados'}`;

  const discoveryResultsDescription = (() => {

    if (normalizedQuery) {

      return 'Escolha um estabelecimento para seguir para servicos e horarios.';

    }

    if (favoritesOnly) {

      return 'Mostrando apenas estabelecimentos marcados como favoritos.';

    }

    if (discoveryCategory !== 'all' && activeDiscoveryCategoryLabel) {

      return `Mostrando resultados preparados para a categoria ${activeDiscoveryCategoryLabel}.`;

    }

    if (discoverySort === 'rating') {

      return 'Resultados priorizados por confianca e qualidade percebida.';

    }

    if (discoverySort === 'proximity' && userLocation) {

      return geocoding

        ? 'Atualizando distancias para destacar opcoes mais proximas.'

        : 'Resultados priorizados pela menor distancia em relacao a voce.';

    }

    return 'Selecione um estabelecimento para iniciar o agendamento em poucos cliques.';

  })();

  const discoveryHeroMeta = geoError ? (

    <span className="appointment-discovery-hero__meta-text is-error">{geoError}</span>

  ) : locating ? (

    <span className="appointment-discovery-hero__meta-text">Obtendo sua localizacao...</span>

  ) : userLocation ? (

    <span className="appointment-discovery-hero__meta-text">

      {geocoding ? 'Calculando distancias dos estabelecimentos...' : 'Localizacao ativa para destacar opcoes mais proximas.'}

    </span>

  ) : (

    <span className="appointment-discovery-hero__meta-text">

      Ative sua localizacao para ordenar por proximidade.

    </span>

  );

  const renderEstablishmentResults = () => {

    if (establishmentsLoading && !establishmentResults.length) {

      return (

        <div className="establishments__grid establishments__grid--premium">

          {Array.from({ length: 6 }).map((_, index) => (

            <EstablishmentCardSkeleton key={`establishment-skeleton-${index}`} />

          ))}

        </div>

      );

    }

    if (establishmentsError) {

      return (

        <DiscoveryEmptyState

          tone="error"

          title="Nao foi possivel carregar os estabelecimentos"

          description="Atualize a busca ou tente novamente em instantes."

          action={(

            <button type="button" className="btn btn--outline" onClick={handleRetryEstablishments}>

              Tentar novamente

            </button>

          )}

        />

      );

    }

    if (!establishmentResults.length) {

      const emptyTitle = favoritesOnly

        ? 'Voce ainda nao tem favoritos por aqui'

        : discoveryCategory !== 'all' && activeDiscoveryCategoryLabel

          ? `Sem resultados em ${activeDiscoveryCategoryLabel}`

          : normalizedQuery

            ? 'Nenhum estabelecimento encontrado'

            : 'Ainda nao encontramos opcoes para exibir';

      const emptyDescription = favoritesOnly

        ? 'Explore estabelecimentos, favorite os melhores e volte para agendar mais rapido.'

        : normalizedQuery

          ? 'Tente buscar por nome, servico, bairro ou cidade com termos mais amplos.'

          : 'Ajuste os filtros ou tente novamente mais tarde.';

      return (

        <DiscoveryEmptyState

          title={emptyTitle}

          description={emptyDescription}

          action={normalizedQuery ? (

            <button

              type="button"

              className="btn btn--outline"

              onClick={() => {

                setEstQuery('');

                setDebouncedEstQuery('');

                setDiscoveryCategory('all');

                setDiscoverySort('relevance');

                setFavoritesOnly(false);

                setEstablishmentsPage(1);

              }}

            >

              Limpar busca

            </button>

          ) : null}

        />

      );

    }

    return (

      <>

        <div className="establishments__grid establishments__grid--premium">

          {establishmentResults.map(({ est, distanceKm }) => (

            <EstablishmentCard

              key={est.id}

              est={est}

              distanceKm={distanceKm}

              selected={String(est.id) === establishmentId}

              onSelect={handleEstablishmentClick}

            />

          ))}

        </div>

        {establishmentsHasMore && (

          <div className="novo-agendamento__load-more">

            <button

              type="button"

              className="btn btn--outline novo-agendamento__load-more-btn"

              onClick={() => setEstablishmentsPage((prev) => prev + 1)}

              disabled={establishmentsLoadingMore}

            >

              {establishmentsLoadingMore ? <span className="spinner" /> : 'Carregar mais estabelecimentos'}

            </button>

          </div>

        )}

      </>

    );

  };

  const renderServiceStep = () => {

    const summaryNames = serviceSummary.names || [];
    const selectedServicesLabel =
      !selectedServices.length
        ? 'Nenhum servico selecionado'
        : selectedServices.length === 1
        ? '1 servico selecionado'
        : `${selectedServices.length} servicos selecionados`;

    const summaryLabel =

      summaryNames.length <= 3

         ? summaryNames.join(' + ')

        : `${summaryNames[0] || 'Serviço'} + mais ${summaryNames.length - 1}`;

    return (

      <>

        <p className="muted" style={{ margin: '0 0 8px' }}>Selecione um ou mais serviços.</p>

        <div ref={servicesSectionRef} className="novo-agendamento__services">

          {services.length === 0 ? (

            <div className="empty small">Sem serviços cadastrados.</div>

          ) : (

            services.map((s) => (

              <ServiceCard

                key={s.id}

                service={s}

                selected={normalizedServiceIds.includes(String(s.id))}

                onSelect={handleServiceClick}

              />

            ))

          )}

        </div>

        <div className="novo-agendamento__services-bottom-spacer" aria-hidden="true" />

        <div
          className={`novo-agendamento__service-cta${selectedServices.length ? ' is-active' : ''}`}
          aria-live="polite"
        >
          <div className="novo-agendamento__service-cta-copy">
            <span className="novo-agendamento__service-cta-kicker">{selectedServicesLabel}</span>
            {selectedServices.length > 0 ? (
              <div className="novo-agendamento__inline-summary">
                <div className="inline-summary__item inline-summary__item--service">
                  <span className="inline-summary__value">{summaryLabel}</span>
                  <div className="inline-summary__meta">
                    <span>{serviceSummary.duration} min</span>
                    <span>{ServiceHelpers.formatPrice(serviceSummary.price)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="novo-agendamento__service-cta-hint">
                Selecione um ou mais servicos para liberar a agenda.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary novo-agendamento__service-cta-button"
            disabled={!selectedServices.length}
            onClick={handleContinueFromServices}
          >
            Continuar
          </button>
        </div>

      </>

    );

  };

  const renderScheduleContent = () => {

    const todayIso = DateHelpers.toISODate(new Date());

    return (

      <>

      {requiresProfessional && !serviceProfessionals.length && (

        <div className="notice notice--warn" role="alert">

          Nenhum profissional atende todos os serviços selecionados.

        </div>

      )}

      {serviceProfessionals.length > 0 && (

        <div className="novo-agendamento__section">

          <div className="grid" style={{ gap: 6 }}>

            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>

              <strong className="novo-agendamento__professional-title">Escolha um profissional</strong>

            </div>

            <div style={{ position: 'relative', maxWidth: 240 }} ref={professionalMenuRef}>

              <button

                type="button"

                onClick={() => setProfessionalMenuOpen((open) => !open)}

                className="novo-agendamento__select"

              >

                {selectedProfessional ? (

                  <img

                    src={resolveAssetUrl(selectedProfessional?.avatar_url)}

                    alt={`Foto de ${(selectedProfessional?.nome || selectedProfessional?.name || '').trim()}`}

                    className="novo-agendamento__select-avatar"

                  />

                ) : (

                  <div className="novo-agendamento__select-avatar novo-agendamento__select-avatar--fallback">

                    {professionalInitials(serviceProfessionals[0]?.nome || serviceProfessionals[0]?.name)}

                  </div>

                )}

                <div className="novo-agendamento__select-label">

                  <div>{selectedProfessional ? (selectedProfessional.nome || selectedProfessional.name) : 'Selecione um profissional'}</div>

                </div>

                <span className="novo-agendamento__select-caret" aria-hidden>▼</span>

              </button>

              {professionalMenuOpen && (

                <div className="novo-agendamento__select-menu">

                  {serviceProfessionals.map((p) => (

                    <ProfessionalTile

                      key={p.id}

                      professional={p}

                      selected={String(state.professionalId) === String(p.id)}

                      onSelect={() => {

                        setState((s) => ({ ...s, professionalId: String(p.id) }));

                        setProfessionalMenuOpen(false);

                      }}

                    />

                  ))}

                </div>

              )}

            </div>

            {!selectedProfessional && (

              <small className="muted" style={{ fontSize: 11 }}>

                Selecione o profissional desejado para confirmar o agendamento.

              </small>

            )}

          </div>

        </div>

      )}

      <div className="novo-agendamento__section">

        <div className="row spread novo-agendamento__summary-row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>

          <div className="novo-agendamento__inline-summary">

            <div className="inline-summary__item inline-summary__item--service">

              <span className="inline-summary__value">{serviceLabel || 'Selecione os servicos'}</span>

              {(serviceDuration || servicePrice !== 'R$ 0,00') && (

                <div className="inline-summary__meta">

                  {serviceDuration ? <span>{serviceDuration} min</span> : null}

                  {servicePrice !== 'R$ 0,00' ? <span>{servicePrice}</span> : null}

                </div>

              )}

            </div>

          </div>

          <div className="novo-agendamento__summary-actions-row">

            <button type="button" className="novo-agendamento__change-service" onClick={handleChangeService}>Alterar serviços</button>

            <details className="filters">

              <summary className="filters__summary" aria-label="Filtros" title="Filtros">

                <span className="sr-only">Filtros</span>

                <svg

                  className="filters__icon"

                  viewBox="0 0 24 24"

                  aria-hidden="true"

                >

                  <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" />

                </svg>

                <span className="filters__badge" aria-hidden="true" />

              </summary>

              <div className="filters__content">

                <label className="label">

                  <span>Início da semana</span>

                  <input

                    type="date"

                    value={currentWeek}

                    onChange={(event) => handleWeekChange(DateHelpers.toISODate(event.target.value))}

                    className="input"

                    title="Segunda-feira da semana"

                  />

                </label>

                <div className="row" style={{ alignItems: 'center', gap: 10 }}>

                  <label className="checkbox">

                    <input type="checkbox" checked={filters.onlyAvailable} onChange={() => handleFilterToggle('onlyAvailable')} />

                    <span>Somente disponíveis</span>

                  </label>

                  <label className="checkbox">

                    <input type="checkbox" checked={filters.hidePast} onChange={() => handleFilterToggle('hidePast')} />

                    <span>Ocultar horários passados</span>

                  </label>

                </div>

                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }} role="group" aria-label="Período do dia">

                  <Chip active={filters.timeRange === 'all'} onClick={() => handleTimeRange('all')} title="Todos os horários">Todos</Chip>

                  <Chip active={filters.timeRange === 'morning'} onClick={() => handleTimeRange('morning')} title="Manhã (07-12)">Manhã</Chip>

                  <Chip active={filters.timeRange === 'afternoon'} onClick={() => handleTimeRange('afternoon')} title="Tarde (12-18)">Tarde</Chip>

                  <Chip active={filters.timeRange === 'evening'} onClick={() => handleTimeRange('evening')} title="Noite (18-22)">Noite</Chip>

                </div>

              </div>

            </details>

          </div>

        </div>

        <div className="novo-agendamento__calendar">

          <div className="month card" style={{ padding: 8, marginBottom: 8 }}>

            <div className="row spread" style={{ alignItems: 'center', marginBottom: 6 }}>

              <div className="row" style={{ gap: 6, alignItems: 'center' }}>

                <button

                  className="btn btn--sm"

                  aria-label="Mês anterior"

                  onClick={() => setMonthStart(DateHelpers.formatLocalISO(DateHelpers.addMonths(monthStart, -1)))}

                >

                  ‹

                </button>

                <strong>{new Date(monthStart + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>

                <button

                  className="btn btn--sm"

                  aria-label="Próximo mês"

                  onClick={() => setMonthStart(DateHelpers.formatLocalISO(DateHelpers.addMonths(monthStart, 1)))}

                >

                  ›

                </button>

              </div>

            </div>

            <div className="month__grid">

              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d, index) => (

                <div key={`${d}-${index}`} className="month__dow muted">{d}</div>

              ))}

              {DateHelpers.monthGrid(monthStart).map(({ iso, inMonth, date }) => {

                const isToday = DateHelpers.sameYMD(iso, todayIso);

                const isPastDay = iso < todayIso;

                const isSelected = selectedDate && DateHelpers.sameYMD(selectedDate, iso);

                const classNameParts = ['month__day'];

                if (!inMonth) classNameParts.push('is-dim');

                if (isToday) classNameParts.push('is-today');

                if (isSelected) classNameParts.push('is-selected');

                if (isPastDay) classNameParts.push('is-past');

                const className = classNameParts.join(' ');

                return (

                  <button

                    key={iso}

                    type="button"

                    className={className}

                    onClick={isPastDay ? undefined : () => handlePickDay(iso)}

                    title={date.toLocaleDateString('pt-BR')}

                    disabled={isPastDay}

                  >

                    {date.getDate()}

                  </button>

                );

              })}

            </div>

          </div>

          {error && (

            <div className="box error" style={{ marginTop: 8 }}>

              {error}

              <div className="row" style={{ marginTop: 6 }}>

                <button className="btn btn--sm" onClick={loadSlots}>Tentar novamente</button>

              </div>

            </div>

          )}

          {selectedSlot && (

            <div className="box box--highlight sticky-bar" aria-live="polite" id="resumo-agendamento">

              <div className="appointment-summary">

                <strong>{DateHelpers.formatDateFull(selectedSlot.datetime)}</strong>

                <span>{DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` • ${endTimeLabel}` : ''}</span>

              </div>

              <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>

                <button className="btn btn--outline btn--sm" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))}>Limpar</button>

              </div>

            </div>

          )}

          <div className="card" style={{ marginTop: 8 }}>

            <h3 style={{ marginTop: 0, marginBottom: 8 }}>

              {selectedDate

                 ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })

                : 'Selecione uma data'}

            </h3>

            {selectedDate ? (

              serviceProfessionals.length > 0 && !selectedProfessional ? (

                <div className="empty">Selecione um profissional para ver os horários.</div>

              ) : (

                <div className={density === 'compact' ? 'slots--grid' : 'slots--list'}>

                  {loading ? (

                    Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer pill" />)

                  ) : ((groupedSlots.grouped[selectedDate] || []).filter(isSlotVisible)).length === 0 ? (

                    <div className="empty">

                      {workingSchedule && selectedDayRule && !selectedDayRule.enabled

                         ? 'Estabelecimento não atende neste dia.'

                        : 'Sem horários para este dia.'}

                    </div>

                  ) : (

                    groupedSlots.grouped[selectedDate].filter(isSlotVisible).map((slot) => (

                      <SlotButton

                        key={slot.datetime}

                        slot={slot}

                        isSelected={selectedSlot?.datetime === slot.datetime}

                        onClick={() => handleSlotSelect(slot)}

                        density={density}

                      />

                    ))

                  )}

                </div>

              )

            ) : (

              <div className="empty">Escolha uma data no calendário acima.</div>

            )}

          </div>

          {bookingBlocked && (

            <div className="notice notice--warn" role="alert" style={{ marginTop: 8 }}>

              {bookingBlockedMessage}

            </div>

          )}

          <div className="action-bar action-bar--booking">

            <button className="btn" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))} disabled={!selectedSlot}>

              Limpar seleção

            </button>

            <button

              className="btn btn--primary"

              onClick={handleConfirmClick}

              disabled={

                !selectedSlot || !selectedServices.length || modal.isSaving ||

                (requiresProfessional && !serviceProfessionals.length) ||

                (requiresProfessional && !state.professionalId) ||

                (selectedSlotNow && !isAvailableLabel(selectedSlotNow.label)) ||

                DateHelpers.isPastSlot(selectedSlot.datetime) ||

                !inBusinessHours(selectedSlot.datetime, workingSchedule, serviceDuration) ||

                bookingBlocked

              }

            >

              {modal.isSaving ? <span className="spinner" /> : 'Confirmar agendamento'}

            </button>

          </div>

        </div>

      </div>

    </>

    );

  };

  return (

    <div
      className={`novo-agendamento${hasPublicPageTheme ? ' novo-agendamento--brand' : ''}${step === 2 ? ' novo-agendamento--service-step' : ''}`}
      style={appointmentPageStyle}
    >

      {toast && (

        <div className="novo-agendamento__toast">

          <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />

        </div>

      )}

      <div className="establishments">

        {step === 1 ? (

          <>

            <AppointmentDiscoveryHero

              heading="Escolha um estabelecimento"

              subtitle="Busque por nome, servico, bairro ou cidade para iniciar seu agendamento"

              query={estQuery}

              onChange={handleQueryChange}

              onSubmit={handleSearchSubmit}

              placeholder="Buscar por estabelecimento, servico, bairro ou cidade"

              inputRef={estSearchInputRef}

              headingId="novo-agendamento-hero-title"

              stepper={<AppointmentFlowStepper currentStep={step} />}

              meta={discoveryHeroMeta}

            >

              <button

                type="button"

                className="appointment-search-panel__secondary-btn"

                onClick={handleUseLocation}

                disabled={locating}

              >

                {locating ? 'Localizando...' : userLocation ? 'Perto de mim ativo' : 'Perto de mim'}

              </button>

              <button

                type="button"

                className={`appointment-search-panel__icon-btn${favoritesOnly ? ' is-active' : ''}`}

                onClick={() => setFavoritesOnly((prev) => !prev)}

                aria-pressed={favoritesOnly}

                aria-label="Favoritos"

                title="Favoritos"

              >

                <IconStar filled={favoritesOnly} style={{ width: 14, height: 14 }} />

              </button>

            </AppointmentDiscoveryHero>

            <section className="novo-agendamento__discovery-shell">

              <div className="novo-agendamento__quick-filters-panel">

                <div className="novo-agendamento__quick-filters-copy">

                  <span className="novo-agendamento__section-eyebrow">Filtros rapidos</span>

                  <p>Refine a lista para encontrar o melhor local e agendar mais rapido.</p>

                </div>

                <div className="novo-agendamento__quick-filters" role="group" aria-label="Filtros rapidos">

                  <DiscoveryFilterChip

                    active={discoverySort === 'proximity'}

                    onClick={() => handleDiscoverySortChange(discoverySort === 'proximity' ? 'relevance' : 'proximity')}

                  >

                    Mais proximos

                  </DiscoveryFilterChip>

                  <DiscoveryFilterChip

                    active={discoverySort === 'rating'}

                    onClick={() => handleDiscoverySortChange(discoverySort === 'rating' ? 'relevance' : 'rating')}

                  >

                    Melhor avaliados

                  </DiscoveryFilterChip>

                  <DiscoveryFilterChip disabled note="Em breve">

                    Com horarios hoje

                  </DiscoveryFilterChip>

                  {DISCOVERY_CATEGORY_FILTERS.map((filter) => {

                    const isEnabled = hasDiscoveryCategoryData && discoveryCategoryCounts[filter.value] > 0;

                    return (

                      <DiscoveryFilterChip

                        key={filter.value}

                        active={discoveryCategory === filter.value}

                        disabled={!isEnabled}

                        note={!hasDiscoveryCategoryData ? 'Em breve' : ''}

                        onClick={() => handleDiscoveryCategoryToggle(filter.value)}

                      >

                        {filter.label}

                      </DiscoveryFilterChip>

                    );

                  })}

                </div>

              </div>

              <div className="novo-agendamento__results-shell">

                <div className="novo-agendamento__results-toolbar">

                  <div className="novo-agendamento__results-copy">

                    <span className="novo-agendamento__section-eyebrow">

                      {normalizedQuery ? 'Resultados da busca' : 'Pronto para agendar'}

                    </span>

                    <h2 className="novo-agendamento__results-title">{discoveryResultsCountLabel}</h2>

                    <p className="novo-agendamento__results-description">{discoveryResultsDescription}</p>

                  </div>

                  <label className="novo-agendamento__sort-field">

                    <span>Ordenar por</span>

                    <select

                      className="novo-agendamento__sort-select"

                      value={discoverySort}

                      onChange={(event) => handleDiscoverySortChange(event.target.value)}

                      aria-label="Ordenar estabelecimentos"

                    >

                      {DISCOVERY_SORT_OPTIONS.map((option) => (

                        <option key={option.value} value={option.value} disabled={option.disabled}>

                          {option.disabled ? `${option.label} (em breve)` : option.label}

                        </option>

                      ))}

                    </select>

                  </label>

                </div>

                {renderEstablishmentResults()}

              </div>

            </section>

          </>

        ) : (

          <div className="card establishments__intro novo-agendamento__intro">

            <div className="novo-agendamento__flow-head">

              <div className="novo-agendamento__flow-copy">

                <span className="novo-agendamento__section-eyebrow">Novo agendamento</span>

                <h1 className="novo-agendamento__flow-title">{flowHeading}</h1>

                <p className="novo-agendamento__flow-subtitle">{flowSubtitle}</p>

              </div>

              <div className="novo-agendamento__flow-stepper">
                <AppointmentFlowStepper currentStep={flowStepIndicator} compact />
              </div>

            </div>

            <div className="novo-agendamento__summary novo-agendamento__summary--establishment">

              <div className="novo-agendamento__summary-head">

                <Link

                  className="novo-agendamento__back"

                  to="/novo-agendamento"

                  aria-label="Voltar"

                  title="Voltar"

                >

                  <span className="novo-agendamento__back-icon" aria-hidden="true">&lt;</span>

                </Link>

                <button

                  type="button"

                  className={`novo-agendamento__summary-avatar${establishmentAvatar ? ' is-clickable' : ''}`}

                  onClick={handleOpenProfileImage}

                  aria-label={establishmentAvatar ? 'Abrir foto do estabelecimento' : undefined}

                  title={establishmentAvatar ? 'Abrir foto do estabelecimento' : undefined}

                  disabled={!establishmentAvatar}

                >

                  {establishmentAvatar ? (

                    <img src={establishmentAvatar} alt={`Logo de ${selectedEstablishmentName || 'estabelecimento'}`} />

                  ) : (

                    <span>{(selectedEstablishmentName || 'AO').slice(0, 2).toUpperCase()}</span>

                  )}

                </button>

                {isOwnerViewing ? (

                  <Link

                    to="/configuracoes"

                    state={{ focusSection: 'profile' }}

                    className="novo-agendamento__summary-head-action"

                    title="Editar foto do perfil"

                    aria-label="Editar foto do perfil"

                  >

                    <IconGear aria-hidden style={{ width: 18, height: 18 }} />

                  </Link>

                ) : (

                  <span className="novo-agendamento__summary-head-spacer" aria-hidden="true" />

                )}

              </div>

              

              <div className="novo-agendamento__summary-content">

                <strong className="novo-agendamento__summary-name">{selectedEstablishmentName || 'Estabelecimento'}</strong>

                <span className="novo-agendamento__summary-address">{selectedEstablishmentAddress || 'Endereço não informado'}</span>

                <div className="novo-agendamento__summary-actions">

                  <button

                    type="button"

                    className={`summary-action${galleryImages.length ? '' : ' summary-action--muted'}`}

                    onClick={handleOpenGalleryModal}

                    title={galleryImages.length ? 'Ver fotos do estabelecimento' : 'Ainda sem imagens enviadas.'}

                  >

                    <svg

                      aria-hidden="true"

                      width="14"

                      height="14"

                      viewBox="0 0 24 24"

                      fill="none"

                      stroke="currentColor"

                      strokeWidth="2"

                      strokeLinecap="round"

                      strokeLinejoin="round"

                    >

                      <rect x="3" y="5" width="18" height="14" rx="2" />

                      <path d="M7 15l3-3 4 4 3-3 3 3" />

                      <circle cx="9" cy="9" r="1.5" />

                    </svg>

                    Fotos

                  </button>

                  <button type="button" className="summary-action" onClick={handleOpenInfo}>

                    <IconList aria-hidden style={{ width: 14, height: 14, color: 'var(--booking-accent-strong, var(--primary-600))' }} />

                    Inf.

                  </button>

                  {isOwnerViewing && (

                    <button

                      type="button"

                      className={`summary-action${publicShareLink ? '' : ' summary-action--muted'}`}

                      onClick={handleSharePublicPage}

                      disabled={!publicShareLink}

                      title={publicShareLink ? 'Compartilhar página do estabelecimento' : 'Link indisponível'}
                    >

                      <svg

                        aria-hidden="true"

                        width="14"

                        height="14"

                        viewBox="0 0 24 24"

                        fill="none"

                        stroke="currentColor"

                        strokeWidth="2"

                        strokeLinecap="round"

                        strokeLinejoin="round"

                      >

                        <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />

                        <path d="M16 6l-4-4-4 4" />

                        <path d="M12 2v14" />

                      </svg>

                      Compartilhar

                    </button>

                  )}

                  {!isAuthenticated ? (

                    <Link to={loginHref} className="summary-action">

                      <span aria-hidden>♡</span>

                      Favoritar

                    </Link>

                  ) : (

                    <button

                      type="button"

                      className={`summary-action${selectedExtras?.is_favorite ? ' summary-action--highlight' : ''}`}

                      onClick={handleToggleFavorite}

                      disabled={!isClientUser || favoriteUpdating}

                      title={!isClientUser ? 'Disponível apenas para clientes.' : undefined}

                    >

                      <span aria-hidden>♡</span>

                      {selectedExtras?.is_favorite ? 'Favorito' : 'Favoritar'}

                    </button>

                  )}

                  {!isAuthenticated ? (

                    <Link to={loginHref} className="summary-action">

                      <span aria-hidden>★</span>

                      Avaliar

                    </Link>

                  ) : (

                    <button

                      type="button"

                      className={`summary-action${ratingCount > 0 ? '' : ' summary-action--muted'}`}

                      onClick={handleOpenRatingModal}

                      disabled={!isClientUser || selectedExtras?.loading}

                      title={!isClientUser ? 'Disponível apenas para clientes.' : undefined}

                    >

                      <span aria-hidden>★</span>

                      {ratingButtonLabel}

                    </button>

                  )}

                </div>

                {todayScheduleInfo && (

                  <div className="novo-agendamento__summary-hours">

                    <span

                      className={`summary-status${todayScheduleInfo.status === 'open' ? ' summary-status--open' : todayScheduleInfo.status === 'soon' ? ' summary-status--soon' : todayScheduleInfo.status === 'closed' ? ' summary-status--closed' : ''}`}

                    >

                      <span className="summary-status__prefix">{todayScheduleInfo.prefix}</span>

                      {todayScheduleInfo.detail ? (

                        <span className="summary-status__detail">: {todayScheduleInfo.detail}</span>

                      ) : null}

                    </span>

                  </div>

                )}

              </div>

            </div>

          </div>

        )}

        <div className="establishments__results novo-agendamento__results">

          {step === 1 && renderEstablishmentResults()}

          {step === 2 && (

            <div className="card novo-agendamento__panel novo-agendamento__panel--services">

              {renderServiceStep()}

            </div>

          )}

          {step === 3 && (

            <div className="card novo-agendamento__panel">

              {renderScheduleContent()}

            </div>

          )}

        </div>

        {step === 2 && (

          <AppointmentServiceDock
            currentStep={step}
            selectedCount={selectedServices.length}
            duration={serviceDuration}
            priceLabel={servicePrice}
            onContinue={handleContinueFromServices}
            dockRef={serviceDockRef}
          />

        )}

      </div>

      {shouldRenderModals && (

        <Suspense fallback={null}>

          <LazyModals

            infoModalOpen={infoModalOpen}

            selectedEstablishment={selectedEstablishment}

            selectedEstablishmentName={selectedEstablishmentName}

            handleCloseInfo={handleCloseInfo}

            infoActiveTab={infoActiveTab}

            handleInfoTabChange={handleInfoTabChange}

            handleOpenGalleryModal={handleOpenGalleryModal}

            galleryImages={galleryImages}

            ratingCount={ratingCount}

            infoLoading={infoLoading}

            selectedExtras={selectedExtras}

            selectedEstablishmentAddress={selectedEstablishmentAddress}

            contactPhone={contactPhone}

            formatPhoneDisplay={formatPhoneDisplay}

            profileData={profileData}

            horariosList={horariosList}

            socialLinks={socialLinks}

            selectedProfessionals={selectedProfessionals}

            professionalsError={professionalsError}

            professionalInitials={professionalInitials}

            ratingAverageLabel={ratingAverageLabel}

            ratingSummary={ratingSummary}

            isClientUser={isClientUser}

            isAuthenticated={isAuthenticated}

            loginHref={loginHref}

            handleOpenRatingModal={handleOpenRatingModal}

            reviewsError={reviewsError}

            reviewsLoading={reviewsLoading}

            reviewsItems={reviewsItems}

            reviewsHasNext={reviewsHasNext}

            handleReviewsRetry={handleReviewsRetry}

            handleReviewsLoadMore={handleReviewsLoadMore}

            reviewDateFormatter={reviewDateFormatter}

            galleryModalOpen={galleryModalOpen}

            handleCloseGalleryModal={handleCloseGalleryModal}

            galleryViewIndex={galleryViewIndex}

            handleGalleryPrev={handleGalleryPrev}

            handleGalleryNext={handleGalleryNext}

            setGalleryViewIndex={setGalleryViewIndex}

            profileImageModalOpen={profileImageModalOpen}

            establishmentAvatar={establishmentAvatar}

            handleCloseProfileImage={handleCloseProfileImage}

            ratingModal={ratingModal}

            handleCloseRatingModal={handleCloseRatingModal}

            handleDeleteRating={handleDeleteRating}

            handleSaveRating={handleSaveRating}

            handleRatingStar={handleRatingStar}

            handleRatingCommentChange={handleRatingCommentChange}

            guestModal={guestModal}

            handleCloseGuestModal={handleCloseGuestModal}

            handleGuestResendOtp={handleGuestResendOtp}

            handleGuestOtpSubmit={handleGuestOtpSubmit}

            handleGuestFormSubmit={handleGuestFormSubmit}

            setGuestModal={setGuestModal}

            showGuestOptional={showGuestOptional}

            setShowGuestOptional={setShowGuestOptional}

            selectedSlot={selectedSlot}

            serviceLabel={serviceLabel}

            DateHelpers={DateHelpers}

            ServiceHelpers={ServiceHelpers}

            endTimeLabel={endTimeLabel}

            normalizePhoneDigits={normalizePhoneDigits}

            planLimitModal={planLimitModal}
            setPlanLimitModal={setPlanLimitModal}
            user={user}
            modal={modal}
            setModal={setModal}
            depositModal={depositModal}
            depositCountdown={depositCountdown}
            handleCloseDepositModal={closeDepositModal}
            handleCopyPixCode={handleCopyPixCode}
            selectedProfessional={selectedProfessional}
            serviceDuration={serviceDuration}
            servicePrice={servicePrice}
            confirmBooking={confirmBooking}
          />

        </Suspense>

      )}

      <div className="sr-only" aria-live="polite" ref={liveRef} />

    </div>

  );

}
