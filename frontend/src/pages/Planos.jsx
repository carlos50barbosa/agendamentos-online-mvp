
// src/pages/Planos.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser } from '../utils/auth';

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

function BenefitCard({ title, description, items }) {
  return (
    <article className="benefit-card">
      <h3>{title}</h3>
      <p>{description}</p>
      <ul>{items.map((item, index) => <Feature key={index}>{item}</Feature>)}</ul>
    </article>
  );
}

function TestimonialCard({ quote, name, role }) {
  return (
    <figure className="testimonial-card">
      <blockquote>“{quote}”</blockquote>
      <figcaption>
        <strong>{name}</strong>
        <span>{role}</span>
      </figcaption>
    </figure>
  );
}

function FAQItem({ question, answer }) {
  return (
    <details className="faq-item">
      <summary>{question}</summary>
      <p>{answer}</p>
    </details>
  );
}

const HERO_STATS = [
  { value: '+12k', label: 'agendamentos confirmados todos os meses' },
  { value: '72%', label: 'dos clientes retornam em menos de 3 meses' },
  { value: '3x', label: 'mais agendamentos vindos de canais digitais' },
];

const CORE_BENEFITS = [
  {
    title: 'Transforme o primeiro contato em fidelização',
    description: 'Centralize WhatsApp, Instagram, Google e seu site em uma agenda inteligente que responde sozinha e nunca esquece um cliente.',
    items: [
      'Link de agendamento personalizado para divulgar nas redes sociais',
      'Confirmações automáticas por WhatsApp, SMS e e-mail',
      'Lista de espera inteligente para ocupar horários cancelados',
    ],
  },
  {
    title: 'Operação eficiente do balcão ao financeiro',
    description: 'Otimize o tempo da sua equipe com fluxos automatizados e relatórios que mostram onde concentrar esforços.',
    items: [
      'Painel em tempo real com profissionais, salas e recursos',
      'Relatórios de receita, cancelamentos e ticket médio',
      'Exportação contábil com um clique (CSV, Excel e API)',
    ],
  },
  {
    title: 'Experiência premium para seus clientes',
    description: 'Encante em todas as etapas com lembretes gentis, confirmações instantâneas e um checkout sem fricção.',
    items: [
      'Chat de pré-atendimento com roteiros salvos para cada serviço',
      'Pesquisa de satisfação pós-atendimento automática',
      'Integração com carteiras digitais e pagamento na reserva',
    ],
  },
];

const TESTIMONIALS = [
  {
    quote: 'Triplicamos a base de clientes recorrentes sem contratar mais recepcionistas. A agenda online virou nosso melhor vendedor.',
    name: 'Vanessa Moura',
    role: 'Diretora do Espaço Essência (SP)',
  },
  {
    quote: 'Os lembretes automáticos reduziram faltas em 63%. Hoje temos previsibilidade para investir em mídia e equipe.',
    name: 'Paulo Martins',
    role: 'Fundador do Studio Barber Pro (BH)',
  },
  {
    quote: 'Organizamos 14 unidades com o mesmo padrão de atendimento. Os relatórios deram clareza para acelerar a expansão.',
    name: 'Luciana Pereira',
    role: 'COO da rede SunNails',
  },
];

const FAQS = [
  {
    question: 'Preciso trocar todas as minhas ferramentas para usar o Agendamentos Online?',
    answer: 'Não. Conectamos com o que já funciona no dia a dia do seu time (WhatsApp, Google Agenda, Instagram e gateways de pagamento). Você pode migrar aos poucos e importar sua base atual com suporte dedicado.',
  },
  {
    question: 'Existe taxa de implantação ou contrato de fidelidade?',
    answer: 'Não existem taxas escondidas e o contrato é mensal. No plano Premium oferecemos onboarding assistido e migração personalizada já inclusos na mensalidade.',
  },
  {
    question: 'Consigo testar com minha equipe antes de decidir?',
    answer: 'Sim! Todos os planos têm 14 dias grátis com acesso completo. Nesse período nosso time de sucesso acompanha a configuração e apresenta as melhores práticas para seu segmento.',
  },
];

export default function Planos() {
  const user = getUser();
  const nav = useNavigate();

  const goCheckout = (plano) => () => {
    try { localStorage.setItem('intent_plano', plano); } catch {}
    nav('/configuracoes');
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
            <button className="btn btn--primary btn--lg" onClick={goCheckout('pro')}>Começar teste gratuito</button>
            <button className="btn btn--outline btn--lg" onClick={() => nav('/ajuda')}>Ver tour guiado</button>
          </div>
          {user?.tipo !== 'estabelecimento' && (
            <div className="alert-inline" role="status">Página pensada para estabelecimentos. Faça login como estabelecimento para contratar um plano.</div>
          )}
          <div className="hero__footnote">
            <span>14 dias grátis · sem cartão de crédito</span>
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

      <section className="benefits">
        <div className="section-shell">
          <header className="section-header">
            <h2>Resultados previsíveis em cada etapa da jornada</h2>
            <p>Do primeiro contato até o pós-atendimento, o Agendamentos Online cuida da experiência para você focar no crescimento.</p>
          </header>
          <div className="benefits-grid">
            {CORE_BENEFITS.map((benefit) => (
              <BenefitCard key={benefit.title} {...benefit} />
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="section-shell cta-band__inner">
          <div className="cta-band__content">
            <h2>Seu time no controle, seus clientes encantados</h2>
            <p>Implantação guiada, suporte humano e insights diários para acelerar decisões.</p>
          </div>
          <button className="btn btn--primary btn--lg" onClick={goCheckout('premium')}>Quero falar com o time</button>
        </div>
      </section>

      <section className="testimonials">
        <div className="section-shell">
          <header className="section-header">
            <h2>Histórias de estabelecimentos que decidiram crescer com a gente</h2>
            <p>Mais escala, menos improviso e uma experiência de agendamento que os clientes realmente amam.</p>
          </header>
          <div className="testimonials-grid">
            {TESTIMONIALS.map((item) => (
              <TestimonialCard key={item.name} {...item} />
            ))}
          </div>
        </div>
      </section>

      <section className="pricing" id="planos">
        <div className="section-shell">
          <header className="section-header">
            <h2>Planos e preços</h2>
            <p>Escolha o plano ideal hoje e faça upgrade quando for hora de expandir.</p>
          </header>
          <div className="pricing-grid">
            <div className="pricing-card">
              <div className="pricing-header">
                <div className="pricing-title">Starter</div>
                <div className="pricing-subtitle muted">Para começar com o essencial</div>
              </div>
              <div className="price"><span className="currency">R$</span><span className="amount">49</span><span className="period">/mês</span></div>
              <ul className="features">
                <Feature>Agenda online e confirmações automáticas</Feature>
                <Feature>Até 10 serviços e 1 profissional</Feature>
                <Feature>Lembretes por e-mail</Feature>
                <Feature>Relatórios básicos</Feature>
              </ul>
              <button className="btn" onClick={goCheckout('starter')}>Começar agora</button>
            </div>

            <div className="pricing-card is-featured">
              <div className="pricing-header">
                <div className="pricing-title">Pro</div>
                <div className="pricing-subtitle muted">O melhor custo-benefício</div>
              </div>
              <div className="price"><span className="currency">R$</span><span className="amount">99</span><span className="period">/mês</span></div>
              <ul className="features">
                <Feature>Tudo do Starter, sem limites</Feature>
                <Feature>Equipe completa e múltiplas agendas</Feature>
                <Feature>Lembretes e campanhas por WhatsApp</Feature>
                <Feature>Relatórios avançados e indicadores em tempo real</Feature>
                <Feature>Suporte prioritário via WhatsApp Business</Feature>
              </ul>
              <button className="btn btn--primary" onClick={goCheckout('pro')}>Iniciar 14 dias grátis</button>
            </div>

            <div className="pricing-card">
              <div className="pricing-header">
                <div className="pricing-title">Premium</div>
                <div className="pricing-subtitle muted">Para alto volume e franquias</div>
              </div>
              <div className="price"><span className="currency">R$</span><span className="amount">199</span><span className="period">/mês</span></div>
              <ul className="features">
                <Feature>Tudo do Pro com integrações personalizadas</Feature>
                <Feature>Onboarding assistido e treinamento da equipe</Feature>
                <Feature>API e dashboards executivos</Feature>
                <Feature>SLA dedicado e gerente de sucesso</Feature>
              </ul>
              <button className="btn" onClick={goCheckout('premium')}>Falar com vendas</button>
            </div>
          </div>
        </div>
      </section>

      <section className="faq">
        <div className="section-shell">
          <header className="section-header">
            <h2>Perguntas frequentes</h2>
            <p>Transparência desde o primeiro contato. Se algo não ficou claro, fale com a gente.</p>
          </header>
          <div className="faq-grid">
            {FAQS.map((item) => (
              <FAQItem key={item.question} {...item} />
            ))}
          </div>
        </div>
      </section>

      <section className="cta-final">
        <div className="section-shell cta-final__inner">
          <div>
            <h2>Pronto para lotar a agenda e encantar seus clientes?</h2>
            <p>Comece hoje com 14 dias grátis. Sem cartão de crédito, sem compromisso.</p>
          </div>
          <div className="cta-final__actions">
            <button className="btn btn--primary btn--lg" onClick={goCheckout('pro')}>Quero testar agora</button>
            <button className="btn btn--outline btn--lg" onClick={() => nav('/contato')}>Agendar conversa com especialista</button>
          </div>
        </div>
      </section>
    </div>
  );
}
