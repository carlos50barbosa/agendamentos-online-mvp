// src/pages/LandingPublica.jsx
//
// Landing "/" — página de venda do produto, para o DONO do estabelecimento.
//
// Por que ela deixou de ser a busca do consumidor (02/08/2026): quem paga o SaaS é o
// estabelecimento, e é com ele que todo o material de anúncio fala — os criativos levam
// agenda0.com.br assinado. Uma "/" que abre com busca de salão manda o dono para o fluxo
// do consumidor e não vende nada. A busca continua inteira em /novo, alcançável pelo topo
// e pelo rodapé; ela só deixou de ser o herói.
//
// Regras que esta página herda e não deve quebrar:
//  - PREÇO SEMPRE DO CATÁLOGO (Api.plansCatalog). Um valor hardcoded aqui divergiria da
//    tabela do backend no dia em que ela mudar — a mesma regra que Planos.jsx segue.
//  - O trial é do PRO (é onde está o sinal). O caminho do CTA é o mesmo de Planos.jsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconArrowRight, IconScissors } from '../components/Icons.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import LogoAO from '../components/LogoAO.jsx';
import { getLegalEntityLine } from '../utils/legal.js';
import styles from './LandingPublica.module.css';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => BRL.format((Number(cents) || 0) / 100);

const STEPS = [
  {
    title: 'Cadastre seus serviços',
    text: 'Nome, duração e preço. Seus horários de atendimento entram junto.',
  },
  {
    title: 'Compartilhe seu link',
    text: 'No Instagram, no WhatsApp, onde o cliente já procura você.',
  },
  {
    title: 'Receba os agendamentos',
    text: 'Eles caem direto na sua agenda, com lembrete automático.',
  },
];

// O que o plano de entrada já entrega (backend/src/lib/plans.js). Nada aqui pode
// prometer recurso de plano superior — o sinal via PIX, por exemplo, é do Pro.
const INCLUDES = [
  'Agendamentos e serviços ilimitados',
  'Link próprio para o cliente marcar sozinho',
  'Lembretes automáticos',
];

/** Fragmento da tela real de agendamento. Decorativo — a prova de que isto é um app. */
function AppMock() {
  return (
    <div className={styles.mock} aria-hidden="true">
      <div className={styles.mockScreen}>
        <div className={styles.mockHead}>
          <span className={styles.mockAvatar}>SB</span>
          <div className={styles.mockHeadText}>
            <strong>Studio Bella</strong>
            <span>agenda0.com.br/studiobella</span>
          </div>
        </div>

        <div className={styles.mockService}>
          <span className={styles.mockServiceIcon}>
            <IconScissors width={16} height={16} />
          </span>
          <div className={styles.mockServiceText}>
            <strong>Escova + hidratação</strong>
            <span>1h · R$ 120</span>
          </div>
        </div>

        <span className={styles.mockLabel}>Escolha o horário</span>

        <div className={styles.mockDays}>
          {[['qui', '6'], ['sex', '7'], ['sáb', '8'], ['dom', '9']].map(([weekday, day], index) => (
            <span key={weekday} className={index === 2 ? styles.mockDayOn : styles.mockDay}>
              <small>{weekday}</small>
              <strong>{day}</strong>
            </span>
          ))}
        </div>

        <div className={styles.mockSlots}>
          <span className={styles.mockSlot}>08:00</span>
          <span className={styles.mockSlotOff}>08:30</span>
          <span className={styles.mockSlot}>09:00</span>
          <span className={styles.mockSlotOn}>10:00</span>
          <span className={styles.mockSlot}>10:30</span>
          <span className={styles.mockSlotOff}>11:00</span>
        </div>

        <span className={styles.mockCta}>Confirmar agendamento</span>
      </div>
    </div>
  );
}

export default function LandingPublica() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const user = useMemo(() => getUser(), []);

  const year = new Date().getFullYear();
  const role = String(user?.tipo || '').toLowerCase();
  const isEstab = role === 'estabelecimento';
  const isCliente = role === 'cliente';

  useEffect(() => {
    let active = true;
    Api.plansCatalog()
      .then((data) => { if (active) setCatalog(data); })
      .catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, []);

  const trialDays = catalog?.trial_days ?? 7;

  // Menor preço do catálogo. Sem fallback: se o catálogo não veio, a página não cita preço —
  // um número escrito à mão aqui é um número que um dia vai mentir.
  const cheapest = useMemo(() => {
    const plans = Array.isArray(catalog?.plans) ? catalog.plans : [];
    if (!plans.length) return null;
    return plans.reduce((min, plan) => (
      Number(plan?.price_cents) < Number(min?.price_cents) ? plan : min
    ), plans[0]);
  }, [catalog]);

  // Mesma máquina de /planos (goTrial): o cadastro lê ?trial_plan= e /assinatura lê intent_kind.
  // O trial é do Pro — é o plano que tem o sinal via PIX, que é o argumento de venda.
  const startTrial = useCallback(() => {
    try {
      localStorage.removeItem('intent_plano');
      localStorage.removeItem('intent_plano_ciclo');
      localStorage.setItem('intent_kind', 'trial');
    } catch {}
    navigate(`/cadastro?trial_plan=pro&next=${encodeURIComponent('/estab?trial=sucesso')}&tipo=estabelecimento`);
  }, [navigate]);

  const primaryCta = useMemo(() => {
    if (isEstab) return { label: 'Ir para minha agenda', action: () => navigate('/estab') };
    if (isCliente) return { label: 'Meus agendamentos', action: () => navigate('/cliente') };
    return { label: `Testar ${trialDays} dias grátis`, action: startTrial };
  }, [isEstab, isCliente, navigate, startTrial, trialDays]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand} aria-label="Agendamentos Online">
            <LogoAO size={34} title="" />
            <span className={styles.brandName}>
              Agendamentos
              <small>Online</small>
            </span>
          </Link>
          <div className={styles.headerActions}>
            {user ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={primaryCta.action}>
                {isEstab ? 'Minha agenda' : 'Meus agendamentos'}
              </button>
            ) : (
              <>
                <Link to="/login" className="btn btn--outline btn--sm">Entrar</Link>
                <Link to="/cadastro?tipo=estabelecimento" className="btn btn--primary btn--sm">Criar conta</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>
              Sua agenda online, <em>aberta 24 horas</em>.
            </h1>
            <p className={styles.heroSub}>
              O cliente escolhe o serviço e o horário sozinho, pelo seu link. Você para de
              responder mensagem só para marcar.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className="btn btn--primary btn--lg" onClick={primaryCta.action}>
                {primaryCta.label}
              </button>
              <Link to="/planos" className="btn btn--outline btn--lg">Ver planos</Link>
            </div>
            {!user && (
              <p className={styles.heroNote}>
                Sem cartão de crédito
                {cheapest ? ` · a partir de ${money(cheapest.price_cents)}/mês` : ''}
              </p>
            )}
          </div>
          <AppMock />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Como funciona</h2>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNum}>{index + 1}</span>
                <div>
                  <strong className={styles.stepTitle}>{step.title}</strong>
                  <p className={styles.stepText}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Quanto custa</h2>
          <div className={styles.price}>
            <div className={styles.priceHead}>
              {cheapest ? (
                <p className={styles.priceValue}>
                  <small>a partir de</small>
                  <strong>{money(cheapest.price_cents)}</strong>
                  <span>/mês</span>
                </p>
              ) : (
                <p className={styles.priceValue}>
                  <strong>Planos mensais</strong>
                </p>
              )}
              <Link to="/planos" className={styles.priceLink}>
                Comparar planos
                <IconArrowRight width={16} height={16} aria-hidden="true" />
              </Link>
            </div>
            <ul className={styles.priceList}>
              {INCLUDES.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </main>

      {/* Sem caminho para o consumidor aqui: o diretório público foi fechado em 02/08/2026
          (só se agenda pelo link do próprio estabelecimento). Prometer "encontre um
          estabelecimento" levaria a uma tela que não existe mais. */}
      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <Link to="/planos">Planos</Link>
          <Link to="/ajuda">Ajuda</Link>
          <Link to="/termos">Termos</Link>
          <Link to="/politica-privacidade">Privacidade</Link>
        </div>
        <p className={styles.footerCopy}>© {year} Agendamentos Online</p>
        <p className={styles.footerLegal}>{getLegalEntityLine()}</p>
      </footer>
    </div>
  );
}
