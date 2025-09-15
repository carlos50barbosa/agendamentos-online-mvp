import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Api } from '../utils/api';

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

export default function Book(){
  const { id } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [estab, setEstab] = useState(null);
  const [services, setServices] = useState([]);
  const [selService, setSelService] = useState(null);
  const [selDate, setSelDate] = useState('');
  const [times, setTimes] = useState([]); // [{iso,label}]
  const [selTimeIso, setSelTimeIso] = useState('');

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('55');
  const [otpReqId, setOtpReqId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpMsg, setOtpMsg] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = useMemo(() => !!(estab && selService && selDate && selTimeIso && nome.trim() && email.trim() && /\d{8,}/.test(String(phone))), [estab, selService, selDate, selTimeIso, nome, email, phone]);

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
    if (!estab || !dateStr) return;
    try {
      setLoading(true); setError('');
      const data = await Api.getSlots(estab.id, dateStr, { includeBusy: false });
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

  async function submitBooking(){
    if (!canSubmit) return;
    try {
      setLoading(true); setError('');
      const idem = genIdemKey();
      const payload = {
        estabelecimento_id: estab.id,
        servico_id: selService.id,
        inicio: selTimeIso,
        nome, email, telefone: phone,
      };
      if (otpToken) payload.otp_token = otpToken;
      await Api.publicAgendar(payload, { idempotencyKey: idem });
      setDone(true);
    } catch (e) {
      const msg = e?.data?.message || e?.message || 'Falha ao agendar.';
      setError(String(msg));
      if (e?.data?.error === 'otp_required') {
        setOtpMsg('Verifique seu contato para continuar. Envie e valide o código.');
      }
    } finally { setLoading(false); }
  }

  async function sendOtp(){
    try {
      setLoading(true); setOtpMsg(''); setError('');
      const value = /\d{8,}/.test(String(phone)) ? phone : String(email);
      const channel = /\d{8,}/.test(String(phone)) ? 'phone' : 'email';
      const r = await Api.requestOtp(channel, value);
      setOtpReqId(r?.request_id || '');
      setOtpMsg(`Código enviado via ${channel === 'phone' ? 'WhatsApp' : 'email'}.`);
    } catch (e) {
      setError('Não foi possível enviar o código.');
    } finally { setLoading(false); }
  }

  async function verifyOtp(){
    try {
      setLoading(true); setError('');
      if (!otpReqId || !otpCode) return;
      const r = await Api.verifyOtp(otpReqId, otpCode);
      if (r?.otp_token) {
        setOtpToken(r.otp_token);
        setOtpMsg('Contato verificado.');
      }
    } catch (e) {
      setError('Código inválido ou expirado.');
    } finally { setLoading(false); }
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

          {!done && (
            <div className="chatpanel">
              <div className="chatmsg chatmsg--bot">Olá! Vou te ajudar a agendar neste estabelecimento. Escolha um serviço:</div>
              <div className="chatlist">
                {loading && <div className="chatmsg">Carregando…</div>}
                {!loading && services.map(sv => (
                  <button key={sv.id} className="chatbtn" onClick={() => setSelService(sv)}>
                    {sv.nome || `Serviço #${sv.id}`}
                  </button>
                ))}
                {!loading && !services.length && (
                  <div className="chatmsg">Sem serviços cadastrados.</div>
                )}
              </div>

              {selService && (
                <>
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
                    <input className="chatinput" placeholder="Seu WhatsApp (com DDD)" value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
                  <div className="chatrow" style={{ marginTop: 6, gap: 8 }}>
                    <button className="chatbtn" type="button" onClick={sendOtp} disabled={loading || (!email && !phone)}>Enviar código</button>
                    <input className="chatinput" placeholder="Código" value={otpCode} onChange={e => setOtpCode(e.target.value)} style={{ maxWidth: 140 }} />
                    <button className="chatbtn chatbtn--muted" type="button" onClick={verifyOtp} disabled={loading || !otpReqId || !otpCode}>Validar</button>
                  </div>
                  {otpMsg && <div className="chatmsg" style={{ background:'#f1f5f9' }}>{otpMsg}</div>}
                  <div className="chatrow" style={{ marginTop: 8 }}>
                    <button className="chatbtn" disabled={!canSubmit || loading} onClick={submitBooking}>{loading ? 'Agendando…' : 'Confirmar'}</button>
                    <button className="chatbtn chatbtn--muted" onClick={() => setSelTimeIso('')}>Voltar</button>
                  </div>
                </>
              )}
            </div>
          )}

          {done && (
            <div className="chatpanel" style={{ marginTop: 8 }}>
              <div className="chatmsg chatmsg--bot">Prontinho! Seu agendamento foi criado.</div>
              <div className="chatrow" style={{ marginTop: 8 }}>
                <button className="chatbtn" onClick={() => nav('/', { replace: true })}>Fechar</button>
                <button className="chatbtn chatbtn--muted" onClick={() => {
                  setDone(false);
                  setSelService(null);
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
