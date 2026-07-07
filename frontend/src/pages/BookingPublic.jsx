// src/pages/BookingPublic.jsx
// Fase 2: liga o BookingWizard (redesign) ao backend REAL — booking público + sinal via Asaas.
// Resolve o estabelecimento por id/slug na URL (/agendar/:idOrSlug), carrega serviços e horários
// reais, e no onConfirm cria o agendamento guest via publicAgendar. Os profissionais vêm
// vinculados a cada serviço (service.professionals), coerente com a regra do backend
// (profissional obrigatório só quando o serviço tem profissionais linkados).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import BookingWizard from '../components/booking/BookingWizard.jsx';
import { Api } from '../utils/api.js';
import { isSameDay } from '../utils/agendaDates.js';

function ymd(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapBookingError(e) {
  const code = e?.data?.error;
  const msg = e?.data?.message;
  switch (code) {
    case 'cpf_required_for_deposit':
      return 'Informe seu CPF acima para pagar o sinal via PIX.';
    case 'profissional_obrigatorio':
      return 'Selecione um profissional para este serviço.';
    case 'signal_too_low':
      return 'O sinal configurado é muito baixo. Fale com o estabelecimento.';
    case 'asaas_not_connected_for_deposit':
    case 'mp_not_connected_for_deposit':
      return 'O estabelecimento ainda não configurou o recebimento do sinal.';
    case 'outside_business_hours':
      return 'Esse horário está fora do funcionamento. Escolha outro.';
    case 'plan_limit_agendamentos':
      return 'O estabelecimento atingiu o limite de agendamentos do plano.';
    case 'cliente_conflito':
      return 'Você já tem um agendamento nesse horário.';
    default:
      return msg || 'Não foi possível concluir o agendamento. Tente novamente.';
  }
}

export default function BookingPublic() {
  const { idOrSlug } = useParams();
  const [searchParams] = useSearchParams();
  // Resolve por ?estabelecimento=id (link do cliente, confiável mesmo se o slug divergir)
  // ou pelo path (id/slug). getEstablishment aceita id ou slug.
  const resolveKey = searchParams.get('estabelecimento') || searchParams.get('estabelecimentoId') || idOrSlug;
  const [state, setState] = useState({ loading: true, error: '', establishment: null, services: [] });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    (async () => {
      try {
        const est = await Api.getEstablishment(resolveKey);
        if (!est?.id) throw new Error('not_found');
        const services = await Api.listServices(est.id).catch(() => []);
        if (!alive) return;
        setState({
          loading: false,
          error: '',
          establishment: est,
          services: Array.isArray(services) ? services : [],
        });
      } catch (e) {
        if (!alive) return;
        const notFound = e?.data?.error === 'not_found' || e?.message === 'not_found';
        setState({
          loading: false,
          error: notFound ? 'Estabelecimento não encontrado.' : 'Não foi possível carregar o estabelecimento.',
          establishment: null,
          services: [],
        });
      }
    })();
    return () => { alive = false; };
  }, [resolveKey]);

  const establishmentId = state.establishment?.id || null;

  const wizardServices = useMemo(
    () => (state.services || []).map((s) => ({
      id: s.id,
      nome: s.nome,
      descricao: s.descricao,
      imagem_url: s.imagem_url,
      durationMin: s.duracao_min,
      price: (s.preco_centavos || 0) / 100,
      // Profissionais vinculados ao serviço (o passo só aparece quando há algum).
      professionals: (s.professionals || []).map((p) => ({
        id: p.id,
        nome: p.nome,
        especialidade: p.descricao,
        avatar_url: p.avatar_url,
      })),
    })),
    [state.services],
  );

  // Slots reais: getSlots devolve 7 dias a partir de weekStart -> filtra o dia escolhido.
  const buildSlots = useCallback(async (date, { serviceIds, professionalId } = {}) => {
    if (!establishmentId || !date) return [];
    const resp = await Api.getSlots(establishmentId, ymd(date), {
      serviceIds: serviceIds && serviceIds.length ? serviceIds : undefined,
      professionalId: professionalId || undefined,
    });
    const all = resp?.slots || [];
    return all
      .filter((s) => isSameDay(s.datetime, date))
      .map((s) => ({ datetime: s.datetime, available: s.status === 'free' }));
  }, [establishmentId]);

  const onConfirm = useCallback(async ({ services, professional, date, slot, guest }) => {
    const cpfDigits = (guest?.cpf || '').replace(/\D/g, '');
    const inicio = typeof slot?.datetime === 'string' ? slot.datetime : new Date(slot.datetime).toISOString();
    const payload = {
      estabelecimento_id: Number(establishmentId),
      servico_ids: (services || []).map((s) => s.id),
      inicio,
      nome: (guest?.nome || '').trim(),
      email: (guest?.email || '').trim(),
      telefone: (guest?.telefone || '').replace(/\D/g, ''),
    };
    if (cpfDigits) payload.cpf = cpfDigits;
    if (professional?.id) payload.profissional_id = professional.id;

    let resp;
    try {
      resp = await Api.publicAgendar(payload);
    } catch (e) {
      throw new Error(mapBookingError(e));
    }

    const pix = resp?.pix || null;
    const hasDeposit = Boolean(resp?.deposit_required || resp?.paymentId || pix?.payment_id);
    if (!hasDeposit) {
      return {
        confirmed: true,
        message: 'Agendamento registrado! Confirme pelo link enviado no seu e-mail para garantir o horário.',
      };
    }

    const amountCents = resp?.amount_centavos ?? pix?.amount_cents ?? resp?.deposit_centavos ?? 0;
    return {
      encodedImage: resp?.pix_qr || pix?.qr_code_base64 || null,
      payload: resp?.pix_copia_cola || pix?.copia_e_cola || pix?.qr_code || null,
      value: amountCents / 100,
      expirationDate: resp?.expiresAt || resp?.deposit_expires_at || pix?.expires_at || null,
      status: 'pending',
      paymentId: resp?.paymentId || pix?.payment_id || null,
      token: resp?.deposit_token || null,
    };
  }, [establishmentId]);

  const pollStatus = useCallback(async (paymentId, token) => {
    try {
      const data = await Api.getPaymentStatus(paymentId, { depositToken: token });
      if (data?.paid) return 'paid';
      if (data?.expired) return 'expired';
      return 'pending';
    } catch {
      return null;
    }
  }, []);

  if (state.loading) return <CenterMsg>Carregando…</CenterMsg>;
  if (state.error) return <CenterMsg>{state.error}</CenterMsg>;

  return (
    <div style={{ background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      <BookingWizard
        establishmentName={state.establishment?.nome || 'Agendamento'}
        services={wizardServices}
        buildSlots={buildSlots}
        onConfirm={onConfirm}
        pollStatus={pollStatus}
        collectGuest
      />
    </div>
  );
}

function CenterMsg({ children }) {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted-ink, #6B7280)',
        padding: 24,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}
