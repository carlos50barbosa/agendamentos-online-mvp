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

// Rótulos dos códigos de motivo. Duplicados de propósito em relação a components/feedback/reasons.js:
// lá o texto é a PERGUNTA feita ao cliente ("O preço não cabe no meu momento"), aqui é a etiqueta
// do relatório ("Preço"). Reaproveitar o mesmo texto deixaria a tabela ilegível, e amarrar as duas
// telas obrigaria a escolher entre uma copy gentil e um relatório escaneável.
const MOTIVO_LABELS = {
  preco: 'Preço',
  sem_uso: 'Não usou',
  falta_recurso: 'Faltou recurso',
  dificuldade: 'Achou difícil',
  concorrente: 'Foi p/ concorrente',
  fechei_negocio: 'Fechou o negócio',
  duvida_funciona: 'Não entendeu se serve',
  so_pesquisando: 'Só pesquisando',
  outro: 'Outro',
};

const TIPO_LABELS = {
  cancelamento: 'Cancelamento',
  downgrade: 'Downgrade',
  nps: 'NPS',
  landing: 'Landing',
};

function npsTone(score) {
  if (score == null) return 'neutral';
  if (score >= 50) return 'success';
  if (score >= 0) return 'warning';
  return 'danger';
}

function FeedbackPanel({ token }) {
  const [dias, setDias] = useState(90);
  const [tipo, setTipo] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  async function carregar() {
    setErr(''); setLoading(true);
    try {
      const r = await Api.adminFeedback(token, { dias, tipo: tipo || undefined, limit: 200 });
      setData(r);
    } catch (e) {
      setErr(e?.data?.message || e?.message || 'Falha ao carregar feedback');
    } finally {
      setLoading(false);
    }
  }

  const nps = data?.nps;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Feedback de produto</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Motivo de cancelamento e downgrade, NPS dos donos e a pesquisa de saída da landing. É o que os
        clientes acham da PLATAFORMA — não confundir com as avaliações que os clientes finais deixam
        nos estabelecimentos.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="label" style={{ margin: 0 }}>
          <span>Janela</span>
          <select className="input" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
            <option value={180}>180 dias</option>
            <option value={365}>365 dias</option>
          </select>
        </label>
        <label className="label" style={{ margin: 0 }}>
          <span>Canal</span>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TIPO_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <button className="btn btn--primary" onClick={carregar} disabled={!token || loading}>
          {loading ? <span className="spinner" /> : 'Carregar'}
        </button>
      </div>

      {err ? (
        <div className="box" role="alert" style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}>
          Erro: {err}
        </div>
      ) : null}

      {data ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
          <div className="box" style={{ display: 'grid', gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>NPS</strong>
              {/* Sem resposta o placar é "—", nunca 0: zero é uma nota real (tantos promotores
                  quanto detratores) e mostrá-la por ausência de dado seria inventar a métrica. */}
              <Badge tone={npsTone(nps?.score)}>{nps?.score == null ? '—' : nps.score}</Badge>
              <span className="muted" style={{ fontSize: 13 }}>
                {nps?.total ? `${nps.total} resposta(s) · ${nps.promotor} promotor(es), ${nps.neutro} neutro(s), ${nps.detrator} detrator(es)` : 'sem respostas na janela'}
              </span>
            </div>
          </div>

          {Array.isArray(data.motivos) && data.motivos.length ? (
            <div>
              <strong style={{ fontSize: 14 }}>Motivos por canal</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
                {data.motivos.filter((m) => m.motivo).map((m) => (
                  <li key={`${m.tipo}-${m.motivo}`}>
                    <span className="muted">{TIPO_LABELS[m.tipo] || m.tipo}: </span>
                    {MOTIVO_LABELS[m.motivo] || m.motivo} — <strong>{m.total}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <strong style={{ fontSize: 14 }}>Respostas ({data.feedback?.length || 0})</strong>
            {data.feedback?.length ? (
              <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {data.feedback.map((f) => (
                  <li key={f.id} className="box" style={{ fontSize: 14 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone="neutral">{TIPO_LABELS[f.tipo] || f.tipo}</Badge>
                      {f.nota != null ? <Badge tone={f.nota >= 9 ? 'success' : f.nota >= 7 ? 'warning' : 'danger'}>nota {f.nota}</Badge> : null}
                      {f.motivo ? <span>{MOTIVO_LABELS[f.motivo] || f.motivo}</span> : null}
                      <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtDate(f.created_at)}</span>
                    </div>
                    {f.comentario ? <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{f.comentario}</p> : null}
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {/* Linha anônima é o esperado na landing (visitante sem conta) e também no
                          cancelamento de quem já apagou a conta — o FK é ON DELETE SET NULL. */}
                      {f.usuario_email ? `${f.usuario_nome || 'sem nome'} · ${f.usuario_email}` : 'anônimo'}
                      {f.plano ? ` · plano ${f.plano}` : ''}
                      {f.contexto ? ` · ${f.contexto}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: '6px 0 0' }}>Nenhuma resposta na janela escolhida.</p>
            )}
          </div>
        </div>
      ) : null}
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

        <FeedbackPanel token={token} />

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
