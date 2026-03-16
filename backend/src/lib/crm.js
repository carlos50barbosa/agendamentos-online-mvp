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
    return { code: 'sumido', label: `Sumido ha ${daysSinceLastVisit} dias` };
  }

  if (Number(totalAppointments || 0) >= 2) {
    return { code: 'recorrente', label: CRM_RELATIONSHIP_LABELS.recorrente };
  }

  return { code: 'novo', label: CRM_RELATIONSHIP_LABELS.novo };
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
