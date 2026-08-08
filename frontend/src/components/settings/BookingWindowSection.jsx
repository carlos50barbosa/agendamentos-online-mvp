// src/components/settings/BookingWindowSection.jsx
// Janela de agendamento: até onde no futuro o cliente pode marcar pelo link público.
//
// Nasceu do pedido de quem trabalha com planos de assinatura: com a agenda sem horizonte, o
// assinante — que já pagou a mensalidade e não tem custo por sessão — marcava o mês inteiro
// e faltava em parte, e o horário ficava ocupado para quem iria.
//
// Vale para quem agenda pelo link público (e para o bot do WhatsApp). O próprio dono NÃO é
// limitado: pelo painel ele marca qualquer data, porque o horizonte é regra para o cliente.
import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import './settings.css';

const DIAS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];

const fmtInstante = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

export default function BookingWindowSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ modo: 'livre', abreDia: 0, abreHora: 0, semanas: 1 });
  const [previa, setPrevia] = useState({ limite: null, abre_em: null });
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
        const janela = data?.janela || {};
        setForm({
          modo: janela.modo === 'semanal' ? 'semanal' : 'livre',
          abreDia: Number.isFinite(Number(janela.abre_dia)) ? Number(janela.abre_dia) : 0,
          abreHora: Number.isFinite(Number(janela.abre_hora)) ? Number(janela.abre_hora) : 0,
          semanas: Number(janela.semanas) > 0 ? Number(janela.semanas) : 1,
        });
        setPrevia({ limite: janela.limite || null, abre_em: janela.abre_em || null });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const ligada = form.modo === 'semanal';

  // O efeito em português, com os dados que o backend devolveu. O dono precisa conferir que
  // configurou o que queria ANTES de descobrir pelo cliente reclamando que a agenda sumiu.
  const resumo = useMemo(() => {
    if (!ligada) return 'Hoje o cliente pode marcar em qualquer data futura.';
    const ate = fmtInstante(previa.limite);
    const abre = fmtInstante(previa.abre_em);
    if (!ate) return null;
    const dia = DIAS.find((d) => d.value === form.abreDia)?.label?.toLowerCase() || 'domingo';
    const hora = `${String(form.abreHora).padStart(2, '0')}h`;
    return `Agora o cliente consegue marcar até ${ate}. A próxima leva abre ${abre || `${dia}, ${hora}`}.`;
  }, [ligada, previa, form.abreDia, form.abreHora]);

  const onSave = async (e) => {
    e.preventDefault();
    setSaving(true); setFeedback(null);
    try {
      const resp = await Api.updateEstablishmentBookingWindow({
        modo: form.modo,
        abreDia: form.abreDia,
        abreHora: form.abreHora,
        semanas: form.semanas,
      });
      const janela = resp?.janela || {};
      setPrevia({ limite: janela.limite || null, abre_em: janela.abre_em || null });
      setFeedback({ type: 'success', message: 'Janela de agendamento salva.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar a janela.' });
    } finally { setSaving(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar a janela. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Janela de agendamento</h4>
          <p className="set-block__sub">
            Até onde no futuro o cliente pode marcar pela sua página. Você continua marcando
            qualquer data pelo painel — o limite vale só para quem agenda pelo link.
          </p>
        </div>

        <label className="label">
          <span>Como a agenda abre</span>
          <select
            className="input"
            value={form.modo}
            onChange={(e) => setForm((p) => ({ ...p, modo: e.target.value }))}
          >
            <option value="livre">Sempre aberta (qualquer data futura)</option>
            <option value="semanal">Abre por semana, em dia fixo</option>
          </select>
        </label>

        {ligada && (
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <label className="label" style={{ flex: '1 1 180px' }}>
              <span>Abre toda</span>
              <select
                className="input"
                value={form.abreDia}
                onChange={(e) => setForm((p) => ({ ...p, abreDia: Number(e.target.value) }))}
              >
                {DIAS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>

            <label className="label" style={{ flex: '1 1 120px' }}>
              <span>às</span>
              <select
                className="input"
                value={form.abreHora}
                onChange={(e) => setForm((p) => ({ ...p, abreHora: Number(e.target.value) }))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>

            <label className="label" style={{ flex: '1 1 160px' }}>
              <span>Semanas abertas</span>
              <select
                className="input"
                value={form.semanas}
                onChange={(e) => setForm((p) => ({ ...p, semanas: Number(e.target.value) }))}
              >
                <option value={1}>1 (só a semana vigente)</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          </div>
        )}

        {resumo && (
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>{resumo}</p>
        )}

        {/* Consequência que o dono só descobriria pelo cliente reclamando: com 1 semana, no
            sábado à tarde sobra quase nada para marcar. Dizer isso aqui é mais barato do que
            ele desligar o recurso achando que quebrou. */}
        {ligada && form.semanas === 1 && (
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Atenção: com 1 semana, perto da virada o cliente enxerga poucos dias. Se ficar
            apertado demais, use 2 semanas ou antecipe o dia de abertura.
          </p>
        )}
      </div>

      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}

      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar janela'}
        </button>
      </div>
    </form>
  );
}
