import React, { useEffect, useState } from 'react';
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import { getUser, logout } from './utils/auth';
import LoginCliente from './pages/LoginCliente.jsx';
import LoginEstabelecimento from './pages/LoginEstabelecimento.jsx';
import Cadastro from './pages/Cadastro.jsx';
import DashboardCliente from './pages/DashboardCliente.jsx';
import DashboardEstabelecimento from './pages/DashboardEstabelecimento.jsx';
import ServicosEstabelecimento from './pages/ServicosEstabelecimento.jsx';
import NovoAgendamento from './pages/NovoAgendamento.jsx';

function Header(){
  const nav = useNavigate();
  const user = getUser();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={`app-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="app-header__inner">
        {/* Marca / Home */}
        <NavLink to="/" className="brand" onClick={closeMenu}>
          <span className="brand__logo" aria-hidden="true">AO</span>
          <span className="brand__text">
            <strong>Agendamentos Online</strong>
            <small>Rápido e sem fricção</small>
          </span>
        </NavLink>

        {/* Botão hamburguer no mobile */}
        <button
          className="hamburger"
          aria-label="Abrir menu"
          aria-controls="mainnav"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        >
          <span />
        </button>

        {/* Navegação */}
        <nav id="mainnav" className={`mainnav ${menuOpen ? 'is-open' : ''}`}>
          {!user && (
            <>
              <NavLink to="/login-cliente" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Cliente</NavLink>
              <NavLink to="/login-estabelecimento" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Estabelecimento</NavLink>
              <NavLink to="/cadastro" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Cadastro</NavLink>
            </>
          )}

          {user && user.tipo === 'cliente' && (
            <>
              <NavLink to="/cliente" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Dashboard</NavLink>
              {/* CTA destacado */}
              <NavLink to="/novo" className="btn btn--primary btn--sm header-cta" onClick={closeMenu}>
                Novo Agendamento
              </NavLink>
            </>
          )}

          {user && user.tipo === 'estabelecimento' && (
            <>
              <NavLink to="/estab" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Dashboard</NavLink>
              <NavLink to="/servicos" className={({isActive}) => isActive ? 'active' : undefined} onClick={closeMenu}>Serviços</NavLink>
            </>
          )}

          {user && (
            <button
              className="btn btn--sm btn--outline"
              onClick={() => { logout(); closeMenu(); nav('/'); }}
            >
              Sair
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App(){
  return (
    <>
      <Header/>
      <div className="container">
        <Routes>
          <Route path="/" element={<div className="card"><h2>MVP pronto</h2><p>Faça login para continuar.</p></div>} />
          <Route path="/login-cliente" element={<LoginCliente/>}/>
          <Route path="/login-estabelecimento" element={<LoginEstabelecimento/>}/>
          <Route path="/cadastro" element={<Cadastro/>}/>
          <Route path="/cliente" element={<DashboardCliente/>}/>
          <Route path="/estab" element={<DashboardEstabelecimento/>}/>
          <Route path="/servicos" element={<ServicosEstabelecimento/>}/>
          <Route path="/novo" element={<NovoAgendamento/>}/>
        </Routes>
      </div>
    </>
  );
}
