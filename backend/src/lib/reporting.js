const DAY_MS = 24 * 60 * 60 * 1000;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

const formatCents = (cents) => BRL.format((Number(cents) || 0) / 100);
const formatRatio = (value) => PCT.format(Number(value) || 0);
const plural = (n, singular, pluralWord) => `${n} ${n === 1 ? singular : pluralWord}`;

const WEEKDAY_NAMES = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

export const LEAD_TIME_BUCKETS = [
  { key: '0-1d', label: '0-1d', minDays: 0, maxDays: 1, order: 1 },
  { key: '2-3d', label: '2-3d', minDays: 2, maxDays: 3, order: 2 },
  { key: '4-7d', label: '4-7d', minDays: 4, maxDays: 7, order: 3 },
  { key: '8-14d', label: '8-14d', minDays: 8, maxDays: 14, order: 4 },
  { key: '15+d', label: '15+d', minDays: 15, maxDays: null, order: 5 },
];

const pad2 = (value) => String(value).padStart(2, '0');

export function parseLocalDate(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatLocalDate(date) {
  if (!date) return '';
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function shiftLocalDate(date, deltaDays) {
  if (!date || !Number.isFinite(deltaDays)) return null;
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const next = new Date(base + deltaDays * DAY_MS);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function buildLocalDateSeries(startLocal, endLocal) {
  if (!startLocal || !endLocal) return [];
  const startMs = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endMs = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  if (startMs > endMs) return [];
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += DAY_MS) {
    const current = new Date(ts);
    out.push(`${current.getUTCFullYear()}-${pad2(current.getUTCMonth() + 1)}-${pad2(current.getUTCDate())}`);
  }
  return out;
}

export function fillDailySeries(rows, startLocal, endLocal) {
  const series = buildLocalDateSeries(startLocal, endLocal);
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = row.dia || row.date || row.data;
    if (!key) return;
    map.set(String(key), row);
  });

  return series.map((date) => {
    const row = map.get(date) || {};
    return {
      date,
      confirmados: Number(row.confirmados || 0),
      cancelados: Number(row.cancelados || 0),
      concluidos: Number(row.concluidos || 0),
      no_show: Number(row.no_show || 0),
      receita_prevista: Number(row.receita_prevista || 0),
      receita_concluida: Number(row.receita_concluida || 0),
    };
  });
}

// Join dos itens do agendamento. Com filtro de serviço ativo, restringe os itens aos
// serviços filtrados: o WHERE (EXISTS) decide QUAIS agendamentos entram, este join decide
// QUAL dinheiro é somado. Sem isso a receita de um combo entra inteira ao filtrar um serviço.
export function buildServiceItemJoin(serviceIds) {
  const ids = Array.isArray(serviceIds) ? serviceIds : [];
  if (!ids.length) {
    return { sql: 'LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id', params: [] };
  }
  const placeholders = ids.map(() => '?').join(', ');
  return {
    sql: `LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id AND ai.servico_id IN (${placeholders})`,
    params: [...ids],
  };
}

// Deriva os KPIs a partir da linha de totais. Usada para o período atual e para o anterior,
// então as duas janelas são medidas exatamente pela mesma régua.
export function summarizeTotals(row) {
  const totals = {
    agendados_total: Number(row?.agendados_total || 0),
    confirmados_total: Number(row?.confirmados_total || 0),
    concluidos_total: Number(row?.concluidos_total || 0),
    cancelados_total: Number(row?.cancelados_total || 0),
    pendentes_total: Number(row?.pendentes_total || 0),
    aguardando_sinal_total: Number(row?.aguardando_sinal_total || 0),
    no_show_total: Number(row?.no_show_total || 0),
  };

  const prevista = Number(row?.receita_prevista || 0);
  const concluida = Number(row?.receita_concluida || 0);
  const perdida = Number(row?.receita_perdida || 0);

  // Comparecimento só se mede sobre o que já aconteceu: concluídos + no_show. Usar confirmados
  // aqui jogaria os agendamentos futuros no denominador.
  const attendanceBase = totals.concluidos_total + totals.no_show_total;

  const rates = {
    taxa_confirmacao: totals.agendados_total ? totals.confirmados_total / totals.agendados_total : 0,
    taxa_cancelamento: totals.agendados_total ? totals.cancelados_total / totals.agendados_total : 0,
    taxa_comparecimento: attendanceBase ? totals.concluidos_total / attendanceBase : 0,
  };

  const revenue = {
    prevista,
    concluida,
    perdida,
    // Ticket médio realizado: mesma base do card "Receita realizada".
    ticket_medio: totals.concluidos_total ? Math.round(concluida / totals.concluidos_total) : 0,
  };

  return { totals, rates, revenue };
}

// Clientes novos x recorrentes: compara a primeira visita de cada cliente do período com o
// início do período. Os '?' precisam sair na MESMA ordem em que aparecem no texto do SQL —
// o mysql2 liga por posição e, se a contagem bater, um desalinhamento passa silencioso.
const cap = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// Frases geradas a partir do que já está no payload. Cada candidato devolve um insight ou nada;
// sobrevivem os 4 primeiros com substância, para a tela não virar um mural de obviedades.
export function buildInsights({
  totals,
  revenue,
  previous,
  topDaysOfWeek = [],
  leadTime = [],
  topServices = [],
  customerMix,
  rangeDays = 0,
} = {}) {
  if (!totals || !revenue) return [];

  const out = [];
  const push = (id, tone, text) => out.push({ id, tone, text });
  const prevTotals = previous?.totals;
  const prevRevenue = previous?.revenue;

  // Volume vs. período anterior.
  if (Number(prevTotals?.agendados_total || 0) > 0) {
    const atual = totals.agendados_total;
    const anterior = prevTotals.agendados_total;
    const ratio = (atual - anterior) / anterior;
    const janela = `nos ${rangeDays} dias anteriores`;
    if (Math.abs(ratio) < 0.05) {
      push('volume', 'neutral', `Volume estável: ${plural(atual, 'agendamento', 'agendamentos')}, praticamente o mesmo que ${janela}.`);
    } else {
      push('volume', ratio > 0 ? 'positive' : 'negative',
        `${plural(atual, 'agendamento', 'agendamentos')} no período — ${formatRatio(Math.abs(ratio))} ${ratio > 0 ? 'a mais' : 'a menos'} que ${janela}.`);
    }
  }

  // Receita vs. período anterior. Vale à parte do volume: dá para agendar mais e faturar menos.
  if (Number(prevRevenue?.concluida || 0) > 0) {
    const atual = revenue.concluida;
    const anterior = prevRevenue.concluida;
    const ratio = (atual - anterior) / anterior;
    if (Math.abs(ratio) >= 0.05) {
      push('receita', ratio > 0 ? 'positive' : 'negative',
        `Receita realizada de ${formatCents(atual)}, ${formatRatio(Math.abs(ratio))} ${ratio > 0 ? 'acima' : 'abaixo'} do período anterior (${formatCents(anterior)}).`);
    }
  }

  // Dinheiro deixado na mesa.
  if (revenue.perdida > 0) {
    const partes = [];
    if (totals.cancelados_total) partes.push(plural(totals.cancelados_total, 'cancelamento', 'cancelamentos'));
    if (totals.no_show_total) partes.push(plural(totals.no_show_total, 'falta', 'faltas'));
    const detalhe = partes.length ? ` (${partes.join(' e ')})` : '';
    push('perdas', 'negative', `Cancelamentos e faltas custaram ${formatCents(revenue.perdida)}${detalhe}.`);
  }

  // Dia mais forte e mais fraco. O "mais fraco" só olha dias com movimento — senão o insight
  // vira "domingo é seu dia mais fraco" para quem nem abre no domingo.
  const comMovimento = topDaysOfWeek.filter((dia) => Number(dia.total || 0) > 0);
  if (comMovimento.length >= 2) {
    const melhor = comMovimento.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a));
    const pior = comMovimento.reduce((a, b) => (Number(b.total) < Number(a.total) ? b : a));
    if (Number(melhor.total) > Number(pior.total)) {
      push('dia_semana', 'neutral',
        `${cap(WEEKDAY_NAMES[melhor.dow])} é seu dia mais forte (${plural(Number(melhor.total), 'agendamento', 'agendamentos')}); ${WEEKDAY_NAMES[pior.dow]} é o mais fraco (${pior.total}).`);
    }
  }

  // Antecedência: quem agenda em cima da hora responde a lembrete, não a planejamento.
  const totalLead = leadTime.reduce((acc, bucket) => acc + Number(bucket.total || 0), 0);
  const emCimaDaHora = Number(leadTime.find((bucket) => bucket.key === '0-1d')?.total || 0);
  if (totalLead > 0 && emCimaDaHora / totalLead >= 0.4) {
    push('antecedencia', 'neutral',
      `${formatRatio(emCimaDaHora / totalLead)} dos agendamentos são feitos com menos de 1 dia de antecedência.`);
  }

  // Concentração de receita em um único serviço.
  const lider = [...topServices]
    .sort((a, b) => Number(b.receita_concluida || 0) - Number(a.receita_concluida || 0))[0];
  if (lider && revenue.concluida > 0) {
    const share = Number(lider.receita_concluida || 0) / revenue.concluida;
    if (share >= 0.3) {
      push('servico', 'neutral', `${lider.nome} responde por ${formatRatio(share)} da sua receita realizada.`);
    }
  }

  // Mix de clientes.
  const novos = Number(customerMix?.new_clients || 0);
  const recorrentes = Number(customerMix?.recurring_clients || 0);
  if (novos + recorrentes > 0) {
    const share = recorrentes / (novos + recorrentes);
    push('clientes', share >= 0.5 ? 'positive' : 'neutral',
      `${formatRatio(share)} dos clientes do período já tinham vindo antes (${recorrentes} de ${novos + recorrentes}).`);
  }

  return out.slice(0, 4);
}

export function buildCustomerMixQuery({ estId, startUtc, endUtc, whereClause, whereParams }) {
  const sql = `
      SELECT
        SUM(CASE WHEN first_seen.first_seen_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_clients,
        SUM(CASE WHEN first_seen.first_seen_at < ? THEN 1 ELSE 0 END) AS recurring_clients
      FROM (
        SELECT DISTINCT a.cliente_id
        FROM agendamentos a
        WHERE ${whereClause}
      ) current_clients
      LEFT JOIN (
        SELECT cliente_id, MIN(inicio) AS first_seen_at
        FROM agendamentos
        WHERE estabelecimento_id = ?
        GROUP BY cliente_id
      ) first_seen ON first_seen.cliente_id = current_clients.cliente_id`;

  const params = [startUtc, endUtc, startUtc, ...(whereParams || []), estId];
  return { sql, params };
}

export function normalizeLeadTimeRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = row.bucket || row.key || row.label;
    if (!key) return;
    map.set(String(key), row);
  });

  return LEAD_TIME_BUCKETS.map((bucket) => {
    const row = map.get(bucket.key) || {};
    return {
      ...bucket,
      total: Number(row.total || 0),
      receita_centavos: Number(row.receita_centavos || 0),
    };
  });
}
