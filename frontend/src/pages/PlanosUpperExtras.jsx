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
    title: 'Equipe e galeria',
    description: 'Cada plano muda o tamanho da equipe e o limite da galeria pública.',
    items: [
      'Starter: até 2 profissionais e até 5 imagens na galeria',
      'Pro: até 5 profissionais e até 15 imagens na galeria',
      'Premium: até 10 profissionais e galeria sem limite de imagens',
    ],
  },
  {
    title: 'WhatsApp incluído por mês',
    description: 'Pacotes mensais de mensagens do WhatsApp.',
    items: [
      'Starter: 250 mensagens/mês para confirmações, lembretes e avisos',
      'Pro: 500 mensagens/mês para confirmações, lembretes e avisos',
      'Premium: 1.500 mensagens/mês para confirmações, lembretes e avisos',
    ],
  },
  {
    title: 'Relatórios e pagamentos',
    description: 'Os recursos operacionais mudam conforme o plano contratado.',
    items: [
      'Starter: relatórios básicos e sem sinal via PIX com Mercado Pago',
      'Pro: relatórios avançados e sinal via PIX com Mercado Pago',
      'Premium: relatórios avançados e sinal via PIX com Mercado Pago',
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
            <p>Em todos: serviços e agendamentos ilimitados no sistema, com até 5 mensagens por agendamento.</p>
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
