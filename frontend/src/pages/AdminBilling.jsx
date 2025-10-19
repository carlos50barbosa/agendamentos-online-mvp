// src/pages/AdminBilling.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL as API_BASE } from '../utils/api'

export default function AdminBilling(){
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('admin_token') || '' } catch { return '' }
  })
  const [events, setEvents] = useState([])
  const [subs, setSubs] = useState([])
  const [limit, setLimit] = useState(50)
  const [error, setError] = useState('')
  const headers = useMemo(() => ({ 'X-Admin-Token': token }), [token])

  async function load(){
    setError('')
    try {
      const [eRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/admin/billing/events?limit=${limit}`, { headers }),
        fetch(`${API_BASE}/admin/billing/subscriptions?limit=${limit}`, { headers }),
      ])
      const eData = await eRes.json(); const sData = await sRes.json()
      if(!eRes.ok) throw new Error(eData?.message || eData?.error || 'Falha ao listar eventos')
      if(!sRes.ok) throw new Error(sData?.message || sData?.error || 'Falha ao listar assinaturas')
      setEvents(eData.events || [])
      setSubs(sData.subscriptions || [])
    } catch (e) { setError(e.message) }
  }

  useEffect(()=>{ try { localStorage.setItem('admin_token', token || '') } catch{} }, [token])

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Admin Billing</h2>
        <div className="row" style={{ gap: 8, flexWrap:'wrap' }}>
          <input className="input" placeholder="X-Admin-Token" value={token} onChange={e=>setToken(e.target.value)} style={{ minWidth: 260 }} />
          <label className="label">Limite <input className="input" type="number" value={limit} onChange={e=>setLimit(Math.max(1, Math.min(500, Number(e.target.value)||50)))} style={{ width: 100 }} /></label>
          <button className="btn" onClick={load}>Atualizar</button>
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Eventos recentes</h3>
        <div className="small muted">subscription_events + subscriptions</div>
        <div className="table" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Quando</th>
                <th>Evento</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Subscr.</th>
                <th>Estab</th>
                <th>Plano</th>
                <th>Cycle</th>
                <th>Gateway ID</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id}>
                  <td>{ev.id}</td>
                  <td>{ev.created_at ? new Date(ev.created_at).toLocaleString('pt-BR') : ''}</td>
                  <td>{ev.event_type}</td>
                  <td>{ev.kind || ''}</td>
                  <td>{ev.status || ''}</td>
                  <td style={{ maxWidth: 260, overflow:'hidden', textOverflow:'ellipsis' }} title={ev.status_detail || ''}>{ev.status_detail || ''}</td>
                  <td>{ev.subscription_id}</td>
                  <td>{ev.estabelecimento_id} {ev.estab_nome ? `– ${ev.estab_nome}` : ''}</td>
                  <td>{ev.plan}</td>
                  <td>{ev.billing_cycle || ''}</td>
                  <td style={{ maxWidth: 260, overflow:'hidden', textOverflow:'ellipsis' }} title={ev.gateway_event_id || ''}>{ev.gateway_event_id || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Assinaturas recentes</h3>
        <div className="table" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Estab</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Cycle</th>
                <th>Valor</th>
                <th>Gateway</th>
                <th>Subscr ID</th>
                <th>Pref ID</th>
                <th>Criado</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.estabelecimento_id} {s.estab_nome ? `– ${s.estab_nome}` : ''}</td>
                  <td>{s.plan}</td>
                  <td>{s.status}</td>
                  <td>{s.billing_cycle}</td>
                  <td>{typeof s.amount_cents === 'number' ? (s.amount_cents/100).toLocaleString('pt-BR', { style:'currency', currency: s.currency||'BRL' }) : ''}</td>
                  <td>{s.gateway}</td>
                  <td style={{ maxWidth: 200, overflow:'hidden', textOverflow:'ellipsis' }} title={s.gateway_subscription_id || ''}>{s.gateway_subscription_id || ''}</td>
                  <td style={{ maxWidth: 200, overflow:'hidden', textOverflow:'ellipsis' }} title={s.gateway_preference_id || ''}>{s.gateway_preference_id || ''}</td>
                  <td>{s.created_at ? new Date(s.created_at).toLocaleString('pt-BR') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
