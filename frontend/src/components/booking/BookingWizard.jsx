// src/components/booking/BookingWizard.jsx
// Fluxo público do cliente final em passos (um por tela no mobile):
//   Serviço → Profissional → Dia → Horário → Confirmação (+ dados do cliente) → Pagamento (PIX).
// Consome dados via props: pode ser mock (Fase 1) ou a API real (Fase 2 — BookingPublic.jsx,
// que injeta getSlots/publicAgendar do backend com sinal via Asaas). Props que ligam o real:
//   collectGuest=true  -> mostra os campos nome/e-mail/telefone/CPF na confirmação
//   buildSlots pode ser sync (mock) OU async (Promise, API real)
//   pollStatus(paymentId, token) -> vira o PIX para 'paid'/'expired' sozinho
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Scissors, User, Check, ArrowRight, Loader2 } from 'lucide-react';
import LogoAO from '../LogoAO.jsx';
import DayChips from '../agenda/DayChips.jsx';
import SlotPicker from '../agenda/SlotPicker.jsx';
import PixCheckout from '../agenda/PixCheckout.jsx';
import { buildDayRange, fullDateLabel, hourLabel, durationLabel, toDate } from '../../utils/agendaDates.js';
import { site } from '../../config/site.js';
import { iconSizes } from '../../config/theme.js';

const STEP = { SERVICO: 0, PROFISSIONAL: 1, DIA: 2, HORARIO: 3, CONFIRMACAO: 4, PAGAMENTO: 5 };

function formatBRL(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
}

export default function BookingWizard({
  establishmentName = site.name,
  services = [],
  professionals = [],
  buildSlots,
  onConfirm,
  days: daysProp,
  collectGuest = false,
  pollStatus,
}) {
  const [step, setStep] = useState(STEP.SERVICO);
  const [service, setService] = useState(null);
  const [professional, setProfessional] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pix, setPix] = useState(null);
  const [error, setError] = useState(null);
  const [guest, setGuest] = useState({ nome: '', email: '', telefone: '', cpf: '' });
  const [slotsState, setSlotsState] = useState({ loading: false, list: [] });

  const days = useMemo(() => daysProp || buildDayRange(new Date(), 14), [daysProp]);

  // Profissionais do passo: os vinculados ao serviço (API real) ou a lista geral (mock).
  const stepProfessionals = useMemo(
    () => (service?.professionals?.length ? service.professionals : professionals),
    [service, professionals],
  );

  // Carrega os horários do dia (suporta buildSlots sync [mock] OU async [Promise, API real]).
  useEffect(() => {
    if (step !== STEP.HORARIO || !date || !buildSlots) return undefined;
    let alive = true;
    setSlotsState({ loading: true, list: [] });
    Promise.resolve(buildSlots(date, { serviceId: service?.id, professionalId: professional?.id }))
      .then((list) => { if (alive) setSlotsState({ loading: false, list: Array.isArray(list) ? list : [] }); })
      .catch(() => { if (alive) setSlotsState({ loading: false, list: [] }); });
    return () => { alive = false; };
  }, [step, date, service?.id, professional?.id, buildSlots]);

  // Poll do status do PIX (API real): vira 'paid'/'expired' automaticamente.
  useEffect(() => {
    if (step !== STEP.PAGAMENTO || !pollStatus || !pix?.paymentId || pix?.confirmed) return undefined;
    if (pix?.status === 'paid' || pix?.status === 'expired') return undefined;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const s = await pollStatus(pix.paymentId, pix.token);
        if (!alive || !s) return;
        setPix((prev) => (prev ? { ...prev, status: s } : prev));
        if (s === 'paid' || s === 'expired') clearInterval(iv);
      } catch { /* silencioso */ }
    }, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [step, pollStatus, pix?.paymentId, pix?.status, pix?.confirmed]);

  const go = (next) => {
    setError(null);
    setStep(next);
  };
  const back = () => go(Math.max(0, step - 1));

  const selectService = (s) => {
    setService(s);
    setProfessional(null);
    setSlot(null);
    const pros = (s?.professionals?.length ? s.professionals : professionals) || [];
    go(pros.length ? STEP.PROFISSIONAL : STEP.DIA);
  };
  const selectProfessional = (p) => {
    setProfessional(p);
    setSlot(null);
    go(STEP.DIA);
  };
  const selectDate = (d) => {
    setDate(d);
    setSlot(null);
    go(STEP.HORARIO);
  };
  const selectSlot = (s) => {
    setSlot(s);
    go(STEP.CONFIRMACAO);
  };

  const confirm = async () => {
    if (!onConfirm) return;
    if (collectGuest) {
      const nome = guest.nome.trim();
      const email = guest.email.trim();
      const telDigits = guest.telefone.replace(/\D/g, '');
      const cpfDigits = guest.cpf.replace(/\D/g, '');
      if (!nome) { setError('Informe seu nome.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Informe um e-mail válido.'); return; }
      if (telDigits.length < 10) { setError('Informe um telefone válido (com DDD).'); return; }
      if (cpfDigits && !(cpfDigits.length === 11 || cpfDigits.length === 14)) { setError('CPF/CNPJ inválido.'); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm({ service, professional, date, slot, guest });
      setPix(result);
      go(STEP.PAGAMENTO);
    } catch (e) {
      setError(e?.message || 'Não foi possível concluir o agendamento. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-lg tw-flex-col tw-gap-4 tw-p-4">
      {/* Marca + progresso */}
      <header className="tw-flex tw-flex-col tw-gap-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          {step > STEP.SERVICO && step < STEP.PAGAMENTO && (
            <button
              type="button"
              onClick={back}
              aria-label="Voltar"
              className="tw-inline-flex tw-items-center tw-justify-center tw-rounded-xl"
              style={{ minWidth: 44, minHeight: 44, background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand-deep, #1E1B4B)' }}
            >
              <ChevronLeft size={iconSizes.nav} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <LogoAO size={32} className="" />
            <div className="tw-min-w-0">
              <p className="tw-m-0 tw-truncate tw-text-sm tw-font-bold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
                {establishmentName}
              </p>
              <p className="tw-m-0 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                {site.bookingSteps[step]?.label}
              </p>
            </div>
          </div>
        </div>
        <ProgressBar current={step} total={site.bookingSteps.length} />
      </header>

      <main className="tw-flex-1">
        {step === STEP.SERVICO && (
          <StepShell title="Escolha o serviço">
            <div className="tw-flex tw-flex-col tw-gap-2">
              {services.map((s) => (
                <SelectableRow
                  key={s.id}
                  icon={Scissors}
                  title={s.nome}
                  subtitle={[durationLabel({ minutes: s.durationMin }), s.priceLabel || formatBRL(s.price)].filter(Boolean).join(' · ')}
                  selected={service?.id === s.id}
                  onClick={() => selectService(s)}
                />
              ))}
            </div>
          </StepShell>
        )}

        {step === STEP.PROFISSIONAL && (
          <StepShell title="Escolha o profissional">
            <div className="tw-flex tw-flex-col tw-gap-2">
              {stepProfessionals.map((p) => (
                <SelectableRow
                  key={p.id}
                  icon={User}
                  title={p.nome}
                  subtitle={p.especialidade || p.descricao}
                  selected={professional?.id === p.id}
                  onClick={() => selectProfessional(p)}
                />
              ))}
            </div>
          </StepShell>
        )}

        {step === STEP.DIA && (
          <StepShell title="Escolha o dia">
            <DayChips days={days} selectedDate={date} onSelect={selectDate} />
            {date && (
              <p className="tw-mt-3 tw-text-sm tw-capitalize" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                {fullDateLabel(date)}
              </p>
            )}
          </StepShell>
        )}

        {step === STEP.HORARIO && (
          <StepShell title="Escolha o horário">
            {slotsState.loading ? (
              <div className="tw-flex tw-items-center tw-gap-2 tw-py-6" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                <Loader2 size={20} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Carregando horários...
              </div>
            ) : (
              <SlotPicker slots={slotsState.list} value={slot?.datetime} onSelect={selectSlot} />
            )}
          </StepShell>
        )}

        {step === STEP.CONFIRMACAO && (
          <StepShell title="Confirme seu agendamento">
            <div
              className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4"
              style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
            >
              <SummaryRow label="Serviço" value={service?.nome} />
              {professional && <SummaryRow label="Profissional" value={professional.nome} />}
              <SummaryRow label="Dia" value={fullDateLabel(date)} capitalize />
              <SummaryRow label="Horário" value={hourLabel(slot?.datetime)} strong />
              {(service?.depositValue != null) && (
                <SummaryRow label="Sinal (PIX)" value={formatBRL(service.depositValue)} strong />
              )}
            </div>

            {collectGuest && (
              <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
                <GuestInput label="Nome" value={guest.nome} onChange={(v) => setGuest((g) => ({ ...g, nome: v }))} placeholder="Seu nome" autoComplete="name" />
                <GuestInput label="E-mail" type="email" value={guest.email} onChange={(v) => setGuest((g) => ({ ...g, email: v }))} placeholder="voce@email.com" autoComplete="email" />
                <GuestInput label="Telefone" value={guest.telefone} onChange={(v) => setGuest((g) => ({ ...g, telefone: v }))} placeholder="(11) 99999-9999" autoComplete="tel" inputMode="tel" />
                <GuestInput label="CPF" value={guest.cpf} onChange={(v) => setGuest((g) => ({ ...g, cpf: v }))} placeholder="Necessário se houver sinal (PIX)" inputMode="numeric" />
              </div>
            )}

            {error && (
              <p className="tw-mt-3 tw-text-sm" style={{ color: 'var(--status-cancelado-fg)' }}>
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={submitting}
              className="tw-mt-4 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-font-semibold tw-text-white"
              style={{ minHeight: 48, background: 'var(--brand)', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? (
                <>
                  <Loader2 size={20} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Confirmando...
                </>
              ) : (
                <>
                  Confirmar {collectGuest ? 'agendamento' : 'e pagar sinal'} <ArrowRight size={20} strokeWidth={2.2} aria-hidden="true" />
                </>
              )}
            </button>
          </StepShell>
        )}

        {step === STEP.PAGAMENTO && (
          <StepShell title={pix?.confirmed ? 'Agendamento confirmado' : 'Pagamento do sinal'}>
            {pix?.confirmed ? (
              <div
                className="tw-flex tw-flex-col tw-items-center tw-gap-3 tw-rounded-2xl tw-p-6 tw-text-center"
                style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
              >
                <Check size={40} strokeWidth={2.4} aria-hidden="true" style={{ color: 'var(--brand)' }} />
                <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--ink, #1E1B4B)' }}>
                  {pix.message || 'Seu agendamento foi registrado. Confirme pelo link enviado no seu e-mail.'}
                </p>
              </div>
            ) : (
              <>
                <PixCheckout
                  encodedImage={pix?.encodedImage}
                  payload={pix?.payload}
                  value={pix?.value}
                  expirationDate={pix?.expirationDate}
                  status={pix?.status || 'pending'}
                />
                <p className="tw-mt-4 tw-text-center tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  Assim que o pagamento for confirmado, seu horário fica garantido.
                </p>
              </>
            )}
          </StepShell>
        )}
      </main>
    </div>
  );
}

function ProgressBar({ current, total }) {
  return (
    <div className="tw-flex tw-gap-1.5" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="tw-h-1.5 tw-flex-1 tw-rounded-full tw-transition"
          style={{ background: i <= current ? 'var(--brand)' : 'var(--brand-200, #D7D4F7)' }}
        />
      ))}
    </div>
  );
}

function StepShell({ title, children }) {
  return (
    <section>
      <h1 className="tw-m-0 tw-mb-3 tw-text-lg tw-font-bold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
        {title}
      </h1>
      {children}
    </section>
  );
}

function GuestInput({ label, value, onChange, type = 'text', placeholder, autoComplete, inputMode }) {
  return (
    <label className="tw-flex tw-flex-col tw-gap-1">
      <span className="tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="tw-rounded-xl tw-px-3 tw-text-sm"
        style={{ minHeight: 44, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', color: 'var(--ink, #1E1B4B)' }}
      />
    </label>
  );
}

function SelectableRow({ icon: Icon, title, subtitle, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-2xl tw-p-3 tw-text-left tw-transition"
      style={{
        minHeight: 60,
        background: selected ? 'var(--brand-100, #EEEDFC)' : 'var(--surface, #fff)',
        border: `1px solid ${selected ? 'var(--brand)' : 'var(--brand-border, #E7E5F5)'}`,
      }}
    >
      <span
        className="tw-flex tw-items-center tw-justify-center tw-rounded-xl"
        style={{ width: 40, height: 40, background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand)', flexShrink: 0 }}
      >
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="tw-min-w-0 tw-flex-1">
        <span className="tw-block tw-truncate tw-text-sm tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
          {title}
        </span>
        {subtitle && (
          <span className="tw-block tw-truncate tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            {subtitle}
          </span>
        )}
      </span>
      {selected && <Check size={20} strokeWidth={2.6} aria-hidden="true" style={{ color: 'var(--brand)', flexShrink: 0 }} />}
    </button>
  );
}

function SummaryRow({ label, value, strong, capitalize }) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
      <span className="tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>
        {label}
      </span>
      <span
        className={`tw-text-right tw-text-sm ${strong ? 'tw-font-extrabold' : 'tw-font-semibold'} ${capitalize ? 'tw-capitalize' : ''}`}
        style={{ color: strong ? 'var(--brand-deep, #1E1B4B)' : 'var(--ink, #1E1B4B)' }}
      >
        {value || '—'}
      </span>
    </div>
  );
}
