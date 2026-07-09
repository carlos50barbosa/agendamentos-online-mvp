// src/pages/BookingDiscovery.jsx
// Descoberta de estabelecimentos (rota /novo) no design novo (índigo), standalone.
// Busca + cards; ao escolher, segue para o wizard público /agendar/:id (BookingPublic).
// Substitui a tela de busca do fluxo legado, reaproveitando 100% do design novo.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, MapPin, Star, ChevronRight, Loader2 } from 'lucide-react';
import { Api, resolveAssetUrl } from '../utils/api.js';

function buildAddress(est) {
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  return [est?.bairro, cityState].filter(Boolean).join(' • ');
}

function initialsOf(name) {
  return String(name || 'AO').trim().slice(0, 2).toUpperCase();
}

export default function BookingDiscovery() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [term, setTerm] = useState(searchParams.get('q') || '');
  const [query, setQuery] = useState((searchParams.get('q') || '').trim());
  const [state, setState] = useState({ loading: true, error: '', items: [] });

  // Debounce da digitação -> query efetiva.
  useEffect(() => {
    const id = setTimeout(() => setQuery(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  // Mantém o ?q= na URL (compartilhável, e o legado já usava esse padrão).
  useEffect(() => {
    setSearchParams(query ? { q: query } : {}, { replace: true });
  }, [query, setSearchParams]);

  // Busca os estabelecimentos.
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    Api.listEstablishments({ q: query || undefined, limit: 24, coords: 0 })
      .then((resp) => {
        if (!alive) return;
        const items = Array.isArray(resp) ? resp : resp?.items || [];
        setState({ loading: false, error: '', items });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: 'Não foi possível carregar os estabelecimentos.', items: [] });
      });
    return () => { alive = false; };
  }, [query]);

  const cards = useMemo(
    () => (state.items || []).filter((e) => e && e.id).map((est) => ({
      id: est.id,
      nome: est.nome || `Estabelecimento #${est.id}`,
      address: buildAddress(est),
      avatar: resolveAssetUrl(est.avatar_url || est.foto_url || ''),
      ratingAvg: Number(est.rating_average),
      ratingCount: Number(est.rating_count) || 0,
    })),
    [state.items],
  );

  return (
    <div style={{ background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-lg tw-flex-col tw-gap-4 tw-p-4">
        {/* Cabeçalho: título simples — a navegação vem do shell (sidebar no desktop, menu no mobile). */}
        <header className="tw-flex tw-flex-col tw-gap-1">
          <h1 className="tw-m-0 tw-text-xl tw-font-extrabold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
            Novo agendamento
          </h1>
          <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            Escolha um estabelecimento para começar
          </p>
        </header>

        {/* Busca */}
        <div
          className="tw-flex tw-items-center tw-gap-2 tw-rounded-xl tw-px-3"
          style={{ minHeight: 48, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
        >
          <Search size={18} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--muted-ink, #6B7280)', flexShrink: 0 }} />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nome, bairro ou cidade..."
            aria-label="Buscar estabelecimentos"
            className="tw-w-full tw-border-0 tw-bg-transparent tw-text-sm tw-outline-none"
            style={{ color: 'var(--ink, #1E1B4B)' }}
          />
        </div>

        {/* Lista */}
        <main className="tw-flex tw-flex-1 tw-flex-col tw-gap-2">
          {state.loading ? (
            <div className="tw-flex tw-items-center tw-gap-2 tw-py-6" style={{ color: 'var(--muted-ink, #6B7280)' }}>
              <Loader2 size={20} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Carregando estabelecimentos...
            </div>
          ) : state.error ? (
            <p className="tw-m-0 tw-rounded-2xl tw-p-6 tw-text-center tw-text-sm" style={{ background: 'var(--surface-soft, #FBFBFE)', color: 'var(--status-cancelado-fg, #B4232A)' }}>
              {state.error}
            </p>
          ) : cards.length === 0 ? (
            <p className="tw-m-0 tw-rounded-2xl tw-p-6 tw-text-center tw-text-sm" style={{ background: 'var(--surface-soft, #FBFBFE)', color: 'var(--muted-ink, #6B7280)' }}>
              {query ? 'Nenhum estabelecimento encontrado para essa busca.' : 'Nenhum estabelecimento disponível ainda.'}
            </p>
          ) : (
            cards.map((est) => (
              <button
                key={est.id}
                type="button"
                onClick={() => navigate(`/agendar/${est.id}`)}
                className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-2xl tw-p-3 tw-text-left tw-transition"
                style={{ minHeight: 72, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', cursor: 'pointer' }}
              >
                <span
                  className="tw-flex tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-xl"
                  style={{ width: 48, height: 48, background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand, #5049E5)', flexShrink: 0, fontWeight: 800 }}
                >
                  {est.avatar ? (
                    <img src={est.avatar} alt="" className="tw-h-full tw-w-full tw-object-cover" loading="lazy" />
                  ) : (
                    initialsOf(est.nome)
                  )}
                </span>
                <span className="tw-min-w-0 tw-flex-1">
                  <span className="tw-block tw-truncate tw-text-sm tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
                    {est.nome}
                  </span>
                  {est.address && (
                    <span className="tw-mt-0.5 tw-flex tw-items-center tw-gap-1 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                      <MapPin size={12} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
                      <span className="tw-truncate">{est.address}</span>
                    </span>
                  )}
                  {Number.isFinite(est.ratingAvg) && est.ratingCount > 0 && (
                    <span className="tw-mt-0.5 tw-inline-flex tw-items-center tw-gap-1 tw-text-xs tw-font-bold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
                      <Star size={12} strokeWidth={0} fill="#F5A623" aria-hidden="true" />
                      {est.ratingAvg.toFixed(1)}
                      <span style={{ fontWeight: 600, color: 'var(--muted-ink, #6B7280)' }}>({est.ratingCount})</span>
                    </span>
                  )}
                </span>
                <ChevronRight size={20} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--muted-ink, #6B7280)', flexShrink: 0 }} />
              </button>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
