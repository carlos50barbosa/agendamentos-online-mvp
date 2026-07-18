import React, { useState } from 'react';
import { Api } from '../utils/api';

// Rotulos/cores das acoes que o /admin/subscriptions/reconcile devolve.
const ACTION_META = {
  reconcile: { label: 'Precisa regularizar', tone: 'warning' },
  manual_review: { label: 'Revisao manual', tone: 'danger' },
  noop: { label: 'Nada a fazer', tone: 'neutral' },
};

function toneStyle(tone) {
  const map = {
    warning: { bg: 'var(--warning-bg, #fff7ed)', border: 'var(--warning-border, #fed7aa)', color: 'var(--warning-text, #9a3412)' },
    danger: { bg: 'var(--danger-bg, #fef2f2)', border: 'var(--danger-border, #fecaca)', color: 'var(--danger-text, #991b1b)' },
    success: { bg: 'var(--success-bg, #f0fdf4)', border: 'var(--success-border, #bbf7d0)', color: 'var(--success-text, #166534)' },
    neutral: { bg: 'var(--muted-bg, #f3f4f6)', border: 'var(--border, #e5e7eb)', color: 'var(--text, #374151)' },
  };
  return map[tone] || map.neutral;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Badge({ tone, children }) {
  const s = toneStyle(tone);
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
      {children}
    </span>
  );
}

function ReconcileReport({ report }) {
  if (!report) return null;
  const meta = ACTION_META[report.action] || ACTION_META.noop;
  const applied = report.applied;
  return (
    <div className="box" style={{ marginTop: 12, display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={applied ? 'success' : meta.tone}>{applied ? 'Aplicado' : (report.dry_run ? 'Simulação' : 'Resultado')}</Badge>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="muted">estab #{report.estabelecimentoId}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 14 }}>
        <div><span className="muted">Status efetivo (antes): </span><strong>{report.effectiveStatusBefore || '—'}</strong></div>
        <div><span className="muted">Pago até: </span><strong>{fmtDate(report.paidThrough)}</strong></div>
      </div>

      {report.canonical ? (
        <div style={{ fontSize: 14 }}>
          <span className="muted">Linha paga (canônica): </span>
          <strong>#{report.canonical.id}</strong> · {report.canonical.plan}/{report.canonical.billingCycle} · status <strong>{report.canonical.status}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{report.canonical.gatewaySubscriptionId || 'sem id de gateway'}{report.canonicalNeedsRestore ? ' · precisa restaurar' : ''}</div>
        </div>
      ) : null}

      {Array.isArray(report.orphans) && report.orphans.length ? (
        <div style={{ fontSize: 14 }}>
          <span className="muted">Pendentes órfãs (serão canceladas): </span>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {report.orphans.map((o) => (
              <li key={o.id}>#{o.id} · {o.status} · <span className="muted">{o.gatewaySubscriptionId || 'sem id'}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      {applied ? (
        <div style={{ fontSize: 13, display: 'grid', gap: 2 }}>
          <div>Restaurou a paga: <strong>{report.restored ? 'sim' : 'não'}</strong> · Reativou no gateway: <strong>{report.canonicalReactivated ? 'sim' : 'não'}</strong> · Realinhou usuário: <strong>{report.userRealigned ? 'sim' : 'não'}</strong></div>
          <div>Cobranças apagadas: <strong>{(report.deletedCharges || []).length}</strong> · Ops de gateway: <strong>{(report.gatewayOps || []).length}</strong></div>
          <div>Gateway consistente: <Badge tone={report.gatewayConsistent ? 'success' : 'danger'}>{report.gatewayConsistent ? 'sim' : 'NÃO — verificar no Asaas'}</Badge></div>
        </div>
      ) : null}

      {report.action === 'noop' ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nada a regularizar: a assinatura efetiva já está ativa ou não há período pago vigente.</p>
      ) : null}
      {report.action === 'manual_review' ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Há período pago vigente mas nenhuma linha com pagamento identificável — investigue no banco antes de agir.</p>
      ) : null}

      <details>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>JSON completo</summary>
        <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(report, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function AdminTools() {
  const [token, setToken] = useState('');

  // Limpeza
  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanResult, setCleanResult] = useState('');
  const [cleanErr, setCleanErr] = useState('');

  // Regularizar assinatura
  const [subQuery, setSubQuery] = useState('');
  const [reconLoading, setReconLoading] = useState(false);
  const [reconApplying, setReconApplying] = useState(false);
  const [reconReport, setReconReport] = useState(null);
  const [reconErr, setReconErr] = useState('');

  async function runCleanup() {
    setCleanErr(''); setCleanResult(''); setCleanLoading(true);
    try {
      const r = await Api.adminCleanup(token);
      setCleanResult(JSON.stringify(r));
    } catch (e) {
      setCleanErr(e?.data?.message || e?.message || 'Falha ao executar limpeza');
    } finally {
      setCleanLoading(false);
    }
  }

  function buildTarget() {
    const v = String(subQuery || '').trim();
    if (!v) return null;
    return /^\d+$/.test(v) ? { estabelecimentoId: Number(v) } : { email: v };
  }

  async function runReconcile(apply) {
    const target = buildTarget();
    if (!target) { setReconErr('Informe o e-mail ou o ID do estabelecimento.'); return; }
    if (apply) {
      const ok = window.confirm(
        'Aplicar a regularização? Isso altera o banco E o gateway Asaas (cancela pendentes órfãs, apaga a cobrança aberta delas e reativa a assinatura paga). Rode a simulação antes.'
      );
      if (!ok) return;
    }
    setReconErr('');
    if (apply) setReconApplying(true); else { setReconLoading(true); setReconReport(null); }
    try {
      const r = await Api.adminReconcileSubscription(token, { ...target, apply: Boolean(apply) });
      setReconReport(r);
    } catch (e) {
      setReconErr(e?.data?.message || e?.message || 'Falha ao reconciliar');
    } finally {
      setReconLoading(false);
      setReconApplying(false);
    }
  }

  const canApply = reconReport && reconReport.action === 'reconcile' && !reconReport.applied;

  return (
    <div className="container">
      <div style={{ maxWidth: 640, margin: '20px auto', display: 'grid', gap: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ferramentas Admin</h2>
          <div className="label">
            <span>Admin Token</span>
            <input className="input" type="password" placeholder="Cole seu ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>O token não é armazenado — vai apenas no header de cada pedido.</p>
        </div>

        {/* Regularizar assinatura */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Regularizar assinatura</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Conserta o estado "PIX pendente apesar de pago": cancela pendentes órfãs (apaga a cobrança aberta + inativa no Asaas) e restaura a assinatura paga.
            <strong> Sempre simule antes de aplicar.</strong>
          </p>
          <div className="label">
            <span>E-mail ou ID do estabelecimento</span>
            <input
              className="input"
              placeholder="dono@exemplo.com ou 26"
              value={subQuery}
              onChange={(e) => { setSubQuery(e.target.value); setReconReport(null); setReconErr(''); }}
            />
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--outline" onClick={() => runReconcile(false)} disabled={!token || !subQuery || reconLoading || reconApplying}>
              {reconLoading ? <span className="spinner" /> : 'Simular (dry-run)'}
            </button>
            <button className="btn btn--primary" onClick={() => runReconcile(true)} disabled={!token || !canApply || reconApplying}>
              {reconApplying ? <span className="spinner" /> : 'Aplicar correção'}
            </button>
          </div>

          {reconErr ? (
            <div className="box" role="alert" style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}>
              Erro: {reconErr}
            </div>
          ) : null}

          <ReconcileReport report={reconReport} />
        </div>

        {/* Limpeza */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Manutenção</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--outline" onClick={runCleanup} disabled={!token || cleanLoading}>
              {cleanLoading ? <span className="spinner" /> : 'Executar limpeza /admin/cleanup'}
            </button>
          </div>
          {cleanResult ? (
            <div className="box" style={{ marginTop: 10 }}>
              <strong>Resultado:</strong>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{cleanResult}</pre>
            </div>
          ) : null}
          {cleanErr ? (
            <div className="box" role="alert" style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}>
              Erro: {cleanErr}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
