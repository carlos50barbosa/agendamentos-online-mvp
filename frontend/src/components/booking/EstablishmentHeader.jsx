// src/components/booking/EstablishmentHeader.jsx
// Cabeçalho "cara de app" do estabelecimento no fluxo público de agendamento
// (/agendar). Capa (galeria ou gradiente índigo) + avatar sobreposto, nome,
// endereço, status Aberto/Fechado calculado dos horários, nota e ações:
//   Galeria (lightbox) · Detalhes (sobre + horários + contato) · Favoritar · Avaliar.
// Consome o payload de Api.getEstablishment (profile.horarios, rating, gallery,
// is_favorite, user_review). Favoritar/Avaliar exigem cliente logado (senão → login).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, MapPin, Star, Images, Info, Heart, X,
  Clock, Phone, AtSign, Globe, MessageCircle, Check, Loader2, MapPinned,
} from 'lucide-react';
import { Api, resolveAssetUrl } from '../../utils/api.js';
import { getUser } from '../../utils/auth.js';
import { waLink } from '../../config/site.js';

// ---------------------------------------------------------------------------
// Horários / status "aberto agora"
// ---------------------------------------------------------------------------
const DOW_SLUGS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEK_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SLUG_LABEL = {
  monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta', thursday: 'Quinta',
  friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo',
};
const SLUG_WHEN = {
  monday: 'segunda', tuesday: 'terça', wednesday: 'quarta', thursday: 'quinta',
  friday: 'sexta', saturday: 'sábado', sunday: 'domingo',
};

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function fmtMin(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Intervalos abertos do dia (com pausas/blocks subtraídos), ordenados.
function dayIntervals(items) {
  const out = [];
  for (const it of items || []) {
    const start = toMinutes(it.start);
    const end = toMinutes(it.end);
    if (start == null || end == null || end <= start) continue;
    let segs = [[start, end]];
    const blocks = Array.isArray(it.blocks) ? it.blocks : Array.isArray(it.breaks) ? it.breaks : [];
    for (const b of blocks) {
      const bs = toMinutes(b.start);
      const be = toMinutes(b.end);
      if (bs == null || be == null || be <= bs) continue;
      const next = [];
      for (const [s, e] of segs) {
        if (be <= s || bs >= e) { next.push([s, e]); continue; }
        if (bs > s) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
      segs = next;
    }
    out.push(...segs);
  }
  return out.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
}

function groupByDay(horarios) {
  const byDay = new Map();
  for (const it of horarios || []) {
    if (!it?.day) continue;
    if (!byDay.has(it.day)) byDay.set(it.day, []);
    byDay.get(it.day).push(it);
  }
  return byDay;
}

function computeOpenStatus(horarios, now = new Date()) {
  const byDay = groupByDay(horarios);
  if (!byDay.size) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = dayIntervals(byDay.get(DOW_SLUGS[now.getDay()]));

  const current = today.find(([s, e]) => nowMin >= s && nowMin < e);
  if (current) {
    const minsLeft = current[1] - nowMin;
    return {
      open: true,
      soon: minsLeft <= 30,
      label: minsLeft <= 30 ? 'Fecha em breve' : 'Aberto',
      detail: `${fmtMin(current[0])} - ${fmtMin(current[1])}`,
    };
  }

  const laterToday = today.find(([s]) => s > nowMin);
  if (laterToday) {
    return { open: false, label: 'Fechado', detail: `Abre hoje às ${fmtMin(laterToday[0])}` };
  }

  for (let off = 1; off <= 7; off += 1) {
    const slug = DOW_SLUGS[(now.getDay() + off) % 7];
    const intervals = dayIntervals(byDay.get(slug));
    if (!intervals.length) continue;
    const openAt = fmtMin(intervals[0][0]);
    const when = off === 1 ? 'amanhã' : SLUG_WHEN[slug];
    return { open: false, label: 'Fechado', detail: `Abre ${when} às ${openAt}` };
  }
  return { open: false, label: 'Fechado', detail: '' };
}

function buildAddress(est) {
  const line1 = [est?.endereco, est?.numero].filter(Boolean).join(', ');
  const cityState = [est?.cidade, est?.estado].filter(Boolean).join(' - ');
  return [line1, est?.bairro, cityState].filter(Boolean).join(' • ');
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
// onBack/showBack: no wizard, o botão da capa vira o "voltar etapa" (mostrado só a
// partir da 2ª etapa). Sem onBack, cai no voltar de histórico (uso avulso).
export default function EstablishmentHeader({ establishment, onBack, showBack = true }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [modal, setModal] = useState(null); // 'gallery' | 'details' | 'rating'

  const est = establishment || {};
  const profile = est.profile || {};
  const gallery = useMemo(
    () => (Array.isArray(est.gallery) ? est.gallery.filter((g) => g?.url) : []),
    [est.gallery],
  );
  const rating = est.rating || {};
  const horarios = profile.horarios || [];
  const status = useMemo(() => computeOpenStatus(horarios), [horarios]);
  const cover = gallery.length ? resolveAssetUrl(gallery[0].url) : '';
  const avatar = resolveAssetUrl(est.avatar_url || est.logo_url || est.foto_url || '');
  const address = useMemo(() => buildAddress(est), [est]);
  const initials = (est.nome || 'AO').trim().slice(0, 2).toUpperCase();
  const avg = Number(rating.average);
  const hasRating = Number.isFinite(avg) && Number(rating.count) > 0;

  const viewer = getUser();
  const isCliente = viewer?.tipo === 'cliente';

  const [favorite, setFavorite] = useState(Boolean(est.is_favorite));
  const [favBusy, setFavBusy] = useState(false);
  useEffect(() => { setFavorite(Boolean(est.is_favorite)); }, [est.is_favorite]);

  const [myReview, setMyReview] = useState(est.user_review || null);
  useEffect(() => { setMyReview(est.user_review || null); }, [est.user_review]);

  const goLogin = useCallback(() => {
    const next = `${location.pathname}${location.search}`;
    navigate(`/login?tipo=cliente&next=${encodeURIComponent(next)}`);
  }, [location.pathname, location.search, navigate]);

  const handleBack = useCallback(() => {
    if (onBack) return onBack();
    if (typeof window !== 'undefined' && window.history.length > 1) return navigate(-1);
    return navigate('/');
  }, [onBack, navigate]);

  const toggleFavorite = useCallback(async () => {
    if (!isCliente) return goLogin();
    if (!est.id || favBusy) return;
    const nextVal = !favorite;
    setFavBusy(true);
    setFavorite(nextVal); // otimista
    try {
      if (nextVal) await Api.favoriteEstablishment(est.id);
      else await Api.unfavoriteEstablishment(est.id);
    } catch {
      setFavorite(!nextVal); // reverte em caso de falha
    } finally {
      setFavBusy(false);
    }
  }, [isCliente, est.id, favorite, favBusy, goLogin]);

  const openRating = useCallback(() => {
    if (!isCliente) return goLogin();
    setModal('rating');
  }, [isCliente, goLogin]);

  return (
    <>
      <header
        className="tw-overflow-hidden tw-rounded-3xl"
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--brand-border, #E7E5F5)',
          boxShadow: '0 12px 34px -14px rgba(30, 27, 75, 0.28)',
        }}
      >
        {/* Capa */}
        <div className="tw-relative" style={{ height: 120 }}>
          {cover ? (
            <img src={cover} alt="" className="tw-h-full tw-w-full tw-object-cover" />
          ) : (
            <div
              className="tw-h-full tw-w-full"
              style={{ background: 'linear-gradient(135deg, var(--brand, #5049E5), var(--brand-deep, #1E1B4B))' }}
            />
          )}
          <div
            className="tw-absolute tw-inset-0"
            style={{ background: 'linear-gradient(to top, rgba(30,27,75,0.34), rgba(30,27,75,0.02) 60%)' }}
          />
          {showBack && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Voltar"
              className="tw-absolute tw-left-3 tw-top-3 tw-inline-flex tw-items-center tw-justify-center tw-rounded-full"
              style={{
                width: 40, height: 40,
                background: 'rgba(255,255,255,0.94)', color: 'var(--brand-deep, #1E1B4B)',
                boxShadow: '0 6px 16px -6px rgba(30,27,75,0.5)', cursor: 'pointer',
              }}
            >
              <ChevronLeft size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
          {gallery.length > 0 && (
            <button
              type="button"
              onClick={() => setModal('gallery')}
              className="tw-absolute tw-right-3 tw-top-3 tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-px-3"
              style={{
                height: 34, background: 'rgba(255,255,255,0.94)', color: 'var(--brand-deep, #1E1B4B)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Images size={15} strokeWidth={2.2} aria-hidden="true" />
              {gallery.length} {gallery.length === 1 ? 'foto' : 'fotos'}
            </button>
          )}
        </div>

        {/* Corpo */}
        <div className="tw-flex tw-flex-col tw-items-center tw-px-4 tw-pb-4 tw-text-center">
          <div
            className="tw-inline-flex tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-2xl"
            style={{
              // position/zIndex: garante o avatar POR CIMA da capa (que é position:relative);
              // sem isso, a capa posicionada é pintada sobre o topo do avatar.
              position: 'relative', zIndex: 1,
              width: 76, height: 76, marginTop: -38, marginBottom: 8,
              background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand, #5049E5)',
              border: '4px solid var(--surface, #fff)', boxShadow: '0 10px 24px -10px rgba(30,27,75,0.45)',
            }}
          >
            {avatar ? (
              <img src={avatar} alt={est.nome || ''} className="tw-h-full tw-w-full tw-object-cover" />
            ) : (
              <span className="tw-text-lg tw-font-extrabold">{initials}</span>
            )}
          </div>

          <h1 className="tw-m-0 tw-text-xl tw-font-extrabold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
            {est.nome || 'Estabelecimento'}
          </h1>
          {address && (
            <p
              className="tw-m-0 tw-mt-1 tw-flex tw-items-center tw-justify-center tw-gap-1 tw-text-xs"
              style={{ color: 'var(--muted-ink, #6B7280)' }}
            >
              <MapPin size={13} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span className="tw-truncate">{address}</span>
            </p>
          )}

          {/* Pills: status + nota */}
          {(status || hasRating) && (
            <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-justify-center tw-gap-2">
              {status && (
                <span
                  className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-px-3 tw-py-1 tw-text-xs"
                  style={
                    status.open
                      ? { background: 'var(--status-confirmado-bg, #E1F3E8)', color: 'var(--status-confirmado-fg, #128C4A)' }
                      : { background: 'var(--surface-soft, #F6F5FB)', color: 'var(--muted-ink, #6B7280)', border: '1px solid var(--brand-border, #E7E5F5)' }
                  }
                >
                  <span
                    style={{
                      width: 7, height: 7, borderRadius: 9999,
                      background: status.open ? 'var(--status-confirmado-fg, #128C4A)' : '#9CA3AF',
                    }}
                  />
                  <strong className="tw-font-bold">{status.label}</strong>
                  {status.detail && <span style={{ opacity: 0.85 }}>· {status.detail}</span>}
                </span>
              )}
              {hasRating && (
                <span
                  className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-px-3 tw-py-1 tw-text-xs tw-font-bold"
                  style={{ background: 'var(--brand-100, #EEEDFC)', color: 'var(--brand-deep, #1E1B4B)' }}
                >
                  <Star size={13} strokeWidth={0} fill="#F5A623" aria-hidden="true" />
                  {avg.toFixed(1)}
                  <span style={{ fontWeight: 600, color: 'var(--muted-ink, #6B7280)' }}>({rating.count})</span>
                </span>
              )}
            </div>
          )}

          {/* Ações */}
          <div className="tw-mt-4 tw-flex tw-w-full tw-items-stretch tw-gap-2">
            <ActionChip icon={Images} label="Galeria" muted={!gallery.length} onClick={() => gallery.length && setModal('gallery')} />
            <ActionChip icon={Info} label="Detalhes" onClick={() => setModal('details')} />
            <ActionChip icon={Heart} label={favorite ? 'Favorito' : 'Favoritar'} active={favorite} busy={favBusy} onClick={toggleFavorite} />
            <ActionChip icon={Star} label="Avaliar" onClick={openRating} />
          </div>
        </div>
      </header>

      {modal === 'gallery' && <GalleryModal images={gallery} onClose={() => setModal(null)} />}
      {modal === 'details' && (
        <DetailsModal est={est} profile={profile} status={status} address={address} onClose={() => setModal(null)} />
      )}
      {modal === 'rating' && (
        <RatingModal
          est={est}
          myReview={myReview}
          onClose={() => setModal(null)}
          onSaved={(review) => { setMyReview(review); setModal(null); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ação (chip vertical: ícone + rótulo)
// ---------------------------------------------------------------------------
function ActionChip({ icon: Icon, label, onClick, muted, active, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="tw-flex tw-flex-1 tw-min-w-0 tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-rounded-2xl tw-px-1 tw-py-2 tw-transition"
      style={{
        minHeight: 58,
        background: active ? 'var(--brand-100, #EEEDFC)' : 'var(--surface-soft, #FBFBFE)',
        border: `1px solid ${active ? 'var(--brand, #5049E5)' : 'var(--brand-border, #E7E5F5)'}`,
        color: active ? 'var(--brand, #5049E5)' : muted ? '#9CA3AF' : 'var(--brand-deep, #1E1B4B)',
        opacity: muted ? 0.65 : 1,
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      {busy ? (
        <Loader2 size={19} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" />
      ) : (
        <Icon size={19} strokeWidth={2} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
      )}
      <span className="tw-truncate tw-font-semibold" style={{ fontSize: 11, maxWidth: '100%' }}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal base (overlay + card centralizado)
// ---------------------------------------------------------------------------
function ModalShell({ children, onClose, maxWidth = 480, dark = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-end tw-justify-center sm:tw-items-center tw-p-0 sm:tw-p-4"
      style={{ background: dark ? 'rgba(15,13,40,0.92)' : 'rgba(30,27,75,0.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="tw-w-full tw-max-h-[92vh] tw-overflow-y-auto tw-rounded-t-3xl sm:tw-rounded-3xl"
        style={{ maxWidth, background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div
      className="tw-sticky tw-top-0 tw-z-10 tw-flex tw-items-center tw-justify-between tw-gap-3 tw-px-4 tw-py-3"
      style={{ background: 'var(--surface, #fff)', borderBottom: '1px solid var(--brand-border, #E7E5F5)' }}
    >
      <h2 className="tw-m-0 tw-text-base tw-font-bold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="tw-inline-flex tw-items-center tw-justify-center tw-rounded-xl"
        style={{ minWidth: 38, minHeight: 38, background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand-deep, #1E1B4B)', cursor: 'pointer' }}
      >
        <X size={19} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Galeria (lightbox com navegação + miniaturas)
// ---------------------------------------------------------------------------
function GalleryModal({ images, onClose }) {
  const total = images.length;
  const [idx, setIdx] = useState(0);
  const go = useCallback((d) => setIdx((i) => (i + d + total) % total), [total]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const current = images[idx] || {};
  const src = resolveAssetUrl(current.url || '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-4"
      style={{ background: 'rgba(15,13,40,0.94)' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="tw-absolute tw-right-4 tw-top-4 tw-inline-flex tw-items-center tw-justify-center tw-rounded-full"
        style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.14)', color: '#fff', cursor: 'pointer' }}
      >
        <X size={22} strokeWidth={2.2} aria-hidden="true" />
      </button>

      <div onClick={(e) => e.stopPropagation()} className="tw-flex tw-w-full tw-max-w-2xl tw-flex-col tw-items-center tw-gap-3">
        <div className="tw-relative tw-flex tw-w-full tw-items-center tw-justify-center">
          {total > 1 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Anterior"
              className="tw-absolute tw-left-2 tw-inline-flex tw-items-center tw-justify-center tw-rounded-full"
              style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.16)', color: '#fff', cursor: 'pointer' }}
            >
              <ChevronLeft size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
          <img
            src={src}
            alt={current.titulo || ''}
            className="tw-max-h-[70vh] tw-w-auto tw-max-w-full tw-rounded-2xl tw-object-contain"
          />
          {total > 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Próxima"
              className="tw-absolute tw-right-2 tw-inline-flex tw-items-center tw-justify-center tw-rounded-full"
              style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.16)', color: '#fff', cursor: 'pointer' }}
            >
              <ChevronRight size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>

        {(current.titulo || current.descricao) && (
          <div className="tw-w-full tw-text-center">
            {current.titulo && <p className="tw-m-0 tw-text-sm tw-font-semibold" style={{ color: '#fff' }}>{current.titulo}</p>}
            {current.descricao && <p className="tw-m-0 tw-text-xs" style={{ color: 'rgba(255,255,255,0.72)' }}>{current.descricao}</p>}
          </div>
        )}

        {total > 1 && (
          <>
            <p className="tw-m-0 tw-text-xs tw-font-semibold" style={{ color: 'rgba(255,255,255,0.72)' }}>{idx + 1} / {total}</p>
            <div className="tw-flex tw-max-w-full tw-gap-2 tw-overflow-x-auto tw-pb-1">
              {images.map((img, i) => (
                <button
                  key={img.id ?? i}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-label={`Foto ${i + 1}`}
                  className="tw-overflow-hidden tw-rounded-lg"
                  style={{
                    width: 52, height: 52, flexShrink: 0, cursor: 'pointer',
                    border: `2px solid ${i === idx ? '#fff' : 'transparent'}`, opacity: i === idx ? 1 : 0.6,
                  }}
                >
                  <img src={resolveAssetUrl(img.url || '')} alt="" className="tw-h-full tw-w-full tw-object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhes (sobre + horários da semana + contato + endereço)
// ---------------------------------------------------------------------------
function DetailsModal({ est, profile, status, address, onClose }) {
  const byDay = useMemo(() => groupByDay(profile.horarios || []), [profile.horarios]);
  const todaySlug = DOW_SLUGS[new Date().getDay()];
  const phone = profile.contato_telefone || est.telefone || '';
  const phoneDigits = String(phone).replace(/\D/g, '');
  const mapsQuery = encodeURIComponent([est.nome, address].filter(Boolean).join(' '));

  const socials = [
    profile.site_url && { icon: Globe, label: 'Site', href: profile.site_url },
    profile.instagram_url && { icon: AtSign, label: 'Instagram', href: profile.instagram_url },
  ].filter(Boolean);

  return (
    <ModalShell onClose={onClose} maxWidth={480}>
      <ModalHeader title={est.nome || 'Detalhes'} onClose={onClose} />
      <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
        {status && (
          <span
            className="tw-inline-flex tw-w-fit tw-items-center tw-gap-1.5 tw-rounded-full tw-px-3 tw-py-1 tw-text-xs"
            style={
              status.open
                ? { background: 'var(--status-confirmado-bg, #E1F3E8)', color: 'var(--status-confirmado-fg, #128C4A)' }
                : { background: 'var(--surface-soft, #F6F5FB)', color: 'var(--muted-ink, #6B7280)', border: '1px solid var(--brand-border, #E7E5F5)' }
            }
          >
            <span style={{ width: 7, height: 7, borderRadius: 9999, background: status.open ? 'var(--status-confirmado-fg, #128C4A)' : '#9CA3AF' }} />
            <strong className="tw-font-bold">{status.label}</strong>
            {status.detail && <span style={{ opacity: 0.85 }}>· {status.detail}</span>}
          </span>
        )}

        {profile.sobre && (
          <section>
            <SectionTitle icon={Info}>Sobre</SectionTitle>
            <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--ink, #1E1B4B)', whiteSpace: 'pre-wrap' }}>{profile.sobre}</p>
          </section>
        )}

        {byDay.size > 0 && (
          <section>
            <SectionTitle icon={Clock}>Horário de funcionamento</SectionTitle>
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {WEEK_ORDER.map((slug) => {
                const intervals = dayIntervals(byDay.get(slug));
                const isToday = slug === todaySlug;
                const text = intervals.length ? intervals.map(([s, e]) => `${fmtMin(s)} - ${fmtMin(e)}`).join(', ') : 'Fechado';
                return (
                  <div
                    key={slug}
                    className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-rounded-lg tw-px-2 tw-py-1.5"
                    style={isToday ? { background: 'var(--brand-100, #EEEDFC)' } : undefined}
                  >
                    <span
                      className="tw-text-sm"
                      style={{ color: isToday ? 'var(--brand-deep, #1E1B4B)' : 'var(--muted-ink, #6B7280)', fontWeight: isToday ? 700 : 500 }}
                    >
                      {SLUG_LABEL[slug]}{isToday ? ' · hoje' : ''}
                    </span>
                    <span
                      className="tw-text-sm"
                      style={{ color: intervals.length ? 'var(--ink, #1E1B4B)' : '#9CA3AF', fontWeight: 600 }}
                    >
                      {text}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {address && (
          <section>
            <SectionTitle icon={MapPin}>Endereço</SectionTitle>
            <p className="tw-m-0 tw-mb-2 tw-text-sm" style={{ color: 'var(--ink, #1E1B4B)' }}>{address}</p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
              target="_blank"
              rel="noreferrer"
              className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-semibold"
              style={{ background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand, #5049E5)', border: '1px solid var(--brand-border, #E7E5F5)' }}
            >
              <MapPinned size={16} strokeWidth={2} aria-hidden="true" /> Ver no mapa
            </a>
          </section>
        )}

        {(phoneDigits || socials.length) && (
          <section>
            <SectionTitle icon={Phone}>Contato</SectionTitle>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              {phoneDigits && (
                <a
                  href={waLink(phoneDigits)}
                  target="_blank"
                  rel="noreferrer"
                  className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-semibold tw-text-white"
                  style={{ background: 'var(--wa-green, #25D366)' }}
                >
                  <MessageCircle size={16} strokeWidth={2} aria-hidden="true" /> WhatsApp
                </a>
              )}
              {phoneDigits && (
                <a
                  href={`tel:${phoneDigits}`}
                  className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-semibold"
                  style={{ background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand-deep, #1E1B4B)', border: '1px solid var(--brand-border, #E7E5F5)' }}
                >
                  <Phone size={16} strokeWidth={2} aria-hidden="true" /> Ligar
                </a>
              )}
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-semibold"
                  style={{ background: 'var(--surface-soft, #F6F5FB)', color: 'var(--brand-deep, #1E1B4B)', border: '1px solid var(--brand-border, #E7E5F5)' }}
                >
                  <s.icon size={16} strokeWidth={2} aria-hidden="true" /> {s.label}
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </ModalShell>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h3
      className="tw-m-0 tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-bold tw-uppercase"
      style={{ color: 'var(--muted-ink, #6B7280)', letterSpacing: '0.04em' }}
    >
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--brand, #5049E5)' }} />
      {children}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Avaliar (seleção de estrelas + comentário)
// ---------------------------------------------------------------------------
function RatingModal({ est, myReview, onClose, onSaved }) {
  const [nota, setNota] = useState(Number(myReview?.nota) || 0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState(myReview?.comentario || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!nota) { setError('Escolha de 1 a 5 estrelas.'); return; }
    setSaving(true);
    setError('');
    try {
      await Api.saveEstablishmentReview(est.id, { nota, comentario: comentario.trim() || null });
      onSaved({ nota, comentario: comentario.trim() || null, updated_at: null });
    } catch (e) {
      setError(e?.data?.message || 'Não foi possível salvar sua avaliação. Tente novamente.');
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={420}>
      <ModalHeader title={myReview ? 'Editar avaliação' : 'Avaliar'} onClose={onClose} />
      <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
        <div>
          <p className="tw-m-0 tw-mb-1 tw-text-sm tw-font-semibold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
            Como foi sua experiência?
          </p>
          <p className="tw-m-0 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>{est.nome}</p>
        </div>

        <div className="tw-flex tw-items-center tw-justify-center tw-gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hover || nota) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setNota(n)}
                aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
                className="tw-inline-flex tw-items-center tw-justify-center tw-border-0 tw-bg-transparent"
                style={{ padding: 4, cursor: 'pointer' }}
              >
                <Star
                  size={34}
                  strokeWidth={filled ? 0 : 2}
                  fill={filled ? '#F5A623' : 'none'}
                  color={filled ? '#F5A623' : 'var(--brand-border, #C7C3E8)'}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Conte como foi (opcional)"
          rows={3}
          className="tw-w-full tw-rounded-xl tw-p-3 tw-text-sm"
          style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', color: 'var(--ink, #1E1B4B)', resize: 'vertical' }}
        />

        {error && <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--status-cancelado-fg, #B4232A)' }}>{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-font-semibold tw-text-white"
          style={{ minHeight: 48, background: 'var(--brand, #5049E5)', opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer' }}
        >
          {saving ? (
            <><Loader2 size={20} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Salvando...</>
          ) : (
            <><Check size={20} strokeWidth={2.4} aria-hidden="true" /> {myReview ? 'Atualizar avaliação' : 'Enviar avaliação'}</>
          )}
        </button>
      </div>
    </ModalShell>
  );
}
