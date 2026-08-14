import test from 'node:test'
import assert from 'node:assert/strict'

const {
  normalizeFeedbackSubmission,
  classifyNps,
  summarizeNps,
  isNpsEligible,
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
