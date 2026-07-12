// src/components/settings/SecuritySection.jsx
// Tópico "Segurança": troca de senha. Exige a senha atual (Api.updateProfile com senhaNova).
import React, { useState } from 'react';
import { Api } from '../../utils/api';
import './settings.css';

export default function SecuritySection() {
  const [pwd, setPwd] = useState({ atual: '', nova: '', confirmar: '' });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const onSave = async (e) => {
    e.preventDefault();
    setFeedback(null);
    if (!pwd.atual.trim()) { setFeedback({ type: 'error', message: 'Informe a senha atual.' }); return; }
    if (pwd.nova.length < 6) { setFeedback({ type: 'error', message: 'A nova senha deve ter ao menos 6 caracteres.' }); return; }
    if (pwd.nova !== pwd.confirmar) { setFeedback({ type: 'error', message: 'A nova senha e a confirmação não coincidem.' }); return; }
    setBusy(true);
    try {
      await Api.updateProfile({ senhaAtual: pwd.atual, senhaNova: pwd.nova });
      setPwd({ atual: '', nova: '', confirmar: '' });
      setFeedback({ type: 'success', message: 'Senha alterada com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível alterar a senha.' });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Alterar senha</h4>
          <p className="set-block__sub">Altere sua senha de acesso.</p>
        </div>
        <div className="set-grid">
          <label className="label"><span>Senha atual</span>
            <input className="input" type="password" autoComplete="current-password" value={pwd.atual} onChange={(e) => setPwd((p) => ({ ...p, atual: e.target.value }))} placeholder="Sua senha atual" /></label>
          <label className="label"><span>Nova senha</span>
            <input className="input" type="password" autoComplete="new-password" value={pwd.nova} onChange={(e) => setPwd((p) => ({ ...p, nova: e.target.value }))} placeholder="Mínimo 6 caracteres" /></label>
          <label className="label"><span>Confirmar nova senha</span>
            <input className="input" type="password" autoComplete="new-password" value={pwd.confirmar} onChange={(e) => setPwd((p) => ({ ...p, confirmar: e.target.value }))} placeholder="Repita a nova senha" /></label>
        </div>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha'}</button>
      </div>
    </form>
  );
}
