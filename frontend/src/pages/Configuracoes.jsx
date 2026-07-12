// src/pages/Configuracoes.jsx
// Página de Configurações: um accordion de tópicos, cada um com seu próprio salvar.
// Toda a lógica de formulário vive nos componentes de components/settings/ — aqui só ficam
// a casca (hero + accordion) e o deep-link por seção (usado pela página de Ajuda).
//
// Nota: este arquivo era um artefato minificado de ~7k linhas. Depois que os tópicos viraram
// componentes próprios, todo o resto virou código morto e foi removido. Plano, Sinal, Mercado
// Pago e WhatsApp saíram daqui — têm páginas próprias no menu lateral.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconChevronRight } from '../components/Icons.jsx';
import { getUser } from '../utils/auth';

import AccountProfileSection from '../components/settings/AccountProfileSection.jsx';
import PhotosSection from '../components/settings/PhotosSection.jsx';
import PublicLinkSection from '../components/settings/PublicLinkSection.jsx';
import DescriptionSection from '../components/settings/DescriptionSection.jsx';
import VisualIdentitySection from '../components/settings/VisualIdentitySection.jsx';
import AddressSection from '../components/settings/AddressSection.jsx';
import WorkingHoursSection from '../components/settings/WorkingHoursSection.jsx';
import NotificationsSection from '../components/settings/NotificationsSection.jsx';
import SocialLinksSection from '../components/settings/SocialLinksSection.jsx';
import SecuritySection from '../components/settings/SecuritySection.jsx';

function AjudaSection() {
  return (
    <>
      <p className="muted">Tire dúvidas, veja perguntas frequentes e formas de contato.</p>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
      </div>
    </>
  );
}

export default function Configuracoes() {
  const location = useLocation();
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';

  const sections = useMemo(() => {
    const list = [{ id: 'profile', title: 'Perfil', content: <AccountProfileSection /> }];

    if (isEstab) {
      list.push(
        { id: 'photos', title: 'Minhas fotos', content: <PhotosSection /> },
        { id: 'public-link', title: 'Link da página', content: <PublicLinkSection /> },
        { id: 'description', title: 'Descrição', content: <DescriptionSection /> },
        { id: 'visual-identity', title: 'Identidade visual', content: <VisualIdentitySection /> },
        { id: 'address', title: 'Endereço', content: <AddressSection /> },
        { id: 'working-hours', title: 'Horários de funcionamento', content: <WorkingHoursSection /> },
        { id: 'notifications', title: 'Notificações', content: <NotificationsSection /> },
        { id: 'social-links', title: 'Redes sociais', content: <SocialLinksSection /> },
      );
    }

    list.push({ id: 'security', title: 'Alterar senha', content: <SecuritySection /> });
    list.push({ id: 'support', title: 'Ajuda', content: <AjudaSection /> });

    return list;
  }, [isEstab]);

  const [openMap, setOpenMap] = useState({});
  const [highlighted, setHighlighted] = useState(null);
  const sectionRefs = useRef({});

  const toggle = useCallback((id) => {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Deep-link: navegar para /configuracoes com state.focusSection abre, rola até e destaca o tópico.
  const focusSection = location.state?.focusSection;
  useEffect(() => {
    if (!focusSection) return undefined;
    if (!sections.some((s) => s.id === focusSection)) return undefined;

    setOpenMap((prev) => ({ ...prev, [focusSection]: true }));
    setHighlighted(focusSection);

    const el = sectionRefs.current[focusSection];
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const timer = setTimeout(() => setHighlighted(null), 2400);
    return () => clearTimeout(timer);
  }, [focusSection, sections]);

  return (
    <div className="grid config-page" style={{ gap: 12 }}>
      <div className="card config-page__hero">
        <h2 style={{ marginTop: 0 }}>Configurações</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Gerencie sua conta e as informações da sua página pública.
        </p>
      </div>

      {sections.map(({ id, title, content }) => {
        const isOpen = Boolean(openMap[id]);
        return (
          <div
            key={id}
            className={`card config-section${highlighted === id ? ' config-section--highlight' : ''}`}
            ref={(el) => {
              if (el) sectionRefs.current[id] = el;
              else delete sectionRefs.current[id];
            }}
          >
            <button
              type="button"
              className={`config-section__toggle${isOpen ? ' is-open' : ''}`}
              onClick={() => toggle(id)}
              aria-expanded={isOpen}
            >
              <span className="config-section__title">{title}</span>
              <IconChevronRight className="config-section__icon" aria-hidden="true" />
            </button>

            {isOpen && <div className="config-section__content">{content}</div>}
          </div>
        );
      })}
    </div>
  );
}
