import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Api } from '../utils/api'
import { IconBell } from '../components/Icons.jsx'

export default function DashboardEstabelecimento(){
  const [itens,setItens]=useState([])
  const [loading,setLoading]=useState(true)
  const [status,setStatus]=useState('confirmado') // confirmados por padrão

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

  const abbrName = useCallback((name) => {
    // Mantido para compatibilidade, mas não abreviamos mais no render.
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0] || '';
    return `${first} ${lastInitial}.`;
  }, []);

  useEffect(()=>{
    let mounted = true
    setLoading(true)
    const reqStatus = status === 'todos' ? 'todos' : (status === 'concluido' ? 'confirmado' : status)
    Api.agendamentosEstabelecimento(reqStatus)
      .then(data => { if(mounted) setItens(Array.isArray(data)?data:[]) })
      .catch(()=>{ if(mounted) setItens([]) })
      .finally(()=>{ if(mounted) setLoading(false) })
    return ()=>{ mounted=false }
  },[status])

  const statusMeta = (s) => {
    const v = String(s||'').toLowerCase()
    if (v==='confirmado') return { cls:'ok', label:'confirmado' }
    if (v==='concluido') return { cls:'done', label:'concluído' }
    if (v==='cancelado') return { cls:'out', label:'cancelado' }
    return { cls:'pending', label: v||'pendente' }
  }

  const totals = useMemo(()=>{
    const acc = { recebidos: 0, cancelados: 0 }
    for (const item of itens) {
      const st = String(item?.status || '').toLowerCase()
      if (st === 'confirmado' || st === 'pendente') acc.recebidos += 1
      if (st === 'cancelado') acc.cancelados += 1
    }
    return acc
  }, [itens])

  const shown = React.useMemo(()=>{
    if (status !== 'concluido') return itens
    return itens.filter(i => new Date(i.fim || i.inicio).getTime() < Date.now())
  }, [itens, status])
  return (
    <div className="dashboard-narrow">
    <div className="card">
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Agendamentos</h2>
          <div className="notif-bell" title="Notificações de agendamentos">
            <IconBell className="notif-bell__icon" aria-hidden="true" />
            <span className="notif-bell__pill">Recebidos {totals.recebidos}</span>
            <span className="notif-bell__pill notif-bell__pill--cancel">Cancelados {totals.cancelados}</span>
          </div>
        </div>
        <select className="input" value={status} onChange={e=>setStatus(e.target.value)} title="Status">
          <option value="confirmado">Confirmados</option>
          <option value="concluido">Concluídos</option>
          <option value="cancelado">Cancelados</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {loading ? (
        <div className="day-skeleton" style={{ gridTemplateColumns: '1fr', marginTop: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="shimmer pill" />))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">Nenhum agendamento nesta visão.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Agendamento</th>
              <th>Início</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(i=>{
               const past = new Date(i.fim || i.inicio).getTime() < Date.now()
               const effective = (String(i.status||'').toLowerCase()==='confirmado' && past) ? 'concluido' : i.status
               const { cls, label } = statusMeta(effective)
               return (
                 <tr key={i.id}>
                  <td>
                    <div style={{ fontWeight: 600, lineHeight: 1.05 }}>{i.servico_nome}</div>
                    <div className="small muted" style={{ lineHeight: 1.05 }}>
                      <span className="name-short" title={i.cliente_nome}>{i.cliente_nome}</span>
                    </div>
                  </td>
                  <td title={new Date(i.inicio).toLocaleString('pt-BR')}>{fmt.format(new Date(i.inicio))}</td>
                  <td><span className={`badge ${cls}`}>{label}</span></td>
                  <td></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
    </div>
  )
}
