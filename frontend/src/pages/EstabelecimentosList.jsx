import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Api, resolveAssetUrl } from '../utils/api';
import LogoAO from '../components/LogoAO.jsx';
import Modal from '../components/Modal.jsx';
import EstablishmentsHero from '../components/EstablishmentsHero.jsx';
import { IconMapPin } from '../components/Icons.jsx';

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const toSlug = (value = '') => {
  const normalized = normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'estabelecimento';
};

const buildSearchText = (est) =>
  normalize([
    est?.nome,
    est?.name,
    est?.endereco,
    est?.numero,
    est?.bairro,
    est?.cidade,
    est?.estado,
    est?.cep,
  ]
    .filter(Boolean)
    .join(' '));

const HEADLINE_TEXT = 'O jeito mais simples de agendar serviços de beleza e bem-estar';

const formatAddress = (est) => {
  const street = [est?.endereco, est?.numero].filter(Boolean).join(', ');
  const district = est?.bairro ? est.bairro : '';
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  const parts = [street, district, cityState].filter(Boolean);
  if (est?.cep) parts.push(`CEP ${est.cep}`);
  return parts.join(', ');
};

const fallbackAvatar = (label) => {
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=1C64F2&color=ffffff&rounded=true`;
};

const ratingNumberFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function EstabelecimentosList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [showResults, setShowResults] = useState(() => {
    const initial = (searchParams.get('q') || '').trim();
    return initial.length > 0;
  });
  const [pendingScroll, setPendingScroll] = useState(false);
  const searchInputRef = useRef(null);
  const resultsSectionRef = useRef(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const PROMO_KEY = 'home_promo_dismissed_at';

  useEffect(() => {
    const q = (searchParams.get('q') || '').trim();
    setQuery(q);
    if (q) setShowResults(true);
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await Api.listEstablishments();
        if (!mounted) return;
        setItems(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!mounted) return;
        setError('Não foi possível carregar os estabelecimentos.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(PROMO_KEY);
      if (!dismissed) {
        setPromoOpen(true);
      } else {
        const ts = Number(dismissed);
        if (!Number.isFinite(ts)) {
          setPromoOpen(true);
        } else {
          const oneDay = 24 * 60 * 60 * 1000;
          const now = Date.now();
          if (now - ts > oneDay) setPromoOpen(true);
        }
      }
    } catch {
      setPromoOpen(true);
    }
  }, []);

  const normalizedQuery = useMemo(() => normalize(query.trim()), [query]);
  const queryTokens = useMemo(
    () => (normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : []),
    [normalizedQuery]
  );

  const filteredItems = useMemo(() => {
    if (!queryTokens.length) return items;
    return items.filter((est) => {
      const haystack = buildSearchText(est);
      return queryTokens.every((token) => haystack.includes(token));
    });
  }, [items, queryTokens]);

  const results = useMemo(() => {
    const mapped = filteredItems.map((est) => ({ est }));
    const sortKey = (value) => normalize(value?.nome || value?.name || `est-${value?.id || ''}`);
    return mapped.sort((a, b) => sortKey(a.est).localeCompare(sortKey(b.est)));
  }, [filteredItems]);

  useEffect(() => {
    if (!showResults || !pendingScroll) return;
    if (typeof window === 'undefined') {
      setPendingScroll(false);
      return;
    }
    const section = resultsSectionRef.current;
    if (!section) {
      setPendingScroll(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      try {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        section.scrollIntoView();
      }
      setPendingScroll(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showResults, pendingScroll]);

  const handleQueryChange = useCallback(
    (value) => {
      setQuery(value);
      const trimmed = value.trim();
      const params = new URLSearchParams(searchParams);
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    setShowResults(true);
    setPendingScroll(true);
  }, []);

  const handleClosePromo = useCallback(() => {
    setPromoOpen(false);
    try { localStorage.setItem(PROMO_KEY, String(Date.now())); } catch {}
  }, []);

  return (
    <div className="home">
      {promoOpen && (
        <Modal
          title="Novidades"
          onClose={handleClosePromo}
          closeButton
          disableOutsideClick
          actions={[
            <button
              key="ok"
              type="button"
              className="btn btn--primary"
              onClick={handleClosePromo}
              style={{ margin: '0 auto' }}
            >
              Continuar
            </button>,
          ]}
        >
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 14,
              padding: 16,
              background: 'linear-gradient(135deg, #111827, #1d2539)',
              color: '#e5e7eb',
              boxShadow: '0 18px 36px rgba(0,0,0,0.28)',
            }}
          >
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(280px at 12% 18%, rgba(129,140,248,0.28), transparent 50%), radial-gradient(220px at 82% 18%, rgba(16,185,129,0.24), transparent 50%), radial-gradient(320px at 52% 90%, rgba(14,165,233,0.22), transparent 55%)',
              }}
            />
            <div style={{ position: 'relative', display: 'grid', gap: 10 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.08)', width: 'fit-content', fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 6px rgba(34,197,94,0.16)' }} />
                Bem-vindo(a)
              </div>
              <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.3, color: '#f8fafc' }}>
                Agendamentos Online chegou para facilitar seus horários.
              </h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#cbd5e1' }}>
                Monte sua agenda, confirme clientes e deixe que a plataforma cuida do resto. Em breve, mais novidades e parcerias exclusivas.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', boxShadow: '0 12px 28px rgba(0,0,0,0.24)' }}>
                  <LogoAO size={28} />
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ color: '#f8fafc', fontSize: 14 }}>Acompanhe por aqui</strong>
                  <span style={{ color: '#cbd5e1', fontSize: 12 }}>Novos recursos e integrações aparecem primeiro neste espaço.</span>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <EstablishmentsHero
        heading={HEADLINE_TEXT}
        subtitle="Descubra estabelecimentos perto de você, escolha o horário ideal e confirme em segundos."
        query={query}
        onChange={handleQueryChange}
        onSubmit={handleSubmit}
        placeholder="Buscar por nome, bairro ou cidade"
        inputRef={searchInputRef}
        headingId="home-hero-title"
      />

      {showResults && (
        <section
          ref={resultsSectionRef}
          className="home-results"
          aria-label="Resultados da busca"
        >
          {loading && <div className="home-results__state">Carregando...</div>}
          {!loading && error && (
            <div className="home-results__state home-results__state--error">{error}</div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="home-results__state">Nenhum estabelecimento encontrado.</div>
          )}
          {!loading && !error && results.length > 0 && (
            <div className="home-results__grid">
              {results.map((item) => {
                const { est } = item;
                const name = est?.nome || est?.name || `Estabelecimento #${est?.id || ''}`;
                const address = formatAddress(est);
                const sp = new URLSearchParams();
                sp.set('estabelecimento', String(est.id));
                const currentQuery = (query || '').trim();
                if (currentQuery) sp.set('q', currentQuery);
                const slugSource = est?.slug || name;
                const slug = slugSource ? toSlug(slugSource) : 'estabelecimento';
                const path = slug ? `/novo/${slug}` : '/novo';
                const avatarSource = est?.foto_url || est?.avatar_url || '';
                const image = avatarSource ? resolveAssetUrl(avatarSource) : fallbackAvatar(name);
                const coords = (() => {
                  const lat = Number(est?.latitude ?? est?.lat ?? est?.coord_lat ?? null);
                  const lng = Number(est?.longitude ?? est?.lng ?? est?.coord_lng ?? null);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                  if (lat === 0 && lng === 0) return null;
                  return { lat, lng };
                })();
                const mapLink = (() => {
                  if (coords) return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
                  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
                  return '';
                })();
                const ratingAverageRaw = Number(est?.rating_average ?? est?.ratingAverage ?? NaN);
                const ratingCount = Number(est?.rating_count ?? est?.ratingCount ?? 0);
                const hasRatings = Number.isFinite(ratingAverageRaw) && ratingCount > 0;
                const ratingLabel = hasRatings ? ratingNumberFormatter.format(ratingAverageRaw) : null;

              return (
                <Link
                  key={est.id}
                  className="establishment-card"
                  to={`${path}?${sp.toString()}`}
                  aria-label={`Agendar em ${name}`}
                >
                  <div className="establishment-card__avatar">
                    <img
                      src={image}
                      alt={`Foto do estabelecimento ${name}`}
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (!target.dataset.fallback) {
                          target.dataset.fallback = '1';
                          target.src = fallbackAvatar(name);
                        }
                      }}
                    />
                  </div>
                  <div className="establishment-card__info">
                    <h3 className="establishment-card__name">{name}</h3>
                    <p className="establishment-card__address">
                      {address || 'Endereco nao informado'}
                    </p>
                    <div className="establishment-card__meta-row">
                      {mapLink ? (
                        <button
                          type="button"
                          className="establishment-card__distance establishment-card__distance--btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            try {
                              window.open(mapLink, '_blank', 'noopener,noreferrer');
                            } catch {
                              window.location.href = mapLink;
                            }
                          }}
                        >
                          <IconMapPin aria-hidden style={{ width: 14, height: 14 }} /> Ver no mapa
                        </button>
                      ) : (
                        <span className="establishment-card__distance">Mapa indisponível</span>
                      )}
                      <span
                        className={`establishment-card__rating${hasRatings ? '' : ' establishment-card__rating--muted'}`}
                        aria-label={
                          hasRatings
                            ? `Avaliação ${ratingLabel} de 5, com ${ratingCount} ${ratingCount === 1 ? 'avaliação' : 'avaliações'}`
                            : 'Estabelecimento ainda sem avaliações'
                        }
                      >
                        <span aria-hidden>★</span>
                        {hasRatings ? `${ratingLabel} (${ratingCount})` : 'Sem avaliações'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
