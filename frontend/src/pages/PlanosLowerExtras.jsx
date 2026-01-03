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
    question: 'Quantos profissionais posso usar?',
    answer: 'Starter: até 2 profissionais. Pro: até 5. Premium: até 10.',
  },
  {
    question: 'Como funciona o WhatsApp incluído?',
    answer: 'Cada plano inclui um volume mensal de mensagens: Starter 250, Pro 500 e Premium 1.500. Em todos, são até 5 mensagens por agendamento (confirmações, lembretes e avisos).',
  },
  {
    question: 'O que acontece ao atingir o limite de WhatsApp no Starter?',
    answer: 'No Starter, ao atingir o limite, os avisos continuam por e-mail e painel.',
  },
  {
    question: 'Posso trocar de plano ou de ciclo?',
    answer: (
      <>
        Escolha mensal ou anual e mude o plano em Configurações &gt; Planos. Upgrades liberam recursos imediatamente e o novo valor é cobrado no próximo ciclo. Downgrades valem no ciclo seguinte, desde que os limites do plano sejam atendidos.
        <br />
        <Link className="btn btn--sm btn--outline" to="/configuracoes" style={{ marginTop: 8 }}>
          Ir para Configurações
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
            <p>Respostas rápidas para comparar os planos com segurança.</p>
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
            <h2>Pronto para escolher o plano?</h2>
            <p>Starter e Pro têm 7 dias grátis.</p>
          </div>
          <div className="cta-final__actions">
            <button className="btn btn--primary btn--lg" onClick={onStartTrial}>Testar Pro por 7 dias</button>
            <button className="btn btn--outline btn--lg" onClick={onTalkSpecialist}>Falar com especialista</button>
          </div>
        </div>
      </section>
    </>
  );
}
