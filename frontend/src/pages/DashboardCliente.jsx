// src/pages/DashboardCliente.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';

export default function DashboardCliente() {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const statusMeta = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'confirmado') return { cls: 'ok', label: 'Confirmado' };
    if (s === 'cancelado') return { cls: 'out', label: 'Cancelado' };
    return { cls: 'pending', label: s ? s : 'Pendente' };
  };

  const cancelar = async (id) => {
    const ok = window.confirm('Cancelar este agendamento?');
    if (!ok) return;
    await Api.cancelarAgendamento(id);
    setItens((xs) => xs.map((y) => (y.id === id ? { ...y, status: 'cancelado' } : y)));
  };

  return (
    <div className="dashboard-narrow">{/* <- wrapper que limita a largura no desktop */}
      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Meus Agendamentos</h2>
          {!loading && <small className="muted">{itens.length} no total</small>}
        </div>

        {loading ? (
          <div className="day-skeleton" style={{ gridTemplateColumns: '1fr', marginTop: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shimmer pill" />
            ))}
          </div>
        ) : itens.length === 0 ? (
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
              {itens.map((i) => {
                const { cls, label } = statusMeta(i.status);
                return (
                  <tr key={i.id}>
                    <td>
                      <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{i.servico_nome}</div>
                      <div className="small muted" style={{ lineHeight: 1.2 }}>{i.estabelecimento_nome}</div>
                    </td>
                    <td>
                      <span title={new Date(i.inicio).toLocaleString('pt-BR')}>
                        {fmt.format(new Date(i.inicio))}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${cls}`}>{label}</span>
                    </td>
                    <td>
                      {i.status?.toLowerCase() === 'confirmado' && (
                        <button className="btn btn--danger btn--sm danger" onClick={() => cancelar(i.id)}>
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
