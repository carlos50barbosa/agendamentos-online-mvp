import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '../utils/auth.js';
import Modal from './Modal.jsx';
import { buildNavigation, flattenNavigationSections } from '../utils/navigation.js';

function MobileNavBar({ user }) {
  const navigate = useNavigate();
  const navigation = useMemo(() => buildNavigation(user), [user]);
  const items = useMemo(() => flattenNavigationSections(navigation), [navigation]);
  const [logoutOpen, setLogoutOpen] = useState(false);

  if (!items.length) return null;

  const handleLogout = () => {
    setLogoutOpen(false);
    try { logout(); } catch (error) {
      console.error('Erro ao sair da conta:', error);
    }
    navigate('/loading?type=logout&next=/', { replace: true });
  };

  return (
    <>
      <nav className="mobile-nav" aria-label="Navegação principal">
        {items.map((item) => {
          if (item.type === 'action') {
            return (
              <button
                key={item.key}
                type="button"
                className="mobile-nav__item mobile-nav__item--action"
                onClick={() => setLogoutOpen(true)}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          }

          return (
            <NavLink
              key={item.key}
              to={item.to}
              className={({ isActive }) =>
                `mobile-nav__item${isActive ? ' is-active' : ''}`
              }
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {logoutOpen && (
        <Modal
          title="Sair da conta"
          onClose={() => setLogoutOpen(false)}
          actions={[
            <button key="cancel" className="btn btn--outline" onClick={() => setLogoutOpen(false)}>Cancelar</button>,
            <button key="confirm" className="btn btn--danger" onClick={handleLogout}>Sair</button>,
          ]}
        >
          <p>Tem certeza que deseja sair?</p>
        </Modal>
      )}
    </>
  );
}

export default MobileNavBar;
