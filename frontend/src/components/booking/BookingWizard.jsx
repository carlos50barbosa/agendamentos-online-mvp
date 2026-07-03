// src/components/booking/BookingWizard.jsx
// Fluxo público do cliente final em passos (um por tela no mobile):
//   Serviço → Profissional → Dia → Horário → Confirmação → Pagamento (PIX).
// Na Fase 1 consome dados via props (mock). A Fase 2 injeta os dados reais do
// Asaas em `onConfirm` (createPixCharge + getPixQrCode).
import React, { useMemo, useState } from 'react';
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
}) {
  const [step, setStep] = useState(STEP.SERVICO);
  const [service, setService] = useState(null);
  const [professional, setProfessional] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pix, setPix] = useState(null);
  const [error, setError] = useState(null);

  const days = useMemo(() => daysProp || buildDayRange(new Date(), 14), [daysProp]);
  const slots = useMemo(
    () => (date && buildSlots ? buildSlots(date, { serviceId: service?.id, professionalId: professional?.id }) : []),
    [date, service, professional, buildSlots],
  );

  const go = (next) => {
    setError(null);
    setStep(next);
  };
  const back = () => go(Math.max(0, step - 1));

  const selectService = (s) => {
    setService(s);
    setSlot(null);
    go(professionals.length ? STEP.PROFISSIONAL : STEP.DIA);
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
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm({ service, professional, date, slot });
      setPix(result);
      go(STEP.PAGAMENTO);
    } catch (e) {
      setError(e?.message || 'Não foi possível gerar o PIX. Tente novamente.');
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
              {professionals.map((p) => (
                <SelectableRow
                  key={p.id}
                  icon={User}
                  title={p.nome}
                  subtitle={p.especialidade}
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
            <SlotPicker slots={slots} value={slot?.datetime} onSelect={selectSlot} />
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
                  <Loader2 size={20} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Gerando PIX...
                </>
              ) : (
                <>
                  Confirmar e pagar sinal <ArrowRight size={20} strokeWidth={2.2} aria-hidden="true" />
                </>
              )}
            </button>
          </StepShell>
        )}

        {step === STEP.PAGAMENTO && (
          <StepShell title="Pagamento do sinal">
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
