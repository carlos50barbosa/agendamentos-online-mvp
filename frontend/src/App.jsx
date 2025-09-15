import React, { useEffect, useState } from 'react';
import { NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
import { IconUser, IconMenu, IconHome, IconPlus, IconGear, IconHelp, IconLogout, IconList, IconChart, IconChevronLeft, IconChevronRight } from './components/Icons.jsx';
import LogoAO from './components/LogoAO.jsx';
import Modal from './components/Modal.jsx';
import Loading from './pages/Loading.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import Ajuda from './pages/Ajuda.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Planos from './pages/Planos.jsx';
import RecuperarSenha from './pages/RecuperarSenha.jsx';
import DefinirSenha from './pages/DefinirSenha.jsx';
import AdminTools from './pages/AdminTools.jsx';
import ChatAgendamento from './components/ChatAgendamento.jsx';
import LinkPhone from './pages/LinkPhone.jsx';
import Book from './pages/Book.jsx';

function Sidebar({ open }){
  const nav = useNavigate();
  const user = getUser();

  const [scrolled, setScrolled] = useState(false);
  const [el, setEl] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [planLabel, setPlanLabel] = useState('');

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

  useEffect(() => {
    try{
      if (user?.tipo === 'estabelecimento'){
        const p = (localStorage.getItem('plan_current') || 'starter').toLowerCase();
        if (p === 'pro' || p === 'premium') setPlanLabel(p.toUpperCase());
        else setPlanLabel('');
      } else {
        setPlanLabel('');
      }
    }catch{}
  }, [user?.tipo]);

  return (
    <aside className={`sidebar ${scrolled ? 'is-scrolled' : ''}`} ref={setEl}>
      <div className="sidebar__inner">
        {/* Marca removida da lateral conforme solicitado */}

        <nav id="mainnav" className="mainnav mainnav--vertical">
          {!user ? (
            <div className="sidelist">
              <div className="sidelist__section">
                <NavLink
                  to="/login"
                  className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                >
                  <IconUser className="sidelist__icon" aria-hidden="true" />
                  <span>Login</span>
                </NavLink>
                <NavLink
                  to="/cadastro"
                  className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                >
                  <IconPlus className="sidelist__icon" aria-hidden="true" />
                  <span>Cadastro</span>
                </NavLink>
              </div>
            </div>
          ) : (
            <>
              <div className="profilebox" title={user?.email || ''}>
                <IconUser className="profilebox__icon" aria-hidden="true" />
                <div className="profilebox__info">
                  <div className="profilebox__name">{user?.nome || user?.name || 'Usuário'}</div>
                  {user?.email && <div className="profilebox__sub">{user.email}</div>}
                </div>
              </div>
              {planLabel && (
                <div className="row" style={{ gap: 6 }}>
                  <div
                    className={`badge ${planLabel === 'PREMIUM' ? 'badge--premium' : 'badge--pro'}`}
                    title="Plano atual"
                  >
                    {planLabel}
                  </div>
                </div>
              )}

              <div className="sidelist">
                <div className="sidelist__section">
                  <div className="sidelist__heading">Navegação</div>
                  {user?.tipo !== 'estabelecimento' && (
                    <>
                      <NavLink
                        to="/novo"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconPlus className="sidelist__icon" aria-hidden="true" />
                        <span>Novo Agendamento</span>
                      </NavLink>
                      <NavLink
                        to="/cliente"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconHome className="sidelist__icon" aria-hidden="true" />
                        <span>Dashboard</span>
                      </NavLink>
                    </>
                  )}
                  {/* Para estabelecimentos, o Dashboard vai no meio da seção Gestão */}
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
                      {/* Link de Planos removido da sidebar; acesso via Configurações */}
                      <NavLink
                        to="/relatorios"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconChart className="sidelist__icon" aria-hidden="true" />
                        <span>Relatórios</span>
                      </NavLink>
                      {/* Dashboard agora no centro (3º item da barra) */}
                      <NavLink
                        to="/estab"
                        className={({isActive}) => `sidelist__item${isActive ? ' active' : ''}`}
                      >
                        <IconHome className="sidelist__icon" aria-hidden="true" />
                        <span>Dashboard</span>
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
                  {/* Link de Ajuda removido da sidebar; acesso via Configurações */}
                  <button
                    className="sidelist__item sidelist__item--danger"
                    onClick={() => setLogoutOpen(true)}
                  >
                    <IconLogout className="sidelist__icon" aria-hidden="true" />
                    <span>Sair</span>
                  </button>
                  {logoutOpen && (
                    <Modal
                      title="Sair da conta"
                      onClose={() => setLogoutOpen(false)}
                      actions={[
                        <button key="cancel" className="btn btn--outline" onClick={() => setLogoutOpen(false)}>Cancelar</button>,
                        <button
                          key="confirm"
                          className="btn btn--danger"
                          onClick={() => {
                            setLogoutOpen(false);
                            try { logout(); } catch {}
                            nav('/loading?type=logout&next=/', { replace: true });
                          }}
                        >
                          Sair
                        </button>,
                      ]}
                    >
                      <p>Tem certeza que deseja sair?</p>
                    </Modal>
                  )}
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
  const loc = useLocation();
  const isBook = (loc?.pathname || '').startsWith('/book');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.matchMedia('(max-width: 780px)').matches) setSidebarOpen(false);
    } catch {}
  }, []);

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'is-collapsed'}`}>
      {!isBook && <Sidebar open={sidebarOpen}/>}    
      {!isBook && (
        <>
          <button
            className="sidebar-toggle"
            aria-label={sidebarOpen ? 'Ocultar menu' : 'Mostrar menu'}
            onClick={() => setSidebarOpen(v => !v)}
          >
            {sidebarOpen ? <IconChevronLeft aria-hidden className="sidebar-toggle__icon"/> : <IconChevronRight aria-hidden className="sidebar-toggle__icon"/>}
          </button>
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden></div>
        </>
      )}
      <main className="app-main">
        <div className="app-topbar">
          <div className="app-topbar__inner">
            <NavLink to="/" className="brand">
              <LogoAO size={28} />
              <span className="brand__text">
                <strong>Agendamentos Online</strong>
                <small>Rápido e sem fricção</small>
              </span>
            </NavLink>
          </div>
        </div>
        <div className="container">
          <Routes>
            <Route path="/" element={<EstabelecimentosList/>} />
            <Route path="/book" element={<Book/>} />
            <Route path="/book/:id" element={<Book/>} />
            <Route path="/login" element={<Login/>}/>
            <Route path="/recuperar-senha" element={<RecuperarSenha/>}/>
            <Route path="/definir-senha" element={<DefinirSenha/>}/>
            <Route path="/link-phone" element={<LinkPhone/>}/>
            <Route path="/login-cliente" element={<LoginCliente/>}/>
            <Route path="/login-estabelecimento" element={<LoginEstabelecimento/>}/>
            <Route path="/cadastro" element={<Cadastro/>}/>
            <Route path="/cliente" element={<DashboardCliente/>}/>
            <Route path="/estab" element={<DashboardEstabelecimento/>}/>
            <Route path="/servicos" element={<ServicosEstabelecimento/>}/>
            <Route path="/novo" element={<NovoAgendamento/>}/>
            <Route path="/configuracoes" element={<Configuracoes/>}/>
            <Route path="/loading" element={<Loading/>}/>
            <Route path="/ajuda" element={<Ajuda/>}/>
            <Route path="/relatorios" element={<Relatorios/>}/>
          <Route path="/planos" element={<Planos/>}/>
          <Route path="/admin-tools" element={<AdminTools/>}/>
          <Route path="/book/:id" element={<Book/>}/>
          </Routes>
        </div>
      </main>
      {/* Widget de chat de agendamento (flutuante) - oculto em /book */}
      {!isBook && <ChatAgendamento />}
    </div>
  );
}
