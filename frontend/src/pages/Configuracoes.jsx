// src/pages/Configuracoes.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../utils/auth';
import { Api } from '../utils/api';

export default function Configuracoes(){
  const user = getUser();
  const [planInfo, setPlanInfo] = useState({ plan: 'starter', trialEnd: null });
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState({ email_subject: '', email_html: '', wa_template: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try{
      const plan = localStorage.getItem('plan_current') || 'starter';
      const trialEnd = localStorage.getItem('trial_end');
      setPlanInfo({ plan, trialEnd });
    }catch{}
  }, []);

  useEffect(() => {
    (async () => {
      if (user?.tipo !== 'estabelecimento') return;
      try {
        const est = await Api.getEstablishment(user.id);
        setSlug(est?.slug || '');
      } catch {}
      try {
        const tmpl = await Api.getEstablishmentMessages(user.id);
        setMsg({
          email_subject: tmpl?.email_subject || '',
          email_html: tmpl?.email_html || '',
          wa_template: tmpl?.wa_template || '',
        });
      } catch {}
    })();
  }, [user?.id, user?.tipo]);

  const daysLeft = useMemo(() => {
    if (!planInfo.trialEnd) return 0;
    const diff = new Date(planInfo.trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [planInfo.trialEnd]);

  function startTrial(){
    try{
      const d = new Date(); d.setDate(d.getDate() + 14);
      localStorage.setItem('trial_end', d.toISOString());
      setPlanInfo((p) => ({ ...p, trialEnd: d.toISOString() }));
    }catch{}
  }

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' }) : '';

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configurações</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferências.</p>
      </div>

      {user?.tipo === 'estabelecimento' && (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div className="row spread" style={{ alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Plano do Estabelecimento</h3>
            <div className={`badge ${planInfo.plan === 'premium' ? 'badge--premium' : planInfo.plan === 'pro' ? 'badge--pro' : ''}`}>
              {planInfo.plan.toUpperCase()}
            </div>
          </div>

          {planInfo.plan === 'starter' ? (
            <>
              {planInfo.trialEnd && daysLeft > 0 ? (
                <div className="box box--highlight">
                  <strong>Teste grátis ativo</strong>
                  <div className="small muted">Termina em {fmtDate(planInfo.trialEnd)} • {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} restantes</div>
                </div>
              ) : (
                <div className="box" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                  <strong>Você está no plano Starter</strong>
                  <div className="small muted">Ative 14 dias grátis do Pro para desbloquear WhatsApp e relatórios.</div>
                </div>
              )}

              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                {!planInfo.trialEnd && (
                  <button className="btn btn--outline" onClick={startTrial}>Ativar 14 dias grátis</button>
                )}
                <Link className="btn btn--primary" to="/planos">Conhecer planos</Link>
              </div>
            </>
          ) : (
            <>
              <div className="box box--highlight">
                <strong>{planInfo.plan === 'pro' ? 'Plano Pro ativo' : 'Plano Premium ativo'}</strong>
                <div className="small muted">Obrigado por apoiar o Agendamentos Online.</div>
              </div>
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" type="button" onClick={() => alert('Em breve: central de cobrança')}>Gerenciar cobrança</button>
                <Link className="btn btn--outline" to="/planos">Alterar plano</Link>
              </div>
            </>
          )}
        </div>
      )}

      {user?.tipo === 'estabelecimento' && (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ marginTop: 0 }}>Link público e mensagens</h3>
          <div className="grid" style={{ gap: 8 }}>
            <label className="label">
              <span>Slug do estabelecimento (apenas letras, números e hífens)</span>
              <input className="input" placeholder="ex: studio-bela" value={slug} onChange={e => setSlug(e.target.value)} />
            </label>
            <div className="row" style={{ alignItems:'center', gap:8 }}>
              <div className="small muted" style={{ userSelect:'text' }}>
                Link público: {slug ? `${window.location.origin}/book/${slug}` : `${window.location.origin}/book/${user.id}`}
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  try{
                    const link = slug ? `${window.location.origin}/book/${slug}` : `${window.location.origin}/book/${user.id}`;
                    navigator.clipboard.writeText(link);
                  }catch{}
                }}
              >Copiar link público</button>
            </div>

            <label className="label">
              <span>Assunto do e‑mail de confirmação</span>
              <input className="input" value={msg.email_subject} onChange={e => setMsg(m => ({ ...m, email_subject: e.target.value }))} />
            </label>
            <label className="label">
              <span>HTML do e‑mail</span>
              <textarea className="input" rows={6} value={msg.email_html} onChange={e => setMsg(m => ({ ...m, email_html: e.target.value }))} />
            </label>
            <label className="label">
              <span>Mensagem WhatsApp</span>
              <textarea className="input" rows={3} value={msg.wa_template} onChange={e => setMsg(m => ({ ...m, wa_template: e.target.value }))} />
            </label>
            <div className="small muted">Placeholders: {'{{cliente_nome}}'}, {'{{servico_nome}}'}, {'{{data_hora}}'}, {'{{estabelecimento_nome}}'}</div>

            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--outline" disabled={saving} onClick={async () => {
                try{ setSaving(true);
                  if (slug) await Api.updateEstablishmentSlug(user.id, slug);
                  await Api.updateEstablishmentMessages(user.id, msg);
                  alert('Salvo com sucesso');
                } catch(e){ alert('Falha ao salvar'); } finally { setSaving(false); }
              }}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Preferências</h3>
        <p className="muted">Em breve: edição de perfil, notificações, fuso-horário.</p>
      </div>

      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ marginTop: 0 }}>Ajuda</h3>
        <p className="muted">Tire dúvidas, veja perguntas frequentes e formas de contato.</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
        </div>
      </div>
    </div>
  );
}
