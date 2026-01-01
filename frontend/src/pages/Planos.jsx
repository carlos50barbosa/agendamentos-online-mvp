
// src/pages/Planos.jsx
import React, { Suspense, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getUser } from '../utils/auth';

const PlanosUpperExtras = React.lazy(() => import('./PlanosUpperExtras.jsx'));
const PlanosLowerExtras = React.lazy(() => import('./PlanosLowerExtras.jsx'));

function Feature({ icon = '✅', children }) {
  return (
    <li className="feature-line">
      <span className="feature-line__icon" aria-hidden>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Stat({ value, label }) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

const HERO_STATS = [
  { value: '+12k', label: 'agendamentos confirmados todos os meses' },
  { value: '72%', label: 'dos clientes retornam em menos de 3 meses' },
  { value: '3x', label: 'mais agendamentos vindos de canais digitais' },
];




const BILLING_CYCLES = {
  mensal: { label: 'Mensal', periodLabel: '/mês' },
  anual: { label: 'Anual', periodLabel: '/ano' },
};

const PRICING_PLANS = [
  {
    key: 'starter',
    title: 'Starter',
    subtitle: 'Para começar com o essencial',
    prices: { mensal: '14,90', anual: '149,00' },
    features: [
      'Agenda online e confirmações automáticas',
      'Até 100 agendamentos/mês com até 10 serviços e 2 profissionais',
      'Lembretes por e-mail',
      'Lembretes por WhatsApp',
      'Relatórios básicos',
    ],
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn',
    ctaLabel: 'Testar grátis por 7 dias',
    ctaKind: 'trial',
  },
  {
    key: 'pro',
    title: 'Pro',
    subtitle: 'O melhor custo-benefício',
    prices: { mensal: '49,90', anual: '499,00' },
    features: [
      'Tudo do Starter, com até 500 agendamentos/mês',
      'Até 100 serviços e 10 profissionais',
      'Lembretes e campanhas por WhatsApp',
      'Relatórios avançados e indicadores em tempo real',
      'Suporte prioritário via WhatsApp Business',
    ],
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn btn--primary',
    ctaLabel: 'Testar grátis por 7 dias',
    ctaKind: 'trial',
    featured: true,
  },
  {
    key: 'premium',
    title: 'Premium',
    subtitle: 'Para alto volume e franquias',
    prices: { mensal: '199,00', anual: '1.990,00' },
    features: [
      'Agendamentos, serviços e profissionais ilimitados',
      'Tudo do Pro com integrações personalizadas',
      'Onboarding assistido e treinamento da equipe',
      'API e dashboards executivos',
      'SLA dedicado e gerente de sucesso',
    ],
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn btn--outline',
    ctaLabel: 'Falar com vendas',
    ctaKind: 'sales',
    ctaHref: '/contato?plano=premium',
  },
];

export default function Planos() {
  const user = getUser();
  const nav = useNavigate();
  const [billingCycle, setBillingCycle] = useState('mensal');

  const goCheckout = (plano, ciclo = 'mensal') => () => {
    try {
      localStorage.setItem('intent_plano', plano);
      localStorage.setItem('intent_plano_ciclo', ciclo);
    } catch {}
    const u = getUser();
    if (u && u.tipo === 'estabelecimento') {
      nav('/configuracoes');
    } else {
      nav('/login?next=/configuracoes');
    }
  };

  const planCtaTarget = user?.tipo === 'estabelecimento' ? '/configuracoes' : '/login?next=/configuracoes';
  const handlePlanCta = (plan, ciclo) => (event) => {
    event.preventDefault();
    goCheckout(plan, ciclo)();
  };

  return (
    <div className="planos-landing">
      <section className="hero">
        <div className="hero__content">
          <span className="tag tag--accent">Feito para clínicas, salões, estúdios e academias</span>
          <h1>Transforme seu agendamento em uma máquina de clientes fiéis</h1>
          <p>Automatize confirmações, reduza faltas e dê superpoderes ao seu time de atendimento em uma plataforma simples, segura e pronta para crescer com o seu negócio.</p>
          <div className="hero__badge-row">
            <span className="hero__badge">Implementação guiada em 7 dias</span>
            <span className="hero__badge hero__badge--outline">Sem fidelidade</span>
            <span className="hero__badge hero__badge--outline">Suporte humano 7×12</span>
          </div>
          <div className="hero__actions">
            <button className="btn btn--primary btn--lg" onClick={goCheckout('pro')}>Começar teste de 7 dias</button>
            <button className="btn btn--outline btn--lg" onClick={() => nav('/ajuda')}>Ver tour guiado</button>
          </div>
          {user?.tipo !== 'estabelecimento' && (
            <div className="alert-inline" role="status">Página pensada para estabelecimentos. Faça login como estabelecimento para contratar um plano.</div>
          )}
          <div className="hero__footnote">
            <span>7 dias grátis · sem cartão de crédito</span>
            <span>Integrações com WhatsApp, Instagram e Google</span>
          </div>
          <div className="stats-grid">
            {HERO_STATS.map((stat) => <Stat key={stat.label} {...stat} />)}
          </div>
        </div>
        <div className="hero__illustration" aria-hidden>
          <div className="hero__pulse" />
          <div className="hero__card hero__card--primary">
            <strong>Agenda cheia</strong>
            <span>+38 novos agendamentos essa semana</span>
          </div>
          <div className="hero__card hero__card--secondary">
            <strong>Zero faltas</strong>
            <span>Lembretes enviados automaticamente</span>
          </div>
          <div className="hero__avatar-stack">
            <span className="hero__avatar" aria-hidden>AO</span>
            <span className="hero__avatar" aria-hidden>DG</span>
            <span className="hero__avatar" aria-hidden>RS</span>
            <span className="hero__avatar hero__avatar--more" aria-hidden>+120</span>
          </div>
        </div>
      </section>

      <section className="social-proof">
        <div className="section-shell">
          <span className="eyebrow">Confiança de redes e marcas que lideram atendimento</span>
          <div className="logos">
            <span>Studio Barber Pro</span>
            <span>Essência Spa</span>
            <span>SunNails</span>
            <span>Flow Pilates</span>
            <span>Clínica Persona</span>
          </div>
        </div>
      </section>
      <Suspense fallback={null}>
        <PlanosUpperExtras onContactPremium={() => nav('/contato?plano=premium')} />
      </Suspense>

      <section className="pricing" id="planos">
        <div className="section-shell">
          <header className="section-header">
            <h2>Planos e preços</h2>
            <p>Escolha o plano ideal hoje e faça upgrade quando for hora de expandir.</p>
          </header>
          <div className="small muted" style={{ marginTop: -8, marginBottom: 12 }}>
            Política de cobrança: upgrades liberam recursos imediatamente e a cobrança do novo valor ocorre no próximo ciclo. Downgrades passam a valer no ciclo seguinte, desde que os limites do plano sejam atendidos.
          </div>
          <div
            className="segmented billing-toggle"
            role="group"
            aria-label="Selecionar ciclo de cobrança"
            style={{ margin: '0 auto 24px' }}
          >
            {Object.entries(BILLING_CYCLES).map(([cycleKey, info]) => (
              <button
                key={cycleKey}
                type="button"
                className={`segmented__btn ${billingCycle === cycleKey ? 'is-active' : ''}`}
                aria-pressed={billingCycle === cycleKey}
                onClick={() => {
                  if (billingCycle !== cycleKey) setBillingCycle(cycleKey);
                }}
              >
                {info.label}
              </button>
            ))}
          </div>
          <div className="pricing-grid">
            {PRICING_PLANS.map((plan) => {
              const price = plan.prices[billingCycle];
              const periodLabel = BILLING_CYCLES[billingCycle].periodLabel;
              const cardClass = `pricing-card${plan.featured ? ' is-featured' : ''}`;
              const isSales = plan.ctaKind === 'sales';
              const linkTo = isSales
                ? (() => {
                    const base = plan.ctaHref || `/contato?plano=${plan.key}`;
                    const separator = base.includes('?') ? '&' : '?';
                    return `${base}${separator}ciclo=${billingCycle}`;
                  })()
                : planCtaTarget;
              const linkOnClick = isSales ? undefined : handlePlanCta(plan.key, billingCycle);
              return (
                <Link
                  key={plan.key}
                  className={cardClass}
                  to={linkTo}
                  onClick={linkOnClick}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="pricing-header">
                    <div className="pricing-title" style={{ cursor: 'pointer' }}>{plan.title}</div>
                    <div className="pricing-subtitle muted">{plan.subtitle}</div>
                  </div>
                  <div className="price">
                    <span className="currency">R$</span>
                    <span className="amount">{price}</span>
                    <span className="period">{periodLabel}</span>
                  </div>
                  <ul className="features">
                    {plan.features.map((item) => (
                      <Feature key={item}>{item}</Feature>
                    ))}
                  </ul>
                  {billingCycle === 'anual' && plan.annualNote && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{plan.annualNote}</div>
                  )}
                  <span className={plan.ctaVariant || 'btn'}>{plan.ctaLabel || 'Saiba mais'}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
      <Suspense fallback={null}>
        <PlanosLowerExtras
          onStartTrial={goCheckout('pro')}
          onTalkSpecialist={() => nav('/contato')}
        />
      </Suspense>
    </div>
  );
}

