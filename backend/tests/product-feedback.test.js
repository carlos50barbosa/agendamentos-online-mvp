import test from 'node:test'
import assert from 'node:assert/strict'

const {
  normalizeFeedbackSubmission,
  classifyNps,
  summarizeNps,
  isNpsEligible,
  summarizeNpsResponseRate,
  NPS_COOLDOWN_DIAS,
} = await import('../src/lib/product_feedback.js')

const DIA = 86400000

test('aceita um cancelamento com motivo da lista', () => {
  const r = normalizeFeedbackSubmission({ tipo: 'cancelamento', motivo: 'preco', comentario: '  ficou caro  ' })
  assert.equal(r.ok, true)
  assert.equal(r.value.tipo, 'cancelamento')
  assert.equal(r.value.motivo, 'preco')
  assert.equal(r.value.comentario, 'ficou caro')
  assert.equal(r.value.nota, null)
})

test('recusa tipo e motivo fora da lista', () => {
  assert.equal(normalizeFeedbackSubmission({ tipo: 'qualquer' }).error, 'tipo_invalido')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'cancelamento', motivo: 'porque_sim' }).error, 'motivo_invalido')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'cancelamento' }).error, 'motivo_obrigatorio')
})

test('motivo válido em um tipo não vale em outro', () => {
  // 'concorrente' e 'fechei_negocio' só existem no cancelamento: quem faz downgrade não foi
  // para o concorrente nem fechou as portas — continua pagando.
  assert.equal(normalizeFeedbackSubmission({ tipo: 'downgrade', motivo: 'concorrente' }).error, 'motivo_invalido')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'landing', motivo: 'fechei_negocio' }).error, 'motivo_invalido')
})

test('"outro" exige uma frase — senão não informa nada', () => {
  assert.equal(normalizeFeedbackSubmission({ tipo: 'cancelamento', motivo: 'outro' }).error, 'comentario_obrigatorio')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'cancelamento', motivo: 'outro', comentario: '  ' }).error, 'comentario_obrigatorio')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'cancelamento', motivo: 'outro', comentario: 'faltou integração com X' }).ok, true)
})

test('NPS aceita 0 como nota e não como "vazio"', () => {
  // A armadilha: Number('') === 0. Sem guarda, "não respondi" viraria a pior nota possível.
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: 0 }).value.nota, 0)
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: '' }).error, 'nota_obrigatoria')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: null }).error, 'nota_obrigatoria')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps' }).error, 'nota_obrigatoria')
})

test('NPS recusa nota fora de 0..10 e fracionária', () => {
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: 11 }).error, 'nota_invalida')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: -1 }).error, 'nota_invalida')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: 7.5 }).error, 'nota_invalida')
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', nota: 'oito' }).error, 'nota_invalida')
})

test('NPS não exige motivo e o comentário é opcional', () => {
  const r = normalizeFeedbackSubmission({ tipo: 'nps', nota: 9 })
  assert.equal(r.ok, true)
  assert.equal(r.value.motivo, null)
  assert.equal(r.value.comentario, null)
})

test('comentário e contexto são truncados, não recusados', () => {
  const r = normalizeFeedbackSubmission({
    tipo: 'nps',
    nota: 5,
    comentario: 'a'.repeat(5000),
    contexto: 'b'.repeat(400),
  })
  assert.equal(r.value.comentario.length, 1000)
  assert.equal(r.value.contexto.length, 120)
})

test('classifyNps segue o corte padrão da métrica', () => {
  assert.equal(classifyNps(10), 'promotor')
  assert.equal(classifyNps(9), 'promotor')
  assert.equal(classifyNps(8), 'neutro')
  assert.equal(classifyNps(7), 'neutro')
  assert.equal(classifyNps(6), 'detrator')
  assert.equal(classifyNps(0), 'detrator')
  // Linha sem nota (cancelamento, downgrade) não pode virar detrator por causa de Number(null)===0.
  assert.equal(classifyNps(null), null)
  assert.equal(classifyNps(undefined), null)
  assert.equal(classifyNps(''), null)
})

test('summarizeNps ignora linhas sem nota em vez de contá-las como detrator', () => {
  const s = summarizeNps([{ nota: 10 }, { nota: null }, { nota: undefined }])
  assert.equal(s.total, 1)
  assert.equal(s.detrator, 0)
  assert.equal(s.score, 100)
})

test('summarizeNps: neutro derruba a nota sem contar de nenhum lado', () => {
  // 2 promotores, 1 neutro, 1 detrator -> (50% - 25%) = 25
  const s = summarizeNps([{ nota: 10 }, { nota: 9 }, { nota: 8 }, { nota: 3 }])
  assert.equal(s.score, 25)
  assert.equal(s.total, 4)
  assert.equal(s.promotor, 2)
  assert.equal(s.neutro, 1)
  assert.equal(s.detrator, 1)
})

test('summarizeNps sem respostas devolve null, não zero', () => {
  // Zero é uma nota real (tantos promotores quanto detratores). "Ainda não sei" é outra coisa.
  const s = summarizeNps([])
  assert.equal(s.score, null)
  assert.equal(s.total, 0)
})

test('NPS só aparece depois de um marco de uso', () => {
  const agora = new Date('2026-08-13T12:00:00Z')
  const ontem = new Date(agora.getTime() - DIA)

  assert.equal(isNpsEligible({ contaCriadaEm: ontem, agendamentos: 0, agora }).eligible, false)
  // Volume alto compensa conta nova: quem já rodou 20 agendamentos tem opinião formada.
  assert.equal(isNpsEligible({ contaCriadaEm: ontem, agendamentos: 20, agora }).reason, 'volume')
  // E tempo de casa compensa volume baixo.
  const antiga = new Date(agora.getTime() - 40 * DIA)
  assert.equal(isNpsEligible({ contaCriadaEm: antiga, agendamentos: 1, agora }).reason, 'tempo_de_casa')
})

test('quem acabou de responder não é perguntado de novo, mesmo batendo todos os marcos', () => {
  const agora = new Date('2026-08-13T12:00:00Z')
  const antiga = new Date(agora.getTime() - 400 * DIA)

  const recente = new Date(agora.getTime() - 10 * DIA)
  const r = isNpsEligible({ contaCriadaEm: antiga, agendamentos: 999, ultimaRespostaEm: recente, agora })
  assert.equal(r.eligible, false)
  assert.equal(r.reason, 'respondeu_recentemente')

  const vencido = new Date(agora.getTime() - (NPS_COOLDOWN_DIAS + 1) * DIA)
  assert.equal(isNpsEligible({ contaCriadaEm: antiga, agendamentos: 999, ultimaRespostaEm: vencido, agora }).eligible, true)
})

// --- Eventos do NPS (exibição/dispensa) ---------------------------------------------------

test('exibição e dispensa são aceitas como evento, sem nota', () => {
  for (const evento of ['exibido', 'dispensado']) {
    const r = normalizeFeedbackSubmission({ tipo: 'nps', motivo: evento, contexto: 'app' })
    assert.equal(r.ok, true, evento)
    assert.equal(r.value.motivo, evento)
    assert.equal(r.value.nota, null)
  }
})

test('evento que venha com nota tem a nota descartada', () => {
  // Senão o denominador da taxa de resposta viraria o numerador: uma exibição contada como
  // resposta infla o NPS com uma nota que ninguém deu.
  const r = normalizeFeedbackSubmission({ tipo: 'nps', motivo: 'exibido', nota: 10 })
  assert.equal(r.value.nota, null)
})

test('motivo inventado no NPS continua exigindo nota', () => {
  // A saída antecipada vale só para a lista fechada de eventos — não vira porta para gravar
  // qualquer coisa em tipo 'nps'.
  assert.equal(normalizeFeedbackSubmission({ tipo: 'nps', motivo: 'qualquer' }).error, 'nota_obrigatoria')
})

test('taxa de resposta usa exibições como denominador', () => {
  const r = summarizeNpsResponseRate({ exibicoes: 10, respostas: 3, dispensas: 4 })
  assert.equal(r.taxa, 30)
  // Quem viu e navegou embora (10 - 3 - 4 = 3) também não respondeu e precisa continuar na conta.
  assert.equal(r.exibicoes, 10)
})

test('taxa de resposta sem exibições é null, não zero', () => {
  // Zero significaria "apareceu e ninguém respondeu". Ausência de dado é outra coisa.
  assert.equal(summarizeNpsResponseRate({ exibicoes: 0, respostas: 0 }).taxa, null)
})

test('taxa de resposta nunca passa de 100%', () => {
  // Acontece de verdade: respostas antigas, de antes de existir registro de exibição.
  assert.equal(summarizeNpsResponseRate({ exibicoes: 3, respostas: 4 }).taxa, 100)
})

test('cada evento do NPS tem seu próprio prazo de silêncio', () => {
  const agora = new Date('2026-08-17T12:00:00Z')
  const antiga = new Date(agora.getTime() - 400 * DIA)
  const base = { contaCriadaEm: antiga, agendamentos: 999, agora }
  const diasAtras = (n) => new Date(agora.getTime() - n * DIA)

  // Só viu: 7 dias.
  assert.equal(isNpsEligible({ ...base, ultimaExibicaoEm: diasAtras(3) }).reason, 'exibido_recentemente')
  assert.equal(isNpsEligible({ ...base, ultimaExibicaoEm: diasAtras(8) }).eligible, true)

  // Fechou no X: 30 dias.
  assert.equal(isNpsEligible({ ...base, ultimaDispensaEm: diasAtras(10) }).reason, 'dispensou_recentemente')
  assert.equal(isNpsEligible({ ...base, ultimaDispensaEm: diasAtras(31) }).eligible, true)

  // Respondeu: 90 dias.
  assert.equal(isNpsEligible({ ...base, ultimaRespostaEm: diasAtras(40) }).reason, 'respondeu_recentemente')
})

test('evento fraco não encurta o silêncio de um forte', () => {
  // A armadilha do "pega o mais recente e aplica o prazo dele": quem respondeu ontem e viu a caixa
  // hoje (por qualquer motivo) voltaria a ser elegível em 7 dias em vez de 90.
  const agora = new Date('2026-08-17T12:00:00Z')
  const r = isNpsEligible({
    contaCriadaEm: new Date(agora.getTime() - 400 * DIA),
    agendamentos: 999,
    ultimaRespostaEm: new Date(agora.getTime() - 2 * DIA),
    ultimaExibicaoEm: new Date(agora.getTime() - 1 * DIA),
    agora,
  })
  assert.equal(r.eligible, false)
  assert.equal(r.reason, 'respondeu_recentemente')
})
