// backend/src/lib/horarios_profissional.js
//
// Writer de profissionais.horarios_json. Estrito de proposito, e o motivo cabe numa frase:
// O READER FALHA ABERTO.
//
// buildWorkingRules devolve `null` para JSON ausente, vazio, malformado, sem slug de dia ou com
// dia numerico — e `null`, para intersectExpediente, significa "sem regra propria", ou seja
// HERDA O HORARIO DO SALAO. Isso e correto para quem nunca configurou nada. Mas significa que
// todo caminho de perda silenciosa deste writer termina no mesmo lugar: a dona marca a folga de
// segunda da Tay, ve "salvo" na tela, e a Tay continua recebendo agendamento na segunda.
//
// Por isso nada aqui e tolerante. Um parser que "conserta" a entrada transforma erro de escrita
// em agenda aberta silenciosa; um que recusa transforma no pior caso um 400 na tela de quem esta
// configurando — que e visivel, e onde da para consertar.
//
// TRES ARMADILHAS CONCRETAS, todas executadas contra a lib:
//
//   1. `[{"day":"monday","enabled":false,"start":"09:00","end":"18:00"}]` — buildWorkingRules
//      IGNORA a flag e le o dia como ABERTO 09:00-18:00. Uma tela que mande o estado do checkbox
//      junto com o ultimo horario digitado (que e o payload natural de um editor) grava folga que
//      o sistema entende como expediente. Dai a whitelist de chaves: qualquer campo desconhecido
//      e 400, em vez de ser ignorado.
//
//   2. `"[]"` para "nao trabalha nenhum dia" — buildWorkingRules devolve null, que vira "herda o
//      salao". Afastamento e licenca viram disponibilidade os 7 dias. Dai a exigencia dos 7 dias
//      SEMPRE materializados: folga e `{"day":"monday"}` pelado, que o reader entende como
//      fechado de verdade.
//
//   3. Horario tolerante. `'1:5'` seria coagido para 15:00 por um parser esperto. Aqui e regex
//      estrito e 400.
//
// NAO reusa sanitizeHorariosInput de routes/estabelecimentos.js. Aquela funcao INVERTE quando
// start > end (22:00-06:00 e gravado 06:00-22:00, virando turno noturno em janela diurna) e
// descarta pausa da madrugada por comparacao lexicografica de string. Ela e segura hoje so
// porque o validateDays do WorkingHoursEditor barra esses casos ANTES, no cliente — garantia que
// nao existe num endpoint HTTP. Alem disso ela e compartilhada com o perfil do estabelecimento,
// entao endurece-la mudaria o comportamento do salao junto.
import { buildWorkingRules, resolveExpedienteForDay } from './expediente.js';

// Slugs em ingles, na ordem de indice que buildWorkingRules usa (domingo = 0).
export const DIAS_SEMANA = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

// Chaves aceitas por item. Tudo fora daqui e 400 — ver armadilha 1 no topo.
const CHAVES_ITEM = Object.freeze(['day', 'fechado', 'start', 'end', 'blocks']);
const CHAVES_PAUSA = Object.freeze(['start', 'end']);

// Teto por dia. Um limite que TRUNCA calado e pausa perdida; este recusa.
const MAX_PAUSAS_DIA = 6;

// Sem coercao nenhuma: '9', '18h30', '1:5', 540 e '09:00:00' sao todos recusados.
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DIA_MINUTOS = 1440;

class HorariosError extends Error {
  constructor(code, message) {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

const recusar = (code, message) => {
  throw new HorariosError(code, message);
};

const paraMinutos = (hora) => {
  const [h, m] = hora.split(':');
  return Number(h) * 60 + Number(m);
};

const chavesEstranhas = (obj, permitidas) =>
  Object.keys(obj).filter((chave) => !permitidas.includes(chave));

// Comprimento do arco no relogio circular. Espelha a leitura de buildWorkingRules, para quem
// declara turno que vira a meia-noite (start > end) nao ser recusado.
const comprimento = (inicio, fim) => (fim > inicio ? fim - inicio : fim + DIA_MINUTOS - inicio);

// A pausa cabe na janela? Espelha isBreakWithinWindow de expediente.js: em janela que vira, a
// pausa precisa estar inteira no trecho tardio OU inteira na madrugada — nunca atravessando.
const pausaCabe = (pausaIni, pausaFim, janelaIni, janelaFim) => {
  if (janelaIni < janelaFim) return pausaIni >= janelaIni && pausaFim <= janelaFim;
  const tardia = pausaIni >= janelaIni && pausaFim <= DIA_MINUTOS;
  const madrugada = pausaIni >= 0 && pausaFim <= janelaFim;
  return tardia || madrugada;
};

const validarPausas = (rawBlocks, diaSlug, janelaIni, janelaFim) => {
  if (rawBlocks === undefined) return [];
  if (!Array.isArray(rawBlocks)) {
    recusar('pausa_formato', `As pausas de ${diaSlug} precisam vir como lista.`);
  }
  if (rawBlocks.length > MAX_PAUSAS_DIA) {
    recusar('pausas_demais', `No maximo ${MAX_PAUSAS_DIA} pausas por dia (${diaSlug}).`);
  }

  const pausas = [];
  for (const bloco of rawBlocks) {
    // Tupla [720,780] e justamente o formato que o READER devolve. Aceita-la aqui faria o ciclo
    // ler-mexer-regravar perder tudo, entao ela e recusada explicitamente.
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) {
      recusar('pausa_formato', `Pausa invalida em ${diaSlug}: use { start, end }.`);
    }
    const estranhas = chavesEstranhas(bloco, CHAVES_PAUSA);
    if (estranhas.length) {
      recusar('pausa_formato', `Pausa de ${diaSlug} tem campo desconhecido: ${estranhas.join(', ')}.`);
    }
    if (!HORA_RE.test(String(bloco.start)) || !HORA_RE.test(String(bloco.end))) {
      recusar('horario_invalido', `Pausa de ${diaSlug} precisa de horarios no formato HH:MM.`);
    }
    const ini = paraMinutos(bloco.start);
    const fim = paraMinutos(bloco.end);
    // Pausa que nao avanca ou que cruza a meia-noite e DESCARTADA pelo reader — e pausa
    // descartada vira horario vendavel.
    if (ini >= fim) {
      recusar('pausa_invalida', `A pausa de ${diaSlug} precisa terminar depois de comecar.`);
    }
    if (!pausaCabe(ini, fim, janelaIni, janelaFim)) {
      recusar('pausa_fora_da_janela', `A pausa de ${diaSlug} precisa caber dentro do horario do dia.`);
    }
    pausas.push({ start: bloco.start, end: bloco.end });
  }
  return pausas;
};

const validarDia = (item, indice) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    recusar('horarios_formato', 'Cada dia precisa ser um objeto.');
  }

  const estranhas = chavesEstranhas(item, CHAVES_ITEM);
  if (estranhas.length) {
    // A mensagem cita o campo porque este e o 400 que a pessoa que integra vai ver primeiro.
    recusar(
      'campo_desconhecido',
      `Campo nao reconhecido em horarios: ${estranhas.join(', ')}. Use apenas ${CHAVES_ITEM.join(', ')}.`
    );
  }

  const slug = typeof item.day === 'string' ? item.day.trim().toLowerCase() : null;
  if (!slug || !DIAS_SEMANA.includes(slug)) {
    recusar('dia_invalido', `Dia invalido em horarios. Use um de: ${DIAS_SEMANA.join(', ')}.`);
  }

  // Booleano estrito: 'true', 1 e 'on' sao recusados. Coercao aqui e como a folga vira
  // expediente — o proprio reader ja ignora flags, e aceitar variacoes multiplicaria os jeitos
  // de escrever a mesma coisa errada.
  if (item.fechado !== undefined && typeof item.fechado !== 'boolean') {
    recusar('campo_desconhecido', `O campo "fechado" de ${slug} precisa ser true ou false.`);
  }

  if (item.fechado === true) {
    // Dia de folga vai PELADO. start/end sobrando sao ignorados de proposito: um editor que
    // preserva o ultimo horario digitado ao desmarcar o dia manda os dois, e isso e legitimo.
    return { indice, slug, json: { day: slug } };
  }

  if (!HORA_RE.test(String(item.start ?? '')) || !HORA_RE.test(String(item.end ?? ''))) {
    if (item.start === undefined || item.end === undefined) {
      recusar('horarios_incompleto', `Informe inicio e fim para ${slug}, ou marque como fechado.`);
    }
    recusar('horario_invalido', `Horario invalido em ${slug}: use HH:MM (24h).`);
  }

  const ini = paraMinutos(item.start);
  const fim = paraMinutos(item.end);
  // start === end vira dia fechado em silencio no reader; aqui e 400.
  if (ini === fim) {
    recusar('janela_zero', `O horario de ${slug} comeca e termina no mesmo minuto.`);
  }
  // start > end NAO e erro: e turno que vira a meia-noite, e o reader trata assim. Recusar
  // (como o onboarding do salao faz) deixaria plantao noturno sem como ser declarado.

  const blocks = validarPausas(item.blocks, slug, ini, fim);
  const json = { day: slug, start: item.start, end: item.end };
  // `blocks` vazio e omitido: o JSON canonico nao carrega chave sem conteudo.
  if (blocks.length) json.blocks = blocks;
  return { indice, slug, json };
};

/**
 * Confere que o reader entendeu EXATAMENTE o que foi declarado.
 *
 * Este e o portao que justifica o modulo. As validacoes acima cobrem os erros que a gente
 * conhece hoje; este cobre a classe inteira, inclusive bug que alguem introduza aqui depois —
 * porque compara a intencao contra o que buildWorkingRules de fato le.
 *
 * Ele importa mais aqui do que em qualquer outro writer do repo por causa da defasagem: nada
 * consome horarios_json ainda. Um writer errado fica LATENTE e so vira agendamento indevido
 * quando a Fase 2 subir, longe do commit que causou. Este portao falha AGORA, no save.
 */
const conferirRoundTrip = (json, intencoes) => {
  const rules = buildWorkingRules(json);
  if (!rules) {
    recusar('horarios_ilegiveis', 'Nao foi possivel interpretar os horarios enviados.');
  }
  for (const intencao of intencoes) {
    const lido = resolveExpedienteForDay(rules, intencao.indice);
    if (intencao.json.start === undefined) {
      if (!lido.closed) {
        recusar('horarios_ilegiveis', `A folga de ${intencao.slug} nao foi gravada como folga.`);
      }
      continue;
    }
    if (lido.closed) {
      recusar('horarios_ilegiveis', `O horario de ${intencao.slug} foi lido como folga.`);
    }
    if (lido.abre !== intencao.json.start || lido.fecha !== intencao.json.end) {
      recusar(
        'horarios_ilegiveis',
        `O horario de ${intencao.slug} foi lido como ${lido.abre}-${lido.fecha}.`
      );
    }
    const pausasEsperadas = (intencao.json.blocks || []).length;
    if ((lido.breaks || []).length !== pausasEsperadas) {
      recusar('horarios_ilegiveis', `As pausas de ${intencao.slug} nao sobreviveram.`);
    }
  }
};

/**
 * Valida e serializa o horario proprio de um profissional.
 *
 * Tres modos, e a distincao entre os dois primeiros e o que torna "voltar a herdar" exprimivel:
 *   - `undefined` (campo ausente no body) -> { mode: 'skip' }  : nao tocar na coluna
 *   - `null` (enviado explicitamente)     -> { mode: 'clear' } : gravar NULL, volta a herdar
 *   - array                               -> { mode: 'set' }   : valida estrito e serializa
 *
 * Quem chama precisa distinguir por hasOwnProperty, nunca por `!= null` — o idioma `x != null ?
 * x : atual`, usado no resto do arquivo de rotas, colapsa "ausente" e "null" no mesmo ramo.
 *
 * Lanca HorariosError (status 400, code, message) na convencao de routes/onboarding.js.
 */
export function parseHorariosProfissional(raw) {
  if (raw === undefined) return { mode: 'skip', json: null };
  if (raw === null) return { mode: 'clear', json: null };

  if (!Array.isArray(raw)) {
    recusar('horarios_formato', 'Horarios precisam vir como uma lista de dias.');
  }

  const vistos = new Set();
  const intencoes = [];
  for (const item of raw) {
    const dia = validarDia(item);
    // first-wins no reader: o segundo item do mesmo dia e ignorado, e o horario da tarde
    // simplesmente some. Melhor recusar.
    if (vistos.has(dia.slug)) {
      recusar('dia_duplicado', `O dia ${dia.slug} aparece mais de uma vez.`);
    }
    vistos.add(dia.slug);
    intencoes.push({ ...dia, indice: DIAS_SEMANA.indexOf(dia.slug) });
  }

  // Os 7 dias SEMPRE. Codificar folga por ausencia e o que faz "semana inteira de licenca"
  // virar "[]" -> null -> herda o salao. Ver armadilha 2 no topo.
  if (vistos.size !== DIAS_SEMANA.length) {
    const faltando = DIAS_SEMANA.filter((slug) => !vistos.has(slug));
    recusar('dias_incompletos', `Faltam dias em horarios: ${faltando.join(', ')}.`);
  }

  intencoes.sort((a, b) => a.indice - b.indice);
  const json = JSON.stringify(intencoes.map((intencao) => intencao.json));

  conferirRoundTrip(json, intencoes);

  return { mode: 'set', json };
}

/**
 * Acrescenta `horarios_json` ao UPDATE APENAS quando o corpo pediu.
 *
 * Existe como funcao propria, e nao como duas linhas soltas na rota, porque a alternativa
 * obvia — escrever a coluna sempre, com fallback para o valor atual — e uma armadilha concreta
 * e ja executada: o `pool.query` deste projeto usa o caminho NAO-preparado do mysql2, onde
 * `undefined` num bind vira NULL em silencio.
 *
 *   mysql.format('UPDATE profissionais SET horarios_json=? WHERE id=?', [undefined, 7])
 *     -> UPDATE profissionais SET horarios_json=NULL WHERE id=7      (nao lanca)
 *
 * O guard "Bind parameters must not contain undefined" so existe no execute(). Como a tela
 * dispara um PUT com { ativo } a cada clique em Ativar/Inativar, bastaria o SELECT que carrega
 * o profissional nao trazer a coluna para a folga ser zerada a cada toggle, sem ninguem pedir e
 * sem erro nenhum.
 */
export function montarUpdateComHorarios(campos, valores, horarios) {
  if (!horarios || horarios.mode === 'skip') {
    return { campos: [...campos], valores: [...valores] };
  }
  return { campos: [...campos, 'horarios_json=?'], valores: [...valores, horarios.json] };
}

export { HorariosError };
