// frontend/src/pages/Clientes.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import { IconSearch } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE_ONLY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return DATE_TIME.format(dt);
}

function formatDateOnly(value) {
  if (!value) return '-';
  const text = String(value).trim();
  if (!text) return '-';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dt = new Date(year, month - 1, day);
    if (!Number.isNaN(dt.getTime())) return DATE_ONLY.format(dt);
  }
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return String(value);
  return DATE_ONLY.format(dt);
}

function formatPhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

function formatAddress(item) {
  if (!item) return '-';
  const line1 = [item.endereco, item.numero].filter(Boolean).join(', ');
  const line2 = [item.bairro, item.cidade, item.estado].filter(Boolean).join(' - ');
  const complement = item.complemento ? String(item.complemento) : '';
  const cep = item.cep ? `CEP ${item.cep}` : '';
  const parts = [line1, complement, line2, cep].filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
}

const toDigits = (value) => String(value || '').replace(/\D/g, '');
const buildWhatsappLink = (name, phone) => {
  const digits = toDigits(phone);
  if (!digits) return null;
  const msg = encodeURIComponent(`Olá ${name || ''}, tudo bem?`.trim());
  return `https://wa.me/${digits}?text=${msg}`;
};

const THEME_TOKENS = Object.freeze({
  text: 'var(--text)',
  subtle: 'var(--muted)',
  card: 'var(--card-bg)',
  border: 'var(--border)',
  inputBg: 'var(--surface)',
  inputShadow: 'var(--shadow-soft)',
  tableBg: 'var(--surface)',
  tableHeader: 'var(--brand-100)',
  tableHeaderBorder: '1px solid var(--brand-200)',
});

const BADGE_TONES = Object.freeze({
  cancelled: { background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border)' },
  confirmed: { background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-border)' },
  pending: { background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid var(--warning-border)' },
  default: { background: 'var(--surface-soft)', color: 'var(--text)', border: '1px solid var(--border)' },
});

export default function Clientes() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';
  const palette = THEME_TOKENS;
  const cellStyle = { textAlign: 'left', verticalAlign: 'top', color: palette.text };

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [query, setQuery] = useState('');
  const [searchText, setSearchText] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailClient, setDetailClient] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    if (!isEstab) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    Api.getEstablishmentClients(user.id, { page, q: query })
      .then((resp) => {
        if (!active) return;
        setItems(Array.isArray(resp?.items) ? resp.items : []);
        setHasNext(Boolean(resp?.hasNext));
        setTotal(Number(resp?.total || 0));
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Não foi possível carregar os clientes.');
        setItems([]);
        setHasNext(false);
        setTotal(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isEstab, user?.id, page, query, reloadKey]);

  const summary = useMemo(() => {
    const unique = items.length;
    const totalAppointments = items.reduce((acc, item) => acc + Number(item?.total_appointments || 0), 0);
    const cancelRate = totalAppointments > 0
      ? Math.round((items.reduce((acc, item) => acc + Number(item?.total_cancelled || 0), 0) / totalAppointments) * 100)
      : 0;
    return { unique, totalAppointments, cancelRate };
  }, [items]);

  const statusBadge = (status) => {
    const norm = String(status || '').toLowerCase();
    if (norm.includes('cancel')) return { text: 'Cancelado', style: BADGE_TONES.cancelled };
    if (norm.includes('confirm')) return { text: 'Confirmado', style: BADGE_TONES.confirmed };
    if (norm.includes('pend')) return { text: 'Pendente', style: BADGE_TONES.pending };
    return { text: status || '-', style: BADGE_TONES.default };
  };

  const handleOpenDetails = (item) => {
    setDetailClient(item);
    setDetailOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailOpen(false);
    setDetailClient(null);
  };

  if (!isEstab) {
    return (
      <div className="card" style={{ background: palette.card, border: `1px solid ${palette.border}` }}>
        <h2>Clientes</h2>
        <p>Disponível apenas para estabelecimentos.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">CRM leve</p>
          <h1 className="page__title">Clientes</h1>
          <p className="page__subtitle">Veja quem já agendou com você e quando foi o último contato.</p>
        </div>
        <div className="row row--gap-sm" style={{ flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 14, background: palette.card, border: `1px solid ${palette.border}` }}>
            <small className="eyebrow" style={{ color: palette.subtle }}>Clientes</small>
            <div className="stats-box__value" style={{ fontSize: 24, color: palette.text }}>{total || summary.unique || 0}</div>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 14, background: palette.card, border: `1px solid ${palette.border}` }}>
            <small className="eyebrow" style={{ color: palette.subtle }}>Agendamentos</small>
            <div className="stats-box__value" style={{ fontSize: 24, color: palette.text }}>{summary.totalAppointments}</div>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 14, background: palette.card, border: `1px solid ${palette.border}` }}>
            <small className="eyebrow" style={{ color: palette.subtle }}>Cancelamentos</small>
            <div className="stats-box__value" style={{ fontSize: 24, color: palette.text }}>
              {summary.totalAppointments ? `${summary.cancelRate || 0}%` : '—'}
            </div>
          </div>
        </div>
      </div>

      <form
        className="row row--gap-sm"
        style={{ marginBottom: 16, alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(searchText.trim());
        }}
      >
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label htmlFor="search">&nbsp;</label>
          <div
            className="input-with-icon"
            style={{
              width: '100%',
              background: palette.inputBg,
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: '6px 10px',
              boxShadow: palette.inputShadow,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <IconSearch aria-hidden style={{ marginRight: 8, flexShrink: 0 }} />
            <input
              id="search"
              type="search"
              placeholder="Buscar cliente (nome, email ou telefone)"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', color: palette.text }}
            />
          </div>
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>&nbsp;</label>
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%', borderRadius: 12 }}>
            Buscar
          </button>
        </div>
      </form>

      <div className="card">
        {loading ? (
          <div className="empty">
            <span className="spinner" /> Carregando...
          </div>
        ) : error ? (
          <div className="empty">
            {error}
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => {
                  setError('');
                  setReloadKey((v) => v + 1);
                }}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">Nenhum cliente encontrado.</div>
        ) : (
          <div
            className="table-responsive"
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              overflowX: 'auto',
              overflowY: 'hidden',
              background: palette.tableBg,
            }}
          >
            <table
              className="table"
              style={{ width: '100%', minWidth: 760, textAlign: 'left', fontSize: 14, tableLayout: 'auto', color: palette.text }}
            >
              <thead style={{ background: palette.tableHeader, borderBottom: palette.tableHeaderBorder, color: palette.text }}>
                <tr>
                  <th style={{ width: '22%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Nome</th>
                  <th style={{ width: '12%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Ações</th>
                  <th style={{ width: '12%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Dados completos</th>
                  <th style={{ width: '18%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Último agendamento</th>
                  <th style={{ width: '8%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Total</th>
                  <th style={{ width: '18%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Último serviço</th>
                  <th style={{ width: '10%', textAlign: 'left', fontSize: 13, padding: '10px 12px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const badge = statusBadge(item?.last_status);
                  const waLink = buildWhatsappLink(item?.nome, item?.telefone);
                  return (
                    <tr key={item.id} style={{ fontSize: 14, color: palette.text }}>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}><strong>{item?.nome || 'Cliente'}</strong></td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>
                        {waLink ? (
                          <a
                            href={waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn--sm"
                            style={{ borderRadius: 8, padding: '6px 10px' }}
                          >
                            WhatsApp
                          </a>
                        ) : (
                          <span style={{ color: palette.subtle, fontSize: 12 }}>sem telefone</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>
                        <button
                          type="button"
                          className="btn btn--sm btn--outline"
                          style={{ borderRadius: 8, padding: '6px 10px' }}
                          onClick={() => handleOpenDetails(item)}
                        >
                          Ver dados
                        </button>
                      </td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>{formatDateTime(item?.last_appointment_at)}</td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>{Number(item?.total_appointments || 0)}</td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>{item?.last_service || '-'}</td>
                      <td style={{ ...cellStyle, padding: '10px 12px' }}>
                        <span className="badge" style={{ ...badge.style, fontWeight: 700, border: badge.style.border }}>
                          {badge.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer" style={{ marginTop: 12 }}>
          <div className="text-muted">
            Página {page} {total ? `de ${total} clientes` : ''}
          </div>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page === 1}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={loading || !hasNext}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
      {detailOpen && detailClient && (
        <Modal title="Dados do cliente" onClose={handleCloseDetails} closeButton>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <strong>Nome</strong>
              <div>{detailClient?.nome || 'Cliente'}</div>
            </div>
            <div>
              <strong>Email</strong>
              <div>{detailClient?.email || '-'}</div>
            </div>
            <div>
              <strong>Telefone</strong>
              <div>{formatPhone(detailClient?.telefone) || '-'}</div>
            </div>
            <div>
              <strong>Data de nascimento</strong>
              <div>{formatDateOnly(detailClient?.data_nascimento)}</div>
            </div>
            <div>
              <strong>Endereço</strong>
              <div>{formatAddress(detailClient)}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
