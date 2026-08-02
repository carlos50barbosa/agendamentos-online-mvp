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
    text: 'No Instagram, no WhatsApp, onde o cliente já procura você — e pare de marcar por mensagem.',
  },
  {
    title: 'Receba com o sinal pago',
    text: 'O agendamento cai na sua agenda já com a entrada no PIX, e o lembrete sai sozinho.',
  },
];

const limite = (valor, singular, plural) => (
  valor == null ? `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados` : `Até ${valor} ${valor === 1 ? singular : plural}`
);

/** Mesma formatação de /planos: número separado por milhar, para 1.500 não virar "1500". */
const mensagens = (total) => `${Number(total || 0).toLocaleString('pt-BR')} mensagens de WhatsApp/mês`;

/**
 * O que cada plano mostra na vitrine, DERIVADO do catálogo — nunca escrito à mão.
 * Mesma regra de Planos.jsx: mexer num limite no backend atualiza esta página sozinho;
 * uma cópia local divergiria da tabela que o backend aplica e a vitrine passaria a
 * prometer o que o produto nega.
 *
 * A franquia de WhatsApp ENTRA (02/08/2026). Ela tinha ficado de fora por confundir duas
 * coisas: "lembrete no WhatsApp" é promessa de ENTREGA, e essa depende do opt-in do cliente
 * final — é a regra que o criativo do Starter respeita. Já "250 mensagens por mês" é atributo
 * do plano, e é verdade. Além disso é a franquia que separa os planos de fato: escondê-la
 * fazia o Pro parecer mais magro do que é, e contradizia o /planos, que sempre a anunciou.
 * A nota abaixo dos cards diz o que acontece quando ela acaba — é o que a mantém honesta.
 */
function bulletsDoPlano(plan, anterior) {
  if (!anterior) {
    // O sinal sai do catálogo AQUI também, não só na diferença entre planos. Enquanto ele for
    // exclusivo de um plano superior, aparecer como ganho de upgrade basta; no dia em que
    // entrar no plano de entrada, a diferença vira zero e ele some dos três cards de uma vez —
    // a landing venderia o sinal na headline sem listá-lo em plano nenhum. Aconteceu em
    // 02/08/2026, nas duas direções, no mesmo dia: não presuma qual plano tem o quê.
    return [
      ...(plan.allow_deposit ? ['Sinal no PIX ao agendar — abatido no serviço'] : []),
      ...(plan.allow_loyalty ? ['Planos de assinatura para os seus clientes'] : []),
      'Agendamentos e serviços ilimitados',
      'Link próprio para o cliente marcar sozinho',
      limite(plan.max_professionals, 'profissional', 'profissionais'),
      `Lembretes automáticos · ${mensagens(plan.whatsapp_included_messages)}`,
    ];
  }
  const ganhos = [];
  // O sinal é o argumento de venda da casa: quando ele entra, entra em primeiro.
  if (plan.allow_deposit && !anterior.allow_deposit) {
    ganhos.push('Sinal no PIX ao agendar — abatido no serviço');
  }
  if (plan.allow_loyalty && !anterior.allow_loyalty) {
    ganhos.push('Planos de assinatura para os seus clientes');
  }
  if (plan.allow_advanced_reports && !anterior.allow_advanced_reports) {
    ganhos.push('Relatórios avançados');
  }
  if (plan.max_professionals !== anterior.max_professionals) {
    ganhos.push(limite(plan.max_professionals, 'profissional', 'profissionais'));
  }
  if (Number(plan.whatsapp_included_messages) > Number(anterior.whatsapp_included_messages)) {
    ganhos.push(mensagens(plan.whatsapp_included_messages));
  }
  if (plan.max_gallery_images == null && anterior.max_gallery_images != null) {
    ganhos.push('Galeria de fotos ilimitada');
  }
  return ganhos;
}

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

        {/* O sinal aparece como UMA linha do resumo, do tamanho da data — é um item do
            checkout, não um recebimento. Ampliar isto aqui repete o erro dos criativos
            antigos, em que o valor virava o herói e a peça lia como comprovante de PIX. */}
        <div className={styles.mockResumo}>
          <div className={styles.mockResumoRow}>
            <span>Sábado, 8 de agosto</span>
            <strong>10:00</strong>
          </div>
          <div className={styles.mockResumoRow}>
            <span>Sinal (PIX)</span>
            <strong>R$ 40,00</strong>
          </div>
          <span className={styles.mockResumoHint}>Abatido no valor do serviço</span>
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

  // Catálogo em ordem de preço, cada plano já com os bullets derivados do anterior.
  // Sem fallback: se o catálogo não veio, a seção de preço não aparece — um número
  // escrito à mão aqui é um número que um dia vai mentir.
  const planos = useMemo(() => {
    const lista = Array.isArray(catalog?.plans) ? [...catalog.plans] : [];
    lista.sort((a, b) => Number(a?.price_cents) - Number(b?.price_cents));
    return lista.map((plan, index) => ({
      ...plan,
      anterior: lista[index - 1] || null,
      bullets: bulletsDoPlano(plan, lista[index - 1] || null),
    }));
  }, [catalog]);

  const cheapest = planos[0] || null;
  // O Pro é o plano do trial e o primeiro com sinal — é ele que a vitrine destaca.
  const planoDoTrial = useMemo(
    () => planos.find((plan) => plan.code === 'pro') || null,
    [planos],
  );

  // Mesma máquina de /planos (goTrial): o cadastro lê ?trial_plan= e /assinatura lê intent_kind.
  // O trial é do Pro — é o plano que tem o sinal via PIX, que é o argumento de venda. Por isso
  // a nota do hero diz "grátis no Pro": a headline promete o sinal, e ele não está no Starter.
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
            {/* O sinal entra aqui porque é o diferencial da casa — mas subordinado à
                categoria, nunca antes dela. A ordem "agenda primeiro, sinal depois" é a
                mesma dos criativos, e é o que evita a leitura de "plataforma que dá PIX". */}
            <p className={styles.heroSub}>
              O cliente escolhe o serviço e o horário sozinho, pelo seu link — e deixa
              o sinal no PIX ao confirmar. Se furar, o sinal fica com você.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className="btn btn--primary btn--lg" onClick={primaryCta.action}>
                {primaryCta.label}
              </button>
              <Link to="/planos" className="btn btn--outline btn--lg">Ver planos</Link>
            </div>
            {!user && (
              // Diz QUAL plano é o teste. O sinal está na headline e é recurso do Pro:
              // sem esta linha, o "a partir de R$ 14,90" ao lado sugeriria que o sinal
              // vem no plano de entrada — e vem no Pro.
              <p className={styles.heroNote}>
                {trialDays} dias grátis no {planoDoTrial?.label || 'Pro'} · sem cartão de crédito
                {cheapest ? ` · planos a partir de ${money(cheapest.price_cents)}/mês` : ''}
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

        {/* A seção some inteira se o catálogo não veio: melhor não falar de preço do que
            falar um preço inventado. */}
        {planos.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Quanto custa</h2>
            <div className={styles.planos}>
              {planos.map((plan) => {
                const destaque = plan.code === 'pro';
                return (
                  <article
                    key={plan.code}
                    className={destaque ? styles.planoDestaque : styles.plano}
                  >
                    <div className={styles.planoTopo}>
                      <span className={styles.planoNome}>{plan.label}</span>
                      {destaque && <span className={styles.planoTag}>{trialDays} dias grátis</span>}
                    </div>
                    <p className={styles.planoPreco}>
                      <strong>{money(plan.price_cents)}</strong>
                      <span>/mês</span>
                    </p>
                    <ul className={styles.planoLista}>
                      {plan.anterior && (
                        <li className={styles.planoHeranca}>Tudo do {plan.anterior.label}, mais:</li>
                      )}
                      {plan.bullets.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    {destaque && !user ? (
                      <button type="button" className="btn btn--primary" onClick={startTrial}>
                        Testar {trialDays} dias grátis
                      </button>
                    ) : (
                      <Link to="/planos" className="btn btn--outline">
                        {user ? 'Ver detalhes' : `Assinar ${plan.label}`}
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
            {/* O que acontece quando a franquia acaba. Sem esta linha, "250 mensagens" vira
                promessa de canal — e o envio depende do opt-in do cliente final. Mesma nota
                que /planos já traz embaixo dos cards. */}
            <p className={styles.planosNota}>
              Cada agendamento usa até {planos[0]?.whatsapp_max_per_appointment || 5} mensagens
              (confirmação + lembretes). A franquia renova todo mês; se acabar, os avisos continuam
              por e-mail e no painel.
            </p>
            <Link to="/planos" className={styles.planosLink}>
              Comparar todos os recursos
              <IconArrowRight width={16} height={16} aria-hidden="true" />
            </Link>
          </section>
        )}
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
