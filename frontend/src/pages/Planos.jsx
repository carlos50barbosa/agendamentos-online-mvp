// src/pages/Planos.jsx
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { getUser } from '../utils/auth';
import { Api } from '../utils/api';

const PlanosUpperExtras = React.lazy(() => import('./PlanosUpperExtras.jsx'));
const PlanosLowerExtras = React.lazy(() => import('./PlanosLowerExtras.jsx'));

function Feature({ icon = '-', children }) {
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
  { value: '2 a 10', label: 'profissionais por plano' },
  { value: '50 a 300', label: 'agendamentos com WhatsApp/mês' },
  { value: 'até 5', label: 'mensagens por agendamento' },
];

const BILLING_CYCLES = {
  mensal: { label: 'Mensal', periodLabel: '/mês' },
  anual: { label: 'Anual', periodLabel: '/ano' },
};

const WHATSAPP_LIMIT_FOOTNOTE = '* Ao atingir o limite de WhatsApp, continua por e-mail e painel.';
const WHATSAPP_TOOLTIP = {
  title: 'Como funciona?',
  items: [
    'As mensagens do WhatsApp são usadas para confirmações, lembretes e avisos do agendamento.',
    'Cada agendamento pode enviar até 5 mensagens (ex.: confirmação + lembrete + aviso).',
    'O plano inclui um limite mensal de mensagens. Ao atingir o limite, você continua por e-mail e painel, ou pode adicionar pacotes extras.',
  ],
};


const PRICING_PLANS = [
  {
    key: 'starter',
    title: 'Starter',
    subtitle: 'Para começar com o essencial',
    badge: 'Agendamentos ilimitados',
    prices: { mensal: '14,90', anual: '149,00' },
    annualEquivalent: '12,40',
    features: [
      { key: 'starter-pros', label: 'Até 2 profissionais' },
      {
        key: 'starter-whatsapp',
        label: 'WhatsApp incluso: 250 mensagens/mês (confirmações, lembretes e avisos)*',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'starter-extras', label: 'Pacotes extras de WhatsApp via PIX (opcional)' },
      { key: 'starter-msgs', label: 'Até 5 mensagens por agendamento (confirmações, lembretes e avisos)' },
      { key: 'starter-reports', label: 'Relatórios básicos' },
    ],
    footnote: WHATSAPP_LIMIT_FOOTNOTE,
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn',
    ctaLabel: 'Testar grátis por 7 dias',
    ctaKind: 'trial',
  },
  {
    key: 'pro',
    title: 'Pro',
    subtitle: 'O melhor custo-benefício',
    badge: 'Agendamentos ilimitados',
    prices: { mensal: '29,90', anual: '299,00' },
    annualEquivalent: '24,90',
    features: [
      { key: 'pro-pros', label: 'Até 5 profissionais' },
      {
        key: 'pro-whatsapp',
        label: 'WhatsApp incluso: 500 mensagens/mês (confirmações, lembretes e avisos)*',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'pro-extras', label: 'Pacotes extras de WhatsApp via PIX (opcional)' },
      { key: 'pro-msgs', label: 'Até 5 mensagens por agendamento (confirmações, lembretes e avisos)' },
      { key: 'pro-reports', label: 'Relatórios avançados e indicadores em tempo real' },
      { key: 'pro-support', label: 'Suporte prioritário via WhatsApp Business' },
    ],
    footnote: WHATSAPP_LIMIT_FOOTNOTE,
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
    badge: 'Agendamentos ilimitados',
    prices: { mensal: '99,90', anual: '999,00' },
    annualEquivalent: '83,25',
    features: [
      { key: 'premium-pros', label: 'Até 10 profissionais' },
      {
        key: 'premium-whatsapp',
        label: 'WhatsApp incluso: 1.500 mensagens/mês (confirmações, lembretes e avisos)*',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'premium-extras', label: 'Pacotes extras de WhatsApp via PIX (opcional)' },
      { key: 'premium-msgs', label: 'Até 5 mensagens por agendamento (confirmações, lembretes e avisos)' },
      { key: 'premium-support', label: 'Suporte prioritário e onboarding do time' },
    ],
    footnote: WHATSAPP_LIMIT_FOOTNOTE,
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn btn--outline',
    ctaLabel: 'Assinar Premium',
    ctaKind: 'checkout',
  },
];


export default function Planos() {
  const user = getUser();
  const nav = useNavigate();
  const location = useLocation();
  const [billingCycle, setBillingCycle] = useState('mensal');
  const [billingStatus, setBillingStatus] = useState(null);
  const [billingStatusLoading, setBillingStatusLoading] = useState(false);
  const [billingStatusError, setBillingStatusError] = useState('');

  useEffect(() => {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!root && !body) return undefined;
    if (root) root.classList.add('planos-no-scrollbar');
    if (body) body.classList.add('planos-no-scrollbar');
    return () => {
      if (root) root.classList.remove('planos-no-scrollbar');
      if (body) body.classList.remove('planos-no-scrollbar');
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (user?.tipo !== 'estabelecimento' || !user?.id) {
      setBillingStatus(null);
      setBillingStatusError('');
      return () => { active = false; };
    }
    setBillingStatusLoading(true);
    setBillingStatusError('');
    Api.billingStatus()
      .then((data) => {
        if (active) setBillingStatus(data);
      })
      .catch((err) => {
        if (!active) return;
        const message = err?.data?.message || err?.message || 'Falha ao carregar status de cobrança.';
        setBillingStatusError(message);
      })
      .finally(() => {
        if (active) setBillingStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.tipo]);

  const scrollToPlans = () => {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('planos');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (location.hash === '#planos') scrollToPlans();
  }, [location.hash]);

  const goCheckout = (plano, ciclo = 'mensal') => () => {
    try {
      localStorage.setItem('intent_kind', 'checkout');
      localStorage.setItem('intent_plano', plano);
      localStorage.setItem('intent_plano_ciclo', ciclo);
    } catch {}
    const u = getUser();
    if (u && u.tipo === 'estabelecimento') {
      nav('/configuracoes');
    } else {
      nav('/cadastro?next=/configuracoes&tipo=estabelecimento');
    }
  };

  const goRenewal = () => {
    try {
      localStorage.setItem('intent_kind', 'renewal');
    } catch {}
    nav('/configuracoes');
  };

  const goTrial = (plano) => () => {
    try {
      localStorage.removeItem('intent_plano');
      localStorage.removeItem('intent_plano_ciclo');
      localStorage.setItem('intent_kind', 'trial');
    } catch {}
    const u = getUser();
    if (u && u.tipo === 'estabelecimento') {
      nav('/configuracoes');
    } else {
      const trialNext = encodeURIComponent('/estab?trial=sucesso');
      nav(
        `/cadastro?trial_plan=${encodeURIComponent(plano)}&next=${trialNext}&tipo=estabelecimento`
      );
    }
  };

  const trialInfo = billingStatus?.trial || {};
  const renewalInfo = billingStatus?.billing || {};
  const renewalRequired = Boolean(renewalInfo.renewalRequired);
  const hasOpenRenewalPayment = Boolean(renewalInfo.hasOpenPayment && renewalInfo.openPayment);
  const subscriptionStatus = String(billingStatus?.subscription?.status || '').toLowerCase();
  const hasActivePlan = ['active', 'authorized'].includes(subscriptionStatus);
  const currentPlanKey = billingStatus?.subscription?.plan || '';
  const hasPlanContext = Boolean(currentPlanKey);
  const currentPlan = PRICING_PLANS.find((item) => item.key === currentPlanKey) || null;
  const currentPlanLabel = currentPlan?.title || (currentPlanKey ? currentPlanKey : 'Starter');
  const showStarterTrial =
    user?.tipo !== 'estabelecimento' || (!trialInfo.wasUsed && !trialInfo.isExpired);

  const handlePlanCta = (plan, ciclo, kind) => (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (kind === 'trial') {
      goTrial(plan)();
      return;
    }
    goCheckout(plan, ciclo)();
  };

  return (
    <div className="planos-landing">
      <section className="hero">
        <div className="hero__content">
          <span className="tag tag--accent">Planos para estabelecimentos</span>
          <h1>Planos simples, limites claros</h1>
          <p>Todos os planos têm agendamentos ilimitados no sistema. Compare limites de profissionais, pacote de WhatsApp e itens adicionais de cada plano.</p>
          <div className="hero__badge-row">
            <span className="hero__badge">Mensal ou anual</span>
            <span className="hero__badge hero__badge--outline">Starter e Pro com 7 dias grátis</span>
            <span className="hero__badge hero__badge--outline">WhatsApp incluído por mês</span>
          </div>
          <div className="hero__actions">
            <button className="btn btn--primary btn--lg" onClick={goTrial('pro')}>Testar Pro por 7 dias</button>
            <button className="btn btn--outline btn--lg" onClick={scrollToPlans}>Ver detalhes dos planos</button>
          </div>
          <div className="planos-highlight">Teste grátis por 7 dias sem cartão.</div>
          {user?.tipo !== 'estabelecimento' && (
            <div className="alert-inline" role="status">*Para estabelecimentos e profissionais.</div>
          )}
          <div className="stats-grid">
            {HERO_STATS.map((stat) => <Stat key={stat.label} {...stat} />)}
          </div>
        </div>
        <div className="hero__illustration" aria-hidden>
          <div className="hero__pulse" />
          <div className="hero__card hero__card--primary">
            <strong>WhatsApp mensal</strong>
            <span>50/100/300 agendamentos por mês</span>
          </div>
          <div className="hero__card hero__card--secondary">
            <strong>Profissionais</strong>
            <span>2, 5 ou 10 por plano</span>
          </div>
        </div>
      </section>

      <section className="social-proof">
        <div className="section-shell">
          <span className="eyebrow">Resumo do que está em todos os planos</span>
          <div className="logos">
            <span>Agendamentos ilimitados no sistema</span>
            <span>Até 5 mensagens por agendamento</span>
            <span>WhatsApp incluído por mês</span>
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
            <p>Veja o que cada plano inclui e compare os limites.</p>
          </header>
          {hasPlanContext && (
            <div
              className="planos-current-plan"
              style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
            >
              <div>
                <strong>Plano atual:</strong> {currentPlanLabel}
              </div>
              {billingStatusLoading && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Carregando status de cobrança...
                </span>
              )}
              {renewalRequired && !hasOpenRenewalPayment ? (
                <button className="btn btn--primary btn--sm" type="button" onClick={goRenewal}>
                  Renovar agora
                </button>
              ) : (
                <span className="muted">Assinatura ativa.</span>
              )}
              {hasOpenRenewalPayment && renewalInfo.openPayment?.expiresAt && (
                <span className="muted" style={{ fontSize: 12 }}>
                  PIX pendente expira em{' '}
                  {new Date(renewalInfo.openPayment.expiresAt).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                })}
              </span>
            )}
            {billingStatusError && (
              <span className="muted" style={{ color: '#c53030', fontSize: 12 }}>
                {billingStatusError}
              </span>
            )}
          </div>
          )}
          <div className="small muted" style={{ marginTop: -8, marginBottom: 12 }}>
            Política de cobrança: upgrades liberam recursos imediatamente e o novo valor é cobrado no próximo ciclo. Downgrades valem no ciclo seguinte, desde que os limites do plano sejam atendidos.
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
          const isCurrentPlan = hasActivePlan && plan.key === currentPlanKey;
          const cardClass = `pricing-card${plan.featured ? ' is-featured' : ''}${isCurrentPlan ? ' pricing-card--current' : ''}`;
          const isSales = plan.ctaKind === 'sales';
          const showAnnualEquivalent = billingCycle === 'anual' && plan.annualEquivalent;
          const isStarterPlan = plan.key === 'starter';
          const ctaKind = isStarterPlan && !showStarterTrial ? 'checkout' : plan.ctaKind;
          const ctaLabel = isStarterPlan && !showStarterTrial ? 'Assinar Starter' : plan.ctaLabel || 'Saiba mais';
          const ctaClass = plan.ctaVariant || 'btn';
          const ctaLink = (() => {
            if (!isSales) return null;
            const base = plan.ctaHref || `/contato?plano=${plan.key}`;
            const separator = base.includes('?') ? '&' : '?';
            return `${base}${separator}ciclo=${billingCycle}`;
          })();
              return (
                <div key={plan.key} className={cardClass}>
                  {plan.badge && <span className="pricing-badge">{plan.badge}</span>}
                <div className="pricing-header">
                  <div>
                    <div className="pricing-title">{plan.title}</div>
                    <div className="pricing-subtitle muted">{plan.subtitle}</div>
                  </div>
                  {isCurrentPlan && (
                    <span className="tag tag--accent">Plano atual</span>
                  )}
                </div>
                  <div className="price">
                    <span className="currency">R$</span>
                    <span className="amount">{price}</span>
                    <span className="period">{periodLabel}</span>
                  </div>
                  {showAnnualEquivalent && (
                    <div className="price-equivalent">equivale a R$ {plan.annualEquivalent}/mês</div>
                  )}
                  <ul className="features">
                    {plan.features.map((item) => {
                      if (typeof item === 'string') {
                        return <Feature key={item}>{item}</Feature>;
                      }
                      const label = item?.label || '';
                      return (
                        <Feature key={item?.key || label}>
                          <span className="feature-item">
                            <span className="feature-item__label">
                              {label}{item?.tooltip ? (
                                <span className="pricing-tooltip">
                                  <span className="pricing-tooltip__icon" aria-hidden="true">i</span>
                                  <span className="pricing-tooltip__content" role="note">
                                    <span className="pricing-tooltip__title">{item.tooltip.title}</span>
                                    <ul>
                                      {item.tooltip.items.map((text) => (
                                        <li key={text}>{text}</li>
                                      ))}
                                    </ul>
                                  </span>
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </Feature>
                      );
                    })}
                  </ul>
                  {plan.footnote && (
                    <div className="pricing-footnote">{plan.footnote}</div>
                  )}
                  {billingCycle === 'anual' && plan.annualNote && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{plan.annualNote}</div>
                  )}
                  {isSales ? (
                    <Link className={ctaClass} to={ctaLink}>
                      {ctaLabel}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={ctaClass}
                      onClick={handlePlanCta(plan.key, billingCycle, ctaKind)}
                    >
                      {ctaLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pricing-extras">
            <h3>Pacotes extras de WhatsApp (opcional)</h3>
            <ul>
              <li>Passou do limite? Adicione mensagens via PIX.</li>
              <li>Saldo extra é usado quando o limite do plano termina.</li>
              <li>Confirmação rápida via PIX.</li>
            </ul>
          </div>
        </div>
      </section>
      <Suspense fallback={null}>
        <PlanosLowerExtras
          onStartTrial={goTrial('pro')}
          onTalkSpecialist={() => nav('/contato')}
        />
      </Suspense>

      <footer className="planos-footer">
        <div className="section-shell planos-footer__inner">
          <div className="planos-footer__meta">
            <p>© 2025 Agendamentos Online</p>
            <p>Todos os direitos reservados.</p>
            <a href="mailto:servicos.negocios.digital@gmail.com">servicos.negocios.digital@gmail.com</a>
            <p className="planos-footer__meta-links">
              <Link to="/termos">Termos de Uso</Link> e <Link to="/politica-privacidade">Política de Privacidade</Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
