import { EST_TZ_OFFSET_MIN, minutesOfDayInTZ, weekDayIndexInTZ } from './datetime_tz.js';

const DAY_MINUTES = 24 * 60;
export const DEFAULT_ABRE = '07:00';
export const DEFAULT_FECHA = '22:00';

const DAY_SLUG_TO_INDEX = Object.freeze({
  sunday: 0,
  sundayfeira: 0,
  sun: 0,
  domingo: 0,
  domingofeira: 0,
  dom: 0,
  monday: 1,
  mondayfeira: 1,
  mon: 1,
  segunda: 1,
  segundafeira: 1,
  seg: 1,
  tuesday: 2,
  tuesdayfeira: 2,
  tue: 2,
  terca: 2,
  tercafeira: 2,
  ter: 2,
  wednesday: 3,
  wednesdayfeira: 3,
  wed: 3,
  quarta: 3,
  quartafeira: 3,
  qua: 3,
  thursday: 4,
  thursdayfeira: 4,
  thu: 4,
  quinta: 4,
  quintafeira: 4,
  qui: 4,
  friday: 5,
  fridayfeira: 5,
  fri: 5,
  sexta: 5,
  sextafeira: 5,
  sex: 5,
  saturday: 6,
  saturdayfeira: 6,
  sat: 6,
  sabado: 6,
  sabadofeira: 6,
  sab: 6,
});

const normalizeDayKey = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
};

const resolveDayIndex = (item) => {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.day,
    item.key,
    item.weekday,
    item.week_day,
    item.dia,
    item.label,
  ];
  if (item.value) {
    candidates.push(item.value);
    const firstChunk = String(item.value).split(/[\s,;-]+/)[0];
    candidates.push(firstChunk);
  }

  for (const candidate of candidates) {
    const normalized = normalizeDayKey(candidate);
    if (!normalized) continue;
    if (Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, normalized)) {
      return DAY_SLUG_TO_INDEX[normalized];
    }
  }
  return null;
};

const ensureTimeValue = (value) => {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;
  const direct = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 2) {
    const hours = Number(digits);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
    return `${String(hours).padStart(2, '0')}:00`;
  }
  const hoursDigits = digits.slice(0, -2);
  const minutesDigits = digits.slice(-2);
  const hoursNum = Number(hoursDigits);
  const minutesNum = Number(minutesDigits);
  if (
    !Number.isInteger(hoursNum) ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    !Number.isInteger(minutesNum) ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return null;
  }
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
};

export const toMin = (time) => {
  if (!time && time !== 0) return null;
  const text = String(time);
  if (!text) return null;
  const parts = text.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const fmtMin = (min) => {
  if (!Number.isFinite(min)) return null;
  const safe = ((min % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const isClosedValue = (value) => {
  const valueText = String(value ?? '').toLowerCase();
  return (
    valueText.includes('fechado') ||
    valueText.includes('sem atendimento') ||
    valueText.includes('nao atende')
  );
};

const isBreakWithinWindow = (blockStart, blockEnd, startMinutes, endMinutes, overnight) => {
  if (!overnight) {
    return blockStart >= startMinutes && blockEnd <= endMinutes;
  }
  const inLate = blockStart >= startMinutes && blockEnd <= DAY_MINUTES;
  const inEarly = blockStart >= 0 && blockEnd <= endMinutes;
  return inLate || inEarly;
};

export const buildWorkingRules = (horariosJson) => {
  if (!horariosJson) return null;
  let entries;
  try {
    entries = JSON.parse(horariosJson);
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || !entries.length) return null;
  const rules = Array.from({ length: 7 }, () => ({
    enabled: false,
    startMinutes: null,
    endMinutes: null,
    breaks: [],
  }));
  let recognized = false;

  entries.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const idx = resolveDayIndex(item);
    if (idx == null) return;
    if (rules[idx].processed) return;

    if (isClosedValue(item.value)) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }

    const start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? null);
    const end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? null);
    if (!start || !end) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }
    const startMinutes = toMin(start);
    const endMinutes = toMin(end);
    if (
      startMinutes == null ||
      endMinutes == null ||
      startMinutes === endMinutes
    ) {
      rules[idx] = { enabled: false, startMinutes: null, endMinutes: null, breaks: [], processed: true };
      recognized = true;
      return;
    }
    const overnight = startMinutes > endMinutes;

    const rawBlocks = Array.isArray(item.blocks)
      ? item.blocks
      : Array.isArray(item.breaks)
      ? item.breaks
      : [];

    const breaks = [];
    rawBlocks.forEach((block) => {
      if (!block) return;
      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? null);
      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? null);
      const blockStartMinutes = toMin(blockStart);
      const blockEndMinutes = toMin(blockEnd);
      if (
        blockStartMinutes == null ||
        blockEndMinutes == null ||
        blockStartMinutes >= blockEndMinutes
      ) {
        return;
      }
      if (!isBreakWithinWindow(blockStartMinutes, blockEndMinutes, startMinutes, endMinutes, overnight)) {
        return;
      }
      breaks.push([blockStartMinutes, blockEndMinutes]);
    });

    rules[idx] = {
      enabled: true,
      startMinutes,
      endMinutes,
      breaks,
      processed: true,
    };
    recognized = true;
  });

  if (!recognized) return null;
  return rules.map((rule) => {
    if (!rule.processed) {
      return { enabled: false, startMinutes: null, endMinutes: null, breaks: [] };
    }
    const { processed, ...rest } = rule;
    return rest;
  });
};

export const resolveExpedienteForDay = (workingRules, dayIndex) => {
  if (!Array.isArray(workingRules)) {
    const startMinutes = toMin(DEFAULT_ABRE);
    const endMinutes = toMin(DEFAULT_FECHA);
    return {
      abre: DEFAULT_ABRE,
      fecha: DEFAULT_FECHA,
      startMinutes,
      endMinutes,
      breaks: [],
      closed: false,
      source: 'fallback',
    };
  }
  const rule = dayIndex != null ? workingRules[dayIndex] : null;
  if (!rule || rule.enabled === false) {
    return {
      abre: null,
      fecha: null,
      startMinutes: null,
      endMinutes: null,
      breaks: [],
      closed: true,
      source: 'profile',
    };
  }
  return {
    abre: fmtMin(rule.startMinutes),
    fecha: fmtMin(rule.endMinutes),
    startMinutes: rule.startMinutes,
    endMinutes: rule.endMinutes,
    breaks: Array.isArray(rule.breaks) ? rule.breaks : [],
    closed: false,
    source: 'profile',
  };
};

// Expediente FECHADO canônico. É cópia literal do que resolveExpedienteForDay já devolve para
// dia sem regra: quem consome não pode distinguir os dois, senão vira caso especial.
//
// `closed:true` sozinho NÃO protege nada — assertDentroExpediente nem desestrutura esse campo.
// Quem barra é `toMin(null)` não sendo finito. Por isso abre/fecha/startMinutes/endMinutes
// PRECISAM vir todos null juntos; um `closed:true` com abre/fecha preenchidos é aceito.
const closedExpediente = (source) => ({
  abre: null,
  fecha: null,
  startMinutes: null,
  endMinutes: null,
  breaks: [],
  closed: true,
  source,
});

// Descarta tupla que os consumidores leriam errado em silêncio. `hasBreakOverlap` desestrutura
// POSICIONALMENTE, então {start,end} lança TypeError; `Number.isFinite` faz string sumir sem
// erro; e tupla invertida cria faixa fantasma e ainda solta o intervalo real.
const toBreakList = (breaks) =>
  (Array.isArray(breaks) ? breaks : []).filter(
    (tuple) =>
      Array.isArray(tuple) &&
      Number.isFinite(tuple[0]) &&
      Number.isFinite(tuple[1]) &&
      tuple[0] < tuple[1]
  );

// Cópia profunda o bastante para o chamador poder mutar sem contaminar a origem.
// resolveExpedienteForDay devolve a MESMA referência de `breaks` da regra, e slots.js resolve
// 14× por request sobre o mesmo workingRules — um push in-place vazaria para os outros dias.
const cloneExpediente = (expediente) => ({
  abre: expediente.abre,
  fecha: expediente.fecha,
  startMinutes: expediente.startMinutes,
  endMinutes: expediente.endMinutes,
  breaks: toBreakList(expediente.breaks).map(([start, end]) => [start, end]),
  closed: expediente.closed === true,
  source: expediente.source,
});

/**
 * Combina o expediente do estabelecimento com o de um profissional. Pura.
 *
 * O horário próprio só pode ESTREITAR: o salão decide se abre, e o resultado é sempre um
 * sub-arco do arco do salão. Profissional sem regra (`null`) devolve o do salão intacto — é o
 * que garante que ligar a coluna nova, com todo mundo em NULL, não muda nada para ninguém.
 *
 * SEMÂNTICA QUE PRECISA ESTAR CLARA NA TELA: o horário do profissional é lido DENTRO do turno
 * do estabelecimento, não como hora de parede do dia de calendário. "Segunda 00:00-03:00" de um
 * profissional, contra um salão que abre segunda 22:00 e fecha terça 06:00, significa terça de
 * madrugada. Não é invenção: é a mesma leitura que o formato já impõe aos breaks do próprio
 * salão (o ramo `inEarly` de isBreakWithinWindow).
 *
 * POR QUE NÃO É max(start)/min(end). Porque `startMinutes > endMinutes` já significa "vira a
 * meia-noite" em todo o resto do código, e a aritmética ingênua produz exatamente essa forma
 * quando a interseção é VAZIA. Salão 08-18 com profissional 19-22 viraria a janela 19:00→18:00,
 * que assertDentroExpediente lê como turno de 23 horas e ACEITA às 20:00 — horário em que nem o
 * salão nem o profissional trabalham. Conjunto vazio precisa de sentinela explícita, nunca de
 * inversão. Pelo mesmo motivo o resultado nunca é inferido: ou tem pedaço, ou é FECHADO.
 *
 * A interseção de duas janelas circulares pode dar DOIS arcos disjuntos (salão 22-06 com
 * profissional 05-23 atende 22:00-23:00 e 05:00-06:00). O par abre/fecha não representa isso —
 * mas `janela + breaks` representa, e os dois consumidores já sabem ler breaks hoje. Então o
 * buraco entre os pedaços vira um break sintético, sem exigir mudança de ninguém.
 */
export const intersectExpediente = (expedienteEstabelecimento, expedienteProfissional) => {
  const estab = expedienteEstabelecimento;

  // A ordem destes portões é significativa. O salão manda: se ele está fechado, o horário do
  // profissional nem é olhado — não existe profissional que abra o salão.
  if (
    !estab ||
    estab.closed === true ||
    !Number.isFinite(estab.startMinutes) ||
    !Number.isFinite(estab.endMinutes)
  ) {
    return closedExpediente(estab?.source ?? 'profile');
  }

  const prof = expedienteProfissional;

  // `source:'fallback'` é a janela FABRICADA 07:00-22:00 que resolveExpedienteForDay devolve
  // quando não há regra nenhuma. Tratá-la como janela do profissional estreitaria todo salão
  // aberto fora dessa faixa — e como buildWorkingRules devolve null em SEIS situações
  // diferentes (json ausente, vazio, malformado, sem slug de dia, dia numérico...), isso
  // atingiria todo profissional que ainda não configurou nada.
  if (prof == null || prof.source === 'fallback') {
    return cloneExpediente(estab);
  }

  if (
    prof.closed === true ||
    !Number.isFinite(prof.startMinutes) ||
    !Number.isFinite(prof.endMinutes)
  ) {
    return closedExpediente('intersect');
  }

  // Toda a álgebra roda num eixo linear ancorado na ABERTURA DO SALÃO. É a única âncora segura:
  // o resultado tem de ser sub-arco do arco do salão, e é a mesma âncora que isBreakWithinWindow
  // e hasBreakOverlap já usam para decidir o que é madrugada.
  const anchor = estab.startMinutes;
  const rel = (wallMin) => (((wallMin - anchor) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const wall = (frameMin) => (anchor + frameMin) % DAY_MINUTES;
  // Sempre 0 < len < 1440: buildWorkingRules recusa start === end e toMin não passa de 23:59.
  // É isso que garante, de graça, que a saída nunca tenha startMinutes === endMinutes.
  const len = (start, end) => (end > start ? end - start : end + DAY_MINUTES - start);

  const estabLength = len(estab.startMinutes, estab.endMinutes);

  const profStart = rel(prof.startMinutes);
  const profLength = len(prof.startMinutes, prof.endMinutes);
  // O arco do profissional pode dar a volta no eixo, e aí vira dois segmentos.
  const rawSegments =
    profStart + profLength <= DAY_MINUTES
      ? [[profStart, profStart + profLength]]
      : [
          [profStart, DAY_MINUTES],
          [0, profStart + profLength - DAY_MINUTES],
        ];

  const pieces = rawSegments
    .map(([start, end]) => [Math.max(start, 0), Math.min(end, estabLength)])
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);

  if (!pieces.length) return closedExpediente('intersect');

  let windowStart;
  let windowEnd;
  const holes = [];
  if (pieces.length === 1) {
    [windowStart, windowEnd] = pieces[0];
  } else {
    const [firstStart, firstEnd] = pieces[0];
    const [secondStart, secondEnd] = pieces[1];
    windowStart = firstStart;
    windowEnd = secondEnd;
    // Guarda defensiva: dois pedaços encostados são um só, e um buraco de largura zero seria
    // uma tupla degenerada na saída.
    if (firstEnd < secondStart) holes.push([firstEnd, secondStart]);
  }

  // Breaks: união dos dois lados, sem fusão nem ordenação — os dois consumidores usam .some(),
  // ninguém indexa nem soma. Sobreposição e duplicata são absorvidas sem efeito.
  const framed = [];
  const pushFramed = (start, end) => {
    const frameStart = rel(start);
    const frameEnd = frameStart + (end - start);
    // Parte na volta do eixo para nenhuma tupla atravessar a fronteira do frame.
    if (frameEnd > DAY_MINUTES) {
      framed.push([frameStart, DAY_MINUTES], [0, frameEnd - DAY_MINUTES]);
    } else {
      framed.push([frameStart, frameEnd]);
    }
  };
  for (const [start, end] of toBreakList(estab.breaks)) pushFramed(start, end);
  for (const [start, end] of toBreakList(prof.breaks)) pushFramed(start, end);
  framed.push(...holes);

  // CLIPAR, não manter cru e não filtrar. As duas alternativas abrem agenda, em direções opostas:
  //   - cru: um break do profissional que sobra FORA da janela estreitada não fica inerte. Numa
  //     janela que vira a madrugada, hasBreakOverlap desloca todo break com `bs < startMinutes`
  //     para o dia seguinte — o almoço some do lugar certo e reaparece onde ninguém trabalha;
  //   - filtrar (o pré-teste que buildWorkingRules faz): lá a janela é a de ORIGEM; aqui ela
  //     ENCOLHEU, então breaks que antes cabiam passam a transbordar e seriam descartados
  //     inteiros — entregando o almoço do profissional ao cliente.
  // Depois do clip, todo break está necessariamente todo no trecho tardio ou todo na madrugada,
  // que é exatamente o que os dois consumidores presumem.
  const breaks = [];
  for (const [frameStart, frameEnd] of framed) {
    const clippedStart = Math.max(frameStart, windowStart);
    const clippedEnd = Math.min(frameEnd, windowEnd);
    // Descarte é CONSEQUÊNCIA do clip, nunca pré-teste.
    if (clippedStart >= clippedEnd) continue;
    const wallStart = wall(clippedStart);
    const wallEnd = wallStart + (clippedEnd - clippedStart);
    if (wallEnd > DAY_MINUTES) {
      breaks.push([wallStart, DAY_MINUTES], [0, wallEnd - DAY_MINUTES]);
    } else {
      breaks.push([wallStart, wallEnd]);
    }
  }

  const startMinutes = wall(windowStart);
  const endMinutes = wall(windowEnd);

  return {
    // abre/fecha derivam dos MESMOS números, nunca de caminho paralelo: o enforcement lê só as
    // strings (assertDentroExpediente as re-parseia com toMin) e a grade lê só os números. Se os
    // dois pares divergirem, a tela esconde um horário que o POST aceita.
    abre: fmtMin(startMinutes),
    fecha: fmtMin(endMinutes),
    startMinutes,
    endMinutes,
    breaks,
    closed: false,
    source: 'intersect',
  };
};

export const getExpediente = async ({ db, estabelecimentoId, dateUtc, profissionalId = null }) => {
  let horariosJson = null;
  if (db && estabelecimentoId) {
    try {
      const [[profile]] = await db.query(
        'SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1',
        [estabelecimentoId]
      );
      horariosJson = profile?.horarios_json || null;
    } catch {}
  }
  const workingRules = buildWorkingRules(horariosJson);
  const dayIndex = weekDayIndexInTZ(dateUtc, EST_TZ_OFFSET_MIN);
  const expedienteEstab = resolveExpedienteForDay(workingRules, dayIndex);

  // Saída idêntica à de antes para as chamadas que não passam profissional: mesmo objeto, mesmo
  // número de queries, nenhum caminho novo.
  if (profissionalId == null) return expedienteEstab;

  // Number(true) é 1. Sem esta guarda, um payload torto viraria "o profissional 1", e escopo
  // errado aqui é agenda aberta — o mesmo endurecimento que normalizeProfissionalId já faz nos
  // bloqueios. O id que carrega o horário tem de ser o mesmo valor normalizado que vai gravado.
  if (!Number.isInteger(profissionalId) || profissionalId <= 0) {
    throw new TypeError('getExpediente: profissionalId precisa ser inteiro positivo ou null');
  }

  // SEM try/catch, ao contrário do SELECT acima. Aqui o catch vazio seria perigoso: se este
  // código subir antes do ALTER TABLE, o ER_BAD_FIELD_ERROR seria engolido e TODO profissional
  // passaria a "atender" a janela de fallback 07:00-22:00, sete dias por semana — pior do que
  // antes da feature existir. Deixar o erro subir vira 500 na rota: ruim, mas fechado.
  const [[prof]] = await db.query(
    'SELECT horarios_json FROM profissionais WHERE id=? AND estabelecimento_id=? LIMIT 1',
    [profissionalId, estabelecimentoId]
  );
  const profRules = buildWorkingRules(prof?.horarios_json || null);

  // A linha mais importante deste bloco. resolveExpedienteForDay(null, dia) NÃO devolve "sem
  // regra": devolve a janela fabricada 07:00-22:00. Passá-la adiante faria todo profissional com
  // horarios_json NULL estreitar o salão para 07:00-22:00 — o oposto exato da semântica, e
  // atingindo 100% dos profissionais no dia do deploy.
  const expedienteProf = profRules ? resolveExpedienteForDay(profRules, dayIndex) : null;

  // Os dois lados SEMPRE do mesmo dayIndex: intersectar a sexta do salão com o sábado do
  // profissional é a receita do bug.
  return intersectExpediente(expedienteEstab, expedienteProf);
};

export const getLocalRangeMinutes = (startUtc, endUtc) => {
  const startMin = minutesOfDayInTZ(startUtc, EST_TZ_OFFSET_MIN);
  const endMin = minutesOfDayInTZ(endUtc, EST_TZ_OFFSET_MIN);
  const startDay = weekDayIndexInTZ(startUtc, EST_TZ_OFFSET_MIN);
  const endDay = weekDayIndexInTZ(endUtc, EST_TZ_OFFSET_MIN);
  const spansDays = startDay != null && endDay != null && startDay !== endDay;
  return { startMin, endMin, spansDays };
};

const hasBreakOverlap = (startMinAdj, endMinAdj, breaks, startMinutes, overnight) =>
  Array.isArray(breaks) &&
  breaks.some(([breakStart, breakEnd]) => {
    if (!Number.isFinite(breakStart) || !Number.isFinite(breakEnd)) return false;
    let bs = breakStart;
    let be = breakEnd;
    if (overnight && bs < startMinutes) {
      bs += DAY_MINUTES;
      be += DAY_MINUTES;
    }
    return startMinAdj < be && endMinAdj > bs;
  });

export const assertDentroExpediente = ({ startMin, endMin, abre, fecha, spansDays = false, breaks = [] }) => {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
  const abreMin = toMin(abre);
  const fechaMin = toMin(fecha);
  if (!Number.isFinite(abreMin) || !Number.isFinite(fechaMin)) return false;
  if (abreMin === fechaMin) return false;

  const crossesMidnight = spansDays || endMin < startMin;
  if (abreMin < fechaMin) {
    if (crossesMidnight) return false;
    if (startMin < abreMin || endMin > fechaMin) return false;
    if (hasBreakOverlap(startMin, endMin, breaks, abreMin, false)) return false;
    return true;
  }

  const startMinAdj = startMin < abreMin ? startMin + DAY_MINUTES : startMin;
  let endMinAdj = endMin + (crossesMidnight ? DAY_MINUTES : 0);
  if (endMinAdj < startMinAdj) {
    endMinAdj += DAY_MINUTES;
  }
  const closeMinAdj = fechaMin + DAY_MINUTES;
  if (startMinAdj < abreMin || endMinAdj > closeMinAdj) return false;
  if (hasBreakOverlap(startMinAdj, endMinAdj, breaks, abreMin, true)) return false;
  return true;
};

export const formatExpedienteMessage = (expediente) => {
  if (expediente?.abre && expediente?.fecha) {
    return `Horário fora do expediente (${expediente.abre}-${expediente.fecha}).`;
  }
  if (expediente?.closed) {
    return 'Horário fora do expediente (fechado).';
  }
  return 'Horário fora do expediente.';
};
