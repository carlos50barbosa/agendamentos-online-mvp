import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Dumbbell,
  HelpCircle,
  Handshake,
  Link2,
  Menu,
  MessageCircle,
  MonitorSmartphone,
  PawPrint,
  Scissors,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Store,
  Timer,
  Users,
  X,
} from 'lucide-react';
import LogoAO from '../components/LogoAO.jsx';
import { Api } from '../utils/api.js';
import './LandingImplantacao.css';

export const WHATSAPP_NUMBER = '5500000000000';

const WHATSAPP_MESSAGE = 'Olá, tenho interesse na implantação da agenda online.';
const IMPLEMENTATION_PRODUCT = 'implantacao_agenda_online';
const IMPLEMENTATION_AMOUNT_CENTS = 19700;

const NAV_ITEMS = [
  { label: 'Benefícios', id: 'beneficios' },
  { label: 'Implantação', id: 'implantacao' },
  { label: 'Planos', id: 'planos' },
  { label: 'FAQ', id: 'faq' },
];

const PROBLEMS = [
  { icon: MessageCircle, title: 'Muitas mensagens repetitivas no WhatsApp' },
  { icon: CalendarClock, title: 'Confusão com horários e remarcações' },
  { icon: Bell, title: 'Clientes esquecendo os agendamentos' },
  { icon: Link2, title: 'Falta de um link profissional para divulgar na bio' },
];

const FEATURES = [
  { icon: MonitorSmartphone, title: 'Página pública de agendamento' },
  { icon: ClipboardList, title: 'Cadastro de serviços' },
  { icon: Users, title: 'Cadastro de profissionais' },
  { icon: Clock, title: 'Controle de horários' },
  { icon: Store, title: 'Painel do estabelecimento' },
  { icon: Bell, title: 'Lembretes e confirmações' },
  { icon: BarChart3, title: 'Relatórios básicos' },
  { icon: Link2, title: 'Link para colocar no Instagram e WhatsApp' },
];

const IMPLEMENTATION_ITEMS = [
  'Criação/configuração da conta do estabelecimento',
  'Cadastro inicial dos serviços',
  'Cadastro dos profissionais',
  'Configuração dos horários de atendimento',
  'Link público personalizado de agendamento',
  'Orientação inicial de uso',
  'Suporte na primeira configuração',
];

const BENEFITS = [
  { icon: MessageCircle, title: 'Reduza mensagens repetitivas' },
  { icon: CalendarCheck, title: 'Evite conflitos de horário' },
  { icon: Link2, title: 'Divulgue um link profissional' },
  { icon: Sparkles, title: 'Melhore a experiência do cliente' },
  { icon: Settings, title: 'Ganhe mais controle sobre a rotina' },
  { icon: Timer, title: 'Receba agendamentos mesmo fora do horário comercial' },
];

const PLANS = [
  {
    name: 'Starter',
    price: 'R$ 14,90/mês',
    description: 'Indicado para autônomos e pequenos negócios',
    features: [
      'Até 2 profissionais',
      'Agenda online',
      'Cadastro de serviços',
      'Link de agendamento',
      'Painel do estabelecimento',
    ],
    cta: 'Começar com Starter',
  },
  {
    name: 'Pro',
    price: 'R$ 29,90/mês',
    description: 'Indicado para estabelecimentos em crescimento',
    featured: true,
    features: [
      'Até 5 profissionais',
      'Mais mensagens WhatsApp',
      'Relatórios',
      'Controle de agendamentos',
      'Recursos de pagamento/sinal quando disponível',
    ],
    cta: 'Começar com Pro',
  },
  {
    name: 'Premium',
    price: 'R$ 99,90/mês',
    description: 'Indicado para negócios maiores',
    features: [
      'Até 10 profissionais',
      'Mais mensagens WhatsApp',
      'Recursos avançados',
      'Suporte prioritário',
      'Mais controle para a equipe',
    ],
    cta: 'Começar com Premium',
  },
];

const AUDIENCES = [
  { icon: Scissors, label: 'Salões de beleza' },
  { icon: BadgeCheck, label: 'Barbearias' },
  { icon: Sparkles, label: 'Clínicas de estética' },
  { icon: CheckCircle2, label: 'Studios de cílios e sobrancelhas' },
  { icon: Handshake, label: 'Manicures' },
  { icon: Stethoscope, label: 'Consultórios' },
  { icon: Dumbbell, label: 'Personal trainers' },
  { icon: PawPrint, label: 'Pet shops com banho e tosa' },
];

const STEPS = [
  'Você solicita a implantação',
  'Coletamos as informações do estabelecimento',
  'Configuramos serviços, profissionais e horários',
  'Você começa a receber agendamentos pelo link',
];

const FAQ_ITEMS = [
  {
    question: 'Preciso saber mexer com tecnologia?',
    answer: 'Não. A implantação é assistida e você recebe orientação inicial.',
  },
  {
    question: 'Depois da implantação existe mensalidade?',
    answer: 'Sim. Após a implantação, você escolhe um plano mensal Starter, Pro ou Premium, a partir de R$ 14,90/mês.',
  },
  {
    question: 'Posso colocar o link no Instagram?',
    answer: 'Sim. O link de agendamento pode ser usado na bio do Instagram, WhatsApp e outras redes.',
  },
  {
    question: 'Serve para profissional autônomo?',
    answer: 'Sim. O plano Starter é ideal para autônomos e pequenos negócios.',
  },
  {
    question: 'Posso cadastrar mais de um profissional?',
    answer: 'Sim. A quantidade depende do plano escolhido.',
  },
];

function buildWhatsAppUrl() {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
}

function SectionIntro({ eyebrow, title, text, align = 'center' }) {
  return (
    <div className={`implantacao-section__intro implantacao-section__intro--${align}`}>
      {eyebrow && <span className="implantacao-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function IconCard({ icon: Icon, title, text }) {
  return (
    <article className="implantacao-icon-card">
      <span className="implantacao-icon-card__icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
      </div>
    </article>
  );
}

function PlanCard({ plan, onBuy, isBuying }) {
  const planKey = String(plan.name || '').toLowerCase();

  return (
    <article className={`implantacao-plan-card${plan.featured ? ' implantacao-plan-card--featured' : ''}`}>
      {plan.featured && <span className="implantacao-plan-card__badge">Mais escolhido</span>}
      <div className="implantacao-plan-card__top">
        <h3>{plan.name}</h3>
        <strong>{plan.price}</strong>
        <p>{plan.description}</p>
      </div>
      <ul className="implantacao-plan-card__features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <Check aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="implantacao-btn implantacao-btn--block implantacao-btn--outline"
        onClick={() => onBuy(planKey)}
        disabled={isBuying}
      >
        {isBuying ? 'Abrindo checkout...' : plan.cta}
      </button>
    </article>
  );
}

function FaqItem({ item, index, isOpen, onToggle }) {
  const buttonId = `implantacao-faq-button-${index}`;
  const panelId = `implantacao-faq-panel-${index}`;

  return (
    <div className={`implantacao-faq__item${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="implantacao-faq__button"
        id={buttonId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span>{item.question}</span>
        {isOpen ? <X aria-hidden="true" /> : <HelpCircle aria-hidden="true" />}
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="implantacao-faq__panel"
        hidden={!isOpen}
      >
        <p>{item.answer}</p>
      </div>
    </div>
  );
}

export default function LandingImplantacao() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [buyingPlan, setBuyingPlan] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const whatsAppUrl = useMemo(() => buildWhatsAppUrl(), []);

  const scrollToSection = useCallback((id) => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  }, []);

  const handleBuyImplementation = useCallback(async (planHint = '') => {
    if (buyingPlan) return;

    const normalizedPlan = String(planHint || '').toLowerCase();
    setBuyingPlan(normalizedPlan || 'implementation');
    setCheckoutNotice('');

    try {
      const response = await Api.billingImplementationCheckout({
        produto: IMPLEMENTATION_PRODUCT,
        valor_centavos: IMPLEMENTATION_AMOUNT_CENTS,
        tipo: 'one_time',
        plan_hint: ['starter', 'pro', 'premium'].includes(normalizedPlan) ? normalizedPlan : undefined,
      });
      const checkoutUrl = response?.checkout_url;
      if (!checkoutUrl) throw new Error('checkout_url_missing');
      window.location.assign(checkoutUrl);
    } catch (error) {
      console.warn('[LandingImplantacao] checkout indisponível, redirecionando para WhatsApp', error);
      setCheckoutNotice('Checkout online indisponível no momento. Abrindo atendimento no WhatsApp para continuar a implantação.');
      window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
      setBuyingPlan('');
    }
  }, [buyingPlan, whatsAppUrl]);

  const year = new Date().getFullYear();

  return (
    <div className="implantacao-page">
      <header className="implantacao-header">
        <div className="implantacao-header__inner">
          <Link to="/" className="implantacao-brand" aria-label="Agendamentos Online">
            <LogoAO size={34} />
            <span>Agendamentos Online</span>
          </Link>

          <nav className="implantacao-header__nav" aria-label="Menu principal">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} type="button" onClick={() => scrollToSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <button
            className="implantacao-btn implantacao-btn--primary implantacao-header__cta"
            type="button"
            onClick={() => handleBuyImplementation()}
            disabled={Boolean(buyingPlan)}
          >
            {buyingPlan ? 'Abrindo checkout...' : 'Começar agora'}
          </button>

          <button
            type="button"
            className="implantacao-header__toggle"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls="implantacao-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>

        <div className={`implantacao-header__mobile${menuOpen ? ' is-open' : ''}`} id="implantacao-mobile-menu">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" onClick={() => scrollToSection(item.id)}>
              {item.label}
            </button>
          ))}
          <button
            className="implantacao-btn implantacao-btn--primary implantacao-btn--block"
            type="button"
            onClick={() => handleBuyImplementation()}
            disabled={Boolean(buyingPlan)}
          >
            {buyingPlan ? 'Abrindo checkout...' : 'Começar agora'}
          </button>
        </div>
      </header>

      <main>
        <section className="implantacao-hero">
          <div className="implantacao-container implantacao-hero__grid">
            <div className="implantacao-hero__content">
              <span className="implantacao-hero__tag">
                <ShieldCheck aria-hidden="true" />
                Implantação assistida para estabelecimentos
              </span>
              <h1>Sua agenda online pronta para receber clientes</h1>
              <p>
                Implantamos sua agenda online com serviços, profissionais, horários e link personalizado para seus clientes marcarem sem precisar trocar várias mensagens no WhatsApp.
              </p>
              <div className="implantacao-hero__offer">
                <strong>Implantação completa por R$ 197</strong>
                <span>Pagamento único. Após a implantação, escolha um plano mensal a partir de R$ 14,90/mês.</span>
              </div>
              <div className="implantacao-hero__actions">
                <button
                  className="implantacao-btn implantacao-btn--primary implantacao-btn--lg"
                  type="button"
                  onClick={() => handleBuyImplementation()}
                  disabled={Boolean(buyingPlan)}
                >
                  {buyingPlan ? 'Abrindo checkout...' : 'Comprar implantação por R$ 197'}
                  <ArrowRight aria-hidden="true" />
                </button>
                <a className="implantacao-btn implantacao-btn--secondary implantacao-btn--lg" href={whatsAppUrl} target="_blank" rel="noreferrer">
                  Tirar dúvidas no WhatsApp
                </a>
                <button className="implantacao-btn implantacao-btn--ghost implantacao-btn--lg" type="button" onClick={() => scrollToSection('planos')}>
                  Ver planos mensais
                </button>
              </div>
              {checkoutNotice && <p className="implantacao-checkout-notice" role="status">{checkoutNotice}</p>}
              <p className="implantacao-hero__trust">Implantação assistida + suporte inicial para começar com segurança.</p>
            </div>

            <div className="implantacao-hero__visual" aria-label="Prévia visual da agenda online">
              <div className="implantacao-dashboard">
                <div className="implantacao-dashboard__top">
                  <div className="implantacao-dashboard__brand">
                    <img src="/static/logo-v3.png" alt="" />
                    <div>
                      <strong>Studio Bella</strong>
                      <span>agenda.agendamentosonline.com/studiobella</span>
                    </div>
                  </div>
                  <span className="implantacao-status">
                    <CheckCircle2 aria-hidden="true" />
                    Online
                  </span>
                </div>
                <div className="implantacao-dashboard__body">
                  <div className="implantacao-calendar-card">
                    <div className="implantacao-calendar-card__header">
                      <span>Hoje</span>
                      <strong>14 agendamentos</strong>
                    </div>
                    <div className="implantacao-calendar-card__slots">
                      {['09:00', '10:30', '14:00', '16:30'].map((time, index) => (
                        <div key={time} className="implantacao-slot">
                          <span>{time}</span>
                          <strong>{index % 2 === 0 ? 'Corte + escova' : 'Design de sobrancelhas'}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="implantacao-phone">
                    <div className="implantacao-phone__bar" />
                    <h3>Agendar horário</h3>
                    <div className="implantacao-phone__choice">
                      <CalendarDays aria-hidden="true" />
                      <span>Escolha o dia</span>
                    </div>
                    <div className="implantacao-phone__choice">
                      <Users aria-hidden="true" />
                      <span>Escolha o profissional</span>
                    </div>
                    <button type="button">Confirmar horário</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="implantacao-section implantacao-section--soft" id="problema">
          <div className="implantacao-container">
            <SectionIntro
              title="Seu estabelecimento ainda perde tempo marcando horários manualmente?"
              text="Responder várias mensagens, conferir disponibilidade, remarcar horários e lembrar clientes pode consumir muito tempo da rotina. Com uma agenda online, seus clientes escolhem serviço, profissional, dia e horário disponíveis em poucos cliques."
            />
            <div className="implantacao-grid implantacao-grid--four">
              {PROBLEMS.map((item) => (
                <IconCard key={item.title} icon={item.icon} title={item.title} />
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-section" id="solucao">
          <div className="implantacao-container">
            <SectionIntro title="Com o Agendamentos Online, sua agenda fica organizada em um só lugar" />
            <div className="implantacao-grid implantacao-grid--four">
              {FEATURES.map((item) => (
                <IconCard key={item.title} icon={item.icon} title={item.title} />
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-section implantacao-setup" id="implantacao">
          <div className="implantacao-container implantacao-setup__grid">
            <div>
              <SectionIntro
                align="left"
                eyebrow="Implantação completa"
                title="Você não precisa configurar tudo sozinho"
                text="Nós deixamos sua agenda online pronta para uso, com as principais configurações iniciais aplicadas."
              />
              <ul className="implantacao-checklist">
                {IMPLEMENTATION_ITEMS.map((item) => (
                  <li key={item}>
                    <CheckCircle2 aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <aside className="implantacao-price-card">
              <span className="implantacao-price-card__label">Oferta principal</span>
              <strong>Implantação completa por R$ 197</strong>
              <p>Pagamento único. Inclui configuração inicial, orientação de uso e suporte na primeira configuração.</p>
              <p>Após a implantação, escolha um plano mensal a partir de R$ 14,90/mês.</p>
              <button
                className="implantacao-btn implantacao-btn--primary implantacao-btn--block implantacao-btn--lg"
                type="button"
                onClick={() => handleBuyImplementation()}
                disabled={Boolean(buyingPlan)}
              >
                {buyingPlan ? 'Abrindo checkout...' : 'Garantir minha implantação'}
              </button>
              <a className="implantacao-btn implantacao-btn--secondary implantacao-btn--block" href={whatsAppUrl} target="_blank" rel="noreferrer">
                Falar com atendimento
              </a>
            </aside>
          </div>
        </section>

        <section className="implantacao-section implantacao-section--soft" id="beneficios">
          <div className="implantacao-container">
            <SectionIntro title="Mais organização, menos mensagens e uma experiência melhor para seus clientes" />
            <div className="implantacao-grid implantacao-grid--three">
              {BENEFITS.map((item) => (
                <IconCard key={item.title} icon={item.icon} title={item.title} />
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-section" id="planos">
          <div className="implantacao-container">
            <SectionIntro title="Escolha o plano ideal para o seu estabelecimento" />
            <div className="implantacao-plans">
              {PLANS.map((plan) => (
                <PlanCard
                  key={plan.name}
                  plan={plan}
                  onBuy={handleBuyImplementation}
                  isBuying={Boolean(buyingPlan)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-section implantacao-section--soft" id="para-quem">
          <div className="implantacao-container">
            <SectionIntro title="Feito para negócios que trabalham com horários marcados" />
            <div className="implantacao-audience">
              {AUDIENCES.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="implantacao-audience__item">
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="implantacao-section" id="como-funciona">
          <div className="implantacao-container">
            <SectionIntro title="Como funciona a implantação" />
            <div className="implantacao-timeline">
              {STEPS.map((step, index) => (
                <article key={step} className="implantacao-timeline__step">
                  <span>{index + 1}</span>
                  <h3>{step}</h3>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-section implantacao-section--soft" id="faq">
          <div className="implantacao-container implantacao-faq">
            <SectionIntro title="Perguntas frequentes" />
            <div className="implantacao-faq__list">
              {FAQ_ITEMS.map((item, index) => (
                <FaqItem
                  key={item.question}
                  item={item}
                  index={index}
                  isOpen={openFaq === index}
                  onToggle={() => setOpenFaq((current) => (current === index ? -1 : index))}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="implantacao-final">
          <div className="implantacao-container implantacao-final__box">
            <div className="implantacao-final__copy">
              <span className="implantacao-eyebrow">Agenda profissional</span>
              <h2>Pronto para ter sua agenda online funcionando?</h2>
              <p>Solicite a implantação e deixe seu estabelecimento preparado para receber agendamentos de forma mais profissional.</p>
            </div>
            <div className="implantacao-final__actions">
              <button
                className="implantacao-btn implantacao-btn--primary implantacao-btn--lg"
                type="button"
                onClick={() => handleBuyImplementation()}
                disabled={Boolean(buyingPlan)}
              >
                {buyingPlan ? 'Abrindo checkout...' : 'Comprar implantação por R$ 197'}
                <Send aria-hidden="true" />
              </button>
              <a className="implantacao-btn implantacao-btn--secondary implantacao-btn--lg" href={whatsAppUrl} target="_blank" rel="noreferrer">
                Falar com atendimento
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="implantacao-footer">
        <div className="implantacao-container implantacao-footer__inner">
          <div className="implantacao-footer__brand">
            <LogoAO size={30} />
            <span>Agendamentos Online</span>
          </div>
          <nav aria-label="Links do rodapé">
            <button type="button" onClick={() => scrollToSection('beneficios')}>Benefícios</button>
            <button type="button" onClick={() => scrollToSection('planos')}>Planos</button>
            <button type="button" onClick={() => scrollToSection('faq')}>FAQ</button>
            <Link to="/termos">Termos</Link>
          </nav>
          <p>© {year} Agendamentos Online. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
