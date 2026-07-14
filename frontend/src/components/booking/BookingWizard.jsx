// src/pages/../components/booking/BookingWizard.jsx
// Fluxo público do cliente final em passos (um por tela no mobile):
//   Serviços (multi + busca) → Profissional → Dia → Horário → Confirmação (+ dados) → Pagamento (PIX).
// Consome dados via props: mock (Fase 1) ou API real (Fase 2 — BookingPublic.jsx, que injeta
// getSlots/publicAgendar do backend com sinal via Asaas). Props que ligam o real:
//   collectGuest=true  -> mostra os campos nome/e-mail/telefone/CPF na confirmação
//   buildSlots(date, { serviceIds, professionalId }) pode ser sync (mock) OU async (Promise, API real)
//   pollStatus(paymentId, token) -> vira o PIX para 'paid'/'expired' sozinho
//   onConfirm({ services, professional, date, slot, guest, whatsappOptIn }) -> cria o agendamento e devolve o PIX
//     whatsappOptIn: a pessoa marcou a caixa autorizando mensagens no WhatsApp. Sem isso, o backend
//     NÃO envia (nem confirmação, nem lembrete) — cai para e-mail. Ver lib/whatsapp_consent.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Scissors, Search, User, Check, ArrowRight, Loader2, Info, X, Flame } from 'lucide-react';
import LogoAO from '../LogoAO.jsx';
import EstablishmentHeader from './EstablishmentHeader.jsx';
import DayChips from '../agenda/DayChips.jsx';
import SlotPicker from '../agenda/SlotPicker.jsx';
import PixCheckout from '../agenda/PixCheckout.jsx';
import { buildDayRange, fullDateLabel, hourLabel, durationLabel } from '../../utils/agendaDates.js';
import { formatBRPhone, formatCpfCnpj } from '../../utils/masks.js';
import { WA_SENDER_NAME } from '../../utils/whatsappConsent.js';
import { useWhatsAppAvailable } from '../../hooks/useWhatsAppStatus.js';
import { site } from '../../config/site.js';
import { iconSizes } from '../../config/theme.js';

const STEP = { SERVICO: 0, PROFISSIONAL: 1, DIA: 2, HORARIO: 3, CONFIRMACAO: 4, PAGAMENTO: 5 };

function formatBRL(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
}

// Profissionais que atendem TODOS os serviços que exigem profissional (interseção).
function intersectProfessionals(services) {
  const lists = (services || []).filter((s) => s?.professionals?.length).map((s) => s.professionals);
  if (!lists.length) return [];
  return lists.reduce((acc, list) => acc.filter((p) => list.some((x) => x.id === p.id)), lists[0]);
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
  preselectedServiceIds = [],
  establishment = null,
  initialGuest = null,
  // Assinatura vencida: a página do estabelecimento continua inteira (capa, perfil, serviços,
  // preços) — só a AÇÃO de agendar é desligada. Esconder tudo puniria o cliente, que clicou
  // naquele link justamente para ver aquele estabelecimento.
  bookingDisabled = false,
  // Contexto do plano do cliente (créditos restantes + desconto do plano). Sem isto o wizard
  // mostraria o preço CHEIO enquanto o backend cobra o descontado — o assinante veria R$ 80 e
  // seria cobrado R$ 0.
  loyalty = null,
}) {
  const [step, setStep] = useState(STEP.SERVICO);
  const [selectedServices, setSelectedServices] = useState([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [professional, setProfessional] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pix, setPix] = useState(null);
  const [error, setError] = useState(null);
  const [guest, setGuest] = useState(() => ({
    nome: initialGuest?.nome || '',
    email: initialGuest?.email || '',
    telefone: initialGuest?.telefone ? formatBRPhone(initialGuest.telefone) : '',
    cpf: initialGuest?.cpf ? formatCpfCnpj(initialGuest.cpf) : '',
  }));
  const [slotsState, setSlotsState] = useState({ loading: false, list: [] });
  const [detailService, setDetailService] = useState(null);
  // Opt-in do WhatsApp. Nasce DESMARCADO e assim tem de ficar: caixa pré-marcada não é
  // consentimento ativo — para a Meta e para a LGPD é como se não houvesse aceite nenhum, e é a
  // primeira coisa que derruba um recurso. Marcar sozinho custaria a conta de novo.
  const [waOptIn, setWaOptIn] = useState(false);
  const waAvailable = useWhatsAppAvailable();

  const days = useMemo(() => daysProp || buildDayRange(new Date(), 14), [daysProp]);

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      [s.nome, s.descricao].filter(Boolean).some((t) => String(t).toLowerCase().includes(q)),
    );
  }, [services, serviceSearch]);

  // Espelha a regra do backend (client_loyalty_credits.buildBenefitPreview): crédito do ciclo
  // zera o serviço; sem crédito, o desconto do plano vale para os "extras"; sem plano, cheio.
  const benefitFor = useCallback((service) => {
    const price = Number(service?.price) || 0;
    if (!loyalty?.subscription) return { type: 'full', price };
    const credito = loyalty?.credits_by_service?.[String(service.id)];
    if (Number(credito?.quantidade_restante) > 0) return { type: 'credit', price: 0 };
    const pct = Number(loyalty?.plan?.desconto_percentual_extras) || 0;
    if (pct > 0) return { type: 'discount', price: Math.round(price * (100 - pct)) / 100, percent: pct };
    return { type: 'full', price };
  }, [loyalty]);

  const totalPrice = useMemo(
    () => selectedServices.reduce((sum, s) => sum + benefitFor(s).price, 0),
    [selectedServices, benefitFor],
  );
  const totalDuration = useMemo(() => selectedServices.reduce((sum, s) => sum + (Number(s.durationMin) || 0), 0), [selectedServices]);
  const depositTotal = useMemo(() => {
    if (!selectedServices.length || selectedServices.some((s) => s.depositValue == null)) return null;
    return selectedServices.reduce((sum, s) => sum + (Number(s.depositValue) || 0), 0);
  }, [selectedServices]);

  // Profissional: interseção dos vinculados aos serviços (API real) ou lista geral (mock).
  const professionalRequired = useMemo(() => selectedServices.some((s) => s?.professionals?.length), [selectedServices]);
  const professionalOptions = useMemo(() => {
    const inter = intersectProfessionals(selectedServices);
    return inter.length ? inter : (professionalRequired ? [] : professionals);
  }, [selectedServices, professionals, professionalRequired]);
  const showProfessionalStep = professionalRequired || professionalOptions.length > 0;

  const selectedServiceKey = selectedServices.map((s) => s.id).join(',');

  // Pré-seleção via URL (?servico=): marca os serviços assim que a lista chega, sem
  // sobrescrever uma escolha já feita pelo usuário (mantém o multi-serviço editável).
  const preselectKey = (preselectedServiceIds || []).map(String).join(',');
  useEffect(() => {
    // ?servico=ID marca o serviço sozinho, sem passar por toggleService. Sem esta guarda, um link
    // com pré-seleção deixaria serviços marcados numa página que não aceita agendamento.
    if (bookingDisabled) return;
    if (!preselectKey || !services.length) return;
    const wanted = new Set(preselectKey.split(','));
    setSelectedServices((prev) => (prev.length ? prev : services.filter((s) => wanted.has(String(s.id)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectKey, services, bookingDisabled]);

  // Carrega os horários do dia (buildSlots sync [mock] OU async [Promise, API real]).
  useEffect(() => {
    if (step !== STEP.HORARIO || !date || !buildSlots || !selectedServices.length) return undefined;
    let alive = true;
    setSlotsState({ loading: true, list: [] });
    Promise.resolve(buildSlots(date, { serviceIds: selectedServices.map((s) => s.id), professionalId: professional?.id }))
      .then((list) => { if (alive) setSlotsState({ loading: false, list: Array.isArray(list) ? list : [] }); })
      .catch(() => { if (alive) setSlotsState({ loading: false, list: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, date, selectedServiceKey, professional?.id, buildSlots]);

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

  const toggleService = (s) => {
    // Ponto único de entrada da seleção: travando aqui, nenhum caminho (lista, modal de detalhes)
    // consegue montar um agendamento enquanto a assinatura estiver vencida.
    if (bookingDisabled) return;
    setSlot(null);
    setProfessional(null);
    setSelectedServices((prev) => (prev.some((x) => x.id === s.id) ? prev.filter((x) => x.id !== s.id) : [...prev, s]));
  };
  const goFromServices = () => {
    if (bookingDisabled) return;
    if (!selectedServices.length) { setError('Selecione ao menos um serviço.'); return; }
    go(showProfessionalStep ? STEP.PROFISSIONAL : STEP.DIA);
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
      const result = await onConfirm({ services: selectedServices, professional, date, slot, guest, whatsappOptIn: waOptIn });
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
      {/* Cabeçalho rico do estabelecimento (fluxo real). Some no pagamento p/ foco.
          O botão da capa é o único "voltar": volta uma etapa e some na 1ª (serviços). */}
      {establishment && step < STEP.PAGAMENTO && (
        <EstablishmentHeader establishment={establishment} onBack={back} showBack={step > STEP.SERVICO} />
      )}

      {bookingDisabled && <BookingDisabledNotice establishment={establishment} />}

      {/* Marca (mock) / etapa + progresso. Sem agendamento não há etapas a percorrer. */}
      {!bookingDisabled && (
      <header className="tw-flex tw-flex-col tw-gap-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          {/* Chevron de voltar-etapa só no fluxo mock (sem cabeçalho do estabelecimento) */}
          {!establishment && step > STEP.SERVICO && step < STEP.PAGAMENTO && (
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
          {establishment ? (
            <p className="tw-m-0 tw-text-xs tw-font-semibold" style={{ color: 'var(--muted-ink, #6B7280)' }}>
              Etapa {step + 1} de {site.bookingSteps.length} ·{' '}
              <span style={{ color: 'var(--brand-deep, #1E1B4B)' }}>{site.bookingSteps[step]?.label}</span>
            </p>
          ) : (
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
          )}
        </div>
        <ProgressBar current={step} total={site.bookingSteps.length} />
      </header>
      )}

      <main className="tw-flex-1">
        {step === STEP.SERVICO && (
          <StepShell title={bookingDisabled ? 'Serviços' : 'Escolha os serviços'}>
            <div
              className="tw-flex tw-items-center tw-gap-2 tw-rounded-xl tw-px-3"
              style={{ minHeight: 44, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
            >
              <Search size={18} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--muted-ink, #6B7280)', flexShrink: 0 }} />
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Buscar serviço..."
                aria-label="Buscar serviço"
                className="tw-w-full tw-border-0 tw-bg-transparent tw-text-sm tw-outline-none"
                style={{ color: 'var(--ink, #1E1B4B)' }}
              />
            </div>

            <div className={`tw-mt-3 tw-flex tw-flex-col tw-gap-2 ${bookingDisabled ? 'tw-pb-4' : 'tw-pb-24'}`}>
              {filteredServices.map((s) => (
                <ServiceRow
                  key={s.id}
                  service={s}
                  selected={!bookingDisabled && selectedServices.some((x) => x.id === s.id)}
                  onToggle={() => toggleService(s)}
                  onDetails={() => setDetailService(s)}
                  benefit={benefitFor(s)}
                  // Vitrine: o serviço ainda abre os detalhes (o cliente quer saber o que tem e
                  // quanto custa), mas não pode ser selecionado — não há para onde avançar.
                  disabled={bookingDisabled}
                />
              ))}
              {!filteredServices.length && (
                <p className="tw-m-0 tw-rounded-2xl tw-p-6 tw-text-center tw-text-sm" style={{ background: 'var(--surface-soft, #FBFBFE)', color: 'var(--muted-ink, #6B7280)' }}>
                  Nenhum serviço encontrado.
                </p>
              )}
            </div>

            {/* Barra fixa: total + continuar. Sem agendamento, não há total nem para onde ir. */}
            {!bookingDisabled && (
            <div
              className="tw-fixed tw-inset-x-0 tw-bottom-0 tw-mx-auto tw-flex tw-max-w-lg tw-items-center tw-justify-between tw-gap-3 tw-p-4"
              style={{ background: 'linear-gradient(to top, var(--bg-lav, #F6F5FB) 70%, transparent)' }}
            >
              <div className="tw-min-w-0">
                <p className="tw-m-0 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  {selectedServices.length} selecionado(s){totalDuration ? ` · ${durationLabel({ minutes: totalDuration })}` : ''}
                </p>
                <p className="tw-m-0 tw-text-sm tw-font-extrabold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
                  {formatBRL(totalPrice)}
                </p>
              </div>
              <button
                type="button"
                onClick={goFromServices}
                disabled={!selectedServices.length}
                className="tw-flex tw-items-center tw-gap-2 tw-rounded-xl tw-px-5 tw-font-semibold tw-text-white"
                style={{ minHeight: 48, background: 'var(--brand)', opacity: selectedServices.length ? 1 : 0.6 }}
              >
                Continuar <ArrowRight size={20} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
            )}
          </StepShell>
        )}

        {step === STEP.PROFISSIONAL && (
          <StepShell title="Escolha o profissional">
            {professionalRequired && !professionalOptions.length ? (
              <p className="tw-m-0 tw-rounded-2xl tw-p-4 tw-text-sm" style={{ background: 'var(--surface-soft, #FBFBFE)', color: 'var(--status-cancelado-fg)' }}>
                Nenhum profissional atende todos os serviços selecionados juntos. Remova um serviço ou agende-os separadamente.
              </p>
            ) : (
              <div className="tw-flex tw-flex-col tw-gap-2">
                {professionalOptions.map((p) => (
                  <SelectableRow
                    key={p.id}
                    icon={User}
                    imageUrl={p.avatar_url}
                    title={p.nome}
                    subtitle={p.especialidade || p.descricao}
                    selected={professional?.id === p.id}
                    onClick={() => selectProfessional(p)}
                  />
                ))}
              </div>
            )}
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
              {selectedServices.map((s) => (
                <SummaryRow key={s.id} label={s.nome} value={s.priceLabel || formatBRL(s.price)} />
              ))}
              <div style={{ height: 1, background: 'var(--brand-border, #E7E5F5)' }} />
              <SummaryRow label="Total" value={formatBRL(totalPrice)} strong />
              {professional && <SummaryRow label="Profissional" value={professional.nome} />}
              <SummaryRow label="Dia" value={fullDateLabel(date)} capitalize />
              <SummaryRow label="Horário" value={hourLabel(slot?.datetime)} strong />
              {depositTotal != null && <SummaryRow label="Sinal (PIX)" value={formatBRL(depositTotal)} strong />}
            </div>

            {collectGuest && (
              <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
                <GuestInput label="Nome" value={guest.nome} onChange={(v) => setGuest((g) => ({ ...g, nome: v }))} placeholder="Seu nome" autoComplete="name" />
                <GuestInput label="E-mail" type="email" value={guest.email} onChange={(v) => setGuest((g) => ({ ...g, email: v }))} placeholder="voce@email.com" autoComplete="email" />
                <GuestInput label="Telefone" value={guest.telefone} onChange={(v) => setGuest((g) => ({ ...g, telefone: v }))} format={formatBRPhone} placeholder="(11) 99999-9999" autoComplete="tel" inputMode="tel" />
                <GuestInput label="CPF/CNPJ" value={guest.cpf} onChange={(v) => setGuest((g) => ({ ...g, cpf: v }))} format={formatCpfCnpj} placeholder="Necessário se houver sinal (PIX)" inputMode="numeric" />
              </div>
            )}

            <WhatsAppOptIn
              checked={waOptIn}
              onChange={setWaOptIn}
              establishmentName={establishment?.nome || establishmentName}
              unavailable={!waAvailable}
            />

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
                <span
                  aria-hidden="true"
                  style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: '50%', background: '#16A34A', boxShadow: '0 6px 16px rgba(22,163,74,.28)' }}
                >
                  <Check size={30} strokeWidth={3} style={{ color: '#fff' }} />
                </span>
                <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--ink, #1E1B4B)' }}>
                  {pix.message || 'Seu agendamento foi registrado. Confirme pelo link enviado no seu e-mail ou WhatsApp.'}
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

      {detailService && (
        <ServiceDetailsModal
          service={detailService}
          selected={selectedServices.some((x) => x.id === detailService.id)}
          onToggle={() => toggleService(detailService)}
          onClose={() => setDetailService(null)}
          disabled={bookingDisabled}
        />
      )}
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

/**
 * A caixa de opt-in do WhatsApp.
 *
 * Três decisões que parecem detalhe e não são:
 *
 * 1. NASCE DESMARCADA. Caixa pré-marcada não é consentimento ativo — nem para a Meta, nem para a
 *    LGPD. Custa taxa de adesão, sim. Custa menos que a conta banida.
 *
 * 2. NÃO BLOQUEIA O AGENDAMENTO. Condicionar o serviço ao aceite é consentimento forçado, que não
 *    vale (e ainda derruba a conversão). Quem não marcar agenda igual e recebe por e-mail.
 *
 * 3. O TEXTO NOMEIA QUEM ENVIA. É o que a Meta exige e o que evita a denúncia: a pessoa precisa
 *    reconhecer o remetente quando a mensagem chegar. A frase é a mesma que o servidor grava como
 *    prova — ver utils/whatsappConsent.js.
 */
function WhatsAppOptIn({ checked, onChange, establishmentName, unavailable = false }) {
  const nome = String(establishmentName || '').trim();
  return (
    <div className="tw-mt-3 tw-flex tw-flex-col">
      <label
        className="tw-flex tw-cursor-pointer tw-items-start tw-gap-3 tw-rounded-2xl tw-p-3"
        style={{ background: 'var(--surface-soft, #F6F5FB)', border: '1px solid var(--brand-border, #E7E5F5)' }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="tw-mt-0.5 tw-h-5 tw-w-5 tw-shrink-0 tw-cursor-pointer tw-rounded"
          style={{ accentColor: 'var(--brand)' }}
        />
        <span className="tw-flex tw-flex-col tw-gap-0.5">
          <span className="tw-text-sm tw-font-semibold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
            Quero receber a confirmação e os lembretes no WhatsApp
          </span>
          <span className="tw-text-xs" style={{ color: 'var(--text-muted, #6B7280)' }}>
            Enviado por {WA_SENDER_NAME}{nome ? ` em nome de ${nome}` : ''}. Sem promoções — só sobre o seu
            horário. Para sair, responda <b>PARAR</b>. Se preferir, deixe desmarcado: avisamos por e-mail.
          </span>
        </span>
      </label>

      {/* Aviso de STATUS, deliberadamente FORA do rótulo da caixa.
          O texto lá em cima é a prova: é ele que o servidor grava, palavra por palavra, e um teste
          impede que a tela e o banco divirjam. Enfiar "está fora do ar hoje" lá dentro contaminaria
          a prova com uma circunstância passageira — e daqui a um mês o registro diria que a pessoa
          aceitou um aviso de apagão.
          A caixa continua funcionando: um canal fora do ar é motivo para não PROMETER, não para
          deixar de PERGUNTAR. O aceite fica guardado e vale quando o WhatsApp voltar. */}
      {unavailable && checked && (
        <p
          className="tw-mt-2 tw-rounded-xl tw-px-3 tw-py-2 tw-text-xs"
          style={{ background: 'var(--warning-bg, #FEF3C7)', color: 'var(--warning-text, #92400E)' }}
        >
          <b>Só um aviso:</b> nossas mensagens no WhatsApp estão temporariamente suspensas. Por
          enquanto a confirmação e o lembrete vão para o seu <b>e-mail</b> — e seu aceite fica
          guardado para quando o WhatsApp voltar.
        </p>
      )}
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

function GuestInput({ label, value, onChange, type = 'text', placeholder, autoComplete, inputMode, format }) {
  return (
    <label className="tw-flex tw-flex-col tw-gap-1">
      <span className="tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(format ? format(e.target.value) : e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="tw-rounded-xl tw-px-3 tw-text-sm"
        style={{ minHeight: 44, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', color: 'var(--ink, #1E1B4B)' }}
      />
    </label>
  );
}

// Card do serviço com seleção (toggle) + botão de detalhes (abre o modal). Dois botões
// irmãos num div (não aninhados) para HTML válido.
// Faixa de indisponibilidade: fica logo abaixo da capa, antes dos serviços. Diz o que houve e dá
// a única saída útil (falar com o estabelecimento) — a página continua navegável.
function BookingDisabledNotice({ establishment }) {
  const telefone = String(establishment?.telefone || '').replace(/\D/g, '');
  const whatsappUrl = telefone.length >= 10
    ? `https://wa.me/${telefone.length > 11 ? telefone : `55${telefone}`}`
    : '';

  return (
    <div
      role="status"
      className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4"
      style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
    >
      <div className="tw-flex tw-items-start tw-gap-3">
        <span style={{ color: '#B45309', flexShrink: 0, marginTop: 2 }}>
          <Info size={20} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="tw-min-w-0">
          <p className="tw-m-0 tw-text-sm tw-font-bold" style={{ color: '#92400E' }}>
            Agendamento online indisponível
          </p>
          <p className="tw-m-0 tw-mt-1 tw-text-sm" style={{ color: '#92400E' }}>
            Este estabelecimento não está aceitando agendamentos pelo site no momento.
            Você pode ver os serviços abaixo e falar direto com ele.
          </p>
        </div>
      </div>

      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-font-semibold tw-no-underline"
          style={{ minHeight: 44, background: 'var(--wa-green, #25D366)', color: '#fff' }}
        >
          Falar no WhatsApp
        </a>
      ) : null}
    </div>
  );
}

function ServiceRow({ service, selected, onToggle, onDetails, disabled = false, benefit = null }) {
  // O preço exibido é o preço COBRADO. Mostrar o cheio e cobrar outro é o pior tipo de erro
  // de interface: o cliente descobre no extrato.
  const temBeneficio = benefit && benefit.type !== 'full';
  const precoTexto = temBeneficio
    ? (benefit.type === 'credit' ? 'Grátis pelo seu plano' : formatBRL(benefit.price))
    : (service.priceLabel || formatBRL(service.price));
  const subtitle = [durationLabel({ minutes: service.durationMin }), precoTexto].filter(Boolean).join(' · ');
  return (
    <div
      className="tw-flex tw-w-full tw-items-center tw-gap-1 tw-rounded-2xl tw-transition"
      style={{
        minHeight: 60,
        background: selected ? 'var(--brand-100, #EEEDFC)' : 'var(--surface, #fff)',
        border: `1px solid ${selected ? 'var(--brand)' : 'var(--brand-border, #E7E5F5)'}`,
      }}
    >
      <button
        type="button"
        onClick={disabled ? onDetails : onToggle}
        aria-pressed={disabled ? undefined : selected}
        className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-3 tw-border-0 tw-bg-transparent tw-p-3 tw-text-left"
        style={{ cursor: 'pointer' }}
      >
        <span
          className="tw-flex tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-xl"
          style={{ width: 40, height: 40, background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand)', flexShrink: 0 }}
        >
          {service.imagem_url ? (
            <img src={service.imagem_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover' }} />
          ) : (
            <Scissors size={20} strokeWidth={2} aria-hidden="true" />
          )}
        </span>
        <span className="tw-min-w-0 tw-flex-1">
          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <span className="tw-min-w-0 tw-truncate tw-text-sm tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
              {service.nome}
            </span>
            {service.popular && (
              <span
                className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wide"
                style={{ background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand)' }}
              >
                <Flame size={12} strokeWidth={2.4} aria-hidden="true" />
                Mais agendado
              </span>
            )}
          </span>
          {subtitle && (
            <span className="tw-block tw-truncate tw-text-xs"
              style={{ color: temBeneficio ? 'var(--brand)' : 'var(--muted-ink, #6B7280)', fontWeight: temBeneficio ? 650 : 400 }}>
              {subtitle}
              {temBeneficio && (
                <s className="tw-ml-1 tw-font-normal" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  {formatBRL(service.price)}
                </s>
              )}
            </span>
          )}
        </span>
        {selected && <Check size={20} strokeWidth={2.6} aria-hidden="true" style={{ color: 'var(--brand)', flexShrink: 0 }} />}
      </button>
      <button
        type="button"
        onClick={onDetails}
        aria-label={`Detalhes de ${service.nome}`}
        title="Ver detalhes"
        className="tw-flex tw-items-center tw-justify-center tw-border-0 tw-bg-transparent tw-pr-3"
        style={{ minWidth: 40, minHeight: 44, color: 'var(--muted-ink, #6B7280)', flexShrink: 0, cursor: 'pointer' }}
      >
        <Info size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function ServiceDetailsModal({ service, selected, onToggle, onClose, disabled = false }) {
  const subtitle = [durationLabel({ minutes: service.durationMin }), service.priceLabel || formatBRL(service.price)]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4"
      style={{ background: 'rgba(30,27,75,0.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="tw-w-full tw-max-w-md tw-overflow-hidden tw-rounded-2xl"
        style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
      >
        {service.imagem_url ? (
          <img src={service.imagem_url} alt={service.nome} style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
        ) : null}
        <div className="tw-flex tw-flex-col tw-gap-2 tw-p-4">
          <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-min-w-0">
              <h2 className="tw-m-0 tw-text-base tw-font-bold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
                {service.nome}
              </h2>
              {subtitle && (
                <p className="tw-m-0 tw-text-sm tw-font-semibold" style={{ color: 'var(--brand)' }}>{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="tw-inline-flex tw-items-center tw-justify-center tw-border-0 tw-rounded-xl"
              style={{ minWidth: 40, minHeight: 40, background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand-deep, #1E1B4B)', flexShrink: 0, cursor: 'pointer' }}
            >
              <X size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--ink, #1E1B4B)', whiteSpace: 'pre-wrap' }}>
            {service.descricao || 'Sem descrição para este serviço.'}
          </p>
          {/* Sem agendamento disponível, o modal é só a ficha do serviço — oferecer "Adicionar"
              seria prometer algo que o passo seguinte não entrega. */}
          {!disabled && (
            <button
              type="button"
              onClick={() => { onToggle(); onClose(); }}
              className="tw-mt-2 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-font-semibold"
              style={{
                minHeight: 48,
                cursor: 'pointer',
                background: selected ? 'var(--surface-soft, #F6F5FB)' : 'var(--brand)',
                color: selected ? 'var(--brand-deep, #1E1B4B)' : '#fff',
                border: selected ? '1px solid var(--brand-border, #E7E5F5)' : '1px solid transparent',
              }}
            >
              {selected ? 'Remover do agendamento' : 'Adicionar ao agendamento'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectableRow({ icon: Icon, imageUrl, title, subtitle, selected, onClick }) {
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
        className="tw-flex tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-xl"
        style={{ width: 40, height: 40, background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand)', flexShrink: 0 }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover' }} />
        ) : (
          <Icon size={20} strokeWidth={2} aria-hidden="true" />
        )}
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
      <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>
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
