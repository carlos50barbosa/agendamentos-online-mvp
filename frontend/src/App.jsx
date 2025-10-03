import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { getUser, logout, USER_EVENT } from './utils/auth';
import LoginCliente from './pages/LoginCliente.jsx';
import LoginEstabelecimento from './pages/LoginEstabelecimento.jsx';
import Login from './pages/Login.jsx';
import Cadastro from './pages/Cadastro.jsx';
import DashboardCliente from './pages/DashboardCliente.jsx';
import DashboardEstabelecimento from './pages/DashboardEstabelecimento.jsx';
import ServicosEstabelecimento from './pages/ServicosEstabelecimento.jsx';
import ProfissionaisEstabelecimento from './pages/ProfissionaisEstabelecimento.jsx';
import NovoAgendamento from './pages/NovoAgendamento.jsx';
import EstabelecimentosList from './pages/EstabelecimentosList.jsx';
import {
  IconUser,
  IconHome,
  IconPlus,
  IconGear,
  IconLogout,
  IconList,
  IconChart,
  IconChevronLeft,
  IconChevronRight,
  IconSun,
  IconMoon,
} from './components/Icons.jsx';
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
import AdminDB from './pages/AdminDB.jsx';
import Contato from './pages/Contato.jsx';
import ChatAgendamento from './components/ChatAgendamento.jsx';
import LinkPhone from './pages/LinkPhone.jsx';
import Book from './pages/Book.jsx';
import {
  PREFERENCES_EVENT,
  PREFERENCES_STORAGE_KEY,
  mergePreferences,
  readPreferences,
  writePreferences,
  applyThemePreference,
  broadcastPreferences,
} from './utils/preferences.js';

const APP_ROUTES = [
  { path: '/', element: <EstabelecimentosList /> },
  { path: '/book', element: <Book /> },
  { path: '/book/:id', element: <Book /> },
  { path: '/login', element: <Login /> },
  { path: '/recuperar-senha', element: <RecuperarSenha /> },
  { path: '/definir-senha', element: <DefinirSenha /> },
  { path: '/link-phone', element: <LinkPhone /> },
  { path: '/login-cliente', element: <LoginCliente /> },
  { path: '/login-estabelecimento', element: <LoginEstabelecimento /> },
  { path: '/cadastro', element: <Cadastro /> },
  { path: '/cliente', element: <DashboardCliente /> },
  { path: '/estab', element: <DashboardEstabelecimento /> },
  { path: '/servicos', element: <ServicosEstabelecimento /> },
  { path: '/profissionais', element: <ProfissionaisEstabelecimento /> },
  { path: '/novo', element: <NovoAgendamento /> },
  { path: '/configuracoes', element: <Configuracoes /> },
  { path: '/loading', element: <Loading /> },
  { path: '/ajuda', element: <Ajuda /> },
  { path: '/relatorios', element: <Relatorios /> },
  { path: '/planos', element: <Planos /> },
  { path: '/contato', element: <Contato /> },
  { path: '/admin-tools', element: <AdminTools /> },
  { path: '/admin/db', element: <AdminDB /> },
];

function useAppPreferences() {
  const initial = useMemo(() => {
    const stored = mergePreferences(readPreferences());
    const resolved = applyThemePreference(stored.theme);
    return { stored, resolved };
  }, []);

  const [preferences, setPreferences] = useState(initial.stored);
  const [resolvedTheme, setResolvedTheme] = useState(initial.resolved);
  const prefsDirtyRef = useRef(false);

  useEffect(() => {
    writePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    let cleanup = () => {};
    const nextResolved = applyThemePreference(preferences.theme);
    setResolvedTheme(nextResolved);

    if (preferences.theme === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => setResolvedTheme(applyThemePreference('auto'));
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', listener);
      else mediaQuery.addListener(listener);
      cleanup = () => {
        if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', listener);
        else mediaQuery.removeListener(listener);
      };
    }

    return cleanup;
  }, [preferences.theme]);

  useEffect(() => {
    const handlePrefEvent = (event) => {
      const detail = event.detail || {};
      if (!detail.preferences || detail.source === 'app') return;
      if (prefsDirtyRef.current) return;
      const next = mergePreferences(detail.preferences);
      setPreferences(next);
    };

    const handleStorage = (event) => {
      if (event.key !== PREFERENCES_STORAGE_KEY) return;
      if (prefsDirtyRef.current) return;
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : {};
        setPreferences(mergePreferences(parsed));
      } catch {}
    };

    window.addEventListener(PREFERENCES_EVENT, handlePrefEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, handlePrefEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updatePreferences = useCallback((partial, source = 'app', shouldBroadcast = true) => {
    setPreferences((prev) => {
      const next = mergePreferences({ ...prev, ...partial });
      if (shouldBroadcast) broadcastPreferences(next, source);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    prefsDirtyRef.current = true;
    updatePreferences({ theme: nextTheme });
    prefsDirtyRef.current = false;
  }, [resolvedTheme, updatePreferences]);

  return {
    preferences,
    isDark: resolvedTheme === 'dark',
    chatEnabled: preferences.chatWidget !== false,
    toggleTheme,
  };
}

function Sidebar({ open, user }) {
  const nav = useNavigate();
  const resolvedUser = user ?? getUser();
  const isEstab = resolvedUser?.tipo === 'estabelecimento';

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
    try {
      if (resolvedUser?.tipo === 'estabelecimento') {
        const p = (localStorage.getItem('plan_current') || 'starter').toLowerCase();
        setPlanLabel(p === 'pro' || p === 'premium' ? p.toUpperCase() : '');
      } else {
        setPlanLabel('');
      }
    } catch {}
  }, [resolvedUser?.tipo]);

  return (
    <aside className={`sidebar ${scrolled ? 'is-scrolled' : ''}`} ref={setEl}>
      <div className="sidebar__inner">
        <nav id="mainnav" className="mainnav mainnav--vertical">
          {!resolvedUser ? (
            <div className="sidelist">
              <div className="sidelist__section">
                <NavLink to="/login" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                  <IconUser className="sidelist__icon" aria-hidden="true" />
                  <span>Login</span>
                </NavLink>
                <NavLink to="/cadastro" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                  <IconPlus className="sidelist__icon" aria-hidden="true" />
                  <span>Cadastro</span>
                </NavLink>
              </div>
            </div>
          ) : (
            <>
              <div className="profilebox" title={resolvedUser?.email || ''}>
                <IconUser className="profilebox__icon" aria-hidden="true" />
                <div className="profilebox__info">
                  <div className="profilebox__name">{resolvedUser?.nome || resolvedUser?.name || 'Usuário'}</div>
                  {resolvedUser?.email && <div className="profilebox__sub">{resolvedUser.email}</div>}
                </div>
              </div>
              {planLabel && (
                <div className="row" style={{ gap: 6 }}>
                  <div className={`badge ${planLabel === 'PREMIUM' ? 'badge--premium' : 'badge--pro'}`} title="Plano atual">
                    {planLabel}
                  </div>
                </div>
              )}

              <div className="sidelist">
                <div className="sidelist__section">
                  <div className="sidelist__heading">Principal</div>
                  <NavLink to={isEstab ? '/estab' : '/cliente'} className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                    <IconHome className="sidelist__icon" aria-hidden="true" />
                    <span>Meus Agendamentos</span>
                  </NavLink>
                  {!isEstab && (
                    <NavLink to="/novo" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                      <IconPlus className="sidelist__icon" aria-hidden="true" />
                      <span>Novo Agendamento</span>
                    </NavLink>
                  )}
                  {isEstab && (
                    <>
                      <NavLink to="/servicos" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                        <IconList className="sidelist__icon" aria-hidden="true" />
                        <span>Serviços</span>
                      </NavLink>
                      <NavLink to="/profissionais" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                        <IconList className="sidelist__icon" aria-hidden="true" />
                        <span>Profissionais</span>
                      </NavLink>
                      <NavLink to="/relatorios" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                        <IconChart className="sidelist__icon" aria-hidden="true" />
                        <span>Relatórios</span>
                      </NavLink>
                    </>
                  )}
                </div>

                <div className="sidelist__section">
                  <div className="sidelist__heading">Conta</div>
                  <NavLink to="/configuracoes" className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                    <IconGear className="sidelist__icon" aria-hidden="true" />
                    <span>Configurações</span>
                  </NavLink>
                  <button className="sidelist__item sidelist__item--danger" onClick={() => setLogoutOpen(true)}>
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

export default function App() {
  const loc = useLocation();
  const isBook = (loc?.pathname || '').startsWith('/book');
  const [currentUser, setCurrentUser] = useState(() => getUser());
  const { isDark, chatEnabled, toggleTheme } = useAppPreferences();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const handleUserEvent = (event) => {
      if (event?.detail && Object.prototype.hasOwnProperty.call(event.detail, 'user')) {
        setCurrentUser(event.detail.user);
      } else {
        setCurrentUser(getUser());
      }
    };

    const handleStorage = (event) => {
      if (event.key === 'user') {
        setCurrentUser(getUser());
      }
    };

    window.addEventListener(USER_EVENT, handleUserEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(USER_EVENT, handleUserEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    try {
      if (window.matchMedia('(max-width: 780px)').matches) setSidebarOpen(false);
    } catch {}
  }, []);

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'is-collapsed'}`}>
      {!isBook && <Sidebar open={sidebarOpen} user={currentUser} />}
      {!isBook && (
        <>
          <button
            className="sidebar-toggle"
            aria-label={sidebarOpen ? 'Ocultar menu' : 'Mostrar menu'}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            {sidebarOpen ? (
              <IconChevronLeft aria-hidden className="sidebar-toggle__icon" />
            ) : (
              <IconChevronRight aria-hidden className="sidebar-toggle__icon" />
            )}
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
            <div className="app-topbar__actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label={`Ativar tema ${isDark ? 'claro' : 'escuro'}`}
                title={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
              >
                {isDark ? <IconSun aria-hidden="true" /> : <IconMoon aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
        <div className="container">
          <Routes>
            {APP_ROUTES.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Routes>
        </div>
      </main>
      {!isBook && chatEnabled && <ChatAgendamento />}
    </div>
  );
}
