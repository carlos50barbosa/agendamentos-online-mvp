// src/components/settings/DailyLimitSection.jsx
// Trava opcional: quantos horários o mesmo cliente pode ocupar num mesmo dia.
//
// Nasceu de um caso real (19/08/2026): a mesma pessoa marcou 16:00 e 16:30 no mesmo dia com 57
// segundos de diferença — tinha refeito o agendamento achando que o primeiro não deu certo. Os
// dois horários ficaram presos e ninguém mais conseguiu pegar.
//
// Por que é opcional: depende do negócio. Estúdio de unha em que a cliente faz mão e pé em
// sessões separadas quer permitir dois; barbearia não quer nenhum. Por isso a resposta é do dono
// e nasce DESLIGADA — quem nunca pediu não pode descobrir a trava por um cliente reclamando.
//
// Vale para quem marca pelo link público, pelo bot do WhatsApp e para o cliente logado. O dono
// NÃO é limitado: pelo painel ele encaixa quem quiser, do mesmo jeito que a janela de
// agendamento só vale para o cliente.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import './settings.css';

const MAX_PADRAO = 1;

export default function DailyLimitSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ ativo: false, max: MAX_PADRAO });
  // Config como está NO BANCO, para saber se o formulário divergiu.
  const [salvo, setSalvo] = useState(null);
  const [teto, setTeto] = useState(20);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const data = await Api.getEstablishmentSettings();
        if (!alive) return;
        const limite = data?.limite_diario || {};
        const config = {
          ativo: Boolean(limite.ativo),
          max: Number(limite.max) > 0 ? Number(limite.max) : MAX_PADRAO,
        };
        setForm(config);
        setSalvo(config);
        if (Number(limite.max_teto) > 0) setTeto(Number(limite.max_teto));
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const alterado = salvo && (form.ativo !== salvo.ativo || form.max !== salvo.max);

  const onSave = async (e) => {
    e.preventDefault();
    setSaving(true); setFeedback(null);
    try {
      // Com a trava DESLIGADA o `max` nao vai no payload, aproveitando que o PUT e parcial.
      //
      // Nao e economia: mandando-o, um valor invalido que tenha sobrado no campo (apagar o
      // conteudo para redigitar deixa 0 no estado) faz o backend recusar com 400 invalid_max e
      // o desligamento NAO acontece — o dono le um erro sobre um campo que ele nao esta mais
      // vendo, e a trava segue barrando cliente ate ele recarregar a pagina. Enquanto a caixa
      // estava marcada, quem impedia isso era o `min` nativo do input; ao desmarcar, o input
      // desmonta e leva a validacao junto.
      const payload = form.ativo ? { ativo: true, max: form.max } : { ativo: false };
      const resp = await Api.updateEstablishmentDailyLimit(payload);
      const limite = resp?.limite_diario || {};
      // Espelha o que o backend confirmou, não o que o formulário tinha.
      const config = {
        ativo: Boolean(limite.ativo),
        max: Number(limite.max) > 0 ? Number(limite.max) : MAX_PADRAO,
      };
      setForm(config);
      setSalvo(config);
      setFeedback({
        type: 'success',
        message: config.ativo
          ? `Trava ativada: no máximo ${config.max} por cliente a cada dia.`
          : 'Trava desativada. O cliente pode marcar quantos horários quiser no mesmo dia.',
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar.' });
    } finally { setSaving(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Agendamentos por cliente no mesmo dia</h4>
          <p className="set-block__sub">
            Impede que a mesma pessoa ocupe vários horários do mesmo dia. Você continua
            encaixando quem quiser pelo painel — o limite vale só para quem marca sozinho.
          </p>
        </div>

        <label className="label" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={form.ativo}
            onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))}
          />
          <span>Limitar agendamentos do mesmo cliente por dia</span>
        </label>

        {form.ativo && (
          <label className="label" style={{ marginTop: 12, maxWidth: 260 }}>
            <span>Máximo por cliente, por dia</span>
            <input
              type="number"
              className="input"
              min={1}
              max={teto}
              value={form.max}
              onChange={(e) => {
                // Campo vazio vira Number('') === 0, e o input controlado repinta "0" na tela.
                // Segurar aqui mantem o estado sempre dentro da faixa que o backend aceita.
                const n = Number(e.target.value);
                setForm((p) => ({ ...p, max: Number.isInteger(n) && n >= 1 && n <= teto ? n : p.max }));
              }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              1 impede qualquer segundo horário no mesmo dia. Use 2 se o seu cliente costuma
              fazer dois serviços em sessões separadas.
            </span>
          </label>
        )}

        {alterado && (
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Salve para aplicar.</p>
        )}

        {/* O que a trava NÃO faz. Melhor o dono saber disto aqui do que concluir que a trava
            está quebrada quando encontrar uma exceção na agenda. */}
        {form.ativo && !alterado && (
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            A trava reconhece o cliente pelo cadastro. Se a mesma pessoa marcar duas vezes com
            e-mail e telefone diferentes, o sistema a enxerga como duas pessoas e os dois
            horários passam.
          </p>
        )}
      </div>

      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}

      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
