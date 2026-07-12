// src/components/settings/DescriptionSection.jsx
// Tópico "Descrição": sobre + telefone público. Save parcial via Api.updateEstablishmentProfile.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import { onlyDigits, formatPhoneBR, mapProfileError } from './helpers.js';
import './settings.css';

export default function DescriptionSection() {
  const [status, setStatus] = useState('loading');
  const [id, setId] = useState(null);
  const [form, setForm] = useState({ sobre: '', contato_telefone: '' });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const est = await Api.getEstablishment(user.id);
        if (!alive) return;
        const p = est?.profile || {};
        setId(user.id);
        setForm({ sobre: p.sobre || '', contato_telefone: p.contato_telefone ? formatPhoneBR(p.contato_telefone) : '' });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      await Api.updateEstablishmentProfile(id, { sobre: form.sobre.trim(), contato_telefone: onlyDigits(form.contato_telefone) });
      setFeedback({ type: 'success', message: 'Descrição salva com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: mapProfileError(err) });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Descrição</h4>
          <p className="set-block__sub">O texto e o telefone aparecem na sua página pública de agendamento.</p>
        </div>
        <label className="label">
          <span>Sobre o negócio</span>
          <textarea className="input" rows={4} maxLength={1200} value={form.sobre} onChange={(e) => setForm((f) => ({ ...f, sobre: e.target.value }))}
            placeholder="Ex.: Barbearia especializada em cortes clássicos e barba, com atendimento por hora marcada." />
          <span className="set-counter">{form.sobre.length}/1200</span>
        </label>
        <label className="label" style={{ maxWidth: 280 }}>
          <span>Telefone público (WhatsApp)</span>
          <input className="input" inputMode="tel" value={form.contato_telefone} onChange={(e) => setForm((f) => ({ ...f, contato_telefone: formatPhoneBR(e.target.value) }))} placeholder="(11) 91234-5678" />
        </label>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar descrição'}</button>
      </div>
    </form>
  );
}
