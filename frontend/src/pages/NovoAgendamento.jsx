// src/pages/NovoAgendamento.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Api } from "../utils/api";
import { getUser } from "../utils/auth";

// ========== Helpers de Data ==========
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

/**
 * Utilitários para manipulação de datas no formato ISO (YYYY-MM-DD)
 * Considerando segunda-feira como início da semana
 */
const DateHelpers = {
  // Segunda-feira como início da semana (YYYY-MM-DD)
  weekStartISO: (d = new Date()) => {
    const date = new Date(d);
    const day = date.getDay(); // 0=Dom
    const diff = (day + 6) % 7; // 1=Seg como início
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
  
  formatDateFull: (date) => {
    return new Date(date).toLocaleDateString("pt-BR", { 
      weekday: 'long', 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });
  }
};

// ========== Helpers de Serviço ==========
const ServiceHelpers = {
  title: (s) => s?.title || s?.nome || `Serviço #${s?.id ?? ""}`,
  duration: (s) => Number(s?.duracao_min ?? s?.duration ?? 0),
  price: (s) =>
    Number(s?.preco_centavos ?? s?.preco ?? s?.price_centavos ?? 0),
  formatPrice: (centavos) =>
    (Number(centavos || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
};

// Janela de funcionamento (07:00 até 22:00)
const BUSINESS_HOURS = { start: 7, end: 22 }; // 7h inclusive, 22h inclusive

function inBusinessHours(isoDatetime) {
  const d = new Date(isoDatetime);
  const h = d.getHours();
  const m = d.getMinutes();
  const afterStart = h > BUSINESS_HOURS.start || (h === BUSINESS_HOURS.start && m >= 0);
  const beforeEnd = h < BUSINESS_HOURS.end || (h === BUSINESS_HOURS.end && m === 0);
  return afterStart && beforeEnd;
}

// ===== helpers de grade 07–22 =====
const pad2 = (n) => String(n).padStart(2, "0");
const localKey = (dateish) => {
  const d = new Date(dateish);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * Gera a grade completa 07:00–22:00 para a semana, no passo indicado.
 * Sobrepõe com os slots vindos do backend (mantém rótulos agendado/bloqueado).
 * - stepMinutes: 30 por padrão; se o serviço tiver duração "redonda" (múltiplo de 5), usa a duração (limitado a 15–120).
 */
function fillBusinessGrid({ currentWeek, slots, stepMinutes = 30 }) {
  const { days } = (function getDays(iso) {
    const ds = DateHelpers.weekDays(iso);
    return { days: ds };
  })(currentWeek);

  // indexa slots reais por "YYYY-MM-DD HH:mm" (horário local)
  const byKey = new Map();
  (slots || []).forEach((s) => {
    const k = localKey(s.datetime);
    byKey.set(k, s);
  });

  const filled = [];

  for (const { date } of days) {
    // início do dia às 07:00
    const start = new Date(date);
    start.setHours(BUSINESS_HOURS.start, 0, 0, 0);
    // fim do dia às 22:00
    const end = new Date(date);
    end.setHours(BUSINESS_HOURS.end, 0, 0, 0);

    for (let t = start.getTime(); t <= end.getTime(); t += stepMinutes * 60_000) {
      const k = localKey(t);
      const existing = byKey.get(k);
      if (existing) {
        filled.push(existing);
      } else {
        // slot "virtual" disponível
        filled.push({
          datetime: new Date(t).toISOString(),
          label: "disponível",
          status: "available",
        });
      }
    }
  }

  return filled;
}

// ========== Componentes ==========
const Modal = ({ children, onClose }) => (
  <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      {children}
    </div>
  </div>
);

const DaySkeleton = () => (
  <div className="day-skeleton">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="shimmer pill" />
    ))}
  </div>
);

const Toast = ({ type, message, onDismiss }) => (
  <div className={`toast ${type}`}>
    <div className="toast-content">
      <span className="toast-icon">
        {type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'info' ? 'ℹ' : '⚠'}
      </span>
      {message}
    </div>
    <button className="toast-close" onClick={onDismiss} aria-label="Fechar">
      &times;
    </button>
  </div>
);

const WeekNavigation = ({ currentWeek, onWeekChange, onRefresh, loading }) => (
  <div className="row" style={{ gap: 6 }}>
    <button
      className="btn btn--outline btn--sm"
      onClick={() => onWeekChange(DateHelpers.addWeeksISO(currentWeek, -1))}
      title="Semana anterior (←)"
      disabled={loading}
    >
      ◀ Semana
    </button>
    <button
      className="btn btn--outline btn--sm"
      onClick={() => onWeekChange(DateHelpers.weekStartISO(new Date()))}
      title="Ir para esta semana"
      disabled={loading}
    >
      Hoje
    </button>
    <button
      className="btn btn--outline btn--sm"
      onClick={() => onWeekChange(DateHelpers.addWeeksISO(currentWeek, 1))}
      title="Próxima semana (→)"
      disabled={loading}
    >
      Semana ▶
    </button>
    <button 
      className="btn btn--outline btn--sm" 
      onClick={onRefresh} 
      title="Atualizar slots"
      disabled={loading}
    >
      {loading ? <span className="spinner spinner--sm" /> : 'Atualizar'}
    </button>
  </div>
);

const SlotButton = ({ slot, isSelected, onClick }) => {
  const isPast = DateHelpers.isPastSlot(slot.datetime);
  const label = slot.label || "disponível";

  const className = [
    "slot-btn",
    label === "agendado" ? "busy" : label === "bloqueado" ? "block" : "ok",
    isSelected ? "is-selected" : "",
    isPast ? "is-past" : "",
  ].join(" ");

  return (
    <button
      className={className}
      title={`${new Date(slot.datetime).toLocaleString("pt-BR")} — ${label}${isPast ? " (passado)" : ""}`}
      onClick={onClick}
      disabled={isPast || label !== "disponível"}
      aria-pressed={isSelected}
    >
      {DateHelpers.formatTime(slot.datetime)}
    </button>
  );
};

const ServiceCard = ({ service, selected, onSelect }) => {
  const duration = ServiceHelpers.duration(service);
  const price = ServiceHelpers.formatPrice(ServiceHelpers.price(service));
  
  return (
    <div 
      className={`service-card ${selected ? 'service-card--selected' : ''}`}
      onClick={() => onSelect(service)}
    >
      <div className="service-card__title">{ServiceHelpers.title(service)}</div>
      <div className="service-card__details">
        {duration > 0 && <span>{duration} min</span>}
        {price !== 'R$ 0,00' && <span>{price}</span>}
      </div>
    </div>
  );
};

// ========== Página Principal ==========
export default function NovoAgendamento() {
  const user = getUser();

  // Estado principal
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
    filters: {
      onlyAvailable: true,
      hidePast: true,
    },
  });

  // Modal & toast
  const [modal, setModal] = useState({
    isOpen: false,
    isSaving: false,
  });
  const [toast, setToast] = useState(null);

  // Derivações do estado
  const { establishments, services, establishmentId, serviceId, currentWeek, slots, loading, error, selectedSlot, filters } =
    state;

  const selectedService = useMemo(
    () => services.find((s) => String(s.id) === serviceId),
    [services, serviceId]
  );

  const selectedEstablishment = useMemo(
    () => establishments.find((e) => String(e.id) === establishmentId),
    [establishments, establishmentId]
  );

  // Passo da grade (30 min padrão; se a duração do serviço for "redonda", usa ela)
  const stepMinutes = useMemo(() => {
    const d = ServiceHelpers.duration(selectedService);
    if (d && d % 5 === 0) {
      // limita entre 15 e 120 para não gerar grade absurda
      return Math.max(15, Math.min(120, d));
    }
    return 30;
  }, [selectedService]);

  // Normalização de slots vindos da API
  const normalizeSlots = useCallback((slots) => {
    const arr = Array.isArray(slots) ? slots : slots?.slots || [];
    return arr.map((slot) => {
      const datetime = slot.datetime || slot.slot_datetime;
      let label = slot.label;

      if (!label) {
        if (slot.status === "booked") label = "agendado";
        else if (slot.status === "unavailable") label = "bloqueado";
        else label = "disponível";
      }

      return { ...slot, datetime, label };
    });
  }, []);

  // Toast helper
  const showToast = useCallback((type, message, duration = 5000) => {
    setToast({ type, message });
    const timer = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(timer);
  }, []);

  // Carrega estabelecimentos
  useEffect(() => {
    const loadEstablishments = async () => {
      try {
        const list = await Api.listEstablishments();
        setState((prev) => ({
          ...prev,
          establishments: list || [],
          establishmentId:
            !prev.establishmentId && list?.length ? String(list[0].id) : prev.establishmentId,
        }));
      } catch {
        showToast("error", "Não foi possível carregar estabelecimentos.");
      }
    };

    loadEstablishments();
  }, [showToast]);

  // Carrega serviços quando muda o estabelecimento
  useEffect(() => {
    const loadServices = async () => {
      if (!establishmentId) {
        setState((prev) => ({ ...prev, services: [], serviceId: "" }));
        return;
      }

      try {
        const services = await Api.listServices(establishmentId);
        setState((prev) => ({
          ...prev,
          services: services || [],
          serviceId: !services?.some((s) => String(s.id) === prev.serviceId)
            ? services?.[0]?.id
              ? String(services[0].id)
              : ""
            : prev.serviceId,
        }));
      } catch {
        setState((prev) => ({ ...prev, services: [], serviceId: "" }));
        showToast("error", "Não foi possível carregar os serviços.");
      }
    };

    loadServices();
  }, [establishmentId, showToast]);

  // Carrega slots da semana e preenche grade 07–22
  const loadSlots = useCallback(async () => {
    if (!establishmentId) {
      setState((prev) => ({ ...prev, slots: [], selectedSlot: null }));
      return;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      const slotsData = await Api.getSlots(establishmentId, currentWeek);
      const normalizedSlots = normalizeSlots(slotsData);

      // preenche a grade completa 07–22 usando o passo escolhido
      const grid = fillBusinessGrid({
        currentWeek,
        slots: normalizedSlots,
        stepMinutes,
      });

      // sugere o primeiro futuro disponível na janela
      const firstAvailable = grid.find(
        (slot) =>
          slot.label === "disponível" &&
          !DateHelpers.isPastSlot(slot.datetime) &&
          inBusinessHours(slot.datetime)
      );

      setState((prev) => ({
        ...prev,
        slots: grid,
        selectedSlot: firstAvailable || prev.selectedSlot,
        loading: false,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        slots: [],
        selectedSlot: null,
        loading: false,
        error: "Não foi possível carregar os horários.",
      }));
    }
  }, [establishmentId, currentWeek, normalizeSlots, stepMinutes]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // Acessibilidade: ← → mudam semana
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft") {
        setState((prev) => ({ ...prev, currentWeek: DateHelpers.addWeeksISO(prev.currentWeek, -1) }));
      }
      if (e.key === "ArrowRight") {
        setState((prev) => ({ ...prev, currentWeek: DateHelpers.addWeeksISO(prev.currentWeek, 1) }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filtros visuais
  const isSlotVisible = useCallback(
    (slot) => {
      if (!inBusinessHours(slot.datetime)) return false; // janela 07:00–22:00
      if (filters.onlyAvailable && slot.label !== "disponível") return false;
      if (filters.hidePast && DateHelpers.isPastSlot(slot.datetime)) return false;
      return true;
    },
    [filters]
  );

  // Agrupar slots por dia
  const groupedSlots = useMemo(() => {
    const days = DateHelpers.weekDays(currentWeek);
    const grouped = {};

    days.forEach(({ iso }) => {
      grouped[iso] = [];
    });

    slots.forEach((slot) => {
      const iso = DateHelpers.toISODate(new Date(slot.datetime));
      if (grouped[iso]) grouped[iso].push(slot);
    });

    // Ordena slots dentro de cada dia
    Object.values(grouped).forEach((daySlots) => {
      daySlots.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    });

    return { days, grouped };
  }, [currentWeek, slots]);

  // ===== Agendamento de lembretes via WhatsApp =====
  // Por padrão, o FRONT não agenda (evita duplicidade com o backend).
  // Para habilitar no front em ambiente de teste, defina VITE_FRONT_SCHEDULE_WHATSAPP=true
  const FRONT_SCHEDULE_WHATSAPP = import.meta.env.VITE_FRONT_SCHEDULE_WHATSAPP === 'true';

  const scheduleWhatsAppReminders = useCallback(
    async ({ inicioISO, servicoNome, estabelecimentoNome }) => {
      if (!FRONT_SCHEDULE_WHATSAPP) {
        // No-op: o backend já agenda os lembretes ao criar o agendamento
        showToast("success", "Agendado com sucesso! Os lembretes serão enviados automaticamente.");
        return;
      }

      // ===== A partir daqui é a lógica antiga (só roda se FRONT_SCHEDULE_WHATSAPP=true) =====
      const toPhone =
        user?.whatsapp || user?.telefone || user?.phone || user?.celular || user?.mobile;

      if (!toPhone) {
        showToast("info", "Agendado! Cadastre seu WhatsApp no perfil para receber lembretes.");
        return;
      }

      const start = new Date(inicioISO);
      const inMs = start.getTime();
      const now = Date.now();

      // 24h e 15m
      const t1 = new Date(inMs - 24 * 60 * 60 * 1000);
      const t2 = new Date(inMs - 15 * 60 * 1000);

      const dataBR = start.toLocaleDateString("pt-BR");
      const horaBR = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      const msg1 = `🔔 Lembrete: amanhã às ${horaBR} você tem ${servicoNome} em ${estabelecimentoNome}.`;
      const msg2 = `⏰ Faltam 15 minutos para o seu ${servicoNome} em ${estabelecimentoNome} (${horaBR} de ${dataBR}).`;

      const tasks = [];
      if (t1.getTime() > now) {
        tasks.push(
          Api.scheduleWhatsApp?.({
            to: toPhone,
            scheduledAt: t1.toISOString(),
            message: msg1,
            metadata: {
              kind: "reminder_1d",
              appointmentAt: start.toISOString(),
            },
          })
        );
      }
      if (t2.getTime() > now) {
        tasks.push(
          Api.scheduleWhatsApp?.({
            to: toPhone,
            scheduledAt: t2.toISOString(),
            message: msg2,
            metadata: {
              kind: "reminder_15m",
              appointmentAt: start.toISOString(),
            },
          })
        );
      }

      if (!tasks.length) {
        showToast("info", "Agendado! Sem lembretes porque o horário está muito próximo.");
        return;
      }

      const results = await Promise.allSettled(tasks);
      const failed = results.some((r) => r.status === "rejected");
      if (failed) {
        showToast("error", "Agendado! Mas houve falha ao programar alguns lembretes no WhatsApp.");
      } else {
        showToast("success", "Agendado com sucesso! Lembretes do WhatsApp programados.");
      }
    },
    [showToast, user]
  );


  // ===== Confirmar agendamento =====
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

    setModal((prev) => ({ ...prev, isSaving: true }));

    try {
      await Api.agendar({
        estabelecimento_id: Number(establishmentId),
        servico_id: Number(serviceId),
        inicio: selectedSlot.datetime,
      });

      setModal((prev) => ({ ...prev, isOpen: false }));

      await scheduleWhatsAppReminders({
        inicioISO: selectedSlot.datetime,
        servicoNome: ServiceHelpers.title(selectedService),
        estabelecimentoNome: selectedEstablishment?.name || "seu estabelecimento",
      });

      await loadSlots();
    } catch (e) {
      showToast("error", e?.message || "Falha ao agendar.");
    } finally {
      setModal((prev) => ({ ...prev, isSaving: false }));
    }
  }, [
    selectedSlot,
    serviceId,
    establishmentId,
    selectedService,
    selectedEstablishment,
    loadSlots,
    showToast,
    scheduleWhatsAppReminders,
  ]);

  // Handlers
  const handleEstablishmentChange = (e) => {
    setState((prev) => ({ ...prev, establishmentId: e.target.value }));
  };

  const handleServiceChange = (e) => {
    setState((prev) => ({ ...prev, serviceId: e.target.value }));
  };

  const handleWeekChange = (newWeek) => {
    setState((prev) => ({ ...prev, currentWeek: newWeek }));
  };

  const handleFilterToggle = (filter) => {
    setState((prev) => ({
      ...prev,
      filters: { ...prev.filters, [filter]: !prev.filters[filter] },
    }));
  };

  const handleSlotSelect = (slot) => {
    setState((prev) => ({ ...prev, selectedSlot: slot }));
  };

  const handleClearSelection = () => {
    setState((prev) => ({ ...prev, selectedSlot: null }));
  };

  const handleOpenConfirmation = () => {
    setModal((prev) => ({ ...prev, isOpen: true }));
  };

  const handleCloseModal = () => {
    setModal((prev) => ({ ...prev, isOpen: false }));
  };

  // Render
  const weekLabel = DateHelpers.formatWeekLabel(currentWeek);
  const selectedDateStr = selectedSlot ? new Date(selectedSlot.datetime).toLocaleString("pt-BR") : null;

  const serviceDuration = ServiceHelpers.duration(selectedService);
  const servicePrice = ServiceHelpers.formatPrice(ServiceHelpers.price(selectedService));

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Toast */}
      {toast && <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />}

      <div className="card">
        {/* Cabeçalho / navegação */}
        <div className="row spread" style={{ marginBottom: 8, alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Novo Agendamento</h2>
            <small className="muted">
              Semana: {weekLabel} • Fuso: {TZ} • Janela: 07:00–22:00 • Passo: {stepMinutes} min
            </small>
          </div>

          <WeekNavigation 
            currentWeek={currentWeek} 
            onWeekChange={handleWeekChange} 
            onRefresh={loadSlots} 
            loading={loading}
          />
        </div>

        {/* Seletores */}
        <div className="row" style={{ marginBottom: 8, width: "100%", gap: 8, flexWrap: "wrap" }}>
          <label className="label" style={{ minWidth: 260 }}>
            <span>Estabelecimento</span>
            <select
              value={establishmentId}
              onChange={handleEstablishmentChange}
              className="input"
              disabled={user?.tipo === "estabelecimento"}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {establishments.map((est) => (
                <option key={est.id} value={est.id}>
                  {est.name} {est.email ? `(${est.email})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="label" style={{ minWidth: 260 }}>
            <span>Serviço</span>
            <select
              value={serviceId}
              onChange={handleServiceChange}
              className="input"
              disabled={!establishmentId || !services.length}
            >
              {!services.length && <option value="">Cadastre serviços para este estabelecimento</option>}
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {ServiceHelpers.title(s)}
                  {ServiceHelpers.duration(s) ? ` • ${ServiceHelpers.duration(s)} min` : ""}
                  {ServiceHelpers.price(s) ? ` • ${ServiceHelpers.formatPrice(ServiceHelpers.price(s))}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="label" style={{ minWidth: 210 }}>
            <span>Início da semana</span>
            <input
              type="date"
              value={currentWeek}
              onChange={(e) => handleWeekChange(DateHelpers.toISODate(e.target.value))}
              className="input"
              title="Segunda-feira da semana"
            />
          </label>

          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <label className="switch">
              <input
                type="checkbox"
                checked={filters.onlyAvailable}
                onChange={() => handleFilterToggle("onlyAvailable")}
              />
              <span>Somente disponíveis</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={filters.hidePast}
                onChange={() => handleFilterToggle("hidePast")}
              />
              <span>Ocultar passados</span>
            </label>
          </div>
        </div>

        <small className="muted">Clique em um slot <b>disponível</b> para selecionar e depois confirme.</small>

        {/* Mensagem de erro */}
        {error && (
          <div className="box error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {/* Resumo do agendamento */}
        {selectedSlot && (
          <div
            className="box box--highlight"
            style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}
          >
            <div className="appointment-summary">
              <div className="appointment-summary__item">
                <span className="appointment-summary__label">Estabelecimento:</span>
                <span className="appointment-summary__value">{selectedEstablishment?.name ?? "—"}</span>
              </div>
              <div className="appointment-summary__item">
                <span className="appointment-summary__label">Serviço:</span>
                <span className="appointment-summary__value">
                  {selectedService
                    ? `${ServiceHelpers.title(selectedService)}${
                        serviceDuration ? ` • ${serviceDuration} min` : ""
                      }${servicePrice ? ` • ${servicePrice}` : ""}`
                    : "—"}
                </span>
              </div>
              <div className="appointment-summary__item">
                <span className="appointment-summary__label">Data:</span>
                <span className="appointment-summary__value">
                  {selectedSlot ? DateHelpers.formatDateFull(selectedSlot.datetime) : "—"}
                </span>
              </div>
              <div className="appointment-summary__item">
                <span className="appointment-summary__label">Horário:</span>
                <span className="appointment-summary__value">
                  {selectedSlot ? DateHelpers.formatTime(selectedSlot.datetime) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Calendário semanal em colunas */}
        <div className="week-grid" style={{ marginTop: 12 }}>
          {/* Cabeçalho dos dias */}
          <div className="week-grid__row week-grid__head">
            {groupedSlots.days.map(({ iso, date }) => {
              const isToday = DateHelpers.sameYMD(iso, DateHelpers.toISODate(new Date()));
              const label = new Intl.DateTimeFormat("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
              })
                .format(date)
                .replace(/\.$/, "");

              return (
                <div key={iso} className={`week-col ${isToday ? "is-today" : ""}`}>
                  <div className="week-col__title">{label}</div>
                  <div className="week-col__subtitle">
                    {isToday ? 'Hoje' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Slots por dia */}
          <div className="week-grid__row">
            {groupedSlots.days.map(({ iso }) => {
              const daySlots = (groupedSlots.grouped[iso] || []).filter(isSlotVisible);

              return (
                <div key={iso} className="week-col">
                  {loading ? (
                    <DaySkeleton />
                  ) : daySlots.length === 0 ? (
                    <div className="empty small">Sem horários</div>
                  ) : (
                    daySlots.map((slot) => (
                      <SlotButton
                        key={slot.datetime}
                        slot={slot}
                        isSelected={selectedSlot?.datetime === slot.datetime}
                        onClick={() => handleSlotSelect(slot)}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Ações */}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={handleClearSelection} disabled={!selectedSlot}>
            Limpar seleção
          </button>
          <button
            className="btn btn--primary"
            onClick={handleOpenConfirmation}
            disabled={
              !selectedSlot ||
              !serviceId ||
              modal.isSaving ||
              selectedSlot?.label !== "disponível" ||
              DateHelpers.isPastSlot(selectedSlot.datetime) ||
              !inBusinessHours(selectedSlot.datetime)
            }
            title={
              !selectedSlot
                ? "Selecione um horário disponível"
                : DateHelpers.isPastSlot(selectedSlot.datetime)
                ? "Não é possível agendar no passado"
                : !inBusinessHours(selectedSlot.datetime)
                ? "Fora da janela (07:00–22:00)"
                : !serviceId
                ? "Selecione um serviço"
                : "Confirmar agendamento"
            }
          >
            {modal.isSaving ? <span className="spinner" /> : "Confirmar agendamento"}
          </button>
        </div>
      </div>

      {/* Modal de confirmação */}
      {modal.isOpen && selectedSlot && selectedService && (
        <Modal onClose={handleCloseModal}>
          <h3>Confirmar agendamento?</h3>
          <div className="confirmation-details">
            <div className="confirmation-details__item">
              <span className="confirmation-details__label">Serviço:</span>
              <span className="confirmation-details__value">{ServiceHelpers.title(selectedService)}</span>
            </div>
            {serviceDuration > 0 && (
              <div className="confirmation-details__item">
                <span className="confirmation-details__label">Duração:</span>
                <span className="confirmation-details__value">{serviceDuration} minutos</span>
              </div>
            )}
            {servicePrice !== 'R$ 0,00' && (
              <div className="confirmation-details__item">
                <span className="confirmation-details__label">Preço:</span>
                <span className="confirmation-details__value">{servicePrice}</span>
              </div>
            )}
            <div className="confirmation-details__item">
              <span className="confirmation-details__label">Data:</span>
              <span className="confirmation-details__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span>
            </div>
            <div className="confirmation-details__item">
              <span className="confirmation-details__label">Horário:</span>
              <span className="confirmation-details__value">{DateHelpers.formatTime(selectedSlot.datetime)}</span>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button className="btn btn--outline" onClick={handleCloseModal} disabled={modal.isSaving}>
              Cancelar
            </button>

            <button className="btn btn--primary" onClick={confirmBooking} disabled={modal.isSaving}>
              {modal.isSaving ? <span className="spinner" /> : "Confirmar Agendamento"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}