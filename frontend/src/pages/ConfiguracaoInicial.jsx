import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  Plus,
  Save,
  Users,
  Wrench,
} from 'lucide-react';
import { Api } from '../utils/api';
import { getUser, saveUser } from '../utils/auth';

const STEPS = [
  { key: 'profissionais', label: 'Profissionais', icon: Users },
  { key: 'servicos', label: 'Serviços', icon: Wrench },
  { key: 'horarios', label: 'Horários', icon: Clock },
  { key: 'revisao', label: 'Revisão', icon: CheckCircle },
];

const STEP_INDEX = new Map(STEPS.map((step, index) => [step.key, index]));

const WEEKDAYS = [
  { key: 'monday', label: 'Segunda', short: 'Seg' },
  { key: 'tuesday', label: 'Terça', short: 'Ter' },
  { key: 'wednesday', label: 'Quarta', short: 'Qua' },
  { key: 'thursday', label: 'Quinta', short: 'Qui' },
  { key: 'friday', label: 'Sexta', short: 'Sex' },
  { key: 'saturday', label: 'Sábado', short: 'Sáb' },
  { key: 'sunday', label: 'Domingo', short: 'Dom' },
];

function moneyToCents(value) {
  const normalized = String(value || '').replace(',', '.');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function formatMoney(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function isActive(item) {
  if (!item) return false;
  if (item.ativo === undefined || item.ativo === null) return true;
  return item.ativo === true || item.ativo === 1 || item.ativo === '1';
}

function defaultSchedule() {
  return WEEKDAYS.map((day) => ({
    ...day,
    enabled: !['saturday', 'sunday'].includes(day.key),
    start: '09:00',
    end: day.key === 'saturday' ? '13:00' : '18:00',
    breakEnabled: false,
    blockStart: '12:00',
    blockEnd: '13:00',
  }));
}

function scheduleFromApi(rows = []) {
  const savedRows = Array.isArray(rows) ? rows : [];
  if (!savedRows.length) return defaultSchedule();
  const base = defaultSchedule().map((day) => ({ ...day, enabled: false }));
  const byDay = new Map(savedRows.map((item) => [item.day || item.key, item]));
  return base.map((day) => {
    const saved = byDay.get(day.key);
    if (!saved) return day;
    const firstBlock = Array.isArray(saved.blocks) ? saved.blocks[0] : null;
    return {
      ...day,
      enabled: true,
      start: saved.start || day.start,
      end: saved.end || day.end,
      breakEnabled: Boolean(firstBlock?.start && firstBlock?.end),
      blockStart: firstBlock?.start || day.blockStart,
      blockEnd: firstBlock?.end || day.blockEnd,
    };
  });
}

function validateSchedule(schedule) {
  const activeDays = schedule.filter((day) => day.enabled);
  if (!activeDays.length) return 'Ative pelo menos um dia de funcionamento.';

  for (const day of activeDays) {
    if (!day.start || !day.end) return `Informe abertura e fechamento de ${day.label}.`;
    if (day.start >= day.end) return `O horário de abertura deve ser anterior ao fechamento em ${day.label}.`;
    if (day.breakEnabled) {
      if (!day.blockStart || !day.blockEnd) return `Informe início e fim da pausa em ${day.label}.`;
      if (day.blockStart >= day.blockEnd) return `A pausa precisa terminar depois de iniciar em ${day.label}.`;
      if (day.blockStart < day.start || day.blockEnd > day.end) {
        return `A pausa em ${day.label} precisa ficar dentro do horário de funcionamento.`;
      }
    }
  }

  return '';
}

function serializeSchedule(schedule) {
  return schedule.map((day) => ({
    day: day.key,
    label: day.label,
    enabled: day.enabled,
    start: day.start,
    end: day.end,
    breakEnabled: day.breakEnabled,
    blockStart: day.blockStart,
    blockEnd: day.blockEnd,
  }));
}

function OnboardingLayout({
  activeStep,
  children,
  loading,
  saving,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  toast,
}) {
  const activeIndex = STEP_INDEX.get(activeStep) || 0;

  return (
    <div className="onboarding-page">
      {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}

      <section className="onboarding-hero">
        <div className="onboarding-hero__copy">
          <span className="page-shell__eyebrow">Configuração inicial</span>
          <h1 className="page-shell__title">Prepare sua agenda para receber clientes</h1>
          <p className="page-shell__subtitle">
            Complete os dados mínimos da operação. O progresso fica salvo para continuar depois.
          </p>
        </div>
        <div className="onboarding-hero__metric" aria-label="Progresso">
          <strong>{Math.round(((activeIndex + 1) / STEPS.length) * 100)}%</strong>
          <span>do setup</span>
        </div>
      </section>

      <StepProgress activeStep={activeStep} />

      <section className="onboarding-workspace">
        {loading ? (
          <div className="onboarding-loading" role="status" aria-live="polite">
            <span className="spinner" />
            <span>Carregando configuração inicial...</span>
          </div>
        ) : (
          children
        )}
      </section>

      {!loading ? (
        <div className="onboarding-footer">
          <button
            type="button"
            className="btn btn--outline"
            onClick={onBack}
            disabled={saving || activeIndex === 0}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onNext}
            disabled={saving || nextDisabled}
          >
            {saving ? <span className="spinner" aria-hidden="true" /> : null}
            {nextLabel}
            {!saving ? <ArrowRight size={16} aria-hidden="true" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StepProgress({ activeStep }) {
  const activeIndex = STEP_INDEX.get(activeStep) || 0;

  return (
    <nav className="step-progress" aria-label="Etapas da configuração inicial">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const done = index < activeIndex;
        const active = step.key === activeStep;
        return (
          <div
            key={step.key}
            className={`step-progress__item${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
            aria-current={active ? 'step' : undefined}
          >
            <span className="step-progress__icon">
              {done ? <Check size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
            </span>
            <span className="step-progress__text">
              <small>Etapa {index + 1}</small>
              <strong>{step.label}</strong>
            </span>
          </div>
        );
      })}
    </nav>
  );
}

function EtapaProfissionais({ professionals, form, setForm, onCreate, saving }) {
  return (
    <div className="onboarding-step">
      <StepHeader
        title="Cadastre quem atende"
        description="Adicione pelo menos um profissional para liberar o cadastro de serviços."
        count={`${professionals.length} cadastrado${professionals.length === 1 ? '' : 's'}`}
      />

      <form className="onboarding-form" onSubmit={onCreate}>
        <label className="label">
          <span>Nome do profissional</span>
          <input
            className="input"
            value={form.nome}
            onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
            placeholder="Ex.: Mariana Costa"
            maxLength={120}
          />
        </label>
        <label className="label">
          <span>Descrição opcional</span>
          <input
            className="input"
            value={form.descricao}
            onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))}
            placeholder="Especialidade, cargo ou observação"
            maxLength={200}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={saving || !form.nome.trim()}>
          <Plus size={16} aria-hidden="true" />
          Adicionar profissional
        </button>
      </form>

      <EntityList
        emptyTitle="Nenhum profissional cadastrado"
        emptyText="Cadastre o primeiro profissional para seguir."
        items={professionals.map((item) => ({
          id: item.id,
          title: item.nome,
          meta: isActive(item) ? 'Ativo' : 'Inativo',
          detail: item.descricao || 'Sem descrição',
        }))}
      />
    </div>
  );
}

function EtapaServicos({
  services,
  professionals,
  form,
  setForm,
  selectedProfessionalIds,
  setSelectedProfessionalIds,
  onCreate,
  saving,
}) {
  const activeProfessionals = professionals.filter(isActive);

  const toggleProfessional = (id, checked) => {
    setSelectedProfessionalIds((current) => {
      const next = new Set(current.map(String));
      if (checked) next.add(String(id));
      else next.delete(String(id));
      return Array.from(next);
    });
  };

  return (
    <div className="onboarding-step">
      <StepHeader
        title="Defina os serviços"
        description="Cada serviço precisa estar vinculado a um ou mais profissionais."
        count={`${services.length} cadastrado${services.length === 1 ? '' : 's'}`}
      />

      <form className="onboarding-form onboarding-form--service" onSubmit={onCreate}>
        <label className="label onboarding-form__span-2">
          <span>Nome do serviço</span>
          <input
            className="input"
            value={form.nome}
            onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
            placeholder="Ex.: Corte masculino"
            maxLength={120}
          />
        </label>
        <label className="label">
          <span>Duração</span>
          <select
            className="input"
            value={form.duracao_min}
            onChange={(event) => setForm((current) => ({ ...current, duracao_min: Number(event.target.value) }))}
          >
            {[15, 30, 45, 60, 75, 90, 120, 180].map((minutes) => (
              <option key={minutes} value={minutes}>{minutes} min</option>
            ))}
          </select>
        </label>
        <label className="label">
          <span>Preço</span>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={form.preco}
            onChange={(event) => setForm((current) => ({ ...current, preco: event.target.value }))}
            placeholder="0,00"
          />
        </label>
        <label className="label onboarding-form__span-2">
          <span>Descrição opcional</span>
          <input
            className="input"
            value={form.descricao}
            onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))}
            placeholder="Resumo do que está incluso"
            maxLength={240}
          />
        </label>

        <div className="onboarding-prof-selector onboarding-form__span-2">
          <span className="onboarding-prof-selector__label">Profissionais vinculados</span>
          <div className="onboarding-prof-selector__grid">
            {activeProfessionals.map((professional) => {
              const checked = selectedProfessionalIds.map(String).includes(String(professional.id));
              return (
                <label
                  key={professional.id}
                  className={`onboarding-check-card${checked ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleProfessional(professional.id, event.target.checked)}
                  />
                  <span>{professional.nome}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn--primary onboarding-form__action"
          disabled={saving || !form.nome.trim() || !selectedProfessionalIds.length}
        >
          <Plus size={16} aria-hidden="true" />
          Adicionar serviço
        </button>
      </form>

      <EntityList
        emptyTitle="Nenhum serviço cadastrado"
        emptyText="Cadastre o primeiro serviço para seguir para os horários."
        items={services.map((item) => ({
          id: item.id,
          title: item.nome,
          meta: `${item.duracao_min || 0} min · ${formatMoney(item.preco_centavos)}`,
          detail: item.professionals?.length
            ? item.professionals.map((professional) => professional.nome).join(', ')
            : 'Sem profissionais vinculados',
        }))}
      />
    </div>
  );
}

function EtapaHorarios({ schedule, setSchedule }) {
  const activeDays = schedule.filter((day) => day.enabled).length;

  const updateDay = (key, patch) => {
    setSchedule((current) => current.map((day) => (day.key === key ? { ...day, ...patch } : day)));
  };

  const applyBusinessWeek = () => {
    setSchedule((current) => current.map((day) => ({
      ...day,
      enabled: !['saturday', 'sunday'].includes(day.key),
      start: '09:00',
      end: '18:00',
      breakEnabled: false,
    })));
  };

  return (
    <div className="onboarding-step">
      <StepHeader
        title="Configure o funcionamento"
        description="Defina dias, abertura, fechamento e uma pausa opcional."
        count={`${activeDays} dia${activeDays === 1 ? '' : 's'} ativo${activeDays === 1 ? '' : 's'}`}
      />

      <div className="onboarding-hours__toolbar">
        <button type="button" className="btn btn--outline btn--sm" onClick={applyBusinessWeek}>
          Comercial seg-sex
        </button>
      </div>

      <div className="onboarding-hours">
        {schedule.map((day) => (
          <div key={day.key} className={`onboarding-hours__row${day.enabled ? ' is-open' : ''}`}>
            <label className="onboarding-hours__day">
              <input
                type="checkbox"
                checked={day.enabled}
                onChange={(event) => updateDay(day.key, { enabled: event.target.checked })}
              />
              <span>{day.label}</span>
            </label>

            <div className="onboarding-hours__times">
              <input
                className="input"
                type="time"
                value={day.start}
                disabled={!day.enabled}
                onChange={(event) => updateDay(day.key, { start: event.target.value })}
                aria-label={`Abertura de ${day.label}`}
              />
              <span>às</span>
              <input
                className="input"
                type="time"
                value={day.end}
                disabled={!day.enabled}
                onChange={(event) => updateDay(day.key, { end: event.target.value })}
                aria-label={`Fechamento de ${day.label}`}
              />
            </div>

            <label className="switch onboarding-hours__pause">
              <input
                type="checkbox"
                checked={day.breakEnabled}
                disabled={!day.enabled}
                onChange={(event) => updateDay(day.key, { breakEnabled: event.target.checked })}
              />
              <span>Pausa</span>
            </label>

            {day.breakEnabled ? (
              <div className="onboarding-hours__times onboarding-hours__times--pause">
                <input
                  className="input"
                  type="time"
                  value={day.blockStart}
                  disabled={!day.enabled}
                  onChange={(event) => updateDay(day.key, { blockStart: event.target.value })}
                  aria-label={`Início da pausa de ${day.label}`}
                />
                <span>às</span>
                <input
                  className="input"
                  type="time"
                  value={day.blockEnd}
                  disabled={!day.enabled}
                  onChange={(event) => updateDay(day.key, { blockEnd: event.target.value })}
                  aria-label={`Fim da pausa de ${day.label}`}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function EtapaRevisao({ professionals, services, schedule }) {
  const activeSchedule = schedule.filter((day) => day.enabled);

  return (
    <div className="onboarding-step">
      <StepHeader
        title="Revise antes de finalizar"
        description="Confira se a estrutura mínima está pronta para abrir a agenda."
        count="Pronto para ativar"
      />

      <div className="onboarding-review">
        <ReviewPanel title="Profissionais" value={professionals.length}>
          <EntityList
            compact
            emptyTitle="Nenhum profissional"
            emptyText="Volte para cadastrar."
            items={professionals.map((item) => ({
              id: item.id,
              title: item.nome,
              meta: isActive(item) ? 'Ativo' : 'Inativo',
              detail: item.descricao || '',
            }))}
          />
        </ReviewPanel>

        <ReviewPanel title="Serviços" value={services.length}>
          <EntityList
            compact
            emptyTitle="Nenhum serviço"
            emptyText="Volte para cadastrar."
            items={services.map((item) => ({
              id: item.id,
              title: item.nome,
              meta: `${item.duracao_min || 0} min · ${formatMoney(item.preco_centavos)}`,
              detail: item.professionals?.map((professional) => professional.nome).join(', ') || '',
            }))}
          />
        </ReviewPanel>

        <ReviewPanel title="Horários" value={activeSchedule.length}>
          <div className="onboarding-review__hours">
            {activeSchedule.length ? activeSchedule.map((day) => (
              <div key={day.key} className="onboarding-review__hour-row">
                <strong>{day.short}</strong>
                <span>{day.start} - {day.end}</span>
                {day.breakEnabled ? <small>Pausa {day.blockStart} - {day.blockEnd}</small> : null}
              </div>
            )) : (
              <div className="empty">Nenhum horário ativo.</div>
            )}
          </div>
        </ReviewPanel>
      </div>
    </div>
  );
}

function StepHeader({ title, description, count }) {
  return (
    <header className="onboarding-step__header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span>{count}</span>
    </header>
  );
}

function EntityList({ items, emptyTitle, emptyText, compact = false }) {
  if (!items.length) {
    return (
      <div className={`onboarding-empty${compact ? ' onboarding-empty--compact' : ''}`}>
        <AlertCircle size={18} aria-hidden="true" />
        <strong>{emptyTitle}</strong>
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <div className={`onboarding-entity-list${compact ? ' onboarding-entity-list--compact' : ''}`}>
      {items.map((item) => (
        <article key={item.id} className="onboarding-entity">
          <div>
            <h3>{item.title}</h3>
            {item.detail ? <p>{item.detail}</p> : null}
          </div>
          {item.meta ? <span>{item.meta}</span> : null}
        </article>
      ))}
    </div>
  );
}

function ReviewPanel({ title, value, children }) {
  return (
    <section className="onboarding-review__panel">
      <header>
        <span>{title}</span>
        <strong>{value}</strong>
      </header>
      {children}
    </section>
  );
}

export default function ConfiguracaoInicial() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState('profissionais');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const [professionals, setProfessionals] = useState([]);
  const [services, setServices] = useState([]);
  const [schedule, setSchedule] = useState(() => defaultSchedule());

  const [professionalForm, setProfessionalForm] = useState({ nome: '', descricao: '' });
  const [serviceForm, setServiceForm] = useState({
    nome: '',
    descricao: '',
    duracao_min: 30,
    preco: '',
    capacidade_por_horario: 1,
  });
  const [selectedProfessionalIds, setSelectedProfessionalIds] = useState([]);

  const showToast = useCallback((type, message, timeout = 4500) => {
    setToast({ type, message });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), timeout);
  }, []);

  const applyState = useCallback((data) => {
    const nextStep = data?.onboarding?.etapa || 'profissionais';
    setActiveStep(STEP_INDEX.has(nextStep) ? nextStep : 'profissionais');
    setProfessionals(Array.isArray(data?.professionals) ? data.professionals : []);
    setServices(Array.isArray(data?.services) ? data.services : []);
    setSchedule(scheduleFromApi(data?.horarios || []));
  }, []);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await Api.onboardingStatus();
      if (data?.onboarding?.concluido) {
        navigate('/estab', { replace: true });
        return data;
      }
      applyState(data);
      return data;
    } catch (err) {
      showToast('error', err?.message || 'Não foi possível carregar a configuração inicial.');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyState, navigate, showToast]);

  useEffect(() => {
    reload();
    return () => window.clearTimeout(toastTimerRef.current);
  }, [reload]);

  useEffect(() => {
    const activeProfessionals = professionals.filter(isActive);
    if (!activeProfessionals.length) {
      setSelectedProfessionalIds([]);
      return;
    }
    setSelectedProfessionalIds((current) => {
      const activeIds = new Set(activeProfessionals.map((item) => String(item.id)));
      const filtered = current.filter((id) => activeIds.has(String(id)));
      return filtered.length ? filtered : [String(activeProfessionals[0].id)];
    });
  }, [professionals]);

  const activeProfessionals = useMemo(() => professionals.filter(isActive), [professionals]);
  const activeServices = useMemo(() => services.filter(isActive), [services]);

  const handleCreateProfessional = async (event) => {
    event.preventDefault();
    const nome = professionalForm.nome.trim();
    if (!nome) {
      showToast('error', 'Informe o nome do profissional.');
      return;
    }

    setSaving(true);
    try {
      await Api.profissionaisCreate({
        nome,
        descricao: professionalForm.descricao.trim() || null,
        ativo: true,
      });
      setProfessionalForm({ nome: '', descricao: '' });
      showToast('success', 'Profissional cadastrado.');
      await reload({ silent: true });
    } catch (err) {
      showToast('error', err?.data?.message || err?.message || 'Não foi possível cadastrar o profissional.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateService = async (event) => {
    event.preventDefault();
    const nome = serviceForm.nome.trim();
    if (!nome) {
      showToast('error', 'Informe o nome do serviço.');
      return;
    }
    if (!selectedProfessionalIds.length) {
      showToast('error', 'Selecione pelo menos um profissional para o serviço.');
      return;
    }

    setSaving(true);
    try {
      await Api.servicosCreate({
        nome,
        descricao: serviceForm.descricao.trim() || null,
        duracao_min: Number(serviceForm.duracao_min) || 30,
        preco_centavos: moneyToCents(serviceForm.preco),
        capacidade_por_horario: Number(serviceForm.capacidade_por_horario) || 1,
        ativo: true,
        professionalIds: selectedProfessionalIds.map(Number),
      });
      setServiceForm({
        nome: '',
        descricao: '',
        duracao_min: 30,
        preco: '',
        capacidade_por_horario: 1,
      });
      showToast('success', 'Serviço cadastrado.');
      await reload({ silent: true });
    } catch (err) {
      showToast('error', err?.data?.message || err?.message || 'Não foi possível cadastrar o serviço.');
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    const validationError = validateSchedule(schedule);
    if (validationError) {
      showToast('error', validationError);
      return null;
    }

    const data = await Api.onboardingSaveHours(serializeSchedule(schedule));
    applyState(data);
    return data;
  };

  const persistStep = async (step) => {
    const data = await Api.onboardingUpdateStep(step);
    applyState(data);
    return data;
  };

  const handleNext = async () => {
    if (activeStep === 'profissionais' && activeProfessionals.length < 1) {
      showToast('error', 'Cadastre pelo menos um profissional para continuar.');
      return;
    }
    if (activeStep === 'servicos' && activeServices.length < 1) {
      showToast('error', 'Cadastre pelo menos um serviço para continuar.');
      return;
    }

    setSaving(true);
    try {
      if (activeStep === 'profissionais') {
        await persistStep('servicos');
        showToast('success', 'Etapa de profissionais salva.');
        return;
      }
      if (activeStep === 'servicos') {
        await persistStep('horarios');
        showToast('success', 'Etapa de serviços salva.');
        return;
      }
      if (activeStep === 'horarios') {
        const data = await saveSchedule();
        if (data) showToast('success', 'Horários salvos.');
        return;
      }
      if (activeStep === 'revisao') {
        const data = await Api.onboardingFinish();
        const currentUser = getUser();
        if (currentUser) {
          saveUser({
            ...currentUser,
            ...(data?.user_updates || {}),
            onboarding_concluido: true,
            onboarding_etapa: 'finalizado',
          });
        }
        navigate('/estab?onboarding=sucesso', {
          replace: true,
          state: { onboardingSuccess: true },
        });
      }
    } catch (err) {
      showToast('error', err?.data?.message || err?.message || 'Não foi possível avançar.');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    const currentIndex = STEP_INDEX.get(activeStep) || 0;
    if (currentIndex <= 0) return;
    const previous = STEPS[currentIndex - 1].key;

    setSaving(true);
    try {
      await persistStep(previous);
      showToast('info', 'Etapa atualizada.');
    } catch (err) {
      showToast('error', err?.data?.message || err?.message || 'Não foi possível voltar.');
    } finally {
      setSaving(false);
    }
  };

  const nextLabel = {
    profissionais: 'Salvar e ir para serviços',
    servicos: 'Salvar e ir para horários',
    horarios: 'Salvar horários e revisar',
    revisao: 'Finalizar configuração',
  }[activeStep] || 'Continuar';

  const nextDisabled =
    (activeStep === 'profissionais' && activeProfessionals.length < 1) ||
    (activeStep === 'servicos' && activeServices.length < 1);

  return (
    <OnboardingLayout
      activeStep={activeStep}
      loading={loading}
      saving={saving}
      onBack={handleBack}
      onNext={handleNext}
      nextLabel={nextLabel}
      nextDisabled={nextDisabled}
      toast={toast}
    >
      {activeStep === 'profissionais' ? (
        <EtapaProfissionais
          professionals={professionals}
          form={professionalForm}
          setForm={setProfessionalForm}
          onCreate={handleCreateProfessional}
          saving={saving}
        />
      ) : null}

      {activeStep === 'servicos' ? (
        <EtapaServicos
          services={services}
          professionals={professionals}
          form={serviceForm}
          setForm={setServiceForm}
          selectedProfessionalIds={selectedProfessionalIds}
          setSelectedProfessionalIds={setSelectedProfessionalIds}
          onCreate={handleCreateService}
          saving={saving}
        />
      ) : null}

      {activeStep === 'horarios' ? (
        <EtapaHorarios schedule={schedule} setSchedule={setSchedule} />
      ) : null}

      {activeStep === 'revisao' ? (
        <EtapaRevisao professionals={activeProfessionals} services={activeServices} schedule={schedule} />
      ) : null}
    </OnboardingLayout>
  );
}
