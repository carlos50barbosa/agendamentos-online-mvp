// src/pages/NovoAgendamento.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Api } from "../utils/api";
import { getUser } from "../utils/auth";

/* =================== Helpers de Data =================== */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

const DateHelpers = {
  weekStartISO: (d = new Date()) => {
    const date = new Date(d);
    const day = date.getDay(); // 0=Dom
    const diff = (day + 6) % 7; // 1=Seg
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  },
  toISODate: (d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10);
  },
  addDays: (d, n) => {
    const date = new Date(d);
    date.setDate(date.getDate() + n);
    return date;
  },
  addMinutes: (d, n) => {
    const date = new Date(d);
    date.setMinutes(date.getMinutes() + n);
    return date;
  },
  addWeeksISO: (iso, n) => DateHelpers.toISODate(DateHelpers.addDays(new Date(iso), n * 7)),
  sameYMD: (a, b) => a.slice(0, 10) === b.slice(0, 10),
  weekDays: (isoMonday) => {
    const base = new Date(isoMonday);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = DateHelpers.addDays(base, i);
      return { iso: DateHelpers.toISODate(d), date: d };
    });
  },
  formatWeekLabel: (isoMonday) => {
    const days = DateHelpers.weekDays(isoMonday);
    const start = days[0].date;
    const end = days[6].date;
    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
    const s1 = fmt.format(start);
    const s2 = fmt.format(end);
    return `${s1} – ${s2}`.replace(/\./g, "");
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
  const start = new Date(isoMonday); start.setHours(0,0,0,0);
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
  formatPrice: (centavos) =>
    (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
};

/* =================== Janela 07–22 =================== */
const BUSINESS_HOURS = { start: 7, end: 22 };
const inBusinessHours = (isoDatetime) => {
  const d = new Date(isoDatetime);
  const h = d.getHours();
  const m = d.getMinutes();
  const afterStart = h > BUSINESS_HOURS.start || (h === BUSINESS_HOURS.start && m >= 0);
  const beforeEnd = h < BUSINESS_HOURS.end || (h === BUSINESS_HOURS.end && m === 0);
  return afterStart && beforeEnd;
};

/* =================== Grade 07–22 =================== */
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
      <span className="toast-icon">{type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}</span>
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

const DensityToggle = ({ value, onChange }) => (
  <div className="segmented" role="tablist" aria-label="Densidade">
    {[
      { value: "compact", label: "Compacto" },
      { value: "comfortable", label: "Confortável" },
    ].map((opt) => (
      <button
        key={opt.value}
        role="tab"
        aria-selected={value === opt.value}
        className={`segmented__btn ${value === opt.value ? "is-active" : ""}`}
        onClick={() => onChange(opt.value)}
        title={opt.label}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const SlotButton = ({ slot, isSelected, onClick, density = "compact" }) => {
  const isPast = DateHelpers.isPastSlot(slot.datetime);
  const label = String(slot.label || "disponível").toLowerCase().trim();

  const statusClass = label === "agendado" ? "busy" : label === "bloqueado" ? "block" : "ok";
  const disabledReason = isPast || label !== "disponível";

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
      title={`${new Date(slot.datetime).toLocaleString("pt-BR")} — ${label}${isPast ? " (passado)" : ""}`}
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
  return (
    <div className={`mini-card ${selected ? "mini-card--selected" : ""}`} onClick={() => onSelect(service)}>
      <div className="mini-card__title">{ServiceHelpers.title(service)}</div>
      <div className="mini-card__meta">
        {duration > 0 && <span>{duration} min</span>}
        {price !== "R$\u00A00,00" && <span>{price}</span>}
      </div>
    </div>
  );
};

const EstablishmentCard = ({ est, selected, onSelect }) => (
  <div className={`mini-card ${selected ? "mini-card--selected" : ""}`} onClick={() => onSelect(est)}>
    <div className="mini-card__title">{est.name}</div>
    {est.email && <div className="mini-card__meta"><span>{est.email}</span></div>}
  </div>
);

/* =================== Página Principal =================== */
export default function NovoAgendamento() {
  const user = getUser();
  const liveRef = useRef(null);

  const [state, setState] = useState({
    establishments: [],
    services: [],
    establishmentId: user?.tipo === "estabelecimento" ? String(user.id) : "",
    serviceId: "",
    currentWeek: DateHelpers.weekStartISO(),
    slots: [],
    loading: false,
    error: "",
    selectedSlot: null,
    filters: { onlyAvailable: false, hidePast: true, timeRange: "all" }, // all|morning|afternoon|evening
    density: "compact",
    forceBusy: [], // overlay para casos que o backend não devolve ainda
  });

  const [modal, setModal] = useState({ isOpen: false, isSaving: false });
  const [toast, setToast] = useState(null);

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

  // Passo da grade
  const stepMinutes = useMemo(() => {
    const d = ServiceHelpers.duration(selectedService);
    if (d && d % 5 === 0) return Math.max(15, Math.min(120, d));
    return 30;
  }, [selectedService]);

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
      localStorage.setItem("novo-agendamento-ui", JSON.stringify({ filters, density }));
    } catch {}
  }, [filters, density]);

  // Toast helper
  const showToast = useCallback((type, message, duration = 4500) => {
    setToast({ type, message });
    const t = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(t);
  }, []);

  /* ====== Carregar Estabelecimentos ====== */
  useEffect(() => {
    (async () => {
      try {
        const list = await Api.listEstablishments();
        setState((prev) => ({
          ...prev,
          establishments: list || [],
        }));
      } catch {
        showToast("error", "Não foi possível carregar estabelecimentos.");
      }
    })();
  }, [showToast]);

  /* ====== Carregar Serviços quando escolher Estabelecimento ====== */
  useEffect(() => {
    (async () => {
      if (!establishmentId) {
        setState((p) => ({ ...p, services: [], serviceId: "", slots: [], selectedSlot: null }));
        return;
      }
      try {
        const list = await Api.listServices(establishmentId);
        setState((p) => ({
          ...p,
          services: list || [],
          serviceId: "", // aguarda o clique do usuário
          slots: [],
          selectedSlot: null,
        }));
      } catch {
        setState((p) => ({ ...p, services: [], serviceId: "", slots: [], selectedSlot: null }));
        showToast("error", "Não foi possível carregar os serviços.");
      }
    })();
  }, [establishmentId, showToast]);

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
      if (["agendado", "bloqueado", "disponível"].includes(String(slot.label).toLowerCase())) {
        label = String(slot.label).toLowerCase();
      }
      return { ...slot, datetime, label };
    });
  }, []);

  /* ====== Hidratar ocupados por agendamentos (somente ativos) ====== */
  const getBusyFromAppointments = useCallback(async () => {
    const keys = new Set();
    const { start, end } = weekRangeMs(currentWeek);

    // meus agendamentos
    try {
      if (typeof Api.meusAgendamentos === "function") {
        const mine = await Api.meusAgendamentos();
        (mine || []).forEach((a) => {
          if (!isActiveStatus(a.status)) return;
          const t = +new Date(a.inicio);
          if (t >= start && t < end) keys.add(minuteISO(a.inicio));
        });
      }
    } catch {}

    // agendamentos do estabelecimento
    try {
      if (typeof Api.agendamentosEstabelecimento === "function") {
        const est = await Api.agendamentosEstabelecimento();
        (est || []).forEach((a) => {
          if (!isActiveStatus(a.status)) return;
          const t = +new Date(a.inicio);
          if (t >= start && t < end) keys.add(minuteISO(a.inicio));
        });
      }
    } catch {}

    return Array.from(keys);
  }, [currentWeek]);

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

      // C) conjuntos de ocupados por fonte
      const busyFromApi = new Set(
        normalized.filter((s) => s.label !== "disponível").map((s) => minuteISO(s.datetime))
      );

      let persisted = [];
      try {
        persisted = JSON.parse(localStorage.getItem(fbKey(establishmentId, currentWeek)) || "[]");
        if (!Array.isArray(persisted)) persisted = [];
      } catch {}

      const fromAppts = await getBusyFromAppointments();
      const apptSet = new Set(fromAppts);

      // D) aplica overlay e limpa o que já está ocupado no backend ou tem agendamento ativo
      setState((prev) => {
        const prevForced = Array.from(new Set([...prev.forceBusy, ...persisted]));
        const busyKnownSet = new Set([...busyFromApi, ...apptSet, ...prevForced]);

        const overlayed = grid.map((s) =>
          busyKnownSet.has(minuteISO(s.datetime)) ? { ...s, label: "agendado" } : s
        );

        // mantém no overlay apenas o que AINDA é reconhecido como ocupado por API ou agendamento ativo
        const cleaned = prevForced.filter((k) => busyFromApi.has(k) || apptSet.has(k));
        try { localStorage.setItem(fbKey(establishmentId, currentWeek), JSON.stringify(cleaned)); } catch {}

        const firstAvailable = overlayed.find(
          (s) => s.label === "disponível" && !DateHelpers.isPastSlot(s.datetime) && inBusinessHours(s.datetime)
        );

        return {
          ...prev,
          slots: overlayed,
          selectedSlot: firstAvailable || prev.selectedSlot || null,
          loading: false,
          forceBusy: cleaned,
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
  }, [establishmentId, serviceId, currentWeek, normalizeSlots, stepMinutes, getBusyFromAppointments]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

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
      if (filters.onlyAvailable && slot.label !== "disponível") return false;
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
      const t1 = new Date(inMs - 24 * 60 * 60 * 1000);
      const t2 = new Date(inMs - 15 * 60 * 1000);
      const dataBR = start.toLocaleDateString("pt-BR");
      const horaBR = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const msg1 = `🔔 Lembrete: amanhã às ${horaBR} você tem ${servicoNome} em ${estabelecimentoNome}.`;
      const msg2 = `⏰ Faltam 15 minutos para o seu ${servicoNome} em ${estabelecimentoNome} (${horaBR} de ${dataBR}).`;
      const tasks = [];
      if (t1.getTime() > now)
        tasks.push(Api.scheduleWhatsApp?.({ to: toPhone, scheduledAt: t1.toISOString(), message: msg1, metadata: { kind: "reminder_1d", appointmentAt: start.toISOString() } }));
      if (t2.getTime() > now)
        tasks.push(Api.scheduleWhatsApp?.({ to: toPhone, scheduledAt: t2.toISOString(), message: msg2, metadata: { kind: "reminder_15m", appointmentAt: start.toISOString() } }));
      if (!tasks.length) {
        showToast("info", "Agendado! Sem lembretes porque o horário está muito próximo.");
        return;
      }
      const results = await Promise.allSettled(tasks);
      const failed = results.some((r) => r.status === "rejected");
      showToast(failed ? "error" : "success", failed ? "Agendado! Falha ao programar alguns lembretes." : "Agendado com sucesso! Lembretes programados.");
    },
    [showToast, user]
  );

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
        slotIndisponivel = !!(found && found.label !== "disponível");
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
      showToast("error", "Não é possível agendar no passado.");
      return;
    }
    if (!inBusinessHours(selectedSlot.datetime)) {
      showToast("error", "Este horário está fora do período de 07:00–22:00.");
      return;
    }

    setModal((p) => ({ ...p, isSaving: true }));
    let success = false;

    try {
      await Api.agendar({
        estabelecimento_id: Number(establishmentId),
        servico_id: Number(serviceId),
        inicio: selectedSlot.datetime,
      });

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
          showToast("error", "Este horário acabou de ficar indisponível. Escolha outro.");
        }
      } else if (Number(code) === 500) {
        // Se criou (meu) OU o slot ficou indisponível por qualquer fonte, tratamos como sucesso.
        if (slotIndisponivel || meu) {
          success = true;
          setModal((p) => ({ ...p, isOpen: false }));
          showToast("success", "Agendado com sucesso! (o servidor retornou 500)");

          // Se o /slots ainda NÃO marcou ocupado, força overlay vermelho neste minuto
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
      // Sempre recarrega para refletir indisponíveis
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
  const handleEstablishmentClick = (est) =>
    setState((p) => ({ ...p, establishmentId: String(est.id), serviceId: "", slots: [], selectedSlot: null }));

  const handleServiceClick = (svc) =>
    setState((p) => ({ ...p, serviceId: String(svc.id), slots: [], selectedSlot: null }));

  const handleWeekChange = (newWeek) =>
    setState((p) => ({ ...p, currentWeek: newWeek, selectedSlot: null }));

  const handleSlotSelect = (slot) =>
    setState((p) => ({ ...p, selectedSlot: slot }));

  const handleFilterToggle = (filter) =>
    setState((p) => ({ ...p, filters: { ...p.filters, [filter]: !p.filters[filter] } }));

  const handleTimeRange = (value) =>
    setState((p) => ({ ...p, filters: { ...p.filters, timeRange: value } }));

  const serviceDuration = ServiceHelpers.duration(selectedService);
  const servicePrice = ServiceHelpers.formatPrice(ServiceHelpers.price(selectedService));
  const endTimeLabel = useMemo(() => {
    if (!selectedSlot || !serviceDuration) return null;
    const end = DateHelpers.addMinutes(new Date(selectedSlot.datetime), serviceDuration);
    return DateHelpers.formatTime(end.toISOString());
  }, [selectedSlot, serviceDuration]);

  const weekLabel = DateHelpers.formatWeekLabel(currentWeek);

  /* ====== UI por passos ====== */
  const isOwner = user?.tipo === "estabelecimento";
  const step = !establishmentId && !isOwner ? 1 : !serviceId ? 2 : 3;

  return (
    <div className="grid" style={{ gap: 12 }}>
      {toast && <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />}

      <div className="card">
        {/* Header fino */}
        <div className="row spread" style={{ marginBottom: 8, alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Novo Agendamento</h2>
            <small className="muted">
              Semana: {weekLabel} • Fuso: {TZ} • Janela: 07:00–22:00
            </small>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <DensityToggle value={density} onChange={(v) => setState((p) => ({ ...p, density: v }))} />
          </div>
        </div>

        {/* Passo 1 — Estabelecimento */}
        {step === 1 && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Escolha um estabelecimento:</p>
            <div className="row-wrap">
              {establishments.map((est) => (
                <EstablishmentCard
                  key={est.id}
                  est={est}
                  selected={String(est.id) === establishmentId}
                  onSelect={handleEstablishmentClick}
                />
              ))}
            </div>
          </>
        )}

        {/* Passo 2 — Serviço */}
        {step === 2 && (
          <>
            <div className="row spread" style={{ alignItems: "center" }}>
              <div className="muted">
                <b>Estabelecimento:</b> {selectedEstablishment?.name || "—"}
              </div>
              <button
                className="btn btn--outline btn--sm"
                onClick={() => setState((p) => ({ ...p, establishmentId: "", services: [], serviceId: "", slots: [], selectedSlot: null }))}
              >
                Trocar
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>Escolha um serviço:</p>
            <div className="row-wrap">
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
        )}

        {/* Passo 3 — Horários */}
        {step === 3 && (
          <>
            <div className="row spread" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="muted"><b>Estabelecimento:</b> {selectedEstablishment?.name}</span>
                <span className="muted">•</span>
                <span className="muted">
                  <b>Serviço:</b> {ServiceHelpers.title(selectedService)}
                  {serviceDuration ? ` • ${serviceDuration} min` : ""}
                  {servicePrice !== "R$\u00A00,00" ? ` • ${servicePrice}` : ""}
                </span>
              </div>

              <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                <label className="label">
                  <span>Início da semana</span>
                  <input
                    type="date"
                    value={currentWeek}
                    onChange={(e) => handleWeekChange(DateHelpers.toISODate(e.target.value))}
                    className="input"
                    title="Segunda-feira da semana"
                  />
                </label>

                <div className="row" style={{ alignItems: "center", gap: 10 }}>
                  <label className="switch">
                    <input type="checkbox" checked={filters.onlyAvailable} onChange={() => handleFilterToggle("onlyAvailable")} />
                    <span>Somente disponíveis</span>
                  </label>
                  <label className="switch">
                    <input type="checkbox" checked={filters.hidePast} onChange={() => handleFilterToggle("hidePast")} />
                    <span>Ocultar passados</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Filtro período */}
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="Período do dia">
              <Chip active={filters.timeRange === "all"} onClick={() => handleTimeRange("all")} title="Todos os horários">Todos</Chip>
              <Chip active={filters.timeRange === "morning"} onClick={() => handleTimeRange("morning")} title="Manhã (07–12)">Manhã</Chip>
              <Chip active={filters.timeRange === "afternoon"} onClick={() => handleTimeRange("afternoon")} title="Tarde (12–18)">Tarde</Chip>
              <Chip active={filters.timeRange === "evening"} onClick={() => handleTimeRange("evening")} title="Noite (18–22)">Noite</Chip>
            </div>

            {/* Erro de carga */}
            {error && (
              <div className="box error" style={{ marginTop: 8 }}>
                {error}
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn btn--sm" onClick={loadSlots}>Tentar novamente</button>
                </div>
              </div>
            )}

            {/* Sumário selecionado */}
            {selectedSlot && (
              <div className="box box--highlight sticky-bar" aria-live="polite" id="resumo-agendamento">
                <div className="appointment-summary">
                  <div className="appointment-summary__item">
                    <span className="appointment-summary__label">Data:</span>
                    <span className="appointment-summary__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span>
                  </div>
                  <div className="appointment-summary__item">
                    <span className="appointment-summary__label">Horário:</span>
                    <span className="appointment-summary__value">
                      {DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` – ${endTimeLabel}` : ""}
                    </span>
                  </div>
                </div>
                <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
                  <button className="btn btn--outline" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))}>Limpar</button>
                  <button
                    className="btn btn--primary"
                    onClick={() => setModal((m) => ({ ...m, isOpen: true }))}
                    aria-describedby="resumo-agendamento"
                    disabled={
                      !selectedSlot || !serviceId || modal.isSaving ||
                      selectedSlotNow?.label !== "disponível" ||
                      DateHelpers.isPastSlot(selectedSlot.datetime) ||
                      !inBusinessHours(selectedSlot.datetime)
                    }
                    title="Confirmar agendamento"
                  >
                    {modal.isSaving ? <span className="spinner" /> : "Confirmar"}
                  </button>
                </div>
              </div>
            )}

            {/* Calendário — Colunas com cabeçalho dentro (evita desalinhamento) */}
            <div className={`calendar ${density === "compact" ? "calendar--compact" : ""}`}>
              {/* Desktop: grid 7 colunas | Mobile: carrossel horizontal com snap */}
              <div className="calendar__inner">
                {DateHelpers.weekDays(currentWeek).map(({ iso, date }) => {
                  const isToday = DateHelpers.sameYMD(iso, DateHelpers.toISODate(new Date()));
                  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
                    weekday: "short", day: "2-digit", month: "2-digit",
                  }).format(date).replace(/\.$/, "");
                  const daySlots = (groupedSlots.grouped[iso] || []).filter(isSlotVisible);

                  return (
                    <section key={iso} className="day-col" aria-label={dayLabel}>
                      <header className={`day-col__header ${isToday ? "is-today" : ""}`}>
                        <div className="day-col__title">{dayLabel}</div>
                      </header>

                      <div className={`day-col__slots ${density === "compact" ? "slots--grid" : "slots--list"}`}>
                        {loading ? (
                          Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer pill" />)
                        ) : daySlots.length === 0 ? (
                          <div className="empty-dot" title="Sem horários" />
                        ) : (
                          daySlots.map((slot) => (
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
                    </section>
                  );
                })}
              </div>
            </div>

            {/* Rodapé ações */}
            <div className="row" style={{ marginTop: 8, justifyContent: "flex-end", gap: 6 }}>
              <button className="btn" onClick={() => setState((p) => ({ ...p, selectedSlot: null }))} disabled={!selectedSlot}>
                Limpar seleção
              </button>
              <button
                className="btn btn--primary"
                onClick={() => setModal((m) => ({ ...m, isOpen: true }))}
                disabled={
                  !selectedSlot || !serviceId || modal.isSaving ||
                  selectedSlotNow?.label !== "disponível" ||
                  DateHelpers.isPastSlot(selectedSlot.datetime) ||
                  !inBusinessHours(selectedSlot.datetime)
                }
              >
                {modal.isSaving ? <span className="spinner" /> : "Confirmar agendamento"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal de confirmação */}
      {modal.isOpen && selectedSlot && selectedService && (
        <Modal onClose={() => setModal((m) => ({ ...m, isOpen: false }))}>
          <h3>Confirmar agendamento?</h3>
          <div className="confirmation-details">
            <div className="confirmation-details__item"><span className="confirmation-details__label">Estabelecimento:</span><span className="confirmation-details__value">{selectedEstablishment?.name}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Serviço:</span><span className="confirmation-details__value">{ServiceHelpers.title(selectedService)}</span></div>
            {serviceDuration > 0 && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Duração:</span><span className="confirmation-details__value">{serviceDuration} minutos</span></div>
            )}
            {servicePrice !== "R$\u00A00,00" && (
              <div className="confirmation-details__item"><span className="confirmation-details__label">Preço:</span><span className="confirmation-details__value">{servicePrice}</span></div>
            )}
            <div className="confirmation-details__item"><span className="confirmation-details__label">Data:</span><span className="confirmation-details__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span></div>
            <div className="confirmation-details__item"><span className="confirmation-details__label">Horário:</span><span className="confirmation-details__value">
              {DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` – ${endTimeLabel}` : ""}
            </span></div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
            <button className="btn btn--outline" onClick={() => setModal((m) => ({ ...m, isOpen: false }))} disabled={modal.isSaving}>Cancelar</button>
            <button className="btn btn--primary" onClick={confirmBooking} disabled={modal.isSaving}>
              {modal.isSaving ? <span className="spinner" /> : "Confirmar Agendamento"}
            </button>
          </div>
        </Modal>
      )}

      <div className="sr-only" aria-live="polite" ref={liveRef} />
    </div>
  );
}
