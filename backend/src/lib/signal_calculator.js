// backend/src/lib/signal_calculator.js
// Cálculo PURO do sinal (depósito) e do split para o estabelecimento.
// Regras: inteiros em centavos; sem I/O. Reutilizável pelo Mercado Pago (só totalCents,
// split/fee ignorados) e pelo Asaas (total + split via fixedValue).

export class SignalTooLowError extends Error {
  constructor(message = 'valor de sinal muito baixo') {
    super(message);
    this.name = 'SignalTooLowError';
    this.code = 'signal_too_low';
  }
}

function toIntCents(value) {
  const n = Math.round(Number(value || 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Valor do sinal cobrado do cliente (centavos), a partir do preço do serviço e da config.
 * @param {object} p
 * @param {number} p.servicePriceCents
 * @param {{type?:'PERCENT'|'FIXED', percent?:number, fixedCents?:number, minCents?:number, maxCents?:number}} p.config
 * @param {number} [p.systemMinCents] piso mínimo do sistema (ex.: mínimo viável do sinal
 *   Asaas). Sobrepõe o teto do tenant e é limitado pelo preço do serviço. 0/omitido = sem piso.
 */
export function computeSignalTotalCents({ servicePriceCents, config, systemMinCents } = {}) {
  const price = Math.max(0, toIntCents(servicePriceCents));
  const type = String(config?.type || 'PERCENT').toUpperCase();

  let total;
  if (type === 'FIXED') {
    total = Math.max(0, toIntCents(config?.fixedCents));
  } else {
    const percent = Number(config?.percent || 0);
    total = Math.ceil((price * (percent > 0 ? percent : 0)) / 100);
  }

  const minCents = config?.minCents != null ? toIntCents(config.minCents) : null;
  const maxCents = config?.maxCents != null ? toIntCents(config.maxCents) : null;
  if (minCents != null) total = Math.max(total, minCents);
  if (maxCents != null) total = Math.min(total, maxCents);

  // Piso do sistema (viabilidade do split): sobrepõe o teto do tenant.
  const sysMin = systemMinCents != null ? Math.max(0, toIntCents(systemMinCents)) : 0;
  if (sysMin > 0) total = Math.max(total, sysMin);

  // O sinal nunca excede o preço do serviço.
  if (price > 0) total = Math.min(total, price);

  return Math.max(0, total);
}

/**
 * Split (repasse fixo ao estabelecimento) em centavos:
 *   splitCents = totalCents - platformFeeCents - asaasFeeEstimateCents
 * Rejeita com SignalTooLowError se <= 0 (o Asaas rejeita split maior que o líquido da
 * cobrança). Chamar ANTES de qualquer requisição ao Asaas.
 */
export function computeSplitCents({ totalCents, platformFeeCents = 0, asaasFeeEstimateCents = 0 } = {}) {
  const total = toIntCents(totalCents);
  const platformFee = Math.max(0, toIntCents(platformFeeCents));
  const asaasFee = Math.max(0, toIntCents(asaasFeeEstimateCents));
  const split = total - platformFee - asaasFee;
  if (split <= 0) throw new SignalTooLowError();
  return split;
}

/** Conveniência: { totalCents, splitCents, platformFeeCents } numa única chamada. */
export function computeSignal({ servicePriceCents, config, systemMinCents, platformFeeCents = 0, asaasFeeEstimateCents = 0 } = {}) {
  const totalCents = computeSignalTotalCents({ servicePriceCents, config, systemMinCents });
  const splitCents = computeSplitCents({ totalCents, platformFeeCents, asaasFeeEstimateCents });
  return { totalCents, splitCents, platformFeeCents: Math.max(0, toIntCents(platformFeeCents)) };
}
