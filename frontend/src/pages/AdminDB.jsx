// src/pages/AdminDB.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL as API_BASE } from '../utils/api'

export default function AdminDB(){
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('admin_token') || '' } catch { return '' }
  })
  const [tables,setTables] = useState([])
  const [current,setCurrent] = useState('')
  const [columns,setColumns] = useState([])
  const [rows,setRows] = useState([])
  const [count,setCount] = useState(0)
  const [limit,setLimit] = useState(50)
  const [offset,setOffset] = useState(0)
  const [order,setOrder] = useState('id DESC')
  const [sql,setSql] = useState('SELECT id, nome, telefone, email, tipo, plan, plan_status FROM usuarios ORDER BY id DESC LIMIT 50')
  const [execResult,setExecResult] = useState(null)
  const [error,setError] = useState('')
  const [write,setWrite] = useState(false)

  const headers = useMemo(() => ({ 'X-Admin-Token': token, ...(write ? { 'X-Admin-Allow-Write': '1' } : {}) }), [token, write])

  async function loadTables(){
    setError('')
    try{
      const res = await fetch(`${API_BASE}/admin/db/tables`, { headers })
      const data = await res.json()
      if(!res.ok) throw new Error(data?.message || data?.error || 'Falha ao listar tabelas')
      setTables(data.tables||[])
    }catch(e){ setError(e.message) }
  }
  async function loadTable(name){
    setError(''); setCurrent(name); setColumns([]); setRows([]); setCount(0); setOffset(0)
    try{
      const [cRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/admin/db/table/${encodeURIComponent(name)}/columns`, { headers }),
        fetch(`${API_BASE}/admin/db/table/${encodeURIComponent(name)}/rows?limit=${limit}&offset=0&order=${encodeURIComponent(order)}`, { headers }),
      ])
      const cData = await cRes.json(); const rData = await rRes.json()
      if(!cRes.ok) throw new Error(cData?.message || cData?.error)
      if(!rRes.ok) throw new Error(rData?.message || rData?.error)
      setColumns(cData.columns||[]); setRows(rData.rows||[]); setCount(rData.total||0)
    }catch(e){ setError(e.message) }
  }
  async function page(delta){
    const next = Math.max(0, offset + delta)
    setOffset(next)
    try{
      const res = await fetch(`${API_BASE}/admin/db/table/${encodeURIComponent(current)}/rows?limit=${limit}&offset=${next}&order=${encodeURIComponent(order)}`, { headers })
      const data = await res.json(); if(!res.ok) throw new Error(data?.message || data?.error)
      setRows(data.rows||[]); setCount(data.total||0)
    }catch(e){ setError(e.message) }
  }
  async function exec(){
    setError(''); setExecResult(null)
    try{
      const res = await fetch(`${API_BASE}/admin/db/exec`, { method:'POST', headers: { ...headers, 'Content-Type':'application/json' }, body: JSON.stringify({ sql }) })
      const data = await res.json(); if(!res.ok) throw new Error(data?.message || data?.error)
      setExecResult(data)
    }catch(e){ setError(e.message) }
  }

  useEffect(()=>{ try { localStorage.setItem('admin_token', token || '') } catch{} }, [token])

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Administração de Banco</h2>
        <div className="row" style={{ gap: 8, flexWrap:'wrap' }}>
          <input className="input" placeholder="X-Admin-Token" value={token} onChange={e=>setToken(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn" onClick={loadTables}>Listar Tabelas</button>
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tabelas</h3>
        <div className="row" style={{ gap: 8, flexWrap:'wrap' }}>
          {tables.map(t => (
            <button key={t} className={`btn btn--outline${current===t?' active':''}`} onClick={()=>loadTable(t)}>{t}</button>
          ))}
        </div>
      </div>

      {current && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{current}</h3>
          <div className="small muted">Colunas</div>
          <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(columns, null, 2)}</pre>
          <div className="row" style={{ gap: 8, alignItems:'center' }}>
            <label className="label">Order <input className="input" value={order} onChange={e=>setOrder(e.target.value)} style={{ minWidth: 160 }} /></label>
            <label className="label">Limit <input className="input" type="number" value={limit} onChange={e=>setLimit(Number(e.target.value)||50)} style={{ width: 100 }} /></label>
            <button className="btn" onClick={()=>loadTable(current)}>Atualizar</button>
            <span className="small muted">Total: {count}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={()=>page(-limit)} disabled={offset<=0}>Anterior</button>
            <button className="btn" onClick={()=>page(limit)} disabled={offset+limit>=count}>Próxima</button>
          </div>
          <div className="small muted">Linhas</div>
          <pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(rows, null, 2)}</pre>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Executar SQL</h3>
        <textarea className="input" rows={6} value={sql} onChange={e=>setSql(e.target.value)} />
        <label className="config-toggle"><input type="checkbox" checked={write} onChange={e=>setWrite(e.target.checked)} /> <span>Permitir alterações (INSERT/UPDATE/DELETE...)</span></label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--primary" onClick={exec}>Executar</button>
        </div>
        {execResult && (
          <pre style={{ whiteSpace:'pre-wrap', marginTop: 8 }}>{JSON.stringify(execResult, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}
