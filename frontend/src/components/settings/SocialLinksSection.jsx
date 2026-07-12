// src/components/settings/SocialLinksSection.jsx
// Tópico "Redes sociais": links das redes. Save parcial via Api.updateEstablishmentProfile.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import { mapProfileError } from './helpers.js';
import './settings.css';

const SOCIALS = [
  { key: 'instagram_url', label: 'Instagram', placeholder: 'instagram.com/seuperfil' },
  { key: 'facebook_url', label: 'Facebook', placeholder: 'facebook.com/suapagina' },
  { key: 'site_url', label: 'Site', placeholder: 'seusite.com.br' },
  { key: 'youtube_url', label: 'YouTube', placeholder: 'youtube.com/@seucanal' },
  { key: 'tiktok_url', label: 'TikTok', placeholder: 'tiktok.com/@seuperfil' },
  { key: 'linkedin_url', label: 'LinkedIn', placeholder: 'linkedin.com/company/seuperfil' },
];

const EMPTY = { instagram_url: '', facebook_url: '', site_url: '', youtube_url: '', tiktok_url: '', linkedin_url: '' };

export default function SocialLinksSection() {
  const [status, setStatus] = useState('loading');
  const [id, setId] = useState(null);
  const [form, setForm] = useState(EMPTY);
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
        setForm({
          instagram_url: p.instagram_url || '', facebook_url: p.facebook_url || '', site_url: p.site_url || '',
          youtube_url: p.youtube_url || '', tiktok_url: p.tiktok_url || '', linkedin_url: p.linkedin_url || '',
        });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      const payload = {};
      SOCIALS.forEach((s) => { payload[s.key] = (form[s.key] || '').trim(); });
      await Api.updateEstablishmentProfile(id, payload);
      setFeedback({ type: 'success', message: 'Redes sociais salvas com sucesso.' });
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
          <h4 className="set-block__title">Redes sociais</h4>
          <p className="set-block__sub">Links exibidos na sua página pública. Deixe em branco os que não usar.</p>
        </div>
        <div className="set-grid">
          {SOCIALS.map((s) => (
            <label key={s.key} className="label">
              <span>{s.label}</span>
              <input className="input" type="url" inputMode="url" value={form[s.key]} onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.value }))} placeholder={s.placeholder} />
            </label>
          ))}
        </div>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar redes sociais'}</button>
      </div>
    </form>
  );
}
