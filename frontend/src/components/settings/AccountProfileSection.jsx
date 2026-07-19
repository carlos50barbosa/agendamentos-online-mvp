// src/components/settings/AccountProfileSection.jsx
// Tópico "Perfil": foto do perfil + nome, e-mail e telefone. Save parcial via Api.updateProfile.
// A foto é um alvo clicável/arrastável e salva na hora (updateProfile parcial, sem senha).
// Trocar o e-mail exige a senha atual e dispara o fluxo de confirmação por código.
import React, { useEffect, useRef, useState } from 'react';
import { Api, resolveAssetUrl } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import { onlyDigits, formatPhoneBR } from './helpers.js';
import { compressImageToDataUrl, MAX_ENTRADA_BYTES } from '../../utils/imageCompress';
import './settings.css';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp';
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function IconCamera(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

export default function AccountProfileSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ nome: '', email: '', telefone: '' });
  const [originalEmail, setOriginalEmail] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [pendingEmail, setPendingEmail] = useState(null);
  const [emailCode, setEmailCode] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarOver, setAvatarOver] = useState(false);
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
  const avatarPreview = avatarUrl ? resolveAssetUrl(avatarUrl) : '';

  // ---- foto do perfil (salva assim que escolhe) ----
  const acceptAvatar = async (file) => {
    setFeedback(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setFeedback({ type: 'error', message: 'Formato não aceito. Envie PNG, JPG ou WEBP.' });
      return;
    }
    if (file.size > MAX_ENTRADA_BYTES) {
      setFeedback({ type: 'error', message: `A imagem tem ${formatSize(file.size)} — está grande demais para processar.` });
      return;
    }
    setAvatarBusy(true);
    try {
      // Comprime antes de medir: foto de celular passa do limite crua mas cabe folgada
      // depois de reduzida. Se a compressao falhar, `dataUrl` e' o arquivo original.
      const { dataUrl, bytes } = await compressImageToDataUrl(file, { maxDimensao: 512 });
      if (bytes > AVATAR_MAX_BYTES) {
        setFeedback({ type: 'error', message: `A imagem tem ${formatSize(bytes)} — o limite é 2 MB.` });
        return;
      }
      const resp = await Api.updateProfile({ avatar: dataUrl });
      if (resp?.user) { saveUser(resp.user); setAvatarUrl(resp.user.avatar_url || ''); }
      setFeedback({ type: 'success', message: 'Foto do perfil atualizada.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar a foto.' });
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
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

  const openPicker = () => { if (!avatarBusy) fileRef.current?.click(); };

  // ---- dados da conta ----
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
      if (resp?.user) {
        saveUser(resp.user);
        setForm((f) => ({ ...f, email: resp.user.email || f.email }));
        setOriginalEmail(String(resp.user.email || '').trim().toLowerCase());
      }
      setPendingEmail(null); setEmailCode('');
      setFeedback({ type: 'success', message: 'E-mail confirmado com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível confirmar o e-mail.' });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar seus dados. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Perfil</h4>
          <p className="set-block__sub">Sua foto e seus dados de identificação e acesso.</p>
        </div>

        {/* Foto do perfil — clicável e aceita arrastar-e-soltar */}
        <div className="set-ava">
          <div
            className={[
              'set-ava__drop',
              avatarPreview ? 'is-filled' : '',
              avatarOver ? 'is-over' : '',
              avatarBusy ? 'is-busy' : '',
            ].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
            onDragOver={(e) => { e.preventDefault(); setAvatarOver(true); }}
            onDragLeave={() => setAvatarOver(false)}
            onDrop={(e) => { e.preventDefault(); setAvatarOver(false); acceptAvatar(e.dataTransfer?.files?.[0]); }}
            aria-label={avatarPreview ? 'Trocar foto do perfil' : 'Adicionar foto do perfil'}
            title={avatarPreview ? 'Trocar foto do perfil' : 'Adicionar foto do perfil'}
          >
            {avatarPreview
              ? <img src={avatarPreview} alt="Foto do perfil" draggable={false} />
              : <IconCamera />}

            <span className="set-ava__overlay" aria-hidden="true">
              <IconCamera width="18" height="18" />
              <em>{avatarPreview ? 'Trocar' : 'Adicionar'}</em>
            </span>

            {avatarBusy && <span className="set-ava__spinner" aria-hidden="true" />}
          </div>

          <div className="set-ava__copy">
            <strong>Foto do perfil</strong>
            <span className="muted">Clique na foto ou arraste uma imagem aqui.</span>
            <span className="muted">PNG, JPG ou WEBP · até 2 MB · salva assim que você escolhe.</span>
            <div className="set-ava__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={openPicker} disabled={avatarBusy}>
                {avatarPreview ? 'Trocar foto' : 'Selecionar foto'}
              </button>
              {avatarPreview && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onRemoveAvatar} disabled={avatarBusy}>Remover</button>
              )}
            </div>
          </div>

          <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => acceptAvatar(e.target.files?.[0])} style={{ display: 'none' }} />
        </div>

        <div className="set-grid">
          <label className="label"><span>Nome</span>
            <input className="input" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Seu nome ou do estabelecimento" required />
          </label>
          <label className="label"><span>E-mail</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="voce@exemplo.com" required />
          </label>
          <label className="label"><span>Telefone (WhatsApp)</span>
            <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: formatPhoneBR(e.target.value) }))} placeholder="(11) 91234-5678" />
          </label>
        </div>

        {emailChanged && !pendingEmail && (
          <label className="label" style={{ maxWidth: 320 }}>
            <span>Senha atual <em className="muted">(para trocar o e-mail)</em></span>
            <input className="input" type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} placeholder="Confirme sua senha" />
          </label>
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
