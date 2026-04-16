import React from 'react';
import LogoAO from './LogoAO.jsx';
import { IconSearch } from './Icons.jsx';

export default function AppointmentDiscoveryHero({
  className = '',
  headingId = 'novo-agendamento-hero-title',
  eyebrow = 'Agendamento profissional',
  brandName = 'Agendamentos Online',
  brandTagline = 'Plataforma institucional para reservas de serviços',
  heading = 'Encontre o atendimento ideal com mais clareza',
  subtitle = '',
  query = '',
  onChange = () => {},
  onSubmit = () => {},
  placeholder = 'Buscar por estabelecimento, serviço, bairro ou cidade',
  inputRef = null,
  meta = null,
  stepper = null,
  headerAction = null,
  children = null,
}) {
  return (
    <section
      className={['appointment-discovery-hero', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <div className="appointment-discovery-hero__inner">
        <div className="appointment-discovery-hero__header">
          <div className="appointment-discovery-hero__brand">
            <div className="appointment-discovery-hero__logo-shell" aria-hidden="true">
              <LogoAO size={64} className="appointment-discovery-hero__logo" />
            </div>
            <div className="appointment-discovery-hero__copy">
              {(brandName || brandTagline) ? (
                <div className="appointment-discovery-hero__brand-line">
                  {brandName ? (
                    <span className="appointment-discovery-hero__brand-name">{brandName}</span>
                  ) : null}
                  {brandTagline ? (
                    <span className="appointment-discovery-hero__brand-tagline">{brandTagline}</span>
                  ) : null}
                </div>
              ) : null}
              {eyebrow ? (
                <span className="appointment-discovery-hero__eyebrow">{eyebrow}</span>
              ) : null}
              <h1 id={headingId} className="appointment-discovery-hero__title">
                {heading}
              </h1>
              {subtitle ? (
                <p className="appointment-discovery-hero__subtitle">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {(headerAction || stepper) ? (
            <div className="appointment-discovery-hero__header-aside">
              {headerAction ? (
                <div className="appointment-discovery-hero__header-action">
                  {headerAction}
                </div>
              ) : null}
              {stepper ? (
                <div className="appointment-discovery-hero__stepper">
                  {stepper}
                </div>
              ) : null}
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
            {children ? (
              <div className="appointment-search-panel__secondary-actions">
                {children}
              </div>
            ) : null}
            <button type="submit" className="btn btn--primary appointment-search-panel__submit">
              Buscar
            </button>
          </div>
        </form>

        {meta ? <div className="appointment-discovery-hero__meta">{meta}</div> : null}
      </div>
    </section>
  );
}
