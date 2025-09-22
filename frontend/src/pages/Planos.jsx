// src/pages/Planos.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser } from '../utils/auth';

function Feature({ children }){
  return <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span aria-hidden>✓</span><span>{children}</span></li>;
}

function PricingCard({ title, subtitle, price, period = 'mês', cta, featured, features = [] }){
  return (
    <div className={`pricing-card ${featured ? 'is-featured' : ''}`}>
      <div className="pricing-header">
        <div className="pricing-title">{title}</div>
        {subtitle && <div className="pricing-subtitle muted">{subtitle}</div>}
      </div>
      <div className="price">
        {price.startsWith('R$') ? (
          <><span className="currency">R$</span><span className="amount">{price.replace('R$', '').trim()}</span><span className="period">/{period}</span></>
        ) : (
          <strong className="amount">{price}</strong>
        )}
      </div>
      {!!features.length && (
        <ul className="features">
          {features.map((f, i) => <Feature key={i}>{f}</Feature>)}
        </ul>
      )}
      {cta}
    </div>
  );
}

export default function Planos(){
  const user = getUser();
  const nav = useNavigate();

  const goCheckout = (plano) => () => {
    // Integração futura: redirecionar para checkout
    try { localStorage.setItem('intent_plano', plano); } catch {}
    nav('/configuracoes');
  };

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card" style={{ background: 'var(--surface-soft)' }}>
        <div className="row spread" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <div className="brand__logo" aria-hidden>AO</div>
            <div>
              <h2 style={{ margin: 0 }}>Planos para Estabelecimentos</h2>
              <small className="muted">Período grátis, garantia e suporte humano de verdade.</small>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <div className="badge ok" title="Teste agora e decida depois">14 dias grátis</div>
            <div className="badge pending" title="Satisfação garantida ou seu dinheiro de volta">Garantia 30 dias</div>
            <div className="badge" title="WhatsApp prioritário">Atendimento prioritário</div>
          </div>
        </div>
      </div>

      {user?.tipo !== 'estabelecimento' && (
        <div className="box" role="alert" style={{ borderColor: 'var(--warning-border)', background: 'var(--warning-bg)' }}>
          Esta página é voltada para estabelecimentos. Faça login como estabelecimento para contratar um plano.
        </div>
      )}

      <div className="pricing-grid">
        <PricingCard
          title="Starter"
          subtitle="Para começar com o essencial"
          price="R$ 49"
          features={[
            'Agenda online e confirmações',
            '3 serviços • 1 profissional',
            'Lembretes por e‑mail',
            'Relatórios básicos',
          ]}
          cta={<button className="btn" onClick={goCheckout('starter')}>Começar</button>}
        />

        <PricingCard
          featured
          title="Pro"
          subtitle="O melhor custo‑benefício"
          price="R$ 99"
          features={[
            'Tudo do Starter',
            'Serviços ilimitados',
            'Vários profissionais',
            'Lembretes por WhatsApp',
            'Relatórios avançados',
            'Suporte prioritário',
          ]}
          cta={<button className="btn btn--primary" onClick={goCheckout('pro')}>Iniciar 14 dias grátis</button>}
        />

        <PricingCard
          title="Premium"
          subtitle="Para alto volume e franquias"
          price="R$ 199"
          features={[
            'Tudo do Pro',
            'Onboarding assistido',
            'Integrações personalizadas',
            'SLA de atendimento',
          ]}
          cta={<button className="btn" onClick={goCheckout('premium')}>Falar com vendas</button>}
        />
      </div>

      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <h3 style={{ margin: 0 }}>Transparência e segurança</h3>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <Feature>Sem fidelidade: cancele quando quiser</Feature>
          <Feature>Pagamento mensal via cartão</Feature>
          <Feature>Seus dados protegidos e exportáveis</Feature>
        </ul>
      </div>
    </div>
  );
}

