import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Api, resolveAssetUrl } from '../utils/api';
import LogoAO from '../components/LogoAO.jsx';
import Modal from '../components/Modal.jsx';
import { IconMapPin, IconSearch } from '../components/Icons.jsx';

const STORAGE_KEY = 'ao:lastLocation';

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

const parseCoord = (value) => {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

const haversineDistance = (origin, point) => {
  if (!origin || !point) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(point.lat - origin.lat);
  const dLon = toRad(point.lng - origin.lng);
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(point.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const fallbackAvatar = (label) => {
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=1C64F2&color=ffffff&rounded=true`;
};

const ratingNumberFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const geocodeEstablishment = async (est) => {
  const lat = parseCoord(est?.latitude ?? est?.lat ?? null);
  const lng = parseCoord(est?.longitude ?? est?.lng ?? null);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const parts = [];
  const street = [est?.endereco, est?.numero].filter(Boolean).join(' ');
  if (street) parts.push(street);
  if (est?.bairro) parts.push(est.bairro);
  if (est?.cidade) parts.push(est.cidade);
  if (est?.estado) parts.push(est.estado);
  if (est?.cep) parts.push(est.cep);
  if (!parts.length) return null;
  parts.push('Brasil');

  const query = encodeURIComponent(parts.join(', '));
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&countrycodes=br&q=${query}&email=contato@agendamentos.app`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) return null;
    const { lat, lon } = data[0] || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
    return { lat: latNum, lng: lonNum };
  } catch {
    return null;
  }
};

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
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const coordsCacheRef = useRef(new Map());
  const [distanceMap, setDistanceMap] = useState({});
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
        setError('Nao foi possivel carregar os estabelecimentos.');
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
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
        setUserLocation(parsed);
      }
    } catch {}
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

  useEffect(() => {
    try {
      if (userLocation) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userLocation));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [userLocation]);

  useEffect(() => {
    const cache = coordsCacheRef.current;
    let changed = false;
    items.forEach((est) => {
      const lat = parseCoord(est?.latitude ?? est?.lat ?? null);
      const lng = parseCoord(est?.longitude ?? est?.lng ?? null);
      const key = String(est.id);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !cache.has(key)) {
        cache.set(key, { lat, lng });
        changed = true;
      }
    });
    if (changed && userLocation) {
      const next = {};
      cache.forEach((coords, id) => {
        next[id] = haversineDistance(userLocation, coords);
      });
      setDistanceMap(next);
    }
  }, [items, userLocation]);

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

  useEffect(() => {
    if (!userLocation) {
      setDistanceMap({});
      return;
    }
    const next = {};
    coordsCacheRef.current.forEach((coords, id) => {
      next[id] = coords ? haversineDistance(userLocation, coords) : null;
    });
    setDistanceMap(next);
  }, [userLocation]);

  useEffect(() => {
    if (!userLocation) {
      setGeocoding(false);
      return;
    }
    const pending = filteredItems.filter((est) => !coordsCacheRef.current.has(String(est.id)));
  if (!pending.length) {
    setGeocoding(false);
    return;
  }

    let cancelled = false;
    setGeocoding(true);

    (async () => {
      for (const est of pending) {
        if (cancelled) break;
        const coords = await geocodeEstablishment(est);
        if (cancelled) break;
        coordsCacheRef.current.set(String(est.id), coords);
        setDistanceMap((prev) => ({
          ...prev,
          [String(est.id)]: coords ? haversineDistance(userLocation, coords) : null,
        }));
      }
      if (!cancelled) setGeocoding(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredItems, userLocation]);

  const kmFormatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const results = useMemo(() => {
    const mapped = filteredItems.map((est) => ({
      est,
      distance: distanceMap[String(est.id)],
      hasDistance: hasKey(distanceMap, String(est.id)),
    }));
    const sortKey = (value) => normalize(value?.nome || value?.name || `est-${value?.id || ''}`);
    const sorted = [...mapped];
    if (userLocation) {
      sorted.sort((a, b) => {
        const da = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
        const db = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return sortKey(a.est).localeCompare(sortKey(b.est));
      });
    } else {
      sorted.sort((a, b) => sortKey(a.est).localeCompare(sortKey(b.est)));
    }
    return sorted;
  }, [distanceMap, filteredItems, userLocation]);

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

  const handleUseLocation = useCallback(() => {
    if (!navigator?.geolocation) {
      setGeoError('Geolocalizacao nao esta disponivel neste dispositivo.');
      return;
    }
    setShowResults(true);
    setPendingScroll(true);
    setGeoError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
      },
      () => {
        setLocating(false);
        setGeoError('Nao foi possivel obter sua localizacao.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    setShowResults(true);
    setPendingScroll(true);
  }, []);

  const handleClosePromo = useCallback(() => {
    setPromoOpen(false);
    try { localStorage.setItem(PROMO_KEY, String(Date.now())); } catch {}
  }, []);

  const displayHeading = HEADLINE_TEXT;

  return (
    <div className="home">
      {promoOpen && (
        <Modal
          title="Novidades"
          onClose={handleClosePromo}
          closeButton
          disableOutsideClick
          actions={[
            <a
              key="cta"
              className="btn btn--primary"
              href="/planos"
              target="_blank"
              rel="noopener noreferrer"
              style={{ margin: '0 auto' }}
            >
              Quero saber mais
            </a>,
          ]}
        >
          <a
            href="/planos"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
          >
            <p>
              Em breve, espaços dedicados a parceiros e publicidades. Clique em &quot;Quero saber mais&quot; para
              ser redirecionado.
            </p>
          </a>
        </Modal>
      )}

      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__inner">
          <LogoAO size={72} className="home-hero__logo" />
          <h1 id="home-hero-title" className="home-hero__heading">
            <span className="home-hero__heading-text">{displayHeading}</span>
          </h1>
          <p className="home-hero__subtitle">
            Descubra estabelecimentos perto de você, escolha o horario ideal e confirme em segundos.
          </p>
          <form className="novo-agendamento__search" onSubmit={handleSubmit}>
            <div className="novo-agendamento__searchbox">
              <IconSearch className="novo-agendamento__search-icon" aria-hidden />
              <input
                ref={searchInputRef}
                className="input novo-agendamento__search-input"
                type="search"
                placeholder="Buscar por nome, bairro ou cidade"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                aria-label="Buscar estabelecimentos por nome, bairro ou cidade"
              />
              <span className="novo-agendamento__search-caret" aria-hidden>▾</span>
            </div>
            <button
              type="button"
              className="novo-agendamento__location"
              onClick={handleUseLocation}
              disabled={locating}
            >
              <IconMapPin className="novo-agendamento__location-icon" aria-hidden />
              <span>{locating ? 'Localizando...' : 'Usar minha localização atual'}</span>
            </button>
          </form>
          {geoError && (
            <div className="notice notice--error" role="alert">
              {geoError}
            </div>
          )}
          {geocoding && !geoError && (
            <div className="novo-agendamento__status muted" aria-live="polite">
              Calculando distâncias dos estabelecimentos...
            </div>
          )}
        </div>
      </section>

      {showResults && (
        <section
          ref={resultsSectionRef}
          className="home-results"
          aria-labelledby="home-results-title"
        >
          <h2 id="home-results-title" className="home-results__title">
            Estabelecimentos
          </h2>
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
                const { est, distance, hasDistance } = item;
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
              const distanceLabel = !userLocation
                ? 'Ative a localizacao para ver a distancia'
                : hasDistance
                ? distance != null
                  ? `${kmFormatter.format(distance)} km`
                  : 'Distancia indisponivel'
                : 'Calculando distancias...';
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
                      <span className="establishment-card__distance">{distanceLabel}</span>
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


