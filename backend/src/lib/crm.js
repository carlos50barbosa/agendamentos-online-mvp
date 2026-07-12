const DAY_MS = 24 * 60 * 60 * 1000;

export const CRM_DEFAULT_DORMANT_DAYS = 45;
export const CRM_INACTIVE_DAYS = 90;

export const CRM_RELATIONSHIP_LABELS = Object.freeze({
  novo: 'Novo',
  recorrente: 'Recorrente',
  vip: 'VIP',
  inativo: 'Inativo',
  sumido: 'Sumido',
});

function toValidDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function computeAverageReturnDays(values = []) {
  const dates = values
    .map((value) => toValidDate(value))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return null;

  let totalGap = 0;
  let gapCount = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const gapDays = Math.round((dates[index].getTime() - dates[index - 1].getTime()) / DAY_MS);
    if (gapDays < 0) continue;
    totalGap += gapDays;
    gapCount += 1;
  }

  if (!gapCount) return null;
  return Math.round(totalGap / gapCount);
}

export function computeDaysSince(value, now = new Date()) {
  const date = toValidDate(value);
  const base = toValidDate(now);
  if (!date || !base) return null;
  const diff = base.getTime() - date.getTime();
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return Math.floor(diff / DAY_MS);
}

export function classifyRelationship({
  totalAppointments = 0,
  daysSinceLastVisit = null,
  isVip = false,
  dormantAfterDays = CRM_DEFAULT_DORMANT_DAYS,
  inactiveAfterDays = CRM_INACTIVE_DAYS,
} = {}) {
  if (isVip) {
    return { code: 'vip', label: CRM_RELATIONSHIP_LABELS.vip };
  }

  if (daysSinceLastVisit != null && daysSinceLastVisit >= inactiveAfterDays) {
    return { code: 'inativo', label: CRM_RELATIONSHIP_LABELS.inativo };
  }

  if (daysSinceLastVisit != null && daysSinceLastVisit >= dormantAfterDays) {
    return { code: 'sumido', label: `Sumido há ${daysSinceLastVisit} dias` };
  }

  if (Number(totalAppointments || 0) >= 2) {
    return { code: 'recorrente', label: CRM_RELATIONSHIP_LABELS.recorrente };
  }

  return { code: 'novo', label: CRM_RELATIONSHIP_LABELS.novo };
}

export const CRM_RISK_CANCEL_RATE = 0.35;
// Sem amostra mínima, "1 agendamento, 1 cancelado" vira 100% e o cliente entra em risco.
export const CRM_RISK_MIN_SAMPLE = 3;

// Uma única definição de "em risco". Antes ela existia duas vezes — no JS sobre a taxa
// ARREDONDADA e no SQL sobre a taxa crua — e as duas discordavam na fronteira: 34,5%
// virava 35 no JS (linha marcada) e continuava 0,345 no SQL (KPI não contava).
export function isAtRisk({
  daysSinceLastVisit = null,
  lifetimeTotal = 0,
  lifetimeCancelled = 0,
  dormantAfterDays = CRM_DEFAULT_DORMANT_DAYS,
} = {}) {
  const dormant = daysSinceLastVisit != null && Number(daysSinceLastVisit) >= dormantAfterDays;
  const total = Number(lifetimeTotal || 0);
  const cancelled = Number(lifetimeCancelled || 0);
  const cancelHeavy = total >= CRM_RISK_MIN_SAMPLE
    && (cancelled / total) >= CRM_RISK_CANCEL_RATE;
  return dormant || cancelHeavy;
}

// A MESMA regra em SQL, para o KPI contar exatamente as linhas que a lista marca.
export function buildCrmRiskSql(alias = 'base') {
  return `(
    COALESCE(${alias}.days_since_last_visit, 0) >= ${CRM_DEFAULT_DORMANT_DAYS}
    OR (
      ${alias}.lifetime_total >= ${CRM_RISK_MIN_SAMPLE}
      AND (${alias}.lifetime_cancelled / ${alias}.lifetime_total) >= ${CRM_RISK_CANCEL_RATE}
    )
  )`;
}

// Janela FECHADA. A cláusula antiga só tinha piso (`a.inicio >= agora-30d`), então
// "últimos 30 dias" deixava passar todo o futuro junto. E o fuso: a.inicio é gravado em
// UTC, NOW() segue o fuso do MySQL.
// periodDays vem de um mapa congelado (7/30/90) — nunca do usuário —, então entra como
// literal e o predicado pode ser repetido na agregação condicional sem embaralhar params.
export function buildCrmPeriodSql(periodDays) {
  const days = Number(periodDays);
  if (!Number.isInteger(days) || days <= 0) return '1=1';
  return `(a.inicio >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${days} DAY) AND a.inicio <= UTC_TIMESTAMP())`;
}

// A janela ANTERIOR, do mesmo tamanho e imediatamente antes — a régua dos deltas dos KPIs.
export function buildCrmPreviousPeriodSql(periodDays) {
  const days = Number(periodDays);
  if (!Number.isInteger(days) || days <= 0) return '1=0'; // sem período, não há anterior
  return `(a.inicio >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${days * 2} DAY) AND a.inicio < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${days} DAY))`;
}

// A MESMA cascata de classifyRelationship, em SQL. Serve tanto para filtrar um segmento
// quanto para contá-lo — e os cinco predicados são mutuamente exclusivos e exaustivos,
// então as contagens somam o total.
//
// Corrige um bug: "novo" testava `days < ${CRM_INACTIVE_DAYS}` (90), mas o JS já chama de
// "sumido" quem passa de 45. Um cliente com 50 dias era contado como novo E como sumido,
// e o filtro "Novos" trazia gente sumida junto.
export function buildCrmRelationshipSql(code, alias = 'base') {
  const vip = `${alias}.is_vip = 1`;
  const naoVip = `${alias}.is_vip = 0`;
  const dias = `${alias}.days_since_last_visit`;
  // Sem visita registrada não há de quando sumir: cai para novo/recorrente, como no JS.
  const recente = `(${dias} IS NULL OR ${dias} < ${CRM_DEFAULT_DORMANT_DAYS})`;

  switch (code) {
    case 'vip':
      return vip;
    case 'inativo':
      return `${naoVip} AND COALESCE(${dias}, 0) >= ${CRM_INACTIVE_DAYS}`;
    case 'sumido':
      return `${naoVip} AND COALESCE(${dias}, 0) >= ${CRM_DEFAULT_DORMANT_DAYS} AND COALESCE(${dias}, 0) < ${CRM_INACTIVE_DAYS}`;
    case 'recorrente':
      return `${naoVip} AND ${recente} AND ${alias}.lifetime_appointments >= 2`;
    case 'novo':
      return `${naoVip} AND ${recente} AND ${alias}.lifetime_appointments < 2`;
    default:
      return null;
  }
}

export function normalizeCrmTags(rawTags = [], { maxItems = 8, maxLength = 40 } = {}) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const normalized = [];

  rawTags.forEach((value) => {
    const text = String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, maxLength);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(text);
  });

  return normalized.slice(0, maxItems);
}

export function computeBirthdayInfo(value, now = new Date()) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const base = toValidDate(now);
  if (!base || !year || !month || !day) return null;

  const currentYear = base.getFullYear();
  let nextBirthday = new Date(currentYear, month - 1, day);
  if (Number.isNaN(nextBirthday.getTime())) return null;
  if (nextBirthday < new Date(base.getFullYear(), base.getMonth(), base.getDate())) {
    nextBirthday = new Date(currentYear + 1, month - 1, day);
  }

  const diffDays = Math.floor(
    (new Date(nextBirthday.getFullYear(), nextBirthday.getMonth(), nextBirthday.getDate()).getTime() -
      new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) /
      DAY_MS
  );

  return {
    day,
    month,
    next_birthday_at: nextBirthday.toISOString(),
    days_until_birthday: diffDays,
    is_birthday_month: base.getMonth() + 1 === month,
  };
}
