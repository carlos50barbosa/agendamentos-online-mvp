// src/components/LogoAO.jsx
import React from 'react';

// Marca do produto: logo oficial (badge circular índigo com calendário + check,
// brilho no topo e aro no canto). Usa a versão otimizada 128px (~16KB, pixels
// idênticos ao logo-v3.png de 512px/285KB). BASE_URL cobre deploy em subpath.
const LOGO_SRC = `${import.meta.env.BASE_URL}static/logo-v3-128.png`;

export default function LogoAO({ size = 28, className = 'brand__logo', title = 'Agendamentos Online' }) {
  return (
    <img
      src={LOGO_SRC}
      alt={title}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      {...(className ? { className } : {})}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'contain', display: 'block' }}
    />
  );
}
