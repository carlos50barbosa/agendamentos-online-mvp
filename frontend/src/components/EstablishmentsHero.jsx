import React from 'react';
import LogoAO from './LogoAO.jsx';
import { IconSearch, IconChevronRight } from './Icons.jsx';

export default function EstablishmentsHero({
  heading = 'Novo agendamento',
  subtitle = '',
  query = '',
  onChange = () => {},
  onSubmit = () => {},
  placeholder = 'Buscar por nome, bairro ou cidade',
  inputRef = null,
  children = null,
  headingId = 'home-hero-title',
}) {
  return (
    <section className="home-hero" aria-labelledby={headingId}>
      <div className="home-hero__inner">
        <LogoAO size={72} className="home-hero__logo" />
        <h1 id={headingId} className="home-hero__heading">
          <span className="home-hero__heading-text">{heading}</span>
        </h1>
        {subtitle ? <p className="home-hero__subtitle">{subtitle}</p> : null}
        <form className="novo-agendamento__search" onSubmit={onSubmit}>
          <div className="novo-agendamento__searchbox">
            <IconSearch className="novo-agendamento__search-icon" aria-hidden />
            <input
              ref={inputRef}
              className="input novo-agendamento__search-input"
              type="search"
              placeholder={placeholder}
              value={query}
              onChange={(e) => onChange(e.target.value)}
              aria-label={placeholder}
            />
            <IconChevronRight className="novo-agendamento__search-caret" aria-hidden />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
            <button
              type="submit"
              className="btn"
              style={{
                alignSelf: 'center',
                borderRadius: 9999,
                padding: '8px 14px',
                background: '#f8fafc',
                color: '#0f172a',
                border: '1px solid #e2e8f0',
                fontWeight: 600,
                boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
              }}
            >
              Buscar
            </button>
            {children}
          </div>
        </form>
      </div>
    </section>
  );
}
