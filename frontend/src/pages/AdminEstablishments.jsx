// src/pages/AdminEstablishments.jsx
// Panorama super-admin: todos os estabelecimentos com plano/status/vencimento + contagens.
import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL as API_BASE } from '../utils/api';

const STATUS_TONE = {
  active: 'success',
  trialing: 'info',
  pending: 'warning',
  pending_payment: 'warning',
  pending_pix: 'warning',
  past_due: 'warning',
  unpaid: 'danger',
  expired: 'danger',
  canceled: 'danger',
  cancelled: 'danger',
};

function toneColors(tone) {
  const map = {
    success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
    info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
    warning: { bg: '#fff7ed', border: '#fed7aa', color: '#9a3412' },
    danger: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
    neutral: { bg: '#f3f4f6', border: '#e5e7eb', color: '#374151' },
  };
  return map[tone] || map.neutral;
}

function StatusBadge({ status }) {
  const s = String(status || '').toLowerCase();
  const c = toneColors(STATUS_TONE[s] || 'neutral');
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: c.bg, border: `1px solid ${c.border}`, color: c.color, whiteSpace: 'nowrap' }}>
      {status || '—'}
    </span>
  );
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Cor do vencimento: vermelho se venceu, laranja se <= 7 dias, normal senao.
function dueStyle(value) {
  if (!value) return { color: 'inherit' };
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return { color: 'inherit' };
  const days = (t - Date.now()) / 86400000;
  if (days < 0) return { color: '#991b1b', fontWeight: 600 };
  if (days <= 7) return { color: '#9a3412', fontWeight: 600 };
  return { color: 'inherit' };
}

const SORTS = {
  nome: (a, b) => String(a.nome || '').localeCompare(String(b.nome || '')),
  vencimento: (a, b) => (new Date(a.plan_active_until || 0).getTime() || 0) - (new Date(b.plan_active_until || 0).getTime() || 0),
  agendamentos: (a, b) => (b.appointments?.total || 0) - (a.appointments?.total || 0),
  status: (a, b) => String(a.plan_status || '').localeCompare(String(b.plan_status || '')),
};

export default function AdminEstablishments() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('admin_token') || ''; } catch { return ''; }
  });
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('nome');

  useEffect(() => { try { localStorage.setItem('admin_token', token || ''); } catch {} }, [token]);

  async function load() {
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/establishments/overview`, { headers: { 'X-Admin-Token': token } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'Falha ao carregar panorama');
      setRows(Array.isArray(data.establishments) ? data.establishments : []);
      setMeta({ count: data.count, generated_at: data.generated_at });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = rows;
    if (term) {
      list = rows.filter((r) =>
        String(r.nome || '').toLowerCase().includes(term) ||
        String(r.email || '').toLowerCase().includes(term) ||
        String(r.id || '').includes(term));
    }
    return [...list].sort(SORTS[sort] || SORTS.nome);
  }, [rows, q, sort]);

  const totals = useMemo(() => {
    const t = { estab: rows.length, ativos: 0, agend: 0 };
    for (const r of rows) {
      if (String(r.plan_status || '').toLowerCase() === 'active') t.ativos += 1;
      t.agend += r.appointments?.total || 0;
    }
    return t;
  }, [rows]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Panorama dos estabelecimentos</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="password" placeholder="X-Admin-Token" value={token} onChange={(e) => setToken(e.target.value)} style={{ minWidth: 240 }} />
          <button className="btn btn--primary" onClick={load} disabled={!token || loading}>
            {loading ? <span className="spinner" /> : 'Carregar'}
          </button>
          <input className="input" placeholder="Buscar nome, e-mail ou ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
          <label className="label" style={{ margin: 0 }}>Ordenar
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="nome">Nome</option>
              <option value="vencimento">Vencimento</option>
              <option value="agendamentos">Agendamentos</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        {meta && (
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            {totals.estab} estabelecimentos · {totals.ativos} ativos · {totals.agend.toLocaleString('pt-BR')} agendamentos no total
            {q ? ` · ${filtered.length} no filtro` : ''}
          </div>
        )}
      </div>

      <div className="card">
        <div className="table" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Estabelecimento</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Vencimento</th>
                <th style={{ textAlign: 'right' }}>Profissionais</th>
                <th style={{ textAlign: 'right' }}>Serviços (ativos/inativos)</th>
                <th style={{ textAlign: 'right' }}>Agendamentos (mês)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div><strong>{r.nome || `#${r.id}`}</strong></div>
                    <div className="muted" style={{ fontSize: 12 }}>#{r.id} · {r.email || 'sem e-mail'}</div>
                  </td>
                  <td>{r.plan || '—'}<div className="muted" style={{ fontSize: 12 }}>{r.plan_cycle || ''}</div></td>
                  <td><StatusBadge status={r.plan_status} /></td>
                  <td style={dueStyle(r.plan_active_until)}>{fmtDate(r.plan_active_until)}</td>
                  <td style={{ textAlign: 'right' }}>{r.professionals?.active ?? 0}<span className="muted"> / {r.professionals?.total ?? 0}</span></td>
                  <td style={{ textAlign: 'right' }}>{r.services?.active ?? 0}<span className="muted"> / {r.services?.inactive ?? 0}</span></td>
                  <td style={{ textAlign: 'right' }}>{(r.appointments?.total ?? 0).toLocaleString('pt-BR')}<span className="muted"> ({r.appointments?.month ?? 0})</span></td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 16 }}>{loading ? 'Carregando…' : (rows.length ? 'Nenhum resultado para o filtro.' : 'Cole o token e clique em Carregar.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
