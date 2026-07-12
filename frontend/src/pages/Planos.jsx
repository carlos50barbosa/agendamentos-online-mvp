// src/pages/Planos.jsx
//
// Landing pública de planos. Dois públicos, e eles querem coisas opostas:
//  - o PROSPECT precisa ser convencido;
//  - o CLIENTE LOGADO que bateu num limite já está convencido — ele quer uma frase e um botão.
// Por isso o topo troca: logado vê uma faixa de upgrade (plano atual → o que ganha → CTA), e
// a landing continua embaixo, inteira.
//
// Preço e limite vêm do catálogo do backend (plans.js). Uma cópia hardcoded aqui divergiria
// do que o backend aplica, e a vitrine passaria a prometer o que o produto nega.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { getUser } from '../utils/auth';
import { Api } from '../utils/api';

const PlanosLowerExtras = React.lazy(() => import('./PlanosLowerExtras.jsx'));

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => BRL.format((Number(cents) || 0) / 100);

const CYCLES = [
  { key: 'mensal', label: 'Mensal' },
  { key: 'anual', label: 'Anual' },
];

const SUBTITLES = {
  starter: 'Para começar online',
  pro: 'Para quem quer parar de perder dinheiro',
  premium: 'Para operações maiores',
};

// Por que a pessoa foi parar aqui. Chega pela URL (?motivo=) a partir dos bloqueios da app —
// quem foi barrado por um recurso específico merece que a página responda AQUILO, não um hero.
const REASONS = {
  profissionais: 'Você atingiu o limite de profissionais do seu plano.',
  relatorios: 'Os relatórios avançados são do plano Pro.',
  sinal: 'O sinal via PIX é do plano Pro.',
  galeria: 'Você atingiu o limite de fotos da galeria.',
  whatsapp: 'Sua franquia de mensagens do WhatsApp acabou.',
};

const UNLIMITED = 'ilimitado';
const limitText = (value, singular, plural) => (
  value == null ? `${plural} ilimitados` : `${value} ${value === 1 ? singular : plural}`
);

// O que você ganha ao subir de plano — calculado a partir do catálogo, não escrito à mão.
// Assim, mexer num limite no backend atualiza a página sozinho.
function planGains(from, to) {
  if (!from || !to) return [];
  const gains = [];

  if (!from.allow_deposit && to.allow_deposit) {
    gains.push('Sinal via PIX — o cliente paga uma parte ao marcar');
  }
  if (!from.allow_advanced_reports && to.allow_advanced_reports) {
    gains.push('Relatórios avançados, com filtros e comparativo');
  }
  if (to.max_professionals == null && from.max_professionals != null) {
    gains.push('Profissionais ilimitados');
  } else if (to.max_professionals > from.max_professionals) {
    gains.push(`${to.max_professionals} profissionais (hoje ${from.max_professionals})`);
  }
  if (to.whatsapp_included_messages > from.whatsapp_included_messages) {
    gains.push(`${to.whatsapp_included_messages.toLocaleString('pt-BR')} mensagens de WhatsApp por mês (hoje ${from.whatsapp_included_messages.toLocaleString('pt-BR')})`);
  }
  if (to.max_gallery_images == null && from.max_gallery_images != null) {
    gains.push('Galeria de fotos sem limite');
  } else if (to.max_gallery_images > from.max_gallery_images) {
    gains.push(`${to.max_gallery_images} fotos na galeria (hoje ${from.max_gallery_images})`);
  }

  return gains;
}

const PROOFS = [
  {
    title: 'O cliente paga um sinal para marcar',
    text: 'Uma parte do valor entra no PIX na hora do agendamento. Se a pessoa não aparecer, o dinheiro fica com você.',
  },
  {
    title: 'A confirmação sai sem você digitar',
    text: 'Confirmação e lembrete vão automáticos no WhatsApp. Você para de responder "tem horário?" o dia inteiro.',
  },
  {
    title: 'Você descobre quem sumiu',
    text: 'A lista de clientes separa quem não aparece há 45 dias — e manda mensagem para todos de uma vez.',
  },
];

const INCLUDED = [
  'Agendamentos e serviços ilimitados, em todos os planos',
  'Página pública com link próprio para divulgar',
  'Confirmação e lembrete automáticos',
  'Cadastro de clientes com segmentos, quem sumiu e exportação',
  'Agenda no celular, no tablet e no computador',
  'Relatórios do dia a dia e controle de status',
  'Pacotes extras de WhatsApp por PIX, quando precisar',
];

export default function Planos() {
  const user = getUser();
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [cycle, setCycle] = useState('mensal');
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [billingStatus, setBillingStatus] = useState(null);

  const isEstab = user?.tipo === 'estabelecimento';
  const motivo = searchParams.get('motivo') || '';

  useEffect(() => {
    let active = true;
    Api.plansCatalog()
      .then((data) => { if (active) setCatalog(data || null); })
      .catch((err) => { if (active) setCatalogError(err?.message || 'Não foi possível carregar os planos.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isEstab || !user?.id) {
      setBillingStatus(null);
      return undefined;
    }
    let active = true;
    Api.billingStatus()
      .then((data) => { if (active) setBillingStatus(data); })
      .catch(() => { if (active) setBillingStatus(null); });
    return () => { active = false; };
  }, [isEstab, user?.id]);

  const plans = useMemo(() => (Array.isArray(catalog?.plans) ? catalog.plans : []), [catalog]);
  const trialDays = catalog?.trial_days ?? 7;

  const currentPlanKey = String(billingStatus?.subscription?.plan || '').toLowerCase();
  const currentPlan = plans.find((plan) => plan.code === currentPlanKey) || null;
  const nextPlan = useMemo(() => {
    if (!currentPlan) return null;
    const index = plans.findIndex((plan) => plan.code === currentPlan.code);
    return index >= 0 ? plans[index + 1] || null : null;
  }, [plans, currentPlan]);
  const gains = useMemo(() => planGains(currentPlan, nextPlan), [currentPlan, nextPlan]);

  const trialInfo = billingStatus?.trial || {};
  const trialAvailable = !isEstab || (!trialInfo.wasUsed && !trialInfo.isExpired);

  // ---- Checkout: a máquina existente. Os intents no localStorage são lidos por /assinatura.
  const goCheckout = (plano, ciclo) => {
    try {
      localStorage.setItem('intent_kind', 'checkout');
      localStorage.setItem('intent_plano', plano);
      localStorage.setItem('intent_plano_ciclo', ciclo);
    } catch {}
    const current = getUser();
    if (current?.tipo === 'estabelecimento') nav('/assinatura');
    else nav('/cadastro?next=/assinatura&tipo=estabelecimento');
  };

  const goTrial = (plano, ciclo) => {
    const current = getUser();
    try {
      if (current?.tipo === 'estabelecimento') {
        localStorage.setItem('intent_plano', plano);
        localStorage.setItem('intent_plano_ciclo', ciclo);
      } else {
        localStorage.removeItem('intent_plano');
        localStorage.removeItem('intent_plano_ciclo');
      }
      localStorage.setItem('intent_kind', 'trial');
    } catch {}
    if (current?.tipo === 'estabelecimento') nav('/assinatura');
    else nav(`/cadastro?trial_plan=${encodeURIComponent(plano)}&next=${encodeURIComponent('/estab?trial=sucesso')}&tipo=estabelecimento`);
  };

  const scrollToPlans = () => {
    document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (location.hash === '#planos') scrollToPlans();
  }, [location.hash]);

  const ctaFor = (plan) => {
    // O Pro é o plano do trial: é onde está o sinal, que é o argumento.
    if (plan.code === 'pro' && trialAvailable) {
      return { label: `Testar ${trialDays} dias grátis`, action: () => goTrial('pro', cycle), primary: true };
    }
    if (currentPlan?.code === plan.code) {
      return { label: 'Seu plano atual', action: null, primary: false };
    }
    return { label: `Assinar ${plan.label}`, action: () => goCheckout(plan.code, cycle), primary: plan.code === 'pro' };
  };

  const priceOf = (plan) => (cycle === 'anual' ? plan.annual_price_cents : plan.price_cents);
  const periodOf = () => (cycle === 'anual' ? '/ano' : '/mês');

  return (
    <div className="lp">
      {/* ---- Topo: faixa de upgrade (logado) OU hero (visitante) ------------- */}
      {currentPlan && nextPlan ? (
        <section className="lp-upgrade">
          <div className="lp-shell lp-upgrade__inner">
            <div>
              {motivo && REASONS[motivo] && (
                <p className="lp-upgrade__reason">{REASONS[motivo]}</p>
              )}
              <h1 className="lp-upgrade__title">
                Você está no <strong>{currentPlan.label}</strong>. No {nextPlan.label} você ganha:
              </h1>
              <ul className="lp-upgrade__gains">
                {gains.map((gain) => <li key={gain}>{gain}</li>)}
              </ul>
            </div>
            <div className="lp-upgrade__action">
              <div className="lp-upgrade__price">
                <strong>{money(nextPlan.price_cents)}</strong>
                <span>/mês</span>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => (trialAvailable && nextPlan.code === 'pro'
                  ? goTrial(nextPlan.code, cycle)
                  : goCheckout(nextPlan.code, cycle))}
              >
                {trialAvailable && nextPlan.code === 'pro'
                  ? `Testar ${trialDays} dias grátis`
                  : `Mudar para ${nextPlan.label}`}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={scrollToPlans}>
                Ver todos os planos
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="lp-hero">
          <div className="lp-shell">
            <h1 className="lp-hero__title">Pare de perder dinheiro com quem não aparece.</h1>
            <p className="lp-hero__lead">
              Cobre um sinal no PIX, mande o lembrete automático no WhatsApp e deixe o cliente
              marcar sozinho pelo seu link.
            </p>
            <div className="lp-hero__cta">
              <button type="button" className="btn btn--primary btn--lg" onClick={() => goTrial('pro', cycle)}>
                Testar {trialDays} dias grátis
              </button>
              {/* Sem fallback de preço: um valor hardcoded "só enquanto carrega" é um valor
                  que pode mentir no dia em que a tabela mudar. Ou vem do catálogo, ou não vem. */}
              <span className="lp-hero__note">
                Sem cartão de crédito
                {plans.length ? ` · a partir de ${money(plans[0].price_cents)}/mês` : ''}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ---- Três provas ---------------------------------------------------- */}
      <section className="lp-proofs">
        <div className="lp-shell lp-proofs__grid">
          {PROOFS.map((proof) => (
            <div key={proof.title} className="lp-proof">
              <h2>{proof.title}</h2>
              <p>{proof.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Preços --------------------------------------------------------- */}
      <section className="lp-pricing" id="planos">
        <div className="lp-shell">
          <header className="lp-section-head">
            <h2>Escolha o plano</h2>
            <div className="lp-cycle" role="group" aria-label="Ciclo de cobrança">
              {CYCLES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={cycle === option.key}
                  className={`lp-cycle__btn ${cycle === option.key ? 'is-active' : ''}`}
                  onClick={() => setCycle(option.key)}
                >
                  {option.label}
                </button>
              ))}
              {/* O desconto anual dito como número: "equivalente a R$ 12,40/mês" ninguém calcula. */}
              <span className="lp-cycle__hint">
                No anual, 12 meses pelo preço de {plans[0]?.annual_months_equivalent ?? 10}
              </span>
            </div>
          </header>

          {catalogError ? (
            <div className="box error">{catalogError}</div>
          ) : !plans.length ? (
            <div className="lp-cards">
              {[0, 1, 2].map((index) => <div key={index} className="lp-card shimmer" style={{ height: 320 }} />)}
            </div>
          ) : (
            <div className="lp-cards">
              {plans.map((plan, index) => {
                const previous = index > 0 ? plans[index - 1] : null;
                const cta = ctaFor(plan);
                const isCurrent = currentPlan?.code === plan.code;
                const gainsOverPrevious = planGains(previous, plan);

                return (
                  <div key={plan.code} className={`lp-card ${plan.code === 'pro' ? 'is-featured' : ''} ${isCurrent ? 'is-current' : ''}`}>
                    {plan.code === 'pro' && <span className="lp-card__flag">Mais escolhido</span>}
                    {isCurrent && <span className="lp-card__flag lp-card__flag--current">Seu plano</span>}

                    <h3 className="lp-card__name">{plan.label}</h3>
                    <p className="lp-card__sub">{SUBTITLES[plan.code] || ''}</p>

                    <div className="lp-card__price">
                      <strong>{money(priceOf(plan))}</strong>
                      <span>{periodOf()}</span>
                    </div>

                    {/* A diferença entre planos numa linha só. Listar 6 itens iguais em cada
                        card, quando os planos quase não diferem, é ruído — não informação. */}
                    {previous ? (
                      <div className="lp-card__diff">
                        <p className="lp-card__diff-head">Tudo do {previous.label}, mais:</p>
                        <ul>
                          {gainsOverPrevious.map((gain) => <li key={gain}>{gain}</li>)}
                        </ul>
                      </div>
                    ) : (
                      <div className="lp-card__diff">
                        <ul>
                          <li>{limitText(plan.max_professionals, 'profissional', 'profissionais')}</li>
                          <li>{plan.whatsapp_included_messages.toLocaleString('pt-BR')} mensagens de WhatsApp por mês</li>
                          <li>{limitText(plan.max_gallery_images, 'foto na galeria', 'fotos na galeria')}</li>
                          <li className="is-off">Sem sinal via PIX</li>
                        </ul>
                      </div>
                    )}

                    <button
                      type="button"
                      className={`btn ${cta.primary ? 'btn--primary' : 'btn--outline'} lp-card__cta`}
                      onClick={cta.action || undefined}
                      disabled={!cta.action}
                    >
                      {cta.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Informação que decide a compra não pode morar num tooltip. */}
          <p className="lp-fineprint">
            Cada agendamento usa até 5 mensagens (confirmação + lembretes). A franquia renova
            todo mês. Se acabar, os avisos continuam por e-mail e no painel — e dá para comprar
            pacotes extras por PIX.
          </p>
        </div>
      </section>

      {/* ---- Em todos os planos --------------------------------------------- */}
      <section className="lp-included">
        <div className="lp-shell">
          <h2>Em todos os planos</h2>
          <ul className="lp-included__grid">
            {INCLUDED.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <Suspense fallback={null}>
        <PlanosLowerExtras
          plans={plans}
          trialDays={trialDays}
          onTrial={() => goTrial('pro', cycle)}
          onTalkSpecialist={() => nav('/contato')}
        />
      </Suspense>
    </div>
  );
}
