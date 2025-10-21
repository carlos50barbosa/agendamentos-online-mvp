import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Api, resolveAssetUrl } from '../utils/api';
import LogoAO from '../components/LogoAO.jsx';
import { IconMapPin } from '../components/Icons.jsx';

const STORAGE_KEY = 'ao:lastLocation';

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const HEADLINE_TEXT = 'O jeito mais simples de agendar servicos de beleza e bem-estar';
const NBSP = String.fromCharCode(160);

const formatAddress = (est) => {
  const street = [est?.endereco, est?.numero].filter(Boolean).join(', ');
  const district = est?.bairro ? est.bairro : '';
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  const parts = [street, district, cityState].filter(Boolean);
  if (est?.cep) parts.push(`CEP ${est.cep}`);
  return parts.join(', ');
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

const fallbackAvatar = (label) => {
  const name = encodeURIComponent(String(label || 'AO'));
  return `https://ui-avatars.com/api/?name=${name}&size=128&background=1C64F2&color=ffffff&rounded=true`;
};

const ratingNumberFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const geocodeEstablishment = async (est) => {
  const lat = Number(est?.latitude ?? est?.lat ?? null);
  const lng = Number(est?.longitude ?? est?.lng ?? null);
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
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [headingText, setHeadingText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const coordsCacheRef = useRef(new Map());
  const [distanceMap, setDistanceMap] = useState({});
  const searchInputRef = useRef(null);
  const resultsSectionRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener(update);
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || typeof window === 'undefined') {
      setHeadingText(HEADLINE_TEXT);
      setIsTyping(false);
      return;
    }
    let index = 0;
    setHeadingText('');
    setIsTyping(true);
    const interval = window.setInterval(() => {
      index += 1;
      setHeadingText(HEADLINE_TEXT.slice(0, index));
      if (index >= HEADLINE_TEXT.length) {
        window.clearInterval(interval);
        setIsTyping(false);
      }
    }, 35);
    return () => {
      window.clearInterval(interval);
    };
  }, [prefersReducedMotion]);

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
      if (userLocation) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(userLocation));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [userLocation]);

  useEffect(() => {
    const cache = coordsCacheRef.current;
    let changed = false;
    items.forEach((est) => {
      const lat = Number(est?.latitude ?? est?.lat ?? null);
      const lng = Number(est?.longitude ?? est?.lng ?? null);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !cache.has(est.id)) {
        cache.set(est.id, { lat, lng });
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
      if (coords) next[id] = haversineDistance(userLocation, coords);
    });
    setDistanceMap(next);
  }, [userLocation]);

  useEffect(() => {
    if (!userLocation) {
      setGeocoding(false);
      return;
    }
    const pending = filteredItems.filter((est) => !coordsCacheRef.current.has(est.id));
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
        coordsCacheRef.current.set(est.id, coords);
        if (coords) {
          setDistanceMap((prev) => ({
            ...prev,
            [est.id]: haversineDistance(userLocation, coords),
          }));
        }
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
      distance: distanceMap[est.id],
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

  const displayHeading = headingText.length
    ? headingText
    : prefersReducedMotion
    ? HEADLINE_TEXT
    : NBSP;

  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__inner">
          <LogoAO size={72} className="home-hero__logo" />
          <h1 id="home-hero-title" className="home-hero__heading">
            <span className="home-hero__heading-text">{displayHeading}</span>
            {!prefersReducedMotion && isTyping && <span className="home-hero__caret" aria-hidden="true" />}
          </h1>
          <p className="home-hero__subtitle">
            Descubra estabelecimentos perto de voce, escolha o horario ideal e confirme em segundos.
          </p>
          <form className="home-search-box" onSubmit={handleSubmit}>
            <div className="home-search-box__field">
              <IconMapPin className="home-search-box__icon" />
              <input
                ref={searchInputRef}
                className="home-search-box__input"
                type="search"
                placeholder="Em qual endereco voce esta?"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                aria-label="Buscar estabelecimentos por endereco, servico ou nome"
              />
              <button type="submit" className="home-search-box__button">
                Buscar
              </button>
            </div>
          </form>
          <button
            type="button"
            className="home-search-box__geo"
            onClick={handleUseLocation}
            disabled={locating}
          >
            {locating ? 'Localizando...' : 'Usar minha localizacao atual'}
          </button>
          {geoError && (
            <div className="home-search-box__status home-search-box__status--error" role="alert">
              {geoError}
            </div>
          )}
          {!geoError && userLocation && (
            <div className="home-search-box__status" aria-live="polite">
              Resultados ordenados pela sua localizacao atual.
            </div>
          )}
          {!geoError && geocoding && (
            <div className="home-search-box__status" aria-live="polite">
              Calculando distancias dos estabelecimentos...
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
              {results.map(({ est, distance }) => {
                const name = est?.nome || est?.name || `Estabelecimento #${est?.id || ''}`;
                const address = formatAddress(est);
                const sp = new URLSearchParams();
                sp.set('estabelecimento', String(est.id));
                const currentQuery = (query || '').trim();
              if (currentQuery) sp.set('q', currentQuery);
              const avatarSource = est?.foto_url || est?.avatar_url || '';
              const image = avatarSource ? resolveAssetUrl(avatarSource) : fallbackAvatar(name);
              const distanceLabel = userLocation
                ? distance != null
                  ? `${kmFormatter.format(distance)} km`
                  : 'Distancia indisponivel'
                : 'Ative a localizacao para ver a distancia';
              const ratingAverageRaw = Number(est?.rating_average ?? est?.ratingAverage ?? NaN);
              const ratingCount = Number(est?.rating_count ?? est?.ratingCount ?? 0);
              const hasRatings = Number.isFinite(ratingAverageRaw) && ratingCount > 0;
              const ratingLabel = hasRatings ? ratingNumberFormatter.format(ratingAverageRaw) : null;

              return (
                <Link
                  key={est.id}
                  className="establishment-card"
                  to={`/novo?${sp.toString()}`}
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




