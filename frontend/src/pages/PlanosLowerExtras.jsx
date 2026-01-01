import React from 'react';
import { Link } from 'react-router-dom';

function FAQItem({ question, answer }) {
  return (
    <details className="faq-item">
      <summary>{question}</summary>
      <p>{answer}</p>
    </details>
  );
}

const FAQS = [
  {
    question: 'Preciso trocar todas as minhas ferramentas para usar o Agendamentos Online?',
    answer: 'NÇœo. DÇ­ para comeÇõar usando apenas o que jÇ­ oferecemos hoje (agenda online, notificaÇõÇæes e relatÇürios) e manter as demais ferramentas que vocÇ¦ utiliza no dia a dia. Assim que novas integraÇõÇæes ficarem disponÇðveis ajudamos vocÇ¦ a conectar tudo com seguranÇõa.',
  },
  {
    question: 'Existe taxa de implantaÇõÇœo ou contrato de fidelidade?',
    answer: 'NÇœo existem taxas escondidas e o contrato Ç¸ mensal. No plano Premium oferecemos onboarding assistido e migraÇõÇœo personalizada jÇ­ inclusos na mensalidade.',
  },
  {
    question: 'Consigo testar com minha equipe antes de decidir?',
    answer: 'Sim! Todos os planos tÇ¦m 7 dias grÇ­tis com acesso completo. Nesse perÇðodo nosso time de sucesso acompanha a configuraÇõÇœo e apresenta as melhores prÇ­ticas para seu segmento.',
  },
  {
    question: 'Como funcionam upgrades e downgrades de plano?',
    answer: (
      <>
        Upgrades liberam recursos imediatamente e a cobranÇõa do novo valor ocorre no prÇüximo ciclo de faturamento.
        Downgrades passam a valer no ciclo seguinte, desde que os limites do plano (como quantidade de serviÇõos e profissionais) sejam atendidos.
        <br />
        <Link className="btn btn--sm btn--outline" to="/configuracoes" style={{ marginTop: 8 }}>
          Ir para ConfiguraÇõÇæes
        </Link>
      </>
    ),
  },
];

export default function PlanosLowerExtras({ onStartTrial = () => {}, onTalkSpecialist = () => {} }) {
  return (
    <>
      <section className="faq">
        <div className="section-shell">
          <header className="section-header">
            <h2>Perguntas frequentes</h2>
            <p>TransparÇ¦ncia desde o primeiro contato. Se algo nÇœo ficou claro, fale com a gente.</p>
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
            <p>Comece hoje com 7 dias grÇ­tis. Sem cartÇœo de crÇ¸dito, sem compromisso.</p>
          </div>
          <div className="cta-final__actions">
            <button className="btn btn--primary btn--lg" onClick={onStartTrial}>Quero testar agora</button>
            <button className="btn btn--outline btn--lg" onClick={onTalkSpecialist}>Agendar conversa com especialista</button>
          </div>
        </div>
      </section>
    </>
  );
}
