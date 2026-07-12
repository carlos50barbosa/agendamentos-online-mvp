// src/components/settings/AccountProfileSection.jsx
// Tópico "Perfil": foto do perfil + nome, e-mail e telefone. Save parcial via Api.updateProfile.
// A foto salva na hora (updateProfile parcial, sem senha). Trocar o e-mail exige a senha atual
// e dispara o fluxo de confirmação por código.
import React, { useEffect, useRef, useState } from 'react';
import { Api, resolveAssetUrl } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import { onlyDigits, formatPhoneBR } from './helpers.js';
import './settings.css';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export default function AccountProfileSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ nome: '', email: '', telefone: '' });
  const [originalEmail, setOriginalEmail] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [pendingEmail, setPendingEmail] = useState(null);
  const [emailCode, setEmailCode] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await Api.me();
        if (!alive) return;
        const u = resp?.user || getUser() || {};
        setForm({ nome: u.nome || '', email: u.email || '', telefone: u.telefone ? formatPhoneBR(u.telefone) : '' });
        setOriginalEmail(String(u.email || '').trim().toLowerCase());
        setAvatarUrl(u.avatar_url || '');
        setPendingEmail(resp?.emailConfirmation?.pending ? { newEmail: resp.emailConfirmation.newEmail } : null);
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const emailChanged = form.email.trim().toLowerCase() !== originalEmail;

  const onSelectAvatar = (e) => {
    setFeedback(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > AVATAR_MAX_BYTES) { setFeedback({ type: 'error', message: 'A foto deve ter no máximo 2 MB.' }); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setAvatarBusy(true);
      try {
        const resp = await Api.updateProfile({ avatar: reader.result });
        if (resp?.user) { saveUser(resp.user); setAvatarUrl(resp.user.avatar_url || ''); }
        setFeedback({ type: 'success', message: 'Foto do perfil atualizada.' });
      } catch (err) {
        setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar a foto.' });
      } finally { setAvatarBusy(false); if (fileRef.current) fileRef.current.value = ''; }
    };
    reader.onerror = () => setFeedback({ type: 'error', message: 'Não foi possível ler a imagem.' });
    reader.readAsDataURL(f);
  };

  const onRemoveAvatar = async () => {
    if (!window.confirm('Remover a foto do perfil?')) return;
    setAvatarBusy(true); setFeedback(null);
    try {
      const resp = await Api.updateProfile({ avatarRemove: true });
      if (resp?.user) saveUser(resp.user);
      setAvatarUrl('');
      setFeedback({ type: 'success', message: 'Foto do perfil removida.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível remover a foto.' });
    } finally { setAvatarBusy(false); }
  };

  const onSave = async (e) => {
    e.preventDefault();
    setFeedback(null);
    if (!form.nome.trim()) { setFeedback({ type: 'error', message: 'Informe seu nome.' }); return; }
    if (!form.email.trim()) { setFeedback({ type: 'error', message: 'Informe um e-mail.' }); return; }
    if (emailChanged && !senhaAtual.trim()) { setFeedback({ type: 'error', message: 'Para trocar o e-mail, confirme sua senha atual.' }); return; }
    setBusy(true);
    try {
      const payload = { nome: form.nome.trim(), email: form.email.trim(), telefone: onlyDigits(form.telefone) };
      if (emailChanged) payload.senhaAtual = senhaAtual;
      const resp = await Api.updateProfile(payload);
      if (resp?.user) saveUser(resp.user);
      setSenhaAtual('');
      if (resp?.emailConfirmation?.pending) {
        setPendingEmail({ newEmail: resp.emailConfirmation.newEmail });
        setFeedback({ type: 'success', message: 'Dados salvos. Enviamos um código para o novo e-mail — confirme abaixo.' });
      } else {
        setOriginalEmail(form.email.trim().toLowerCase());
        setFeedback({ type: 'success', message: 'Perfil salvo com sucesso.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar. Tente novamente.' });
    } finally { setBusy(false); }
  };

  const confirmEmail = async () => {
    if (!/^\d{6}$/.test(emailCode)) { setFeedback({ type: 'error', message: 'Informe o código de 6 dígitos.' }); return; }
    setBusy(true); setFeedback(null);
    try {
      const resp = await Api.confirmEmailChange({ code: emailCode });
      if (resp?.user) { saveUser(resp.user); setForm((f) => ({ ...f, email: resp.user.email || f.email })); setOriginalEmail(String(resp.user.email || '').trim().toLowerCase()); }
      setPendingEmail(null); setEmailCode('');
      setFeedback({ type: 'success', message: 'E-mail confirmado com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível confirmar o e-mail.' });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar seus dados. Recarregue a página.</p>;

  const avatarPreview = avatarUrl ? resolveAssetUrl(avatarUrl) : '';

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Perfil</h4>
          <p className="set-block__sub">Sua foto e seus dados de identificação e acesso.</p>
        </div>

        <div className="set-avatar">
          <div className="set-avatar__preview">
            {avatarPreview ? <img src={avatarPreview} alt="Foto do perfil" /> : <span className="muted">Sem foto</span>}
          </div>
          <div className="set-avatar__copy">
            <strong>{avatarBusy ? 'Salvando…' : 'Foto do perfil'}</strong>
            <span className="muted">PNG, JPG ou WEBP · até 2 MB. Salva ao escolher.</span>
            <div className="set-avatar__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>Selecionar foto</button>
              {avatarPreview && <button type="button" className="btn btn--ghost btn--sm" onClick={onRemoveAvatar} disabled={avatarBusy}>Remover</button>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onSelectAvatar} style={{ display: 'none' }} />
            </div>
          </div>
        </div>

        <div className="set-grid">
          <label className="label"><span>Nome</span>
            <input className="input" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Seu nome ou do estabelecimento" required /></label>
          <label className="label"><span>E-mail</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="voce@exemplo.com" required /></label>
          <label className="label"><span>Telefone (WhatsApp)</span>
            <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: formatPhoneBR(e.target.value) }))} placeholder="(11) 91234-5678" /></label>
        </div>
        {emailChanged && !pendingEmail && (
          <label className="label" style={{ maxWidth: 320 }}><span>Senha atual <em className="muted">(para trocar o e-mail)</em></span>
            <input className="input" type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} placeholder="Confirme sua senha" /></label>
        )}
        {pendingEmail && (
          <div className="notice notice--info" role="status">
            <p style={{ margin: '0 0 8px' }}>Confirme o novo e-mail <strong>{pendingEmail.newEmail}</strong> com o código enviado (válido por 30 min).</p>
            <div className="set-inline">
              <input className="input" inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(onlyDigits(e.target.value))} placeholder="Código de 6 dígitos" style={{ maxWidth: 180 }} />
              <button type="button" className="btn btn--primary btn--sm" onClick={confirmEmail} disabled={busy}>Confirmar e-mail</button>
            </div>
          </div>
        )}
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  );
}
