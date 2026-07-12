// src/pages/Divulgacao.jsx
// Rota /divulgacao ("Meu QR Code"): editor do link curto (agenda0.com.br/<slug>) + cartão com o
// QR Code da página pública, para BAIXAR EM PNG e IMPRIMIR (colar no balcão/recepção).
// Client-side: QR via qrserver (CORS liberado); o cartão é montado em SVG e rasterizado para PNG
// num canvas — o mesmo PNG serve para exibir, baixar e imprimir. Ao salvar o link, o QR é regerado.
import React, { useEffect, useMemo, useState } from 'react';
import { Api, resolveAssetUrl } from '../utils/api';
import { getUser } from '../utils/auth';
import { normalizeHexColor } from '../utils/publicTheme.js';
import PublicLinkSection from '../components/settings/PublicLinkSection.jsx';
import { publicLinkFor } from '../components/settings/helpers.js';
import '../components/settings/settings.css';

const CARD_W = 360;
const CARD_H = 470;

function xmlEscape(value) {
  return String(value == null ? '' : value).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

// Baixa uma imagem e devolve como data URL — o SVG do cartão é rasterizado num canvas
// (img.src = data:image/svg+xml), e nesse modo hrefs externos não são carregados.
async function fetchImageDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('image_failed');
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fetchQrDataUrl(url) {
  return fetchImageDataUrl(
    `https://api.qrserver.com/v1/create-qr-code/?size=640x640&margin=0&ecc=M&data=${encodeURIComponent(url)}`
  );
}

function buildCardSvg({ name, tagline, instruction, urlLabel, qrDataUrl, logoDataUrl, accent }) {
  const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
  const qrSize = 196;
  const qrX = (CARD_W - qrSize) / 2;
  const cx = CARD_W / 2;
  const cy = 62;
  const r = 30;
  const brand = logoDataUrl
    ? `<clipPath id="logoClip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  <image href="${logoDataUrl}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logoClip)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="2"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" fill-opacity="0.12"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="800" fill="${accent}">${xmlEscape(initial)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect x="2" y="2" width="${CARD_W - 4}" height="${CARD_H - 4}" rx="22" fill="#ffffff" stroke="${accent}" stroke-width="2.5"/>
  ${brand}
  <text x="${CARD_W / 2}" y="120" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="21" font-weight="800" fill="#1e1b4b">${xmlEscape(name)}</text>
  <text x="${CARD_W / 2}" y="145" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${accent}">${xmlEscape(tagline)}</text>
  <image href="${qrDataUrl}" x="${qrX}" y="166" width="${qrSize}" height="${qrSize}"/>
  <text x="${CARD_W / 2}" y="392" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="11.5" fill="#6b7280">${xmlEscape(instruction)}</text>
  <text x="${CARD_W / 2}" y="414" text-anchor="middle" font-family="Consolas, Menlo, monospace" font-size="11.5" fill="#9ca3af">${xmlEscape(urlLabel)}</text>
</svg>`;
}

function rasterizeToPng(svg, scale = 3) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = CARD_W * scale;
        canvas.height = CARD_H * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export default function Divulgacao() {
  const [status, setStatus] = useState('loading'); // loading | ready | error | forbidden
  const [cardStatus, setCardStatus] = useState('idle'); // idle | generating | ready | error
  const [info, setInfo] = useState({ id: null, name: '', accent: '#5049E5', logo: '' });
  const [slug, setSlug] = useState('');
  const [pngUrl, setPngUrl] = useState('');

  // 1) carrega o estabelecimento (nome, cor e slug atual)
  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const est = await Api.getEstablishment(user.id);
        if (!alive) return;
        setInfo({
          id: user.id,
          name: est?.nome || 'Meu estabelecimento',
          accent: normalizeHexColor(est?.profile?.accent_color) || '#5049E5',
          logo: resolveAssetUrl(est?.avatar_url || '') || '',
        });
        setSlug(String(est?.slug || ''));
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const publicUrl = useMemo(() => publicLinkFor({ slug, id: info.id }), [slug, info.id]);

  // 2) (re)gera o cartão sempre que o link, o nome ou a cor mudarem
  useEffect(() => {
    if (status !== 'ready' || !publicUrl) return () => {};
    let alive = true;
    (async () => {
      setCardStatus('generating');
      try {
        const [qrDataUrl, logoDataUrl] = await Promise.all([
          fetchQrDataUrl(publicUrl),
          // sem foto (ou se ela não puder ser embutida), o cartão cai na inicial do nome
          info.logo ? fetchImageDataUrl(info.logo).catch(() => '') : Promise.resolve(''),
        ]);
        const svg = buildCardSvg({
          name: info.name,
          tagline: 'Agende pelo celular',
          instruction: 'Aponte a câmera do celular para o código',
          urlLabel: publicUrl.replace(/^https?:\/\//, ''),
          qrDataUrl,
          logoDataUrl,
          accent: info.accent,
        });
        const png = await rasterizeToPng(svg, 3);
        if (!alive) return;
        setPngUrl(png);
        setCardStatus('ready');
      } catch { if (alive) setCardStatus('error'); }
    })();
    return () => { alive = false; };
  }, [status, publicUrl, info.name, info.accent, info.logo]);

  const fileSlug = slug || String(info.id || 'estabelecimento');

  const downloadPng = () => {
    if (!pngUrl) return;
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `qrcode-${fileSlug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printCard = () => {
    if (!pngUrl) return;
    const w = window.open('', '_blank', 'width=520,height=680');
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>Meu QR Code</title><meta charset="utf-8">` +
      `<style>@page{margin:14mm}html,body{margin:0}body{display:flex;justify-content:center;align-items:flex-start;padding:24px}` +
      `img{width:340px;max-width:100%;height:auto}</style></head>` +
      `<body><img src="${pngUrl}" alt="QR Code de divulgação" onload="setTimeout(function(){window.focus();window.print();},200)"></body></html>`
    );
    w.document.close();
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Divulgação</span>
          <h2>Meu QR Code</h2>
          <p className="muted">Imprima o QR Code e deixe no balcão ou na recepção. O cliente aponta a câmera e abre sua página de agendamento.</p>
        </div>
        {status === 'ready' && publicUrl ? (
          <div className="settings-module-hero__meta">
            <a className="btn btn--outline btn--sm" href={publicUrl} target="_blank" rel="noreferrer">Abrir página pública</a>
          </div>
        ) : null}
      </section>

      {status === 'loading' && (
        <section className="card row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="spinner" aria-hidden="true" /> <span className="muted">Carregando…</span>
        </section>
      )}
      {status === 'forbidden' && <div className="notice notice--info">Disponível apenas para contas de estabelecimento.</div>}
      {status === 'error' && <div className="notice notice--error">Não foi possível carregar. Recarregue a página.</div>}

      {status === 'ready' && (
        <>
          {/* Editor do link curto — ao salvar, o QR abaixo é regerado */}
          <section className="card">
            <h3 style={{ margin: '0 0 4px' }}>Link da página</h3>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              Personalize o endereço curto que você divulga. O QR Code abaixo é regerado na hora.
            </p>
            <PublicLinkSection compact onSaved={(s) => setSlug(s)} />
          </section>

          {/* Cartão com o QR Code */}
          <section className="card">
            {cardStatus === 'generating' && (
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="spinner" aria-hidden="true" /> <span className="muted">Gerando o cartão…</span>
              </div>
            )}
            {cardStatus === 'error' && (
              <div className="notice notice--error">Não foi possível gerar o QR Code agora. Verifique sua conexão e recarregue a página.</div>
            )}
            {cardStatus === 'ready' && (
              <div className="set-promo">
                <img className="set-promo__card" src={pngUrl} alt="Cartão de divulgação com QR Code" />
                <div className="set-promo__actions">
                  <button type="button" className="btn btn--primary" onClick={downloadPng}>Baixar PNG</button>
                  <button type="button" className="btn btn--outline" onClick={printCard}>Imprimir</button>
                </div>
                <a className="set-promo__link" href={publicUrl} target="_blank" rel="noreferrer">
                  {publicUrl.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
