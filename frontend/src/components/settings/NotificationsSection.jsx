// src/components/settings/NotificationsSection.jsx
// Tópico "Notificações" (estabelecimento). Save parcial via Api.updateProfile — sem senha atual.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import './settings.css';

export default function NotificationsSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ email: false, whatsapp: false });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (user?.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const resp = await Api.me();
        if (!alive) return;
        const u = resp?.user || getUser() || {};
        setForm({ email: Boolean(u.notify_email_estab), whatsapp: Boolean(u.notify_whatsapp_estab) });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      const resp = await Api.updateProfile({ notifyEmailEstab: form.email, notifyWhatsappEstab: form.whatsapp });
      if (resp?.user) saveUser(resp.user);
      setFeedback({ type: 'success', message: 'Preferências salvas.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar.' });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Notificações</h4>
          <p className="set-block__sub">Como você quer receber avisos de novos agendamentos.</p>
        </div>
        <label className="set-switch">
          <input type="checkbox" checked={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.checked }))} />
          <span>Receber notificações por e-mail</span>
        </label>
        <label className="set-switch">
          <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.checked }))} />
          <span>Receber notificações no WhatsApp</span>
        </label>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  );
}
