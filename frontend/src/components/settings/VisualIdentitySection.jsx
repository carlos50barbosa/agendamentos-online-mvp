// src/components/settings/VisualIdentitySection.jsx
// Tópico "Identidade visual": cores da página pública, com preview ao vivo.
// Save parcial via Api.updateEstablishmentProfile.
import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import { buildPublicThemeStyle, normalizeHexColor } from '../../utils/publicTheme.js';
import { mapProfileError } from './helpers.js';
import './settings.css';

export default function VisualIdentitySection() {
  const [status, setStatus] = useState('loading');
  const [id, setId] = useState(null);
  const [form, setForm] = useState({ accent_color: '', accent_strong_color: '' });
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
        setForm({ accent_color: p.accent_color || '', accent_strong_color: p.accent_strong_color || '' });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const previewStyle = useMemo(
    () => buildPublicThemeStyle({ accent: form.accent_color || '#5049E5', accentStrong: form.accent_strong_color }),
    [form.accent_color, form.accent_strong_color],
  );

  const resetColors = () => {
    if (!window.confirm('Voltar às cores padrão? A cor personalizada será removida.')) return;
    setForm({ accent_color: '', accent_strong_color: '' });
  };

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      await Api.updateEstablishmentProfile(id, {
        accent_color: normalizeHexColor(form.accent_color) || '',
        accent_strong_color: normalizeHexColor(form.accent_strong_color) || '',
      });
      setFeedback({ type: 'success', message: 'Identidade visual salva com sucesso.' });
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
          <h4 className="set-block__title">Identidade visual</h4>
          <p className="set-block__sub">As cores dos botões e destaques da sua página pública de agendamento.</p>
        </div>
        <div className="set-theme">
          <div className="set-theme__preview" style={previewStyle} aria-hidden="true">
            <div className="set-theme__bar">Sua página</div>
            <div className="set-theme__body">
              <span className="set-theme__btn">Agendar</span>
              <span className="set-theme__chip">Destaque</span>
            </div>
          </div>
          <div>
            <div className="set-grid">
              <label className="label">
                <span>Cor principal</span>
                <div className="set-color">
                  <input type="color" value={normalizeHexColor(form.accent_color) || '#5049E5'} onChange={(e) => set('accent_color', e.target.value)} aria-label="Selecionar cor principal" />
                  <input className="input" maxLength={7} value={form.accent_color} onChange={(e) => set('accent_color', e.target.value)} onBlur={(e) => set('accent_color', normalizeHexColor(e.target.value) || '')} placeholder="#5049E5" spellCheck={false} />
                </div>
                <span className="set-counter">Botões, ícones e destaques.</span>
              </label>
              <label className="label">
                <span>Cor de destaque</span>
                <div className="set-color">
                  <input type="color" value={normalizeHexColor(form.accent_strong_color) || '#1E1B4B'} onChange={(e) => set('accent_strong_color', e.target.value)} aria-label="Selecionar cor de destaque" />
                  <input className="input" maxLength={7} value={form.accent_strong_color} onChange={(e) => set('accent_strong_color', e.target.value)} onBlur={(e) => set('accent_strong_color', normalizeHexColor(e.target.value) || '')} placeholder="#1E1B4B" spellCheck={false} />
                </div>
                <span className="set-counter">Títulos e o degradê do topo da página.</span>
              </label>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={resetColors} style={{ marginTop: 8 }}>Usar cores padrão</button>
          </div>
        </div>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar identidade visual'}</button>
      </div>
    </form>
  );
}
