// src/pages/AdminEstablishments.jsx
// Panorama super-admin: todos os estabelecimentos com plano/status/vencimento + contagens.
import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Phone, Search, RefreshCw, Users, CheckCircle2, AlertTriangle, CalendarDays } from 'lucide-react';
import { API_BASE_URL as API_BASE } from '../utils/api';

// plan_status -> tom semantico (usa as variaveis do tema, logo acompanha claro/escuro).
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

const ATTENTION = new Set(['past_due', 'unpaid', 'expired', 'canceled', 'cancelled', 'pending', 'pending_payment', 'pending_pix']);

function StatusBadge({ status }) {
  const tone = STATUS_TONE[String(status || '').toLowerCase()] || 'neutral';
  const style = tone === 'neutral'
    ? { background: 'var(--card-2)', color: 'var(--muted)', boxShadow: 'inset 0 0 0 1px var(--border)' }
    : { background: `var(--${tone}-bg)`, color: `var(--${tone}-text)`, boxShadow: `inset 0 0 0 1px var(--${tone}-border)` };
  return <span className="ae-badge" style={style}>{status || '—'}</span>;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dueStyle(value) {
  if (!value) return undefined;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return undefined;
  const days = (t - Date.now()) / 86400000;
  if (days < 0) return { color: 'var(--danger-text)', fontWeight: 600 };
  if (days <= 7) return { color: 'var(--warning-text)', fontWeight: 600 };
  return undefined;
}

function formatPhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (!digits) return '';
  const n = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return String(v);
}

const SORTS = {
  nome: (a, b) => String(a.nome || '').localeCompare(String(b.nome || '')),
  vencimento: (a, b) => (new Date(a.plan_active_until || 0).getTime() || 0) - (new Date(b.plan_active_until || 0).getTime() || 0),
  agendamentos: (a, b) => (b.appointments?.total || 0) - (a.appointments?.total || 0),
  status: (a, b) => String(a.plan_status || '').localeCompare(String(b.plan_status || '')),
};

function Kpi({ icon: Icon, label, value, tone }) {
  return (
    <div className="ae-kpi">
      <div className="ae-kpi-icon" style={tone ? { background: `var(--${tone}-bg)`, color: `var(--${tone}-text)` } : undefined}>
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div>
        <div className="ae-kpi-label">{label}</div>
        <div className="ae-kpi-value">{value}</div>
      </div>
    </div>
  );
}

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
        String(r.telefone || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')) ||
        String(r.id || '').includes(term));
    }
    return [...list].sort(SORTS[sort] || SORTS.nome);
  }, [rows, q, sort]);

  const totals = useMemo(() => {
    const t = { estab: rows.length, ativos: 0, atencao: 0, agend: 0 };
    for (const r of rows) {
      const st = String(r.plan_status || '').toLowerCase();
      if (st === 'active') t.ativos += 1;
      if (ATTENTION.has(st)) t.atencao += 1;
      t.agend += r.appointments?.total || 0;
    }
    return t;
  }, [rows]);

  return (
    <div className="ae-wrap">
      <style>{`
        .ae-wrap { display: grid; gap: 16px; max-width: 1180px; margin: 0 auto; }
        .ae-head { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-soft); padding: 18px 20px; }
        .ae-head h2 { margin: 0 0 2px; font-size: 20px; }
        .ae-sub { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
        .ae-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .ae-field { position: relative; display: inline-flex; align-items: center; }
        .ae-field > svg { position: absolute; left: 10px; color: var(--muted); pointer-events: none; }
        .ae-field input { padding-left: 32px; }
        .ae-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
        .ae-kpi { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-soft); padding: 14px 16px; }
        .ae-kpi-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: var(--surface-soft); color: var(--primary); flex: none; }
        .ae-kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
        .ae-kpi-value { font-size: 24px; font-weight: 700; color: var(--text); line-height: 1.15; }
        .ae-tablecard { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-soft); overflow: hidden; }
        .ae-scroll { overflow-x: auto; }
        .ae-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .ae-table thead th { position: sticky; top: 0; z-index: 1; background: var(--surface-soft); color: var(--muted); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 11px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .ae-table tbody td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .ae-table tbody tr:last-child td { border-bottom: 0; }
        .ae-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--surface-soft) 45%, transparent); }
        .ae-table tbody tr:hover { background: var(--surface-soft); }
        .ae-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ae-name { font-weight: 600; color: var(--text); }
        .ae-contact { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; margin-top: 3px; }
        .ae-contact svg { flex: none; opacity: .75; }
        .ae-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; white-space: nowrap; text-transform: capitalize; }
        .ae-muted { color: var(--muted); }
        .ae-empty { text-align: center; padding: 28px 16px; color: var(--muted); }
      `}</style>

      <div className="ae-head">
        <h2>Panorama dos estabelecimentos</h2>
        <p className="ae-sub">Plano, status, vencimento e uso (profissionais, serviços e agendamentos) de cada conta.</p>
        <div className="ae-toolbar">
          <input className="input" type="password" placeholder="X-Admin-Token" value={token} onChange={(e) => setToken(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn btn--primary" onClick={load} disabled={!token || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {loading ? <span className="spinner" /> : <RefreshCw size={16} />} Carregar
          </button>
          <span className="ae-field">
            <Search size={16} />
            <input className="input" placeholder="Buscar nome, e-mail, telefone ou ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          </span>
          <label className="label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Ordenar
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="nome">Nome</option>
              <option value="vencimento">Vencimento</option>
              <option value="agendamentos">Agendamentos</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {meta && (
        <div className="ae-kpis">
          <Kpi icon={Users} label="Estabelecimentos" value={totals.estab} />
          <Kpi icon={CheckCircle2} label="Ativos" value={totals.ativos} tone="success" />
          <Kpi icon={AlertTriangle} label="Precisam atenção" value={totals.atencao} tone={totals.atencao ? 'warning' : undefined} />
          <Kpi icon={CalendarDays} label="Agendamentos (total)" value={totals.agend.toLocaleString('pt-BR')} />
        </div>
      )}

      <div className="ae-tablecard">
        <div className="ae-scroll">
          <table className="ae-table">
            <thead>
              <tr>
                <th>Estabelecimento</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Vencimento</th>
                <th className="ae-num">Profiss.<br /><span className="ae-muted" style={{ fontWeight: 500, textTransform: 'none' }}>ativos/total</span></th>
                <th className="ae-num">Serviços<br /><span className="ae-muted" style={{ fontWeight: 500, textTransform: 'none' }}>ativos/inativos</span></th>
                <th className="ae-num">Agend.<br /><span className="ae-muted" style={{ fontWeight: 500, textTransform: 'none' }}>total (mês)</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const phone = formatPhone(r.telefone);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="ae-name">{r.nome || `#${r.id}`}</div>
                      <div className="ae-contact"><span className="ae-muted">#{r.id}</span></div>
                      <div className="ae-contact"><Mail size={13} /> {r.email || <span className="ae-muted">sem e-mail</span>}</div>
                      <div className="ae-contact"><Phone size={13} /> {phone || <span className="ae-muted">sem telefone</span>}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.plan || '—'}</div>
                      <div className="ae-muted" style={{ fontSize: 12 }}>{r.plan_cycle || ''}</div>
                    </td>
                    <td><StatusBadge status={r.plan_status} /></td>
                    <td style={dueStyle(r.plan_active_until)}>{fmtDate(r.plan_active_until)}</td>
                    <td className="ae-num">{r.professionals?.active ?? 0}<span className="ae-muted"> / {r.professionals?.total ?? 0}</span></td>
                    <td className="ae-num">{r.services?.active ?? 0}<span className="ae-muted"> / {r.services?.inactive ?? 0}</span></td>
                    <td className="ae-num"><strong>{(r.appointments?.total ?? 0).toLocaleString('pt-BR')}</strong><span className="ae-muted"> ({r.appointments?.month ?? 0})</span></td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={7} className="ae-empty">{loading ? 'Carregando…' : (rows.length ? 'Nenhum resultado para o filtro.' : 'Cole o token e clique em Carregar.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
