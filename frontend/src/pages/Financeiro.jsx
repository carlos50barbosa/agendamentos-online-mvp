import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api } from '../utils/api.js';

const centsToBRL = (cents) =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const STATUS_META = {
  pending: { label: 'Aguardando', tone: 'warn' },
  paid: { label: 'Recebido', tone: 'success' },
  refunded: { label: 'Estornado', tone: 'info' },
  expired: { label: 'Expirado', tone: 'muted' },
  canceled: { label: 'Cancelado', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'danger' },
};

const TONE_STYLE = {
  success: { background: 'rgba(22,163,74,.12)', color: '#15803d' },
  warn: { background: 'rgba(245,165,36,.16)', color: '#b45309' },
  info: { background: 'rgba(80,73,229,.12)', color: '#4f46e5' },
  danger: { background: 'rgba(220,38,38,.12)', color: '#b91c1c' },
  muted: { background: 'rgba(100,116,139,.12)', color: '#475569' },
};

function StatusTag({ status }) {
  const meta = STATUS_META[String(status || '').toLowerCase()] || { label: status || '—', tone: 'muted' };
  const style = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    ...(TONE_STYLE[meta.tone] || TONE_STYLE.muted),
  };
  return <span style={style}>{meta.label}</span>;
}

function MetricTile({ label, value, hint, accent }) {
  return (
    <div className="card" style={{ flex: '1 1 200px', minWidth: 180 }}>
      <span className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>{label}</span>
      <strong style={{ display: 'block', fontSize: 24, margin: '6px 0 2px', color: accent || 'inherit' }}>{value}</strong>
      {hint ? <span className="muted" style={{ fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

export default function Financeiro() {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await Api.getSinais();
        if (active) setState({ loading: false, error: '', data });
      } catch (err) {
        if (active) setState({ loading: false, error: err?.message || 'Falha ao carregar o financeiro.', data: null });
      }
    })();
    return () => { active = false; };
  }, []);

  const totals = state.data?.totals || {};
  const sinais = useMemo(() => (Array.isArray(state.data?.sinais) ? state.data.sinais : []), [state.data]);
  const allowed = state.data?.features?.deposit;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Módulo financeiro</span>
          <h2>Financeiro</h2>
          <p className="muted">Acompanhe os sinais recebidos, estornos e o valor retido por no-show.</p>
        </div>
        <div className="settings-module-hero__meta">
          <Link className="btn btn--outline btn--sm" to="/sinal">Configurar sinal</Link>
        </div>
      </section>

      {allowed === false ? (
        <div className="notice notice--info">
          O sinal é um recurso dos planos Pro e Premium. <Link to="/planos?motivo=sinal">Conhecer planos</Link>
        </div>
      ) : null}

      {state.loading ? (
        <div className="card row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="spinner" aria-hidden="true" /> <span className="muted">Carregando financeiro...</span>
        </div>
      ) : state.error ? (
        <div className="notice notice--error">{state.error}</div>
      ) : (
        <>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <MetricTile label="RECEBIDO NO MÊS" value={centsToBRL(totals.recebido_centavos)} hint="Repasses de sinal pagos" accent="#15803d" />
            <MetricTile label="ESTORNADO NO MÊS" value={centsToBRL(totals.estornado_centavos)} hint="Cancelamentos com reembolso" />
            <MetricTile label="RETIDO POR NO-SHOW" value={centsToBRL(totals.retido_noshow_centavos)} hint="Sinais de clientes que faltaram" />
          </div>

          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '12px 16px' }}>Data</th>
                    <th style={{ padding: '12px 16px' }}>Cliente</th>
                    <th style={{ padding: '12px 16px' }}>Serviço</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Sinal</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Repasse</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sinais.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center' }} className="muted">
                        Nenhum sinal registrado ainda.
                      </td>
                    </tr>
                  ) : (
                    sinais.map((s) => (
                      <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{formatDateTime(s.created_at)}</td>
                        <td style={{ padding: '12px 16px' }}>{s.cliente_nome || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>{s.servico_nome || '—'}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{centsToBRL(s.amount_centavos)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{centsToBRL(s.repasse_centavos)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <StatusTag status={s.status} />
                          {s.no_show ? <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>no-show</span> : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="muted" style={{ fontSize: 13 }}>
            Os valores são creditados na sua conta Asaas e podem ser transferidos para o seu banco pelo app do Asaas.
          </p>
        </>
      )}
    </div>
  );
}
