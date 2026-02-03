// src/pages/DashboardCliente.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Api } from '../utils/api';

export default function DashboardCliente() {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('todos');

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
    return { cls: 'pending', label: s ? s : 'Pendente' };
  };

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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
