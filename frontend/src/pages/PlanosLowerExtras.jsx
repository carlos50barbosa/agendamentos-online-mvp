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
    question: 'Como funcionam as mensagens automáticas de WhatsApp?',
    answer: 'Starter tem 250 mensagens automáticas de WhatsApp por mês, Pro tem 500 e Premium tem 1.500. Em todos, existe limite de até 5 mensagens por agendamento.',
  },
  {
    question: 'O que acontece ao atingir o limite de WhatsApp?',
    answer: 'Ao atingir o limite de WhatsApp, os avisos continuam por e-mail e pelo painel. Também é possível comprar pacotes extras via PIX.',
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

export default function PlanosLowerExtras({
  primaryCtaLabel = 'Testar Pro por 7 dias',
  primaryCtaDescription = 'O Pro tem 7 dias grátis para contas elegíveis.',
  onPrimaryCta = () => {},
  onTalkSpecialist = () => {},
}) {
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
            <p>{primaryCtaDescription}</p>
          </div>
          <div className="cta-final__actions">
            <button className="btn btn--primary btn--lg" onClick={onPrimaryCta}>{primaryCtaLabel}</button>
            <button className="btn btn--outline btn--lg" onClick={onTalkSpecialist}>Falar com especialista</button>
          </div>
        </div>
      </section>
    </>
  );
}
