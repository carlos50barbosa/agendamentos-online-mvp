// src/lib/janela_agendamento.js
//
// Ate onde no futuro o cliente pode marcar. Ver sql/2026-08-07-add-janela-agendamento.sql
// para o porque; aqui esta o COMO.
//
// A regra inteira cabe em uma linha:
//
//   limite = proxima ocorrencia de (abreDia, abreHora) no fuso local
//          + (semanas - 1) * 7 dias
//
// Tudo antes do limite e agendavel. No instante da abertura o limite pula 7 dias e a semana
// seguinte destrava de uma vez — nao ha janela deslizante, ha um portao que abre.
//
// O calculo e PURO de proposito (recebe `now`, nao chama Date.now internamente): e o que
// permite testar a virada do domingo sem mexer no relogio da maquina.
import { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } from './datetime_tz.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const JANELA_MODO_LIVRE = 'livre';
export const JANELA_MODO_SEMANAL = 'semanal';
// Horizonte deslizante: limite = inicio de hoje + N dias. E o OPOSTO do 'semanal' — anda um
// dia por dia em vez de ficar parado e pular uma semana de uma vez.
export const JANELA_MODO_DIAS = 'dias';

// Teto de 12 semanas: acima disso a janela deixa de restringir qualquer coisa na pratica e
// so serviria para esconder um valor digitado errado.
const MAX_SEMANAS = 12;
// 365 dias: um ano a frente e o limite util. Acima disso o problema deixa de ser horizonte
// e vira lista de dias impossivel de navegar.
const MAX_DIAS = 365;

const clampInt = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  return rounded < min || rounded > max ? fallback : rounded;
};

/**
 * Linha de `establishment_settings` (ou objeto solto do body) -> config normalizada.
 * Valor ausente ou invalido cai no default DESLIGADO: uma config corrompida no banco nunca
 * pode fechar a agenda de quem nunca ligou o recurso.
 */
export function normalizeJanelaConfig(row) {
  const modoRaw = String(row?.janela_modo ?? row?.modo ?? JANELA_MODO_LIVRE).trim().toLowerCase();
  const modo = modoRaw === JANELA_MODO_SEMANAL || modoRaw === JANELA_MODO_DIAS
    ? modoRaw
    : JANELA_MODO_LIVRE;
  return {
    modo,
    // 0=domingo ... 6=sabado — o mesmo indice de Date#getUTCDay e de weekDayIndexInTZ.
    abreDia: clampInt(row?.janela_abre_dia ?? row?.abreDia, 0, 6, 0),
    abreHora: clampInt(row?.janela_abre_hora ?? row?.abreHora, 0, 23, 0),
    semanas: clampInt(row?.janela_semanas ?? row?.semanas, 1, MAX_SEMANAS, 1),
    // 14 e o teto que o wizard publico ja aplicava antes de existir configuracao.
    dias: clampInt(row?.janela_dias ?? row?.dias, 1, MAX_DIAS, 14),
  };
}

/**
 * Config + instante atual -> { limiteUtc, abreEmUtc }.
 * No modo 'livre' os dois vem null, e todo o resto do codigo trata null como "sem limite".
 */
export function computeJanela({ config, now = new Date(), tzOffsetMin = EST_TZ_OFFSET_MIN } = {}) {
  const cfg = config?.modo ? config : normalizeJanelaConfig(config);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const vazio = {
    modo: JANELA_MODO_LIVRE, limiteUtc: null, abreEmUtc: null, semanas: cfg.semanas, dias: cfg.dias,
  };

  if (cfg.modo === JANELA_MODO_LIVRE || !Number.isFinite(nowMs)) return vazio;

  // Deslocar e ler pelos getters UTC da o horario de PAREDE local — mesmo truque do resto
  // do backend (slots.js, datetime_tz.js). O Brasil nao tem mais horario de verao e o
  // projeto usa offset fixo, entao somar dias adiante e exato.
  const local = new Date(nowMs + tzOffsetMin * 60_000);

  if (cfg.modo === JANELA_MODO_DIAS) {
    // Ancora no INICIO DE HOJE (local), nao em "agora": senao o limite andaria de minuto em
    // minuto e o ultimo dia da lista mudaria de tamanho ao longo do dia. Com meia-noite como
    // ancora, "90 dias" sao sempre 90 dias de calendario inteiros.
    const inicioDeHoje = makeUtcFromLocalYMDHM(
      local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 0, 0, tzOffsetMin
    );
    return {
      modo: cfg.modo,
      // Nao ha portao: o limite desliza sozinho, entao nao existe "proxima leva".
      abreEmUtc: null,
      limiteUtc: new Date(inicioDeHoje.getTime() + cfg.dias * DAY_MS),
      semanas: cfg.semanas,
      dias: cfg.dias,
    };
  }

  const diasAteAbertura = (cfg.abreDia - local.getUTCDay() + 7) % 7;
  const alvo = new Date(local.getTime() + diasAteAbertura * DAY_MS);

  let abreEmUtc = makeUtcFromLocalYMDHM(
    alvo.getUTCFullYear(),
    alvo.getUTCMonth() + 1,
    alvo.getUTCDate(),
    cfg.abreHora,
    0,
    tzOffsetMin
  );

  // Hoje E o dia de abrir mas a hora ja passou (ou e exatamente agora): a proxima abertura
  // e a da semana que vem. O `<=` importa — as 00:00 em ponto de domingo a leva ja abriu,
  // entao o limite tem de ser o domingo SEGUINTE, senao a janela nasceria vazia.
  if (abreEmUtc.getTime() <= nowMs) {
    abreEmUtc = new Date(abreEmUtc.getTime() + 7 * DAY_MS);
  }

  return {
    modo: cfg.modo,
    abreEmUtc,
    limiteUtc: new Date(abreEmUtc.getTime() + (cfg.semanas - 1) * 7 * DAY_MS),
    semanas: cfg.semanas,
    dias: cfg.dias,
  };
}

/**
 * O instante cabe na janela? Limite ausente = modo livre = sempre cabe.
 * Comparacao EXCLUSIVA: um slot exatamente no limite so libera quando o portao abre.
 */
export function isDentroDaJanela(dateUtc, janela) {
  if (!janela?.limiteUtc) return true;
  const ms = dateUtc instanceof Date ? dateUtc.getTime() : Number(dateUtc);
  if (!Number.isFinite(ms)) return false;
  return ms < janela.limiteUtc.getTime();
}

/** Le a config do estabelecimento. Sem linha em establishment_settings = modo livre. */
export async function fetchJanelaConfig(db, estabelecimentoId) {
  const [rows] = await db.query(
    `SELECT janela_modo, janela_abre_dia, janela_abre_hora, janela_semanas, janela_dias
       FROM establishment_settings
      WHERE estabelecimento_id=? LIMIT 1`,
    [estabelecimentoId]
  );
  return normalizeJanelaConfig(rows?.[0] || null);
}

/** Atalho para os dois pontos de uso: le a config e ja devolve o limite calculado. */
export async function resolveJanela(db, estabelecimentoId, now = new Date()) {
  const config = await fetchJanelaConfig(db, estabelecimentoId);
  return computeJanela({ config, now });
}

/**
 * Forma que vai para o cliente HTTP. Instantes em ISO-8601 UTC, igual ao GET /slots.
 * O front usa `abre_em` para dizer QUANDO abre; sem isso a grade vazia parece defeito.
 */
export function serializeJanela(janela) {
  return {
    modo: janela?.modo || JANELA_MODO_LIVRE,
    limite: janela?.limiteUtc ? janela.limiteUtc.toISOString() : null,
    // null no modo 'dias': o horizonte desliza sozinho, nao ha "proxima leva" para anunciar.
    abre_em: janela?.abreEmUtc ? janela.abreEmUtc.toISOString() : null,
    semanas: janela?.semanas ?? 1,
    dias: janela?.dias ?? 14,
  };
}
