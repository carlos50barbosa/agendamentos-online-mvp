import React from 'react';
import LogoAO from './LogoAO.jsx';
import { IconSearch } from './Icons.jsx';

export default function AppointmentDiscoveryHero({
  headingId = 'novo-agendamento-hero-title',
  eyebrow = 'Novo agendamento',
  heading = 'Escolha um estabelecimento',
  subtitle = '',
  query = '',
  onChange = () => {},
  onSubmit = () => {},
  placeholder = 'Buscar por estabelecimento, servico, bairro ou cidade',
  inputRef = null,
  meta = null,
  stepper = null,
  children = null,
}) {
  return (
    <section className="appointment-discovery-hero" aria-labelledby={headingId}>
      <div className="appointment-discovery-hero__inner">
        <div className="appointment-discovery-hero__header">
          <div className="appointment-discovery-hero__brand">
            <div className="appointment-discovery-hero__logo-shell" aria-hidden="true">
              <LogoAO size={64} className="appointment-discovery-hero__logo" />
            </div>
            <div className="appointment-discovery-hero__copy">
              <span className="appointment-discovery-hero__eyebrow">{eyebrow}</span>
              <h1 id={headingId} className="appointment-discovery-hero__title">
                {heading}
              </h1>
              {subtitle ? (
                <p className="appointment-discovery-hero__subtitle">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {stepper ? (
            <div className="appointment-discovery-hero__stepper">
              {stepper}
            </div>
          ) : null}
        </div>

        <form className="appointment-search-panel" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor={`${headingId}-search`}>
            {placeholder}
          </label>
          <div className="appointment-search-panel__field">
            <span className="appointment-search-panel__icon" aria-hidden="true">
              <IconSearch />
            </span>
            <input
              id={`${headingId}-search`}
              ref={inputRef}
              className="appointment-search-panel__input"
              type="search"
              placeholder={placeholder}
              value={query}
              onChange={(event) => onChange(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="appointment-search-panel__actions">
            <button type="submit" className="btn btn--primary appointment-search-panel__submit">
              Buscar
            </button>
            {children ? (
              <div className="appointment-search-panel__secondary-actions">
                {children}
              </div>
            ) : null}
          </div>
        </form>

        {meta ? <div className="appointment-discovery-hero__meta">{meta}</div> : null}
      </div>
    </section>
  );
}
