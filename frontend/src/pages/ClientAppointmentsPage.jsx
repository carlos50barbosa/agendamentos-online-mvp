import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { IconPlus, IconSearch } from '../components/Icons.jsx';
import { Api } from '../utils/api.js';
import {
  formatDateTimeBr,
  isPastDateTime,
} from '../utils/formatDateTimeBr.js';
import AppointmentTable from '../components/client-appointments/AppointmentTable.jsx';
import AppointmentCardList from '../components/client-appointments/AppointmentCardList.jsx';
import StatusBadge, {
  normalizeAppointmentStatus,
} from '../components/client-appointments/StatusBadge.jsx';
import ConfirmModal from '../components/client-appointments/ConfirmModal.jsx';
import SkeletonList from '../components/client-appointments/SkeletonList.jsx';
import EmptyState from '../components/client-appointments/EmptyState.jsx';
import Button, { buttonClassName } from '../components/client-appointments/Button.jsx';

const STATUS_FILTER_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'pendente', label: 'Pendente / Aguardando pagamento' },
];

const MOBILE_FILTER_CHIPS = [
  { value: 'todos', label: 'Todos' },
  { value: 'confirmado', label: 'Confirmados' },
  { value: 'concluido', label: 'Concluídos' },
  { value: 'cancelado', label: 'Cancelados' },
];

const DEFAULT_DEPOSIT_MODAL = {
  open: false,
  paymentId: null,
  appointmentId: null,
  expiresAt: null,
  amountCents: null,
  pix: null,
};

const NEW_APPOINTMENT_ROUTE = '/novo-agendamento';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

function getServiceLabel(item) {
  const names = Array.isArray(item?.servicos)
    ? item.servicos.map((service) => service?.nome).filter(Boolean)
    : [];
  if (names.length) return names.join(' + ');
  return item?.servico_nome || item?.service_name || 'Serviço';
}

function decorateAppointment(item, nowTs = Date.now()) {
  const rawStatus = String(item?.status || '').trim().toLowerCase();
  const isPast = isPastDateTime(item?.fim || item?.inicio, nowTs);
  const effectiveStatus = normalizeAppointmentStatus(rawStatus, { isPast });
  const pendingDeposit =
    rawStatus === 'pendente_pagamento' || effectiveStatus === 'pendente_pagamento';
  const depositExpiresAtTs = item?.deposit_expires_at ? getTimestamp(item.deposit_expires_at) : 0;
  const pendingDepositExpired = Boolean(
    pendingDeposit && depositExpiresAtTs && depositExpiresAtTs <= nowTs
  );

  return {
    ...item,
    serviceLabel: getServiceLabel(item),
    establishmentLabel: item?.estabelecimento_nome || 'Estabelecimento',
    whenLabel: formatDateTimeBr(item?.inicio),
    whenTooltip: formatDateTimeBr(item?.inicio, { includeYear: true, showRelative: false }),
    effectiveStatus,
    canCancel: rawStatus === 'confirmado' && !isPast,
    canPayDeposit: pendingDeposit && !pendingDepositExpired,
    pendingDepositExpired,
  };
}

function extractDepositPayload(response) {
  if (!response || typeof response !== 'object') return null;

  const paymentId =
    response.paymentId ||
    response.payment_id ||
    response?.deposit?.payment_id ||
    response?.payment?.id ||
    null;
  if (!paymentId) return null;

  const pix = response.pix || response.deposit?.pix || {};
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

  return {
    paymentId,
    appointmentId,
    expiresAt,
    amountCents,
    pix: {
      qr_code_base64: pix?.qr_code_base64 || response.pix_qr || null,
      qr_code: pix?.qr_code || response.pix_qr_raw || null,
      copia_e_cola: pix?.copia_e_cola || response.pix_copia_cola || pix?.qr_code || null,
      ticket_url: pix?.ticket_url || response.pix_ticket_url || null,
      expires_at: pix?.expires_at || null,
      amount_cents: pix?.amount_cents || null,
    },
  };
}

function resolveCancelErrorMessage(error) {
  const errData = error?.data || error?.response?.data || {};
  const errCode = String(errData.error || '');
  const serverMessage = errData.message || '';
  const fallbackMessage = error?.message || '';

  if (errCode.includes('cancel_forbidden_after_confirm') || /confirmado via whatsapp/i.test(fallbackMessage)) {
    return (
      serverMessage ||
      'Agendamento já foi confirmado via WhatsApp. Entre em contato com o estabelecimento.'
    );
  }
  if (errCode.includes('cancel_forbidden_time_limit')) {
    return serverMessage || 'Cancelamento não permitido próximo do horário.';
  }
  if (/forbidden|bloqueado|blocked/i.test(fallbackMessage)) {
    return fallbackMessage;
  }
  return serverMessage || 'Não foi possível cancelar agora. Tente novamente.';
}

function DetailsField({ label, value }) {
  return (
    <div className="tw-rounded-lg tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-3">
      <p className="tw-m-0 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-500">{label}</p>
      <p className="tw-m-0 tw-mt-1 tw-text-sm tw-font-semibold tw-text-slate-800">{value || '-'}</p>
    </div>
  );
}

export default function ClientAppointmentsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [depositLoadingId, setDepositLoadingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [detailsModal, setDetailsModal] = useState({
    open: false,
    loading: false,
    item: null,
    error: '',
  });
  const [depositModal, setDepositModal] = useState(DEFAULT_DEPOSIT_MODAL);

  const showToast = useCallback((type, message) => {
    setToast({ id: Date.now(), type, message });
  }, []);

  useEffect(() => {
    if (!toast?.id) return undefined;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await Api.meusAgendamentos();
      setItems(Array.isArray(data) ? data : []);
    } catch (fetchError) {
      setError(fetchError?.data?.message || 'Não foi possível carregar seus agendamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const appointments = useMemo(() => {
    const nowTs = Date.now();
    return [...items]
      .sort((a, b) => getTimestamp(b?.inicio) - getTimestamp(a?.inicio))
      .map((item) => decorateAppointment(item, nowTs));
  }, [items]);

  const filteredAppointments = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    return appointments.filter((item) => {
      const matchesStatus =
        statusFilter === 'todos'
          ? true
          : statusFilter === 'pendente'
            ? ['pendente', 'pendente_pagamento'].includes(item.effectiveStatus)
            : item.effectiveStatus === statusFilter;

      const matchesSearch =
        !normalizedSearch ||
        normalizeText(`${item.serviceLabel} ${item.establishmentLabel}`).includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [appointments, search, statusFilter]);

  const isBaseEmpty = appointments.length === 0;

  const openNewAppointment = useCallback(() => {
    navigate(NEW_APPOINTMENT_ROUTE);
  }, [navigate]);

  const openDetails = useCallback(async (appointment) => {
    const base = decorateAppointment(appointment);
    setDetailsModal({ open: true, loading: true, item: base, error: '' });
    try {
      const data = await Api.getAgendamento(appointment.id);
      setDetailsModal({
        open: true,
        loading: false,
        item: decorateAppointment({ ...appointment, ...data }),
        error: '',
      });
    } catch (detailsError) {
      setDetailsModal((prev) => ({
        ...prev,
        loading: false,
        error: detailsError?.data?.message || 'Não foi possível carregar os detalhes completos.',
      }));
    }
  }, []);

  const closeDetails = useCallback(() => {
    setDetailsModal({ open: false, loading: false, item: null, error: '' });
  }, []);

  const closeDepositModal = useCallback(() => {
    setDepositModal(DEFAULT_DEPOSIT_MODAL);
  }, []);

  const openDepositModal = useCallback((payload) => {
    if (!payload?.paymentId) return;
    setDepositModal({
      open: true,
      paymentId: payload.paymentId,
      appointmentId: payload.appointmentId || null,
      expiresAt: payload.expiresAt || null,
      amountCents: payload.amountCents ?? null,
      pix: payload.pix || null,
    });
  }, []);

  const handlePayDeposit = useCallback(
    async (appointment) => {
      if (!appointment?.id) return;
      setDepositLoadingId(appointment.id);
      try {
        const response = await Api.agendamentoDepositPix(appointment.id);
        const payload = extractDepositPayload(response);
        if (!payload) {
          showToast('error', 'PIX indisponível para este agendamento.');
          return;
        }
        openDepositModal(payload);
        setItems((current) =>
          current.map((item) =>
            item.id === appointment.id
              ? {
                  ...item,
                  status: 'pendente_pagamento',
                  deposit_expires_at:
                    response?.deposit_expires_at || response?.expiresAt || item.deposit_expires_at,
                }
              : item
          )
        );
      } catch (payError) {
        if (payError?.data?.error === 'deposit_canceled_requires_new_booking') {
          showToast(
            'error',
            payError?.data?.message || 'Esse agendamento foi cancelado por falta de pagamento.'
          );
          navigate(NEW_APPOINTMENT_ROUTE);
        } else {
          showToast(
            'error',
            payError?.data?.message || payError?.message || 'Não foi possível gerar o PIX.'
          );
        }
      } finally {
        setDepositLoadingId(null);
      }
    },
    [navigate, openDepositModal, showToast]
  );

  const requestCancel = useCallback((appointment) => {
    setCancelTarget(appointment);
  }, []);

  const closeCancelModal = useCallback(() => {
    if (cancelLoading) return;
    setCancelTarget(null);
  }, [cancelLoading]);

  const confirmCancel = useCallback(async () => {
    if (!cancelTarget?.id) return;
    setCancelLoading(true);
    try {
      await Api.cancelarAgendamento(cancelTarget.id);
      setItems((current) =>
        current.map((item) =>
          item.id === cancelTarget.id ? { ...item, status: 'cancelado' } : item
        )
      );
      setCancelTarget(null);
      showToast('success', 'Agendamento cancelado com sucesso.');
    } catch (cancelError) {
      showToast('error', resolveCancelErrorMessage(cancelError));
    } finally {
      setCancelLoading(false);
    }
  }, [cancelTarget, showToast]);

  const depositExpired =
    depositModal.open &&
    depositModal.expiresAt &&
    getTimestamp(depositModal.expiresAt) <= Date.now();

  const depositPixCode = depositModal?.pix?.copia_e_cola || depositModal?.pix?.qr_code || '';
  const depositQrBase64 = depositModal?.pix?.qr_code_base64 || '';
  const depositTicketUrl = depositModal?.pix?.ticket_url || '';
  const depositAmountLabel =
    typeof depositModal?.amountCents === 'number'
      ? (depositModal.amountCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
      : '';

  return (
    <>
      <div
        className="tw-mx-auto tw-min-h-full tw-w-full tw-max-w-6xl tw-min-w-0 tw-space-y-5 tw-rounded-2xl tw-bg-slate-50 tw-px-4 tw-py-4 tw-pb-40 md:tw-px-6 md:tw-pb-0"
      >
        <section className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-4 tw-shadow-sm md:tw-p-6">
          <div className="tw-flex tw-flex-col tw-gap-4 md:tw-flex-row md:tw-items-end md:tw-justify-between">
            <div>
              <h1 className="tw-m-0 tw-text-2xl tw-font-semibold tw-text-slate-900">Meus Agendamentos</h1>
              <p className="tw-m-0 tw-mt-1 tw-text-sm tw-text-slate-500">
                Acompanhe seus horários e status
              </p>
            </div>

            <div className="tw-grid tw-w-full tw-gap-3 sm:tw-grid-cols-2 md:tw-w-auto md:tw-grid-cols-[12rem_16rem_auto]">
              <label className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-font-medium tw-text-slate-500">
                Status
                <select
                  className="tw-h-10 tw-rounded-xl tw-border tw-border-slate-200 tw-bg-white tw-px-3 tw-text-sm tw-text-slate-700 focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-indigo-200 focus-visible:tw-ring-offset-2"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filtrar agendamentos por status"
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-font-medium tw-text-slate-500">
                Buscar
                <span className="tw-relative tw-flex tw-items-center">
                  <IconSearch className="tw-pointer-events-none tw-absolute tw-left-3 tw-h-4 tw-w-4 tw-text-slate-400" aria-hidden="true" />
                  <input
                    className="tw-h-10 tw-w-full tw-rounded-xl tw-border tw-border-slate-200 tw-bg-white tw-pl-9 tw-pr-3 tw-text-sm tw-text-slate-700 tw-placeholder:text-slate-400 focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-indigo-200 focus-visible:tw-ring-offset-2"
                    placeholder="Serviço ou estabelecimento"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Buscar por serviço ou estabelecimento"
                  />
                </span>
              </label>

              <Button
                variant="primary"
                className="tw-hidden md:tw-inline-flex"
                onClick={openNewAppointment}
                aria-label="Criar novo agendamento"
              >
                <IconPlus className="tw-h-4 tw-w-4" aria-hidden="true" />
                Novo agendamento
              </Button>
            </div>
          </div>

          <div className="tw-mt-4 tw-flex tw-gap-2 tw-overflow-x-auto tw-pb-1 tw-[scrollbar-width:none] tw-[-ms-overflow-style:none] [&::-webkit-scrollbar]:tw-hidden md:tw-hidden">
            {MOBILE_FILTER_CHIPS.map((chip) => {
              const selected = statusFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => setStatusFilter(chip.value)}
                  className={`tw-whitespace-nowrap tw-rounded-full tw-border tw-px-3 tw-py-1.5 tw-text-sm tw-font-semibold tw-transition-colors tw-duration-150 focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-slate-300 focus-visible:tw-ring-offset-2 ${
                    selected
                      ? 'tw-border-slate-900 tw-bg-slate-900 tw-text-white'
                      : 'tw-border-slate-200 tw-bg-white tw-text-slate-600 hover:tw-bg-slate-50'
                  }`}
                  aria-pressed={selected}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </section>

      {loading && <SkeletonList count={6} />}

      {!loading && error && (
        <section className="tw-rounded-2xl tw-border tw-border-rose-200 tw-bg-rose-50 tw-p-5 tw-shadow-sm">
          <h2 className="tw-m-0 tw-text-base tw-font-semibold tw-text-rose-800">Erro ao carregar</h2>
          <p className="tw-m-0 tw-mt-1 tw-text-sm tw-text-rose-700">{error}</p>
          <Button variant="secondaryOutline" className="tw-mt-4" onClick={fetchAppointments}>
            Tentar novamente
          </Button>
        </section>
      )}

      {!loading && !error && filteredAppointments.length === 0 && (
        <EmptyState
          title={isBaseEmpty ? 'Você ainda não tem agendamentos' : 'Nenhum agendamento encontrado'}
          description={
            isBaseEmpty
              ? 'Quando você agendar um horário, ele aparecerá aqui com todos os status e ações.'
              : 'Tente ajustar os filtros ou buscar por outro serviço/estabelecimento.'
          }
          ctaLabel={isBaseEmpty ? 'Agendar agora' : 'Limpar filtros'}
          onCta={
            isBaseEmpty
              ? openNewAppointment
              : () => {
                  setSearch('');
                  setStatusFilter('todos');
                }
          }
        />
      )}

      {!loading && !error && filteredAppointments.length > 0 && (
        <>
          <AppointmentTable
            appointments={filteredAppointments}
            onCancel={requestCancel}
            onDetails={openDetails}
            onPayDeposit={handlePayDeposit}
            payLoadingId={depositLoadingId}
          />
          <AppointmentCardList
            appointments={filteredAppointments}
            onCancel={requestCancel}
            onDetails={openDetails}
            onPayDeposit={handlePayDeposit}
            payLoadingId={depositLoadingId}
          />
        </>
      )}


      <ConfirmModal
        open={Boolean(cancelTarget)}
        title="Cancelar agendamento"
        description="Tem certeza que deseja cancelar este agendamento? Essa ação não pode ser desfeita."
        cancelLabel="Voltar"
        confirmLabel="Confirmar cancelamento"
        loading={cancelLoading}
        onCancel={closeCancelModal}
        onConfirm={confirmCancel}
      />

      {detailsModal.open && (
        <Modal
          title="Detalhes do agendamento"
          onClose={closeDetails}
          closeButton
          actions={[
            detailsModal.item?.canPayDeposit ? (
              <Button
                key="pay"
                variant="warning"
                onClick={() => handlePayDeposit(detailsModal.item)}
                disabled={depositLoadingId === detailsModal.item?.id}
              >
                {depositLoadingId === detailsModal.item?.id ? 'Carregando...' : 'Pagar sinal'}
              </Button>
            ) : null,
            <Button key="close" variant="secondaryOutline" onClick={closeDetails}>
              Fechar
            </Button>,
          ].filter(Boolean)}
        >
          {detailsModal.loading ? (
            <div className="tw-space-y-2">
              <div className="tw-h-4 tw-w-2/3 tw-animate-pulse tw-rounded tw-bg-slate-200" />
              <div className="tw-h-4 tw-w-1/2 tw-animate-pulse tw-rounded tw-bg-slate-200" />
            </div>
          ) : (
            <div className="tw-space-y-4">
              {detailsModal.error && (
                <div className="tw-rounded-lg tw-border tw-border-amber-200 tw-bg-amber-50 tw-p-3 tw-text-sm tw-text-amber-800">
                  {detailsModal.error}
                </div>
              )}
              <div className="tw-grid tw-gap-3 sm:tw-grid-cols-2">
                <DetailsField label="Serviço" value={detailsModal.item?.serviceLabel} />
                <DetailsField label="Estabelecimento" value={detailsModal.item?.establishmentLabel} />
                <DetailsField label="Quando" value={detailsModal.item?.whenTooltip || detailsModal.item?.whenLabel} />
                <div className="tw-rounded-lg tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-3">
                  <p className="tw-m-0 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-500">Status</p>
                  <div className="tw-mt-1">
                    <StatusBadge status={detailsModal.item?.effectiveStatus} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {depositModal.open && (
        <Modal
          title="Pagamento do sinal via PIX"
          onClose={closeDepositModal}
          closeButton
          actions={[
            !depositExpired && depositTicketUrl ? (
              <a
                key="open"
                className={buttonClassName('primary')}
                href={depositTicketUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no app do banco
              </a>
            ) : null,
            <Button key="close" variant="secondaryOutline" onClick={closeDepositModal}>
              Fechar
            </Button>,
          ].filter(Boolean)}
        >
          <div className="tw-space-y-4">
            <div
              className={`tw-rounded-lg tw-border tw-p-3 tw-text-sm ${
                depositExpired
                  ? 'tw-border-rose-200 tw-bg-rose-50 tw-text-rose-700'
                  : 'tw-border-amber-200 tw-bg-amber-50 tw-text-amber-700'
              }`}
              role="status"
              aria-live="polite"
            >
              {depositExpired
                ? 'Tempo esgotado, agendamento cancelado.'
                : 'Aguardando pagamento do sinal.'}
            </div>
            {depositAmountLabel && (
              <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-slate-800">
                Valor do sinal: {depositAmountLabel}
              </p>
            )}
            {depositQrBase64 ? (
              <img
                src={`data:image/png;base64,${depositQrBase64}`}
                alt="QR Code PIX"
                className="tw-mx-auto tw-max-h-64 tw-w-full tw-max-w-xs tw-rounded-xl tw-border tw-border-slate-200 tw-bg-white tw-p-3"
              />
            ) : (
              <p className="tw-m-0 tw-text-sm tw-text-slate-500">Abra o link para visualizar o QR Code.</p>
            )}
            {depositPixCode && (
              <label className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-font-medium tw-text-slate-500">
                Chave copia e cola
                <textarea
                  readOnly
                  value={depositPixCode}
                  rows={3}
                  className="tw-w-full tw-rounded-lg tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-2 tw-text-sm tw-text-slate-700 focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-indigo-200 focus-visible:tw-ring-offset-2"
                />
              </label>
            )}
            {depositModal?.expiresAt && (
              <p className="tw-m-0 tw-text-sm tw-text-slate-500">
                Expira em {formatDateTimeBr(depositModal.expiresAt, { includeYear: true, showRelative: false })}
              </p>
            )}
          </div>
        </Modal>
      )}
      </div>

      <Button
        variant="fab"
        className="tw-fixed tw-right-4 tw-bottom-[88px] tw-z-50 md:tw-hidden"
        onClick={openNewAppointment}
        aria-label="Novo agendamento"
      >
        <IconPlus className="tw-h-6 tw-w-6" aria-hidden="true" />
      </Button>

      {toast && (
        <div
          className={`tw-fixed tw-right-4 tw-z-50 tw-max-w-sm tw-rounded-xl tw-border tw-px-4 tw-py-3 tw-shadow-lg tw-relative ${
            toast.type === 'success'
              ? 'tw-border-emerald-200 tw-bg-emerald-50 tw-text-emerald-800'
              : 'tw-border-rose-200 tw-bg-rose-50 tw-text-rose-800'
          }`}
          style={{ bottom: '5.5rem' }}
          role="status"
          aria-live="polite"
        >
          <p className="tw-m-0 tw-pr-6 tw-text-sm tw-font-medium">{toast.message}</p>
          <button
            type="button"
            className="tw-absolute tw-right-2 tw-top-1.5 tw-rounded-md tw-border-0 tw-bg-transparent tw-text-lg tw-leading-none tw-text-current focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-slate-300 focus-visible:tw-ring-offset-2"
            onClick={() => setToast(null)}
            aria-label="Fechar aviso"
          >
            x
          </button>
        </div>
      )}
    </>
  );
}


