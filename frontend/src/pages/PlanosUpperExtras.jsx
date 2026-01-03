import React from 'react';

function Feature({ icon = '-', children }) {
  return (
    <li className="feature-line">
      <span className="feature-line__icon" aria-hidden>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function BenefitCard({ title, description, items }) {
  return (
    <article className="benefit-card">
      <h3>{title}</h3>
      <p>{description}</p>
      <ul>{items.map((item) => <Feature key={item}>{item}</Feature>)}</ul>
    </article>
  );
}

const PLAN_GUIDE = [
  {
    title: 'Profissionais por plano',
    description: 'Escolha o limite de equipe que faz sentido para o seu atendimento.',
    items: [
      'Starter: até 2 profissionais',
      'Pro: até 5 profissionais',
      'Premium: até 10 profissionais',
    ],
  },
  {
    title: 'WhatsApp incluído por mês',
    description: 'Pacotes mensais de mensagens do WhatsApp.',
    items: [
      'Starter: 250 mensagens/mês (confirmações, lembretes e avisos)',
      'Pro: 500 mensagens/mês (confirmações, lembretes e avisos)',
      'Premium: 1.500 mensagens/mês (confirmações, lembretes e avisos)',
    ],
  },
  {
    title: 'Relatórios e suporte',
    description: 'Itens adicionais que mudam conforme o plano.',
    items: [
      'Starter: relatórios básicos',
      'Pro: relatórios avançados, indicadores em tempo real e suporte prioritário via WhatsApp Business',
      'Premium: suporte prioritário e onboarding do time',
    ],
  },
];

export default function PlanosUpperExtras({ onContactPremium = () => {} }) {
  return (
    <>
      <section className="benefits">
        <div className="section-shell">
          <header className="section-header">
            <h2>Entenda o que muda em cada plano</h2>
            <p>Em todos: agendamentos ilimitados e até 5 mensagens por agendamento (confirmações, lembretes e avisos).</p>
          </header>
          <div className="benefits-grid">
            {PLAN_GUIDE.map((benefit) => (
              <BenefitCard key={benefit.title} {...benefit} />
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="section-shell cta-band__inner">
          <div className="cta-band__content">
            <h2>Precisa de ajuda para escolher?</h2>
            <p>Tire dúvidas rápidas e escolha o plano certo para o seu volume.</p>
          </div>
          <button className="btn btn--primary btn--lg" onClick={onContactPremium}>Falar com o time</button>
        </div>
      </section>
    </>
  );
}
