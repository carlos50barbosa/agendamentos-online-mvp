// Página pública "Meus agendamentos" — para quem agendou como CONVIDADO e não tem senha.
//
// Por que ela existe: o fluxo público cria o cliente com e-mail placeholder
// (guest-<telefone>@sem-email.agendou.local) e senha aleatória. Ele nunca consegue entrar em
// /cliente, então terminava o agendamento sem forma nenhuma de rever o próprio horário. Foi
// exatamente o pedido que chegou numa avaliação: "colocar opção de meus agendamentos".
//
// Dois níveis de acesso, deliberadamente distintos:
//   1. ESTE agendamento — token assinado na URL, emitido no fim do fluxo. Abre direto, sem atrito,
//      e mostra UM agendamento: o que a pessoa acabou de fazer.
//   2. TODOS — exige que ela ENVIE uma mensagem pelo WhatsApp. O telefone digitado no wizard nunca
//      foi verificado; sem prova, um token de URL diria apenas que alguém digitou aquele número, e
//      listar o histórico a partir dele deixaria qualquer um ler a agenda de um estranho.
//
// ─── Por que a prova é mensagem ENVIADA, e não um código recebido ──────────────────────────────
//
// Prático: quem pede acesso está sempre fora da janela de 24h, e fora dela a Meta só entrega
// template. O único template legítimo para código é o de categoria AUTHENTICATION, que exige um
// scaling path (verificação MAIS milhares de mensagens/mês) fora do alcance desta conta.
//
// De fundo, e é o que decide: um código prova quem tem ACESSO AO APARELHO; uma mensagem enviada
// daquele número prova quem é DONO dele. É o mesmo raciocínio do AUTORIZO em
// backend/src/whatsapp/inbound/optInConfirm.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, Loader2, MessageCircle, ShieldCheck } from 'lucide-react';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import StatusBadge from '../components/client-appointments/StatusBadge.jsx';
import { formatDateTimeBr, isPastDateTime } from '../utils/formatDateTimeBr.js';

const OTP_STORAGE_KEY = 'meus_agendamentos_otp';
const POLL_INTERVAL_MS = 3000;

function serviceLabel(item) {
  const names = Array.isArray(item?.servicos) ? item.servicos.map((s) => s?.nome).filter(Boolean) : [];
  if (names.length) return names.join(' + ');
  return item?.servico_nome || 'Serviço';
}

function AppointmentCard({ item }) {
  const past = isPastDateTime(item?.fim || item?.inicio);
  return (
    <li
      className="tw-flex tw-flex-col tw-gap-2 tw-rounded-2xl tw-p-4"
      style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
    >
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-min-w-0">
          <p className="tw-m-0 tw-truncate tw-text-sm tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
            {serviceLabel(item)}
          </p>
          <p className="tw-m-0 tw-truncate tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            {item?.estabelecimento_nome || 'Estabelecimento'}
            {item?.profissional_nome ? ` · ${item.profissional_nome}` : ''}
          </p>
        </div>
        <StatusBadge status={item?.status} isPast={past} />
      </div>
      <p className="tw-m-0 tw-text-sm tw-font-medium" style={{ color: 'var(--brand, #5049E5)' }}>
        {formatDateTimeBr(item?.inicio, { includeYear: true })}
      </p>
      {item?.estabelecimento_slug && (
        <Link
          to={`/${item.estabelecimento_slug}`}
          className="tw-text-xs tw-font-semibold"
          style={{ color: 'var(--brand, #5049E5)' }}
        >
          Agendar de novo
        </Link>
      )}
    </li>
  );
}

export default function MeusAgendamentos() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const appointmentId = Number(searchParams.get('ag') || 0);

  const [current, setCurrent] = useState({ loading: Boolean(token && appointmentId), item: null, error: '' });
  const [link, setLink] = useState({ status: 'idle', requestId: '', code: '', waLink: '', error: '' });
  const [list, setList] = useState({ loading: false, items: null, error: '' });

  // Cliente COM login não precisa disto: /cliente é a tela completa dele (cancelar, filtrar, pagar
  // sinal pendente). O link da tela de sucesso já aponta para lá; este aviso cobre quem chegou
  // pela URL mesmo assim.
  const loggedClient = useMemo(() => {
    const user = getUser();
    return user && String(user.tipo || '') === 'cliente' ? user : null;
  }, []);

  useEffect(() => {
    if (!token || !appointmentId) return undefined;
    let alive = true;
    (async () => {
      try {
        const data = await Api.publicGetAgendamento(appointmentId, token);
        if (alive) setCurrent({ loading: false, item: data, error: '' });
      } catch {
        // Link velho ou adulterado. Não é beco sem saída: o caminho do WhatsApp segue logo abaixo.
        if (alive) setCurrent({ loading: false, item: null, error: 'Este link expirou ou não é mais válido.' });
      }
    })();
    return () => { alive = false; };
  }, [token, appointmentId]);

  const loadList = useCallback(async (otpToken) => {
    setList({ loading: true, items: null, error: '' });
    try {
      const data = await Api.publicMeusAgendamentos(otpToken);
      setList({ loading: false, items: Array.isArray(data?.items) ? data.items : [], error: '' });
    } catch {
      try { sessionStorage.removeItem(OTP_STORAGE_KEY); } catch {}
      setList({ loading: false, items: null, error: 'Não foi possível carregar sua lista. Envie a mensagem de novo.' });
      setLink({ status: 'idle', requestId: '', code: '', waLink: '', error: '' });
    }
  }, []);

  // O token vale 30 min no backend. Guardar na sessão evita repetir a prova a cada recarga dentro
  // dessa janela — e some quando a aba fecha.
  useEffect(() => {
    let stored = '';
    try { stored = sessionStorage.getItem(OTP_STORAGE_KEY) || ''; } catch {}
    if (stored) loadList(stored);
  }, [loadList]);

  const startLink = useCallback(async () => {
    setLink({ status: 'creating', requestId: '', code: '', waLink: '', error: '' });
    try {
      const resp = await Api.publicWaLinkRequest();
      setLink({
        status: 'waiting',
        requestId: resp?.request_id || '',
        code: resp?.code || '',
        waLink: resp?.wa_link || '',
        error: '',
      });
    } catch (e) {
      const message = String(e?.data?.message || '').trim();
      setLink({
        status: 'idle',
        requestId: '',
        code: '',
        waLink: '',
        error: message || 'Não foi possível gerar o link agora. Tente de novo.',
      });
    }
  }, []);

  // Espera a mensagem dela chegar. O servidor é quem sabe: a aba só pergunta.
  useEffect(() => {
    if (link.status !== 'waiting' || !link.requestId) return undefined;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const resp = await Api.publicWaLinkStatus(link.requestId);
        if (!alive || resp?.status !== 'confirmed') return;
        clearInterval(timer);
        const otpToken = resp?.otp_token || '';
        try { sessionStorage.setItem(OTP_STORAGE_KEY, otpToken); } catch {}
        setLink((s) => ({ ...s, status: 'confirmed' }));
        loadList(otpToken);
      } catch (e) {
        // 410 = pedido expirou ou já foi usado. Qualquer outra falha é de rede: continuar tentando,
        // porque a pessoa pode estar justamente trocando de app para enviar a mensagem.
        if (!alive || e?.status !== 410) return;
        clearInterval(timer);
        setLink((s) => ({ ...s, status: 'expired' }));
      }
    }, POLL_INTERVAL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [link.status, link.requestId, loadList]);

  const showList = list.loading || list.items !== null;

  return (
    <div style={{ background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      <div className="tw-mx-auto tw-flex tw-w-full tw-max-w-lg tw-flex-col tw-gap-4 tw-px-4 tw-py-6">
        <header className="tw-flex tw-items-center tw-gap-2">
          <CalendarDays size={22} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--brand, #5049E5)' }} />
          <h1 className="tw-m-0 tw-text-lg tw-font-bold" style={{ color: 'var(--ink, #1E1B4B)' }}>
            Meus agendamentos
          </h1>
        </header>

        {loggedClient && (
          <Link
            to="/cliente"
            className="tw-rounded-2xl tw-p-3 tw-text-sm tw-font-semibold"
            style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', color: 'var(--brand, #5049E5)' }}
          >
            Você está conectado — ver a sua área completa
          </Link>
        )}

        {/* 1. O agendamento recém-feito, aberto pelo token do link. */}
        {current.loading && (
          <p className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            <Loader2 size={16} className="tw-animate-spin" aria-hidden="true" /> Carregando seu agendamento…
          </p>
        )}
        {current.item && (
          <section className="tw-flex tw-flex-col tw-gap-2">
            <h2 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase" style={{ color: 'var(--muted-ink, #6B7280)' }}>
              Seu agendamento
            </h2>
            <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-3 tw-p-0">
              <AppointmentCard item={current.item} />
            </ul>
          </section>
        )}
        {current.error && (
          <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>{current.error}</p>
        )}

        {/* 2. A lista completa, atrás da mensagem enviada por ela. */}
        {!showList && (
          <section
            className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4"
            style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
          >
            <div className="tw-flex tw-items-start tw-gap-2">
              <ShieldCheck size={18} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--brand, #5049E5)', flexShrink: 0, marginTop: 2 }} />
              <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                Para ver <b style={{ color: 'var(--ink, #1E1B4B)' }}>todos</b> os seus agendamentos, envie uma
                mensagem pelo seu WhatsApp. É assim que confirmamos que o número é seu — sem senha e sem código.
              </p>
            </div>

            {link.status === 'waiting' || link.status === 'confirmed' ? (
              <>
                <a
                  href={link.waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tw-inline-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-px-4 tw-font-semibold tw-text-white"
                  style={{ minHeight: 48, background: '#16A34A' }}
                >
                  <MessageCircle size={18} strokeWidth={2.4} aria-hidden="true" />
                  Abrir o WhatsApp
                </a>
                <p className="tw-m-0 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  Toque acima e <b>envie</b> a mensagem que abrir. Se ela não vier preenchida, escreva:
                </p>
                {/* O código também aparece em texto: em navegador embutido o wa.me às vezes abre sem
                    o texto pronto, e sem isto a pessoa fica sem saber o que mandar. */}
                <p
                  className="tw-m-0 tw-select-all tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-semibold"
                  style={{ background: 'var(--bg-lav, #F6F5FB)', color: 'var(--ink, #1E1B4B)', letterSpacing: '.02em' }}
                >
                  MEUS AGENDAMENTOS {link.code}
                </p>
                <p className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  <Loader2 size={14} className="tw-animate-spin" aria-hidden="true" />
                  Esperando sua mensagem… esta tela abre sozinha assim que ela chegar.
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={startLink}
                disabled={link.status === 'creating'}
                className="tw-rounded-xl tw-px-4 tw-py-2.5 tw-text-sm tw-font-semibold"
                style={{ background: 'var(--brand, #5049E5)', color: '#fff', border: 0, opacity: link.status === 'creating' ? 0.7 : 1 }}
              >
                {link.status === 'creating' ? 'Gerando…' : 'Ver todos os meus agendamentos'}
              </button>
            )}

            {link.status === 'expired' && (
              <p className="tw-m-0 tw-text-xs" style={{ color: '#DC2626' }}>
                Este pedido expirou. Toque em "Ver todos os meus agendamentos" para gerar outro.
              </p>
            )}
            {link.error && <p className="tw-m-0 tw-text-xs" style={{ color: '#DC2626' }}>{link.error}</p>}
          </section>
        )}

        {list.loading && (
          <p className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            <Loader2 size={16} className="tw-animate-spin" aria-hidden="true" /> Carregando…
          </p>
        )}
        {list.items && (
          <section className="tw-flex tw-flex-col tw-gap-2">
            <h2 className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase" style={{ color: 'var(--muted-ink, #6B7280)' }}>
              Todos os seus agendamentos
            </h2>
            {list.items.length ? (
              <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-3 tw-p-0">
                {list.items.map((item) => <AppointmentCard key={item.id} item={item} />)}
              </ul>
            ) : (
              <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                Nenhum agendamento neste número ainda.
              </p>
            )}
          </section>
        )}
        {list.error && <p className="tw-m-0 tw-text-sm" style={{ color: '#DC2626' }}>{list.error}</p>}

        <Link
          to="/"
          className="tw-inline-flex tw-items-center tw-gap-1 tw-text-sm tw-font-semibold"
          style={{ color: 'var(--brand, #5049E5)' }}
        >
          <ChevronLeft size={16} strokeWidth={2.4} aria-hidden="true" />
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
