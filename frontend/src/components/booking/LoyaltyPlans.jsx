// Vitrine dos planos do estabelecimento — e, para quem já assina, o "meu plano".
// Um componente só, na página onde a decisão acontece: a do estabelecimento.
//
// Fluxo de assinatura (medido em sandbox — ver docs/PLANO-FIDELIDADE-ASAAS.md):
//   assinar -> o backend cria a assinatura no Asaas SEM cartão -> devolve checkout_url
//           -> o cliente digita o cartão NA PÁGINA DO ASAAS
//           -> o Asaas guarda o cartão e cobra os ciclos seguintes sozinho.
// O cartão nunca passa pelo nosso servidor: zero PCI, e nenhum formulário de cartão aqui.
import React, { useCallback, useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';

const money = (cents) => ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function LoyaltyPlans({ establishmentId, idOrSlug }) {
  const [planos, setPlanos] = useState([]);
  const [assinatura, setAssinatura] = useState(null);
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(0);

  const viewer = getUser();
  const isCliente = viewer?.tipo === 'cliente';

  const carregar = useCallback(async () => {
    try {
      const r = await Api.publicLoyaltyPlans(idOrSlug);
      setPlanos(r?.items || []);
    } catch {
      // 503 (recurso desligado) ou 404: a vitrine simplesmente não aparece. Não é erro do
      // cliente e não deve poluir a página de agendamento.
      setPlanos([]);
      return;
    }
    if (!isCliente || !establishmentId) return;
    try {
      const [sub, ctx] = await Promise.all([
        Api.clientLoyaltySubscription({ estabelecimento_id: establishmentId }),
        Api.clientLoyaltyContext({ estabelecimento_id: establishmentId }).catch(() => null),
      ]);
      setAssinatura(sub?.subscription || null);
      setContexto(ctx || null);
    } catch {
      setAssinatura(null);
    }
  }, [idOrSlug, establishmentId, isCliente]);

  useEffect(() => { carregar(); }, [carregar]);

  const assinar = async (plano) => {
    setErro('');
    if (!isCliente) {
      // Sem login não há a quem cobrar. Volta para cá depois de entrar.
      const volta = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${volta}`);
      return;
    }
    setEnviando(plano.id);
    try {
      const r = await Api.clientLoyaltySubscribe({
        estabelecimento_id: establishmentId,
        loyalty_plan_id: plano.id,
      });
      if (r?.checkout_url) {
        // O cartão é digitado no Asaas, não aqui.
        window.location.assign(r.checkout_url);
        return;
      }
      setErro('Assinatura criada, mas o link de pagamento não veio. Tente novamente em instantes.');
      await carregar();
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível assinar agora.');
    } finally {
      setEnviando(0);
    }
  };

  const cancelar = async () => {
    if (!window.confirm('Cancelar o plano? Você continua com os benefícios até o fim do período já pago.')) return;
    try {
      await Api.clientLoyaltyCancel({ subscription_id: assinatura.id });
      await carregar();
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível cancelar.');
    }
  };

  // Sem planos, o bloco não existe — a página do estabelecimento não muda para quem não vende plano.
  if (!planos.length && !assinatura) return null;

  const creditos = contexto?.credits_by_service || contexto?.creditsByService || null;

  return (
    <section className="tw-mx-auto tw-max-w-lg tw-px-4 tw-pt-4">
      {erro && (
        <p className="tw-m-0 tw-mb-2 tw-rounded-xl tw-p-3 tw-text-sm"
          style={{ background: 'var(--status-cancelado-bg)', color: 'var(--status-cancelado-fg)' }} role="alert">
          {erro}
        </p>
      )}

      {assinatura ? (
        <div className="tw-rounded-2xl tw-p-4" style={{ background: 'var(--brand)', color: '#fff' }}>
          <div className="tw-text-xs tw-font-bold tw-uppercase tw-tracking-wide" style={{ opacity: 0.85 }}>
            Seu plano
          </div>
          <div className="tw-mt-1 tw-text-base tw-font-extrabold">
            {contexto?.plan?.nome || assinatura.plan_name || 'Plano ativo'}
          </div>

          {/* O que sobrou no ciclo. É a única pergunta que o assinante realmente faz. */}
          {creditos && Object.keys(creditos).length > 0 && (
            <ul className="tw-m-0 tw-mt-2 tw-list-none tw-p-0 tw-text-sm" style={{ opacity: 0.95 }}>
              {Object.values(creditos).map((c) => (
                <li key={c.servico_id || c.servicoId}>
                  {c.servico_nome || c.nome}: <b>{c.quantidade_restante ?? c.restante ?? 0}</b> restante(s) neste mês
                </li>
              ))}
            </ul>
          )}

          {assinatura.status === 'past_due' && (
            <p className="tw-m-0 tw-mt-2 tw-text-sm">
              Há uma cobrança em aberto. Regularize para não perder os benefícios.
            </p>
          )}

          {assinatura.status !== 'canceled' && (
            <button type="button" onClick={cancelar}
              className="tw-mt-3 tw-rounded-xl tw-border-0 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold"
              style={{ background: 'rgba(255,255,255,.18)', color: '#fff', cursor: 'pointer' }}>
              Cancelar plano
            </button>
          )}
        </div>
      ) : (
        <>
          <h2 className="tw-m-0 tw-mb-2 tw-text-sm tw-font-extrabold tw-uppercase tw-tracking-wide"
            style={{ color: 'var(--muted-ink, #6B7280)' }}>
            Planos
          </h2>
          {planos.map((p) => (
            <div key={p.id} className="tw-mb-2 tw-rounded-2xl tw-p-4"
              style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)' }}>
              <div className="tw-flex tw-items-center tw-gap-2">
                <b className="tw-flex-1" style={{ color: 'var(--ink, #1E1B4B)' }}>{p.nome}</b>
                <span className="tw-font-extrabold" style={{ color: 'var(--brand)' }}>{money(p.preco_centavos)}/mês</span>
              </div>
              {p.descricao && (
                <p className="tw-m-0 tw-mt-1 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>{p.descricao}</p>
              )}
              {Array.isArray(p.items || p.itens) && (p.items || p.itens).length > 0 && (
                <ul className="tw-m-0 tw-mt-2 tw-pl-4 tw-text-sm" style={{ color: 'var(--muted-ink, #6B7280)' }}>
                  {(p.items || p.itens).map((i) => (
                    <li key={i.servico_id}>{i.quantidade_por_ciclo}x {i.servico_nome || 'serviço'} por mês</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => assinar(p)} disabled={enviando === p.id}
                className="tw-mt-3 tw-w-full tw-rounded-xl tw-border-0 tw-py-3 tw-font-semibold tw-text-white"
                style={{ background: 'var(--brand)', cursor: 'pointer', opacity: enviando === p.id ? 0.6 : 1 }}>
                {enviando === p.id ? 'Abrindo pagamento…' : 'Assinar'}
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
