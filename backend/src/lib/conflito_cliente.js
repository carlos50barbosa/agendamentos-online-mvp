// backend/src/lib/conflito_cliente.js
//
// Duas regras sobre a agenda do MESMO cliente, irmas da trava de lib/limite_diario_cliente.js:
//
//   REGRA A — MESMO SERVICO NO MESMO DIA. O cliente nao marca, para o mesmo dia, um servico que
//             ele ja tem marcado naquele dia.
//   REGRA B — SOBREPOSICAO. O cliente nao tem dois agendamentos cujos intervalos se cruzam, nem
//             que sejam com profissionais diferentes. Ninguem esta em dois lugares ao mesmo
//             tempo.
//
// ─── Por que estas NAO sao opcionais, e a trava diaria e ─────────────────────────────────────
//
// O teto por dia e preferencia de negocio ("quantos horarios do dia uma pessoa pode ocupar"), e
// a resposta muda por salao — por isso ele nasce desligado e tem liga/desliga.
//
// Estas duas descrevem o mundo fisico, nao a preferencia do dono. Marcar o mesmo servico duas
// vezes no dia, ou estar em duas cadeiras ao mesmo tempo, nao e uma politica que alguem escolhe:
// e um dado impossivel entrando na agenda. Por isso valem sempre, nos caminhos em que quem marca
// e o CLIENTE.
//
// A valvula de escape existe e foi pedida explicitamente: quando o cliente PRECISA repetir o
// servico no mesmo dia, o estabelecimento marca pelo painel, que e isento das duas regras. O dono
// e a camada de julgamento humano — ele sabe quando o "mesmo cliente" na verdade e a mae
// agendando para a filha na propria conta.
//
// ─── Por que a REGRA B e escopada a UM estabelecimento ───────────────────────────────────────
//
// Fisicamente, estar em dois saloes ao mesmo tempo tambem e impossivel, e `cliente_id` e global —
// daria para checar. Nao se checa de proposito: recusar um agendamento no salao A por causa de um
// horario no salao B revelaria ao salao A que a pessoa e cliente do concorrente, e a mensagem de
// recusa nao teria como explicar o motivo sem vazar isso. Cada agenda responde pela propria.
import {
  SQL_STATUS_QUE_OCUPAM,
  diaLocalRange,
} from './limite_diario_cliente.js';
import { formatLocalSqlDateTime } from './datetime_tz.js';

export const ERRO_SERVICO_REPETIDO = 'servico_repetido_no_dia';
export const ERRO_SOBREPOSICAO = 'sobreposicao_cliente';

/**
 * ETAPA 1 da REGRA A: os agendamentos vivos do cliente naquele dia, travados.
 *
 * Ancorado so em `inicio`, igual a `diaLocalRange`. Um agendamento que comeca 23:00 e termina
 * 01:00 (salao noturno, caso de primeira classe do expediente) pertence ao dia em que COMECOU;
 * olhar `fim` tambem o faria pertencer a dois dias e a regra ficaria ambigua.
 */
export function buildAgendamentosDoDiaSql({ excludeAppointmentId = null } = {}) {
  return `SELECT id, servico_id FROM agendamentos
     WHERE estabelecimento_id = ?
       AND cliente_id = ?
       AND inicio >= ?
       AND inicio < ?
       AND ${SQL_STATUS_QUE_OCUPAM}${excludeAppointmentId ? '\n       AND id <> ?' : ''}
     FOR UPDATE`;
}

/**
 * ETAPA 2 da REGRA A: os servicos daqueles agendamentos. SEM LOCK — e a ausencia de lock aqui e
 * uma decisao medida, nao um esquecimento.
 *
 * ─── Por que NAO travar (e por que a ordem das leituras importa) ─────────────────────────────
 *
 * A tentacao e usar `LOCK IN SHARE MODE`, para a leitura enxergar o que o FOR UPDATE da etapa 1
 * acabou de revelar. Foi medido em MySQL 8.4: NAO fazer isso. `IN (...)` sobre
 * `idx_agendamento_itens_agendamento` (que NAO e unico) pega next-key lock, e o gap depois do
 * ultimo id casado vai ate o FIM do indice. Como `agendamento_id` e auto-increment, esse gap e
 * exatamente onde cai o INSERT de itens de TODO agendamento novo — de qualquer estabelecimento.
 * Resultado medido: enquanto a transacao de um cliente do salao A esta aberta, o
 * `INSERT INTO agendamento_itens` de qualquer outro tenant espera ate 50s (innodb_lock_wait_timeout).
 * O agendamento mais recente da base costuma ser justamente o que a REGRA A vai consultar, entao o
 * caminho e comum, nao exotico. Estreitar o predicado nao resolve: acrescentar `servico_id IN (...)`
 * so desliza o gap para o proximo servico_id.
 *
 * Sem lock, a frescura vem da ORDEM DAS LEITURAS. Sob REPEATABLE READ o read view da transacao
 * nasce na PRIMEIRA leitura NAO-LOCKING; se tudo que rodou antes foi `FOR UPDATE` (bloqueios,
 * capacidade, e a etapa 1 aqui), entao este SELECT e o primeiro nao-locking e cria um read view
 * NOVO — que ja inclui o commit pelo qual a etapa 1 esperou. Medido nas duas conexoes: com
 * leituras locking antes, este SELECT enxerga o item recem-commitado; com um SELECT simples antes,
 * nao enxerga.
 *
 * ⚠️ CONSEQUENCIA PARA QUEM FOR MEXER: um `SELECT` sem lock inserido no caminho ANTES deste guard
 * abre o read view mais cedo e deixa a REGRA A cega para combos concorrentes, EM SILENCIO. Por
 * isso as rotas leem a config da trava diaria FORA da transacao e a passam pronta — era o unico
 * SELECT simples que rodava antes. Se precisar de uma leitura nova ali, faca-a fora da transacao
 * ou com FOR UPDATE.
 *
 * A rede de seguranca para esse caso e o `servico_id` primario, que entra na contagem SEMPRE (ver
 * checkServicoRepetidoNoDiaTx): mesmo com itens invisiveis, o servico principal do agendamento
 * concorrente continua sendo detectado.
 */
export function buildItensSql(quantosIds) {
  const placeholders = Array.from({ length: Math.max(1, quantosIds) }, () => '?').join(',');
  return `SELECT agendamento_id, servico_id FROM agendamento_itens
     WHERE agendamento_id IN (${placeholders})`;
}

/**
 * REGRA B: os agendamentos do cliente cujo intervalo cruza [inicio, fim).
 *
 * `inicio < ?fim AND fim > ?inicio`, os dois ESTRITOS — encostar nao e cruzar. Um agendamento que
 * termina 10:00 e outro que comeca 10:00 sao vizinhos legitimos, e trocar qualquer um dos dois
 * por `<=`/`>=` transformaria agenda cheia em agenda travada.
 *
 * Sem piso de tempo (do tipo `inicio >= novoInicio - 1 DAY`) de proposito: ele so seria seguro se
 * nenhum agendamento pudesse durar mais de 24h, e o sistema NAO garante isso — `duracao_min` nao
 * tem teto, e a checagem de expediente compara indice de dia da semana, entao duracao multipla de
 * 7 dias passa. O indice (estabelecimento_id, cliente_id, inicio) ja restringe as linhas as
 * daquele cliente naquele salao, que sao poucas.
 */
export function buildSobreposicaoSql({ excludeAppointmentId = null } = {}) {
  return `SELECT id, inicio, fim FROM agendamentos
     WHERE estabelecimento_id = ?
       AND cliente_id = ?
       AND inicio < ?
       AND fim > ?
       AND ${SQL_STATUS_QUE_OCUPAM}${excludeAppointmentId ? '\n       AND id <> ?' : ''}
     FOR UPDATE`;
}

/** Predicado puro equivalente ao SQL acima, para o teste provar os casos de borda sem banco. */
export function intervalosSeCruzam(aInicio, aFim, bInicio, bFim) {
  const ai = new Date(aInicio).getTime();
  const af = new Date(aFim).getTime();
  const bi = new Date(bInicio).getTime();
  const bf = new Date(bFim).getTime();
  if (![ai, af, bi, bf].every(Number.isFinite)) return false;
  return ai < bf && af > bi;
}

const idsUnicos = (valores) =>
  Array.from(new Set((valores || []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)));

/**
 * REGRA A. Devolve { ok } ou { ok:false, servicosEmConflito, agendamentoId }.
 *
 * Roda DENTRO da transacao do INSERT. O pedido nunca traz o mesmo servico repetido (a
 * normalizacao do payload deduplica antes), entao so ha o que comparar contra OUTROS
 * agendamentos.
 */
export async function checkServicoRepetidoNoDiaTx({
  db,
  estabelecimentoId,
  clienteId,
  inicioDate,
  serviceIds,
  excludeAppointmentId = null,
}) {
  const cliente = Number(clienteId);
  const pedidos = idsUnicos(serviceIds);
  if (!Number.isFinite(cliente) || cliente <= 0 || !pedidos.length) return { ok: true };

  const range = diaLocalRange(inicioDate);
  if (!range) return { ok: true };

  const params = [Number(estabelecimentoId), cliente, range.inicioDia, range.fimDia];
  if (excludeAppointmentId) params.push(Number(excludeAppointmentId));
  const [linhas] = await db.query(buildAgendamentosDoDiaSql({ excludeAppointmentId }), params);
  if (!linhas?.length) return { ok: true };

  const ids = linhas.map((l) => Number(l.id));
  const [itens] = await db.query(buildItensSql(ids.length), ids);

  // Servicos por agendamento: os itens sao a fonte da verdade (`agendamentos.servico_id` guarda
  // so' o PRIMEIRO servico do pedido, entao num combo ele enxergaria menos do que existe). A
  // coluna entra apenas como rede para uma linha que, por qualquer motivo, nao tenha item —
  // exatamente o mesmo fallback que as rotas ja fazem ao recarregar um agendamento.
  const porAgendamento = new Map(ids.map((id) => [id, new Set()]));
  for (const item of itens || []) {
    const alvo = porAgendamento.get(Number(item.agendamento_id));
    if (alvo) alvo.add(Number(item.servico_id));
  }
  // O `servico_id` primario entra SEMPRE, e nao so quando a linha nao tem item nenhum.
  //
  // Ele e, por construcao, um dos servicos do agendamento (as rotas gravam nele o primeiro id do
  // pedido), entao inclui-lo nunca cria falso positivo. E cobre o caso em que a leitura de itens
  // vem de um read view mais velho (ver o comentario de buildItensSql): sem itens visiveis, o
  // servico principal do agendamento concorrente continua sendo pego.
  for (const linha of linhas) {
    const alvo = porAgendamento.get(Number(linha.id));
    if (alvo && linha.servico_id) alvo.add(Number(linha.servico_id));
  }

  const pedidosSet = new Set(pedidos);
  for (const [agendamentoId, servicos] of porAgendamento) {
    const conflito = [...servicos].filter((s) => pedidosSet.has(s));
    if (conflito.length) {
      return { ok: false, servicosEmConflito: conflito, agendamentoId };
    }
  }
  return { ok: true };
}

/** Os agendamentos do cliente que cruzam [inicioDate, fimDate). Base das duas formas da REGRA B. */
export async function listarSobreposicoesTx({
  db,
  estabelecimentoId,
  clienteId,
  inicioDate,
  fimDate,
  excludeAppointmentId = null,
}) {
  const cliente = Number(clienteId);
  const inicioStr = formatLocalSqlDateTime(inicioDate);
  const fimStr = formatLocalSqlDateTime(fimDate);
  if (!Number.isFinite(cliente) || cliente <= 0 || !inicioStr || !fimStr) return [];

  const params = [Number(estabelecimentoId), cliente, fimStr, inicioStr];
  if (excludeAppointmentId) params.push(Number(excludeAppointmentId));
  const [linhas] = await db.query(buildSobreposicaoSql({ excludeAppointmentId }), params);
  return linhas || [];
}

/** REGRA B na CRIACAO: qualquer cruzamento recusa. */
export async function checkSobreposicaoClienteTx(args) {
  const linhas = await listarSobreposicoesTx(args);
  if (!linhas.length) return { ok: true };
  return { ok: false, conflitos: linhas.map((l) => Number(l.id)), inicio: linhas[0].inicio };
}

/**
 * REGRA B no REAGENDAMENTO: recusa so o cruzamento NOVO.
 *
 * ─── Por que diferencial, e nao absoluta ─────────────────────────────────────────────────────
 *
 * Porque a agenda de hoje JA CONTEM pares sobrepostos do mesmo cliente, produzidos pelo proprio
 * sistema: a checagem de capacidade e por PROFISSIONAL, nunca por cliente, entao marcar 10:00 com
 * a Ana e 10:00 com a Bia sempre passou. Somem-se a isso as familias que compartilham um cadastro
 * (o link publico reaproveita o cadastro achado pelo TELEFONE, entao a filha com outro e-mail cai
 * na mesma linha da mae).
 *
 * Se esta rota perguntasse "o intervalo NOVO cruza alguem?", esses pares ficariam IMOVEIS: o
 * estabelecimento nao conseguiria nem arrastar um deles trinta minutos, porque o par continuaria
 * cruzando. E a valvula do painel nao alcanca aqui — remarcar e outra rota.
 *
 * A pergunta certa e "o intervalo novo cruza alguem que o ANTIGO ja nao cruzava?". Arrastar um
 * agendamento por cima de outro do mesmo cliente cria um id que nao estava no conjunto anterior e
 * e recusado; remanejar um par que ja nascia sobreposto passa.
 */
export async function checkSobreposicaoNoRemarcarTx({
  db,
  estabelecimentoId,
  clienteId,
  inicioAtual,
  fimAtual,
  inicioNovo,
  fimNovo,
  excludeAppointmentId,
}) {
  const antes = await listarSobreposicoesTx({
    db,
    estabelecimentoId,
    clienteId,
    inicioDate: inicioAtual,
    fimDate: fimAtual,
    excludeAppointmentId,
  });
  const depois = await listarSobreposicoesTx({
    db,
    estabelecimentoId,
    clienteId,
    inicioDate: inicioNovo,
    fimDate: fimNovo,
    excludeAppointmentId,
  });
  const jaCruzava = new Set(antes.map((l) => Number(l.id)));
  const novos = depois.map((l) => Number(l.id)).filter((id) => !jaCruzava.has(id));
  if (!novos.length) return { ok: true };
  return { ok: false, conflitos: novos };
}

export const MENSAGEM_SERVICO_REPETIDO =
  'Você já tem este serviço agendado neste dia. Escolha outro dia, ou fale com o estabelecimento se precisar repetir hoje.';

export const MENSAGEM_SOBREPOSICAO =
  'Este horário se sobrepõe a outro agendamento seu. Escolha um horário que não coincida com o que você já marcou.';
