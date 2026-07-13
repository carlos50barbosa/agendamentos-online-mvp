// backend/src/lib/loyalty_split.js
// Cálculo PURO do split do plano recorrente que o estabelecimento vende ao SEU cliente.
// Sem I/O. Espelha lib/signal_calculator.js, com uma diferença deliberada:
//
//   O sinal usa split por VALOR FIXO (fixedValue = total - taxaPlataforma - taxaAsaasEstimada).
//   O plano usa split PERCENTUAL.
//
// Por quê: o sinal é avulso e sempre PIX, então a taxa do Asaas é previsível e dá para
// descontá-la em centavos. O plano é recorrente e o cliente pode trocar o meio de pagamento
// entre ciclos — a taxa muda, e uma estimativa fixa passaria a errar silenciosamente, mês a
// mês, sem ninguém perceber. Com percentual, a divisão é estável independente da taxa.
//
// ⚠️ PENDÊNCIA DE SANDBOX: falta confirmar se o `percentualValue` do Asaas incide sobre o
// valor BRUTO ou LÍQUIDO da cobrança. Isso decide quem absorve a taxa do cartão. As funções
// de ESTIMATIVA abaixo assumem o modelo do sinal (a taxa sai do bolso do estabelecimento) e
// existem só para EXIBIR o líquido ao dono — nunca para compor o split enviado ao Asaas.

export class InvalidPlatformPercentError extends Error {
  constructor(message = 'percentual da plataforma inválido') {
    super(message);
    this.name = 'InvalidPlatformPercentError';
    this.code = 'invalid_platform_percent';
  }
}

function toIntCents(value) {
  const n = Math.round(Number(value || 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Percentual que fica com o estabelecimento (o resto da comissão da plataforma).
 * Rejeita <0, >=100 e NaN: um split de 0% ao estabelecimento seria a plataforma ficando com
 * o plano inteiro, e o Asaas rejeita percentual fora de (0, 100].
 */
export function resolveEstablishmentPercent(platformPercent) {
  const platform = Number(platformPercent);
  if (!Number.isFinite(platform) || platform < 0 || platform >= 100) {
    throw new InvalidPlatformPercentError(`percentual da plataforma inválido: ${platformPercent}`);
  }
  // 2 casas: o Asaas aceita decimal, mas arredondar evita 4.999999999 vindo de float.
  return Math.round((100 - platform) * 100) / 100;
}

/**
 * Array de split pronto para o Asaas (assinatura ou cobrança avulsa).
 * `null` quando não há walletId — o chamador decide se isso é erro (plano) ou fallback
 * de conta única (sinal, ASAAS_SPLIT_DISABLED).
 */
export function buildLoyaltySplit({ walletId, platformPercent } = {}) {
  const wallet = String(walletId || '').trim();
  if (!wallet) return null;
  const percentualValue = resolveEstablishmentPercent(platformPercent);
  return [{ walletId: wallet, percentualValue }];
}

/**
 * Estimativa do rateio de UM ciclo, em centavos — para o painel do dono ("de R$ 80 você
 * recebe R$ 73,11"). NÃO é o que vai no split: o Asaas desconta a taxa real por conta dele.
 * @returns {{priceCents, platformFeeCents, asaasFeeCents, establishmentNetCents, establishmentPercent}}
 */
export function estimateLoyaltyCycleAmounts({
  priceCents,
  platformPercent,
  cardFeePercent = 0,
  cardFeeFixedCents = 0,
} = {}) {
  const price = Math.max(0, toIntCents(priceCents));
  const establishmentPercent = resolveEstablishmentPercent(platformPercent);

  const platformFeeCents = Math.round((price * (100 - establishmentPercent)) / 100);
  const asaasFeeCents = Math.max(
    0,
    Math.round((price * Math.max(0, Number(cardFeePercent) || 0)) / 100) + Math.max(0, toIntCents(cardFeeFixedCents)),
  );
  const establishmentNetCents = price - platformFeeCents - asaasFeeCents;

  return {
    priceCents: price,
    platformFeeCents,
    asaasFeeCents,
    establishmentNetCents,
    establishmentPercent,
  };
}
