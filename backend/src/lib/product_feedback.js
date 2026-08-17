// backend/src/lib/product_feedback.js
//
// Regras do feedback de produto, sem banco e sem Express — dá para testar cada decisão sem subir
// nada. A rota (routes/feedback.js) só traduz o resultado daqui em INSERT e status HTTP.
//
// O que este arquivo protege, na prática: a resposta chega de um formulário público, então o
// `tipo` e o `motivo` que vierem do navegador são palpite até serem checados contra as listas
// abaixo. Sem isso, meia dúzia de POSTs com `motivo: 'qualquer_coisa'` viram linhas que nenhum
// relatório agrupa, e o dado que a gente foi coletar justamente para poder AGRUPAR se perde.

export const FEEDBACK_TYPES = Object.freeze(['cancelamento', 'downgrade', 'nps', 'landing']);

// Os códigos são estáveis e os rótulos ficam no frontend: mudar o texto de uma opção não pode
// quebrar a série histórica. "Achei caro" pode virar "O preço não cabe no meu momento" na tela e
// os dois continuam contando como `preco` no relatório.
export const FEEDBACK_REASONS = Object.freeze({
  cancelamento: Object.freeze(['preco', 'sem_uso', 'falta_recurso', 'concorrente', 'dificuldade', 'fechei_negocio', 'outro']),
  downgrade: Object.freeze(['preco', 'sem_uso', 'falta_recurso', 'dificuldade', 'outro']),
  landing: Object.freeze(['preco', 'duvida_funciona', 'so_pesquisando', 'falta_recurso', 'outro']),
});

// Eventos do NPS que NÃO são resposta. Existem para tapar um buraco de leitura: sem eles, uma
// tabela vazia de NPS é ambígua entre "ninguém está insatisfeito" e "a caixa não apareceu para
// ninguém" — e essas duas realidades pedem ações opostas.
//
// Moram como `motivo` numa linha de `tipo='nps'` com `nota` NULL, e não numa tabela à parte:
// pertencem à mesma pergunta e são sempre lidos junto com ela (a taxa de resposta é uma divisão
// entre os dois). Toda conta de NPS já filtra por `nota IS NOT NULL`, então nenhuma métrica muda.
export const NPS_EVENT_EXIBIDO = 'exibido';
export const NPS_EVENT_DISPENSADO = 'dispensado';
export const NPS_EVENTS = Object.freeze([NPS_EVENT_EXIBIDO, NPS_EVENT_DISPENSADO]);

export const COMENTARIO_MAX = 1000;
export const CONTEXTO_MAX = 120;

// Quanto tempo depois de responder o NPS a pessoa fica em paz. 90 dias é o padrão da métrica
// (trimestral) e é longo o bastante para a nota significar algo novo em vez de humor do dia.
export const NPS_COOLDOWN_DIAS = 90;
// Fechou a caixa no X: descansa 30 dias. Menos que uma resposta (ela não disse nada, então não há
// dado novo a esperar), mas o suficiente para "não quero" ser respeitado.
export const NPS_DISPENSA_COOLDOWN_DIAS = 30;
// Só viu a caixa e seguiu a vida. Este é o cooldown que conserta um defeito real: como o silêncio
// local só era gravado ao responder ou ao fechar, quem simplesmente navegava para outra tela
// recebia a mesma caixa de novo 12s depois, em toda página, até ceder. Ignorar uma vez agora
// compra uma semana de paz — e a exibição registrada vira o denominador da taxa de resposta.
export const NPS_EXIBICAO_COOLDOWN_DIAS = 7;
// Marcos que liberam a primeira pergunta. Data OU volume, não os dois: quem fatura alto no
// primeiro mês já tem opinião formada, e quem usa pouco mas está há dois meses também.
export const NPS_MIN_DIAS_CONTA = 30;
export const NPS_MIN_AGENDAMENTOS = 20;

function cleanString(value, max) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * Valida e normaliza uma resposta vinda do navegador.
 * Devolve `{ ok: true, value }` ou `{ ok: false, error }` — nunca lança.
 */
export function normalizeFeedbackSubmission(input = {}) {
  const tipo = String(input?.tipo ?? '').trim().toLowerCase();
  if (!FEEDBACK_TYPES.includes(tipo)) {
    return { ok: false, error: 'tipo_invalido' };
  }

  const comentario = cleanString(input?.comentario, COMENTARIO_MAX);
  const contexto = cleanString(input?.contexto, CONTEXTO_MAX);

  // Evento do NPS (exibição/dispensa): é a MESMA pergunta, sem resposta. Sai por aqui cedo porque
  // as duas regras seguintes — nota obrigatória e motivo da lista de saída — não se aplicam a ele.
  if (tipo === 'nps' && NPS_EVENTS.includes(String(input?.motivo ?? '').trim().toLowerCase())) {
    return {
      ok: true,
      value: {
        tipo,
        motivo: String(input.motivo).trim().toLowerCase(),
        // Ignora qualquer `nota` que venha junto: uma exibição com nota seria contada como
        // resposta pelo relatório, e o denominador viraria o numerador.
        nota: null,
        comentario: null,
        contexto,
      },
    };
  }

  let nota = null;
  if (tipo === 'nps') {
    const raw = input?.nota;
    // String vazia vira 0 no Number() — e 0 é uma nota válida de NPS (o detrator mais extremo
    // que existe). Sem esta guarda, "não respondi" seria gravado como a pior nota possível.
    if (raw === null || raw === undefined || raw === '') return { ok: false, error: 'nota_obrigatoria' };
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) return { ok: false, error: 'nota_invalida' };
    nota = parsed;
  }

  let motivo = null;
  const allowed = FEEDBACK_REASONS[tipo];
  if (allowed) {
    motivo = String(input?.motivo ?? '').trim().toLowerCase() || null;
    if (!motivo) return { ok: false, error: 'motivo_obrigatorio' };
    if (!allowed.includes(motivo)) return { ok: false, error: 'motivo_invalido' };
    // "Outro" sem texto é a única resposta que não informa nada: some no relatório como um balde
    // sem conteúdo. Aqui ela custa uma frase — e é justamente a resposta de quem tem algo a dizer
    // que não estava na lista.
    if (motivo === 'outro' && (!comentario || comentario.length < 3)) {
      return { ok: false, error: 'comentario_obrigatorio' };
    }
  }

  return {
    ok: true,
    value: {
      tipo,
      motivo,
      nota,
      comentario,
      contexto,
    },
  };
}

export function classifyNps(nota) {
  // A mesma armadilha do formulário, agora do lado do relatório: Number(null) e Number('') são 0,
  // e 0 é o detrator mais extremo que existe. Sem esta guarda, toda linha sem nota (todo
  // cancelamento, todo downgrade) entraria na conta do NPS como a pior avaliação possível.
  if (nota === null || nota === undefined || nota === '') return null;
  const value = Number(nota);
  if (!Number.isInteger(value) || value < 0 || value > 10) return null;
  if (value >= 9) return 'promotor';
  if (value >= 7) return 'neutro';
  return 'detrator';
}

/**
 * NPS = %promotores - %detratores, arredondado. Neutros contam no denominador (é o que os
 * derruba a nota) mas não somam de nenhum lado.
 */
export function summarizeNps(entries = []) {
  const buckets = { promotor: 0, neutro: 0, detrator: 0 };
  for (const entry of entries) {
    const nota = entry && typeof entry === 'object' ? entry.nota : entry;
    const bucket = classifyNps(nota);
    if (bucket) buckets[bucket] += 1;
  }
  const total = buckets.promotor + buckets.neutro + buckets.detrator;
  if (!total) return { score: null, total: 0, ...buckets };
  const score = Math.round(((buckets.promotor - buckets.detrator) / total) * 100);
  return { score, total, ...buckets };
}

/**
 * Taxa de resposta do NPS: respostas / vezes que a caixa apareceu.
 *
 * O denominador são as EXIBIÇÕES, não as dispensas: quem viu e navegou para outra tela sem clicar
 * em nada também não respondeu, e some da conta se o denominador for só quem fechou no X.
 *
 * `respostas > exibicoes` é possível na prática (respostas antigas, de antes de existir registro
 * de exibição) — por isso o teto de 100%, senão o painel mostraria "133% responderam".
 */
export function summarizeNpsResponseRate({ exibicoes = 0, respostas = 0, dispensas = 0 } = {}) {
  const total = Number(exibicoes) || 0;
  const ok = Number(respostas) || 0;
  if (!total) return { exibicoes: 0, respostas: ok, dispensas: Number(dispensas) || 0, taxa: null };
  return {
    exibicoes: total,
    respostas: ok,
    dispensas: Number(dispensas) || 0,
    taxa: Math.min(100, Math.round((ok / total) * 100)),
  };
}

/**
 * Decide se o dono deve ver o NPS agora. Recebe fatos já lidos do banco para continuar puro.
 *
 * `ultimaRespostaEm` mandando em tudo é de propósito: quem acabou de responder não é perguntado
 * de novo mesmo tendo batido todos os marcos. Pesquisa que reaparece vira ruído, e ruído é
 * fechado no reflexo — depois disso a pessoa nunca mais lê o que a caixa pergunta.
 */
export function isNpsEligible({
  contaCriadaEm,
  agendamentos = 0,
  ultimaRespostaEm = null,
  ultimaDispensaEm = null,
  ultimaExibicaoEm = null,
  agora = new Date(),
} = {}) {
  const now = agora instanceof Date ? agora : new Date(agora);
  if (!Number.isFinite(now.getTime())) return { eligible: false, reason: 'agora_invalido' };

  const diasDesde = (valor) => {
    if (!valor) return null;
    const quando = valor instanceof Date ? valor : new Date(valor);
    if (!Number.isFinite(quando.getTime())) return null;
    return (now.getTime() - quando.getTime()) / 86400000;
  };

  // Ordem do mais forte para o mais fraco: quem respondeu descansa mais que quem só fechou, que
  // descansa mais que quem só viu. Um evento fraco NÃO pode encurtar o silêncio de um forte — daí
  // os três testes em sequência em vez de "pega o mais recente e aplica o prazo dele".
  const desdeResposta = diasDesde(ultimaRespostaEm);
  if (desdeResposta !== null && desdeResposta < NPS_COOLDOWN_DIAS) {
    return { eligible: false, reason: 'respondeu_recentemente' };
  }
  const desdeDispensa = diasDesde(ultimaDispensaEm);
  if (desdeDispensa !== null && desdeDispensa < NPS_DISPENSA_COOLDOWN_DIAS) {
    return { eligible: false, reason: 'dispensou_recentemente' };
  }
  const desdeExibicao = diasDesde(ultimaExibicaoEm);
  if (desdeExibicao !== null && desdeExibicao < NPS_EXIBICAO_COOLDOWN_DIAS) {
    return { eligible: false, reason: 'exibido_recentemente' };
  }

  if (Number(agendamentos) >= NPS_MIN_AGENDAMENTOS) return { eligible: true, reason: 'volume' };

  const criada = contaCriadaEm instanceof Date ? contaCriadaEm : new Date(contaCriadaEm);
  if (Number.isFinite(criada.getTime())) {
    const dias = (now.getTime() - criada.getTime()) / 86400000;
    if (dias >= NPS_MIN_DIAS_CONTA) return { eligible: true, reason: 'tempo_de_casa' };
  }

  return { eligible: false, reason: 'sem_marco' };
}
