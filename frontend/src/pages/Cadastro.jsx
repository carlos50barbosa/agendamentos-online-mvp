
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LogoAO from '../components/LogoAO.jsx';
import { IconChevronRight, IconUser, IconWrench } from '../components/Icons.jsx';
import { Api } from '../utils/api';
import { saveToken, saveUser } from '../utils/auth';
import { LEGAL_METADATA } from '../utils/legal.js';

const formatBRPhone = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const normalizeToE164BR = (value = '') => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const formatCep = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

export default function Cadastro() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    tipo: '',
    telefone: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
  });
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [cepStatus, setCepStatus] = useState({ loading: false, error: '' });
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const legalMeta = useMemo(() => LEGAL_METADATA, []);

  const phoneDigits = (form.telefone || '').replace(/\D/g, '');
  const cepDigits = form.cep.replace(/\D/g, '');
  const isEstab = form.tipo === 'estabelecimento';

  const emailReady = useMemo(() => {
    const email = form.email.trim();
    const confirm = confirmEmail.trim();
    if (!email || !confirm) return false;
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) return false;
    return email.toLowerCase() === confirm.toLowerCase();
  }, [form.email, confirmEmail]);
  const senhaScore = useMemo(() => {
    const s = form.senha || '';
    let pts = 0;
    if (s.length >= 8) pts++;
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) pts++;
    if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) pts++;
    return pts;
  }, [form.senha]);
  const senhaLabel = ['Fraca', 'Razoavel', 'Boa', 'Forte'][senhaScore];

  const senhaOk = form.senha.length >= 8 && /[^A-Za-z0-9]/.test(form.senha);
  const matchOk = form.senha && confirm && form.senha === confirm;
  const nomeOk = form.nome.trim().length >= 2;

  const phoneOk = useMemo(() => {
    if (!phoneDigits) return false;
    if (phoneDigits.startsWith('55')) return phoneDigits.length === 12 || phoneDigits.length === 13;
    return phoneDigits.length === 10 || phoneDigits.length === 11;
  }, [phoneDigits]);

  const addressOk = useMemo(() => {
    if (!isEstab) return true;
    return (
      cepDigits.length === 8 &&
      form.endereco.trim() &&
      form.numero.trim() &&
      form.bairro.trim() &&
      form.cidade.trim() &&
      /^[A-Za-z]{2}$/.test(form.estado.trim())
    );
  }, [isEstab, cepDigits.length, form.endereco, form.numero, form.bairro, form.cidade, form.estado]);

  const disabled =
    loading ||
    !nomeOk ||
    !emailReady ||
    !senhaOk ||
    !matchOk ||
    !phoneOk ||
    !form.tipo ||
    !addressOk ||
    !acceptPolicies;

  useEffect(() => {
    const digits = cepDigits;
    if (digits.length !== 8) {
      setCepStatus({ loading: false, error: '' });
      return;
    }

    let active = true;
    setCepStatus({ loading: true, error: '' });

    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (!data || data.erro) {
          setCepStatus({ loading: false, error: 'CEP nao encontrado.' });
          return;
        }
        setForm((prev) => ({
          ...prev,
          cep: formatCep(digits),
          endereco: data.logradouro || prev.endereco,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          estado: (data.uf || prev.estado || '').toUpperCase(),
        }));
        setCepStatus({ loading: false, error: '' });
      })
      .catch(() => {
        if (!active) return;
        setCepStatus({ loading: false, error: 'Não foi possível buscar o CEP.' });
      });

    return () => {
      active = false;
    };
  }, [cepDigits]);

  const updateField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setErr('');
    setSuccessMsg('');
    if (disabled) return;
    setLoading(true);
    try {
      const telefoneNorm = normalizeToE164BR(form.telefone.trim());
      const acceptanceTimestamp = new Date().toISOString();
      const payload = {
        nome: form.nome.trim(),
        email: form.email.trim(),
        senha: form.senha,
        tipo: form.tipo,
        telefone: telefoneNorm,
        cep: cepDigits || undefined,
        endereco: form.endereco.trim() || undefined,
        numero: form.numero.trim() || undefined,
        complemento: form.complemento.trim() || undefined,
        bairro: form.bairro.trim() || undefined,
        cidade: form.cidade.trim() || undefined,
        estado: form.estado.trim().toUpperCase() || undefined,
        termsVersion: legalMeta.terms?.version,
        privacyVersion: legalMeta.privacy?.version,
        termsAcceptedAt: acceptanceTimestamp,
        privacyAcceptedAt: acceptanceTimestamp,
        dataProcessingConsent: true,
      };
      const { token, user } = await Api.register(payload);
      saveToken(token);
      saveUser(user);
      setSuccessMsg('Cadastro realizado com sucesso! Redirecionando...');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      setTimeout(() => nav(user?.tipo === 'cliente' ? '/cliente' : '/estab'), 1200);
    } catch (e) {
      const message = e?.message || '';
      const friendly =
        message === 'email_exists'
          ? 'Este e-mail ja esta cadastrado.'
          : message === 'telefone_obrigatorio'
          ? 'Informe um telefone valido com DDD.'
          : message.includes('endereco')
          ? 'Verifique os campos de endereco.'
          : 'Falha ao criar conta. Tente novamente.';
      setErr(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-hero">
            <LogoAO size={48} />
            <div>
              <h2 style={{ margin: 0 }}>Criar conta</h2>
              <small>Leva menos de 2 minutos</small>
            </div>
          </div>
          {successMsg && (
            <div
              className="box"
              role="status"
              aria-live="polite"
              style={{ marginTop: 10, borderColor: 'var(--success-border)', color: 'var(--success-text)', background: 'var(--success-bg)' }}
            >
              {successMsg}
            </div>
          )}

          <form id="cadastro-form" onSubmit={submit} className="grid" style={{ gap: 10, marginTop: 10 }}>
            <div className="signup-chooser">
              <div className="signup-chooser__label">Como deseja usar?</div>
              <div className="signup-chooser__hint">Cliente agenda serviços. Estabelecimento recebe e organiza agendamentos.</div>
              <div
                className={`login-options login-options--cards signup-chooser__options${form.tipo ? ' has-selection' : ''}`}
                role="group"
                aria-label="Tipo de conta"
              >
                <button
                  type="button"
                  className={`login-option login-option--client${form.tipo === 'cliente' ? ' is-selected' : ''}`}
                  onClick={() => {
                    updateField('tipo', 'cliente');
                    try {
                      const target = document.getElementById('cadastro-nome') || document.getElementById('cadastro-form');
                      if (target) {
                        const rect = target.getBoundingClientRect();
                        const y = rect.top + window.scrollY - 80;
                        window.scrollTo({ top: y, behavior: 'smooth' });
                        setTimeout(() => target.focus?.(), 300);
                      }
                    } catch {}
                  }}
                >
                  <div className="login-option__top">
                    <span className="login-option__avatar" aria-hidden>
                      <IconUser className="login-option__icon" />
                    </span>
                    <div className="login-option__copy">
                      <span className="login-option__eyebrow">Sou Cliente</span>
                      <div className="login-option__title">Quero agendar</div>
                      <p className="login-option__desc">Marcar horarios e receber confirmacoes.</p>
                    </div>
                    <span className="login-option__cta">
                      <span>Escolher</span>
                      <IconChevronRight aria-hidden className="login-option__icon" />
                    </span>
                  </div>
                  <div className="login-option__tags" aria-hidden>
                    <span className="login-option__tag">Agendar</span>
                    <span className="login-option__tag">Lembretes</span>
                    <span className="login-option__tag">Confirmações</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`login-option login-option--business${form.tipo === 'estabelecimento' ? ' is-selected' : ''}`}
                  onClick={() => {
                    updateField('tipo', 'estabelecimento');
                    try {
                      const target = document.getElementById('cadastro-nome') || document.getElementById('cadastro-form');
                      if (target) {
                        const rect = target.getBoundingClientRect();
                        const y = rect.top + window.scrollY - 80;
                        window.scrollTo({ top: y, behavior: 'smooth' });
                        setTimeout(() => target.focus?.(), 300);
                      }
                    } catch {}
                  }}
                >
                  <div className="login-option__top">
                    <span className="login-option__avatar" aria-hidden>
                      <IconWrench className="login-option__icon" />
                    </span>
                    <div className="login-option__copy">
                      <span className="login-option__eyebrow">Sou Estabelecimento</span>
                      <div className="login-option__title">Receber agendamentos</div>
                      <p className="login-option__desc">Organizar equipe, confirmacoes e agenda online.</p>
                    </div>
                    <span className="login-option__cta">
                      <span>Escolher</span>
                      <IconChevronRight aria-hidden className="login-option__icon" />
                    </span>
                  </div>
                  <div className="login-option__tags" aria-hidden>
                    <span className="login-option__tag">Agenda online</span>
                    <span className="login-option__tag">Equipe</span>
                    <span className="login-option__tag">Relatórios</span>
                  </div>
                </button>
              </div>
              {!form.tipo && <small className="muted">Selecione uma opcao para continuar.</small>}
            </div>

            <input
              className="input"
              id="cadastro-nome"
              placeholder="Nome"
              value={form.nome}
              onChange={(e) => updateField('nome', e.target.value)}
              required
            />

            <input
              className="input"
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              autoComplete="email"
              onPaste={(e) => e.preventDefault()}
              required
            />
            {form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && (
              <small className="text-error">Informe um e-mail válido.</small>
            )}
            <input
              className="input"
              type="email"
              placeholder="Confirmar email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoComplete="off"
              onPaste={(e) => e.preventDefault()}
              required
            />
            {!!confirmEmail && form.email && form.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase() && (
              <small className="text-error">O email precisa ser igual ao campo anterior.</small>
            )}

            <input
              className="input"
              type="tel"
              inputMode="tel"
              placeholder="Telefone WhatsApp - (11) 99999-9999"
              value={formatBRPhone(form.telefone)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
                updateField('telefone', digits);
              }}
              autoComplete="tel"
              required
            />
            {!phoneOk && phoneDigits && (
              <small className="text-error">Digite todos os dígitos (DDD + número). Ex.: (11) 99999-9999</small>
            )}

            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type={showPass ? 'text' : 'password'}
                placeholder="Senha (min. 8 e 1 caractere especial)"
                value={form.senha}
                onChange={(e) => updateField('senha', e.target.value)}
                autoComplete="new-password"
                required
                style={{ minWidth: 260 }}
              />
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setShowPass((v) => !v)}
                aria-pressed={showPass}
              >
                {showPass ? 'Ocultar' : 'Mostrar'}
              </button>
              {form.senha && (
                <small className={`strength strength--${senhaLabel?.toLowerCase() || 'fraca'}`}>
                  Forca: {senhaLabel}
                </small>
              )}
              {form.senha && !senhaOk && (
                <small className="text-error">Use pelo menos 8 caracteres e 1 especial.</small>
              )}
            </div>

            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type={showConfirm ? 'text' : 'password'}
                placeholder="Confirmar senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                style={{ minWidth: 260 }}
              />
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setShowConfirm((v) => !v)}
                aria-pressed={showConfirm}
              >
                {showConfirm ? 'Ocultar' : 'Mostrar'}
              </button>
              {!!confirm && !matchOk && <small className="text-error">As senhas não coincidem.</small>}
            </div>

            {isEstab && (
              <div className="grid" style={{ gap: 8 }}>
                <label className="label">
                  <span>CEP</span>
                  <input
                    className="input"
                    placeholder="00000-000"
                    value={form.cep}
                    onChange={(e) => updateField('cep', formatCep(e.target.value))}
                    required
                    inputMode="numeric"
                  />
                </label>
                {cepStatus.error && <small className="muted">{cepStatus.error}</small>}
                <label className="label">
                  <span>Endereco</span>
                  <input
                    className="input"
                    value={form.endereco}
                    onChange={(e) => updateField('endereco', e.target.value)}
                    required
                  />
                </label>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <label className="label" style={{ flex: '1 1 120px' }}>
                    <span>Número</span>
                    <input
                      className="input"
                      value={form.numero}
                      onChange={(e) => updateField('numero', e.target.value)}
                      required
                    />
                  </label>
                  <label className="label" style={{ flex: '1 1 160px' }}>
                    <span>Complemento</span>
                    <input
                      className="input"
                      value={form.complemento}
                      onChange={(e) => updateField('complemento', e.target.value)}
                    />
                  </label>
                </div>
                <label className="label">
                  <span>Bairro</span>
                  <input
                    className="input"
                    value={form.bairro}
                    onChange={(e) => updateField('bairro', e.target.value)}
                    required
                  />
                </label>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <label className="label" style={{ flex: '1 1 200px' }}>
                    <span>Cidade</span>
                    <input
                      className="input"
                      value={form.cidade}
                      onChange={(e) => updateField('cidade', e.target.value)}
                      required
                    />
                  </label>
                  <label className="label" style={{ width: 80 }}>
                    <span>Estado</span>
                    <input
                      className="input"
                      value={form.estado}
                      onChange={(e) => updateField('estado', e.target.value.toUpperCase().slice(0, 2))}
                      required
                    />
                  </label>
                </div>
              </div>
            )}

            <label className="terms-check">
              <input
                type="checkbox"
                checked={acceptPolicies}
                onChange={(e) => setAcceptPolicies(e.target.checked)}
                required
              />
              <span>
                Li e concordo com os <Link to="/termos" target="_blank" rel="noreferrer">Termos de Uso</Link> e com a{' '}
                <Link to="/politica-privacidade" target="_blank" rel="noreferrer">Política de Privacidade</Link>.
              </span>
            </label>
            <small className="auth-legal__version">
              Versões vigentes: Termos {legalMeta.terms?.version} • Política {legalMeta.privacy?.version}
            </small>

            <div className="auth-actions" style={{ marginTop: 4 }}>
              <button type="submit" className="btn btn--primary" disabled={disabled}>
                {loading ? <span className="spinner" /> : 'Criar conta'}
              </button>
            </div>

            {err && (
              <div className="box" role="alert" aria-live="polite" style={{ borderColor: '#7f1d1d', color: '#991b1b', background: '#fef2f2' }}>
                Erro: {err}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
