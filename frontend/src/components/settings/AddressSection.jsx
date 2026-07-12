// src/components/settings/AddressSection.jsx
// Tópico "Endereço" (estabelecimento). Save parcial via Api.updateProfile — sem senha atual.
// CEP preenche o restante automaticamente (ViaCEP, best-effort).
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import { onlyDigits, formatCep, UFS } from './helpers.js';
import './settings.css';

const EMPTY = { cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' };

export default function AddressSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [cepBusy, setCepBusy] = useState(false);
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
        setForm({
          cep: u.cep ? formatCep(u.cep) : '', endereco: u.endereco || '', numero: u.numero || '',
          complemento: u.complemento || '', bairro: u.bairro || '', cidade: u.cidade || '', estado: u.estado || '',
        });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const lookupCep = async () => {
    const digits = onlyDigits(form.cep);
    if (digits.length !== 8) return;
    setCepBusy(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await r.json();
      if (!data?.erro) {
        setForm((f) => ({
          ...f,
          endereco: f.endereco || data.logradouro || '',
          bairro: f.bairro || data.bairro || '',
          cidade: f.cidade || data.localidade || '',
          estado: f.estado || (data.uf || '').toUpperCase(),
        }));
      }
    } catch { /* silencioso */ } finally { setCepBusy(false); }
  };

  const onSave = async (e) => {
    e.preventDefault();
    setFeedback(null);
    if (onlyDigits(form.cep).length !== 8) { setFeedback({ type: 'error', message: 'Informe um CEP válido (8 dígitos).' }); return; }
    if (!form.endereco.trim() || !form.numero.trim() || !form.bairro.trim() || !form.cidade.trim()) { setFeedback({ type: 'error', message: 'Preencha o endereço completo.' }); return; }
    if (!/^[A-Za-z]{2}$/.test(form.estado)) { setFeedback({ type: 'error', message: 'Selecione a UF.' }); return; }
    setBusy(true);
    try {
      const resp = await Api.updateProfile({
        cep: onlyDigits(form.cep), endereco: form.endereco.trim(), numero: form.numero.trim(),
        complemento: form.complemento.trim(), bairro: form.bairro.trim(), cidade: form.cidade.trim(), estado: form.estado.toUpperCase(),
      });
      if (resp?.user) saveUser(resp.user);
      setFeedback({ type: 'success', message: 'Endereço salvo com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar o endereço.' });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar o endereço. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Endereço</h4>
          <p className="set-block__sub">Usado na operação e na sua página pública. O CEP preenche o resto automaticamente.</p>
        </div>
        <div className="set-grid">
          <label className="label"><span>CEP</span>
            <input className="input" inputMode="numeric" value={form.cep} onChange={(e) => set('cep', formatCep(e.target.value))} onBlur={lookupCep} placeholder="00000-000" />
            {cepBusy && <span className="set-counter">Buscando endereço…</span>}
          </label>
          <label className="label" style={{ gridColumn: 'span 2', minWidth: 0 }}><span>Endereço</span>
            <input className="input" value={form.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Rua, avenida…" /></label>
        </div>
        <div className="set-grid">
          <label className="label"><span>Número</span>
            <input className="input" value={form.numero} onChange={(e) => set('numero', e.target.value)} placeholder="123" /></label>
          <label className="label"><span>Complemento <em className="muted">(opcional)</em></span>
            <input className="input" value={form.complemento} onChange={(e) => set('complemento', e.target.value)} placeholder="Sala, andar…" /></label>
          <label className="label"><span>Bairro</span>
            <input className="input" value={form.bairro} onChange={(e) => set('bairro', e.target.value)} placeholder="Bairro" /></label>
        </div>
        <div className="set-grid">
          <label className="label"><span>Cidade</span>
            <input className="input" value={form.cidade} onChange={(e) => set('cidade', e.target.value)} placeholder="Cidade" /></label>
          <label className="label"><span>Estado (UF)</span>
            <select className="input" value={form.estado} onChange={(e) => set('estado', e.target.value)}>
              <option value="">UF</option>
              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </label>
        </div>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar endereço'}</button>
      </div>
    </form>
  );
}
