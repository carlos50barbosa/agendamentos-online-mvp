// src/pages/NovoAgendamento.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Api, API_BASE_URL } from "../utils/api";
import { getUser } from "../utils/auth";

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

/* =================== Janela 07•22 =================== */
const BUSINESS_HOURS = { start: 7, end: 22 };
const inBusinessHours = (isoDatetime) => {
  const d = new Date(isoDatetime);
  const h = d.getHours();
  const m = d.getMinutes();
  const afterStart = h > BUSINESS_HOURS.start || (h === BUSINESS_HOURS.start && m >= 0);
  const beforeEnd = h < BUSINESS_HOURS.end || (h === BUSINESS_HOURS.end && m === 0);
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

function fillBusinessGrid({ currentWeek, slots, stepMinutes = 30 }) {
  const { days } = (function getDays(iso) {
    const ds = DateHelpers.weekDays(iso);
    return { days: ds };
  })(currentWeek);

  const byKey = new Map();
  (slots || []).forEach((s) => byKey.set(localKey(s.datetime), s));

  const filled = [];
  for (const { date } of days) {
    const start = new Date(date);
    start.setHours(BUSINESS_HOURS.start, 0, 0, 0);
    const end = new Date(date);
    end.setHours(BUSINESS_HOURS.end, 0, 0, 0);

    for (let t = start.getTime(); t <= end.getTime(); t += stepMinutes * 60_000) {
      const k = localKey(t);
      const existing = byKey.get(k);
      filled.push(
        existing || { datetime: new Date(t).toISOString(), label: "disponível", status: "available" }
      );
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

const resolveAssetUrl = (value) => {
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, API_BASE_URL).toString();
  } catch {
    return value;
  }
};

const STORAGE_KEY = 'ao:lastLocation';

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const geocodeEstablishment = async (est) => {
  const lat = Number(est?.latitude ?? est?.lat ?? null);
  const lng = Number(est?.longitude ?? est?.lng ?? null);
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
const Modal = ({ children, onClose }) => (
  <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      {children}
    </div>
  </div>
);

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


const EstablishmentCard = ({ est, selected, onSelect, distance, userLocation, formatter }) => {
  const name = est?.nome || est?.name || est?.fantasia || est?.razao_social || `Estabelecimento #${est?.id || ''}`;
  const address = formatAddress(est);
  const avatarSource = est?.foto_url || est?.avatar_url || '';
  const distanceLabel = userLocation
    ? Number.isFinite(distance)
      ? `${formatter.format(distance)} km`
      : 'Distancia indisponivel'
    : 'Ative a localizacao para ver a distancia';

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
        <span className="establishment-card__distance">{distanceLabel}</span>
      </div>
    </div>
  );
};

/* =================== PÃ¡gina Principal =================== */
export default function NovoAgendamento() {
  const user = getUser();
  const liveRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const nav = useNavigate();

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

  const establishmentAvatar = useMemo(() => {
    const source = selectedEstablishment?.avatar_url || selectedEstablishment?.logo_url || selectedEstablishment?.foto_url;
    if (!source) return '';
    try {
      return new URL(source, API_BASE_URL).toString();
    } catch {
      return source;
    }
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

  useEffect(() => {
    const cache = coordsCacheRef.current;
    let changed = false;
    establishments.forEach((est) => {
      const lat = Number(est?.latitude ?? est?.lat ?? null);
      const lng = Number(est?.longitude ?? est?.lng ?? null);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !cache.has(est.id)) {
        cache.set(est.id, { lat, lng });
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
      if (coords) next[id] = haversineDistance(userLocation, coords);
    });
    setDistanceMap(next);
  }, [userLocation]);

  useEffect(() => {
    if (!userLocation) {
      setGeocoding(false);
      return;
    }
    const pending = filteredEstablishments.filter((est) => !coordsCacheRef.current.has(est.id));
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
            [est.id]: haversineDistance(userLocation, coords),
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
      distance: distanceMap[est.id],
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
      const grid = fillBusinessGrid({ currentWeek, slots: normalized, stepMinutes });

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
          (s) => isAvailableLabel(s.label) && !DateHelpers.isPastSlot(s.datetime) && inBusinessHours(s.datetime)
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
  }, [establishmentId, serviceId, currentWeek, normalizeSlots, stepMinutes, getBusyFromAppointments, selectedService, state.professionalId]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

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
      if (!inBusinessHours(slot.datetime)) return false;
      if (filters.onlyAvailable && !isAvailableLabel(slot.label)) return false;
      if (filters.hidePast && DateHelpers.isPastSlot(slot.datetime)) return false;
      if (!timeRangeCheck(slot.datetime)) return false;
      return true;
    },
    [filters, timeRangeCheck]
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

    if (DateHelpers.isPastSlot(selectedSlot.datetime)) {
      showToast("error", "Não foi possível agendar no passado.");
      return;
    }
    if (!inBusinessHours(selectedSlot.datetime)) {
      showToast("error", "Este horário está fora do perí­odo de 07:00•22:00.");
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
    scheduleWhatsAppReminders,
    loadSlots,
    showToast,
    verifyBookingCreated,
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

  const handleFilterToggle = (filter) =>
    setState((p) => ({ ...p, filters: { ...p.filters, [filter]: !p.filters[filter] } }));

  const handleTimeRange = (value) =>
    setState((p) => ({ ...p, filters: { ...p.filters, timeRange: value } }));

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
      {userLocation && !geoError && (
        <div className="novo-agendamento__status muted" aria-live="polite">
          Resultados ordenados pela sua localização atual.
        </div>
      )}
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
        {establishmentResults.map(({ est, distance }) => (
          <EstablishmentCard
            key={est.id}
            est={est}
            selected={String(est.id) === establishmentId}
            onSelect={handleEstablishmentClick}
            distance={distance}
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

  const renderScheduleContent = () => (
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
            <div style={{ position: 'relative', maxWidth: 240 }}>
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
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="muted"><b>Estabelecimento:</b> {selectedEstablishmentName}</span>
            <span className="muted">•</span>
            <span className="muted">
              <b>Serviço:</b> {ServiceHelpers.title(selectedService)}
              {serviceDuration ? ` • ${serviceDuration} min` : ''}
              {servicePrice !== 'R$ 0,00' ? ` • ${servicePrice}` : ''}
            </span>
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
                const isToday = DateHelpers.sameYMD(iso, DateHelpers.toISODate(new Date()));
                const isSelected = selectedDate && DateHelpers.sameYMD(selectedDate, iso);
                return (
                  <button
                    key={iso}
                    className={`month__day${inMonth ? '' : ' is-dim'}${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
                    onClick={() => handlePickDay(iso)}
                    title={date.toLocaleDateString('pt-BR')}
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
                    <div className="empty">Sem horários para este dia.</div>
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

          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))} disabled={!selectedSlot}>
              Limpar seleção
            </button>
            <button
              className="btn btn--primary"
              onClick={() => setModal((m) => ({ ...m, isOpen: true }))}
              disabled={
                !selectedSlot || !serviceId || modal.isSaving ||
                (serviceProfessionals.length && !state.professionalId) ||
                (selectedSlotNow && !isAvailableLabel(selectedSlotNow.label)) ||
                DateHelpers.isPastSlot(selectedSlot.datetime) ||
                !inBusinessHours(selectedSlot.datetime)
              }
            >
              {modal.isSaving ? <span className="spinner" /> : 'Confirmar agendamento'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

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
                  <span className="summary-action summary-action--muted">☆ Sem avaliações</span>
                  <span className="summary-action">🛈 Informações</span>
                  <span className="summary-action">♡ Favoritar</span>
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

      {modal.isOpen && selectedSlot && selectedService && (
        <Modal onClose={() => setModal((m) => ({ ...m, isOpen: false }))}>
          <h3>Confirmar agendamento?</h3>
          <div className="confirmation-details">
            <div className="confirmation-details__item"><span className="confirmation-details__label">Estabelecimento:</span><span className="confirmation-details__value">{selectedEstablishmentName}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Serviço:</span><span className="confirmation-details__value">{ServiceHelpers.title(selectedService)}</span></div>
            {selectedProfessional && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Profissional:</span><span className="confirmation-details__value">{selectedProfessional?.nome || selectedProfessional?.name}</span></div>
            )}
            {serviceDuration > 0 && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Duração:</span><span className="confirmation-details__value">{serviceDuration} minutos</span></div>
            )}
            {servicePrice !== 'R$ 0,00' && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Preço:</span><span className="confirmation-details__value">{servicePrice}</span></div>
            )}
            <div className="confirmation-details__item"><span className="confirmation-details__label">Data:</span><span className="confirmation-details__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Horário:</span><span className="confirmation-details__value">
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

