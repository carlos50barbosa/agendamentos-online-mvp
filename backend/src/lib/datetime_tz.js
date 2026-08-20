export const EST_TZ_OFFSET_MIN = -180;

const resolveUtcMs = (dateUtc) => {
  if (!dateUtc) return NaN;
  const ms = dateUtc instanceof Date ? dateUtc.getTime() : new Date(dateUtc).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

// Convert a UTC instant to local minutes-of-day using a fixed offset (UTC-3).
export const minutesOfDayInTZ = (dateUtc, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
  const utcMs = resolveUtcMs(dateUtc);
  if (!Number.isFinite(utcMs)) return null;
  const localMs = utcMs + tzOffsetMin * 60_000;
  const local = new Date(localMs);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

// Day-of-week (0..6) for a UTC instant in a fixed-offset local time.
export const weekDayIndexInTZ = (dateUtc, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
  const utcMs = resolveUtcMs(dateUtc);
  if (!Number.isFinite(utcMs)) return null;
  const localMs = utcMs + tzOffsetMin * 60_000;
  const local = new Date(localMs);
  return local.getUTCDay();
};

// Create a UTC Date from a local Y-M-D H:M using a fixed offset (UTC = local - offset).
export const makeUtcFromLocalYMDHM = (year, month, day, hour, minute, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - tzOffsetMin * 60_000;
  return new Date(utcMs);
};

// ===== O relógio do BANCO ==================================================================
//
// FATO MEDIDO (e não suposto), duas vezes, com um incidente de produção entre as duas:
//
//   NOW()            lido em JS  -> 18:48Z   (= agora, correto)
//   UTC_TIMESTAMP()  lido em JS  -> 21:48Z   (3h à frente)
//
// As colunas de agendamento (`agendamentos.inicio`, `agendamentos.fim`) são DATETIME e são
// SEMPRE gravadas por um objeto Date do JS através do mysql2. O pool em lib/db.js não define
// a opção `timezone`, então o mysql2 usa o default 'local' e serializa no fuso do processo.
// DATETIME não sofre conversão do servidor: o que fica gravado é a HORA LOCAL DE PAREDE.
// O agendamento das 09:00 da recepção está no banco como '...09:00:00', e não como '12:00:00'.
//
// Logo, comparar essas colunas com UTC_TIMESTAMP() compara relógios diferentes e erra por 3h,
// SEMPRE para mais: o predicado "já terminou" fica verdadeiro 3 horas antes de ser verdade.
// O contrário também aconteceu — código que subtraía 180 minutos da coluna para "converter de
// UTC", quando ela nunca esteve em UTC, e o horário saía 3h ATRÁS no CSV.
//
// A causa dos dois lados foi a mesma: comentários pelo repositório afirmando que as colunas
// eram UTC. Este é o único lugar que decide isso agora.
//
// Use SQL_NOW_LOCAL onde antes se usava UTC_TIMESTAMP() contra coluna de agendamento, e
// formatLocalSqlDateTime para montar limite de intervalo que vai como parâmetro.
export const SQL_NOW_LOCAL = `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${EST_TZ_OFFSET_MIN} MINUTE)`;

// Só a data (sem hora) do "agora" local — para DATEDIFF contra coluna local. UTC_DATE() vira
// o dia seguinte às 21:00 locais, e aí "dias sem retornar" pulava 1 no meio da noite.
export const SQL_TODAY_LOCAL = `DATE(${SQL_NOW_LOCAL})`;

/**
 * Instante -> string 'YYYY-MM-DD HH:MM:SS' no relógio de PAREDE local, que é o formato em que
 * as colunas DATETIME estão gravadas.
 *
 * Existe para substituir o par "monta Date com makeUtcFromLocalYMDHM e formata com os getters
 * UTC": esse par devolvia o horário UTC, e um limite de intervalo assim cortava o dia às 03:00
 * em vez de 00:00.
 */
export const formatLocalSqlDateTime = (dateUtc, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
  const utcMs = resolveUtcMs(dateUtc);
  if (!Number.isFinite(utcMs)) return null;
  const local = new Date(utcMs + tzOffsetMin * 60_000);
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`,
  ].join(' ');
};
