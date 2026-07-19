import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { logout } from '../utils/auth.js';
import Modal from './Modal.jsx';
import Drawer from './Drawer.jsx';
import { buildNavigation, splitMobileNavigation } from '../utils/navigation.js';

// Barra inferior do mobile: poucos itens fixos COM rótulo + um "Mais".
//
// Antes ela recebia os 14 itens do menu inteiro — ~850px espremidos em 375px,
// rolando na horizontal com a scrollbar escondida e sem rótulo. Na prática o
// dono via 6 ícones mudos e nada indicava que existiam outros 8.
//
// Rótulo sempre visível é o ponto: ícone sozinho só funciona quando é universal
// (casa, busca, perfil). "Planos", "Sinal e PIX" e "Meu QR Code" não têm ícone
// óbvio, e adivinhar qual é qual custa mais que um toque a mais no "Mais".
function MobileNavBar({ user }) {
  const navigate = useNavigate();
  const navigation = useMemo(() => buildNavigation(user), [user]);
  const { primary, overflow } = useMemo(() => splitMobileNavigation(navigation), [navigation]);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const logoutLoginTarget = user?.tipo === 'estabelecimento'
    ? '/login?tipo=estabelecimento'
    : '/login?tipo=cliente';

  if (!primary.length) return null;

  const handleLogout = () => {
    setLogoutOpen(false);
    setMoreOpen(false);
    try { logout(); } catch (error) {
      console.error('Erro ao sair da conta:', error);
    }
    navigate(logoutLoginTarget, { replace: true });
  };

  const renderItem = (item, { inDrawer = false } = {}) => {
    const cls = inDrawer ? 'mobile-more__item' : 'mobile-nav__item';

    if (item.type === 'action') {
      return (
        <button
          key={item.key}
          type="button"
          className={`${cls} ${cls}--action`}
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
        onClick={() => setMoreOpen(false)}
        className={({ isActive }) => `${cls}${isActive ? ' is-active' : ''}`}
      >
        <item.icon aria-hidden="true" />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <>
      <nav className="mobile-nav" aria-label="Navegação principal">
        {primary.map((item) => renderItem(item))}

        {overflow.length > 0 && (
          <button
            type="button"
            className={`mobile-nav__item${moreOpen ? ' is-active' : ''}`}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal aria-hidden="true" />
            <span>Mais</span>
          </button>
        )}
      </nav>

      <Drawer
        open={moreOpen}
        title="Mais opções"
        onClose={() => setMoreOpen(false)}
        bodyClassName="mobile-more"
      >
        {overflow.map((item) => renderItem(item, { inDrawer: true }))}
      </Drawer>

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
