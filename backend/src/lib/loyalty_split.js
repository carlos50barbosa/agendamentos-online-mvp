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
// mês. Com percentual, a divisão é estável independente da taxa.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// COMO O ASAAS REALMENTE CALCULA — MEDIDO NO SANDBOX EM 2026-07-13, não deduzido:
//
//   bruto R$  10 → taxa 0,99 → líquido  9,01 → 95% = 8,5595  → repassou R$  8,55
//   bruto R$  80 → taxa 0,99 → líquido 79,01 → 95% = 75,0595 → repassou R$ 75,05
//   bruto R$ 100 → taxa 0,99 → líquido 99,01 → 95% = 94,0595 → repassou R$ 94,05
//   bruto R$  80 → taxa 0,99 → líquido 79,01 → 92,5% = 73,0842 → repassou R$ 73,08
//
//   1) O percentual incide sobre o LÍQUIDO (bruto − taxa do Asaas), NÃO sobre o bruto.
//   2) O Asaas TRUNCA para centavos (se arredondasse, 8,5595 viraria 8,56).
//
// Consequência que muda o modelo de negócio: a taxa do Asaas é RATEADA na proporção do
// split. Com 5% de comissão, o estabelecimento absorve 95% da taxa e a plataforma 5% —
// ninguém "paga a taxa" sozinho. Ou seja: a comissão da plataforma é 5% do LÍQUIDO, e não
// 5% do bruto. Num plano de R$ 80 no cartão, a diferença é de ~R$ 0,14/mês por assinante.
//
// Tentar cravar 5% do BRUTO exigiria recalcular o percentual a cada mudança de taxa — e o
// split de uma ASSINATURA é definido uma vez, na criação, e aplicado a todos os ciclos.
// Seria a mesma fragilidade do fixedValue, de volta pela porta dos fundos.
// ─────────────────────────────────────────────────────────────────────────────────────

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
 * Reproduz a conta do Asaas (medida, ver cabeçalho): o percentual incide sobre o líquido e
 * o resultado é TRUNCADO para centavos.
 *
 * `asaasFeeCents` é a taxa do meio de pagamento. Ela NÃO é enviada ao Asaas — ele desconta a
 * dele por conta própria. Serve para exibir o rateio ao dono no painel ("de R$ 80 você recebe
 * R$ 75,05"). Com a taxa em 0, o resultado é o teto teórico, não a realidade.
 *
 * @returns {{grossCents, asaasFeeCents, netCents, establishmentCents, platformCents, establishmentPercent}}
 */
export function computeLoyaltySplitAmounts({ grossCents, asaasFeeCents = 0, platformPercent } = {}) {
  const gross = Math.max(0, toIntCents(grossCents));
  const fee = Math.min(gross, Math.max(0, toIntCents(asaasFeeCents)));
  const establishmentPercent = resolveEstablishmentPercent(platformPercent);

  const netCents = gross - fee;
  // Trunca, como o Asaas: Math.floor, não Math.round.
  const establishmentCents = Math.floor((netCents * establishmentPercent) / 100);
  const platformCents = netCents - establishmentCents;

  return {
    grossCents: gross,
    asaasFeeCents: fee,
    netCents,
    establishmentCents,
    platformCents,
    establishmentPercent,
  };
}
