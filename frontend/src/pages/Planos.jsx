// src/pages/Planos.jsx
import React, { Suspense, useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  IconBell,
  IconChart,
  IconHome,
  IconList,
  IconMoney,
  IconPhone,
  IconStar,
  IconUsers,
  IconWrench,
} from '../components/Icons.jsx';
import { getUser } from '../utils/auth';
import { Api } from '../utils/api';

const PlanosLowerExtras = React.lazy(() => import('./PlanosLowerExtras.jsx'));

function PlanCheckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanMinusIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Feature({ icon = null, tone = '', children }) {
  const Icon = typeof icon === 'function' ? icon : null;
  return (
    <li className={`feature-line${tone ? ` feature-line--${tone}` : ''}`}>
      <span className="feature-line__icon" aria-hidden>
        {Icon ? <Icon /> : icon || (tone === 'muted' ? <PlanMinusIcon /> : <PlanCheckIcon />)}
      </span>
      <span>{children}</span>
    </li>
  );
}

function IncludedBenefit({ icon: Icon = PlanCheckIcon, label }) {
  return (
    <li className="pricing-included__item">
      <span className="pricing-included__icon" aria-hidden>
        <Icon />
      </span>
      <span>{label}</span>
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
  { value: '2 / 5 / 10', label: 'profissionais por plano' },
  { value: '250 a 1.500', label: 'mensagens de WhatsApp por mês' },
  { value: '5 / 15 / livre', label: 'galeria pública por plano' },
];

const BILLING_CYCLES = {
  mensal: { label: 'Mensal', periodLabel: '/mês' },
  anual: { label: 'Anual', periodLabel: '/ano' },
};

const WHATSAPP_LIMIT_NOTICE = 'Ao atingir o limite de WhatsApp, os avisos continuam por e-mail e pelo painel. Também é possível comprar pacotes extras via PIX.';
const WHATSAPP_TOOLTIP = {
  title: 'Mensagens automáticas',
  items: [
    'Usadas para confirmações, lembretes e avisos do agendamento.',
    'Cada agendamento pode enviar até 5 mensagens automáticas.',
    WHATSAPP_LIMIT_NOTICE,
  ],
};

const INCLUDED_BENEFITS = [
  { icon: IconWrench, label: 'Serviços e agendamentos ilimitados' },
  { icon: IconHome, label: 'Página pública de agendamento personalizada' },
  { icon: IconPhone, label: 'Link exclusivo para divulgar no WhatsApp, Instagram e Google' },
  { icon: IconBell, label: 'Confirmações e lembretes automáticos' },
  { icon: IconUsers, label: 'Cadastro e histórico de clientes' },
  { icon: IconList, label: 'Agenda online responsiva para celular, tablet e computador' },
  { icon: IconChart, label: 'Painel de controle do estabelecimento' },
  { icon: IconStar, label: 'Controle de status dos agendamentos' },
  { icon: IconMoney, label: 'Pacotes extras de WhatsApp via PIX' },
];


const PRICING_PLANS = [
  {
    key: 'starter',
    title: 'Starter',
    subtitle: 'Ideal para começar online',
    prices: { mensal: '14,90', anual: '149,00' },
    annualEquivalent: '12,40',
    features: [
      { key: 'starter-pros', label: 'Até 2 profissionais' },
      { key: 'starter-gallery', label: 'Galeria pública com até 5 imagens' },
      {
        key: 'starter-whatsapp',
        label: '250 mensagens automáticas de WhatsApp por mês',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'starter-reports', label: 'Relatórios básicos' },
      { key: 'starter-ideal', label: 'Ideal para profissionais e pequenos negócios que querem começar online' },
      { key: 'starter-deposit', label: 'Sinal via PIX com Mercado Pago indisponível neste plano', tone: 'muted' },
    ],
    annualNote: 'Economize o equivalente a 2 meses no plano anual.',
    ctaVariant: 'btn',
    ctaLabel: 'Assinar Starter',
    ctaKind: 'checkout',
  },
  {
    key: 'pro',
    title: 'Pro',
    subtitle: 'Para negócios em crescimento',
    badge: 'Mais escolhido',
    prices: { mensal: '29,90', anual: '299,00' },
    annualEquivalent: '24,90',
    features: [
      { key: 'pro-pros', label: 'Até 5 profissionais' },
      { key: 'pro-gallery', label: 'Galeria pública com até 15 imagens' },
      {
        key: 'pro-whatsapp',
        label: '500 mensagens automáticas de WhatsApp por mês',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'pro-reports', label: 'Relatórios avançados com filtros por período, serviço e profissional' },
      { key: 'pro-deposit', label: 'Sinal via PIX com conexão Mercado Pago' },
      { key: 'pro-ideal', label: 'Ideal para negócios em crescimento' },
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
    subtitle: 'Para alto volume e operações maiores',
    prices: { mensal: '99,90', anual: '999,00' },
    annualEquivalent: '83,25',
    features: [
      { key: 'premium-pros', label: 'Até 10 profissionais' },
      { key: 'premium-gallery', label: 'Galeria pública sem limite de imagens' },
      {
        key: 'premium-whatsapp',
        label: '1.500 mensagens automáticas de WhatsApp por mês',
        tooltip: WHATSAPP_TOOLTIP,
      },
      { key: 'premium-reports', label: 'Relatórios completos para alto volume' },
      { key: 'premium-deposit', label: 'Sinal via PIX com conexão Mercado Pago' },
      { key: 'premium-control', label: 'Controle avançado para equipes maiores' },
      { key: 'premium-ideal', label: 'Ideal para alto volume e operações maiores' },
    ],
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
      nav('/assinatura');
    } else {
      nav('/cadastro?next=/assinatura&tipo=estabelecimento');
    }
  };

  const goRenewal = () => {
    try {
      localStorage.setItem('intent_kind', 'renewal');
    } catch {}
    nav('/assinatura');
  };

  const goTrial = (plano, ciclo = 'mensal') => () => {
    const u = getUser();
    try {
      if (u && u.tipo === 'estabelecimento') {
        localStorage.setItem('intent_plano', plano);
        localStorage.setItem('intent_plano_ciclo', ciclo);
      } else {
        localStorage.removeItem('intent_plano');
        localStorage.removeItem('intent_plano_ciclo');
      }
      localStorage.setItem('intent_kind', 'trial');
    } catch {}
    if (u && u.tipo === 'estabelecimento') {
      nav('/assinatura');
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
  const hasActivePlan = ['trialing', 'active', 'pending_payment', 'pending_pix', 'past_due', 'unpaid', 'expired'].includes(subscriptionStatus);
  const currentPlanKey = billingStatus?.subscription?.plan || '';
  const hasPlanContext = Boolean(currentPlanKey);
  const currentPlan = PRICING_PLANS.find((item) => item.key === currentPlanKey) || null;
  const currentPlanLabel = currentPlan?.title || (currentPlanKey ? currentPlanKey : 'Starter');
  const proTrialAvailable =
    user?.tipo !== 'estabelecimento' || (!trialInfo.wasUsed && !trialInfo.isExpired);
  const proPrimaryLabel =
    user?.tipo === 'estabelecimento' && currentPlanKey === 'starter' && !proTrialAvailable
      ? 'Migrar para Pro'
      : proTrialAvailable
        ? 'Testar Pro por 7 dias'
        : 'Assinar Pro';
  const proPrimaryAction = proTrialAvailable ? goTrial('pro', billingCycle) : goCheckout('pro', billingCycle);

  const handlePlanCta = (plan, ciclo, kind) => (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (kind === 'trial') {
      goTrial(plan, ciclo)();
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
          <p>Cartão de crédito é o formato principal da assinatura com renovação automática. O PIX segue como alternativa manual para contratar, renovar, reativar e cobrir contingências.</p>
          <div className="hero__badge-row">
            <span className="hero__badge">Cartão com renovação automática</span>
            <span className="hero__badge hero__badge--outline">PIX manual como alternativa</span>
            <span className="hero__badge hero__badge--outline">Mensal ou anual</span>
          </div>
          <div className="hero__actions">
            <button className="btn btn--primary btn--lg" onClick={proPrimaryAction}>{proPrimaryLabel}</button>
            <button className="btn btn--outline btn--lg" onClick={scrollToPlans}>Ver detalhes dos planos</button>
          </div>
          <div className="planos-highlight">Cartão evita interrupções. Se optar por PIX, a renovação continua manual.</div>
          {user?.tipo === 'estabelecimento' && !proTrialAvailable && (
            <div className="alert-inline" role="status">O teste grátis desta conta já foi usado. Você pode seguir direto com a assinatura do Pro.</div>
          )}
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
            <span>250 / 500 / 1.500 mensagens por mês</span>
          </div>
          <div className="hero__card hero__card--secondary">
            <strong>Profissionais</strong>
            <span>2, 5 ou 10 por plano</span>
          </div>
        </div>
      </section>

      <section className="pricing" id="planos">
        <div className="section-shell">
          <header className="section-header">
            <h2>Planos e preços</h2>
            <p>Escolha pelo tamanho da equipe, volume de WhatsApp e profundidade dos relatórios. Os recursos comuns ficam logo abaixo dos cards.</p>
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
                <span className="muted">Acompanhe cobrança, cartão e PIX na área de assinatura.</span>
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
            Política de cobrança: cartão renova automaticamente enquanto as cobranças forem aprovadas. PIX não renova sozinho; se a renovação não for paga, o acesso principal é bloqueado até a regularização.
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
              const showAnnualEquivalent = billingCycle === 'anual' && plan.annualEquivalent;
              const effectiveCta = (() => {
                if (plan.key === 'pro' && !proTrialAvailable) {
                  return {
                    kind: 'checkout',
                    label: user?.tipo === 'estabelecimento' && currentPlanKey === 'starter' ? 'Migrar para Pro' : 'Assinar Pro',
                  };
                }
                return {
                  kind: plan.ctaKind,
                  label: plan.ctaLabel || 'Saiba mais',
                };
              })();
              const isSales = effectiveCta.kind === 'sales';
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
                        <Feature key={item?.key || label} tone={item?.tone || ''}>
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
                      {effectiveCta.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={ctaClass}
                      onClick={handlePlanCta(plan.key, billingCycle, effectiveCta.kind)}
                    >
                      {effectiveCta.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pricing-note" role="note">
            <strong>WhatsApp:</strong> {WHATSAPP_LIMIT_NOTICE}
            <span>Limite de até 5 mensagens por agendamento.</span>
          </div>
          <section className="pricing-included" aria-labelledby="included-plans-heading">
            <div className="pricing-included__header">
              <span className="eyebrow">Benefícios comuns</span>
              <h3 id="included-plans-heading">Todos os planos incluem</h3>
              <p>Recursos essenciais para operar a agenda online, atender melhor e acompanhar o dia a dia do estabelecimento.</p>
            </div>
            <ul className="pricing-included__grid">
              {INCLUDED_BENEFITS.map((benefit) => (
                <IncludedBenefit key={benefit.label} {...benefit} />
              ))}
            </ul>
          </section>
          <div className="pricing-extras">
            <h3>Pacotes extras de WhatsApp</h3>
            <p>Quando a franquia mensal acabar, você pode adicionar mensagens via PIX sem trocar de plano.</p>
            <ul>
              <li>Quando o limite mensal acabar, o cliente pode adicionar mensagens via PIX.</li>
              <li>O saldo extra passa a ser usado depois que a franquia mensal acabar.</li>
              <li>A compra e a confirmação acontecem no próprio fluxo de cobrança.</li>
            </ul>
          </div>
        </div>
      </section>
      <Suspense fallback={null}>
        <PlanosLowerExtras
          primaryCtaLabel={proPrimaryLabel}
          primaryCtaDescription={
            proTrialAvailable
              ? 'O Pro tem 7 dias grátis para contas elegíveis.'
              : 'Esta conta já usou o teste grátis. Continue com a assinatura do Pro.'
          }
          onPrimaryCta={proPrimaryAction}
          onTalkSpecialist={() => nav('/contato')}
        />
      </Suspense>

      <footer className="planos-footer">
        <div className="section-shell planos-footer__inner">
          <div className="planos-footer__meta">
            <p>© 2026 Agendamentos Online</p>
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
