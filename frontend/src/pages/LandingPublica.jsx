import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconArrowRight,
  IconCalendar,
  IconEyebrow,
  IconGrid,
  IconMapPin,
  IconMassage,
  IconNail,
  IconSalon,
  IconScissors,
  IconSearch,
  IconChevronRight,
} from '../components/Icons.jsx';
import { Api, resolveAssetUrl } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import styles from './LandingPublica.module.css';

const CATEGORIES = [
  { label: 'Barbearia', query: 'barbearia', icon: IconScissors },
  { label: 'Salão', query: 'salao', icon: IconSalon },
  { label: 'Unhas', query: 'unhas', icon: IconNail },
  { label: 'Sobrancelha', query: 'sobrancelha', icon: IconEyebrow },
  { label: 'Massagem', query: 'massagem', icon: IconMassage },
];

const STEPS = [
  { title: 'Escolha o local', text: 'Busque ou toque numa categoria.' },
  { title: 'Pegue o horário', text: 'Veja o que está livre e selecione.' },
  { title: 'Confirme', text: 'Pronto — o lembrete chega no WhatsApp.' },
];

const FEATURED_LIMIT = 6;

const fallbackAvatar = (label) => {
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=5049E5&color=ffffff&rounded=true`;
};

const formatAddress = (est) => {
  const district = est?.bairro ? String(est.bairro) : '';
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  return [district, cityState].filter(Boolean).join(' • ');
};

export default function LandingPublica() {
  const navigate = useNavigate();
  const [featured, setFeatured] = useState([]);
  const [term, setTerm] = useState('');

  const year = new Date().getFullYear();

  const goToSearch = useCallback((query) => {
    const q = String(query || '').trim();
    navigate(q ? `/novo?q=${encodeURIComponent(q)}` : '/novo');
  }, [navigate]);

  const handleSearchSubmit = useCallback((event) => {
    event.preventDefault();
    goToSearch(term);
  }, [goToSearch, term]);

  const handlePrimaryCta = useCallback(() => {
    const user = getUser();
    const role = String(user?.tipo || '').toLowerCase();
    if (role === 'estabelecimento') {
      navigate('/estab');
      return;
    }
    navigate('/novo');
  }, [navigate]);

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

  const featuredCards = useMemo(() => {
    return featured
      .filter((item) => item && item.id)
      .map((est) => {
        const name = est?.nome || est?.name || `Estabelecimento #${est?.id || ''}`;
        const address = formatAddress(est);
        const avatarSource = est?.foto_url || est?.avatar_url || '';
        const image = avatarSource ? resolveAssetUrl(avatarSource) : fallbackAvatar(name);
        return { id: est.id, name, address, image };
      });
  }, [featured]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand} aria-label="Agendamentos Online">
            <span className={styles.brandMark} aria-hidden="true">
              <IconCalendar width={18} height={18} />
            </span>
            <span className={styles.brandName}>
              Agendamentos
              <small>Online</small>
            </span>
          </Link>
          <div className={styles.headerActions}>
            <Link to="/login" className="btn btn--outline btn--sm">Entrar</Link>
            <Link to="/cadastro" className="btn btn--primary btn--sm">Criar conta</Link>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>
            Marque seu horário <em>em segundos</em>.
          </h1>
          <p className={styles.heroSub}>
            Busque o local, veja horários livres e confirme. Sem ligação e sem instalar aplicativo.
          </p>
          <form className={styles.search} onSubmit={handleSearchSubmit} role="search">
            <IconSearch className={styles.searchIcon} width={20} height={20} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar por nome, serviço ou cidade"
              aria-label="Buscar estabelecimentos"
            />
            <button type="submit" className={styles.searchGo} aria-label="Buscar">
              <IconArrowRight width={20} height={20} />
            </button>
          </form>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>O que você precisa hoje?</h2>
          </div>
          <div className={styles.cats}>
            {CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.query}
                  type="button"
                  className={styles.cat}
                  onClick={() => goToSearch(category.query)}
                >
                  <span className={styles.catIcon}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className={styles.catLabel}>{category.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={styles.cat}
              onClick={() => navigate('/novo')}
            >
              <span className={styles.catIcon}>
                <IconGrid aria-hidden="true" />
              </span>
              <span className={styles.catLabel}>Ver todas</span>
            </button>
          </div>
        </section>

        {featuredCards.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Perto de você</h2>
              <Link to="/novo" className={styles.sectionLink}>Ver todos</Link>
            </div>
            <div className={styles.feat}>
              {featuredCards.map((est) => (
                <Link
                  key={est.id}
                  to={`/novo?estabelecimentoId=${encodeURIComponent(est.id)}`}
                  className={styles.card}
                >
                  <img
                    className={styles.cardAvatar}
                    src={est.image}
                    alt={`Foto do estabelecimento ${est.name}`}
                    loading="lazy"
                    onError={(event) => {
                      const target = event.currentTarget;
                      if (!target.dataset.fallback) {
                        target.dataset.fallback = '1';
                        target.src = fallbackAvatar(est.name);
                      }
                    }}
                  />
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{est.name}</h3>
                    <div className={styles.cardMeta}>
                      <IconMapPin width={14} height={14} aria-hidden="true" />
                      <span>{est.address || 'Endereço não informado'}</span>
                    </div>
                  </div>
                  <span className={styles.cardCta} aria-hidden="true">
                    <IconChevronRight width={18} height={18} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Como funciona</h2>
          </div>
          <div className={styles.steps}>
            {STEPS.map((step, index) => (
              <div key={step.title} className={styles.step}>
                <span className={styles.stepNum}>{index + 1}</span>
                <div className={styles.stepBody}>
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <div className={styles.ctaBar}>
        <div className={styles.ctaBarInner}>
          <button type="button" className={styles.cta} onClick={handlePrimaryCta}>
            <IconCalendar width={20} height={20} aria-hidden="true" />
            Buscar horários agora
          </button>
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/termos">Termos</Link>
          <Link to="/politica-privacidade">Privacidade</Link>
          <Link to="/ajuda">Ajuda</Link>
        </div>
        <p className={styles.footerCopy}>© {year} Agendamentos Online</p>
      </footer>
    </div>
  );
}
