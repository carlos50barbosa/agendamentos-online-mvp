// src/components/agenda/BottomNav.jsx
// Navegação inferior (mobile) do painel do negócio: 4 ícones grandes + ação
// primária destacada "Novo agendamento". Escondida em desktop (lg+).
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Calendar, Users, Wallet, Settings, Plus } from 'lucide-react';
import { site } from '../../config/site.js';
import { iconSizes } from '../../config/theme.js';

const ICONS = { calendar: Calendar, users: Users, wallet: Wallet, settings: Settings, plus: Plus };

function NavItem({ item }) {
  const Icon = ICONS[item.icon] || Calendar;
  return (
    <NavLink
      to={item.to}
      className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-0.5"
      style={({ isActive }) => ({
        minWidth: 44,
        minHeight: 44,
        textDecoration: 'none',
        color: isActive ? 'var(--brand)' : 'var(--muted-ink, #6B7280)',
        fontWeight: isActive ? 700 : 500,
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={iconSizes.nav} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
          <span className="tw-text-[11px]">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function BottomNav({ className = '' }) {
  const { items, primary } = site.bottomNav;
  const left = items.slice(0, 2);
  const right = items.slice(2);
  const PrimaryIcon = ICONS[primary.icon] || Plus;

  return (
    <nav
      aria-label="Navegação principal"
      className={`tw-fixed tw-inset-x-0 tw-bottom-0 tw-z-40 tw-flex tw-items-center tw-justify-around tw-px-2 lg:tw-hidden ${className}`}
      style={{
        height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: 'var(--surface, #fff)',
        borderTop: '1px solid var(--brand-border, #E7E5F5)',
        boxShadow: '0 -8px 24px -16px rgba(30,27,75,.25)',
      }}
    >
      {left.map((item) => (
        <NavItem key={item.key} item={item} />
      ))}

      {/* Ação primária destacada */}
      <NavLink
        to={primary.to}
        aria-label={primary.label}
        className="tw-flex tw-flex-col tw-items-center tw-justify-center"
        style={{ marginTop: -28 }}
      >
        <span
          className="tw-flex tw-items-center tw-justify-center tw-rounded-2xl"
          style={{
            width: 56,
            height: 56,
            background: 'var(--brand)',
            color: '#fff',
            boxShadow: '0 12px 24px -8px rgba(80,73,229,.55)',
          }}
        >
          <PrimaryIcon size={28} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="tw-mt-0.5 tw-text-[10px] tw-font-semibold" style={{ color: 'var(--brand)' }}>
          Novo
        </span>
      </NavLink>

      {right.map((item) => (
        <NavItem key={item.key} item={item} />
      ))}
    </nav>
  );
}
