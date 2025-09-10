// src/pages/Configuracoes.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../utils/auth';

export default function Configuracoes(){
  const user = getUser();
  const [planInfo, setPlanInfo] = useState({ plan: 'starter', trialEnd: null });

  useEffect(() => {
    try{
      const plan = localStorage.getItem('plan_current') || 'starter';
      const trialEnd = localStorage.getItem('trial_end');
      setPlanInfo({ plan, trialEnd });
    }catch{}
  }, []);

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
