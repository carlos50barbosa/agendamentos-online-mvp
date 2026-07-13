// Painel do dono: criar e vender planos recorrentes para os PRÓPRIOS clientes.
// Ver docs/PLANO-FIDELIDADE-ASAAS.md. O cliente paga no cartão, o Asaas divide na
// liquidação e o dinheiro cai na conta do salão — nunca na da plataforma.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';

const money = (cents) => ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PLANO_VAZIO = {
  nome: '',
  descricao: '',
  preco_reais: '',
  desconto_percentual_extras: '',
  max_assinantes: '',
  itens: [],
};

export default function Fidelidade() {
  const [planos, setPlanos] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [assinantes, setAssinantes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState(null); // null = formulário fechado
  const [salvando, setSalvando] = useState(false);
  const [preview, setPreview] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const [p, s, a] = await Promise.all([
        Api.loyaltyPlansList(),
        Api.listServices().catch(() => []),
        Api.loyaltySubscribers().catch(() => ({ items: [] })),
      ]);
      setPlanos(p?.items || []);
      setServicos(Array.isArray(s) ? s : s?.items || []);
      setAssinantes(a?.items || []);
    } catch (e) {
      // 503 = recurso desligado por flag. Dizer isso é melhor do que uma tela vazia.
      if (e?.data?.error === 'loyalty_disabled') {
        setErro('Os planos de fidelidade ainda não estão habilitados na sua conta.');
      } else {
        setErro('Não foi possível carregar os planos.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // O quanto o dono realmente recebe. Não dá para calcular no front: o percentual do Asaas
  // incide sobre o líquido e trunca — o backend reproduz a conta medida em sandbox.
  const precoCents = Math.round((Number(String(form?.preco_reais || '').replace(',', '.')) || 0) * 100);
  useEffect(() => {
    if (!form || precoCents <= 0) { setPreview(null); return undefined; }
    let vivo = true;
    const id = setTimeout(() => {
      Api.loyaltySplitPreview(precoCents)
        .then((r) => { if (vivo) setPreview(r); })
        .catch(() => { if (vivo) setPreview(null); });
    }, 350);
    return () => { vivo = false; clearTimeout(id); };
  }, [form, precoCents]);

  const abrirNovo = () => { setForm({ ...PLANO_VAZIO }); setAviso(''); };
  const abrirEdicao = (plano) => {
    setForm({
      id: plano.id,
      nome: plano.nome || '',
      descricao: plano.descricao || '',
      preco_reais: ((Number(plano.preco_centavos) || 0) / 100).toFixed(2).replace('.', ','),
      desconto_percentual_extras: plano.desconto_percentual_extras ?? '',
      max_assinantes: plano.max_assinantes ?? '',
      itens: (plano.itens || plano.items || []).map((i) => ({
        servico_id: i.servico_id,
        quantidade_por_ciclo: i.quantidade_por_ciclo,
      })),
    });
    setAviso('');
  };

  const setItemQtd = (servicoId, qtd) => {
    setForm((f) => {
      const itens = (f.itens || []).filter((i) => Number(i.servico_id) !== Number(servicoId));
      const n = Math.max(0, Math.trunc(Number(qtd) || 0));
      if (n > 0) itens.push({ servico_id: Number(servicoId), quantidade_por_ciclo: n });
      return { ...f, itens };
    });
  };
  const qtdDoServico = (servicoId) =>
    form?.itens?.find((i) => Number(i.servico_id) === Number(servicoId))?.quantidade_por_ciclo ?? 0;

  const salvar = async (ev) => {
    ev.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErro('');
    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao?.trim() || null,
        preco_centavos: precoCents,
        desconto_percentual_extras: form.desconto_percentual_extras === '' ? null : Number(form.desconto_percentual_extras),
        max_assinantes: form.max_assinantes === '' ? null : Number(form.max_assinantes),
        items: form.itens || [],
      };
      if (form.id) await Api.loyaltyPlanUpdate(form.id, payload);
      else await Api.loyaltyPlanCreate(payload);
      setForm(null);
      setAviso(form.id ? 'Plano atualizado.' : 'Plano criado. Ative-o para começar a vender.');
      await carregar();
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível salvar o plano.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarStatus = async (plano) => {
    const novo = plano.status === 'active' ? 'inactive' : 'active';
    try {
      await Api.loyaltyPlanUpdateStatus(plano.id, novo);
      await carregar();
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível alterar o status.');
    }
  };

  const arquivar = async (plano) => {
    if (!window.confirm(`Arquivar o plano "${plano.nome}"? Quem já assina continua com o plano até o fim do ciclo.`)) return;
    try {
      await Api.loyaltyPlanDelete(plano.id);
      await carregar();
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível arquivar.');
    }
  };

  const ativos = useMemo(() => assinantes.filter((a) => a.status === 'active').length, [assinantes]);

  if (loading) return <div className="dashboard-narrow"><div className="card">Carregando…</div></div>;

  return (
    <div className="dashboard-narrow">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Planos de fidelidade</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
          Venda um plano mensal aos seus clientes (ex.: “2 cortes por mês”). Eles pagam no cartão,
          a renovação é automática e o dinheiro cai na sua conta Asaas.
        </p>
      </header>

      {erro && <div className="card" role="alert" style={{ borderColor: 'var(--status-cancelado-fg)', marginBottom: 12 }}>{erro}</div>}
      {aviso && <div className="card" style={{ marginBottom: 12 }}>{aviso}</div>}

      {!form && (
        <button type="button" className="btn btn--primary" onClick={abrirNovo} style={{ marginBottom: 16 }}>
          + Novo plano
        </button>
      )}

      {form && (
        <form className="card" onSubmit={salvar} style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>{form.id ? 'Editar plano' : 'Novo plano'}</h2>

          <label style={{ display: 'block', marginBottom: 10 }}>
            <span>Nome</span>
            <input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Plano Corte Mensal" />
          </label>

          <label style={{ display: 'block', marginBottom: 10 }}>
            <span>Descrição (opcional)</span>
            <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </label>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 140px' }}>
              <span>Preço mensal (R$)</span>
              <input required inputMode="decimal" value={form.preco_reais}
                onChange={(e) => setForm({ ...form, preco_reais: e.target.value })} placeholder="80,00" />
            </label>
            <label style={{ flex: '1 1 140px' }}>
              <span>Desconto em serviços extras (%)</span>
              <input inputMode="numeric" value={form.desconto_percentual_extras}
                onChange={(e) => setForm({ ...form, desconto_percentual_extras: e.target.value })} placeholder="10" />
            </label>
            <label style={{ flex: '1 1 140px' }}>
              <span>Máx. de assinantes (opcional)</span>
              <input inputMode="numeric" value={form.max_assinantes}
                onChange={(e) => setForm({ ...form, max_assinantes: e.target.value })} placeholder="sem limite" />
            </label>
          </div>

          {/* O número que o dono realmente recebe. Exibir "preço menos 5%" seria mentira: o
              percentual do Asaas incide sobre o líquido e trunca. */}
          {preview && (
            <div className="card box--highlight" style={{ margin: '12px 0' }}>
              <b>De {money(preview.grossCents)}, você recebe {money(preview.establishmentCents)} por assinante/mês.</b>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                Comissão da plataforma ({preview.platform_percent}%): {money(preview.platformCents)}
                {preview.card_fee_estimated
                  ? ` · Taxa do cartão (estimada): ${money(preview.asaasFeeCents)}`
                  : ' · A taxa do cartão ainda não está configurada, então este valor é o teto.'}
              </div>
            </div>
          )}

          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginTop: 8 }}>
            <legend style={{ fontSize: 13, color: 'var(--muted)' }}>O que o plano dá por mês</legend>
            {!servicos.length && <p style={{ margin: 0, color: 'var(--muted)' }}>Cadastre serviços antes de montar um plano.</p>}
            {servicos.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ flex: 1 }}>{s.nome}</span>
                <input
                  type="number" min="0" style={{ width: 80 }}
                  value={qtdDoServico(s.id)}
                  onChange={(e) => setItemQtd(s.id, e.target.value)}
                />
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>por ciclo</span>
              </div>
            ))}
          </fieldset>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn--primary" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setForm(null)} disabled={salvando}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!planos.length && !form && (
        <div className="card">
          <b>Nenhum plano ainda.</b>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
            Um plano transforma cliente eventual em receita recorrente — e ele volta porque já pagou.
          </p>
        </div>
      )}

      {planos.map((p) => (
        <div key={p.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ flex: 1 }}>{p.nome}</b>
            <span style={{ color: p.status === 'active' ? 'var(--status-confirmado-fg)' : 'var(--muted)', fontSize: 13 }}>
              {p.status === 'active' ? 'Ativo' : p.status === 'archived' ? 'Arquivado' : 'Inativo'}
            </span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>
            {money(p.preco_centavos)}/mês
            {p.descricao ? ` · ${p.descricao}` : ''}
          </div>
          {p.status !== 'archived' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--sm btn--outline" onClick={() => abrirEdicao(p)}>Editar</button>
              <button type="button" className="btn btn--sm" onClick={() => alternarStatus(p)}>
                {p.status === 'active' ? 'Desativar' : 'Ativar'}
              </button>
              <button type="button" className="btn btn--sm btn--danger" onClick={() => arquivar(p)}>Arquivar</button>
            </div>
          )}
        </div>
      ))}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Assinantes ({ativos} ativos)</h2>
      {!assinantes.length ? (
        <div className="card" style={{ color: 'var(--muted)' }}>Ninguém assinou ainda.</div>
      ) : (
        assinantes.map((a) => (
          <div key={a.id} className="card" style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <b style={{ flex: 1 }}>{a.cliente_nome || a.cliente_id}</b>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{a.plano_nome || ''}</span>
            <span style={{ fontSize: 13 }}>{a.status}</span>
          </div>
        ))
      )}
    </div>
  );
}
