import React, { useEffect, useState } from 'react';
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom';
import { getUser, logout } from './utils/auth';
import LoginCliente from './pages/LoginCliente.jsx';
import LoginEstabelecimento from './pages/LoginEstabelecimento.jsx';
import Login from './pages/Login.jsx';
import Cadastro from './pages/Cadastro.jsx';
import DashboardCliente from './pages/DashboardCliente.jsx';
import DashboardEstabelecimento from './pages/DashboardEstabelecimento.jsx';
import ServicosEstabelecimento from './pages/ServicosEstabelecimento.jsx';
import NovoAgendamento from './pages/NovoAgendamento.jsx';
import EstabelecimentosList from './pages/EstabelecimentosList.jsx';
import { IconUser, IconMenu, IconHome, IconPlus, IconGear, IconHelp, IconLogout, IconList, IconChevronLeft, IconChevronRight } from './components/Icons.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import Ajuda from './pages/Ajuda.jsx';
import Relatorios from './pages/Relatorios.jsx';

function Sidebar({ open }){
  const nav = useNavigate();
  const user = getUser();

  const [scrolled, setScrolled] = useState(false);
  const [el, setEl] = useState(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (open && el) {
      try { el.scrollTop = 0; } catch {}
    }
  }, [open, el]);

  return (
    <aside className={`sidebar ${scrolled ? 'is-scrolled' : ''}`} ref={setEl}>
      <div className="sidebar__inner">
        <NavLink to="/" className="brand">
          <span className="brand__logo" aria-hidden="true">AO</span>
          <span className="brand__text">
            <strong>Agendamentos Online</strong>
            <small>Rápido e sem fricção</small>
          </span>
        </NavLink>

        <nav id="mainnav" className="mainnav mainnav--vertical">
          {!user ? (
            <>
              <NavLink to="/login" className={({isActive}) => isActive ? 'active' : undefined}>Login</NavLink>
              <NavLink to="/cadastro" className={({isActive}) => isActive ? 'active' : undefined}>Cadastro</NavLink>
            </>
          ) : (
            <>
              <div className="profilebox" title={user?.email || ''}>
                <IconUser className="profilebox__icon" aria-hidden="true" />
                <div className="profilebox__info">
                  <div className="profilebox__name">{user?.nome || user?.name || 'Usuário'}</div>
                  {user?.email && <div className="profilebox__sub">{user.email}</div>}
                </div>
              </div>

              <div className="sidelist">
                <div className="sidelist__section">
                  <div className="sidelist__heading">Navegação</div>
                  <NavLink
                    to={user?.tipo === 'estabelecimento' ? '/estab' : '/cliente'}
                    className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                  >
                    <IconHome className="sidelist__icon" aria-hidden="true" />
                    <span>Dashboard</span>
                  </NavLink>
                  {user?.tipo !== 'estabelecimento' && (
                    <NavLink
                      to="/novo"
                      className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                    >
                      <IconPlus className="sidelist__icon" aria-hidden="true" />
                      <span>Novo Agendamento</span>
                    </NavLink>
                  )}
                </div>

                <div className="sidelist__section">
                  <div className="sidelist__heading">Gestão</div>
                  {user?.tipo === 'estabelecimento' && (
                    <>
                      <NavLink
                        to="/servicos"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconList className="sidelist__icon" aria-hidden="true" />
                        <span>Serviços</span>
                      </NavLink>
                      <NavLink
                        to="/relatorios"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconList className="sidelist__icon" aria-hidden="true" />
                        <span>Relatórios</span>
                      </NavLink>
                    </>
                  )}
                </div>

                <div className="sidelist__section">
                  <div className="sidelist__heading">Suporte</div>
                  <NavLink
                    to="/configuracoes"
                    className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                  >
                    <IconGear className="sidelist__icon" aria-hidden="true" />
                    <span>Configurações</span>
                  </NavLink>
                  <NavLink
                    to="/ajuda"
                    className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                  >
                    <IconHelp className="sidelist__icon" aria-hidden="true" />
                    <span>Ajuda</span>
                  </NavLink>
                  <button
                    className="sidelist__item sidelist__item--danger"
                    onClick={() => { logout(); nav('/'); }}
                  >
                    <IconLogout className="sidelist__icon" aria-hidden="true" />
                    <span>Sair</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </nav>
      </div>
    </aside>
  );
}

export default function App(){
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.matchMedia('(max-width: 780px)').matches) setSidebarOpen(false);
    } catch {}
  }, []);

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'is-collapsed'}`}>
      <Sidebar open={sidebarOpen}/>
      <button
        className="sidebar-toggle"
        aria-label={sidebarOpen ? 'Ocultar menu' : 'Mostrar menu'}
        onClick={() => setSidebarOpen(v => !v)}
      >
        {sidebarOpen ? <IconChevronLeft aria-hidden className="sidebar-toggle__icon"/> : <IconChevronRight aria-hidden className="sidebar-toggle__icon"/>}
      </button>
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden></div>
      <main className="app-main">
        <div className="app-topbar">
          <div className="app-topbar__inner">
            <strong>Agendamentos Online</strong>
            <small>Rápido e sem fricção</small>
          </div>
        </div>
        <div className="container">
          <Routes>
            <Route path="/" element={<EstabelecimentosList/>} />
            <Route path="/login" element={<Login/>}/>
            <Route path="/login-cliente" element={<LoginCliente/>}/>
            <Route path="/login-estabelecimento" element={<LoginEstabelecimento/>}/>
            <Route path="/cadastro" element={<Cadastro/>}/>
            <Route path="/cliente" element={<DashboardCliente/>}/>
            <Route path="/estab" element={<DashboardEstabelecimento/>}/>
            <Route path="/servicos" element={<ServicosEstabelecimento/>}/>
            <Route path="/novo" element={<NovoAgendamento/>}/>
            <Route path="/configuracoes" element={<Configuracoes/>}/>
            <Route path="/ajuda" element={<Ajuda/>}/>
            <Route path="/relatorios" element={<Relatorios/>}/>
          </Routes>
        </div>
      </main>
    </div>
  );
}
