// src/pages/AdminFeedback.jsx
//
// Painel do feedback sobre a PLATAFORMA: NPS dos donos, motivo de quem saiu e a pesquisa da
// landing. Não confundir com as avaliações que os clientes finais deixam nos estabelecimentos
// (`estabelecimento_reviews`) — aquilo é sobre o negócio deles, isto é sobre nós.
//
// Página própria, e não uma seção do panorama de estabelecimentos, por causa do GRÃO: lá é uma
// linha por conta, aqui é uma linha por resposta — e boa parte delas é anônima, de visitante que
// respondeu a pesquisa da landing e não tem conta nenhuma. Misturar os dois grãos numa tabela é o
// jeito mais confiável de deixar as duas ilegíveis. O que atravessa é só um sinal por tenant
// (último NPS + marca de saída), que mora lá porque é grão de conta.
import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, MessageSquare, DoorOpen, Eye, RefreshCw, Phone, Mail } from 'lucide-react';
import { Api } from '../utils/api';
import { CategoryBarChart } from '../components/reports/charts.jsx';
import { site, waLink } from '../config/site.js';

// Abaixo disto o NPS não é métrica, é anedota. O número continua visível (esconder dado do admin
// não ajuda ninguém), mas com o aviso colado nele — um placar grande e colorido em cima de duas
// respostas ensina a tratar ruído como sinal.
const NPS_AMOSTRA_MINIMA = 30;

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

// Motivos de SAÍDA e da LANDING em gráficos separados de propósito: são perguntas diferentes, e o
// volume da landing (todo visitante) esmagaria o do cancelamento (raro por natureza) se
// dividissem a mesma escala — o problema caro sumiria atrás do barato.
const TIPOS_SAIDA = ['cancelamento', 'downgrade'];

function npsTone(score, total) {
  if (score == null || total < NPS_AMOSTRA_MINIMA) return undefined;
  if (score >= 50) return 'success';
  if (score >= 0) return 'warning';
  return 'danger';
}

function notaTone(nota) {
  if (nota == null) return 'neutral';
  if (nota >= 9) return 'success';
  if (nota >= 7) return 'warning';
  return 'danger';
}

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMes(value) {
  const [ano, mes] = String(value || '').split('-');
  if (!ano || !mes) return String(value || '');
  return `${mes}/${ano.slice(2)}`;
}

function waNumber(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function Kpi({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="af-kpi">
      <div className="af-kpi-icon" style={tone ? { background: `var(--${tone}-bg)`, color: `var(--${tone}-text)` } : undefined}>
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="af-kpi-label">{label}</div>
        <div className="af-kpi-value">{value}</div>
        {hint ? <div className="af-kpi-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function Badge({ tone, children }) {
  const style = tone === 'neutral' || !tone
    ? { background: 'var(--card-2)', color: 'var(--muted)', boxShadow: 'inset 0 0 0 1px var(--border)' }
    : { background: `var(--${tone}-bg)`, color: `var(--${tone}-text)`, boxShadow: `inset 0 0 0 1px var(--${tone}-border)` };
  return <span className="af-badge" style={style}>{children}</span>;
}

// Estado vazio que ACUSA em vez de ficar em branco. Um gráfico vazio e calado parece "está tudo
// bem"; quase sempre significa que a coleta não está chegando, e é isso que precisa ser dito.
function Vazio({ children }) {
  return <p className="af-vazio">{children}</p>;
}

export default function AdminFeedback() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('admin_token') || ''; } catch { return ''; }
  });
  const [dias, setDias] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { try { localStorage.setItem('admin_token', token || ''); } catch {} }, [token]);

  async function load() {
    setError(''); setLoading(true);
    try {
      setData(await Api.adminFeedback(token, { dias, limit: 300 }));
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Falha ao carregar feedback');
    } finally {
      setLoading(false);
    }
  }

  const nps = data?.nps;
  const alcance = data?.alcance;
  const feedback = useMemo(() => (Array.isArray(data?.feedback) ? data.feedback : []), [data]);

  const motivosSaida = useMemo(
    () => (data?.motivos || [])
      .filter((m) => m.motivo && TIPOS_SAIDA.includes(m.tipo))
      // Soma cancelamento + downgrade no mesmo código: para decidir o que consertar, "o preço
      // afastou 7 pessoas" importa mais do que se elas saíram de vez ou só desceram de plano.
      .reduce((acc, m) => {
        const atual = acc.find((x) => x.key === m.motivo);
        if (atual) atual.value += Number(m.total || 0);
        else acc.push({ key: m.motivo, label: MOTIVO_LABELS[m.motivo] || m.motivo, value: Number(m.total || 0) });
        return acc;
      }, [])
      .sort((a, b) => b.value - a.value),
    [data]
  );

  const motivosLanding = useMemo(
    () => (data?.motivos || [])
      .filter((m) => m.motivo && m.tipo === 'landing')
      .map((m) => ({ key: m.motivo, label: MOTIVO_LABELS[m.motivo] || m.motivo, value: Number(m.total || 0) }))
      .sort((a, b) => b.value - a.value),
    [data]
  );

  // Quem vale uma ligação: detrator do NPS ou quem sinalizou saída, e que tenha contato. Sem
  // contato a linha não é acionável e só ocuparia espaço — ela continua no feed abaixo.
  const paraLigar = useMemo(
    () => feedback.filter((f) =>
      (f.usuario_email || f.usuario_telefone) &&
      ((f.tipo === 'nps' && f.nota != null && f.nota <= 6) || TIPOS_SAIDA.includes(f.tipo))
    ),
    [feedback]
  );

  const comentarios = useMemo(() => feedback.filter((f) => f.comentario), [feedback]);
  const serie = useMemo(() => (Array.isArray(data?.serie) ? data.serie : []), [data]);

  const amostraCurta = nps?.total != null && nps.total > 0 && nps.total < NPS_AMOSTRA_MINIMA;

  return (
    <div className="af-wrap">
      <style>{`
        .af-wrap { display: grid; gap: 16px; max-width: 1180px; margin: 0 auto; }
        .af-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-soft); padding: 18px 20px; }
        .af-card h2 { margin: 0 0 2px; font-size: 20px; }
        .af-card h3 { margin: 0 0 10px; font-size: 15px; }
        .af-sub { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
        .af-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .af-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
        .af-kpi { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-soft); padding: 14px 16px; }
        .af-kpi-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: var(--surface-soft); color: var(--primary); flex: none; }
        .af-kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
        .af-kpi-value { font-size: 24px; font-weight: 700; color: var(--text); line-height: 1.15; }
        .af-kpi-hint { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
        .af-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
        .af-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .af-vazio { color: var(--muted); font-size: 13px; margin: 6px 0 0; line-height: 1.5; }
        .af-aviso { background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 13px; line-height: 1.5; }
        .af-lista { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .af-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; }
        .af-item-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .af-item-quem { font-weight: 600; }
        .af-item-meta { color: var(--muted); font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 5px; }
        .af-item-texto { margin: 8px 0 0; white-space: pre-wrap; line-height: 1.5; }
        .af-quando { margin-left: auto; color: var(--muted); font-size: 12px; }
        .af-wa { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: #fff; background: #25D366; text-decoration: none; }
        .af-wa:hover { background: #1ebe5b; }
        .af-serie { display: flex; gap: 14px; flex-wrap: wrap; }
        .af-serie-item { text-align: center; min-width: 56px; }
        .af-serie-score { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .af-serie-mes { font-size: 11px; color: var(--muted); }
      `}</style>

      <div className="af-card">
        <h2>Feedback de produto</h2>
        <p className="af-sub">
          O que os donos acham da plataforma (NPS), por que quem saiu saiu, e o que faltou para o
          visitante da landing criar conta. Nada aqui é avaliação de estabelecimento.
        </p>
        <div className="af-toolbar">
          <input
            className="input"
            type="password"
            placeholder="X-Admin-Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <label className="label" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Janela
            <select className="input" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>180 dias</option>
              <option value={365}>365 dias</option>
            </select>
          </label>
          <button
            className="btn btn--primary"
            onClick={load}
            disabled={!token || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {loading ? <span className="spinner" /> : <RefreshCw size={16} />} Carregar
          </button>
        </div>
        {error && <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {data ? (
        <>
          <div className="af-kpis">
            <Kpi
              icon={Gauge}
              label="NPS"
              value={nps?.score == null ? '—' : nps.score}
              hint={nps?.total ? `${nps.total} resposta(s)` : 'sem respostas'}
              tone={npsTone(nps?.score, nps?.total || 0)}
            />
            <Kpi
              icon={Eye}
              label="Taxa de resposta"
              value={alcance?.taxa == null ? '—' : `${alcance.taxa}%`}
              hint={alcance?.exibicoes ? `${alcance.respostas} de ${alcance.exibicoes} exibições` : 'nenhuma exibição registrada'}
            />
            <Kpi
              icon={DoorOpen}
              label="Sinais de saída"
              value={motivosSaida.reduce((s, m) => s + m.value, 0)}
              hint="cancelamento + downgrade"
              tone={motivosSaida.length ? 'warning' : undefined}
            />
            <Kpi
              icon={MessageSquare}
              label="Comentários"
              value={comentarios.length}
              hint="respostas com texto"
            />
          </div>

          {amostraCurta ? (
            <div className="af-aviso">
              <strong>{nps.total} resposta(s)</strong> — o NPS ainda não é leitura, é anedota. A métrica
              começa a significar algo por volta de {NPS_AMOSTRA_MINIMA} respostas. Até lá, leia os
              comentários e ligue para os detratores; ignore o placar.
            </div>
          ) : null}

          {alcance?.exibicoes === 0 && (nps?.total || 0) === 0 ? (
            <div className="af-aviso">
              Nenhuma exibição do NPS registrada na janela. Ou nenhum dono bateu o marco de uso (30 dias
              de conta ou 20 agendamentos), ou a caixa não está sendo montada — vale abrir o painel com
              uma conta elegível e confirmar.
            </div>
          ) : null}

          <div className="af-cols">
            <div className="af-card">
              <h3>Por que saíram</h3>
              {motivosSaida.length ? (
                <CategoryBarChart
                  items={motivosSaida}
                  describe={(item) => `${item.label}: ${item.value}`}
                />
              ) : (
                <Vazio>
                  Nenhum motivo de saída na janela. Se alguém cancelou nesse período, a pessoa não passou
                  pelo botão da tela de assinatura — cancelou direto pelo suporte, e o motivo se perdeu.
                </Vazio>
              )}
            </div>

            <div className="af-card">
              <h3>O que faltou na landing</h3>
              {motivosLanding.length ? (
                <CategoryBarChart
                  items={motivosLanding}
                  describe={(item) => `${item.label}: ${item.value}`}
                />
              ) : (
                <Vazio>
                  Nenhuma resposta da landing. Se houve tráfego no período, ou ninguém rola 70% da página
                  nem tenta sair, ou o gatilho parou de disparar.
                </Vazio>
              )}
            </div>
          </div>

          {serie.length > 1 ? (
            <div className="af-card">
              <h3>NPS por mês</h3>
              <div className="af-serie">
                {serie.map((s) => (
                  <div key={s.mes} className="af-serie-item">
                    <div className="af-serie-score">{s.score == null ? '—' : s.score}</div>
                    <div className="af-serie-mes">{fmtMes(s.mes)}</div>
                    <div className="af-serie-mes">n={s.respostas}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="af-card">
            <h3>Vale uma ligação ({paraLigar.length})</h3>
            <p className="af-sub" style={{ marginBottom: 12 }}>
              Detratores (nota ≤ 6) e quem sinalizou saída, com contato. É a lista mais acionável desta
              tela — cinco conversas aqui valem mais que duzentas respostas de formulário.
            </p>
            {paraLigar.length ? (
              <ul className="af-lista">
                {paraLigar.map((f) => {
                  const numero = waNumber(f.usuario_telefone);
                  return (
                    <li key={f.id} className="af-item">
                      <div className="af-item-head">
                        <span className="af-item-quem">{f.usuario_nome || 'sem nome'}</span>
                        <Badge tone="neutral">{TIPO_LABELS[f.tipo] || f.tipo}</Badge>
                        {f.nota != null ? <Badge tone={notaTone(f.nota)}>nota {f.nota}</Badge> : null}
                        {f.motivo ? <Badge tone="neutral">{MOTIVO_LABELS[f.motivo] || f.motivo}</Badge> : null}
                        <span className="af-quando">{fmtDateTime(f.created_at)}</span>
                      </div>
                      <div className="af-item-meta">
                        {f.usuario_email ? <span><Mail size={13} /> {f.usuario_email}</span> : null}
                        {f.usuario_telefone ? <span><Phone size={13} /> {f.usuario_telefone}</span> : null}
                        {f.plano ? <span>plano {f.plano}</span> : null}
                        {numero ? (
                          <a
                            className="af-wa"
                            href={waLink(numero, `Oi${f.usuario_nome ? `, ${String(f.usuario_nome).split(' ')[0]}` : ''}! Aqui é do ${site.name}. Vi seu retorno e queria entender melhor o que aconteceu — posso te fazer duas perguntas?`)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            WhatsApp
                          </a>
                        ) : null}
                      </div>
                      {f.comentario ? <p className="af-item-texto">{f.comentario}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Vazio>Ninguém insatisfeito com contato na janela. Boa notícia — ou coleta parada.</Vazio>
            )}
          </div>

          <div className="af-card">
            <h3>Comentários ({comentarios.length})</h3>
            <p className="af-sub" style={{ marginBottom: 12 }}>
              Com volume baixo, é a única parte desta tela que informa de verdade.
            </p>
            {comentarios.length ? (
              <ul className="af-lista">
                {comentarios.map((f) => (
                  <li key={f.id} className="af-item">
                    <div className="af-item-head">
                      <Badge tone="neutral">{TIPO_LABELS[f.tipo] || f.tipo}</Badge>
                      {f.nota != null ? <Badge tone={notaTone(f.nota)}>nota {f.nota}</Badge> : null}
                      {f.motivo ? <span>{MOTIVO_LABELS[f.motivo] || f.motivo}</span> : null}
                      <span className="af-quando">{fmtDateTime(f.created_at)}</span>
                    </div>
                    <p className="af-item-texto">{f.comentario}</p>
                    <div className="af-item-meta">
                      {/* Anônimo é o esperado na landing (visitante sem conta) e em quem apagou a
                          conta depois — o FK é ON DELETE SET NULL. */}
                      {f.usuario_email ? `${f.usuario_nome || 'sem nome'} · ${f.usuario_email}` : 'anônimo'}
                      {f.plano ? ` · plano ${f.plano}` : ''}
                      {f.contexto ? ` · ${f.contexto}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Vazio>Nenhum comentário na janela.</Vazio>
            )}
          </div>
        </>
      ) : (
        <div className="af-card">
          <Vazio>Cole o token e clique em Carregar.</Vazio>
        </div>
      )}
    </div>
  );
}
