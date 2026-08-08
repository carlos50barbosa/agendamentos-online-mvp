// src/lib/bloqueios.js
// Bloqueios de agenda: normalizacao do que chega da API e checagem de sobreposicao.
//
// REGRA CENTRAL DE ESCOPO (a mesma em todo lugar que le a tabela):
//   - bloqueio com profissional_id NULL  -> bloqueia o estabelecimento inteiro;
//   - bloqueio com profissional_id = X   -> bloqueia SOMENTE agendamentos do profissional X.
// Um agendamento sem profissional (profissional_id NULL) so casa com bloqueio NULL — senao o
// bloqueio de uma unica manicure fecharia a agenda do salao inteiro.
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } from './datetime_tz.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MOTIVO_MAX_LEN = 180;

// Teto de sanidade: um bloqueio maior que isso e quase certamente erro de digitacao no ano
// (2026 -> 2036) e apagaria a agenda inteira sem que o dono percebesse.
export const MAX_BLOCK_DAYS = 366;

const toDate = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

// Y/M/D locais (UTC-3 fixo) de um instante UTC. Usa getUTC* sobre o instante deslocado
// justamente para nao depender do fuso do processo, que varia entre a VPS e a maquina local.
const localYmd = (dateUtc) => {
  const local = new Date(dateUtc.getTime() + EST_TZ_OFFSET_MIN * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
  };
};

const normalizeMotivo = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().slice(0, MOTIVO_MAX_LEN);
  return trimmed === '' ? null : trimmed;
};

const normalizeProfissionalId = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) return NaN;
  return parsed;
};

/**
 * Valida e normaliza o corpo de criacao de bloqueio.
 * -> { ok: true, inicioDate, fimDate, profissionalId, motivo, diaInteiro }
 * -> { ok: false, error: 'inicio_invalido' | 'fim_invalido' | 'intervalo_invalido'
 *                        | 'intervalo_muito_longo' | 'profissional_invalido' }
 */
export function normalizeBlockInput({ inicio, fim, dia_inteiro, profissional_id, motivo } = {}) {
  let inicioDate = toDate(inicio);
  if (!inicioDate) return { ok: false, error: 'inicio_invalido' };

  let fimDate = toDate(fim);
  if (!fimDate) return { ok: false, error: 'fim_invalido' };

  const profissionalId = normalizeProfissionalId(profissional_id);
  if (Number.isNaN(profissionalId)) return { ok: false, error: 'profissional_invalido' };

  const diaInteiro = Boolean(dia_inteiro);
  if (diaInteiro) {
    // "Dia inteiro" e sempre o DIA LOCAL, nao 24h a partir da hora recebida: o dono marcou
    // o dia num calendario. Guardamos ja expandido para que a sobreposicao continue sendo
    // uma comparacao de instantes, sem caso especial em quem le.
    const inicioYmd = localYmd(inicioDate);
    const fimYmd = localYmd(fimDate);
    inicioDate = makeUtcFromLocalYMDHM(inicioYmd.year, inicioYmd.month, inicioYmd.day, 0, 0, EST_TZ_OFFSET_MIN);
    // Fim exclusivo: 00:00 do dia SEGUINTE ao ultimo dia bloqueado (Date.UTC normaliza a
    // virada de mes/ano). Sem o +1 o dia escolhido nao seria bloqueado de fato.
    fimDate = makeUtcFromLocalYMDHM(fimYmd.year, fimYmd.month, fimYmd.day + 1, 0, 0, EST_TZ_OFFSET_MIN);
  }

  if (fimDate.getTime() <= inicioDate.getTime()) return { ok: false, error: 'intervalo_invalido' };
  if (fimDate.getTime() - inicioDate.getTime() > MAX_BLOCK_DAYS * DAY_MS) {
    return { ok: false, error: 'intervalo_muito_longo' };
  }

  return {
    ok: true,
    inicioDate,
    fimDate,
    profissionalId,
    motivo: normalizeMotivo(motivo),
    diaInteiro,
  };
}

/**
 * Bloqueios que se sobrepoem a [inicioDate, fimDate) e que valem para `profissionalId`
 * (REGRA CENTRAL). Sobreposicao e `inicio < fimDate AND fim > inicioDate` — comparar so o
 * inicio deixaria passar servico longo que comeca antes e atravessa o bloqueio.
 */
export async function findBlocksOverlappingTx({
  db,
  estabelecimentoId,
  profissionalId = null,
  inicioDate,
  fimDate,
  forUpdate = false,
  excludeBlockId = null,
}) {
  let sql = `SELECT id, inicio, fim, profissional_id, motivo, dia_inteiro
       FROM bloqueios
      WHERE estabelecimento_id=?
        AND inicio < ?
        AND fim > ?`;
  const params = [estabelecimentoId, fimDate, inicioDate];

  if (profissionalId == null) {
    sql += ' AND profissional_id IS NULL';
  } else {
    sql += ' AND (profissional_id IS NULL OR profissional_id=?)';
    params.push(Number(profissionalId));
  }

  if (excludeBlockId != null) {
    sql += ' AND id<>?';
    params.push(excludeBlockId);
  }

  if (forUpdate) sql += ' FOR UPDATE';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Checagem usada pelo enforcement de agendamento. Roda com FOR UPDATE porque acontece dentro
 * da transacao que cria/remarca o agendamento — sem o lock, um bloqueio criado no meio da
 * corrida seria ignorado.
 */
export async function checkBlockConflictTx({
  db,
  estabelecimentoId,
  profissionalId = null,
  inicioDate,
  fimDate,
}) {
  const rows = await findBlocksOverlappingTx({
    db,
    estabelecimentoId,
    profissionalId,
    inicioDate,
    fimDate,
    forUpdate: true,
  });
  if (!rows.length) return { ok: true };

  const bloqueio = rows[0];
  return {
    ok: false,
    error: 'slot_bloqueado',
    // Mensagem generica de PROPOSITO: `motivo` e nota interna do dono ("dentista", "viagem")
    // e nao pode vazar para quem esta agendando.
    message: 'Horário bloqueado na agenda.',
    bloqueio: { id: bloqueio.id, inicio: bloqueio.inicio, fim: bloqueio.fim },
  };
}
