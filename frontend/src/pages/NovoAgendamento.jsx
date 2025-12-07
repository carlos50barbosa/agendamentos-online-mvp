// src/pages/NovoAgendamento.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Api, resolveAssetUrl } from "../utils/api";
import { getUser } from "../utils/auth";
import Modal from "../components/Modal.jsx";

import { IconSearch, IconMapPin } from "../components/Icons.jsx";

/* =================== Helpers de Data =================== */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

const DateHelpers = {
  // Parse de 'YYYY-MM-DD' como data local (evita UTC) ou mantÃ©m Date
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
    // Retorna 6 linhas x 7 colunas comeÃ§ando na segunda-feira
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

/* =================== Helpers de ServiÃ§o =================== */
const ServiceHelpers = {
  title: (s) => s?.title || s?.nome || `ServiÃ§o #${s?.id ?? ""}`,
  duration: (s) => Number(s?.duracao_min ?? s?.duration ?? 0),
  price: (s) => Number(s?.preco_centavos ?? s?.preco ?? s?.price_centavos ?? 0),
  description: (s) => (s?.descricao || s?.description || '').trim(),
  formatPrice: (centavos) =>
    (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
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
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
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



/* =================== Janela 07•22 =================== */
const DEFAULT_BUSINESS_HOURS = { start: 7, end: 22 };

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const inBusinessHours = (isoDatetime, schedule = null) => {
  const d = new Date(isoDatetime);
  if (Number.isNaN(d.getTime())) return false;
  if (schedule) {
    const rule = schedule[d.getDay()];
    if (!rule || !rule.enabled) return false;
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (Array.isArray(rule.blockMinutes) && rule.blockMinutes.some(([start, end]) => minutes >= start && minutes < end)) {
      return false;
    }
    return minutes >= rule.startMinutes && minutes <= rule.endMinutes;
  }
  const h = d.getHours();
  const m = d.getMinutes();
  const afterStart = h > DEFAULT_BUSINESS_HOURS.start || (h === DEFAULT_BUSINESS_HOURS.start && m >= 0);
  const beforeEnd = h < DEFAULT_BUSINESS_HOURS.end || (h === DEFAULT_BUSINESS_HOURS.end && m === 0);
  return afterStart && beforeEnd;
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
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=1C64F2&color=ffffff&rounded=true`;
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
  if (!parts.length) return '??';
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

const SlotButton = ({ slot, isSelected, onClick, density = "compact" }) => {
  const isPast = DateHelpers.isPastSlot(slot.datetime);

  const statusClass = slotStatusClass(slot.label);
  const disabledReason = isPast || !isAvailableLabel(slot.label);
  const tooltipLabel = slot?.label ?? 'disponí­vel';

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
  const showPrice = price !== 'R$ 0,00';
  const showDuration = duration > 0;
  const cardClass = ['mini-card', selected ? 'mini-card--selected' : ''].filter(Boolean).join(' ');
  return (
    <div className={cardClass} onClick={() => onSelect(service)}>
      <div className="mini-card__content">
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


const EstablishmentCard = ({ est, selected, onSelect, distance, userLocation, formatter, hasDistance }) => {
  const name = est?.nome || est?.name || est?.fantasia || est?.razao_social || `Estabelecimento #${est?.id || ''}`;
  const address = formatAddress(est);
  const avatarSource = est?.foto_url || est?.avatar_url || '';
  const ratingAverageRaw = Number(est?.rating_average ?? est?.ratingAverage ?? NaN);
  const ratingCount = Number(est?.rating_count ?? est?.ratingCount ?? 0);
  const hasRatings = Number.isFinite(ratingAverageRaw) && ratingCount > 0;
  const ratingLabel = hasRatings ? ratingNumberFormatter.format(ratingAverageRaw) : null;
  const distanceLabel = !userLocation
    ? 'Ative a localizacao para ver a distancia'
    : hasDistance
    ? Number.isFinite(distance)
      ? `${formatter.format(distance)} km`
      : 'Distancia indisponivel'
    : 'Calculando distancias...';

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
        <p className="establishment-card__address">{address || 'Endereco nao informado'}</p>
        <div className="establishment-card__meta-row">
          <span className="establishment-card__distance">{distanceLabel}</span>
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

/* =================== PÃ¡gina Principal =================== */
export default function NovoAgendamento() {
  const user = getUser();
  const isAuthenticated = Boolean(user?.id);
  const isClientUser = user?.tipo === 'cliente';
  const liveRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const nav = useNavigate();
  const location = useLocation();
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

  // Redireciona estabelecimentos para seu dashboard
  useEffect(() => {
    if (user?.tipo === 'estabelecimento') {
      nav('/estab', { replace: true });
    }
  }, [user?.tipo, nav]);
  if (user?.tipo === 'estabelecimento') {
    return <div className="container"><div className="empty">Redirecionandoâ€¦</div></div>;
  }

  const [state, setState] = useState({
    establishments: [],
    services: [],
    establishmentId: user?.tipo === "estabelecimento" ? String(user.id) : "",
    serviceId: "",

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const coordsCacheRef = useRef(new Map());
  const servicesSectionRef = useRef(null);
  const [distanceMap, setDistanceMap] = useState({});
  const [establishmentsLoading, setEstablishmentsLoading] = useState(true);
  const [establishmentsError, setEstablishmentsError] = useState('');
  const [establishmentExtras, setEstablishmentExtras] = useState({});
  const [professionalsByEstab, setProfessionalsByEstab] = useState({});
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [galleryViewIndex, setGalleryViewIndex] = useState(0);
  const [infoModalError, setInfoModalError] = useState('');
  const [infoActiveTab, setInfoActiveTab] = useState('about');
  const [ratingModal, setRatingModal] = useState({ open: false, nota: 0, comentario: '', saving: false, error: '' });

  // Inicializa estQuery a partir de ?q= da URL e reage a mudanÃ§as no histÃ³rico
  useEffect(() => {
    const q = (searchParams.get('q') || '').trim();
    if (q !== estQuery) setEstQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
  // Sempre forÃ§a a segunda-feira correspondente
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
  const [toast, setToast] = useState(null);
  const [viewMode] = useState('month'); // por ora, Mês Ã© o padrÃ£o
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
    establishments, services, establishmentId, serviceId,
    currentWeek, slots, loading, error, selectedSlot, filters, density, forceBusy,
  } = state;

  const selectedSlotNow = useMemo(
    () => slots.find((s) => s.datetime === selectedSlot?.datetime),
    [slots, selectedSlot]
  );

  // Derivados
  const selectedService = useMemo(() => services.find((s) => String(s.id) === serviceId), [services, serviceId]);
  const selectedEstablishment = useMemo(
    () => establishments.find((e) => String(e.id) === establishmentId),
    [establishments, establishmentId]
  );
  const selectedEstablishmentName = useMemo(() => displayEstablishmentName(selectedEstablishment), [selectedEstablishment]);
  const selectedEstablishmentAddress = useMemo(() => displayEstablishmentAddress(selectedEstablishment), [selectedEstablishment]);

  const selectedEstablishmentId = selectedEstablishment ? String(selectedEstablishment.id) : null;
  const selectedExtras = selectedEstablishmentId ? establishmentExtras[selectedEstablishmentId] : null;
  const selectedProfessionals = selectedEstablishmentId ? professionalsByEstab[selectedEstablishmentId] : null;
  const profileData = selectedExtras?.profile || null;
  const galleryImages = Array.isArray(selectedExtras?.gallery) ? selectedExtras.gallery : [];
  const horariosList = useMemo(
    () => (Array.isArray(profileData?.horarios) ? profileData.horarios : []),
    [profileData?.horarios]
  );
  const workingSchedule = useMemo(() => buildWorkingSchedule(horariosList), [horariosList]);
  const reviewsState = selectedExtras?.reviews || { items: [], page: 0, hasNext: true, loading: false, loaded: false, error: '' };
  const reviewsItems = Array.isArray(reviewsState.items) ? reviewsState.items : [];
  const reviewsLoading = Boolean(reviewsState.loading);
  const reviewsError = reviewsState.error || '';
  const reviewsHasNext = reviewsState.hasNext !== false;

  const establishmentAvatar = useMemo(() => {
    const source = selectedEstablishment?.avatar_url || selectedEstablishment?.logo_url || selectedEstablishment?.foto_url;
    return resolveAssetUrl(source || '');
  }, [selectedEstablishment]);
  const normalizedQuery = useMemo(() => normalizeText(estQuery.trim()), [estQuery]);
  const queryTokens = useMemo(
    () => (normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : []),
    [normalizedQuery]
  );

  const filteredEstablishments = useMemo(() => {
    if (!queryTokens.length) return establishments;
    return establishments.filter((est) => {
      const haystack = buildEstablishmentSearchText(est);
      return queryTokens.every((token) => haystack.includes(token));
    });
  }, [establishments, queryTokens]);

  const kmFormatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );

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

  const establishmentResults = useMemo(() => {
    const mapped = filteredEstablishments.map((est) => ({
      est,
      distance: distanceMap[String(est.id)],
      hasDistance: Object.prototype.hasOwnProperty.call(distanceMap, String(est.id)),
    }));
    const sortKey = (value) =>
      normalizeText(value?.nome || value?.name || value?.fantasia || value?.razao_social || `est-${value?.id || ''}`);
    const sorted = [...mapped];
    if (userLocation) {
      sorted.sort((a, b) => {
        const da = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
        const db = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return sortKey(a.est).localeCompare(sortKey(b.est));
      });
    } else {
      sorted.sort((a, b) => sortKey(a.est).localeCompare(sortKey(b.est)));
    }
    return sorted;
  }, [distanceMap, filteredEstablishments, userLocation]);

  // Passo da grade
  const stepMinutes = useMemo(() => {
    const d = ServiceHelpers.duration(selectedService);
    if (d && d % 5 === 0) return Math.max(15, Math.min(120, d));
    return 30;
  }, [selectedService]);

  // PersistÃªncia leve (filtros/densidade)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("novo-agendamento-ui") || "{}");
      setState((p) => ({
        ...p,
        filters: { ...p.filters, ...saved.filters, onlyAvailable: false }, // forÃ§a exibir ocupados
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
  const showToast = useCallback((type, message, duration = 4500) => {
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


  /* ====== Carregar Estabelecimentos ====== */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setEstablishmentsLoading(true);
        setEstablishmentsError('');
        const list = await Api.listEstablishments();
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          establishments: Array.isArray(list) ? list : [],
        }));
      } catch {
        if (cancelled) return;
        setEstablishmentsError('Nao foi possivel carregar estabelecimentos.');
        showToast('error', 'Nao foi possivel carregar estabelecimentos.');
      } finally {
        if (!cancelled) setEstablishmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Se vier ?estabelecimento= na URL, seleciona automaticamente apÃ³s carregar a lista
  useEffect(() => {
    const estParam = (searchParams.get('estabelecimento') || '').trim();
    if (establishments.length && estParam && estParam !== state.establishmentId) {
      setState((p) => ({ ...p, establishmentId: estParam, serviceId: "", professionalId: "", slots: [], selectedSlot: null }));
    }
  }, [establishments, searchParams, state.establishmentId]);

  /* ====== Carregar ServiÃ§os quando escolher Estabelecimento ====== */
  useEffect(() => {
    (async () => {
      if (!establishmentId) {
        setState((p) => ({ ...p, services: [], serviceId: "", professionalId: "", slots: [], selectedSlot: null }));
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
          serviceId: "",

    professionalId: "", // aguarda o clique do usuÃ¡rio
          slots: [],
          selectedSlot: null,
        }));

        // Se veio ?servico= na URL e existir na lista, seleciona automaticamente
        try{
          const svcParam = (searchParams.get('servico') || '').trim();
          if (svcParam && Array.isArray(list) && list.some((s) => String(s.id) === svcParam)) {
            setState((p) => ({ ...p, serviceId: svcParam }));
          } else {
            const sp = new URLSearchParams(searchParams);
            sp.delete('servico');
            setSearchParams(sp, { replace: true });
          }
        }catch{}
      } catch {
        setState((p) => ({ ...p, services: [], serviceId: "", professionalId: "", slots: [], selectedSlot: null }));
        showToast("error", "Não foi possÃ­vel carregar os serviÃ§os.");
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

  /* ====== NormalizaÃ§Ã£o de slots ====== */
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
          : "disponí­vel";
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

    try {
      if (typeof Api.meusAgendamentos === 'function') {
        const mine = await Api.meusAgendamentos();
        (mine || []).forEach((a) => {
          if (!isActiveStatus(a.status)) return;
          if (serviceId && a.servico_id && String(a.servico_id) !== String(serviceId)) return;
          if (state.professionalId && a.profissional_id != null && String(a.profissional_id) !== String(state.professionalId)) return;
          const t = +new Date(a.inicio);
          if (t >= start && t < end) add(a.inicio);
        });
      }
    } catch {}

    try {
      if (user?.tipo === 'estabelecimento' && typeof Api.agendamentosEstabelecimento === 'function') {
        const est = await Api.agendamentosEstabelecimento();
        (est || []).forEach((a) => {
          if (!isActiveStatus(a.status)) return;
          if (serviceId && a.servico_id && String(a.servico_id) !== String(serviceId)) return;
          if (state.professionalId && a.profissional_id != null && String(a.profissional_id) !== String(state.professionalId)) return;
          const t = +new Date(a.inicio);
          if (t >= start && t < end) add(a.inicio);
        });
      }
    } catch {}

    return counts;
  }, [currentWeek, user?.tipo, serviceId, state.professionalId]);

  /* ====== Carregar Slots ====== */
  const loadSlots = useCallback(async () => {
    if (!establishmentId || !serviceId) {
      setState((p) => ({ ...p, slots: [], selectedSlot: null }));
      return;
    }
    try {
      setState((p) => ({ ...p, loading: true, error: "" }));

      // A) slots reais (pedindo ocupados/bloqueados)
      const slotsData = await Api.getSlots(establishmentId, currentWeek, { includeBusy: true });
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
          : Math.max(1, Array.isArray(selectedService?.professionals) ? selectedService.professionals.length : 1);

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

        const firstAvailable = overlayed.find(
          (s) =>
            isAvailableLabel(s.label) &&
            !DateHelpers.isPastSlot(s.datetime) &&
            inBusinessHours(s.datetime, workingSchedule)
        );

        return {
          ...prev,
          slots: overlayed,
          selectedSlot: firstAvailable || prev.selectedSlot || null,
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
  }, [establishmentId, serviceId, currentWeek, normalizeSlots, stepMinutes, getBusyFromAppointments, selectedService, state.professionalId, workingSchedule]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    if (!selectedSlot) return;
    if (!inBusinessHours(selectedSlot.datetime, workingSchedule)) {
      setState((p) => ({ ...p, selectedSlot: null }));
    }
  }, [selectedSlot, workingSchedule]);

  useEffect(() => {
    setProfessionalMenuOpen(false);
  }, [serviceId]);

  // Teclas semana
  useEffect(() => {
    const onKey = (e) => {
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
      if (!inBusinessHours(slot.datetime, workingSchedule)) return false;
      if (filters.onlyAvailable && !isAvailableLabel(slot.label)) return false;
      if (filters.hidePast && DateHelpers.isPastSlot(slot.datetime)) return false;
      if (!timeRangeCheck(slot.datetime)) return false;
      return true;
    },
    [filters, timeRangeCheck, workingSchedule]
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

  // announce seleÃ§Ã£o (a11y)
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
      const msgReminder = `â° Lembrete: faltam 8 horas para o seu ${servicoNome} em ${estabelecimentoNome} (${horaBR} de ${dataBR}).`;
      const tasks = [];
      if (reminderTime.getTime() > now)
        tasks.push(Api.scheduleWhatsApp?.({ to: toPhone, scheduledAt: reminderTime.toISOString(), message: msgReminder, metadata: { kind: "reminder_8h", appointmentAt: start.toISOString() } }));
      if (!tasks.length) {
        showToast("info", "Agendado! Sem lembrete porque o horário está¡ muito próximo.");
        return;
      }
      const results = await Promise.allSettled(tasks);
      const failed = results.some((r) => r.status === "rejected");
      showToast(failed ? "error" : "success", failed ? "Agendado! Falha ao programar o lembrete." : "Agendado com sucesso! Lembrete programado.");
    },
    [showToast, user]
  );

  // Verifica se o agendamento existe mesmo apÃ³s um erro
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
        if (typeof Api.meusAgendamentos === "function") {
          const mine = await Api.meusAgendamentos();
          meu =
            Array.isArray(mine) &&
            mine.some((a) => isActiveStatus(a.status) && sameStart(a.inicio, slotIso));
        }
      } catch {}

      if (!slotIndisponivel && typeof Api.agendamentosEstabelecimento === "function") {
        try {
          const est = await Api.agendamentosEstabelecimento();
          slotIndisponivel =
            Array.isArray(est) && est.some((a) => isActiveStatus(a.status) && sameStart(a.inicio, slotIso));
        } catch {}
      }

      return { slotIndisponivel, meu };
    },
    [establishmentId, currentWeek, normalizeSlots]
  );

  // Confirmar
  const confirmBooking = useCallback(async () => {
    if (!selectedSlot || !serviceId || !selectedService) return;

    if (bookingBlocked) {
      showToast('error', bookingBlockedMessage);
      return;
    }

    if (DateHelpers.isPastSlot(selectedSlot.datetime)) {
      showToast("error", "Não foi possível agendar no passado.");
      return;
    }
    if (!inBusinessHours(selectedSlot.datetime, workingSchedule)) {
      const outOfHoursMessage = workingSchedule
        ? "Este horário está fora do horário de atendimento do estabelecimento."
        : "Este horário está fora do período de 07:00-22:00.";
      showToast("error", outOfHoursMessage);
      return;
    }
    if (serviceProfessionals.length && !state.professionalId) {
      showToast("error", "Selecione um profissional para continuar.");
      return;
    }

    setModal((p) => ({ ...p, isSaving: true }));
    let success = false;

    try {
      const payload = {
        estabelecimento_id: Number(establishmentId),
        servico_id: Number(serviceId),
        inicio: selectedSlot.datetime,
      };
      if (serviceProfessionals.length && state.professionalId) {
        payload.profissional_id = Number(state.professionalId);
      }
      await Api.agendar(payload);

      success = true;
      setModal((p) => ({ ...p, isOpen: false }));
      await scheduleWhatsAppReminders({
        inicioISO: selectedSlot.datetime,
        servicoNome: ServiceHelpers.title(selectedService),
        estabelecimentoNome: selectedEstablishment?.name || "seu estabelecimento",
      });
      showToast("success", "Agendado com sucesso!");

    } catch (e) {
      const code =
        e?.status || e?.data?.status || (/\b(409|500)\b/.exec(String(e?.message))?.[1] | 0);

      const { slotIndisponivel, meu } = await verifyBookingCreated(selectedSlot.datetime);

      if (Number(code) === 409) {
        if (meu) {
          success = true;
          setModal((p) => ({ ...p, isOpen: false }));
          showToast("success", "Seu agendamento já existia e foi confirmado.");
          // persiste overlay para sobreviver ao reload
          {
            const key = `fb:${establishmentId}:${currentWeek}`;
            setState((p) => {
              const list = Array.from(new Set([...p.forceBusy, minuteISO(selectedSlot.datetime)]));
              try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
              return { ...p, forceBusy: list };
            });
          }
        } else {
          showToast("error", "Este horário acabou de ficar indisponí­vel. Escolha outro.");
        }
      } else if (Number(code) === 500) {
        // Se criou (meu) OU o slot ficou indisponí­vel por qualquer fonte, tratamos como sucesso.
        if (slotIndisponivel || meu) {
          success = true;
          setModal((p) => ({ ...p, isOpen: false }));
          showToast("success", "Agendado com sucesso! (o servidor retornou 500)");

          // Se o /slots ainda NÃƒO marcou ocupado, forÃ§a overlay vermelho neste minuto
          if (!slotIndisponivel) {
            const key = `fb:${establishmentId}:${currentWeek}`;
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
    } finally {
      // Sempre recarrega para refletir indisponÃ­veis
      await loadSlots();

      // Evita duplo clique se deu certo
      if (success) setState((p) => ({ ...p, selectedSlot: null }));

      setModal((p) => ({ ...p, isSaving: false }));
    }
  }, [
    selectedSlot,
    serviceId,
    selectedService,
    selectedEstablishment,
    establishmentId,
    bookingBlocked,
    bookingBlockedMessage,
    scheduleWhatsAppReminders,
    loadSlots,
    showToast,
    verifyBookingCreated,
    workingSchedule,
  ]);

  /* ====== Handlers ====== */
  const handleQueryChange = useCallback(
    (value) => {
      setEstQuery(value);
      const trimmed = value.trim();
      const sp = new URLSearchParams(searchParams);
      if (trimmed) sp.set('q', trimmed);
      else sp.delete('q');
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleUseLocation = useCallback(() => {
    if (!navigator?.geolocation) {
      setGeoError('Geolocalizacao nao esta disponivel neste dispositivo.');
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
        setGeoError('Nao foi possivel obter sua localizacao.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const handleEstablishmentClick = (est) => {
    setState((p) => ({ ...p, establishmentId: String(est.id), serviceId: "", professionalId: "", slots: [], selectedSlot: null }));
    try{
      const sp = new URLSearchParams(searchParams);
      sp.set('estabelecimento', String(est.id));
      setSearchParams(sp, { replace: true });
    }catch{}
  };

  const handleChangeService = () => {
    setState((p) => ({ ...p, serviceId: '', professionalId: '', slots: [], selectedSlot: null }));
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
    setState((p) => ({ ...p, serviceId: String(svc.id), professionalId: "", slots: [], selectedSlot: null }));
    setProfessionalMenuOpen(false);
    try{
      const sp = new URLSearchParams(searchParams);
      sp.set('servico', String(svc.id));
      setSearchParams(sp, { replace: true });
    }catch{}
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
    if (bookingBlocked) {
      showToast('error', bookingBlockedMessage);
      return;
    }
    if (!isAuthenticated) {
      showToast('info', 'Faça login para confirmar seu agendamento.')
      return
    }
    setModal((m) => ({ ...m, isOpen: true }))
  }, [bookingBlocked, bookingBlockedMessage, isAuthenticated, showToast])

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
  const contactEmail = profileData?.contato_email || selectedEstablishment?.email || null;
  const contactPhone = profileData?.contato_telefone || selectedEstablishment?.telefone || null;
  const infoLoading = Boolean(selectedExtras?.loading);
  const professionalsError = selectedProfessionals?.error || infoModalError || '';
  const serviceDuration = ServiceHelpers.duration(selectedService);
  const servicePrice = ServiceHelpers.formatPrice(ServiceHelpers.price(selectedService));
  const serviceProfessionals = Array.isArray(selectedService?.professionals) ? selectedService.professionals : [];
  const selectedProfessional = useMemo(() => {
    if (!serviceProfessionals.length || !state.professionalId) return null;
    return serviceProfessionals.find((p) => String(p.id) === String(state.professionalId)) || null;
  }, [serviceProfessionals, state.professionalId]);
  useEffect(() => {
    if (serviceProfessionals.length === 1) {
      const only = String(serviceProfessionals[0]?.id || "");
      if (state.professionalId !== only) {
        setState((p) => ({ ...p, professionalId: only }));
      }
      setProfessionalMenuOpen(false);
    }
  }, [serviceProfessionals, state.professionalId]);

  const endTimeLabel = useMemo(() => {
    if (!selectedSlot || !serviceDuration) return null;
    const end = DateHelpers.addMinutes(new Date(selectedSlot.datetime), serviceDuration);
    return DateHelpers.formatTime(end.toISOString());
  }, [selectedSlot, serviceDuration]);

  const weekLabel = DateHelpers.formatWeekLabel(currentWeek);

  // Reordenar colunas da semana para comeÃ§ar pelo dia atual (se pertencer Ã  semana atual)
  const daysToRender = useMemo(() => {
    const list = DateHelpers.weekDays(currentWeek);
    const todayIso = DateHelpers.toISODate(new Date());
    const idx = list.findIndex(({ iso }) => DateHelpers.sameYMD(iso, todayIso));
    return idx > 0 ? [...list.slice(idx), ...list.slice(0, idx)] : list;
  }, [currentWeek]);

  /* ====== UI por passos ====== */
  const isOwner = user?.tipo === "estabelecimento";
  const step = !establishmentId && !isOwner ? 1 : !serviceId ? 2 : 3;

  // Ao clicar num dia do Mês, define a semana correspondente e marca o dia
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

  const introSubtitle = step === 1
    ? 'Encontre um estabelecimento para iniciar um novo agendamento.'
    : selectedEstablishmentName
    ? `Agendamento em ${selectedEstablishmentName}.`
    : 'Selecione um estabelecimento para continuar.';

  const renderEstablishmentSearch = () => (
    <>
      <div className="novo-agendamento__search">
        <div className="novo-agendamento__searchbox">
          <IconSearch className="novo-agendamento__search-icon" aria-hidden />
          <input
            className="input novo-agendamento__search-input"
            type="search"
            placeholder="Buscar por nome, bairro ou cidade"
            value={estQuery}
            onChange={(event) => handleQueryChange(event.target.value)}
            aria-label="Buscar estabelecimentos"
          />
          <span className="novo-agendamento__search-caret" aria-hidden>▾</span>
        </div>
        <button
          type="button"
          className="novo-agendamento__location"
          onClick={handleUseLocation}
          disabled={locating}
        >
          <IconMapPin className="novo-agendamento__location-icon" aria-hidden />
          <span>{locating ? 'Localizando...' : 'Usar minha localização'}</span>
        </button>
      </div>
      {geoError && <div className="notice notice--error" role="alert">{geoError}</div>}
      {geocoding && (
        <div className="novo-agendamento__status muted" aria-live="polite">
          Calculando distâncias dos estabelecimentos...
        </div>
      )}
    </>
  );
  const renderEstablishmentResults = () => {
    if (establishmentsLoading) {
      return (
        <div className="card">
          <div className="empty">Carregando...</div>
        </div>
      );
    }
    if (establishmentsError) {
      return (
        <div className="card">
          <div className="empty error">{establishmentsError}</div>
        </div>
      );
    }
    if (!establishmentResults.length) {
      return (
        <div className="card">
          <div className="empty">Nenhum estabelecimento encontrado.</div>
        </div>
      );
    }
    return (
      <div className="establishments__grid">
        {establishmentResults.map(({ est, distance, hasDistance }) => (
          <EstablishmentCard
            key={est.id}
            est={est}
            selected={String(est.id) === establishmentId}
            onSelect={handleEstablishmentClick}
            distance={distance}
            hasDistance={hasDistance}
            userLocation={userLocation}
            formatter={kmFormatter}
          />
        ))}
      </div>
    );
  };

  const renderServiceStep = () => (
    <>
      <div className="row spread" style={{ alignItems: 'center' }}>
        <div className="muted">
          <b>Estabelecimento:</b> {selectedEstablishmentName || '-'}
        </div>
        <button
          className="btn btn--outline btn--sm"
          onClick={() => {
            setState((p) => ({ ...p, establishmentId: '', services: [], serviceId: '', professionalId: '', slots: [], selectedSlot: null }));
            try {
              const sp = new URLSearchParams(searchParams);
              sp.delete('estabelecimento');
              sp.delete('servico');
              setSearchParams(sp, { replace: true });
            } catch {}
          }}
        >
          Trocar
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>Escolha um serviço:</p>
      <div ref={servicesSectionRef} className="novo-agendamento__services">
        {services.length === 0 ? (
          <div className="empty small">Sem serviços cadastrados.</div>
        ) : (
          services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              selected={String(s.id) === serviceId}
              onSelect={handleServiceClick}
            />
          ))
        )}
      </div>
    </>
  );

  const renderScheduleContent = () => {
    const todayIso = DateHelpers.toISODate(new Date());
    return (
      <>
      {serviceProfessionals.length > 0 && (
        <div className="novo-agendamento__section">
          <div className="grid" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>Profissional</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {serviceProfessionals.length === 1 ? '1 profissional disponível' : `${serviceProfessionals.length} profissionais disponíveis`}
              </span>
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
                <span className="novo-agendamento__select-caret" aria-hidden>▾</span>
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
        <div className="row spread" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div className="novo-agendamento__inline-summary">
            <div className="inline-summary__item">
              <span className="inline-summary__label">Estabelecimento:</span>
              <span className="inline-summary__value">{selectedEstablishmentName}</span>
            </div>
            <span className="inline-summary__dot" aria-hidden />
            <div className="inline-summary__item inline-summary__item--service">
              <span className="inline-summary__label">Serviço:</span>
              <span className="inline-summary__value">{ServiceHelpers.title(selectedService)}</span>
              {(serviceDuration || servicePrice !== 'R$ 0,00') && (
                <div className="inline-summary__meta">
                  {serviceDuration ? <span>{serviceDuration} min</span> : null}
                  {servicePrice !== 'R$ 0,00' ? <span>{servicePrice}</span> : null}
                </div>
              )}
            </div>
          </div>
          <details className="filters" style={{ marginLeft: 'auto' }}>
            <summary>Filtros</summary>
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

          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))} disabled={!selectedSlot}>
              Limpar seleção
            </button>
            <button
              className="btn btn--primary"
              onClick={handleConfirmClick}
              disabled={
                !selectedSlot || !serviceId || modal.isSaving ||
                (serviceProfessionals.length && !state.professionalId) ||
                (selectedSlotNow && !isAvailableLabel(selectedSlotNow.label)) ||
                DateHelpers.isPastSlot(selectedSlot.datetime) ||
                !inBusinessHours(selectedSlot.datetime, workingSchedule) ||
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
    <div className="novo-agendamento">
      {toast && (
        <div className="novo-agendamento__toast">
          <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />
        </div>
      )}
      <div className="establishments">
        <div className="card establishments__intro novo-agendamento__intro">
          <h1 className="establishments__title">Novo agendamento</h1>
          <p className="muted establishments__subtitle">{introSubtitle}</p>

          {step === 1 && renderEstablishmentSearch()}
          {step > 1 && (
            <div className="novo-agendamento__summary novo-agendamento__summary--establishment">
              <div className="novo-agendamento__summary-avatar">
                {establishmentAvatar ? (
                  <img src={establishmentAvatar} alt={`Logo de ${selectedEstablishmentName || 'estabelecimento'}`} />
                ) : (
                  <span>{(selectedEstablishmentName || 'AO').slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="novo-agendamento__summary-content">
                <strong className="novo-agendamento__summary-name">{selectedEstablishmentName || 'Estabelecimento'}</strong>
                <span className="novo-agendamento__summary-address">{selectedEstablishmentAddress || 'Endereço não informado'}</span>
                <div className="novo-agendamento__summary-actions">
                  {!isAuthenticated ? (
                    <Link to={loginHref} className="summary-action summary-action--cta">
                      <span aria-hidden>🔒</span>
                      Entre para avaliar
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`summary-action${ratingCount > 0 ? '' : ' summary-action--muted'}`}
                      onClick={handleOpenRatingModal}
                      disabled={!isClientUser || selectedExtras?.loading}
                      title={!isClientUser ? 'Disponível apenas para clientes.' : undefined}
                    >
                      <span aria-hidden>{ratingCount > 0 ? '★' : '☆'}</span>
                      {ratingButtonLabel}
                    </button>
                  )}
                  <button type="button" className="summary-action" onClick={handleOpenInfo}>
                    <span aria-hidden>🛈</span>
                    Informações
                  </button>
                  <button
                    type="button"
                    className={`summary-action${galleryImages.length ? '' : ' summary-action--muted'}`}
                    onClick={handleOpenGalleryModal}
                    title={galleryImages.length ? 'Ver fotos do estabelecimento' : 'Ainda sem imagens enviadas.'}
                  >
                    <span aria-hidden>📷</span>
                    Fotos
                  </button>
                  {!isAuthenticated ? (
                    <Link to={loginHref} className="summary-action summary-action--cta">
                      <span aria-hidden>♡</span>
                      Entre para favoritar
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`summary-action${selectedExtras?.is_favorite ? ' summary-action--highlight' : ''}`}
                      onClick={handleToggleFavorite}
                      disabled={!isClientUser || favoriteUpdating}
                      title={!isClientUser ? 'Disponível apenas para clientes.' : undefined}
                    >
                      <span aria-hidden>{selectedExtras?.is_favorite ? '♥' : '♡'}</span>
                      {selectedExtras?.is_favorite ? 'Favorito' : 'Favoritar'}
                    </button>
                  )}
                </div>
              </div>
              {selectedService && (
                <div className="novo-agendamento__summary-service">
                  <span className="novo-agendamento__summary-label">Serviço selecionado</span>
                  <strong>{ServiceHelpers.title(selectedService)}</strong>
                  <button type="button" className="novo-agendamento__change-service" onClick={handleChangeService}>Trocar serviço</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="establishments__results novo-agendamento__results">
          {step === 1 && renderEstablishmentResults()}
          {step === 2 && (
            <div className="card novo-agendamento__panel">
              {renderServiceStep()}
            </div>
          )}
          {step === 3 && (
            <div className="card novo-agendamento__panel">
              <div className="novo-agendamento__toolbar">
                <h2 className="novo-agendamento__title">Agenda da semana</h2>
                <small className="novo-agendamento__week-info" title={`Fuso: ${TZ} — Janela: 07:00-22:00`}>
                  Semana: {weekLabel}
                </small>
              </div>

              {renderScheduleContent()}
            </div>
          )}
        </div>
      </div>

      {infoModalOpen && selectedEstablishment && (
        <Modal
          title={`Informações de ${selectedEstablishmentName || 'Estabelecimento'}`}
          onClose={handleCloseInfo}
          closeButton
          bodyClassName="modal__body--scroll"
        >
          <div className="estab-info">
            <div
              className="estab-info__tabs"
              role="tablist"
              aria-label="Detalhes do estabelecimento"
            >
              <button
                type="button"
                className={`estab-info__tab${infoActiveTab === 'about' ? ' is-active' : ''}`}
                onClick={() => handleInfoTabChange('about')}
                role="tab"
                aria-selected={infoActiveTab === 'about'}
              >
                Informações
              </button>
              <button
                type="button"
                className="estab-info__tab"
                onClick={handleOpenGalleryModal}
                aria-haspopup="dialog"
              >
                Fotos{galleryImages.length ? ` (${galleryImages.length})` : ''}
              </button>
              <button
                type="button"
                className={`estab-info__tab${infoActiveTab === 'reviews' ? ' is-active' : ''}`}
                onClick={() => handleInfoTabChange('reviews')}
                role="tab"
                aria-selected={infoActiveTab === 'reviews'}
              >
                Avaliações{ratingCount > 0 ? ` (${ratingCount})` : ''}
              </button>
            </div>
            <div className="estab-info__content">
              {infoActiveTab === 'about' ? (
                infoLoading ? (
                  <div className="estab-info__loading">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div
                        key={`info-skeleton-${index}`}
                        className="shimmer"
                        style={{ height: 14, width: `${90 - index * 10}%` }}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {selectedExtras?.error && (
                      <div className="notice notice--error" role="alert">
                        {selectedExtras.error}
                      </div>
                    )}
                    <section className="estab-info__section">
                      <h4>Endereço</h4>
                      <p>{selectedEstablishmentAddress || 'Endereço não informado.'}</p>
                    </section>
                    <section className="estab-info__section">
                      <h4>Contato</h4>
                      {contactPhone || contactEmail ? (
                        <ul className="estab-info__list">
                          {contactPhone && (
                            <li>Telefone: {formatPhoneDisplay(contactPhone) || contactPhone}</li>
                          )}
                          {contactEmail && (
                            <li>
                              Email: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                            </li>
                          )}
                        </ul>
                      ) : (
                        <p className="muted">Contato não informado.</p>
                      )}
                    </section>
                    <section className="estab-info__section">
                      <h4>Sobre</h4>
                      {profileData?.sobre ? (
                        <p>{profileData.sobre}</p>
                      ) : (
                        <p className="muted">Nenhuma informação cadastrada.</p>
                      )}
                    </section>
                    <section className="estab-info__section">
                      <h4>Horários de atendimento</h4>
                      {horariosList.length ? (
                        <ul className="estab-info__list">
                          {horariosList.map((item, index) => (
                            <li key={`${item.label || 'horario'}-${index}`}>
                              {item.label ? (
                                <>
                                  <strong>{item.label}:</strong> {item.value || item.label}
                                </>
                              ) : (
                                item.value || item.label
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">Nenhum horário cadastrado.</p>
                      )}
                    </section>
                    <section className="estab-info__section">
                      <h4>Links</h4>
                      {socialLinks.length ? (
                        <ul className="estab-info__links">
                          {socialLinks.map(({ key, label, url }) => (
                            <li key={key}>
                              <a href={url} target="_blank" rel="noopener noreferrer">
                                {label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">Nenhum link cadastrado.</p>
                      )}
                    </section>
                    <section className="estab-info__section">
                      <h4>Profissionais</h4>
                      {selectedProfessionals?.loading ? (
                        <ul className="estab-info__professionals estab-info__professionals--loading">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <li key={`prof-skeleton-${index}`} className="estab-info__professional">
                              <div className="estab-info__professional-avatar shimmer" />
                              <div className="estab-info__professional-info">
                                <div className="shimmer" style={{ height: 12, width: '70%' }} />
                                <div className="shimmer" style={{ height: 10, width: '50%' }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : professionalsError ? (
                        <p className="notice notice--error" role="alert">
                          {professionalsError}
                        </p>
                      ) : selectedProfessionals?.items?.length ? (
                        <ul className="estab-info__professionals">
                          {selectedProfessionals.items.map((prof) => {
                            const avatar = prof?.avatar_url ? resolveAssetUrl(prof.avatar_url) : '';
                            const initials = professionalInitials(prof?.nome || prof?.name);
                            return (
                              <li key={prof.id} className="estab-info__professional">
                                <div className="estab-info__professional-avatar">
                                  {avatar ? (
                                    <img
                                      src={avatar}
                                      alt={`Foto de ${prof.nome || prof.name || 'profissional'}`}
                                    />
                                  ) : (
                                    <span>{initials}</span>
                                  )}
                                </div>
                                <div className="estab-info__professional-info">
                                  <strong>{prof.nome || prof.name}</strong>
                                  {prof.descricao ? (
                                    <span className="muted">{prof.descricao}</span>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="muted">Nenhum profissional cadastrado.</p>
                      )}
                    </section>
                  </>
                )
              ) : (
                <div className="estab-reviews">
                  <div className="estab-reviews__summary">
                    <div className="estab-reviews__average" aria-label={`Nota média ${ratingAverageLabel ?? '–'}`}>
                      <span className="estab-reviews__value">{ratingAverageLabel ?? '–'}</span>
                      <div className="estab-reviews__stars" aria-hidden="true">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <span
                            key={`summary-star-${value}`}
                            className={`estab-reviews__star${
                              ratingSummary?.average != null && ratingSummary.average >= value - 0.5 ? ' is-active' : ''
                            }`}
                          >
                            {ratingSummary?.average != null && ratingSummary.average >= value - 0.5 ? '★' : '☆'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="estab-reviews__count">
                      {ratingCount > 0
                        ? `${ratingCount} ${ratingCount === 1 ? 'avaliação' : 'avaliações'}`
                        : 'Ainda sem avaliações'}
                    </div>
                    {isClientUser ? (
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={handleOpenRatingModal}
                      >
                        Avaliar estabelecimento
                      </button>
                    ) : !isAuthenticated ? (
                      <Link to={loginHref} className="btn btn--outline btn--sm">
                        Entre para avaliar
                      </Link>
                    ) : null}
                  </div>
                  {reviewsError && !reviewsLoading ? (
                    <div className="notice notice--error" role="alert">
                      {reviewsError}
                      <div className="row" style={{ marginTop: 8 }}>
                        <button className="btn btn--sm" onClick={handleReviewsRetry}>
                          Tentar novamente
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {reviewsLoading && reviewsItems.length === 0 ? (
                    <ul className="estab-reviews__list estab-reviews__list--loading">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <li key={`review-skeleton-${index}`} className="estab-reviews__item">
                          <div className="estab-reviews__header">
                            <div className="estab-reviews__avatar shimmer" />
                            <div className="estab-reviews__meta">
                              <div className="shimmer" style={{ height: 12, width: '60%' }} />
                              <div className="shimmer" style={{ height: 10, width: '40%', marginTop: 4 }} />
                            </div>
                            <div className="estab-reviews__stars">
                              {Array.from({ length: 5 }).map((__, star) => (
                                <span key={`skeleton-star-${star}`} className="estab-reviews__star shimmer" />
                              ))}
                            </div>
                          </div>
                          <div className="shimmer" style={{ height: 12, width: '90%', marginTop: 8 }} />
                          <div className="shimmer" style={{ height: 12, width: '70%', marginTop: 6 }} />
                        </li>
                      ))}
                    </ul>
                  ) : reviewsItems.length === 0 ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      {ratingCount > 0
                        ? 'Ainda sem comentários. Quando clientes deixarem relatos, eles aparecerão aqui.'
                        : 'Seja o primeiro a avaliar este estabelecimento.'}
                    </p>
                  ) : (
                    <ul className="estab-reviews__list">
                      {reviewsItems.map((review) => {
                        const nota = Number(review.nota) || 0;
                        const reviewDateIso = review.updated_at || review.created_at;
                        const dateObj = reviewDateIso ? new Date(reviewDateIso) : null;
                        const reviewDate = dateObj && !Number.isNaN(dateObj.getTime())
                          ? reviewDateFormatter.format(dateObj)
                          : '';
                        const avatar = review?.author?.avatar_url ? resolveAssetUrl(review.author.avatar_url) : '';
                        const initials = review?.author?.initials || 'CL';
                        return (
                          <li key={review.id} className="estab-reviews__item">
                            <div className="estab-reviews__header">
                              <div className="estab-reviews__avatar">
                                {avatar ? (
                                  <img src={avatar} alt={`Foto de ${review.author?.name || 'cliente'}`} />
                                ) : (
                                  <span>{initials}</span>
                                )}
                              </div>
                              <div className="estab-reviews__meta">
                                <strong>{review.author?.name || 'Cliente'}</strong>
                                {reviewDate ? <span className="muted">{reviewDate}</span> : null}
                              </div>
                              <div className="estab-reviews__stars" aria-label={`Nota ${nota} de 5`}>
                                {[1, 2, 3, 4, 5].map((value) => (
                                  <span
                                    key={`review-${review.id}-star-${value}`}
                                    className={`estab-reviews__star${nota >= value ? ' is-active' : ''}`}
                                  >
                                    {nota >= value ? '★' : '☆'}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {review.comentario ? (
                              <p className="estab-reviews__comment">{review.comentario}</p>
                            ) : (
                              <p className="estab-reviews__comment estab-reviews__comment--muted">
                                Avaliação sem comentário.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {reviewsLoading && reviewsItems.length > 0 && (
                    <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                      <span className="spinner" aria-label="Carregando avaliações" />
                    </div>
                  )}
                  {!reviewsLoading && reviewsHasNext && reviewsItems.length > 0 && (
                    <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                      <button className="btn btn--outline btn--sm" onClick={handleReviewsLoadMore}>
                        Carregar mais
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {galleryModalOpen && (
        <Modal
          title={`Fotos de ${selectedEstablishmentName || 'Estabelecimento'}`}
          onClose={handleCloseGalleryModal}
          closeButton
          bodyClassName="modal__body--scroll"
        >
          {galleryImages.length ? (
            <div className="gallery-viewer" style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  paddingBottom: '60%',
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#f6f6f6',
                }}
              >
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleGalleryPrev}
                  disabled={galleryImages.length < 2}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: 8,
                    transform: 'translateY(-50%)',
                    zIndex: 2,
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleGalleryNext}
                  disabled={galleryImages.length < 2}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: 8,
                    transform: 'translateY(-50%)',
                    zIndex: 2,
                  }}
                >
                  ›
                </button>
                {(() => {
                  const currentImage = galleryImages[galleryViewIndex] || galleryImages[0];
                  const src = resolveAssetUrl(currentImage?.url || '');
                  if (!src) {
                    return (
                      <span
                        className="muted"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        Imagem indisponível
                      </span>
                    );
                  }
                  return (
                    <img
                      src={src}
                      alt={currentImage?.titulo || `Imagem de ${selectedEstablishmentName || 'estabelecimento'}`}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  );
                })()}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <strong>{galleryImages[galleryViewIndex]?.titulo || 'Imagem'}</strong>
                  {galleryImages.length > 1 && (
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {galleryViewIndex + 1} de {galleryImages.length}
                    </span>
                  )}
                </div>
              </div>
              {galleryImages.length > 1 && (
                <div
                  className="gallery-thumbs"
                  style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}
                >
                  {galleryImages.map((image, index) => {
                    const key = image?.id || `${image?.url || 'thumb'}-${index}`;
                    const src = resolveAssetUrl(image?.url || '');
                    const isActive = index === galleryViewIndex;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setGalleryViewIndex(index)}
                        className="gallery-thumb"
                        style={{
                          border: isActive ? '2px solid var(--brand, #6c2bd9)' : '1px solid #e0e0e0',
                          borderRadius: 8,
                          padding: 0,
                          width: 80,
                          height: 60,
                          overflow: 'hidden',
                          background: '#f6f6f6',
                          flex: '0 0 auto',
                        }}
                      >
                        {src ? (
                          <img
                            src={src}
                            alt={image?.titulo || `Miniatura ${index + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span className="muted" style={{ fontSize: 10 }}>
                            Indisponível
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="muted">Nenhuma imagem cadastrada ainda.</p>
          )}
        </Modal>
      )}
      {ratingModal.open && (
        <Modal
          title="Avaliar estabelecimento"
          onClose={ratingModal.saving ? undefined : handleCloseRatingModal}
          closeButton
          actions={[
            <button
              key="cancel"
              type="button"
              className="btn btn--outline"
              onClick={handleCloseRatingModal}
              disabled={ratingModal.saving}
            >
              Cancelar
            </button>,
            selectedExtras?.user_review ? (
              <button
                key="remove"
                type="button"
                className="btn btn--outline"
                onClick={handleDeleteRating}
                disabled={ratingModal.saving}
              >
                Remover avaliação
              </button>
            ) : null,
            <button
              key="save"
              type="button"
              className="btn btn--primary"
              onClick={handleSaveRating}
              disabled={ratingModal.saving || ratingModal.nota < 1}
            >
              {ratingModal.saving ? <span className="spinner" /> : 'Salvar'}
            </button>,
          ].filter(Boolean)}
        >
          <div className="rating-modal">
            <div className="rating-modal__stars">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rating-star${ratingModal.nota >= value ? ' rating-star--active' : ''}`}
                  onClick={() => handleRatingStar(value)}
                  disabled={ratingModal.saving}
                  aria-label={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`}
                >
                  {ratingModal.nota >= value ? '★' : '☆'}
                </button>
              ))}
            </div>
            <textarea
              className="input rating-modal__comment"
              placeholder="Conte sua experiência (opcional)"
              value={ratingModal.comentario}
              onChange={handleRatingCommentChange}
              rows={4}
              maxLength={600}
              disabled={ratingModal.saving}
            />
            <div className="rating-modal__hint muted">
              {`${ratingModal.comentario.length}/600 caracteres`}
            </div>
            {ratingModal.error && (
              <div className="notice notice--error" role="alert">
                {ratingModal.error}
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal.isOpen && selectedSlot && selectedService && (
        <Modal onClose={() => setModal((m) => ({ ...m, isOpen: false }))} closeButton>
          <h3>Confirmar agendamento?</h3>
          <div className="confirmation-details">
            <div className="confirmation-details__item"><span className="confirmation-details__label">Estabelecimento: </span><span className="confirmation-details__value">{selectedEstablishmentName}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Serviço: </span><span className="confirmation-details__value">{ServiceHelpers.title(selectedService)}</span></div>
            {selectedProfessional && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Profissional: </span><span className="confirmation-details__value">{selectedProfessional?.nome || selectedProfessional?.name}</span></div>
            )}
            {serviceDuration > 0 && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Duração: </span><span className="confirmation-details__value">{serviceDuration} minutos</span></div>
            )}
            {servicePrice !== 'R$ 0,00' && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Preço: </span><span className="confirmation-details__value">{servicePrice}</span></div>
            )}
            <div className="confirmation-details__item"><span className="confirmation-details__label">Data: </span><span className="confirmation-details__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Horário: </span><span className="confirmation-details__value">
              {DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` • ${endTimeLabel}` : ''}
            </span></div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button className="btn btn--outline" onClick={() => setModal((m) => ({ ...m, isOpen: false }))} disabled={modal.isSaving}>Cancelar</button>
            <button className="btn btn--primary" onClick={confirmBooking} disabled={modal.isSaving}>
              {modal.isSaving ? <span className="spinner" /> : 'Confirmar Agendamento'}
            </button>
          </div>
        </Modal>
      )}
      <div className="sr-only" aria-live="polite" ref={liveRef} />
    </div>
  );
}



