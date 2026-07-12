// src/components/settings/WorkingHoursSection.jsx
// Menu próprio "Horários de funcionamento". Carrega os horários do perfil e salva de forma
// ISOLADA via Api.updateEstablishmentHours (PUT /:id/hours) — não toca nos demais campos do
// perfil público, e o save do perfil não zera os horários (backend preserva quando ausentes).
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import WorkingHoursEditor, { daysFromHorarios, horariosFromDays, validateDays } from './WorkingHoursEditor.jsx';
import './settings.css';

export default function WorkingHoursSection() {
  const [status, setStatus] = useState('loading');
  const [id, setId] = useState(null);
  const [days, setDays] = useState(() => daysFromHorarios([]));
  const [observacoes, setObservacoes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (!user?.id) { setStatus('error'); return () => {}; }
    if (user.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const est = await Api.getEstablishment(user.id);
        if (!alive) return;
        setId(user.id);
        const horarios = Array.isArray(est?.profile?.horarios) ? est.profile.horarios : [];
        setDays(daysFromHorarios(horarios));
        setObservacoes(horarios.filter((h) => h && !h.day).map((h) => h.value || '').filter(Boolean).join('\n'));
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    const dayErrors = validateDays(days);
    setErrors(dayErrors);
    if (Object.keys(dayErrors).length) { setFeedback({ type: 'error', message: 'Revise os horários destacados antes de salvar.' }); return; }
    setSaving(true); setFeedback(null);
    try {
      const horarios = [
        ...horariosFromDays(days),
        ...observacoes.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => ({ label: '', value: line })),
      ];
      await Api.updateEstablishmentHours(id, horarios);
      setFeedback({ type: 'success', message: 'Horários salvos com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar os horários.' });
    } finally { setSaving(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando horários…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar os horários. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Horários de funcionamento</h4>
          <p className="set-block__sub">Marque os dias abertos e ajuste os horários. Aparecem na sua página pública e definem sua disponibilidade.</p>
        </div>
        <WorkingHoursEditor days={days} onChange={setDays} errors={errors} />
        <label className="label" style={{ marginTop: 12 }}>
          <span>Observações <em className="muted">(opcional)</em></span>
          <textarea className="input" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Ex.: Feriados: fechado | Plantão sábado até 13h" />
        </label>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar horários'}</button>
      </div>
    </form>
  );
}
