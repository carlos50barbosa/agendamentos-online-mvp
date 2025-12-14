import React from 'react';
import LogoAO from './LogoAO.jsx';
import { IconSearch } from './Icons.jsx';

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
            <span className="novo-agendamento__search-caret" aria-hidden>▾</span>
          </div>
          {children}
        </form>
      </div>
    </section>
  );
}

