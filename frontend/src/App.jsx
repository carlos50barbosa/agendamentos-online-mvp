import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { getUser, logout, USER_EVENT } from './utils/auth';
import EstabelecimentosList from './pages/EstabelecimentosList.jsx';
import {
  IconUser,
  IconChevronLeft,
  IconChevronRight,
  IconSun,
  IconMoon,
} from './components/Icons.jsx';
import LogoAO from './components/LogoAO.jsx';
import Modal from './components/Modal.jsx';
import MobileNavBar from './components/MobileNavBar.jsx';
import { buildNavigation } from './utils/navigation.js';
import { Api } from './utils/api.js';
import {
  PREFERENCES_EVENT,
  PREFERENCES_STORAGE_KEY,
  mergePreferences,
  readPreferences,
  writePreferences,
  applyThemePreference,
  broadcastPreferences,
} from './utils/preferences.js';

const LoginCliente = React.lazy(() => import('./pages/LoginCliente.jsx'));
const LoginEstabelecimento = React.lazy(() => import('./pages/LoginEstabelecimento.jsx'));
const Login = React.lazy(() => import('./pages/Login.jsx'));
const Cadastro = React.lazy(() => import('./pages/Cadastro.jsx'));
const DashboardCliente = React.lazy(() => import('./pages/DashboardCliente.jsx'));
const DashboardEstabelecimento = React.lazy(() => import('./pages/DashboardEstabelecimento.jsx'));
const ServicosEstabelecimento = React.lazy(() => import('./pages/ServicosEstabelecimento.jsx'));
const ProfissionaisEstabelecimento = React.lazy(() => import('./pages/ProfissionaisEstabelecimento.jsx'));
const NovoAgendamento = React.lazy(() => import('./pages/NovoAgendamento.jsx'));
const Configuracoes = React.lazy(() => import('./pages/Configuracoes.jsx'));
const Ajuda = React.lazy(() => import('./pages/Ajuda.jsx'));
const Relatorios = React.lazy(() => import('./pages/Relatorios.jsx'));
const Planos = React.lazy(() => import('./pages/Planos.jsx'));
const RecuperarSenha = React.lazy(() => import('./pages/RecuperarSenha.jsx'));
const DefinirSenha = React.lazy(() => import('./pages/DefinirSenha.jsx'));
const AdminTools = React.lazy(() => import('./pages/AdminTools.jsx'));
const AdminDB = React.lazy(() => import('./pages/AdminDB.jsx'));
const AdminBilling = React.lazy(() => import('./pages/AdminBilling.jsx'));
const Contato = React.lazy(() => import('./pages/Contato.jsx'));
const LinkPhone = React.lazy(() => import('./pages/LinkPhone.jsx'));
const Termos = React.lazy(() => import('./pages/Termos.jsx'));
const PoliticaPrivacidade = React.lazy(() => import('./pages/PoliticaPrivacidade.jsx'));
const Loading = React.lazy(() => import('./pages/Loading.jsx'));

const APP_ROUTES = [
  { path: '/', element: <EstabelecimentosList /> },
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
  { path: '/novo/:estabelecimentoSlug', element: <NovoAgendamento /> },
  { path: '/novo', element: <NovoAgendamento /> },
  { path: '/configuracoes', element: <Configuracoes /> },
  { path: '/loading', element: <Loading /> },
  { path: '/ajuda', element: <Ajuda /> },
  { path: '/relatorios', element: <Relatorios /> },
  { path: '/planos', element: <Planos /> },
  { path: '/contato', element: <Contato /> },
  { path: '/termos', element: <Termos /> },
  { path: '/politica-privacidade', element: <PoliticaPrivacidade /> },
  { path: '/admin-tools', element: <AdminTools /> },
  { path: '/admin/db', element: <AdminDB /> },
  { path: '/admin/billing', element: <AdminBilling /> },
];

const BILLING_ALERT_STATES = new Set(['due_soon', 'overdue', 'blocked']);

function formatBillingDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(value));
  } catch {
    return '';
  }
}

function BillingStatusBanner({ status, user, planInfo }) {
  if (!user || user?.tipo !== 'estabelecimento') return null;

  const trialDaysLeft = (() => {
    if (planInfo?.trialEnd) {
      const diff = new Date(planInfo.trialEnd).getTime() - Date.now();
      return Math.floor(diff / 86400000);
    }
    if (typeof planInfo?.trialDaysLeft === 'number') return planInfo.trialDaysLeft;
    return null;
  })();
  const planStatus = String(planInfo?.status || '').toLowerCase();
  const trialExpired = planStatus === 'trialing' && trialDaysLeft != null && trialDaysLeft < 0;

  const shouldShowBilling = status && BILLING_ALERT_STATES.has(status.state);
  if (!shouldShowBilling && !trialExpired) return null;

  const state = shouldShowBilling ? status.state : null;
  const dueLabel = shouldShowBilling ? formatBillingDate(status?.due_at) : '';
  const graceDeadline = shouldShowBilling ? formatBillingDate(status?.grace_deadline) : '';

  let tone = 'warning';
  let title = '';
  let body = '';
  let ctaLabel = 'Pagar agora';

  if (state === 'due_soon') {
    const daysRaw = Number(status?.days_to_due ?? 0);
    const days = Number.isNaN(daysRaw) ? 0 : Math.max(0, daysRaw);
    const plural = days === 1 ? 'dia' : 'dias';
    const timeLabel = days === 0 ? 'vence hoje' : `vence em ${days} ${plural}`;
    title = `Pagamento ${timeLabel}`;
    body = dueLabel
      ? `Regularize ate ${dueLabel} para manter o acesso.`
      : 'Regularize para manter o acesso.';
  } else if (state === 'overdue') {
    tone = 'warning';
    title = 'Plano em atraso';
    const overdueLabel = dueLabel ? `Venceu em ${dueLabel}.` : 'Seu pagamento venceu.';
    const remainingRaw = Number(status?.grace_days_remaining ?? 0);
    const remaining = Number.isNaN(remainingRaw) ? 0 : Math.max(0, remainingRaw);
    const remainingText = remaining
      ? `Bloqueio em ${remaining} ${remaining === 1 ? 'dia' : 'dias'}${graceDeadline ? ` (ate ${graceDeadline})` : ''}.`
      : 'Atualize para evitar o bloqueio.';
    body = `${overdueLabel} ${remainingText}`.trim();
  } else {
    tone = 'danger';
    title = 'Plano suspenso';
    body = 'O acesso foi bloqueado por falta de pagamento. Pague o PIX para liberar imediatamente.';
    ctaLabel = 'Regularizar agora';
  }

  if (!shouldShowBilling && trialExpired) {
    tone = 'warning';
    title = 'Teste gratuito encerrado';
    body = 'Escolha um plano para continuar usando a plataforma sem interrupções.';
    ctaLabel = 'Ver planos';
  }

  return (
    <div className={`billing-banner billing-banner--${tone}`}>
      <div className="billing-banner__inner">
        <div className="billing-banner__copy">
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <NavLink to="/configuracoes" className="btn btn--sm btn--primary">{ctaLabel}</NavLink>
      </div>
    </div>
  );
}

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
    toggleTheme,
  };
}

function Sidebar({ open, user }) {
  const nav = useNavigate();
  const resolvedUser = user ?? getUser();
  const navigation = useMemo(() => buildNavigation(resolvedUser), [resolvedUser]);

  const [scrolled, setScrolled] = useState(false);
  const [el, setEl] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

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
    <aside className={`sidebar ${resolvedUser?.tipo === 'estabelecimento' ? 'sidebar--estab' : ''} ${scrolled ? 'is-scrolled' : ''}`} ref={setEl}>
      <div className="sidebar__inner">
        <nav id="mainnav" className="mainnav mainnav--vertical">
          {!navigation.isAuthenticated ? (
            <div className="sidelist">
              {navigation.sections.map((section) => (
                <div key={section.key} className="sidelist__section">
                  {section.items.map((item) => (
                    <NavLink key={item.key} to={item.to} className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}>
                      <item.icon className="sidelist__icon" aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              ))}
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
              <div className="sidelist">
                {navigation.sections.map((section) => (
                  <div key={section.key} className="sidelist__section">
                    {section.heading && <div className="sidelist__heading">{section.heading}</div>}
                    {section.items.map((item) => {
                      if (item.type === 'action') {
                        return (
                          <button
                            key={item.key}
                            type="button"
                            className="sidelist__item sidelist__item--danger"
                            onClick={() => setLogoutOpen(true)}
                          >
                            <item.icon className="sidelist__icon" aria-hidden="true" />
                            <span>{item.label}</span>
                          </button>
                        );
                      }
                      return (
                        <NavLink
                          key={item.key}
                          to={item.to}
                          className={({ isActive }) => `sidelist__item${isActive ? ' active' : ''}`}
                        >
                          <item.icon className="sidelist__icon" aria-hidden="true" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                ))}
              </div>
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
            </>
          )}
        </nav>
      </div>
    </aside>
  );
}

export default function App() {
  const loc = useLocation();
  const isNovo = (loc?.pathname || '').startsWith('/novo');
  const [currentUser, setCurrentUser] = useState(() => getUser());
  const [billingStatus, setBillingStatus] = useState(null);
  const { preferences, isDark, toggleTheme } = useAppPreferences();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [planBarInfo, setPlanBarInfo] = useState({ plan: '', status: '', trialEnd: null, trialDaysLeft: null });
  const isPlanos = (loc?.pathname || '') === '/planos';
  const hideShell = false;
  const topbarRef = useRef(null);

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
    const loadPlanInfo = () => {
      try {
        const plan = localStorage.getItem('plan_current') || '';
        const status = localStorage.getItem('plan_status') || '';
        const trialEnd = localStorage.getItem('trial_end');
        const trialDaysLeft = trialEnd
          ? Math.floor((new Date(trialEnd).getTime() - Date.now()) / 86400000)
          : null;
        setPlanBarInfo({ plan, status, trialEnd, trialDaysLeft });
      } catch {
        setPlanBarInfo({ plan: '', status: '', trialEnd: null, trialDaysLeft: null });
      }
    };

    loadPlanInfo();

    const handleStorage = (event) => {
      if (!event?.key) return;
      if (['plan_current', 'plan_status', 'trial_end'].includes(event.key)) loadPlanInfo();
    };
    window.addEventListener('storage', handleStorage);

    return () => window.removeEventListener('storage', handleStorage);
  }, [currentUser?.id]);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const fetchStatus = async () => {
      if (!currentUser || currentUser.tipo !== 'estabelecimento') return;
      try {
        const data = await Api.billingStatus();
        if (!cancelled) setBillingStatus(data);
      } catch (err) {
        if (!cancelled) {
          // Falha silenciosa: mantem ultimo status conhecido ou zera
          setBillingStatus((prev) => (prev && prev.state ? prev : null));
        }
      }
    };

    if (!currentUser || currentUser.tipo !== 'estabelecimento') {
      setBillingStatus(null);
      return () => {};
    }

    fetchStatus();
    timerId = setInterval(fetchStatus, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
  }, [currentUser?.id, currentUser?.tipo]);

  useEffect(() => {
    try {
      if (window.matchMedia('(max-width: 780px)').matches) setSidebarOpen(false);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isPlanos) return undefined;

    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return undefined;

    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');

    return () => {
      if (preferences?.theme) {
        applyThemePreference(preferences.theme);
      } else if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        root.removeAttribute('data-theme');
      }
    };
  }, [isPlanos, preferences?.theme]);

  const trialDaysLeft = useMemo(() => {
    if (planBarInfo.trialEnd) {
      const diff = new Date(planBarInfo.trialEnd).getTime() - Date.now();
      return Math.floor(diff / 86400000);
    }
    if (typeof planBarInfo.trialDaysLeft === 'number') return planBarInfo.trialDaysLeft;
    return null;
  }, [planBarInfo.trialDaysLeft, planBarInfo.trialEnd]);

  const planStatus = String(planBarInfo.status || '').toLowerCase();
  const trialExpired = planStatus === 'trialing' && trialDaysLeft != null && trialDaysLeft < 0;
  const trialEndingSoon =
    planStatus === 'trialing' && trialDaysLeft != null && trialDaysLeft >= 0 && trialDaysLeft <= 3;

const topbarAlert = useMemo(() => {
    if (!currentUser || currentUser.tipo !== 'estabelecimento') return null;
    // Trial expirado já é exibido no banner fixo abaixo da topbar (BillingStatusBanner)
    if (trialExpired) return null;

    // Atraso de mensalidade: alerta rápido na topbar
    const billingState = String(billingStatus?.state || '').toLowerCase();
    if (billingState === 'blocked') {
      return {
        variant: 'danger',
        message: 'Plano suspenso por falta de pagamento. Regularize para liberar o acesso.',
      };
    }
    if (billingState === 'overdue') {
      const dueLabel = formatBillingDate(billingStatus?.due_at);
      const remainingRaw = Number(billingStatus?.grace_days_remaining ?? 0);
      const remaining = Number.isNaN(remainingRaw) ? 0 : Math.max(0, remainingRaw);
      const suffix = remaining ? ` Bloqueio em ${remaining} ${remaining === 1 ? 'dia' : 'dias'}.` : '';
      return {
        variant: 'warning',
        message: `Pagamento em atraso${dueLabel ? ` (venc. ${dueLabel})` : ''}.${suffix}`,
      };
    }

    if (trialEndingSoon) {
      const label =
        trialDaysLeft === 0
          ? 'termina hoje'
          : trialDaysLeft === 1
          ? 'termina em 1 dia'
          : `termina em ${trialDaysLeft} dias`;
      return {
        variant: 'warning',
        message: `Seu teste gratuito ${label}. Assine agora para não perder o acesso.`,
      };
    }
    return null;
  }, [currentUser, trialEndingSoon, trialExpired, trialDaysLeft, billingStatus]);

  const updateTopbarHeight = useCallback(() => {
    const el = topbarRef.current;
    if (!el || typeof document === 'undefined') return;
    const h = el.offsetHeight || 0;
    if (h > 0) {
      document.documentElement.style.setProperty('--topbar-current-h', `${h}px`);
    }
  }, []);

  useEffect(() => {
    updateTopbarHeight();
    const handleResize = () => updateTopbarHeight();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      try {
        document.documentElement.style.removeProperty('--topbar-current-h');
      } catch {}
    };
  }, [updateTopbarHeight]);

  useEffect(() => {
    updateTopbarHeight();
  }, [topbarAlert, sidebarOpen, updateTopbarHeight]);

  return (
    <>
      <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'is-collapsed'}`}>
        {!hideShell && <Sidebar open={sidebarOpen} user={currentUser} />}
        {!hideShell && (
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
          <div className="app-topbar" ref={topbarRef}>
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
                  className={`theme-toggle${isPlanos ? ' is-disabled' : ''}`}
                  onClick={isPlanos ? undefined : toggleTheme}
                  disabled={isPlanos}
                  aria-label={isPlanos ? 'Tema fixo no modo escuro' : `Ativar tema ${isDark ? 'claro' : 'escuro'}`}
                  title={isPlanos ? 'Tema fixo no modo escuro' : isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
                >
                  {(isPlanos || !isDark) ? <IconMoon aria-hidden="true" /> : <IconSun aria-hidden="true" />}
                </button>
              </div>
            </div>
            {topbarAlert && (
              <div className={`app-topbar__alert app-topbar__alert--${topbarAlert.variant}`}>
                <span>{topbarAlert.message}</span>
                <NavLink className="btn btn--primary btn--sm" to="/configuracoes">
                  Ver planos
                </NavLink>
              </div>
            )}
          </div>
          <BillingStatusBanner status={billingStatus} user={currentUser} planInfo={planBarInfo} />
          <div className="container">
            <Suspense
              fallback={
                <div className="card" role="status" aria-live="polite">
                  <span className="spinner" /> Carregando...
                </div>
              }
            >
              <Routes>
                {APP_ROUTES.map(({ path, element }) => (
                  <Route key={path} path={path} element={element} />
                ))}
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
      {!hideShell && <MobileNavBar user={currentUser} />}
    </>
  );
}
