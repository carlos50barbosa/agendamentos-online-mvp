// src/pages/AdminEstablishments.jsx
// Panorama super-admin: todos os estabelecimentos com plano/status/vencimento + contagens.
import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Phone, Search, RefreshCw, Users, CheckCircle2, AlertTriangle, CalendarDays, ArrowUp, ArrowDown, Trash2, FileText, Copy, X } from 'lucide-react';
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

// Satisfação daquela conta, ao lado do plano e do vencimento — a combinação "dono insatisfeito com
// renovação chegando" é o que decide para quem ligar hoje. O painel completo (grão de resposta,
// incluindo as anônimas da landing, que não têm tenant) mora em /admin/feedback.
function SatisfacaoCell({ feedback }) {
  const nota = feedback?.nps;
  const saida = feedback?.sinalizou_saida;

  // `null` (nunca respondeu) NÃO é 0 (respondeu zero). Sem essa distinção, quem nunca foi ouvido
  // apareceria em vermelho no topo da lista de quem precisa de atenção.
  if (nota == null && !saida) return <span className="ae-muted">—</span>;

  const tone = nota == null ? 'neutral' : nota >= 9 ? 'success' : nota >= 7 ? 'warning' : 'danger';
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      {nota != null ? (
        <span className="ae-badge" style={{ background: `var(--${tone}-bg)`, color: `var(--${tone}-text)`, boxShadow: `inset 0 0 0 1px var(--${tone}-border)` }}>
          NPS {nota}
        </span>
      ) : null}
      {saida ? (
        <span className="ae-badge" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)', boxShadow: 'inset 0 0 0 1px var(--danger-border)' }}>
          sinalizou saída
        </span>
      ) : null}
      {nota != null && feedback?.nps_em ? (
        <span className="ae-muted" style={{ fontSize: 11 }}>{fmtDate(feedback.nps_em)}</span>
      ) : null}
    </div>
  );
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

// Numero para o wa.me: garante o DDI 55 (Brasil) quando vier so DDD+numero.
function waNumber(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// Mensagem de win-back pre-preenchida (o remetente ainda pode editar no WhatsApp antes de enviar).
function buildWinbackMessage(nome) {
  const saudacao = nome ? `Oi, ${nome}!` : 'Oi!';
  return [
    `${saudacao} Aqui é o José, do Agendamentos Online. Você testou a gente lá no comecinho — e, sendo sincero, na época tava cheio de problema: lento, não abria direito no Instagram, uns bugs chatos. Isso me incomodava e a gente corrigiu tudo isso desde então.`,
    'Queria muito te perguntar, de verdade: o que te fez não continuar naquela época? Tua resposta me ajuda demais.',
    'E se topar dar uma segunda chance, eu te libero mais 30 dias de teste e faço a configuração inicial junto com você. Posso te mostrar rapidinho o que mudou?',
  ].join('\n\n');
}

function WhatsAppButton({ phone, nome }) {
  const num = waNumber(phone);
  if (!num) return null;
  const text = encodeURIComponent(buildWinbackMessage(nome));
  return (
    <a className="ae-wa" href={`https://wa.me/${num}?text=${text}`} target="_blank" rel="noopener noreferrer" title="Chamar no WhatsApp">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.989 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
      WhatsApp
    </a>
  );
}

// Comparadores TODOS crescentes — inclusive agendamentos, que antes ordenava ao contrário dos
// outros. Com a direção virando um botão, "decrescente" precisa querer dizer a mesma coisa em
// qualquer coluna; comparador que já vem invertido faria o botão mentir na metade das opções.
const SORTS = {
  id: (a, b) => (Number(a.id) || 0) - (Number(b.id) || 0),
  nome: (a, b) => String(a.nome || '').localeCompare(String(b.nome || '')),
  vencimento: (a, b) => (new Date(a.plan_active_until || 0).getTime() || 0) - (new Date(b.plan_active_until || 0).getTime() || 0),
  agendamentos: (a, b) => (a.appointments?.total || 0) - (b.appointments?.total || 0),
  status: (a, b) => String(a.plan_status || '').localeCompare(String(b.plan_status || '')),
};

// A direção que faz sentido ao ESCOLHER cada campo — quem ordena por agendamentos quer ver os
// maiores, quem ordena por nome quer o alfabeto, quem ordena por ID quer as contas mais novas
// primeiro. Só o padrão: o botão continua mandando depois.
const DEFAULT_DIR = {
  id: 'desc',
  nome: 'asc',
  vencimento: 'asc',
  agendamentos: 'desc',
  status: 'asc',
};

async function adminFetch(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'X-Admin-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Exclusão em dois passos: primeiro o tamanho do estrago, só depois o botão vermelho.
 *
 * O número que decide não é "quantos agendamentos" — é `clientes_afetados`: pessoas que não pediram
 * nada e perdem o próprio histórico junto. Por isso ele aparece destacado, e não numa lista.
 *
 * A confirmação por nome digitado é repetida no servidor. Aqui ela evita o clique distraído; lá
 * evita a chamada de API com o id errado.
 */
function ExcluirModal({ token, alvo, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [erro, setErro] = useState('');
  const [erroCodigo, setErroCodigo] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ignorarAssinatura, setIgnorarAssinatura] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    adminFetch(`/admin/establishments/${alvo.id}/deletion-preview`, { token })
      .then((d) => { if (vivo) { setPreview(d); setErro(''); } })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [alvo.id, token]);

  const esperado = String(preview?.usuario?.nome || alvo.nome || '').trim();
  const assinatura = preview?.assinatura_ativa || null;

  // O cancelamento automático só existe para o Asaas. Mercado Pago (contas antigas) continua sendo
  // decisão manual — e o Asaas pode recusar, o que só se descobre ao tentar: daí o 409 também
  // destravar o mesmo checkbox.
  const cancelaSozinho = Boolean(
    assinatura && String(assinatura.gateway || '').toLowerCase() === 'asaas' && assinatura.gateway_subscription_id
  );
  const precisaAssumir = Boolean(assinatura) && (!cancelaSozinho || erroCodigo === 'assinatura_ativa');
  const podeExcluir = Boolean(preview) && nome.trim() === esperado && (!precisaAssumir || ignorarAssinatura);

  async function excluir() {
    setEnviando(true); setErro(''); setErroCodigo('');
    try {
      const r = await adminFetch(`/admin/establishments/${alvo.id}/delete`, {
        token,
        method: 'POST',
        body: { confirmacao: nome.trim(), motivo: motivo.trim() || null, ignorar_assinatura: ignorarAssinatura },
      });
      setResultado(r);
      onDone?.();
    } catch (e) {
      setErro(e.message);
      setErroCodigo(e.code || '');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="ae-overlay" role="dialog" aria-modal="true" aria-label="Excluir estabelecimento">
      <div className="ae-modal">
        <div className="ae-modal-head">
          <strong>{resultado ? 'Estabelecimento excluído' : 'Excluir estabelecimento'}</strong>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </div>

        {resultado ? (
          <div className="ae-modal-body">
            <p className="ae-muted" style={{ marginTop: 0 }}>
              Guarde este número: é o que você devolve ao titular como comprovante. Ele fica no histórico
              de protocolos mesmo depois de a conta não existir mais.
            </p>
            <div className="ae-proto-box">
              <code>{resultado.protocolo}</code>
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(resultado.protocolo)}>
                <Copy size={14} /> Copiar
              </button>
            </div>
            <p className="ae-muted" style={{ fontSize: 12, margin: 0 }}>
              Apagados junto: {resultado.impacto?.agendamentos ?? 0} agendamentos de{' '}
              {resultado.impacto?.clientes_afetados ?? 0} clientes, {resultado.impacto?.servicos ?? 0} serviços e{' '}
              {resultado.impacto?.profissionais ?? 0} profissionais.
            </p>
            <p className="ae-muted" style={{ fontSize: 12, margin: 0 }}>
              Assinatura:{' '}
              {resultado.gateway?.cancelada
                ? `cancelada no gateway (${resultado.gateway.gateway_subscription_id})`
                : resultado.gateway?.motivo === 'sem_assinatura'
                  ? 'não havia assinatura ativa'
                  : 'NÃO cancelada — resolva no painel do gateway'}
              .
            </p>
            {/* Lixo em disco não invalida a exclusão, mas some da tela se ninguém contar — e ninguém
                vai procurar por uma foto órfã que não sabe que existe. */}
            <p className="ae-muted" style={{ fontSize: 12, margin: 0 }}>
              Arquivos: {resultado.arquivos?.removidos ?? 0} de {resultado.arquivos?.previstos ?? 0} removidos do disco
              {resultado.arquivos?.falhas?.length ? ` — falharam: ${resultado.arquivos.falhas.join(', ')}` : ''}.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--primary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <div className="ae-modal-body">
            {carregando && <p className="ae-muted">Carregando o impacto…</p>}
            {erro && <div className="notice notice--error" role="alert">{erro}</div>}

            {preview && (
              <>
                <div className="ae-alvo">
                  <div className="ae-name">{preview.usuario.nome || `#${preview.usuario.id}`}</div>
                  <div className="ae-muted" style={{ fontSize: 12 }}>#{preview.usuario.id} · {preview.usuario.email}</div>
                </div>

                <div className="ae-impacto">
                  <div className="ae-impacto-forte">
                    <span>{preview.impacto.clientes_afetados}</span>
                    clientes perdem o histórico
                  </div>
                  <div className="ae-impacto-linha">
                    {preview.impacto.agendamentos} agendamentos · {preview.impacto.servicos} serviços ·{' '}
                    {preview.impacto.profissionais} profissionais
                  </div>
                </div>

                {assinatura && (
                  <div className={precisaAssumir ? 'notice notice--error' : 'notice notice--warn'} style={{ display: 'grid', gap: 8 }}>
                    <strong>Assinatura ativa no gateway</strong>
                    <span style={{ fontSize: 13 }}>
                      {assinatura.gateway} · {assinatura.status}
                      {assinatura.gateway_subscription_id ? ` · ${assinatura.gateway_subscription_id}` : ''}
                    </span>
                    <span style={{ fontSize: 13 }}>
                      {cancelaSozinho
                        ? 'Ela será cancelada no Asaas antes da exclusão. Se o Asaas recusar, nada é apagado — a cobrança nunca fica viva com o id já fora do banco.'
                        : 'Este gateway não tem cancelamento automático aqui. Apagar sem cancelar lá deixa a cobrança recorrente viva e os webhooks chegando órfãos.'}
                    </span>
                    {precisaAssumir && (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                        <input type="checkbox" checked={ignorarAssinatura} onChange={(e) => setIgnorarAssinatura(e.target.checked)} />
                        Já cancelei no painel (ou assumo a pendência) — seguir mesmo assim
                      </label>
                    )}
                  </div>
                )}

                <label className="label" style={{ display: 'grid', gap: 4 }}>
                  Motivo (vai para o protocolo)
                  <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Pedido formal de exclusão do titular" />
                </label>

                <label className="label" style={{ display: 'grid', gap: 4 }}>
                  Para confirmar, digite <b>{esperado}</b>
                  <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
                </label>

                <p className="ae-muted" style={{ fontSize: 12, margin: 0 }}>
                  Irreversível — este schema não tem soft delete. As imagens enviadas são apagadas do disco junto.
                </p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" onClick={onClose}>Cancelar</button>
                  <button type="button" className="btn ae-danger" onClick={excluir} disabled={!podeExcluir || enviando}>
                    {enviando ? <span className="spinner" /> : <Trash2 size={15} />} Excluir e gerar protocolo
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Histórico. Lê da `audit_log`, a única tabela do caminho sem FK para `usuarios` — é por isso que
 * ela ainda sabe responder quem foi excluído depois de a conta ter deixado de existir.
 */
function ProtocolosPanel({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let vivo = true;
    setLoading(true);
    adminFetch('/admin/deletion-protocols?limit=200', { token })
      .then((d) => { if (vivo) { setRows(d.protocolos || []); setErro(''); } })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [token]);

  return (
    <div className="ae-tablecard">
      <div className="ae-scroll">
        <table className="ae-table">
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Quando</th>
              <th>Conta excluída</th>
              <th className="ae-num">Impacto</th>
              <th>Motivo</th>
              <th>Executor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><code style={{ fontSize: 12.5 }}>{r.protocolo || '—'}</code></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.criado_em)}</td>
                <td>
                  <div className="ae-name">{r.nome || `#${r.entidade_id}`}</div>
                  <div className="ae-muted" style={{ fontSize: 12 }}>#{r.entidade_id} · {r.email || 'sem e-mail'}</div>
                </td>
                <td className="ae-num">
                  {r.impacto
                    ? <>{r.impacto.agendamentos ?? 0} ag.<span className="ae-muted"> / {r.impacto.clientes_afetados ?? 0} cli.</span></>
                    : <span className="ae-muted">—</span>}
                </td>
                <td style={{ maxWidth: 260 }}>{r.motivo || <span className="ae-muted">—</span>}</td>
                <td className="ae-muted">{r.ator_email || 'admin'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="ae-empty">{loading ? 'Carregando…' : (erro || 'Nenhuma exclusão registrada.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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
  // Abre por ID decrescente: quem entra aqui quase sempre quer ver quem se cadastrou por último.
  const [sort, setSort] = useState('id');
  const [dir, setDir] = useState(DEFAULT_DIR.id);
  const [aba, setAba] = useState('estabelecimentos');
  const [alvoExclusao, setAlvoExclusao] = useState(null);

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
    const cmp = SORTS[sort] || SORTS.nome;
    const mult = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => mult * cmp(a, b));
  }, [rows, q, sort, dir]);

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
        .ae-contact { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; margin-top: 3px; flex-wrap: wrap; }
        .ae-contact svg { flex: none; opacity: .75; }
        .ae-wa { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; padding: 2px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: #fff; background: #25D366; text-decoration: none; line-height: 1.5; }
        .ae-wa:hover { background: #1ebe5b; }
        .ae-wa svg { opacity: 1; }
        .ae-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; white-space: nowrap; text-transform: capitalize; }
        .ae-muted { color: var(--muted); }
        .ae-empty { text-align: center; padding: 28px 16px; color: var(--muted); }
        .ae-danger { background: var(--danger-bg); color: var(--danger-text); box-shadow: inset 0 0 0 1px var(--danger-border); display: inline-flex; align-items: center; gap: 6px; }
        .ae-danger:disabled { opacity: .5; }
        .ae-iconbtn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: var(--card); color: var(--muted); cursor: pointer; }
        .ae-iconbtn:hover { color: var(--danger-text); border-color: var(--danger-border); background: var(--danger-bg); }
        .ae-overlay { position: fixed; inset: 0; background: rgba(15, 12, 41, .55); display: grid; place-items: center; padding: 16px; z-index: 50; }
        .ae-modal { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: min(560px, 100%); max-height: 90vh; overflow: auto; }
        .ae-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
        .ae-modal-body { display: grid; gap: 12px; padding: 18px; }
        .ae-alvo { background: var(--surface-soft); border-radius: 10px; padding: 10px 12px; }
        .ae-impacto { border: 1px solid var(--danger-border); background: var(--danger-bg); border-radius: 10px; padding: 12px; display: grid; gap: 4px; }
        .ae-impacto-forte { color: var(--danger-text); font-weight: 700; display: flex; align-items: baseline; gap: 8px; }
        .ae-impacto-forte span { font-size: 28px; line-height: 1; }
        .ae-impacto-linha { color: var(--danger-text); font-size: 13px; opacity: .85; }
        .ae-proto-box { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border: 1px solid var(--success-border); background: var(--success-bg); border-radius: 10px; padding: 14px; }
        .ae-proto-box code { font-size: 17px; font-weight: 700; color: var(--success-text); letter-spacing: .02em; }
        .ae-tabs { display: inline-flex; gap: 4px; background: var(--surface-soft); padding: 4px; border-radius: 10px; }
        .ae-tab { border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 13px; padding: 6px 12px; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .ae-tab[aria-selected="true"] { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); }
      `}</style>

      <div className="ae-head">
        <h2>Panorama dos estabelecimentos</h2>
        <p className="ae-sub">Plano, status, vencimento e uso (profissionais, serviços e agendamentos) de cada conta.</p>
        <div className="ae-tabs" role="tablist" style={{ marginBottom: 12 }}>
          <button type="button" role="tab" aria-selected={aba === 'estabelecimentos'} className="ae-tab" onClick={() => setAba('estabelecimentos')}>
            <Users size={14} /> Estabelecimentos
          </button>
          <button type="button" role="tab" aria-selected={aba === 'protocolos'} className="ae-tab" onClick={() => setAba('protocolos')}>
            <FileText size={14} /> Protocolos de exclusão
          </button>
        </div>
        <div className="ae-toolbar">
          <input className="input" type="password" placeholder="X-Admin-Token" value={token} onChange={(e) => setToken(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn btn--primary" onClick={load} disabled={!token || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {loading ? <span className="spinner" /> : <RefreshCw size={16} />} Carregar
          </button>
          {aba === 'estabelecimentos' && (<>
          <span className="ae-field">
            <Search size={16} />
            <input className="input" placeholder="Buscar nome, e-mail, telefone ou ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          </span>
          <label className="label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Ordenar
            <select
              className="input"
              value={sort}
              onChange={(e) => {
                const next = e.target.value;
                setSort(next);
                // Troca a direção junto com o campo: escolher "Agendamentos" e ver os zerados no
                // topo obrigaria um segundo clique toda vez.
                setDir(DEFAULT_DIR[next] || 'asc');
              }}
            >
              <option value="id">ID</option>
              <option value="nome">Nome</option>
              <option value="vencimento">Vencimento</option>
              <option value="agendamentos">Agendamentos</option>
              <option value="status">Status</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={dir === 'asc' ? 'Ordem crescente — clique para inverter' : 'Ordem decrescente — clique para inverter'}
            aria-label={`Ordem ${dir === 'asc' ? 'crescente' : 'decrescente'}. Clique para inverter.`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {dir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            {dir === 'asc' ? 'Crescente' : 'Decrescente'}
          </button>
          </>)}
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {aba === 'estabelecimentos' && meta && (
        <div className="ae-kpis">
          <Kpi icon={Users} label="Estabelecimentos" value={totals.estab} />
          <Kpi icon={CheckCircle2} label="Ativos" value={totals.ativos} tone="success" />
          <Kpi icon={AlertTriangle} label="Precisam atenção" value={totals.atencao} tone={totals.atencao ? 'warning' : undefined} />
          <Kpi icon={CalendarDays} label="Agendamentos (total)" value={totals.agend.toLocaleString('pt-BR')} />
        </div>
      )}

      {aba === 'protocolos' ? <ProtocolosPanel token={token} /> : (
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
                <th>Satisfação<br /><span className="ae-muted" style={{ fontWeight: 500, textTransform: 'none' }}>último NPS</span></th>
                <th>Ações</th>
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
                      <div className="ae-contact"><Phone size={13} /> {phone || <span className="ae-muted">sem telefone</span>}<WhatsAppButton phone={r.telefone} nome={r.nome} /></div>
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
                    <td><SatisfacaoCell feedback={r.feedback} /></td>
                    <td>
                      <button type="button" className="ae-iconbtn" onClick={() => setAlvoExclusao(r)} title="Excluir com protocolo">
                        <Trash2 size={13} /> Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={9} className="ae-empty">{loading ? 'Carregando…' : (rows.length ? 'Nenhum resultado para o filtro.' : 'Cole o token e clique em Carregar.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {alvoExclusao && (
        <ExcluirModal
          token={token}
          alvo={alvoExclusao}
          onClose={() => setAlvoExclusao(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
