import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Api, API_BASE_URL } from '../utils/api';
import { getUser } from '../utils/auth';

const STORAGE_KEY = 'ao:lastLocation';

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const resolveAssetUrl = (value) => {
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, API_BASE_URL).toString();
  } catch {
    return value;
  }
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
  const user = getUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const coordsCacheRef = useRef(new Map());
  const [distanceMap, setDistanceMap] = useState({});

  useEffect(() => {
    const q = (searchParams.get('q') || '').trim();
    setQuery(q);
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
  }, []);

  return (
    <div className="establishments">
      <div className="card establishments__intro">
        <h1 className="establishments__title">Encontre um estabelecimento</h1>
        <p className="muted establishments__subtitle">
          {user?.tipo === 'estabelecimento'
            ? 'Somente clientes podem criar agendamentos, mas voce pode consultar seus dados aqui.'
            : 'Busque por nome ou localizacao para encontrar o estabelecimento ideal.'}
        </p>
        <form className="establishments__search" onSubmit={handleSubmit}>
          <input
            className="input establishments__search-input"
            type="search"
            placeholder="Buscar por nome, bairro ou cidade"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            aria-label="Buscar estabelecimentos"
          />
          <button
            type="button"
            className="btn btn--outline establishments__search-action"
            onClick={handleUseLocation}
            disabled={locating}
          >
            {locating ? 'Localizando...' : 'Usar minha localizacao'}
          </button>
        </form>
        {geoError && <div className="notice notice--error" role="alert">{geoError}</div>}
        {userLocation && !geoError && (
          <div className="establishments__status muted" aria-live="polite">
            Resultados ordenados pela sua localizacao atual.
          </div>
        )}
        {geocoding && (
          <div className="establishments__status muted" aria-live="polite">
            Calculando distancias dos estabelecimentos...
          </div>
        )}
      </div>

      <div className="establishments__results">
        {loading && <div className="card"><div className="empty">Carregando...</div></div>}
        {!loading && error && <div className="card"><div className="empty error">{error}</div></div>}
        {!loading && !error && results.length === 0 && (
          <div className="card"><div className="empty">Nenhum estabelecimento encontrado.</div></div>
        )}
        {!loading && !error && results.length > 0 && (
          <div className="establishments__grid">
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
                    <span className="establishment-card__distance">{distanceLabel}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}




