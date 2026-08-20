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
//   2. TODOS — exige código por WhatsApp. O telefone digitado no wizard nunca foi verificado; sem
//      o código, um token de URL provaria apenas que alguém digitou aquele número, e listar o
//      histórico a partir dele deixaria qualquer um ler a agenda de um estranho.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, Loader2, ShieldCheck } from 'lucide-react';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import { formatBRPhone, isValidMobileBR } from '../utils/masks.js';
import StatusBadge from '../components/client-appointments/StatusBadge.jsx';
import { formatDateTimeBr, isPastDateTime } from '../utils/formatDateTimeBr.js';

const OTP_STORAGE_KEY = 'meus_agendamentos_otp';

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
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState({ step: 'idle', requestId: '', code: '', sending: false, error: '' });
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
        // Link velho ou adulterado. Não é beco sem saída: o caminho do código segue logo abaixo.
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
      setList({ loading: false, items: null, error: 'Não foi possível carregar sua lista. Peça um novo código.' });
      setOtp({ step: 'idle', requestId: '', code: '', sending: false, error: '' });
    }
  }, []);

  // O otp_token vale 30 min no backend. Guardar na sessão evita pedir código de novo a cada recarga
  // dentro dessa janela — e some quando a aba fecha.
  useEffect(() => {
    let stored = '';
    try { stored = sessionStorage.getItem(OTP_STORAGE_KEY) || ''; } catch {}
    if (stored) loadList(stored);
  }, [loadList]);

  const sendCode = useCallback(async () => {
    const digits = phone.replace(/\D/g, '');
    if (!isValidMobileBR(digits)) {
      setOtp((s) => ({ ...s, error: 'Informe um celular válido com DDD.' }));
      return;
    }
    setOtp((s) => ({ ...s, sending: true, error: '' }));
    try {
      const resp = await Api.requestOtp('phone', digits);
      setOtp({ step: 'code', requestId: resp?.request_id || '', code: '', sending: false, error: '' });
    } catch (e) {
      // 429 tem mensagem própria do backend (teto por IP e por destino) — vale mais que um genérico.
      const message = e?.data?.message || e?.message || '';
      setOtp((s) => ({
        ...s,
        sending: false,
        error: /muitas|aguarde|tente/i.test(message) ? message : 'Não foi possível enviar o código. Tente de novo.',
      }));
    }
  }, [phone]);

  const confirmCode = useCallback(async () => {
    const code = otp.code.replace(/\D/g, '');
    if (code.length !== 6) {
      setOtp((s) => ({ ...s, error: 'O código tem 6 dígitos.' }));
      return;
    }
    setOtp((s) => ({ ...s, sending: true, error: '' }));
    try {
      const resp = await Api.verifyOtp(otp.requestId, code);
      const otpToken = resp?.otp_token || '';
      if (!otpToken) throw new Error('sem token');
      try { sessionStorage.setItem(OTP_STORAGE_KEY, otpToken); } catch {}
      setOtp({ step: 'done', requestId: '', code: '', sending: false, error: '' });
      await loadList(otpToken);
    } catch {
      setOtp((s) => ({ ...s, sending: false, error: 'Código inválido ou expirado. Peça outro.' }));
    }
  }, [otp.code, otp.requestId, loadList]);

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

        {/* 2. A lista completa, atrás do código. */}
        {!showList && (
          <section
            className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4"
            style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}
          >
            <div className="tw-flex tw-items-start tw-gap-2">
              <ShieldCheck size={18} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--brand, #5049E5)', flexShrink: 0, marginTop: 2 }} />
              <p className="tw-m-0 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                Para ver <b style={{ color: 'var(--ink, #1E1B4B)' }}>todos</b> os seus agendamentos, confirme seu
                celular. Enviamos um código de 6 dígitos no WhatsApp.
              </p>
            </div>

            {otp.step !== 'code' ? (
              <>
                <label className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
                  Celular (WhatsApp)
                  <input
                    value={phone}
                    onChange={(e) => setPhone(formatBRPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    inputMode="tel"
                    autoComplete="tel"
                    className="tw-rounded-xl tw-px-3 tw-py-2 tw-text-sm tw-font-normal"
                    style={{ border: '1px solid var(--brand-border, #E7E5F5)', background: 'var(--bg-lav, #F6F5FB)', color: 'var(--ink, #1E1B4B)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={otp.sending}
                  className="tw-rounded-xl tw-px-4 tw-py-2.5 tw-text-sm tw-font-semibold"
                  style={{ background: 'var(--brand, #5049E5)', color: '#fff', border: 0, opacity: otp.sending ? 0.7 : 1 }}
                >
                  {otp.sending ? 'Enviando…' : 'Enviar código'}
                </button>
              </>
            ) : (
              <>
                <label className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-font-semibold" style={{ color: 'var(--ink, #1E1B4B)' }}>
                  Código enviado para {phone}
                  <input
                    value={otp.code}
                    onChange={(e) => setOtp((s) => ({ ...s, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="tw-rounded-xl tw-px-3 tw-py-2 tw-text-lg tw-font-normal tw-tracking-widest"
                    style={{ border: '1px solid var(--brand-border, #E7E5F5)', background: 'var(--bg-lav, #F6F5FB)', color: 'var(--ink, #1E1B4B)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={confirmCode}
                  disabled={otp.sending}
                  className="tw-rounded-xl tw-px-4 tw-py-2.5 tw-text-sm tw-font-semibold"
                  style={{ background: 'var(--brand, #5049E5)', color: '#fff', border: 0, opacity: otp.sending ? 0.7 : 1 }}
                >
                  {otp.sending ? 'Verificando…' : 'Ver meus agendamentos'}
                </button>
                <button
                  type="button"
                  onClick={() => setOtp({ step: 'idle', requestId: '', code: '', sending: false, error: '' })}
                  className="tw-bg-transparent tw-text-xs tw-font-semibold"
                  style={{ color: 'var(--muted-ink, #6B7280)', border: 0 }}
                >
                  Usar outro número
                </button>
              </>
            )}
            {otp.error && <p className="tw-m-0 tw-text-xs" style={{ color: '#DC2626' }}>{otp.error}</p>}
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
