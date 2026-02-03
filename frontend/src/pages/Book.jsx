import React, { useEffect, useMemo, useState } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { Api } from '../utils/api';

import { getUser } from '../utils/auth';



function formatDateBR(input) {

  try {

    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {

      const [y, m, d] = input.split('-').map(Number);

      return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('pt-BR');

    }

    return new Date(input).toLocaleDateString('pt-BR');

  } catch { return String(input); }

}

function formatTimeBR(iso) {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}
function genIdemKey() { return 'idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
function formatBRLFromCentavos(value) {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents)) return 'R$ 0,00';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


function formatPhone(input) {

  const digits = String(input || '').replace(/\D/g, '').slice(0, 11);

  if (!digits) return '';

  const ddd = digits.slice(0, 2);

  if (digits.length <= 2) return `(${ddd}`;

  if (digits.length <= 6) return `(${ddd}) ${digits.slice(2)}`;

  const useFive = digits.length >= 11;

  const middleSize = useFive ? 5 : 4;

  const middle = digits.slice(2, 2 + middleSize);

  const suffix = digits.slice(2 + middleSize);

  return suffix ? `(${ddd}) ${middle}-${suffix}` : `(${ddd}) ${middle}`;

}



export default function Book(){

  const { id } = useParams();

  const nav = useNavigate();

  const user = getUser();



  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [planLimit, setPlanLimit] = useState(null);



  const [estab, setEstab] = useState(null);
  const [services, setServices] = useState([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [selDate, setSelDate] = useState('');
  const [times, setTimes] = useState([]); // [{iso,label}]
  const [selTimeIso, setSelTimeIso] = useState('');


  const [nome, setNome] = useState('');

  const [email, setEmail] = useState('');

  const [phone, setPhone] = useState('');

  const [otpReqId, setOtpReqId] = useState('');

  const [otpCode, setOtpCode] = useState('');

  const [otpToken, setOtpToken] = useState('');

  const [otpMsg, setOtpMsg] = useState('');

  const [done, setDone] = useState(false);



  const selectedServices = useMemo(
    () => services.filter((svc) => selectedServiceIds.includes(Number(svc.id))),
    [services, selectedServiceIds]
  );
  const serviceSummary = useMemo(() => {
    const names = selectedServices
      .map((svc) => svc?.nome || svc?.title || svc?.name)
      .filter(Boolean);
    const label =
      names.length <= 3
         ? names.join(' + ')
        : `${names[0] || 'Serviço'} + mais ${names.length - 1}`;
    const duration = selectedServices.reduce(
      (sum, svc) => sum + Number(svc?.duracao_min || svc?.duration || 0),
      0
    );
    const price = selectedServices.reduce(
      (sum, svc) =>
        sum +
        Number(
          svc?.preco_centavos ?
            svc?.preco_centavos_snapshot ?
            svc?.preco_snapshot ?
            0
        ),
      0
    );
    return { label, duration, price };
  }, [selectedServices]);
  const canSubmit = useMemo(() => {
    const phoneDigits = String(phone || '');
    return !!(
      estab &&
      selectedServices.length &&
      selDate &&
      selTimeIso &&
      nome.trim() &&
      email.trim() &&
      /^\d{10,11}$/.test(phoneDigits)
    );
  }, [estab, selectedServices.length, selDate, selTimeIso, nome, email, phone]);

  const toggleService = (svc) => {
    const id = Number(svc?.id);
    if (!Number.isFinite(id)) return;
    setSelectedServiceIds((prev) => {
      const exists = prev.includes(id);
      return exists ? prev.filter((value) => value !== id) : [...prev, id];
    });
    setTimes([]);
    setSelTimeIso('');
  };


  useEffect(() => {

    (async () => {

      try {

        setLoading(true); setError('');

        const est = await Api.getEstablishment(id);

        setEstab(est || null);

        if (est?.id) {

          const list = await Api.listServices(est.id);

          setServices(Array.isArray(list) ? list : []);

        }

      } catch (e) {

        setError('Não foi possível carregar este estabelecimento.');

      } finally { setLoading(false); }

    })();

  }, [id]);



  async function fetchTimes(dateStr){
    if (!estab || !dateStr || !selectedServiceIds.length) return;
    try {
      setLoading(true); setError('');
      const data = await Api.getSlots(estab.id, dateStr, {
        includeBusy: false,
        serviceIds: selectedServiceIds,
      });
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      const filtered = slots

        .filter(s => {

          if (s.status !== 'free') return false;

          const d = new Date(s.datetime);

          const y = d.getFullYear();

          const m = String(d.getMonth()+1).padStart(2,'0');

          const day = String(d.getDate()).padStart(2,'0');

          const localYmd = `${y}-${m}-${day}`;

          return localYmd === dateStr;

        })

        .map(s => ({ iso: s.datetime, label: formatTimeBR(s.datetime) }));

      setTimes(filtered);

    } catch (e) { setError('Não foi possível buscar horários.'); }

    finally { setLoading(false); }

  }



  async function performBooking({ token, manageLoading = true } = {}) {

    if (!canSubmit) return;

    if (manageLoading) { setLoading(true); setError(''); }

    else { setError(''); }

    try {

      const idem = genIdemKey();
      const payload = {
        estabelecimento_id: estab.id,
        servico_ids: selectedServiceIds,
        inicio: selTimeIso,
        nome, email, telefone: phone,
      };
      const effectiveToken = token ?? otpToken;

      if (effectiveToken) payload.otp_token = effectiveToken;

      await Api.publicAgendar(payload, { idempotencyKey: idem });

      setPlanLimit(null);

      setDone(true);

    } catch (e) {

      if (e?.data?.error === 'plan_limit_agendamentos') {

        const msg = e?.data?.message || 'Este estabelecimento atingiu o limite de agendamentos do plano.';

        setError(String(msg));

        setPlanLimit({

          message: msg,

          month: e?.data?.details?.month || null,

          limit: e?.data?.details?.limit || null,

        });

      } else {

        const msg = e?.data?.message || e?.message || 'Falha ao agendar.';

        setError(String(msg));

        setPlanLimit(null);

      }

      if (e?.data?.error === 'otp_required') {

        setOtpMsg('Verifique seu email para continuar. Envie e valide o Código.');

      }

    } finally {

      if (manageLoading) setLoading(false);

    }

  }



  async function sendOtp(){

    const emailTrim = email.trim();

    if (!emailTrim) {

      setError('Informe um email válido para receber o Código.');

      return;

    }

    try {

      setLoading(true); setOtpMsg(''); setError('');

      const r = await Api.requestOtp('email', emailTrim);

      setOtpReqId(r?.request_id || '');

      setOtpMsg('Código enviado para o seu email.');

    } catch (e) {

      setError('Não foi possível enviar o Código.');

    } finally { setLoading(false); }

  }



  async function handleConfirm(){

    if (!canSubmit) {

      setError('Preencha os dados do agendamento antes de validar.');

      return;

    }

    if (!otpReqId) {

      setError('Solicite o envio do Código antes de confirmar.');

      return;

    }

    if (!otpCode || !otpCode.trim()) {

      setError('Informe o Código recebido.');

      return;

    }

    try {

      setLoading(true); setError('');

      const r = await Api.verifyOtp(otpReqId, otpCode);

      const token = r?.otp_token;

      if (!token) {

        setError('Código inválido ou expirado.');

        return;

      }

      setOtpToken(token);

      setOtpMsg('Contato verificado.');

      await performBooking({ token, manageLoading: false });

    } catch (e) {

      const msg = e?.data?.message || e?.message || 'Código inválido ou expirado.';

      setError(String(msg));

    } finally {

      setLoading(false);

    }

  }



  return (

    <div className="container book-theme" style={{ paddingTop: 16 }}>

      <div className="chatbox-page">

        <div className="chatbox__header">

          <div>

            <strong>Agendar</strong>

            {estab?.nome && <span style={{ marginLeft: 8, opacity: .8 }}>em {estab.nome}</span>}

          </div>

        </div>

        <div className="chatbox__body">

          {error && <div className="chatmsg chatmsg--error" style={{ marginBottom: 8 }}>{error}</div>}

          {planLimit && (

            <div className="notice notice--warn" role="alert" style={{ marginBottom: 12 }}>

              <div style={{ fontWeight: 700 }}>Agenda bloqueada pelo plano</div>

              <div>{planLimit.message}</div>

              {planLimit.month && (

                <div className="muted">Período: {planLimit.month}{planLimit.limit ? ` • Limite: ${planLimit.limit}/mês` : ''}</div>

              )}

              {user?.tipo === 'estabelecimento' ? (

                <div className="row" style={{ gap: 8, marginTop: 8 }}>

                  <button className="btn btn--outline" type="button" onClick={() => nav('/configuracoes')}>

                    Ir para Configurações

                  </button>

                  <button className="btn btn--primary" type="button" onClick={() => nav('/planos')}>

                    Ver planos

                  </button>

                </div>

              ) : (

                <div className="muted" style={{ marginTop: 6 }}>

                  Se você é o estabelecimento, faça login e atualize seu plano para liberar novos agendamentos.

                </div>

              )}

            </div>

          )}



          {!done && (

            <div className="chatpanel">

              <div className="chatmsg chatmsg--bot">Olá! Vou te ajudar a agendar neste estabelecimento. Escolha os serviços:</div>
              <div className="chatlist">
                {loading && <div className="chatmsg">Carregando…</div>}
                {!loading && services.map(sv => (
                  <button
                    key={sv.id}
                    type="button"
                    className={`chatbtn ${selectedServiceIds.includes(Number(sv.id)) ? '' : 'chatbtn--muted'}`}
                    aria-pressed={selectedServiceIds.includes(Number(sv.id))}
                    onClick={() => toggleService(sv)}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <span>{sv.nome || `Serviço #${sv.id}`}</span>
                      <small className="muted" style={{ fontSize: 11 }}>
                        {Number(sv?.duracao_min || sv?.duration || 0) || 0} min • {formatBRLFromCentavos(sv?.preco_centavos ?? sv?.preco_centavos_snapshot ?? sv?.preco_snapshot ?? 0)}
                      </small>
                    </span>
                  </button>
                ))}
                {!loading && !services.length && (
                  <div className="chatmsg">Sem serviços cadastrados.</div>
                )}
              </div>

              {!!selectedServices.length && (
                <>
                  <div className="chatmsg chatmsg--bot">
                    <div style={{ fontWeight: 600 }}>Resumo</div>
                    <div>{serviceSummary.label || 'Serviços selecionados'}</div>
                    <div className="muted">
                      {serviceSummary.duration} min • {formatBRLFromCentavos(serviceSummary.price)}
                    </div>
                  </div>
                  <div className="chatmsg chatmsg--bot">Qual dia?</div>
                  <div className="chatrow">
                    <input type="date" className="chatinput" value={selDate} onChange={e => setSelDate(e.target.value)} />
                    <button className="chatbtn" disabled={!selDate} onClick={() => fetchTimes(selDate)}>
                      {loading ? 'Buscando…' : 'Buscar horários'}

                    </button>

                  </div>

                </>

              )}



              {!!times.length && (

                <>

                  <div className="chatmsg chatmsg--bot">Horários disponíveis em {formatDateBR(selDate)}:</div>

                  <div className="chiptags">

                    {times.map(t => (

                      <button key={t.iso} className={`chip ${selTimeIso === t.iso ? 'chip--active' : ''}`} onClick={() => setSelTimeIso(t.iso)}>

                        {t.label}

                      </button>

                    ))}

                  </div>

                </>

              )}



              {selTimeIso && (

                <>

                  <div className="chatmsg chatmsg--bot">Seus dados para confirmação:</div>

                  <div className="chatrow" style={{ flexWrap: 'wrap', gap: 8 }}>

                    <input className="chatinput" placeholder="Seu nome" value={nome} onChange={e => setNome(e.target.value)} />

                    <input className="chatinput" placeholder="Seu email" value={email} onChange={e => setEmail(e.target.value)} />

                    <input className="chatinput" placeholder="Seu WhatsApp (00) 00000-0000" value={formatPhone(phone)} onChange={e => {

                    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);

                    setPhone(digits);

                  }} />

                  </div>

                  <div className="chatrow" style={{ marginTop: 6, gap: 8 }}>
                    <button className="chatbtn" type="button" onClick={sendOtp} disabled={loading || !email.trim()}>Enviar código</button>
                    <input className="chatinput" placeholder="Código" value={otpCode} onChange={e => setOtpCode(e.target.value)} style={{ maxWidth: 140 }} />
                    <button className="chatbtn chatbtn--muted" type="button" onClick={handleConfirm} disabled={loading || !canSubmit || !otpReqId || !otpCode.trim()}>Validar e confirmar</button>
                  </div>
                  {otpMsg && <div className="chatmsg" style={{ background:'var(--chat-bot-bg)' }}>{otpMsg}</div>}
                  <div className="chatrow" style={{ marginTop: 8 }}>
                    <button className="chatbtn chatbtn--muted" onClick={() => setSelTimeIso('')}>Voltar</button>
                  </div>
                </>
              )}
            </div>

          )}



          {done && (

            <div className="chatpanel" style={{ marginTop: 8 }}>

              <div className="chatmsg chatmsg--bot">
                Prontinho! Seu agendamento foi criado. Confirme por email em até 10 minutos,
                <strong> senão ele será cancelado automaticamente.</strong>
              </div>
              <div className="chatrow" style={{ marginTop: 8 }}>

                <button className="chatbtn" onClick={() => nav('/', { replace: true })}>Fechar</button>

                <button className="chatbtn chatbtn--muted" onClick={() => {
                  setDone(false);
                  setSelectedServiceIds([]);
                  setSelDate('');
                  setTimes([]);
                  setSelTimeIso('');
                  setNome(''); setEmail(''); setPhone('');

                  setOtpReqId(''); setOtpCode(''); setOtpToken(''); setOtpMsg('');

                }}>Novo agendamento</button>

              </div>

            </div>

          )}

        </div>

      </div>

    </div>

  );

}

