// src/pages/DashboardCliente.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Api } from '../utils/api';
import Modal from '../components/Modal.jsx';

export default function DashboardCliente() {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('todos');
  const [depositModal, setDepositModal] = useState({
    open: false,
    status: 'pending',
    paymentId: null,
    appointmentId: null,
    expiresAt: null,
    amountCents: null,
    pix: null,
  });
  const [depositLoadingId, setDepositLoadingId] = useState(null);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    []
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await Api.meusAgendamentos();
        if (mounted) setItens(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setItens([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const abbrName = useCallback((name) => {
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0] || '';
    return `${first} ${lastInitial}.`;
  }, []);

  const statusMeta = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'confirmado') return { cls: 'ok', label: 'Confirmado' };
    if (s === 'concluido') return { cls: 'done', label: 'Concluído' };
    if (s === 'cancelado') return { cls: 'out', label: 'Cancelado' };
    if (s === 'pendente_pagamento') return { cls: 'pending', label: 'Aguardando pagamento' };
    return { cls: 'pending', label: s ? s : 'Pendente' };
  };

  const depositExpired =
    depositModal.open &&
    depositModal.expiresAt &&
    new Date(depositModal.expiresAt).getTime() <= Date.now();
  const depositStatusTone = depositExpired ? 'error' : 'pending';
  const depositStatusText = depositExpired
    ? 'Tempo esgotado, agendamento cancelado'
    : 'Aguardando pagamento do sinal';
  const depositStatusIcon = depositExpired ? '!' : '...';
  const depositPixCode = depositModal?.pix?.copia_e_cola || depositModal?.pix?.qr_code || '';
  const depositQrBase64 = depositModal?.pix?.qr_code_base64 || '';
  const depositTicketUrl = depositModal?.pix?.ticket_url || '';
  const depositAmountLabel =
    typeof depositModal?.amountCents === 'number'
      ? (depositModal.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '';

  const extractDepositPayload = useCallback((response) => {
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
  }, []);

  const openDepositModal = useCallback((payload) => {
    if (!payload?.paymentId) return;
    setDepositModal({
      open: true,
      status: 'pending',
      paymentId: payload.paymentId,
      appointmentId: payload.appointmentId || null,
      expiresAt: payload.expiresAt || null,
      amountCents: payload.amountCents ?? null,
      pix: payload.pix || null,
    });
  }, []);

  const closeDepositModal = useCallback(() => {
    setDepositModal({
      open: false,
      status: 'pending',
      paymentId: null,
      appointmentId: null,
      expiresAt: null,
      amountCents: null,
      pix: null,
    });
  }, []);

  const handleDepositPix = useCallback(async (item) => {
    if (!item?.id) return;
    setDepositLoadingId(item.id);
    try {
      const response = await Api.agendamentoDepositPix(item.id);
      const payload = extractDepositPayload(response);
      if (!payload) {
        alert('PIX indisponível para este agendamento.');
        return;
      }
      openDepositModal(payload);
      setItens((xs) =>
        xs.map((y) =>
          y.id === item.id
            ? {
                ...y,
                status: 'pendente_pagamento',
                deposit_expires_at: response?.deposit_expires_at || response?.expiresAt || y.deposit_expires_at,
              }
            : y
        )
      );
    } catch (e) {
      const msg = e?.data?.message || e?.message || 'Não foi possível gerar o PIX.';
      alert(msg);
    } finally {
      setDepositLoadingId(null);
    }
  }, [extractDepositPayload, openDepositModal]);

  const cancelar = async (id) => {
    const ok = window.confirm('Cancelar este agendamento?');
    if (!ok) return;
    try {
      await Api.cancelarAgendamento(id);
      setItens((xs) => xs.map((y) => (y.id === id ? { ...y, status: 'cancelado' } : y)));
    } catch (e) {
      const errData = e?.data || e?.response?.data || {};
      const errCode = String(errData.error || '');
      const serverMsg = errData.message || '';
      const msg = serverMsg || e?.message || '';
      const blockedMsg = 'Agendamento já foi confirmado via WhatsApp. Se precisar de ajuda, entre em contato com o estabelecimento.';
      if (errCode.includes('cancel_forbidden_after_confirm') || /confirmado via whatsapp/i.test(msg)) {
        alert(serverMsg || blockedMsg);
      } else if (errCode.includes('cancel_forbidden_time_limit')) {
        alert(serverMsg || 'Cancelamento não permitido próximo do horário.');
      } else if (/forbidden|bloqueado|blocked/i.test(msg)) {
        alert(msg);
      } else {
        alert('Não foi possível cancelar. Tente novamente ou contate o estabelecimento.');
      }
    }
  };

  // filtro em memória por status (considera "concluído" quando horário já passou)
  const filtrados = useMemo(() => {
    const s = String(status||'').toLowerCase();
    if (s === 'todos') return itens;
    return itens.filter(i => {
      const past = new Date(i.fim || i.inicio).getTime() < Date.now();
      const eff = (String(i.status||'').toLowerCase()==='confirmado' && past) ? 'concluido' : String(i.status||'').toLowerCase();
      return eff === s;
    });
  }, [itens, status]);

  return (
    <div className="dashboard-narrow">{/* <- wrapper que limita a largura no desktop */}
      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Meus Agendamentos</h2>
          <select className="input" value={status} onChange={e=>setStatus(e.target.value)} title="Status">
            <option value="confirmado">Confirmados</option>
            <option value="concluido">Concluídos</option>
            <option value="cancelado">Cancelados</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        {loading ? (
          <div className="day-skeleton" style={{ gridTemplateColumns: '1fr', marginTop: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shimmer pill" />
            ))}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="empty">Você ainda não tem agendamentos.</div>
        ) : (
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Agendamento</th>
                <th>Quando</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => {
                const past = new Date(i.fim || i.inicio).getTime() < Date.now();
                const effective = (String(i.status||'').toLowerCase() === 'confirmado' && past)
                   ? 'concluido'
                  : i.status;
                const canCancel = String(i.status||'').toLowerCase() === 'confirmado' && !past;
                const statusNorm = String(i.status || '').toLowerCase();
                const depositRequired = Number(i.deposit_required || 0) === 1;
                const pendingDeposit = statusNorm === 'pendente_pagamento';
                const canRegenerateDeposit = statusNorm === 'cancelado' && depositRequired && !i.deposit_paid_at;
                const { cls, label } = statusMeta(effective);
                const serviceNames = Array.isArray(i.servicos)
                   ? i.servicos.map((svc) => svc?.nome).filter(Boolean)
                  : [];
                const serviceLabel = serviceNames.length
                   ? serviceNames.join(' + ')
                  : (i.servico_nome || i.service_name || 'Servico');
                return (
                  <tr key={i.id}>
                    <td>
                      <div style={{ fontWeight: 600, lineHeight: 1.05 }}>{serviceLabel}</div>
                      <div className="small muted" style={{ lineHeight: 1.05 }}>
                        <span className="name-short" title={i.estabelecimento_nome}>{i.estabelecimento_nome}</span>
                      </div>
                    </td>
                    <td>
                      <span title={new Date(i.inicio).toLocaleString('pt-BR')}>
                        {fmt.format(new Date(i.inicio))}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${cls}`}>{label}</span>
                      {canCancel && (
                        <span className="only-mobile" style={{ marginTop: 6, marginLeft: 8 }}>
                          <button
                            className="btn btn--danger btn--sm danger"
                            onClick={() => cancelar(i.id)}
                          >
                            Cancelar
                          </button>
                        </span>
                      )}
                      {pendingDeposit && (
                        <span className="only-mobile" style={{ marginTop: 6, marginLeft: 8 }}>
                          <button
                            className="btn btn--primary btn--sm"
                            onClick={() => handleDepositPix(i)}
                            disabled={depositLoadingId === i.id}
                          >
                            {depositLoadingId === i.id ? 'Carregando...' : 'Ver PIX'}
                          </button>
                        </span>
                      )}
                      {canRegenerateDeposit && (
                        <span className="only-mobile" style={{ marginTop: 6, marginLeft: 8 }}>
                          <button
                            className="btn btn--primary btn--sm"
                            onClick={() => handleDepositPix(i)}
                            disabled={depositLoadingId === i.id}
                          >
                            {depositLoadingId === i.id ? 'Carregando...' : 'Gerar novo PIX'}
                          </button>
                        </span>
                      )}
                    </td>
                    <td>
                      {canCancel && (
                        <button
                          className="btn btn--danger btn--sm danger"
                          onClick={() => cancelar(i.id)}
                        >
                          Cancelar
                        </button>
                      )}
                      {pendingDeposit && (
                        <button
                          className="btn btn--primary btn--sm"
                          onClick={() => handleDepositPix(i)}
                          disabled={depositLoadingId === i.id}
                          style={{ marginLeft: canCancel ? 8 : 0 }}
                        >
                          {depositLoadingId === i.id ? 'Carregando...' : 'Ver PIX'}
                        </button>
                      )}
                      {canRegenerateDeposit && (
                        <button
                          className="btn btn--primary btn--sm"
                          onClick={() => handleDepositPix(i)}
                          disabled={depositLoadingId === i.id}
                          style={{ marginLeft: canCancel ? 8 : 0 }}
                        >
                          {depositLoadingId === i.id ? 'Carregando...' : 'Gerar novo PIX'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {depositModal.open && (
        <Modal
          title="Pagamento do sinal via PIX"
          onClose={closeDepositModal}
          closeButton
          actions={[
            !depositExpired && depositTicketUrl ? (
              <a
                key="open"
                className="btn btn--primary"
                href={depositTicketUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no app do banco
              </a>
            ) : null,
            <button key="close" type="button" className="btn btn--outline" onClick={closeDepositModal}>
              Fechar
            </button>,
          ].filter(Boolean)}
        >
          <div className="pix-checkout">
            <div
              className={`pix-checkout__status pix-checkout__status--${depositStatusTone}`}
              role="status"
              aria-live="polite"
            >
              <div className="pix-checkout__status-main">
                <span className="pix-checkout__status-icon" aria-hidden="true">{depositStatusIcon}</span>
                <span>{depositStatusText}</span>
              </div>
            </div>
            {depositAmountLabel && (
              <div className="pix-checkout__amount">
                Valor do sinal: {depositAmountLabel}
              </div>
            )}
            {depositQrBase64 ? (
              <img
                src={`data:image/png;base64,${depositQrBase64}`}
                alt="QR Code PIX"
                className="pix-checkout__qr"
              />
            ) : (
              <p className="muted pix-checkout__hint">Abra o link acima para visualizar o QR Code.</p>
            )}
            {depositPixCode && (
              <div className="pix-checkout__code">
                <label htmlFor="deposit-pix-code">Chave copia e cola</label>
                <textarea id="deposit-pix-code" readOnly value={depositPixCode} rows={3} className="input" />
              </div>
            )}
            {depositModal?.expiresAt && (
              <p className="muted pix-checkout__expires">
                Expira em{' '}
                {new Date(depositModal.expiresAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
