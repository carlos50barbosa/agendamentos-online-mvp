import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatBRPhone } from '../utils/masks.js';

const PLAN_LABELS = {
  starter: 'Plano Starter',
  pro: 'Plano Pro',
  premium: 'Plano Premium',
};

const CYCLE_LABELS = {
  mensal: 'cobrança mensal',
  anual: 'cobrança anual',
};

const CONTACT_CHANNELS = [
  {
    icon: '💬',
    title: 'WhatsApp',
    description: 'Atendimento rápido com nosso time comercial.',
    primary: true,
    actionLabel: 'Abrir WhatsApp',
    href: 'https://wa.me/5511915155349?text=Ol%C3%A1%20Time%20Agendamentos%20Online!%20Quero%20conhecer%20os%20planos.',
  },
  {
    icon: '📧',
    title: 'E-mail',
    description: 'Envie detalhes do seu negócio para receber uma proposta personalizada.',
    actionLabel: 'Enviar e-mail',
    href: 'mailto:servicos.negocios.digital@gmail.com',
  },
  {
    icon: '📅',
    title: 'Agendar demonstração',
    description: 'Escolha o melhor horário para uma conversa guiada com nosso especialista.',
    actionLabel: 'Reservar horário',
    href: 'https://cal.com/agendamentos-online/demo',
  },
];

function ContactCard({ channel }) {
  return (
    <article className={`contact-card${channel.primary ? ' is-primary' : ''}`}>
      <div className="contact-card__icon" aria-hidden>{channel.icon}</div>
      <h3>{channel.title}</h3>
      <p>{channel.description}</p>
      <a className="btn btn--sm" href={channel.href} target="_blank" rel="noreferrer">
        {channel.actionLabel}
      </a>
    </article>
  );
}

export default function Contato() {
  const [searchParams] = useSearchParams();
  const [formSent, setFormSent] = useState(false);
  const [form, setForm] = useState({
    nome: '',
    email: '',
    empresa: '',
    telefone: '',
    mensagem: '',
  });

  const planFocus = useMemo(() => {
    const plan = (searchParams.get('plano') || '').toLowerCase();
    const cycle = (searchParams.get('ciclo') || '').toLowerCase();
    if (!PLAN_LABELS[plan]) return null;
    const cycleLabel = CYCLE_LABELS[cycle];
    return cycleLabel ? `${PLAN_LABELS[plan]} com ${cycleLabel}` : PLAN_LABELS[plan];
  }, [searchParams]);

  useEffect(() => {
    if (planFocus && !form.mensagem) {
      setForm((prev) => ({
        ...prev,
        mensagem: `Olá! Gostaria de conversar sobre o ${planFocus}.`,
      }));
    }
  }, [planFocus, form.mensagem]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    const nextValue = name === 'telefone' ? formatBRPhone(value) : value;
    setForm((prev) => ({ ...prev, [name]: nextValue }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const { nome, email, empresa, telefone, mensagem } = form;
    const subject = encodeURIComponent('Contato via site Agendamentos Online');
    const lines = [
      `Nome: ${nome || ''}`,
      `E-mail: ${email || ''}`,
      `Empresa: ${empresa || ''}`,
      `Telefone: ${telefone || ''}`,
      '',
      mensagem || '',
    ];
    const body = encodeURIComponent(lines.join('\n'));
    window.location.href = `mailto:servicos.negocios.digital@gmail.com?subject=${subject}&body=${body}`;
    setFormSent(true);
  };

  return (
    <div className="contato-page">
      <section className="contact-hero">
        <div className="section-shell contact-hero__inner">
          <div>
            <span className="tag tag--accent">Vamos conversar</span>
            <h1>Fale com o time de especialistas</h1>
            <p>
              Entenda como o Agendamentos Online se adapta ao seu fluxo, conecta ferramentas e acelera o retorno sobre
              cada atendimento.
            </p>
            {planFocus && <div className="contact-focus">Interesse sinalizado: {planFocus}</div>}
          </div>
          <div className="contact-hero__support" aria-hidden>
            <div className="contact-hero__bubble contact-hero__bubble--primary">Tempo médio de resposta: 2h</div>
            <div className="contact-hero__bubble contact-hero__bubble--outline">Implantação guiada em até 7 dias</div>
          </div>
        </div>
      </section>

      <section className="contact-grid-section">
        <div className="section-shell">
          <div className="contact-grid">
            {CONTACT_CHANNELS.map((channel) => (
              <ContactCard key={channel.title} channel={channel} />
            ))}
          </div>
        </div>
      </section>

      <section className="contact-form-section">
        <div className="section-shell">
          <div className="contact-form-card">
            <header>
              <h2>Prefere enviar um recado?</h2>
              <p>Responda as perguntas abaixo e retornaremos em até um dia útil.</p>
            </header>
            {formSent ? (
              <div className="contact-form__feedback" role="status">
                Obrigado! Abrimos seu e-mail no aplicativo padrão. Caso não visualize, escreva para servicos.negocios.digital@gmail.com.
              </div>
            ) : (
              <form className="contact-form" onSubmit={handleSubmit}>
                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <label className="field">
                    <span>Nome completo</span>
                    <input
                      name="nome"
                      type="text"
                      value={form.nome}
                      onChange={handleChange}
                      placeholder="Ex.: Camila Santos"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>E-mail</span>
                    <input
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      placeholder="nome@email.com"
                      required
                    />
                  </label>
                </div>
                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <label className="field">
                    <span>Empresa ou estabelecimento</span>
                    <input
                      name="empresa"
                      type="text"
                      value={form.empresa}
                      onChange={handleChange}
                      placeholder="Nome da clínica, salão ou estúdio"
                    />
                  </label>
                  <label className="field">
                    <span>Telefone / WhatsApp</span>
                    <input
                      name="telefone"
                      type="tel"
                      value={form.telefone}
                      onChange={handleChange}
                      placeholder="DDD + número"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Mensagem</span>
                  <textarea
                    name="mensagem"
                    rows="4"
                    value={form.mensagem}
                    onChange={handleChange}
                    placeholder="Conte um pouco sobre seu momento e desafios."
                  />
                </label>
                <button className="btn btn--primary" type="submit">Abrir e-mail de contato</button>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="contact-faq">
        <div className="section-shell">
          <div className="contact-faq__grid">
            <div>
              <h2>Como funciona a conversa?</h2>
              <p>
                Nosso time entende o contexto do seu negócio, demonstra os principais fluxos da plataforma e sugere a
                configuração inicial. Se fizer sentido, seguimos para proposta formal e implantação.
              </p>
            </div>
            <ul className="contact-faq__list">
              <li>Mapeamos ferramentas atuais e integrações necessárias.</li>
              <li>Apresentamos benchmarks do seu segmento.</li>
              <li>Indicamos o plano ideal considerando equipe, serviços e expansão.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
