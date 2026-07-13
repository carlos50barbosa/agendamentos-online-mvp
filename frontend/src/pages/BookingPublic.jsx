// src/pages/BookingPublic.jsx
// Fase 2: liga o BookingWizard (redesign) ao backend REAL — booking público + sinal via Asaas.
// Resolve o estabelecimento por id/slug na URL (/agendar/:idOrSlug), carrega serviços e horários
// reais, e no onConfirm cria o agendamento guest via publicAgendar. Os profissionais vêm
// vinculados a cada serviço (service.professionals), coerente com a regra do backend
// (profissional obrigatório só quando o serviço tem profissionais linkados).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import BookingWizard from '../components/booking/BookingWizard.jsx';
import LoyaltyPlans from '../components/booking/LoyaltyPlans.jsx';
import { Api } from '../utils/api.js';
import { getUser } from '../utils/auth.js';
import { isSameDay } from '../utils/agendaDates.js';
import { buildPublicThemeStyle, resolvePublicAccent } from '../utils/publicTheme.js';
import NotFound from './NotFound.jsx';

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
      return 'Esse e-mail ou telefone já está cadastrado com dados diferentes. Use o mesmo e-mail e telefone do seu cadastro anterior.';
    case 'subscription_access_blocked':
      // Rede de segurança: a página pública é acessada direto pelo link do estabelecimento, então
      // não há etapa 1 onde avisar antes. Aqui a mensagem ao menos explica o que aconteceu.
      return 'Este estabelecimento não está aceitando agendamentos no momento. Entre em contato com ele.';
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
  // Pré-seleção de serviço via ?servico=id (ou id,id) — o serviço já entra marcado no wizard.
  const servicoParam = searchParams.get('servico') || '';
  const preselectedServiceIds = useMemo(
    () => servicoParam.split(',').map((s) => s.trim()).filter(Boolean),
    [servicoParam],
  );
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
          notFound,
          error: notFound ? '' : 'Não foi possível carregar o estabelecimento.',
          establishment: null,
          services: [],
        });
      }
    })();
    return () => { alive = false; };
  }, [resolveKey]);

  const establishmentId = state.establishment?.id || null;

  // Contexto do plano do cliente logado. Sem ele o wizard mostraria o preço CHEIO enquanto o
  // backend cobra o descontado (applyClientLoyaltyBenefitsTx roda em toda criação): o
  // assinante veria R$ 80 e seria cobrado R$ 0. O preço na tela tem de ser o preço cobrado.
  const [loyalty, setLoyalty] = useState(null);
  useEffect(() => {
    const viewer = getUser();
    if (viewer?.tipo !== 'cliente' || !establishmentId) { setLoyalty(null); return undefined; }
    let alive = true;
    Api.clientLoyaltyContext({ estabelecimento_id: establishmentId })
      .then((ctx) => { if (alive) setLoyalty(ctx?.subscription ? ctx : null); })
      .catch(() => { if (alive) setLoyalty(null); });
    return () => { alive = false; };
  }, [establishmentId]);

  // Cliente logado (fluxo /novo -> /agendar): pré-preenche os dados p/ não redigitar.
  const initialGuest = useMemo(() => {
    const viewer = getUser();
    if (viewer?.tipo !== 'cliente') return null;
    return {
      nome: viewer.nome || viewer.name || '',
      email: viewer.email || '',
      telefone: viewer.telefone || viewer.whatsapp || viewer.phone || viewer.celular || '',
      cpf: viewer.cpf_cnpj || viewer.cpf || '',
    };
  }, []);

  const wizardServices = useMemo(
    () => (state.services || []).map((s) => ({
      id: s.id,
      nome: s.nome,
      descricao: s.descricao,
      imagem_url: s.imagem_url,
      durationMin: s.duracao_min,
      price: (s.preco_centavos || 0) / 100,
      // A API já devolve os mais agendados no topo; `popular` só marca quais são.
      popular: !!s.popular,
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
        message: 'Agendamento registrado! Confirme pelo link enviado no seu e-mail ou WhatsApp para garantir o horário.',
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

  // Identidade visual: aplica a cor de destaque do estabelecimento (perfil.accent_color)
  // como CSS vars no wrapper — cascateia p/ wizard e header. Sem cor customizada => null,
  // mantendo o índigo global padrão para quem não configurou nada.
  const themeStyle = useMemo(() => {
    const profile = state.establishment?.profile || null;
    const { accent, accentStrong } = resolvePublicAccent(profile, searchParams);
    if (!accent) return null;
    return buildPublicThemeStyle({ accent, accentStrong });
  }, [state.establishment, searchParams]);

  if (state.loading) return <CenterMsg>Carregando…</CenterMsg>;
  if (state.notFound) return <NotFound />;
  if (state.error) return <CenterMsg>{state.error}</CenterMsg>;

  // Assinatura vencida: a página do estabelecimento continua de pé (capa, perfil, serviços e
  // preços) — só a ação de agendar é desligada, com o aviso logo abaixo da capa. O cliente veio
  // por aquele link para ver aquele estabelecimento; sumir com tudo puniria ele por um problema
  // que não é dele.
  const bookingDisabled = state.establishment?.booking_enabled === false;

  return (
    <div style={{ ...(themeStyle || {}), background: 'var(--bg-lav, #F6F5FB)', minHeight: '100%' }}>
      {/* Vitrine de planos + "meu plano". Some sozinha quando o estabelecimento nao vende
          plano — a pagina de quem nao usa o recurso nao muda em nada. */}
      <LoyaltyPlans establishmentId={establishmentId} idOrSlug={resolveKey} />
      <BookingWizard
        establishmentName={state.establishment?.nome || 'Agendamento'}
        establishment={state.establishment}
        services={wizardServices}
        buildSlots={buildSlots}
        onConfirm={onConfirm}
        pollStatus={pollStatus}
        preselectedServiceIds={preselectedServiceIds}
        initialGuest={initialGuest}
        bookingDisabled={bookingDisabled}
        loyalty={loyalty}
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
