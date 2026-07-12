// src/components/settings/PublicLinkSection.jsx
// Editor do link curto da página pública (agenda0.com.br/<slug>).
// Reaproveitado em /configuracoes (tópico "Link da página") e em /divulgacao (Meu QR Code).
// Avisa o pai via onSaved(slug) para que o QR Code/cartão sejam regerados na hora.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import { publicOrigin, SLUG_RE, slugify } from './helpers.js';
import './settings.css';

export default function PublicLinkSection({ onSaved, compact = false }) {
  const [status, setStatus] = useState('loading');
  const [id, setId] = useState(null);
  const [slug, setSlug] = useState('');
  const [original, setOriginal] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    setId(user.id);
    (async () => {
      try {
        const est = await Api.getEstablishment(user.id);
        if (!alive) return;
        const s = String(est?.slug || '').trim();
        setSlug(s);
        setOriginal(s);
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const host = publicOrigin().replace(/^https?:\/\//, '');
  const valid = SLUG_RE.test(slug) && slug.length >= 3 && slug.length <= 160;
  const changed = slug !== original;

  const onSave = async (e) => {
    e.preventDefault();
    setFeedback(null);
    if (!valid) {
      setFeedback({ type: 'error', message: 'Use apenas letras minúsculas, números e hifens. Mínimo 3 caracteres.' });
      return;
    }
    setBusy(true);
    try {
      const resp = await Api.updateEstablishmentSlug(id, slug);
      const saved = String(resp?.slug || slug);
      setSlug(saved);
      setOriginal(saved);
      const u = getUser();
      if (u) saveUser({ ...u, slug: saved }); // mantém o menu e o QR em dia
      setFeedback({ type: 'success', message: 'Link salvo com sucesso.' });
      if (onSaved) onSaved(saved);
    } catch (err) {
      const code = err?.data?.error;
      const message =
        code === 'slug_taken' ? 'Esse link já está em uso por outro estabelecimento. Escolha outro.'
        : code === 'slug_reserved' ? 'Esse link é reservado pelo sistema. Escolha outro.'
        : (err?.data?.message || 'Não foi possível salvar o link.');
      setFeedback({ type: 'error', message });
    } finally { setBusy(false); }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${publicOrigin()}/${original}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar o link. Recarregue a página.</p>;

  const body = (
    <>
      <label className="label">
        <span>Seu link</span>
        <div className="set-slug">
          <span className="set-slug__host">{host}/</span>
          <input
            className="input"
            value={slug}
            onChange={(ev) => setSlug(slugify(ev.target.value))}
            placeholder="studio-e-barber"
            maxLength={160}
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
        <span className="set-counter">Letras minúsculas, números e hifens. Mínimo 3 caracteres.</span>
      </label>

      {original && !changed && (
        <div className="set-inline">
          <a className="set-promo__link" href={`${publicOrigin()}/${original}`} target="_blank" rel="noreferrer">
            {host}/{original}
          </a>
          <button type="button" className="btn btn--outline btn--sm" onClick={copyLink}>
            {copied ? 'Copiado!' : 'Copiar link'}
          </button>
        </div>
      )}

      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}

      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !changed || !valid}>
          {busy ? 'Salvando…' : 'Salvar link'}
        </button>
      </div>
    </>
  );

  if (compact) {
    return <form onSubmit={onSave} className="set-section">{body}</form>;
  }

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Link da página</h4>
          <p className="set-block__sub">O endereço curto que você divulga. Ex.: <code>{host}/studio-e-barber</code></p>
        </div>
        {body}
      </div>
    </form>
  );
}
