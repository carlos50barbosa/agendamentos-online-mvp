// frontend/src/components/settings/horariosProfissional.js
//
// Conversores entre o estado do WorkingHoursEditor e o formato que
// backend/src/lib/horarios_profissional.js aceita.
//
// POR QUE NÃO REUSAR daysFromHorarios/horariosFromDays DO EDITOR. Eles falam o dialeto do
// SALÃO, e ele é incompatível com o writer do profissional em três pontos, todos executados:
//
//   1. horariosFromDays emite `label` e `value` -> o writer recusa com 400 campo_desconhecido.
//      Não é detalhe: `value` é canal de comando do reader (isClosedValue), e é por isso que o
//      writer do profissional o proíbe em vez de ignorar.
//   2. horariosFromDays FILTRA os dias desligados -> a folga desaparece do payload em vez de
//      virar um dia fechado. O writer exige os sete e responde 400 dias_incompletos.
//   3. daysFromHorarios trata a PRESENÇA da entrada como dia ativo e inventa `start || '09:00'`
//      -> toda folga reabre como expediente 09:00-18:00. Abrir a tela e salvar sem tocar em
//      nada gravaria semana cheia por cima da folga.
//
// E não dá para consertar os compartilhados: eles servem a tela do salão, cujo backend aceita
// entrada só com `value` ("Fechado", "Sob agendamento"). Trocar "existe entrada" por "tem start
// e end" faria esses dias SUMIREM do perfil público no save seguinte. O dialeto do salão é
// tolerante por necessidade; o do profissional é estrito por necessidade. São dois contratos.
//
// A ASSIMETRIA QUE OBRIGA `fechado: true`: o writer GRAVA folga como `{"day":"monday"}` pelado,
// mas NÃO aceita isso de volta — reenviar o próprio JSON gravado dá 400 horarios_incompleto.
// É de propósito: o guard existe para "start sem end" não virar folga em silêncio. Então a
// leitura entende `{day}` pelado e a escrita emite `{day, fechado:true}`.
// A lista de dias mora AQUI, e não no editor, por um motivo prático: este arquivo não tem JSX,
// e é isso que permite ao `node --test` importá-lo direto e fechar o laço tela→writer→reader em
// CI, sem browser e sem build. Se ele importasse do `.jsx`, o Node recusaria a extensão. O
// editor passa a consumir esta constante, mantendo uma única fonte para a ordem de renderização
// — duas listas divergiriam no dia em que alguém reordenasse uma delas.
export const WEEKDAYS = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

// Espelha HORA_RE de backend/src/lib/horarios_profissional.js. Estrito de propósito: '9',
// '1:5' e '08:00:00' têm de falhar aqui igual falham lá, senão a tela promete o que o
// servidor recusa.
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Ordem de índice do buildWorkingRules (domingo = 0), que é a ordem em que o writer serializa.
const ORDEM_DIAS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ROTULO_DIA = {
  sunday: 'domingo',
  monday: 'segunda',
  tuesday: 'terça',
  wednesday: 'quarta',
  thursday: 'quinta',
  friday: 'sexta',
  saturday: 'sábado',
};

const DIA_MINUTOS = 1440;
const MAX_PAUSAS_DIA = 6;

const paraMinutos = (hora) => {
  const [h, m] = String(hora).split(':');
  return Number(h) * 60 + Number(m);
};

// A coluna é TEXT e a rota de profissionais devolve ela CRUA — ao contrário do perfil do salão,
// que já chega parseado. Sem este parse a tela veria zero dias ativos para quem tem escala, e
// salvar gravaria sete folgas: a profissional sumiria da agenda inteira, sem erro nenhum.
// JSON quebrado é tratado como "sem regra própria", que é exatamente o que o reader faz.
const parseDefensivo = (valor) => {
  if (Array.isArray(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trim()) return null;
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const horaValida = (valor) => HORA_RE.test(String(valor ?? ''));

/**
 * horarios_json (string ou array) -> os 7 dias do WorkingHoursEditor.
 *
 * A regra central está na linha do `aberto`: dia aberto é o que TEM start e end válidos, nunca
 * o que apenas existe na lista. É essa linha, e só ela, que impede a folga de voltar como
 * expediente 09:00-18:00.
 */
export function diasDeHorariosProf(horariosJsonOuArray) {
  const lista = parseDefensivo(horariosJsonOuArray);
  const porDia = {};
  (Array.isArray(lista) ? lista : []).forEach((item) => {
    if (item && typeof item.day === 'string') porDia[item.day] = item;
  });

  return WEEKDAYS.map(({ key, label }) => {
    const item = porDia[key];
    const aberto = Boolean(item) && horaValida(item.start) && horaValida(item.end);
    const pausas = aberto && Array.isArray(item.blocks)
      ? item.blocks.filter((b) => b && horaValida(b.start) && horaValida(b.end))
      : [];
    const pausa = pausas[0] || null;
    return {
      key,
      label,
      enabled: aberto,
      start: aberto ? item.start : '09:00',
      end: aberto ? item.end : '18:00',
      hasBreak: Boolean(pausa),
      breakStart: pausa?.start || '12:00',
      breakEnd: pausa?.end || '13:00',
    };
  });
}

/**
 * Os 7 dias do editor -> o array que o writer aceita.
 *
 * Sempre os SETE, em ordem de índice, sem nenhuma chave além de day/fechado/start/end/blocks.
 */
export function horariosProfDeDias(days) {
  const porChave = {};
  (days || []).forEach((dia) => { porChave[dia.key] = dia; });

  return ORDEM_DIAS.map((key) => {
    const dia = porChave[key];
    if (!dia || !dia.enabled) return { day: key, fechado: true };
    const item = { day: key, start: dia.start, end: dia.end };
    if (dia.hasBreak && dia.breakStart && dia.breakEnd) {
      item.blocks = [{ start: dia.breakStart, end: dia.breakEnd }];
    }
    return item;
  });
}

// Espelha pausaCabe do writer, que por sua vez espelha isBreakWithinWindow: em janela que vira
// a meia-noite a pausa precisa estar inteira no trecho tardio OU inteira na madrugada. A
// comparação lexicográfica que o validador do salão usa reprova pausa de madrugada.
const pausaCabe = (pausaIni, pausaFim, janelaIni, janelaFim) => {
  if (janelaIni < janelaFim) return pausaIni >= janelaIni && pausaFim <= janelaFim;
  return (pausaIni >= janelaIni && pausaFim <= DIA_MINUTOS) || (pausaIni >= 0 && pausaFim <= janelaFim);
};

/**
 * Validação por dia, espelhando o writer. Devolve { [key]: mensagem }.
 *
 * A diferença que importa em relação ao validateDays do salão: aqui `start > end` é VÁLIDO —
 * é turno que vira a meia-noite, que o writer aceita de propósito. O validador do salão o
 * recusa, e com razão para o salão: o sanitizador de lá INVERTE start/end, então 22:00-06:00
 * viraria uma janela diurna de 16 horas. Aqui não há inversão, e recusar deixaria plantão
 * noturno sem como ser declarado.
 */
export function validarDiasProf(days) {
  const erros = {};
  (days || []).forEach((dia) => {
    if (!dia.enabled) return;
    if (!horaValida(dia.start) || !horaValida(dia.end)) {
      erros[dia.key] = 'Use o formato 08:30 para início e fim.';
      return;
    }
    const ini = paraMinutos(dia.start);
    const fim = paraMinutos(dia.end);
    if (ini === fim) {
      erros[dia.key] = 'Início e fim são o mesmo horário. Se ela não trabalha nesse dia, desmarque o dia.';
      return;
    }
    if (!dia.hasBreak) return;
    if (!horaValida(dia.breakStart) || !horaValida(dia.breakEnd)) {
      erros[dia.key] = 'Use o formato 12:00 para o intervalo.';
      return;
    }
    const pausaIni = paraMinutos(dia.breakStart);
    const pausaFim = paraMinutos(dia.breakEnd);
    if (pausaIni >= pausaFim) {
      erros[dia.key] = 'O intervalo termina antes de começar.';
      return;
    }
    if (!pausaCabe(pausaIni, pausaFim, ini, fim)) {
      erros[dia.key] = 'O intervalo precisa ficar dentro do horário de trabalho do dia.';
    }
  });
  return erros;
}

/**
 * Horário do SALÃO -> os 7 dias, para semear a primeira configuração.
 *
 * Precisa existir separado porque o dialeto do salão marca dia fechado por TEXTO no campo
 * `value` ("Fechado", "Sob agendamento"), e não pela ausência de start/end. Usar o leitor do
 * profissional aqui trataria "Fechado" como dia sem horário — o que dá no mesmo — mas usar o
 * daysFromHorarios do editor traria de volta o bug de marcar tudo como 09:00-18:00.
 */
export function diasDeHorariosSalao(horarios) {
  const porDia = {};
  (Array.isArray(horarios) ? horarios : []).forEach((item) => {
    if (item && typeof item.day === 'string') porDia[item.day] = item;
  });

  return WEEKDAYS.map(({ key, label }) => {
    const item = porDia[key];
    const textoFechado = String(item?.value ?? '').toLowerCase();
    const fechado = textoFechado.includes('fechado')
      || textoFechado.includes('sem atendimento')
      || textoFechado.includes('nao atende')
      || textoFechado.includes('não atende');
    const aberto = Boolean(item) && !fechado && horaValida(item.start) && horaValida(item.end);
    const pausa = aberto && Array.isArray(item.blocks) && item.blocks[0] ? item.blocks[0] : null;
    return {
      key,
      label,
      enabled: aberto,
      start: aberto ? item.start : '09:00',
      end: aberto ? item.end : '18:00',
      hasBreak: Boolean(pausa) && horaValida(pausa.start) && horaValida(pausa.end),
      breakStart: pausa?.start || '12:00',
      breakEnd: pausa?.end || '13:00',
    };
  });
}

/**
 * A escala tem mais de um intervalo em algum dia?
 *
 * O editor lê e escreve UM intervalo por dia; o writer aceita seis. Uma escala com dois
 * intervalos, criada por API, seria truncada em silêncio ao passar por esta tela — e o horário
 * do segundo intervalo voltaria a ser vendável. Quando isto der true, a tela abre somente
 * leitura em vez de apagar o que não sabe editar.
 */
export function temPausasExtras(horariosJsonOuArray) {
  const lista = parseDefensivo(horariosJsonOuArray);
  return (Array.isArray(lista) ? lista : []).some(
    (item) => Array.isArray(item?.blocks) && item.blocks.length > 1
  );
}

// Mensagens por CÓDIGO, nunca o `message` cru do servidor: aquele texto é para quem integra
// (sem acento, com o dia em inglês) e quem lê aqui é dona de salão.
//
// Os sete primeiros são bug desta tela, não erro de quem preenche: se os conversores estiverem
// certos eles nunca aparecem, e não há nada que a dona possa corrigir — daí o texto genérico.
export const MENSAGENS_HORARIOS = {
  horarios_formato: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  campo_desconhecido: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  dia_invalido: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  dias_incompletos: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  dia_duplicado: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  pausa_formato: 'Não consegui montar os horários para enviar. Recarregue a página e tente de novo.',
  horarios_ilegiveis: 'Não consegui salvar esses horários com segurança, então não salvei nada. Anote o que você configurou e fale com o suporte.',
  horarios_incompleto: 'Falta o horário de início ou de fim. Preencha os dois, ou desmarque o dia.',
  horario_invalido: 'Há um horário incompleto. Use o formato 08:30.',
  janela_zero: 'O início e o fim são o mesmo horário. Se ela não trabalha nesse dia, desmarque o dia.',
  pausa_invalida: 'O intervalo termina antes de começar. Confira os dois horários.',
  pausa_fora_da_janela: 'O intervalo está fora do horário de trabalho dela nesse dia.',
  pausas_demais: 'São no máximo 6 intervalos por dia.',
};

/**
 * Erro da API -> texto para a tela. O dia sai da varredura por slug na mensagem do servidor,
 * que é a única parte dela aproveitável.
 */
export function mensagemDeErroHorarios(erro, fallback = 'Não foi possível salvar os horários.') {
  // O bloqueio por assinatura já vem com texto pronto em pt-BR.
  if (erro?.status === 402 && erro?.data?.message) return erro.data.message;

  const codigo = erro?.data?.error;
  const base = MENSAGENS_HORARIOS[codigo];
  if (!base) return erro?.data?.message || fallback;

  const bruta = String(erro?.data?.message || '');
  const slug = ORDEM_DIAS.find((dia) => bruta.includes(dia));
  return slug ? `${base.replace(/\.$/, '')} (${ROTULO_DIA[slug]}).` : base;
}
