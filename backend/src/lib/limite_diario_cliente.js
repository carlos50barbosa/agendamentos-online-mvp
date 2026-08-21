// backend/src/lib/limite_diario_cliente.js
//
// Trava opcional: quantos agendamentos o MESMO cliente pode ter no MESMO dia neste
// estabelecimento.
//
// Por que existe: cliente que marca dois ou tres horarios do mesmo dia "para garantir" e
// comparece a um. Os outros ficam ocupados e ninguem mais consegue pegar. Quem paga a conta e o
// estabelecimento, que ve a agenda cheia e o dia vazio. Caso real que motivou (19/08/2026): a
// mesma pessoa marcou 16:00 e 16:30 no estabelecimento 194 com 57 segundos de diferenca.
//
// Por que e OPCIONAL, e desligada por padrao: depende do negocio. Salao de unha com cliente que
// faz mao e pe em sessoes separadas quer dois; barbearia nao quer nenhum. Nao existe resposta
// certa para todo mundo, entao a resposta e do dono. Nenhum estabelecimento existente muda de
// comportamento quando esta migration sobe.
//
// ─── O que este modulo NAO consegue fazer ────────────────────────────────────────────────────
//
// A chave e `agendamentos.cliente_id` — uma linha em `usuarios`. Se a MESMA pessoa aparecer no
// banco como DUAS linhas (e-mail diferente e telefone diferente), o sistema nao tem como saber
// que sao a mesma, e a trava nao pega. Aconteceu em producao com os cadastros 264/265 em
// 19/08/2026: dois e-mails digitados errado e um telefone com um digito faltando produziram duas
// identidades e dois agendamentos no mesmo dia. Isto esta escrito aqui de proposito, para
// ninguem prometer ao dono uma garantia que a trava nao da.
//
// Contar por telefone em vez de por cliente_id NAO resolveria e pioraria: `usuarios.telefone` e
// mutavel (o agendamento publico o reescreve a cada marcacao) e nao tem UNIQUE, entao a contagem
// mudaria de balde sozinha conforme a pessoa corrigisse o numero.
import {
  EST_TZ_OFFSET_MIN,
  formatLocalSqlDateTime,
  makeUtcFromLocalYMDHM,
} from './datetime_tz.js';

export const LIMITE_DIARIO_MAX_PADRAO = 1;

// Teto de sanidade do campo. Acima disto a trava nao esta mais travando nada, e o numero
// provavelmente veio de dedo errado no formulario.
export const LIMITE_DIARIO_MAX_TETO = 20;

/**
 * Linha de `establishment_settings` -> config. Linha ausente, coluna ausente ou valor corrompido
 * significam DESLIGADO, no mesmo criterio de normalizeJanelaConfig: uma trava que se liga sozinha
 * por causa de dado estranho e pior do que uma que fica desligada.
 */
export function normalizeLimiteDiarioConfig(row) {
  const ativo = Number(row?.limite_diario_ativo) === 1;
  const rawMax = Number(row?.limite_diario_max);
  const max =
    Number.isFinite(rawMax) && rawMax >= 1
      ? Math.min(LIMITE_DIARIO_MAX_TETO, Math.floor(rawMax))
      : LIMITE_DIARIO_MAX_PADRAO;
  return { ativo, max };
}

/**
 * Os dois limites do dia LOCAL que contem `inicioDate`, no formato em que a coluna esta gravada.
 *
 * `agendamentos.inicio` e DATETIME em hora de PAREDE local, nunca UTC (a medicao esta em
 * lib/datetime_tz.js). Por isso aqui NAO se usa CONVERT_TZ, nem UTC_TIMESTAMP(), nem
 * DATE(inicio)=CURDATE(): qualquer um dos tres desloca o dia em 3 horas e a trava passa a cortar
 * a meia-noite errada — bloqueando as 21:00 do dia anterior e liberando as 21:00 do dia certo.
 *
 * Intervalo meio-aberto [00:00:00 do dia, 00:00:00 do dia seguinte) de proposito: `<=` no fim
 * pegaria a meia-noite do dia seguinte, que pertence ao outro dia.
 */
export function diaLocalRange(inicioDate, tzOffsetMin = EST_TZ_OFFSET_MIN) {
  const local = formatLocalSqlDateTime(inicioDate, tzOffsetMin);
  if (!local) return null;
  const [ymd] = local.split(' ');
  const [ano, mes, dia] = ymd.split('-').map(Number);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null;
  // `dia + 1` pode estourar o mes (31 -> 32). Date.UTC normaliza, entao 31/08 vira 01/09 sozinho.
  const proximo = makeUtcFromLocalYMDHM(ano, mes, dia + 1, 0, 0, tzOffsetMin);
  return {
    inicioDia: `${ymd} 00:00:00`,
    fimDia: formatLocalSqlDateTime(proximo, tzOffsetMin),
  };
}

/**
 * Quais status OCUPAM a agenda do cliente. Exportado porque `lib/conflito_cliente.js` responde a
 * perguntas irmas (mesmo servico no dia, sobreposicao) e as tres tem de concordar sobre o que
 * conta — se divergirem, uma regra barra e a outra libera o mesmo agendamento.
 *
 * ─── Por que este predicado NAO e o activeAppointmentStatusWhere() ────────────────────────────
 *
 * Sao perguntas diferentes, e unificar os dois reabre um furo real.
 *
 * `activeAppointmentStatusWhere` (lib/service_capacity.js) responde "este minuto esta livre
 * AGORA?" — e para isso um `pendente_pagamento` com hold VENCIDO tem de deixar de contar, senao o
 * horario ficaria preso por alguem que nao pagou.
 *
 * Aqui a pergunta e "esta pessoa ja tem hoje um agendamento que ainda pode virar realidade?" — e
 * um `pendente_pagamento` vencido AINDA PODE: enquanto ninguem o cancelou, o webhook do Asaas
 * atrasado ainda o promove a `confirmado` (o cenario "pagou no ultimo segundo, webhook atrasou"
 * esta descrito em lib/maintenance.js). Se a contagem herdasse a folga de expiracao, o cliente
 * esperaria o hold vencer, marcaria o segundo horario, e os DOIS virariam confirmados — sem
 * nenhum ponto no codigo onde recusar.
 *
 * Por isso: conta tudo que nao esta `cancelado`. `concluido` conta tambem — a pessoa ja ocupou um
 * horario naquele dia, que e exatamente o que a trava limita.
 */
export const SQL_STATUS_QUE_OCUPAM = `status IN ('confirmado','pendente','pendente_pagamento','concluido')`;

/** O SQL da contagem, funcao pura para o teste inspecionar o texto sem banco. */
export function buildContagemSql({ excludeAppointmentId = null } = {}) {
  return `SELECT id FROM agendamentos
     WHERE estabelecimento_id = ?
       AND cliente_id = ?
       AND inicio >= ?
       AND inicio < ?
       AND ${SQL_STATUS_QUE_OCUPAM}${
         excludeAppointmentId ? '\n       AND id <> ?' : ''
       }
     FOR UPDATE`;
}

/** Decisao pura, para o teste nao precisar de banco nem de transacao. */
export function decideLimiteDiario({ config, usados }) {
  const cfg = config || { ativo: false, max: LIMITE_DIARIO_MAX_PADRAO };
  if (!cfg.ativo) return { ok: true, ativo: false };
  const usadosNum = Number(usados) || 0;
  if (usadosNum < cfg.max) return { ok: true, ativo: true, usados: usadosNum, max: cfg.max };
  return { ok: false, ativo: true, usados: usadosNum, max: cfg.max };
}

/** Config do estabelecimento. Sem linha em establishment_settings = desligado. */
export async function fetchLimiteDiarioConfig(db, estabelecimentoId) {
  const id = Number(estabelecimentoId);
  if (!Number.isFinite(id) || id <= 0) return normalizeLimiteDiarioConfig(null);
  try {
    const [rows] = await db.query(
      `SELECT limite_diario_ativo, limite_diario_max
         FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1`,
      [id]
    );
    return normalizeLimiteDiarioConfig(rows?.[0] || null);
  } catch {
    // Coluna ainda nao migrada, tabela ausente: desligado. Uma trava que derruba o agendamento
    // por causa de erro de leitura de config e pior do que uma trava ausente.
    return normalizeLimiteDiarioConfig(null);
  }
}

/**
 * O guard transacional. Roda DENTRO da transacao que faz o INSERT, com FOR UPDATE.
 *
 * Fora da transacao ele fura: dois cliques simultaneos leem "0 usados" e os dois gravam. Nao e
 * hipotese — a cliente do caso 194 disparou quatro POSTs em seis segundos. O pool fixa
 * REPEATABLE READ por conexao (lib/db.js) justamente para o gap lock existir; o SELECT ... FOR
 * UPDATE numa faixa VAZIA tranca o intervalo e o concorrente espera.
 *
 * Chame DEPOIS do checkAppointmentSlotCapacityTx, para nao inverter a ordem de aquisicao de
 * locks entre as duas checagens (bloqueios -> agendamentos), que e o que gera deadlock.
 */
export async function checkLimiteDiarioClienteTx({
  db,
  estabelecimentoId,
  clienteId,
  inicioDate,
  excludeAppointmentId = null,
  config = null,
}) {
  const cfg = config || (await fetchLimiteDiarioConfig(db, estabelecimentoId));
  if (!cfg.ativo) return { ok: true, ativo: false };

  const cliente = Number(clienteId);
  if (!Number.isFinite(cliente) || cliente <= 0) return { ok: true, ativo: true };

  const range = diaLocalRange(inicioDate);
  if (!range) return { ok: true, ativo: true };

  const params = [Number(estabelecimentoId), cliente, range.inicioDia, range.fimDia];
  if (excludeAppointmentId) params.push(Number(excludeAppointmentId));

  const [rows] = await db.query(buildContagemSql({ excludeAppointmentId }), params);
  const usados = Array.isArray(rows) ? rows.length : 0;
  return { ...decideLimiteDiario({ config: cfg, usados }), dia: range.inicioDia.slice(0, 10) };
}

/** Texto unico para a API e para a tela, para as duas nao divergirem. */
export function mensagemLimiteDiario(max) {
  const n = Number(max) || LIMITE_DIARIO_MAX_PADRAO;
  return n === 1
    ? 'Você já tem um agendamento neste dia. Escolha outro dia ou fale com o estabelecimento.'
    : `Você já tem ${n} agendamentos neste dia. Escolha outro dia ou fale com o estabelecimento.`;
}
