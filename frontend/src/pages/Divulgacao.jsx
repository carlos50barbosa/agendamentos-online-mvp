// src/pages/Divulgacao.jsx
// Rota dedicada /divulgacao: cartão com o QR Code da página pública de agendamento do
// estabelecimento, para BAIXAR EM PNG e IMPRIMIR (colar no balcão/recepção).
// Client-side: QR via qrserver (CORS liberado); o cartão é montado em SVG e rasterizado
// para PNG num canvas — o mesmo PNG serve para exibir, baixar e imprimir.
import React, { useEffect, useState } from 'react';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import { normalizeHexColor } from '../utils/publicTheme.js';
import '../components/settings/settings.css';

const CARD_W = 360;
const CARD_H = 470;

function xmlEscape(value) {
  return String(value == null ? '' : value).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

async function fetchQrDataUrl(url) {
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=640x640&margin=0&ecc=M&data=${encodeURIComponent(url)}`;
  const resp = await fetch(qr);
  if (!resp.ok) throw new Error('qr_failed');
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildCardSvg({ name, tagline, instruction, urlLabel, qrDataUrl, accent }) {
  const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
  const qrSize = 196;
  const qrX = (CARD_W - qrSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect x="2" y="2" width="${CARD_W - 4}" height="${CARD_H - 4}" rx="22" fill="#ffffff" stroke="${accent}" stroke-width="2.5"/>
  <circle cx="${CARD_W / 2}" cy="62" r="27" fill="${accent}" fill-opacity="0.12"/>
  <text x="${CARD_W / 2}" y="62" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="800" fill="${accent}">${xmlEscape(initial)}</text>
  <text x="${CARD_W / 2}" y="120" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="21" font-weight="800" fill="#1e1b4b">${xmlEscape(name)}</text>
  <text x="${CARD_W / 2}" y="145" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${accent}">${xmlEscape(tagline)}</text>
  <image href="${qrDataUrl}" x="${qrX}" y="166" width="${qrSize}" height="${qrSize}"/>
  <text x="${CARD_W / 2}" y="392" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="11.5" fill="#6b7280">${xmlEscape(instruction)}</text>
  <text x="${CARD_W / 2}" y="414" text-anchor="middle" font-family="Consolas, Menlo, monospace" font-size="10.5" fill="#9ca3af">${xmlEscape(urlLabel)}</text>
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
  const [pngUrl, setPngUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [fileSlug, setFileSlug] = useState('estabelecimento');

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const est = await Api.getEstablishment(user.id);
        if (!alive) return;
        const id = user.id;
        const slug = est?.slug || String(id);
        const name = est?.nome || est?.profile?.nome || 'Meu estabelecimento';
        const accent = normalizeHexColor(est?.profile?.accent_color) || '#5049E5';

        let origin = 'https://agenda0.com.br';
        if (typeof window !== 'undefined' && window.location?.origin?.includes('agenda0.com.br')) origin = window.location.origin;
        const url = `${origin}/agendar/${slug}?estabelecimento=${id}`;

        const qrDataUrl = await fetchQrDataUrl(url);
        const svg = buildCardSvg({
          name,
          tagline: 'Agende pelo celular',
          instruction: 'Aponte a câmera do celular para o código',
          urlLabel: url.replace(/^https?:\/\//, ''),
          qrDataUrl,
          accent,
        });
        const png = await rasterizeToPng(svg, 3);
        if (!alive) return;
        setPublicUrl(url);
        setFileSlug(slug);
        setPngUrl(png);
        setStatus('ready');
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, []);

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
        {publicUrl ? (
          <div className="settings-module-hero__meta">
            <a className="btn btn--outline btn--sm" href={publicUrl} target="_blank" rel="noreferrer">Abrir página pública</a>
          </div>
        ) : null}
      </section>

      <section className="card">
        {status === 'loading' && (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="spinner" aria-hidden="true" /> <span className="muted">Gerando o cartão de divulgação…</span>
          </div>
        )}
        {status === 'forbidden' && <div className="notice notice--info">Disponível apenas para contas de estabelecimento.</div>}
        {status === 'error' && <div className="notice notice--error">Não foi possível gerar o QR Code agora. Verifique sua conexão e recarregue a página.</div>}
        {status === 'ready' && (
          <div className="set-promo">
            <img className="set-promo__card" src={pngUrl} alt="Cartão de divulgação com QR Code" />
            <div className="set-promo__actions">
              <button type="button" className="btn btn--primary" onClick={downloadPng}>Baixar PNG</button>
              <button type="button" className="btn btn--outline" onClick={printCard}>Imprimir</button>
            </div>
            <a className="set-promo__link" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl.replace(/^https?:\/\//, '')}</a>
          </div>
        )}
      </section>
    </div>
  );
}
