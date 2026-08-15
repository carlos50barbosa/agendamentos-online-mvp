// Os conversores da TELA contra o writer e o reader de verdade.
//
// Por que este arquivo mora em backend/tests apesar de testar codigo do frontend: e o unico
// lugar onde da para fechar o laco inteiro — o que a tela produz, o que o writer aceita, e o
// que o reader entende — sem browser e sem tooling novo. Os conversores sao funcoes puras num
// .js sem JSX, e o frontend/package.json declara "type":"module", entao o node --test importa
// os dois lados direto. run-tests.mjs varre tests/*.test.js, entao este arquivo entra no
// test:all sozinho.
//
// O QUE ELE SEGURA. O editor de horarios do SALAO nao serve ao profissional, e falha em tres
// pontos que este arquivo fixa (todos medidos contra as funcoes reais):
//
//   1. horariosFromDays do salao emite `label` e `value` -> 400 campo_desconhecido;
//   2. ele FILTRA os dias desligados -> a folga some do payload -> 400 dias_incompletos;
//   3. daysFromHorarios trata PRESENCA como dia ativo -> toda folga reabre 09:00-18:00.
//
// O item 3 e o perigoso, porque e silencioso: abrir a tela e salvar sem tocar em nada gravaria
// semana cheia por cima da folga. Hoje o writer estrito o transforma num 400 barulhento por
// acidente (por causa do item 1) — o teste "controle" abaixo prova que consertar SO a
// serializacao reabriria a gravacao silenciosa. O conserto obrigatorio e o do LEITOR.
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  diasDeHorariosProf,
  diasDeHorariosSalao,
  horariosProfDeDias,
  mensagemDeErroHorarios,
  temPausasExtras,
  validarDiasProf,
} = await import('../../frontend/src/components/settings/horariosProfissional.js');

const { parseHorariosProfissional } = await import('../src/lib/horarios_profissional.js');
const { buildWorkingRules, resolveExpedienteForDay } = await import('../src/lib/expediente.js');

const ORDEM = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const gravar = (days) => parseHorariosProfissional(horariosProfDeDias(days));
const lerDia = (json, slug) =>
  resolveExpedienteForDay(buildWorkingRules(json), ORDEM.indexOf(slug));

const marcar = (days, key, patch) => days.map((d) => (d.key === key ? { ...d, ...patch } : d));

// ---------------------------------------------------------------------------
// O laco fechado
// ---------------------------------------------------------------------------

test('ida e volta preserva a escala, incluindo as folgas', () => {
  const dias = marcar(
    diasDeHorariosProf(null).map((d) => ({ ...d, enabled: true })),
    'monday',
    { enabled: false }
  );

  const { mode, json } = gravar(dias);
  assert.equal(mode, 'set');

  // Reabrir a tela com o que foi gravado devolve exatamente o mesmo estado.
  const reaberto = diasDeHorariosProf(json);
  assert.equal(reaberto.find((d) => d.key === 'monday').enabled, false, 'a folga tem de voltar folga');
  assert.equal(reaberto.filter((d) => d.enabled).length, 6);

  // E salvar de novo produz JSON idêntico — sem deriva a cada abertura.
  assert.equal(gravar(reaberto).json, json);
});

test('AGENDA ABERTA: abrir e salvar sem tocar em nada nao ressuscita a folga', () => {
  // A sequência exata da armadilha: gravar uma folga, reabrir, salvar.
  const comFolga = marcar(
    diasDeHorariosProf(null).map((d) => ({ ...d, enabled: true })),
    'monday',
    { enabled: false }
  );
  const gravado = gravar(comFolga).json;

  const depoisDeReabrir = gravar(diasDeHorariosProf(gravado)).json;
  assert.equal(depoisDeReabrir, gravado);
  assert.equal(lerDia(depoisDeReabrir, 'monday').closed, true, 'a segunda tem de continuar fechada');
});

test('CONTROLE: o leitor do SALAO ressuscitaria a folga — por isso ele nao e reusado', () => {
  // Este teste existe para provar que o conserto obrigatório é o do LEITOR, e não só o da
  // serialização. Ele reproduz o daysFromHorarios do salão (presença = dia ativo, mais o
  // default 09:00) e mostra o que aconteceria se a tela usasse aquele leitor com este
  // serializer — que é o conserto "óbvio" de quem só vê o 400 de campo_desconhecido.
  const canonico = ORDEM.map((day) => (day === 'monday' ? { day } : { day, start: '09:00', end: '18:00' }));
  const leitorDoSalao = canonico.map((h) => ({
    key: h.day,
    label: h.day,
    enabled: true,               // <-- PRESENÇA vira dia ativo
    start: h.start || '09:00',   // <-- e o horário é inventado
    end: h.end || '18:00',
    hasBreak: false,
    breakStart: '12:00',
    breakEnd: '13:00',
  }));

  const { mode, json } = gravar(leitorDoSalao);
  assert.equal(mode, 'set', 'o writer ACEITA — o estrago nao seria barrado');
  assert.equal(lerDia(json, 'monday').closed, false, 'a folga virou expediente');
  assert.equal(lerDia(json, 'monday').abre, '09:00');
});

// ---------------------------------------------------------------------------
// O que o writer exige e o editor do salao nao entrega
// ---------------------------------------------------------------------------

test('a saida carrega os SETE dias e nenhuma chave estranha', () => {
  const dias = marcar(diasDeHorariosProf(null), 'monday', { enabled: true });
  const saida = horariosProfDeDias(dias);

  assert.equal(saida.length, 7);
  assert.deepEqual(saida.map((d) => d.day), ORDEM, 'em ordem de indice');
  for (const item of saida) {
    for (const chave of Object.keys(item)) {
      assert.ok(
        ['day', 'fechado', 'start', 'end', 'blocks'].includes(chave),
        `chave ${chave} seria 400 campo_desconhecido`
      );
    }
  }
  // Folga vai com fechado:true, e nao como o {day} pelado que o writer GRAVA: reenviar o
  // proprio formato gravado da 400 horarios_incompleto, de proposito.
  assert.deepEqual(saida.find((d) => d.day === 'sunday'), { day: 'sunday', fechado: true });
});

test('semana inteira de folga e aceita e fecha os sete dias', () => {
  const { mode, json } = gravar(diasDeHorariosProf(null));
  assert.equal(mode, 'set');
  for (const slug of ORDEM) {
    assert.equal(lerDia(json, slug).closed, true, `${slug} deveria estar fechado`);
  }
});

// ---------------------------------------------------------------------------
// Turno que vira a meia-noite: aceito aqui, recusado no validador do salao
// ---------------------------------------------------------------------------

test('plantao noturno passa pelo validador e pelo writer', () => {
  const dias = marcar(diasDeHorariosProf(null), 'friday', {
    enabled: true, start: '22:00', end: '06:00', hasBreak: true, breakStart: '01:00', breakEnd: '02:00',
  });

  assert.deepEqual(validarDiasProf(dias), {}, 'o validador nao pode recusar turno que vira');

  const { mode, json } = gravar(dias);
  assert.equal(mode, 'set');
  const sexta = lerDia(json, 'friday');
  assert.equal(sexta.abre, '22:00');
  assert.equal(sexta.fecha, '06:00');
  assert.equal(sexta.breaks.length, 1, 'a pausa da madrugada tem de sobreviver');
});

test('validarDiasProf recusa o que o writer recusaria', () => {
  const base = diasDeHorariosProf(null);
  const casos = [
    [{ enabled: true, start: '09:00', end: '09:00' }, 'janela zero'],
    [{ enabled: true, start: '9:00', end: '18:00' }, 'hora sem zero a esquerda'],
    [{ enabled: true, start: '09:00', end: '18:00', hasBreak: true, breakStart: '13:00', breakEnd: '12:00' }, 'pausa invertida'],
    [{ enabled: true, start: '09:00', end: '18:00', hasBreak: true, breakStart: '19:00', breakEnd: '20:00' }, 'pausa fora'],
  ];
  for (const [patch, rotulo] of casos) {
    const erros = validarDiasProf(marcar(base, 'monday', patch));
    assert.ok(erros.monday, `deveria acusar: ${rotulo}`);
  }
});

// ---------------------------------------------------------------------------
// Leitura defensiva: a coluna chega como STRING
// ---------------------------------------------------------------------------

test('a coluna chega como string crua e precisa ser parseada', () => {
  // A rota de profissionais devolve horarios_json sem parse, ao contrario do perfil do salao.
  // Sem o parse, a tela veria zero dias ativos para quem TEM escala — e salvar gravaria sete
  // folgas, tirando a profissional da agenda inteira sem erro nenhum.
  const json = gravar(marcar(diasDeHorariosProf(null), 'monday', { enabled: true })).json;
  assert.equal(typeof json, 'string');

  const daString = diasDeHorariosProf(json);
  assert.equal(daString.filter((d) => d.enabled).length, 1);
  assert.equal(daString.find((d) => d.key === 'monday').enabled, true);
});

test('json ilegivel vira "sem regra propria", nao semana cheia', () => {
  for (const entrada of [null, undefined, '', '{nao e json', '{}', '[]', 42]) {
    const dias = diasDeHorariosProf(entrada);
    assert.equal(dias.length, 7, `${JSON.stringify(entrada)}: sempre 7 dias`);
    assert.equal(dias.filter((d) => d.enabled).length, 0, `${JSON.stringify(entrada)}: nenhum ativo`);
  }
});

// ---------------------------------------------------------------------------
// Pausas extras e a semente do salao
// ---------------------------------------------------------------------------

test('temPausasExtras acusa escala que esta tela truncaria', () => {
  const duasPausas = JSON.stringify([
    { day: 'monday', start: '08:00', end: '20:00', blocks: [{ start: '12:00', end: '13:00' }, { start: '16:00', end: '16:30' }] },
  ]);
  assert.equal(temPausasExtras(duasPausas), true);
  assert.equal(temPausasExtras(gravar(diasDeHorariosProf(null)).json), false);
  assert.equal(temPausasExtras(null), false);
});

test('a semente le o dialeto do salao, inclusive o "Fechado" textual', () => {
  // No salao, dia fechado e marcado por TEXTO no campo `value` — nao pela ausencia de horario.
  // O leitor do editor trataria isso como dia ativo 09:00-18:00.
  const doSalao = [
    { day: 'monday', start: '09:00', end: '18:00', value: '09:00 - 18:00' },
    { day: 'sunday', value: 'Fechado' },
    { day: 'saturday', value: 'Sob agendamento' },
  ];
  const dias = diasDeHorariosSalao(doSalao);
  assert.equal(dias.find((d) => d.key === 'monday').enabled, true);
  assert.equal(dias.find((d) => d.key === 'sunday').enabled, false, '"Fechado" nao pode virar expediente');
  assert.equal(dias.find((d) => d.key === 'saturday').enabled, false);
  assert.equal(dias.find((d) => d.key === 'tuesday').enabled, false, 'dia ausente e folga');
});

// ---------------------------------------------------------------------------
// Mensagens de erro
// ---------------------------------------------------------------------------

test('erro do writer vira texto de dona de salao, com o dia em pt-BR', () => {
  const erro = {
    status: 400,
    data: { error: 'janela_zero', message: 'O horario de monday comeca e termina no mesmo minuto.' },
  };
  const texto = mensagemDeErroHorarios(erro);
  assert.match(texto, /segunda/, 'o dia precisa sair em portugues');
  assert.doesNotMatch(texto, /monday/);

  // Bloqueio por assinatura ja vem pronto em pt-BR.
  assert.equal(
    mensagemDeErroHorarios({ status: 402, data: { message: 'Regularize a assinatura.' } }),
    'Regularize a assinatura.'
  );
  // Codigo desconhecido nao pode virar string vazia.
  assert.ok(mensagemDeErroHorarios({ status: 500, data: {} }).length > 0);
});

test('todo codigo que o writer emite tem mensagem propria', async () => {
  // Se alguem acrescentar um codigo no writer sem mapear aqui, a dona ve o texto de
  // integrador — sem acento e com o dia em ingles.
  const fonte = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/horarios_profissional.js', import.meta.url), 'utf8')
  );
  const codigos = [...fonte.matchAll(/recusar\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(codigos.length >= 10, 'a varredura precisa achar os codigos');

  const { MENSAGENS_HORARIOS } = await import('../../frontend/src/components/settings/horariosProfissional.js');
  const semMensagem = [...new Set(codigos)].filter((c) => !MENSAGENS_HORARIOS[c]);
  assert.deepEqual(semMensagem, [], `codigos sem mensagem na tela: ${semMensagem.join(', ')}`);
});
