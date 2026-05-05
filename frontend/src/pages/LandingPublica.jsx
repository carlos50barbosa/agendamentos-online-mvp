import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LogoAO from '../components/LogoAO.jsx';
import { IconBell, IconMenu, IconMoney, IconSearch, IconStar } from '../components/Icons.jsx';
import { Api, resolveAssetUrl } from '../utils/api.js';
import { getUser } from '../utils/auth.js';

const STEPS = [
  {
    title: 'Escolha',
    text: 'Encontre o estabelecimento ideal para você.',
  },
  {
    title: 'Horário',
    text: 'Veja horários disponíveis e selecione o melhor.',
  },
  {
    title: 'Confirme',
    text: 'Finalize o agendamento em poucos cliques.',
  },
];

const BENEFITS = [
  { icon: IconStar, text: 'Confirmação rápida' },
  { icon: IconSearch, text: 'Horários em tempo real' },
  { icon: IconBell, text: 'Lembretes automáticos' },
  { icon: IconMoney, text: 'Sinal e PIX' },
];

const CATEGORIES = [
  { label: 'BARBEARIA', query: 'barbearia' },
  { label: 'SALÃO', query: 'salao' },
  { label: 'UNHAS', query: 'unhas' },
  { label: 'SOBRANCELHA', query: 'sobrancelha' },
  { label: 'MASSAGEM', query: 'massagem' },
];

const LANDING_NAV = [
  { label: 'Como funciona', href: '#como-funciona' },
  { label: 'Destaques', href: '#destaques' },
  { label: 'FAQ', href: '#faq' },
];

const FAQ_ITEMS = [
  {
    question: 'Preciso instalar aplicativo?',
    answer: 'Não. Você agenda direto pelo navegador, no celular ou PC.',
  },
  {
    question: 'Posso cancelar ou reagendar?',
    answer: 'Sim. Você pode cancelar/reagendar conforme as regras do estabelecimento.',
  },
  {
    question: 'Como encontro um estabelecimento?',
    answer: 'Pesquise por bairro/cidade ou clique em uma categoria para ver opções.',
  },
];

const FEATURED_LIMIT = 6;
const HERO_BRAND_MARK = '/static/logo-v3.png';

const fallbackAvatar = (label) => {
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=1C64F2&color=ffffff&rounded=true`;
};

const formatAddress = (est) => {
  const district = est?.bairro ? String(est.bairro) : '';
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  return [district, cityState].filter(Boolean).join(' • ');
};

export default function LandingPublica() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [featured, setFeatured] = useState([]);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const panelRef = useRef(null);
  const toggleRef = useRef(null);

  const handleScrollToHow = useCallback(() => {
    const target = document.getElementById('como-funciona');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handlePrimaryCta = useCallback(() => {
    const user = getUser();
    const role = String(user?.tipo || '').toLowerCase();
    if (role === 'estabelecimento') {
      navigate('/estab');
      return;
    }
    navigate('/novo');
  }, [navigate]);

  const handleCategoryClick = useCallback((query) => {
    navigate(`/novo?q=${encodeURIComponent(query)}`);
  }, [navigate]);

  const handleToggleFaq = useCallback((index) => {
    setOpenFaqIndex((prev) => (prev === index ? null : index));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await Api.listEstablishments({ limit: FEATURED_LIMIT });
        if (!active) return;
        const list = Array.isArray(response) ? response : response?.items || [];
        setFeatured(list.slice(0, FEATURED_LIMIT));
      } catch {
        if (!active) return;
        setFeatured([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClickOutside = (event) => {
      const panel = panelRef.current;
      const toggle = toggleRef.current;
      if (toggle && toggle.contains(event.target)) return;
      if (panel && panel.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const featuredCards = useMemo(() => {
    return featured
      .filter((item) => item && item.id)
      .map((est) => {
        const name = est?.nome || est?.name || `Estabelecimento #${est?.id || ''}`;
        const address = formatAddress(est);
        const avatarSource = est?.foto_url || est?.avatar_url || '';
        const image = avatarSource ? resolveAssetUrl(avatarSource) : fallbackAvatar(name);
        return {
          id: est.id,
          name,
          address,
          image,
        };
      });
  }, [featured]);

  const heroMetrics = useMemo(() => ([
    { label: 'Fluxo guiado', value: `${STEPS.length} etapas` },
    { label: 'Categorias ativas', value: `${String(CATEGORIES.length).padStart(2, '0')} nichos` },
    { label: 'Perfis em destaque', value: `${featuredCards.length || FEATURED_LIMIT} opções` },
  ]), [featuredCards.length]);

  const heroSpotlights = useMemo(() => featuredCards.slice(0, 2), [featuredCards]);

  const heroStyle = useMemo(() => (
    { '--landing-hero-brand-mark': `url("${HERO_BRAND_MARK}")` }
  ), []);

  const year = new Date().getFullYear();

  return (
    <div className="landing-page">
      <header className={`landing-header${isScrolled ? ' is-scrolled' : ''}`}>
        <div className="landing-header__inner">
          <Link to="/" className="landing-brand" aria-label="Agendamentos Online">
            <LogoAO size={34} className="landing-brand__logo" />
            <span className="landing-brand__text">
              <strong>Agendamentos Online</strong>
            </span>
          </Link>
          <nav className="landing-header__nav" aria-label="Navegação principal">
            {LANDING_NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="landing-header__actions">
            <Link to="/login" className="btn btn--outline btn--sm">Entrar</Link>
            <Link to="/cadastro" className="btn btn--outline-brand btn--sm">Criar conta</Link>
          </div>
          <button
            type="button"
            className="landing-header__toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            ref={toggleRef}
          >
            <IconMenu aria-hidden="true" />
          </button>
        </div>
        <div
          className={`landing-header__panel${menuOpen ? ' is-open' : ''}`}
          id="landing-menu"
          ref={panelRef}
        >
          {LANDING_NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </a>
          ))}
          <Link to="/login" className="btn btn--outline btn--sm" onClick={() => setMenuOpen(false)}>
            Entrar
          </Link>
          <Link to="/cadastro" className="btn btn--outline-brand btn--sm" onClick={() => setMenuOpen(false)}>
            Criar conta
          </Link>
        </div>
      </header>

      <div className="landing">
        <section className="landing-hero" style={heroStyle}>
          <div className="landing-hero__bg" aria-hidden="true" />
          <div className="landing-hero__inner">
            <div className="landing-hero__content">
              <p className="landing-hero__eyebrow">Plataforma premium de agendamentos</p>
              <h1>Agenda profissional com clareza, confiança e operação moderna.</h1>
              <p className="landing-hero__subtitle">
                Descubra estabelecimentos, compare disponibilidade e confirme seu horário em uma jornada enxuta, segura e pronta para uso no celular.
              </p>
              <div className="landing-hero__trust" role="list">
                {BENEFITS.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <div key={benefit.text} className="landing-hero__trust-item" role="listitem">
                      <Icon aria-hidden="true" />
                      <span>{benefit.text}</span>
                    </div>
                  );
                })}
              </div>
              <div className="landing-hero__actions">
                <button type="button" className="btn btn--primary btn--lg" onClick={handlePrimaryCta}>
                  Buscar horários
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--lg"
                  onClick={handleScrollToHow}
                >
                  Entender o fluxo
                </button>
              </div>
            </div>
            <div className="landing-hero__stats" role="list" aria-label="Resumo da plataforma">
              {heroMetrics.map((item) => (
                <div key={item.label} className="landing-hero__stat" role="listitem">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <div className="landing-hero__panels">
              <div className="landing-hero__panel">
                <div className="landing-hero__panel-title">
                  <strong>Jornada orientada</strong>
                  <span>Uma seleção limpa, sem ruído visual e com cada etapa no lugar certo.</span>
                </div>
                <div className="landing-hero__process" role="list" aria-label="Etapas do agendamento">
                  {STEPS.map((step, index) => (
                    <div key={step.title} className="landing-hero__process-item" role="listitem">
                      <span className="landing-hero__process-step">{index + 1}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <span>{step.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="landing-hero__panel">
                <div className="landing-hero__panel-title">
                  <strong>Locais em evidência</strong>
                  <span>Perfis com identidade, atendimento claro e disponibilidade pronta para consulta.</span>
                </div>
                <div className="landing-hero__spotlights">
                  {heroSpotlights.length > 0 ? heroSpotlights.map((item) => (
                    <div key={item.id} className="landing-hero__spotlight">
                      <div className="landing-hero__spotlight-media">
                        <img src={item.image} alt={`Foto do estabelecimento ${item.name}`} />
                      </div>
                      <div className="landing-hero__spotlight-copy">
                        <strong>{item.name}</strong>
                        <span>{item.address || 'Endereço não informado'}</span>
                      </div>
                    </div>
                  )) : (
                    <div className="landing-hero__spotlight-copy">
                      <strong>Catálogo em crescimento</strong>
                      <span>Novos estabelecimentos aparecem aqui assim que estiverem disponíveis.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="como-funciona">
          <div className="landing-section__head">
            <h2>Como funciona</h2>
            <p>Três passos simples para reservar seu horário.</p>
          </div>
          <div className="landing-steps">
            {STEPS.map((step, index) => (
              <div key={step.title} className="landing-card">
                <div className="landing-card__badge">{String(index + 1).padStart(2, '0')}</div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-section__head">
            <h2>Categorias</h2>
            <p>Encontre o serviço ideal para você.</p>
          </div>
          <div className="landing-chips">
            {CATEGORIES.map((category) => (
              <button
                key={category.label}
                type="button"
                className="chip landing-chip landing-chip--link"
                onClick={() => handleCategoryClick(category.query)}
              >
                {category.label}
              </button>
            ))}
          </div>
        </section>

        {featuredCards.length > 0 && (
          <section className="landing-section landing-featured" id="destaques">
            <div className="landing-section__head">
              <h2>Em destaque</h2>
              <p>Agende rapidamente nos estabelecimentos mais procurados.</p>
            </div>
            <div className="landing-featured__grid">
              {featuredCards.map((est) => (
                <article key={est.id} className="landing-featured__card">
                  <div className="landing-featured__media">
                    <img
                      src={est.image}
                      alt={`Foto do estabelecimento ${est.name}`}
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (!target.dataset.fallback) {
                          target.dataset.fallback = '1';
                          target.src = fallbackAvatar(est.name);
                        }
                      }}
                    />
                  </div>
                  <div className="landing-featured__body">
                    <h3>{est.name}</h3>
                    <p>{est.address || 'Endereço não informado'}</p>
                    <Link
                      to={`/novo?estabelecimentoId=${encodeURIComponent(est.id)}`}
                      className="btn btn--outline btn--sm"
                    >
                      Ver horários
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="landing-section landing-faq" id="faq">
          <div className="landing-section__head">
            <h2>FAQ rápido</h2>
            <p>Tire dúvidas comuns antes de agendar.</p>
          </div>
          <div className="landing-faq__list">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaqIndex === index;
              const buttonId = `landing-faq-button-${index}`;
              const panelId = `landing-faq-panel-${index}`;
              return (
                <div key={item.question} className={`landing-faq__item${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="landing-faq__button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    id={buttonId}
                    onClick={() => handleToggleFaq(index)}
                  >
                    <span>{item.question}</span>
                    <span className="landing-faq__icon" aria-hidden="true">{isOpen ? '-' : '+'}</span>
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    hidden={!isOpen}
                    className="landing-faq__panel"
                  >
                    <p>{item.answer}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer__links">
            <Link to="/termos">Termos</Link>
            <Link to="/politica-privacidade">Privacidade</Link>
            <Link to="/ajuda">Ajuda</Link>
          </div>
          <p className="landing-footer__copy">© {year} Agendamentos Online</p>
        </footer>
      </div>
    </div>
  );
}

