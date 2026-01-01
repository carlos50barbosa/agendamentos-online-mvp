import React from 'react';

function Feature({ icon = 'ƒo.', children }) {
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
      <ul>{items.map((item, index) => <Feature key={index}>{item}</Feature>)}</ul>
    </article>
  );
}

function TestimonialCard({ quote, name, role }) {
  return (
    <figure className="testimonial-card">
      <blockquote>ƒ?o{quote}ƒ??</blockquote>
      <figcaption>
        <strong>{name}</strong>
        <span>{role}</span>
      </figcaption>
    </figure>
  );
}

const CORE_BENEFITS = [
  {
    title: 'Transforme o primeiro contato em fidelizaÇõÇœo',
    description: 'Centralize WhatsApp, Instagram, Google e seu site em uma agenda inteligente que responde sozinha e nunca esquece um cliente.',
    items: [
      'Link de agendamento personalizado para divulgar nas redes sociais',
      'ConfirmaÇõÇæes automÇ­ticas por WhatsApp, SMS e e-mail',
      'Lista de espera inteligente para ocupar horÇ­rios cancelados',
    ],
  },
  {
    title: 'OperaÇõÇœo eficiente do balcÇœo ao financeiro',
    description: 'Otimize o tempo da sua equipe com fluxos automatizados e relatÇürios que mostram onde concentrar esforÇõos.',
    items: [
      'Painel em tempo real com profissionais, salas e recursos',
      'RelatÇürios de receita, cancelamentos e ticket mÇ¸dio',
      'ExportaÇõÇœo contÇ­bil com um clique (CSV, Excel e API)',
    ],
  },
  {
    title: 'ExperiÇ¦ncia premium para seus clientes',
    description: 'Encante em todas as etapas com lembretes gentis, confirmaÇõÇæes instantÇ½neas e um checkout sem fricÇõÇœo.',
    items: [
      'Chat de prÇ¸-atendimento com roteiros salvos para cada serviÇõo',
      'Pesquisa de satisfaÇõÇœo pÇüs-atendimento automÇ­tica',
      'IntegraÇõÇœo com carteiras digitais e pagamento na reserva',
    ],
  },
];

const TESTIMONIALS = [
  {
    quote: 'Triplicamos a base de clientes recorrentes sem contratar mais recepcionistas. A agenda online virou nosso melhor vendedor.',
    name: 'Vanessa Moura',
    role: 'Diretora do EspaÇõo EssÇ¦ncia (SP)',
  },
  {
    quote: 'Os lembretes automÇ­ticos reduziram faltas em 63%. Hoje temos previsibilidade para investir em mÇðdia e equipe.',
    name: 'Paulo Martins',
    role: 'Fundador do Studio Barber Pro (BH)',
  },
  {
    quote: 'Organizamos 14 unidades com o mesmo padrÇœo de atendimento. Os relatÇürios deram clareza para acelerar a expansÇœo.',
    name: 'Luciana Pereira',
    role: 'COO da rede SunNails',
  },
];

export default function PlanosUpperExtras({ onContactPremium = () => {} }) {
  return (
    <>
      <section className="benefits">
        <div className="section-shell">
          <header className="section-header">
            <h2>Resultados previsÇðveis em cada etapa da jornada</h2>
            <p>Do primeiro contato atÇ¸ o pÇüs-atendimento, o Agendamentos Online cuida da experiÇ¦ncia para vocÇ¦ focar no crescimento.</p>
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
            <p>ImplantaÇõÇœo guiada, suporte humano e insights diÇ­rios para acelerar decisÇæes.</p>
          </div>
          <button className="btn btn--primary btn--lg" onClick={onContactPremium}>Quero falar com o time</button>
        </div>
      </section>

      <section className="testimonials">
        <div className="section-shell">
          <header className="section-header">
            <h2>HistÇürias de estabelecimentos que decidiram crescer com a gente</h2>
            <p>Mais escala, menos improviso e uma experiÇ¦ncia de agendamento que os clientes realmente amam.</p>
          </header>
          <div className="testimonials-grid">
            {TESTIMONIALS.map((item) => (
              <TestimonialCard key={item.name} {...item} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
