// Selo de variação vs. período anterior — o mesmo em /relatorios e /clientes.
//
// Num lugar só de propósito: duas implementações do mesmo cálculo divergem, e foi
// exatamente o que aconteceu com a regra de "em risco" no CRM (uma em JS arredondada,
// outra em SQL crua, discordando na fronteira).

const PERCENT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatPercent(value) {
  return PERCENT.format(Number(value) || 0);
}

// Sem base de comparação (período anterior zerado) não existe percentual honesto a mostrar:
// devolve null e o card sai sem o selo, em vez de inventar um "+∞".
export function buildDelta(current, previous, { higherIsBetter = true, format = (value) => value } = {}) {
  const atual = Number(current || 0);
  const anterior = Number(previous);
  if (!Number.isFinite(anterior) || anterior === 0) return null;

  const ratio = (atual - anterior) / anterior;
  const title = `${format(anterior)} no período anterior`;
  if (Math.abs(ratio) < 0.001) return { text: '= estável', tone: 'flat', title };

  const subiu = ratio > 0;
  return {
    text: `${subiu ? '▲' : '▼'} ${formatPercent(Math.abs(ratio))}`,
    tone: (higherIsBetter ? subiu : !subiu) ? 'good' : 'bad',
    title,
  };
}

// Taxa não varia em porcentagem, varia em pontos percentuais: sair de 92% para 95% é
// +3 p.p. Dizer "+3,3%" seria um percentual de um percentual — e ninguém lê assim.
export function buildRateDelta(current, previous, { higherIsBetter = true } = {}) {
  const atual = Number(current || 0);
  const anterior = Number(previous);
  if (!Number.isFinite(anterior)) return null;

  const diff = atual - anterior;
  const title = `${formatPercent(anterior)} no período anterior`;
  if (Math.abs(diff) < 0.001) return { text: '= estável', tone: 'flat', title };

  const subiu = diff > 0;
  const pontos = Math.abs(diff * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return {
    text: `${subiu ? '▲' : '▼'} ${pontos} p.p.`,
    tone: (higherIsBetter ? subiu : !subiu) ? 'good' : 'bad',
    title,
  };
}
