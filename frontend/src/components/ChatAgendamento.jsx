import React, { useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';
import { getUser } from '../utils/auth';
import Modal from './Modal.jsx';

function formatDateBR(input) {
  try {
    // Trata YYYY-MM-DD como data LOCAL (evita regressão de 1 dia)
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const [y, m, d] = input.split('-').map(Number);
      const local = new Date(y, (m || 1) - 1, d || 1);
      return local.toLocaleDateString('pt-BR');
    }
    const d = new Date(input);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return String(input);
  }
}

function formatTimeBR(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function genIdemKey() {
  return 'idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export default function ChatAgendamento({ publicMode = false, preselectedEstabId = null }){
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('greet');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [estabs, setEstabs] = useState([]);
  const [services, setServices] = useState([]);

  const [selEstab, setSelEstab] = useState(null);
  const [selService, setSelService] = useState(null);
  const [selDate, setSelDate] = useState(''); // YYYY-MM-DD
  const [selTimeIso, setSelTimeIso] = useState('');
  const [times, setTimes] = useState([]); // [{iso, label}]
  const [myAppts, setMyAppts] = useState([]);
  const [rescheduleFrom, setRescheduleFrom] = useState(null); // agendamento selecionado para remarcar
  const [cancelTarget, setCancelTarget] = useState(null); // agendamento selecionado para cancelar

  const [wantWhats, setWantWhats] = useState(false);
  const [whatsTo, setWhatsTo] = useState('');
  // Campos do modo público
  const [pubNome, setPubNome] = useState('');
  const [pubEmail, setPubEmail] = useState('');
  const [pubPhone, setPubPhone] = useState('');

  const user = getUser();

  // Pré-seleciona estabelecimento no modo público
  useEffect(() => {
    (async () => {
      if (!open) return;
      if (!publicMode || !preselectedEstabId) return;
      if (selEstab && selEstab.id === Number(preselectedEstabId)) return;
      try {
        const est = await Api.getEstablishment(preselectedEstabId);
        if (est && est.id) setSelEstab(est);
      } catch {}
    })();
  }, [open, publicMode, preselectedEstabId, selEstab?.id]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const list = await Api.listEstablishments();
        setEstabs(Array.isArray(list) ? list : []);
      } catch (e) {
        setError('Não foi possível carregar estabelecimentos.');
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!selEstab) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const list = await Api.listServices(selEstab.id);
        setServices(Array.isArray(list) ? list : []);
      } catch (e) {
        setError('Não foi possível carregar serviços.');
      } finally {
        setLoading(false);
      }
    })();
  }, [selEstab?.id]);

  async function fetchTimes(dateStr){
    if (!selEstab || !dateStr) return;
    try {
      setLoading(true);
      setError('');
      // weekStart pode ser o próprio dia selecionado
      const data = await Api.getSlots(selEstab.id, dateStr, { includeBusy: false });
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
    } catch (e) {
      setError('Não foi possível buscar horários.');
    } finally {
      setLoading(false);
    }
  }

  const canConfirm = useMemo(() => {
    const baseOk = !!(selEstab && selService && selDate && selTimeIso);
    if (!publicMode) return baseOk;
    return baseOk && pubNome.trim() && pubEmail.trim() && (/\d{8,}/.test(String(pubPhone)));
  }, [selEstab, selService, selDate, selTimeIso, publicMode, pubNome, pubEmail, pubPhone]);

  async function confirmBooking(){
    if (!user) {
      setError('Faça login para concluir o agendamento.');
      return;
    }
    if (!canConfirm) return;
    try {
      setLoading(true);
      setError('');
      const idem = genIdemKey();
      // Se for remarcar, podemos primeiro tentar criar o novo
      if (rescheduleFrom) {
        await Api.agendar({
          estabelecimento_id: selEstab.id,
          servico_id: selService.id,
          inicio: selTimeIso,
        }, { idempotencyKey: idem + '_re' });
        try {
          await Api.cancelarAgendamento(rescheduleFrom.id);
        } catch {}
      } else {
        await Api.agendar({
          estabelecimento_id: selEstab.id,
          servico_id: selService.id,
          inicio: selTimeIso,
        }, { idempotencyKey: idem });
      }

      // Opcional: confirmação por WhatsApp
      if (wantWhats && whatsTo.replace(/\D/g,'').length >= 10) {
        const msg = `Agendamento confirmado: ${selService?.nome} em ${formatDateBR(selTimeIso)} ${formatTimeBR(selTimeIso)}.`;
        try {
          await Api.scheduleWhatsApp({ to: whatsTo, scheduledAt: new Date().toISOString(), message: msg });
        } catch { /* ignora erros de notificação no fluxo feliz */ }
      }

      setStep('done');
    } catch (e) {
      const msg = e?.message || 'Erro ao agendar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function resetFlow(){
    setStep('greet');
    setError('');
    setSelEstab(null);
    setSelService(null);
    setSelDate('');
    setTimes([]);
    setSelTimeIso('');
    setWantWhats(false);
    setWhatsTo('');
    setRescheduleFrom(null);
  }

  return (
    <>
      <button className="chatfab" onClick={() => { if (!open) resetFlow(); setOpen(v => !v); }} aria-label={open ? 'Fechar chat de agendamento' : 'Abrir chat de agendamento'}>
        {open ? '×' : 'Agendar'}
      </button>

      {open && (
        <div className="chatbox" role="dialog" aria-label="Chat de Agendamento">
          <div className="chatbox__header">
            <strong>Agendar Atendimento</strong>
            <button className="chatbox__close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
          </div>
          <div className="chatbox__body">
            {error && <div className="chatmsg chatmsg--error">{error}</div>}

            {step === 'greet' && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Olá! Vamos marcar seu horário?</div>
                <div className="chatmsg chatmsg--bot">Escolha o estabelecimento:</div>
                <div className="chatlist">
                  {loading && <div className="chatmsg">Carregando…</div>}
                  {!loading && estabs.map(e => (
                    <button key={e.id} className="chatbtn" onClick={() => { setSelEstab(e); setStep('pickService'); }}>
                      {e.nome || e.name || `Estabelecimento #${e.id}`}
                    </button>
                  ))}
                  {!loading && !estabs.length && (
                    <div className="chatmsg">Nenhum estabelecimento disponível.</div>
                  )}
                </div>
                {user && (
                  <div className="chatrow" style={{ marginTop: 8 }}>
                    <button className="chatbtn" onClick={async () => {
                      try {
                        setLoading(true); setError('');
                        const rows = await Api.meusAgendamentos();
                        setMyAppts(Array.isArray(rows) ? rows : []);
                        setStep('myList');
                      } catch (e) {
                        setError('Não foi possível carregar seus agendamentos.');
                      } finally { setLoading(false); }
                    }}>Meus agendamentos</button>
                  </div>
                )}
              </div>
            )}

            {step === 'myList' && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Seus agendamentos:</div>
                {!myAppts.length && <div className="chatmsg">Nenhum agendamento encontrado.</div>}
                <div className="chatlist">
                  {myAppts.slice(0, 10).map(a => {
                    const isPast = (() => { try { return new Date(a.inicio).getTime() < Date.now(); } catch { return false; } })();
                    const isCanceled = String(a.status || '').toLowerCase() === 'cancelado';
                    return (
                      <div key={a.id} className="chatmsg" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong>#{a.id}</strong> — {a.servico_nome} em {a.estabelecimento_nome}
                          {isCanceled && <span className="badge out" title="Agendamento cancelado">cancelado</span>}
                        </div>
                        <div>{formatDateBR(a.inicio)} {formatTimeBR(a.inicio)}</div>
                        <div className="chatrow" style={{ marginTop: 6 }}>
                          <button className="chatbtn" onClick={() => {
                            setRescheduleFrom(a);
                            setSelEstab({ id: a.estabelecimento_id, nome: a.estabelecimento_nome });
                            setSelService({ id: a.servico_id, nome: a.servico_nome });
                            setStep('pickDate');
                          }}>Reagendar</button>
                          {/* Exibe Cancelar apenas para agendamentos futuros e não cancelados */}
                          {(!isPast && !isCanceled) && (
                            <button className="chatbtn chatbtn--muted" onClick={() => setCancelTarget(a)}>Cancelar</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="chatrow">
                  <button className="chatbtn chatbtn--muted" onClick={() => setStep('greet')}>Voltar</button>
                </div>
              </div>
            )}

            {step === 'pickService' && selEstab && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Perfeito! Qual serviço você deseja?</div>
                <div className="chatlist">
                  {loading && <div className="chatmsg">Carregando…</div>}
                  {!loading && services.map(sv => (
                    <button key={sv.id} className="chatbtn" onClick={() => { setSelService(sv); setStep('pickDate'); }}>
                      {sv.nome || sv.name || `Serviço #${sv.id}`}
                    </button>
                  ))}
                  {!loading && !services.length && (
                    <div className="chatmsg">Sem serviços cadastrados.</div>
                  )}
                </div>
                <div className="chatrow">
                  <button className="chatbtn chatbtn--muted" onClick={() => { setSelEstab(null); setServices([]); setStep('greet'); }}>Voltar</button>
                </div>
              </div>
            )}

            {step === 'pickDate' && selService && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Qual dia?</div>
                <div className="chatrow">
                  <input type="date" className="chatinput" value={selDate} onChange={e => setSelDate(e.target.value)} />
                  <button className="chatbtn" disabled={!selDate} onClick={async () => { await fetchTimes(selDate); setStep('pickTime'); }}>Buscar horários</button>
                </div>
                <div className="chatrow">
                  <button className="chatbtn chatbtn--muted" onClick={() => { setSelService(null); setStep('pickService'); }}>Voltar</button>
                </div>
              </div>
            )}

            {step === 'pickTime' && selDate && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Horários disponíveis em {formatDateBR(selDate)}:</div>
                {loading && <div className="chatmsg">Carregando…</div>}
                {!loading && (
                  <div className="chiptags">
                    {times.map(t => (
                      <button key={t.iso} className={`chip ${selTimeIso === t.iso ? 'chip--active' : ''}`} onClick={() => setSelTimeIso(t.iso)}>
                        {t.label}
                      </button>
                    ))}
                    {!times.length && <div className="chatmsg">Sem horários livres neste dia.</div>}
                  </div>
                )}
                <div className="chatrow" style={{ marginTop: 8 }}>
                  <button className="chatbtn" disabled={!selTimeIso} onClick={() => setStep('confirm')}>Continuar</button>
                  <button className="chatbtn chatbtn--muted" onClick={() => setStep('pickDate')}>Trocar dia</button>
                </div>
              </div>
            )}

            {step === 'confirm' && canConfirm && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Confira os dados do agendamento:</div>
                <ul className="chatreview">
                  <li><strong>Estabelecimento:</strong> {selEstab?.nome || selEstab?.name}</li>
                  <li><strong>Serviço:</strong> {selService?.nome || selService?.name}</li>
                  <li><strong>Data:</strong> {formatDateBR(selTimeIso)}</li>
                  <li><strong>Hora:</strong> {formatTimeBR(selTimeIso)}</li>
                </ul>
                {!user && (
                  <div className="chatmsg chatmsg--warn">Você precisa estar logado para concluir.</div>
                )}
                <div className="chatopt">
                  <label className="chatopt__line">
                    <input type="checkbox" checked={wantWhats} onChange={e => setWantWhats(e.target.checked)} />
                    <span>Receber confirmação por WhatsApp</span>
                  </label>
                  {wantWhats && (
                    <input className="chatinput" placeholder="Seu WhatsApp (com DDD)" value={whatsTo} onChange={e => setWhatsTo(e.target.value)} />
                  )}
                </div>
                <div className="chatrow">
                  <button className="chatbtn" disabled={!user || loading} onClick={confirmBooking}>{loading ? 'Agendando…' : 'Confirmar'}</button>
                  <button className="chatbtn chatbtn--muted" onClick={() => setStep('pickTime')}>Voltar</button>
                </div>
              </div>
            )}

            {step === 'done' && (
              <div className="chatpanel">
                <div className="chatmsg chatmsg--bot">Prontinho! Seu agendamento foi criado.</div>
                <div className="chatrow">
                  <button className="chatbtn" onClick={() => setOpen(false)}>Fechar</button>
                  <button className="chatbtn chatbtn--muted" onClick={resetFlow}>Novo agendamento</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {cancelTarget && (
        <Modal
          title={`Cancelar agendamento #${cancelTarget.id}?`}
          onClose={() => setCancelTarget(null)}
          actions={[
            <button key="cancel" className="btn btn--outline" onClick={() => setCancelTarget(null)}>Não</button>,
            <button
              key="confirm"
              className="btn btn--danger"
              onClick={async () => {
                try {
                  setLoading(true); setError('');
                  await Api.cancelarAgendamento(cancelTarget.id);
                  // Reflete status cancelado imediatamente no estado local
                  setMyAppts(x => x.map(y => y.id === cancelTarget.id ? { ...y, status: 'cancelado' } : y));
                  setCancelTarget(null);
                } catch (e) {
                  setError('Falha ao cancelar.');
                } finally {
                  setLoading(false);
                }
              }}
            >
              Confirmar
            </button>,
          ]}
        >
          <p>Esta ação não pode ser desfeita. Deseja prosseguir?</p>
        </Modal>
      )}
    </>
  );
}
