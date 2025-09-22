
// src/pages/Configuracoes.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../utils/auth';
import { Api } from '../utils/api';
import { IconChevronRight } from '../components/Icons.jsx';

export default function Configuracoes(){
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';
  const [planInfo, setPlanInfo] = useState({ plan: 'starter', trialEnd: null });
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState({ email_subject: '', email_html: '', wa_template: '' });
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({});

  useEffect(() => {
    try{
      const plan = localStorage.getItem('plan_current') || 'starter';
      const trialEnd = localStorage.getItem('trial_end');
      setPlanInfo({ plan, trialEnd });
    }catch{}
  }, []);

  useEffect(() => {
    (async () => {
      if (!isEstab) return;
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
  }, [isEstab, user?.id]);

  const daysLeft = useMemo(() => {
    if (!planInfo.trialEnd) return 0;
    const diff = new Date(planInfo.trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [planInfo.trialEnd]);

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' }) : '';

  const publicLink = useMemo(() => {
    if (!user) return '';
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    return slug ? `${origin}/book/${slug}` : `${origin}/book/${user.id}`;
  }, [slug, user?.id]);

  const startTrial = useCallback(() => {
    try{
      const d = new Date();
      d.setDate(d.getDate() + 14);
      const iso = d.toISOString();
      localStorage.setItem('trial_end', iso);
      setPlanInfo((p) => ({ ...p, trialEnd: iso }));
    }catch{}
  }, []);

  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const sections = useMemo(() => {
    const list = [];
    if (isEstab) {
      list.push({
        id: 'plan',
        title: 'Plano do Estabelecimento',
        content: (
          <>
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
                    <strong>Teste gratis ativo</strong>
                    <div className="small muted">Termina em {fmtDate(planInfo.trialEnd)} – {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} restantes</div>
                  </div>
                ) : (
                  <div className="box" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                    <strong>Voce esta no plano Starter</strong>
                    <div className="small muted">Ative 14 dias gratis do Pro para desbloquear WhatsApp e relatorios.</div>
                  </div>
                )}
                <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                  {!planInfo.trialEnd && (
                    <button className="btn btn--outline" onClick={startTrial}>Ativar 14 dias gratis</button>
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
                  <button className="btn" type="button" onClick={() => alert('Em breve: central de cobranca')}>
                    Gerenciar cobranca
                  </button>
                  <Link className="btn btn--outline" to="/planos">Alterar plano</Link>
                </div>
              </>
            )}
          </>
        ),
      });

      list.push({
        id: 'public-link',
        title: 'Link publico e mensagens',
        content: (
          <div className="grid" style={{ gap: 8 }}>
            <label className="label">
              <span>Slug do estabelecimento (apenas letras, numeros e hifens)</span>
              <input className="input" placeholder="ex: studio-bela" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <div className="small muted" style={{ userSelect: 'text' }}>
                {publicLink ? `Link publico: ${publicLink}` : 'Link publico sera exibido aqui'}
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  if (!publicLink) return;
                  try { navigator.clipboard.writeText(publicLink); } catch {}
                }}
              >
                Copiar link publico
              </button>
            </div>
            <label className="label">
              <span>Assunto do email de confirmacao</span>
              <input className="input" value={msg.email_subject} onChange={(e) => setMsg((m) => ({ ...m, email_subject: e.target.value }))} />
            </label>
            <label className="label">
              <span>HTML do email</span>
              <textarea className="input" rows={6} value={msg.email_html} onChange={(e) => setMsg((m) => ({ ...m, email_html: e.target.value }))} />
            </label>
            <label className="label">
              <span>Mensagem WhatsApp</span>
              <textarea className="input" rows={3} value={msg.wa_template} onChange={(e) => setMsg((m) => ({ ...m, wa_template: e.target.value }))} />
            </label>
            <div className="small muted">Placeholders: {'{{cliente_nome}}'}, {'{{servico_nome}}'}, {'{{data_hora}}'}, {'{{estabelecimento_nome}}'}</div>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn--outline"
                disabled={saving}
                onClick={async () => {
                  try {
                    setSaving(true);
                    if (slug) await Api.updateEstablishmentSlug(user.id, slug);
                    await Api.updateEstablishmentMessages(user.id, msg);
                    alert('Salvo com sucesso');
                  } catch (e) {
                    alert('Falha ao salvar');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        ),
      });
    }

    list.push({
      id: 'preferences',
      title: 'Preferencias',
      content: (
        <p className="muted" style={{ margin: 0 }}>Em breve: edicao de perfil, notificacoes, fuso-horario.</p>
      ),
    });

    list.push({
      id: 'support',
      title: 'Ajuda',
      content: (
        <>
          <p className="muted">Tire duvidas, veja perguntas frequentes e formas de contato.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
          </div>
        </>
      ),
    });

    return list;
  }, [isEstab, planInfo.plan, planInfo.trialEnd, daysLeft, publicLink, slug, msg, saving, startTrial, user?.id]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configuracoes</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferencias.</p>
      </div>

      {sections.map(({ id, title, content }) => {
        const isOpen = !!openSections[id];
        return (
          <div key={id} className="card config-section">
            <button
              type="button"
              className={`config-section__toggle${isOpen ? ' is-open' : ''}`}
              onClick={() => toggleSection(id)}
              aria-expanded={isOpen}
            >
              <span>{title}</span>
              <IconChevronRight className="config-section__icon" aria-hidden="true" />
            </button>
            {isOpen && <div className="config-section__content">{content}</div>}
          </div>
        );
      })}
    </div>
  );
}
