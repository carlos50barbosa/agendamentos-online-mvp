// Writer de profissionais.horarios_json: o que ele PRECISA recusar.
//
// Por que este arquivo existe: o reader falha ABERTO. buildWorkingRules devolve null para JSON
// ilegivel, e null significa "sem regra propria" — a profissional HERDA o horario do salao.
// Entao todo caminho de perda silenciosa deste writer tem o mesmo desfecho: a dona marca a folga
// de segunda, ve "salvo", e a profissional continua recebendo agendamento na segunda.
//
// Os casos AGENDA ABERTA aqui nao sao hipoteses. Cada um foi rodado contra a lib real:
//
//   [{"day":"monday","enabled":false,"start":"09:00","end":"18:00"}]
//     -> buildWorkingRules IGNORA a flag: o dia le como ABERTO 09:00-18:00.
//   "[]"
//     -> null -> herda o salao. "Nao trabalha nenhum dia" vira "trabalha os sete".
//
// Ha ainda um agravante de cronologia: nada consome horarios_json ate a Fase 2 subir. Um writer
// errado fica LATENTE e so vira agendamento indevido semanas depois, longe do commit que causou.
// E por isso que existe o portao de round-trip — ele e o unico mecanismo que falha AGORA, no
// save, em vez de depois, na agenda.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const { DIAS_SEMANA, montarUpdateComHorarios, parseHorariosProfissional } = await import(
  '../src/lib/horarios_profissional.js'
);
const mysql = (await import('mysql2/promise')).default;
const { assertDentroExpediente, buildWorkingRules, intersectExpediente, resolveExpedienteForDay, toMin } =
  await import('../src/lib/expediente.js');

// Semana completa a partir de um mapa parcial; o resto vira folga. Escrever os 7 dias em cada
// teste esconderia o que cada caso esta exercitando.
const semana = (parcial = {}) =>
  DIAS_SEMANA.map((day) => (parcial[day] ? { day, ...parcial[day] } : { day, fechado: true }));

const recusa = (entrada, code, rotulo) => {
  assert.throws(
    () => parseHorariosProfissional(entrada),
    (err) => {
      assert.equal(err.status, 400, `${rotulo}: precisa ser 400`);
      assert.equal(err.code, code, `${rotulo}: codigo errado (veio ${err.code})`);
      return true;
    },
    rotulo
  );
};

const aceita = (entrada, rotulo) => {
  const res = parseHorariosProfissional(entrada);
  assert.equal(res.mode, 'set', `${rotulo}: deveria ter sido aceito`);
  return res;
};

const diaLido = (json, indice) => resolveExpedienteForDay(buildWorkingRules(json), indice);

const salao = (abre, fecha) => ({
  abre,
  fecha,
  startMinutes: toMin(abre),
  endMinutes: toMin(fecha),
  breaks: [],
  closed: false,
  source: 'profile',
});

const podeAgendar = (expediente, iniMin, fimMin) =>
  assertDentroExpediente({
    startMin: iniMin,
    endMin: fimMin,
    abre: expediente.abre,
    fecha: expediente.fecha,
    spansDays: false,
    breaks: expediente.breaks,
  });

const h = (hora, minuto = 0) => hora * 60 + minuto;

// ---------------------------------------------------------------------------
// Os tres modos — e a razao de eles existirem
// ---------------------------------------------------------------------------

test('modo skip: campo ausente nao toca na coluna', () => {
  assert.deepEqual(parseHorariosProfissional(undefined), { mode: 'skip', json: null });
});

test('modo clear: null explicito volta a herdar o salao', () => {
  assert.deepEqual(parseHorariosProfissional(null), { mode: 'clear', json: null });
});

test('modo set: semana valida serializa em ordem de indice', () => {
  const { json } = aceita(
    semana({ monday: { start: '09:00', end: '18:00' } }).reverse(),
    'ordem embaralhada'
  );
  const dias = JSON.parse(json).map((item) => item.day);
  assert.deepEqual(dias, DIAS_SEMANA, 'a saida sai sempre em ordem de indice');
});

// ---------------------------------------------------------------------------
// AGENDA ABERTA — os inegociaveis
// ---------------------------------------------------------------------------

test('AGENDA ABERTA: semana inteira de folga grava fechado de verdade, nao "[]"', () => {
  const { json } = aceita(semana(), 'sete folgas');
  assert.notEqual(json, '[]');
  assert.notEqual(buildWorkingRules(json), null, 'o reader precisa conseguir ler');

  // O desfecho que isto impede: licenca/afastamento virando disponibilidade os sete dias.
  for (let indice = 0; indice < 7; indice += 1) {
    const lido = diaLido(json, indice);
    assert.equal(lido.closed, true, `dia ${indice} precisa estar fechado`);
    const efetivo = intersectExpediente(salao('08:00', '20:00'), lido);
    assert.equal(efetivo.closed, true);
    assert.equal(podeAgendar(efetivo, h(10), h(11)), false);
  }
});

test('AGENDA ABERTA: flag booleana desconhecida e recusada, nunca ignorada', () => {
  // buildWorkingRules IGNORA estas flags e le o dia como ABERTO 09:00-18:00. Uma tela que mande
  // o estado do checkbox junto com o ultimo horario digitado grava folga que vira expediente.
  for (const chave of ['enabled', 'ativo', 'closed', 'aberto', 'off', 'open']) {
    recusa(
      semana({ monday: { [chave]: false, start: '09:00', end: '18:00' } }),
      'campo_desconhecido',
      `chave ${chave}`
    );
  }
});

test('AGENDA ABERTA: lista vazia e semana incompleta sao recusadas', () => {
  recusa([], 'dias_incompletos', 'lista vazia');
  recusa([{ day: 'monday', start: '09:00', end: '18:00' }], 'dias_incompletos', 'so segunda');
});

test('AGENDA ABERTA: dia duplicado e recusado (o reader e first-wins)', () => {
  const entrada = semana({ monday: { start: '09:00', end: '12:00' } });
  entrada.push({ day: 'monday', start: '14:00', end: '18:00' });
  recusa(entrada, 'dia_duplicado', 'segunda duas vezes');
});

test('AGENDA ABERTA: campo "value" e recusado — e canal de comando do reader', () => {
  // isClosedValue e testado ANTES de start/end: um rotulo contendo "fechado" apagaria o dia.
  recusa(
    semana({ monday: { value: 'Fechado p/ almoco', start: '09:00', end: '18:00' } }),
    'campo_desconhecido',
    'value'
  );
});

test('AGENDA ABERTA: formatos que o reader leria como null', () => {
  recusa({ monday: { start: '09:00', end: '18:00' } }, 'horarios_formato', 'mapa em vez de lista');
  recusa(['Segunda 09:00-18:00'], 'horarios_formato', 'lista de strings');
  recusa(semana({ monday: { start: '09:00', end: '18:00' } }).map((d) => ({ ...d, day: 1 })), 'dia_invalido', 'dia numerico');
  recusa(
    [...semana().slice(1), { key: 'sunday', start: '09:00', end: '18:00' }],
    'campo_desconhecido',
    'key em vez de day'
  );
});

test('AGENDA ABERTA: pausa que o reader descartaria e recusada', () => {
  const comPausa = (blocks) => semana({ monday: { start: '09:00', end: '18:00', blocks } });
  recusa(comPausa([{ start: '20:00', end: '21:00' }]), 'pausa_fora_da_janela', 'fora da janela');
  recusa(comPausa([[720, 780]]), 'pausa_formato', 'tupla de minutos');
  recusa(comPausa([{ start: 720, end: 780 }]), 'horario_invalido', 'minutos em vez de HH:MM');
  recusa(comPausa([{ start: '13:00', end: '12:00' }]), 'pausa_invalida', 'invertida');
  recusa(comPausa([{ start: '12:00', end: '12:00' }]), 'pausa_invalida', 'largura zero');
});

// ---------------------------------------------------------------------------
// Turno que vira a meia-noite — nao pode ser recusado nem invertido
// ---------------------------------------------------------------------------

test('turno noturno e preservado, nao invertido', () => {
  // sanitizeHorariosInput do salao gravaria isto como 06:00-22:00, virando plantao noturno em
  // janela diurna de 16h. Por isso este writer nao reusa aquele.
  const { json } = aceita(
    semana({
      friday: {
        start: '22:00',
        end: '06:00',
        blocks: [{ start: '23:00', end: '23:30' }, { start: '01:00', end: '02:00' }],
      },
    }),
    'sexta 22-06'
  );
  const gravado = JSON.parse(json).find((item) => item.day === 'friday');
  assert.equal(gravado.start, '22:00');
  assert.equal(gravado.end, '06:00');

  const lido = diaLido(json, 5);
  assert.equal(lido.abre, '22:00');
  assert.equal(lido.fecha, '06:00');
  assert.equal(lido.breaks.length, 2, 'a pausa da madrugada precisa sobreviver');

  const efetivo = intersectExpediente(salao('20:00', '08:00'), lido);
  assert.equal(efetivo.abre, '22:00');
  assert.equal(podeAgendar(efetivo, h(1, 15), h(1, 45)), false, 'dentro da pausa da madrugada');
  assert.equal(podeAgendar(efetivo, h(3), h(4)), true);
});

test('janela que termina a meia-noite nao e recusada', () => {
  const { json } = aceita(semana({ monday: { start: '14:00', end: '00:00' } }), 'ate meia-noite');
  const lido = diaLido(json, 1);
  assert.equal(lido.abre, '14:00');
  assert.equal(lido.fecha, '00:00');
});

// ---------------------------------------------------------------------------
// Horario tolerante: cada um destes seria "consertado" por um parser esperto
// ---------------------------------------------------------------------------

test('horario e recusado sem coercao nenhuma', () => {
  const invalidos = ['09:00:00', '24:00', '1:5', '9', '1930', '25:00', '10:75', 540, '', '9:00', '2026-08-15T09:00:00Z'];
  for (const valor of invalidos) {
    recusa(
      semana({ monday: { start: valor, end: '18:00' } }),
      'horario_invalido',
      `start = ${JSON.stringify(valor)}`
    );
  }
  // '1:5' merece nota propria: um parser tolerante o coage para 15:00.
  recusa(semana({ monday: { start: '1:5', end: '18:00' } }), 'horario_invalido', '1:5');
});

test('start igual a end e recusado (viraria folga silenciosa)', () => {
  recusa(semana({ monday: { start: '09:00', end: '09:00' } }), 'janela_zero', 'largura zero');
});

test('start sem end tem codigo proprio', () => {
  recusa(semana({ monday: { start: '09:00' } }), 'horarios_incompleto', 'so start');
  recusa(semana({ monday: { end: '18:00' } }), 'horarios_incompleto', 'so end');
});

test('fechado precisa ser booleano estrito', () => {
  recusa(
    DIAS_SEMANA.map((day) => ({ day, fechado: day === 'monday' ? 'true' : true })),
    'campo_desconhecido',
    'fechado como string'
  );
});

// ---------------------------------------------------------------------------
// Falsos positivos: configuracao legitima que NAO pode ser recusada
// ---------------------------------------------------------------------------

test('janela mais larga que o salao passa — quem clampa e a intersecao', () => {
  const { json } = aceita(semana({ monday: { start: '06:00', end: '23:00' } }), 'mais larga');
  const efetivo = intersectExpediente(salao('08:00', '18:00'), diaLido(json, 1));
  assert.equal(efetivo.abre, '08:00');
  assert.equal(efetivo.fecha, '18:00');
});

test('interseccao vazia com o salao de hoje passa — validar contra o salao seria 400 eterno', () => {
  // Se isto fosse recusado, mudar o horario do salao depois quebraria os cadastros existentes.
  aceita(semana({ monday: { start: '20:00', end: '23:00' } }), 'fora do salao atual');
});

test('fechado:true com start/end sobrando grava o dia pelado', () => {
  // Payload natural de um editor que preserva o ultimo horario digitado ao desmarcar o dia.
  const { json } = aceita(
    semana({ monday: { fechado: true, start: '09:00', end: '18:00' } }),
    'fechado com sobra'
  );
  const gravado = JSON.parse(json).find((item) => item.day === 'monday');
  assert.deepEqual(gravado, { day: 'monday' });
  assert.equal(diaLido(json, 1).closed, true);
});

test('blocks vazio nao vira chave no JSON gravado', () => {
  const { json } = aceita(semana({ monday: { start: '09:00', end: '18:00', blocks: [] } }), 'blocks vazio');
  const gravado = JSON.parse(json).find((item) => item.day === 'monday');
  assert.deepEqual(gravado, { day: 'monday', start: '09:00', end: '18:00' });
});

test('duas pausas no mesmo dia passam, e as duas bloqueiam', () => {
  const { json } = aceita(
    semana({
      monday: {
        start: '09:00',
        end: '18:00',
        blocks: [{ start: '12:00', end: '13:00' }, { start: '15:00', end: '15:30' }],
      },
    }),
    'duas pausas'
  );
  const efetivo = intersectExpediente(salao('08:00', '20:00'), diaLido(json, 1));
  assert.equal(podeAgendar(efetivo, h(12), h(13)), false);
  assert.equal(podeAgendar(efetivo, h(15), h(15, 30)), false);
  assert.equal(podeAgendar(efetivo, h(14), h(15)), true);
});

test('pausa colada na abertura e janela curta passam', () => {
  aceita(
    semana({ monday: { start: '09:00', end: '18:00', blocks: [{ start: '09:00', end: '09:30' }] } }),
    'pausa colada'
  );
  aceita(semana({ monday: { start: '09:00', end: '09:15' } }), 'janela de 15 min');
});

test('fechado:false com horario e um dia de trabalho normal', () => {
  const { json } = aceita(
    semana({ monday: { fechado: false, start: '09:00', end: '18:00' } }),
    'fechado false'
  );
  assert.equal(diaLido(json, 1).closed, false);
});

test('dia em portugues e recusado com a lista de valores aceitos', () => {
  assert.throws(
    () => parseHorariosProfissional(DIAS_SEMANA.map((day) => ({ day: day === 'monday' ? 'segunda' : day, fechado: true }))),
    (err) => {
      assert.equal(err.code, 'dia_invalido');
      assert.match(err.message, /monday/, 'a mensagem precisa dizer o que e aceito');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// O portao de round-trip
// ---------------------------------------------------------------------------

test('o portao recusa qualquer JSON que o reader nao devolva igual', () => {
  // Simula writer bugado: a validacao de campo passaria, mas o reader entenderia outra coisa.
  // Nao da para forcar isso pela API publica sem quebrar o modulo, entao o teste confirma o
  // outro lado: TODA saida aceita sobrevive ao round-trip com fidelidade.
  const casos = [
    semana({ monday: { start: '09:00', end: '18:00' } }),
    semana({ friday: { start: '22:00', end: '06:00', blocks: [{ start: '01:00', end: '02:00' }] } }),
    semana(),
    semana({ tuesday: { start: '09:00', end: '18:00', blocks: [{ start: '12:00', end: '13:00' }] } }),
  ];
  for (const entrada of casos) {
    const { json } = aceita(entrada, 'round-trip');
    const rules = buildWorkingRules(json);
    assert.notEqual(rules, null);
    for (const item of JSON.parse(json)) {
      const lido = resolveExpedienteForDay(rules, DIAS_SEMANA.indexOf(item.day));
      if (item.start === undefined) {
        assert.equal(lido.closed, true, `${item.day} deveria estar fechado`);
      } else {
        assert.equal(lido.abre, item.start, `${item.day} abre`);
        assert.equal(lido.fecha, item.end, `${item.day} fecha`);
        assert.equal(lido.breaks.length, (item.blocks || []).length, `${item.day} pausas`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// O UPDATE ramificado — o toggle Ativar/Inativar nao pode zerar a folga
// ---------------------------------------------------------------------------

const CAMPOS_BASE = ['nome=?', 'descricao=?', 'avatar_url=?', 'ativo=?'];
const VALORES_BASE = ['Ana', null, null, 1];

test('skip: a coluna fica FORA do UPDATE', () => {
  // Este e o caminho do PUT { ativo: false } que a tela dispara a cada clique no toggle.
  const { campos, valores } = montarUpdateComHorarios(CAMPOS_BASE, VALORES_BASE, { mode: 'skip', json: null });
  assert.ok(!campos.includes('horarios_json=?'), 'skip nao pode tocar na coluna');
  assert.equal(valores.length, VALORES_BASE.length);
});

test('clear: a coluna entra no UPDATE com NULL', () => {
  const { campos, valores } = montarUpdateComHorarios(CAMPOS_BASE, VALORES_BASE, { mode: 'clear', json: null });
  assert.ok(campos.includes('horarios_json=?'), 'limpar precisa ser exprimivel');
  assert.equal(valores.at(-1), null);
});

test('set: a coluna entra no UPDATE com o JSON', () => {
  const { json } = aceita(semana({ monday: { start: '09:00', end: '18:00' } }), 'set');
  const { campos, valores } = montarUpdateComHorarios(CAMPOS_BASE, VALORES_BASE, { mode: 'set', json });
  assert.ok(campos.includes('horarios_json=?'));
  assert.equal(valores.at(-1), json);
});

test('AGENDA ABERTA: a alternativa ingenua apagaria a folga em silencio', () => {
  // Prova de que o ramo existe por um motivo. Escrever a coluna sempre, com fallback para um
  // valor que o SELECT nao trouxe, produz `undefined` no bind — e o caminho query() do mysql2
  // o converte para NULL sem lancar. NULL na coluna significa "herda o salao".
  const sqlIngenuo = mysql.format(
    'UPDATE profissionais SET nome=?, horarios_json=? WHERE id=?',
    ['Ana', undefined, 7]
  );
  assert.match(sqlIngenuo, /horarios_json=NULL/, 'undefined vira NULL sem erro — dai o ramo');

  // E o ramo correto nem chega a montar o parametro.
  const { campos } = montarUpdateComHorarios(CAMPOS_BASE, VALORES_BASE, { mode: 'skip', json: undefined });
  assert.ok(!campos.includes('horarios_json=?'));
});

test('montarUpdateComHorarios nao muta os arrays recebidos', () => {
  const campos = [...CAMPOS_BASE];
  const valores = [...VALORES_BASE];
  montarUpdateComHorarios(campos, valores, { mode: 'set', json: '[]' });
  assert.deepEqual(campos, CAMPOS_BASE);
  assert.deepEqual(valores, VALORES_BASE);
});

test('pausas demais sao recusadas em vez de truncadas', () => {
  const blocks = Array.from({ length: 7 }, (_, i) => ({
    start: `${String(9 + i).padStart(2, '0')}:00`,
    end: `${String(9 + i).padStart(2, '0')}:30`,
  }));
  recusa(semana({ monday: { start: '08:00', end: '20:00', blocks } }), 'pausas_demais', '7 pausas');
});
